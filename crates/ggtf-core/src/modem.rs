//! MFSK modem: turns frames into audio and audio back into soft bytes.
//!
//! Frame audio: chirp preamble | gap | 2 wraith marker symbols (say which profile follows)
//!              | header symbols | payload symbols | tail silence

use crate::dsp;
use crate::frame::{Frame, HEADER_CW_LEN};
use crate::profile::{Profile, ProfileId, WRAITH};
use crate::SR;
use std::f64::consts::PI;

pub const PREAMBLE_LEN: usize = 4800;
pub const PREAMBLE_F0: f32 = 1500.0;
pub const PREAMBLE_F1: f32 = 4800.0;
pub const PREAMBLE_GAP: usize = 480;
pub const MARKER_SYMBOLS: usize = 2;
pub const TAIL: usize = 960;
pub const AMP: f32 = 0.7;
/// Power ratio (best tone / runner-up) below which a nibble counts as a suspect for RS erasures.
pub const SUSPECT_RATIO: f32 = 6.0;

pub fn preamble() -> Vec<f32> {
    dsp::chirp(PREAMBLE_LEN, PREAMBLE_F0, PREAMBLE_F1, SR, AMP)
}

pub fn marker_tone(id: ProfileId) -> usize {
    2 + 6 * id as usize
}

pub fn marker_offset() -> usize {
    PREAMBLE_LEN + PREAMBLE_GAP
}

pub fn marker_len() -> usize {
    MARKER_SYMBOLS * WRAITH.symbol_len()
}

pub fn header_samples(p: &Profile) -> usize {
    p.symbols_for_bytes(HEADER_CW_LEN) * p.symbol_len()
}

pub fn payload_cw_len(p: &Profile, payload_len: usize) -> usize {
    if payload_len == 0 {
        0
    } else {
        payload_len + 4 + p.parity
    }
}

pub fn payload_samples(p: &Profile, payload_len: usize) -> usize {
    p.symbols_for_bytes(payload_cw_len(p, payload_len)) * p.symbol_len()
}

pub fn frame_samples(id: ProfileId, payload_len: usize) -> usize {
    let p = id.profile();
    marker_offset() + marker_len() + header_samples(p) + payload_samples(p, payload_len) + p.ramp() + TAIL
}

pub fn airtime_ms(id: ProfileId, payload_len: usize) -> f64 {
    frame_samples(id, payload_len) as f64 * 1000.0 / SR as f64
}

fn bytes_to_symbols(bytes: &[u8], groups: usize) -> Vec<Vec<u8>> {
    let mut nib = Vec::with_capacity(bytes.len() * 2 + groups);
    for &b in bytes {
        nib.push(b >> 4);
        nib.push(b & 0x0f);
    }
    while nib.len() % groups != 0 {
        nib.push(0);
    }
    nib.chunks(groups).map(|c| c.to_vec()).collect()
}

/// Writes symbols into `out` starting at `at`; returns where the next symbol starts.
/// Each tone extends `ramp` samples into the next symbol and crossfades with it.
fn render(p: &Profile, symbols: &[Vec<u8>], out: &mut Vec<f32>, at: usize) -> usize {
    let l = p.symbol_len();
    let r = p.ramp();
    let end = at + symbols.len() * l;
    if out.len() < end + r {
        out.resize(end + r, 0.0);
    }
    let amp = (AMP / p.groups as f32) as f64;
    for (k, sym) in symbols.iter().enumerate() {
        let s0 = at + k * l;
        for (g, &tone) in sym.iter().enumerate() {
            let w = 2.0 * PI * p.tone_hz(g, tone as usize) as f64 / SR as f64;
            for n in 0..(l + r) {
                let env = if n < r {
                    0.5 - 0.5 * (PI * n as f64 / r as f64).cos()
                } else if n >= l {
                    0.5 + 0.5 * (PI * (n - l) as f64 / r as f64).cos()
                } else {
                    1.0
                };
                out[s0 + n] += (amp * env * (w * n as f64).sin()) as f32;
            }
        }
    }
    end
}

