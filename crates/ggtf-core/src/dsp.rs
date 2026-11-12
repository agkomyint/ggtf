//! Signal building blocks: chirps, Goertzel tone power, biquad filters, FFT correlation.

use rustfft::{num_complex::Complex32, Fft, FftPlanner};
use std::f64::consts::PI;
use std::sync::Arc;

/// Linear chirp from `f0` to `f1` Hz with short raised-cosine tapers at both ends.
pub fn chirp(len: usize, f0: f32, f1: f32, sr: f32, amp: f32) -> Vec<f32> {
    let total = len as f64 / sr as f64;
    let k = (f1 - f0) as f64 / total;
    let taper = (len / 20).max(1);
    (0..len)
        .map(|n| {
            let t = n as f64 / sr as f64;
            let phase = 2.0 * PI * (f0 as f64 * t + 0.5 * k * t * t);
            let mut a = amp as f64;
            if n < taper {
                a *= 0.5 - 0.5 * (PI * n as f64 / taper as f64).cos();
            }
            if n + taper >= len {
                let m = len - 1 - n;
                a *= 0.5 - 0.5 * (PI * m as f64 / taper as f64).cos();
            }
            (a * phase.sin()) as f32
        })
        .collect()
}

/// Power of one frequency over `x` (Goertzel).
pub fn tone_power(x: &[f32], freq: f32, sr: f32) -> f32 {
    let w = 2.0 * PI * freq as f64 / sr as f64;
    let coeff = 2.0 * w.cos();
    let (mut s1, mut s2) = (0.0f64, 0.0f64);
    for &v in x {
        let s0 = v as f64 + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
    }
    (s1 * s1 + s2 * s2 - coeff * s1 * s2).max(0.0) as f32
}

/// RBJ biquad, transposed direct form II.
#[derive(Clone, Debug)]
pub struct Biquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    z1: f64,
    z2: f64,
}

impl Biquad {
    fn from_coeffs(b0: f64, b1: f64, b2: f64, a0: f64, a1: f64, a2: f64) -> Self {
        Biquad { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0, z1: 0.0, z2: 0.0 }
    }

    pub fn highpass(fc: f32, sr: f32, q: f64) -> Self {
        let w0 = 2.0 * PI * fc as f64 / sr as f64;
        let (s, c) = w0.sin_cos();
        let alpha = s / (2.0 * q);
        Self::from_coeffs((1.0 + c) / 2.0, -(1.0 + c), (1.0 + c) / 2.0, 1.0 + alpha, -2.0 * c, 1.0 - alpha)
    }

    pub fn lowpass(fc: f32, sr: f32, q: f64) -> Self {
        let w0 = 2.0 * PI * fc as f64 / sr as f64;
        let (s, c) = w0.sin_cos();
        let alpha = s / (2.0 * q);
        Self::from_coeffs((1.0 - c) / 2.0, 1.0 - c, (1.0 - c) / 2.0, 1.0 + alpha, -2.0 * c, 1.0 - alpha)
    }

    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        let x = x as f64;
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y as f32
    }
}

/// 4th-order Butterworth band-pass (two high-pass and two low-pass sections).
#[derive(Clone, Debug)]
pub struct BandPass {
    stages: [Biquad; 4],
}

impl BandPass {
    pub fn new(lo: f32, hi: f32, sr: f32) -> Self {
        const Q1: f64 = 0.541_196_1;
        const Q2: f64 = 1.306_563;
        BandPass {
            stages: [
                Biquad::highpass(lo, sr, Q1),
                Biquad::highpass(lo, sr, Q2),
                Biquad::lowpass(hi, sr, Q1),
                Biquad::lowpass(hi, sr, Q2),
            ],
        }
    }

    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        self.stages.iter_mut().fold(x, |v, s| s.process(v))
    }
}

/// Normalized cross-correlation against a fixed template, computed with FFTs.
pub struct Correlator {
    nfft: usize,
    tlen: usize,
    tmpl: Vec<Complex32>,
    tnorm: f32,
    fwd: Arc<dyn Fft<f32>>,
    inv: Arc<dyn Fft<f32>>,
}

