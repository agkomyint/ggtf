//! Channel simulator: degrades clean audio the way a real room would. Seeded and deterministic.
//!
//! SNR values are full-band: noise power relative to the mean power of the clean signal.
//! The GGTF band is about 3.3 kHz wide, so in-band SNR is roughly 8 dB better than the
//! number given for white noise.

use crate::dsp;
use crate::rng::Rng;
use crate::SR;
use std::f64::consts::PI;

#[derive(Clone, Debug)]
pub struct Channel {
    pub seed: u64,
    pub gain_db: f32,
    pub white_snr_db: Option<f32>,
    /// Synthetic overlapping talkers (harmonic voices with syllable-rate envelopes).
    pub babble_snr_db: Option<f32>,
    /// Synthetic music: changing chords with harmonics.
    pub music_snr_db: Option<f32>,
    /// Random in-band notification beeps.
    pub beeps_snr_db: Option<f32>,
    pub reverb_rt60_ms: Option<f32>,
    pub reverb_wet: f32,
    /// Silence gaps (cut-outs).
    pub dropouts: u32,
    pub dropout_ms: f32,
    /// Loud broadband bursts (door slam, cough).
    pub bursts: u32,
    pub burst_ms: f32,
    pub drift_ppm: f32,
    pub clip: Option<f32>,
    pub lead_ms: f32,
    pub tail_ms: f32,
}

impl Default for Channel {
    fn default() -> Self {
        Channel {
            seed: 1,
            gain_db: 0.0,
            white_snr_db: None,
            babble_snr_db: None,
            music_snr_db: None,
            beeps_snr_db: None,
            reverb_rt60_ms: None,
            reverb_wet: 0.3,
            dropouts: 0,
            dropout_ms: 60.0,
            bursts: 0,
            burst_ms: 80.0,
            drift_ppm: 0.0,
            clip: None,
            lead_ms: 300.0,
            tail_ms: 600.0,
        }
    }
}

fn ms(v: f32) -> usize {
    (v * SR / 1000.0).max(0.0) as usize
}

fn power(x: &[f32]) -> f64 {
    if x.is_empty() {
        return 0.0;
    }
    x.iter().map(|&v| (v as f64) * (v as f64)).sum::<f64>() / x.len() as f64
}

fn add_scaled(out: &mut [f32], noise: &[f32], target_power: f64) {
    let p = power(noise);
    if p <= 0.0 {
        return;
    }
    let g = (target_power / p).sqrt() as f32;
    for (o, n) in out.iter_mut().zip(noise) {
        *o += g * n;
    }
}

pub fn white(n: usize, rng: &mut Rng) -> Vec<f32> {
    (0..n).map(|_| rng.gauss() as f32).collect()
}

pub fn babble(n: usize, rng: &mut Rng) -> Vec<f32> {
    let mut out = vec![0f32; n];
    for _ in 0..3 {
        let f0 = rng.range(95.0, 230.0);
        let syl = rng.range(3.0, 5.5);
        let ph0 = rng.range(0.0, 2.0 * PI);
        let harmonics = ((4500.0 / f0) as usize).max(1);
        let mut phases = vec![0f64; harmonics];
        for (i, o) in out.iter_mut().enumerate() {
            let t = i as f64 / SR as f64;
            let f = f0 * (1.0 + 0.08 * (2.0 * PI * 2.7 * t + ph0).sin());
            let env = (2.0 * PI * syl * t + ph0).sin().max(0.0).powi(2);
            let mut v = 0.0;
            for (h, ph) in phases.iter_mut().enumerate() {
                let hf = f * (h + 1) as f64;
                *ph += 2.0 * PI * hf / SR as f64;
                // Rough formant shaping: emphasis around 500 Hz and 1.8 kHz.
                let w = 1.0 / (1.0 + ((hf - 500.0) / 400.0).powi(2)) + 0.5 / (1.0 + ((hf - 1800.0) / 600.0).powi(2)) + 0.05;
                v += w * ph.sin() / (h + 1) as f64;
            }
            *o += (env * v) as f32;
        }
    }
    out
}

pub fn music(n: usize, rng: &mut Rng) -> Vec<f32> {
    let mut out = vec![0f32; n];
    let step = ms(rng.range(220.0, 380.0) as f32).max(1);
    let scale = [0, 2, 4, 5, 7, 9, 11];
    let mut start = 0;
    while start < n {
        let len = step.min(n - start);
        for _ in 0..3 {
            let note = 48 + scale[rng.below(7) as usize] + 12 * rng.below(3) as i32;
            let f = 440.0 * 2f64.powf((note as f64 - 69.0) / 12.0);
            for h in 1..=6 {
                let hf = f * h as f64;
                if hf > 9000.0 {
                    break;
                }
                let a = 0.5f64.powi(h - 1);
                for i in 0..len {
                    let t = i as f64 / SR as f64;
                    let env = (-t * 4.0).exp();
                    out[start + i] += (a * env * (2.0 * PI * hf * t).sin()) as f32;
                }
            }
        }
        start += step;
    }
    out
}

