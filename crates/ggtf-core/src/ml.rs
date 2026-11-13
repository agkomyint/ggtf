//! ML symbol decoder.
//!
//! The classic decoder picks the loudest of 16 tones in each symbol window. That is close to optimal
//! for plain hiss, but it is fooled by sounds that look like tones: notification beeps, the echo of
//! the previous symbol, sustained music notes. The ML decoder sees more context per decision:
//! tone powers over the whole window, over four quarters of it (does the tone last the whole symbol?),
//! and over the previous and next symbols (is this tone just ringing on from a neighbour or a beep
//! that never stops?). A small MLP turns that into 16 probabilities.
//!
//! The same `features` function feeds training (`examples/ml_data.rs`) and live decoding, so the
//! model always sees identical inputs. Weights live in `models/symbol_mlp.bin`, embedded in the
//! binary; if the file is missing or invalid, the ML decoder falls back to classic.

use crate::dsp;
use crate::profile::{Band, Profile};
use crate::SR;
use std::sync::OnceLock;

/// Number of time slices per tone: full window, 4 quarters, previous symbol, next symbol.
pub const SLICES: usize = 7;
pub const TONES: usize = 16;
pub const N_FEATURES: usize = SLICES * TONES;
const FLOOR_DB: f32 = -60.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decoder {
    Classic,
    Ml,
}

impl Decoder {
    pub fn name(self) -> &'static str {
        match self {
            Decoder::Classic => "classic",
            Decoder::Ml => "ml",
        }
    }
}

fn window_powers(p: &Profile, band: Band, win: &[f32], g: usize) -> [f32; TONES] {
    let mut out = [0f32; TONES];
    for (t, o) in out.iter_mut().enumerate() {
        *o = dsp::tone_power(win, p.tone_hz(band, g, t), SR);
    }
    out
}

/// Full-window tone powers for every symbol and group: `[symbol][group][tone]`.
pub fn full_powers(p: &Profile, band: Band, x: &[f32], nsym: usize) -> Vec<Vec<[f32; TONES]>> {
    let l = p.symbol_len();
    let off = p.analysis_offset();
    (0..nsym)
        .map(|k| {
            let win = &x[k * l + off..k * l + off + p.window];
            (0..p.groups).map(|g| window_powers(p, band, win, g)).collect()
        })
        .collect()
}

/// Feature vector for symbol `k`, group `g`. `full` comes from `full_powers`.
pub fn features(p: &Profile, band: Band, x: &[f32], full: &[Vec<[f32; TONES]>], k: usize, g: usize) -> [f32; N_FEATURES] {
    let l = p.symbol_len();
    let off = p.analysis_offset();
    let q = p.window / 4;
    let cur = full[k][g];
    let prev = if k > 0 { full[k - 1][g] } else { cur };
    let next = if k + 1 < full.len() { full[k + 1][g] } else { cur };
    let mut rows: [[f32; TONES]; SLICES] = [[0.0; TONES]; SLICES];
    rows[0] = cur;
    for s in 0..4 {
        let start = k * l + off + s * q;
        rows[1 + s] = window_powers(p, band, &x[start..start + q], g);
    }
    rows[5] = prev;
    rows[6] = next;
    // Scale invariance: everything in dB relative to the loudest tone of the full window.
    // Quarters are scaled by 16 (= 4^2) so a steady tone reads the same in a quarter and the full window.
    let to_db = |v: f32| 10.0 * v.max(1e-20).log10();
    let ref_db = cur.iter().copied().map(to_db).fold(f32::MIN, f32::max);
    let mut out = [0f32; N_FEATURES];
    for (s, row) in rows.iter().enumerate() {
        let scale = if (1..=4).contains(&s) { 16.0 } else { 1.0 };
        for t in 0..TONES {
            let db = to_db(row[t] * scale) - ref_db;
            out[s * TONES + t] = (db.max(FLOOR_DB) / -FLOOR_DB).min(1.0);
        }
    }
    out
}

/// Dense ReLU network: layers of (in, out, weights[out][in], bias[out]); last layer is linear.
pub struct Mlp {
    layers: Vec<(usize, usize, Vec<f32>, Vec<f32>)>,
}

impl Mlp {
    /// Format: b"GGTF" | u32 layer count | per layer: u32 in, u32 out, f32 w[out*in], f32 b[out]. Little-endian.
    pub fn from_bytes(b: &[u8]) -> Option<Self> {
        if b.len() < 8 || &b[..4] != b"GGTF" {
            return None;
        }
        let rd = |i: usize| -> Option<u32> { b.get(i..i + 4).map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]])) };
        let n = rd(4)? as usize;
        let mut pos = 8;
        let mut layers = Vec::with_capacity(n);
        let mut prev_out = N_FEATURES;
        for _ in 0..n {
            let (i, o) = (rd(pos)? as usize, rd(pos + 4)? as usize);
            pos += 8;
            if i != prev_out || i == 0 || o == 0 || i * o > 1 << 22 {
                return None;
            }
            let mut take = |count: usize| -> Option<Vec<f32>> {
                let s = b.get(pos..pos + count * 4)?;
                pos += count * 4;
                Some(s.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect())
            };
            let w = take(i * o)?;
            let bias = take(o)?;
            layers.push((i, o, w, bias));
            prev_out = o;
        }
        if prev_out != TONES || pos != b.len() {
            return None;
        }
        Some(Mlp { layers })
    }

    /// Returns softmax probabilities over the 16 tones.
    pub fn predict(&self, x: &[f32; N_FEATURES]) -> [f32; TONES] {
        let mut a: Vec<f32> = x.to_vec();
        let last = self.layers.len() - 1;
        for (li, (i, o, w, b)) in self.layers.iter().enumerate() {
            let mut z = b.clone();
            for r in 0..*o {
                let row = &w[r * i..(r + 1) * i];
                z[r] += row.iter().zip(&a).map(|(p, q)| p * q).sum::<f32>();
                if li != last && z[r] < 0.0 {
                    z[r] = 0.0;
                }
            }
            a = z;
        }
        let m = a.iter().copied().fold(f32::MIN, f32::max);
        let mut out = [0f32; TONES];
        let mut sum = 0.0;
        for (t, v) in a.iter().enumerate() {
            out[t] = (v - m).exp();
            sum += out[t];
        }
        out.iter_mut().for_each(|v| *v /= sum);
        out
    }
}

static MODEL_BYTES: &[u8] = include_bytes!("../models/symbol_mlp.bin");
static MODEL: OnceLock<Option<Mlp>> = OnceLock::new();

/// The embedded model, if one was trained and bundled.
pub fn model() -> Option<&'static Mlp> {
    MODEL.get_or_init(|| Mlp::from_bytes(MODEL_BYTES)).as_ref()
}

pub fn model_available() -> bool {
    model().is_some()
}