impl Correlator {
    pub fn new(template: &[f32], nfft: usize) -> Self {
        assert!(nfft > template.len());
        let mut planner = FftPlanner::<f32>::new();
        let fwd = planner.plan_fft_forward(nfft);
        let inv = planner.plan_fft_inverse(nfft);
        let mut t: Vec<Complex32> = (0..nfft)
            .map(|i| Complex32::new(template.get(i).copied().unwrap_or(0.0), 0.0))
            .collect();
        fwd.process(&mut t);
        let tmpl = t.iter().map(|c| c.conj()).collect();
        let tnorm = template.iter().map(|v| v * v).sum::<f32>().sqrt();
        Correlator { nfft, tlen: template.len(), tmpl, tnorm, fwd, inv }
    }

    pub fn nfft(&self) -> usize {
        self.nfft
    }

    pub fn template_len(&self) -> usize {
        self.tlen
    }

    /// Number of start positions evaluated per call.
    pub fn valid(&self) -> usize {
        self.nfft - self.tlen + 1
    }

    /// `x.len()` must equal `nfft`. Returns normalized correlation (-1..1) for each start
    /// position `k` in `0..valid()`, where the template is compared with `x[k..k+tlen]`.
    pub fn correlate(&self, x: &[f32]) -> Vec<f32> {
        assert_eq!(x.len(), self.nfft);
        let mut buf: Vec<Complex32> = x.iter().map(|&v| Complex32::new(v, 0.0)).collect();
        self.fwd.process(&mut buf);
        for (b, t) in buf.iter_mut().zip(&self.tmpl) {
            *b *= *t;
        }
        self.inv.process(&mut buf);
        let mut prefix = vec![0f64; self.nfft + 1];
        for (i, &v) in x.iter().enumerate() {
            prefix[i + 1] = prefix[i] + (v as f64) * (v as f64);
        }
        let scale = 1.0 / self.nfft as f32;
        (0..self.valid())
            .map(|k| {
                let e = prefix[k + self.tlen] - prefix[k];
                if e <= 1e-12 {
                    0.0
                } else {
                    buf[k].re * scale / (self.tnorm * (e as f32).sqrt())
                }
            })
            .collect()
    }
}

/// Linear convolution via FFT, truncated to `a.len()` samples.
pub fn fft_convolve(a: &[f32], b: &[f32]) -> Vec<f32> {
    if a.is_empty() || b.is_empty() {
        return a.to_vec();
    }
    let n = (a.len() + b.len() - 1).next_power_of_two();
    let mut planner = FftPlanner::<f32>::new();
    let fwd = planner.plan_fft_forward(n);
    let inv = planner.plan_fft_inverse(n);
    let mut fa: Vec<Complex32> = (0..n).map(|i| Complex32::new(a.get(i).copied().unwrap_or(0.0), 0.0)).collect();
    let mut fb: Vec<Complex32> = (0..n).map(|i| Complex32::new(b.get(i).copied().unwrap_or(0.0), 0.0)).collect();
    fwd.process(&mut fa);
    fwd.process(&mut fb);
    for (x, y) in fa.iter_mut().zip(&fb) {
        *x *= *y;
    }
    inv.process(&mut fa);
    let scale = 1.0 / n as f32;
    fa[..a.len()].iter().map(|c| c.re * scale).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn correlator_finds_template() {
        let t = chirp(4800, 1500.0, 4800.0, 48000.0, 0.7);
        let c = Correlator::new(&t, 8192);
        let mut x = vec![0.0f32; 8192];
        x[1000..1000 + 4800].copy_from_slice(&t);
        let r = c.correlate(&x);
        let (k, best) = r.iter().enumerate().fold((0, f32::MIN), |acc, (i, &v)| if v > acc.1 { (i, v) } else { acc });
        assert_eq!(k, 1000);
        assert!(best > 0.99);
    }

    #[test]
    fn goertzel_picks_right_tone() {
        let sr = 48000.0;
        let x: Vec<f32> = (0..960).map(|n| (2.0 * std::f32::consts::PI * 2000.0 * n as f32 / sr).sin()).collect();
        assert!(tone_power(&x, 2000.0, sr) > 1000.0 * tone_power(&x, 2100.0, sr));
    }
}
