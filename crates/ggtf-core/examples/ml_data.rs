//! Generates labeled training data for the ML symbol decoder.
//!
//! Random frames (random profile, band, length) go through random simulated rooms. For every
//! header and payload symbol we compute the exact features the live receiver computes
//! (`ml::features`) and store the true tone index as the label.
//!
//! Usage: cargo run --release -p ggtf-core --example ml_data -- <out_dir> <frames> <seed>
//! Writes <out_dir>/x.f32 (N x 112, little-endian f32) and <out_dir>/y.u8 (N labels).

use ggtf_core::frame::{Frame, FrameType, HEADER_CW_LEN};
use ggtf_core::ml::{self, N_FEATURES};
use ggtf_core::modem;
use ggtf_core::profile::{Band, ProfileId};
use ggtf_core::rng::Rng;
use ggtf_core::sim::{self, Channel};
use ggtf_core::SR;
use std::io::Write;

fn random_channel(rng: &mut Rng, seed: u64) -> Channel {
    let mut c = Channel { seed, lead_ms: 300.0, tail_ms: 600.0, ..Default::default() };
    let chance = |rng: &mut Rng, p: f64| rng.next_f64() < p;
    // A third of the rooms are plain hiss, down to very low SNR: the model must at least
    // match the classic loudest-tone rule there.
    if chance(rng, 0.33) {
        c.white_snr_db = Some(rng.range(-17.0, 6.0) as f32);
        if chance(rng, 0.3) {
            c.drift_ppm = rng.range(-200.0, 200.0) as f32;
        }
        return c;
    }
    c.white_snr_db = Some(rng.range(-14.0, 22.0) as f32);
    if chance(rng, 0.45) {
        c.babble_snr_db = Some(rng.range(-6.0, 12.0) as f32);
    }
    if chance(rng, 0.4) {
        c.music_snr_db = Some(rng.range(-6.0, 12.0) as f32);
    }
    if chance(rng, 0.4) {
        c.beeps_snr_db = Some(rng.range(-3.0, 12.0) as f32);
    }
    if chance(rng, 0.5) {
        c.reverb_rt60_ms = Some(rng.range(100.0, 900.0) as f32);
        c.reverb_wet = rng.range(0.2, 0.8) as f32;
    }
    if chance(rng, 0.25) {
        c.dropouts = 1 + rng.below(3) as u32;
        c.dropout_ms = rng.range(20.0, 90.0) as f32;
    }
    if chance(rng, 0.25) {
        c.bursts = 1 + rng.below(3) as u32;
        c.burst_ms = rng.range(30.0, 130.0) as f32;
    }
    if chance(rng, 0.5) {
        c.drift_ppm = rng.range(-200.0, 200.0) as f32;
    }
    if chance(rng, 0.3) {
        c.highpass_hz = Some(rng.range(200.0, 500.0) as f32);
        c.lowpass_hz = Some(rng.range(6000.0, 19000.0) as f32);
    }
    c
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let out = args.get(1).cloned().unwrap_or_else(|| "ml/data/train".into());
    let frames: u32 = args.get(2).and_then(|v| v.parse().ok()).unwrap_or(2000);
    let seed: u64 = args.get(3).and_then(|v| v.parse().ok()).unwrap_or(1);
    std::fs::create_dir_all(&out).unwrap();

    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4) as u32;
    let per = frames.div_ceil(threads);
    let parts: Vec<(Vec<f32>, Vec<u8>)> = std::thread::scope(|s| {
        let hs: Vec<_> = (0..threads)
            .map(|t| {
                s.spawn(move || {
                    let mut xs: Vec<f32> = Vec::new();
                    let mut ys: Vec<u8> = Vec::new();
                    let mut rng = Rng::new(seed.wrapping_mul(1_000_003).wrapping_add(t as u64));
                    for i in 0..per {
                        let id = ProfileId::ALL[rng.below(ProfileId::ALL.len() as u64) as usize];
                        let band = Band::ALL[rng.below(3) as usize];
                        let p = id.profile();
                        let len = 1 + rng.below(80) as usize;
                        let mut f = Frame::new(FrameType::Data, rng.next_u64() as u16, rng.next_u64() as u16, rng.bytes(len));
                        f.seq = rng.next_u64() as u8;
                        let clean = modem::encode_frame(&f, id, band);
                        let ch = random_channel(&mut rng, seed ^ ((t as u64) << 32) ^ i as u64);
                        let y = sim::apply(&clean, &ch);
                        let ratio = 1.0 + ch.drift_ppm as f64 * 1e-6;
                        let lead = (ch.lead_ms * SR / 1000.0) as f64;
                        let jitter = rng.range(-24.0, 24.0);
                        let header_at = modem::marker_offset() + modem::marker_len();
                        let payload_at = header_at + modem::header_samples(p);
                        let parts = [
                            (header_at, f.header_codeword(), HEADER_CW_LEN),
                            (payload_at, f.payload_codeword(modem::payload_parity(p, len)).unwrap(), modem::payload_cw_len(p, len)),
                        ];
                        for (at, cw, n) in parts {
                            let start = ((lead + at as f64) / ratio + jitter).round().max(0.0) as usize;
                            let nsym = p.symbols_for_bytes(n);
                            if start + nsym * p.symbol_len() > y.len() {
                                continue;
                            }
                            let x = &y[start..];
                            let full = ml::full_powers(p, band, x, nsym);
                            let truth = modem::codeword_nibbles(&cw, p.groups);
                            for k in 0..nsym {
                                for g in 0..p.groups {
                                    xs.extend_from_slice(&ml::features(p, band, x, &full, k, g));
                                    ys.push(truth[k * p.groups + g]);
                                }
                            }
                        }
                    }
                    (xs, ys)
                })
            })
            .collect();
        hs.into_iter().map(|h| h.join().unwrap()).collect()
    });

    let mut fx = std::io::BufWriter::new(std::fs::File::create(format!("{out}/x.f32")).unwrap());
    let mut fy = std::io::BufWriter::new(std::fs::File::create(format!("{out}/y.u8")).unwrap());
    let mut n = 0usize;
    for (xs, ys) in &parts {
        for v in xs {
            fx.write_all(&v.to_le_bytes()).unwrap();
        }
        fy.write_all(ys).unwrap();
        n += ys.len();
    }
    println!("wrote {n} samples x {N_FEATURES} features to {out}");
}