pub fn encode_frame(frame: &Frame, id: ProfileId) -> Vec<f32> {
    let p = id.profile();
    let mut out = preamble();
    out.resize(marker_offset(), 0.0);
    let mk = marker_tone(id) as u8;
    let at = render(&WRAITH, &vec![vec![mk; WRAITH.groups]; MARKER_SYMBOLS], &mut out, marker_offset());
    let at = render(p, &bytes_to_symbols(&frame.header_codeword(), p.groups), &mut out, at);
    let at = match frame.payload_codeword(p.parity) {
        Some(cw) => render(p, &bytes_to_symbols(&cw, p.groups), &mut out, at),
        None => at,
    };
    out.resize(at + p.ramp() + TAIL, 0.0);
    out
}

/// Bytes recovered from symbols, with a confidence per byte and a signal margin estimate.
#[derive(Clone, Debug)]
pub struct Soft {
    pub bytes: Vec<u8>,
    pub conf: Vec<f32>,
    /// Mean ratio of the chosen tone's power to the average of the other tones, in dB.
    pub snr_db: f32,
}

impl Soft {
    /// Byte positions whose confidence is below the suspect threshold, least confident first.
    pub fn suspects(&self) -> Vec<usize> {
        let mut s: Vec<usize> = (0..self.conf.len()).filter(|&i| self.conf[i] < SUSPECT_RATIO).collect();
        s.sort_by(|&a, &b| self.conf[a].total_cmp(&self.conf[b]));
        s
    }
}

/// Classic decoder: Goertzel power for each tone, pick the strongest per group.
/// `x` starts at the first symbol and must hold all symbols.
pub fn demod_bytes(p: &Profile, x: &[f32], n_bytes: usize) -> Soft {
    let nsym = p.symbols_for_bytes(n_bytes);
    let l = p.symbol_len();
    let off = p.analysis_offset();
    let mut nib = Vec::with_capacity(nsym * p.groups);
    let mut nconf = Vec::with_capacity(nsym * p.groups);
    let mut margin = 0.0f64;
    for k in 0..nsym {
        let win = &x[k * l + off..k * l + off + p.window];
        for g in 0..p.groups {
            let (mut b1, mut b2, mut bi, mut total) = (-1.0f32, 0.0f32, 0usize, 0.0f32);
            for t in 0..p.tones {
                let e = dsp::tone_power(win, p.tone_hz(g, t), SR);
                total += e;
                if e > b1 {
                    b2 = b1.max(0.0);
                    b1 = e;
                    bi = t;
                } else if e > b2 {
                    b2 = e;
                }
            }
            let others = ((total - b1) / (p.tones - 1) as f32).max(1e-12);
            margin += (b1.max(1e-12) / others) as f64;
            nib.push(bi as u8);
            nconf.push(b1 / b2.max(1e-12));
        }
    }
    let mut bytes = Vec::with_capacity(n_bytes);
    let mut conf = Vec::with_capacity(n_bytes);
    for i in 0..n_bytes {
        bytes.push((nib[2 * i] << 4) | nib[2 * i + 1]);
        conf.push(nconf[2 * i].min(nconf[2 * i + 1]));
    }
    let n = (nsym * p.groups).max(1) as f64;
    Soft { bytes, conf, snr_db: (10.0 * (margin / n).log10()) as f32 }
}

/// Reads the two marker symbols and returns the profile they announce.
pub fn decode_marker(x: &[f32]) -> Option<ProfileId> {
    let p = &WRAITH;
    let l = p.symbol_len();
    let off = p.analysis_offset();
    let mut score = [0f32; 3];
    for s in 0..MARKER_SYMBOLS {
        let win = &x[s * l + off..s * l + off + p.window];
        for g in 0..p.groups {
            for id in ProfileId::ALL {
                score[id as usize] += dsp::tone_power(win, p.tone_hz(g, marker_tone(id)), SR);
            }
        }
    }
    let mut idx: Vec<usize> = (0..3).collect();
    idx.sort_by(|&a, &b| score[b].total_cmp(&score[a]));
    if score[idx[0]] > 2.0 * score[idx[1]].max(1e-12) {
        ProfileId::from_u8(idx[0] as u8)
    } else {
        None
    }
}