pub fn beeps(n: usize, rng: &mut Rng) -> Vec<f32> {
    let mut out = vec![0f32; n];
    let count = ((n as f32 / SR) * 3.0).ceil() as usize;
    for _ in 0..count {
        let f = rng.range(1500.0, 4800.0);
        let len = ms(rng.range(50.0, 200.0) as f32);
        let at = rng.below(n.saturating_sub(len).max(1) as u64) as usize;
        for i in 0..len.min(n - at) {
            out[at + i] += (2.0 * PI * f * i as f64 / SR as f64).sin() as f32;
        }
    }
    out
}

fn reverb_ir(rt60_ms: f32, wet: f32, rng: &mut Rng) -> Vec<f32> {
    let len = ms(rt60_ms).max(2);
    let tau = rt60_ms as f64 / 1000.0 * SR as f64 / 6.9078;
    let mut ir = vec![0f32; len];
    ir[0] = 1.0;
    for (i, v) in ir.iter_mut().enumerate().skip(48) {
        *v = (wet as f64 * rng.gauss() * 0.05 * (-(i as f64) / tau).exp()) as f32;
    }
    ir
}

fn resample(x: &[f32], ratio: f64) -> Vec<f32> {
    let n = (x.len() as f64 / ratio) as usize;
    (0..n)
        .map(|i| {
            let p = i as f64 * ratio;
            let i0 = p.floor() as usize;
            let f = (p - i0 as f64) as f32;
            let a = x.get(i0).copied().unwrap_or(0.0);
            let b = x.get(i0 + 1).copied().unwrap_or(0.0);
            a + (b - a) * f
        })
        .collect()
}

/// Runs `signal` through the channel. Output includes lead and tail padding.
pub fn apply(signal: &[f32], ch: &Channel) -> Vec<f32> {
    let mut rng = Rng::new(ch.seed);
    let sig_power = power(signal).max(1e-12);
    let lead = ms(ch.lead_ms);
    let mut x = vec![0f32; lead];
    x.extend_from_slice(signal);
    x.extend(std::iter::repeat_n(0.0, ms(ch.tail_ms)));

    if ch.drift_ppm != 0.0 {
        x = resample(&x, 1.0 + ch.drift_ppm as f64 * 1e-6);
    }
    if let Some(rt) = ch.reverb_rt60_ms {
        let ir = reverb_ir(rt, ch.reverb_wet, &mut rng);
        x = dsp::fft_convolve(&x, &ir);
    }
    let n = x.len();
    if let Some(snr) = ch.white_snr_db {
        add_scaled(&mut x, &white(n, &mut rng), sig_power / 10f64.powf(snr as f64 / 10.0));
    }
    if let Some(snr) = ch.babble_snr_db {
        add_scaled(&mut x, &babble(n, &mut rng), sig_power / 10f64.powf(snr as f64 / 10.0));
    }
    if let Some(snr) = ch.music_snr_db {
        add_scaled(&mut x, &music(n, &mut rng), sig_power / 10f64.powf(snr as f64 / 10.0));
    }
    if let Some(snr) = ch.beeps_snr_db {
        add_scaled(&mut x, &beeps(n, &mut rng), sig_power / 10f64.powf(snr as f64 / 10.0));
    }
    let active = (lead, (lead + signal.len()).min(n));
    let span = (active.1 - active.0).max(1) as u64;
    for _ in 0..ch.dropouts {
        let len = ms(ch.dropout_ms);
        let at = active.0 + rng.below(span) as usize;
        for v in x.iter_mut().skip(at).take(len) {
            *v = 0.0;
        }
    }
    for _ in 0..ch.bursts {
        let len = ms(ch.burst_ms);
        let at = active.0 + rng.below(span) as usize;
        let sigma = (sig_power.sqrt() * 3.0) as f32;
        for v in x.iter_mut().skip(at).take(len) {
            *v += sigma * rng.gauss() as f32;
        }
    }
    let g = 10f32.powf(ch.gain_db / 20.0);
    for v in x.iter_mut() {
        *v *= g;
        if let Some(c) = ch.clip {
            *v = v.clamp(-c, c);
        }
    }
    x
}
