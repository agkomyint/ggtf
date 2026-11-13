//! Benchmark: a fixed matrix of simulated rooms, run with fixed seeds, for any band and decoder.

use crate::frame::{Frame, FrameType};
use crate::ml::Decoder;
use crate::modem;
use crate::profile::{Band, ProfileId};
use crate::receiver::{Receiver, RxEvent};
use crate::rng::Rng;
use crate::sim::{self, Channel};
use crate::SR;

#[derive(Clone, Debug)]
pub struct Scenario {
    pub key: &'static str,
    pub name: &'static str,
    /// "easy", "hard" or "brutal", for grouping in reports.
    pub tier: &'static str,
    pub channel: Channel,
}

pub fn scenarios() -> Vec<Scenario> {
    let d = Channel::default;
    let s = |key, name, tier, channel| Scenario { key, name, tier, channel };
    vec![
        s("clean", "Clean room", "easy", d()),
        s("white10", "Hiss, 10 dB", "easy", Channel { white_snr_db: Some(10.0), ..d() }),
        s("white0", "Hiss, 0 dB", "easy", Channel { white_snr_db: Some(0.0), ..d() }),
        s("talk5", "People talking, 5 dB", "easy", Channel { babble_snr_db: Some(5.0), white_snr_db: Some(25.0), ..d() }),
        s("music5", "Music, 5 dB", "easy", Channel { music_snr_db: Some(5.0), white_snr_db: Some(25.0), ..d() }),
        s("reverb", "Echoey room (RT60 300 ms)", "easy", Channel { reverb_rt60_ms: Some(300.0), reverb_wet: 0.4, white_snr_db: Some(15.0), ..d() }),
        s("dropouts", "Cut-outs (2 × 80 ms)", "easy", Channel { dropouts: 2, dropout_ms: 80.0, white_snr_db: Some(15.0), ..d() }),
        s("drift", "Clock drift 200 ppm", "easy", Channel { drift_ppm: 200.0, white_snr_db: Some(15.0), ..d() }),
        s("white-6", "Hiss, -6 dB", "hard", Channel { white_snr_db: Some(-6.0), ..d() }),
        s("white-10", "Hiss, -10 dB", "hard", Channel { white_snr_db: Some(-10.0), ..d() }),
        s("talk-5", "Loud talking, -5 dB", "hard", Channel { babble_snr_db: Some(-5.0), white_snr_db: Some(20.0), ..d() }),
        s("music-5", "Loud music, -5 dB", "hard", Channel { music_snr_db: Some(-5.0), white_snr_db: Some(20.0), ..d() }),
        s("beeps5", "Notification beeps, 5 dB", "hard", Channel { beeps_snr_db: Some(5.0), white_snr_db: Some(25.0), ..d() }),
        s("hall", "Big hall (RT60 800 ms)", "hard", Channel { reverb_rt60_ms: Some(800.0), reverb_wet: 0.7, white_snr_db: Some(12.0), ..d() }),
        s("bursts", "Door slams (3 × 120 ms)", "hard", Channel { bursts: 3, burst_ms: 120.0, white_snr_db: Some(12.0), ..d() }),
        s("phone", "Phone speaker (300 Hz–7 kHz)", "hard", Channel { highpass_hz: Some(300.0), lowpass_hz: Some(7000.0), white_snr_db: Some(8.0), ..d() }),
        s("rolloff", "Mic roll-off above 15 kHz", "hard", Channel { lowpass_hz: Some(15000.0), white_snr_db: Some(8.0), ..d() }),
        s(
            "cafe",
            "Café (talk + music + echo + drift)",
            "hard",
            Channel { babble_snr_db: Some(3.0), music_snr_db: Some(8.0), reverb_rt60_ms: Some(300.0), white_snr_db: Some(12.0), drift_ppm: 80.0, ..d() },
        ),
        s("white-14", "Hiss, -14 dB", "brutal", Channel { white_snr_db: Some(-14.0), ..d() }),
        s("beeps0", "Beeps, 0 dB", "brutal", Channel { beeps_snr_db: Some(0.0), white_snr_db: Some(20.0), ..d() }),
        s(
            "chaos",
            "Everything (café + beeps + cut-outs)",
            "brutal",
            Channel {
                babble_snr_db: Some(2.0),
                music_snr_db: Some(6.0),
                beeps_snr_db: Some(8.0),
                reverb_rt60_ms: Some(400.0),
                white_snr_db: Some(6.0),
                drift_ppm: 100.0,
                dropouts: 2,
                dropout_ms: 60.0,
                ..d()
            },
        ),
    ]
}

#[derive(Clone, Debug, Default)]
pub struct BenchResult {
    pub frames: u32,
    pub ok: u32,
    pub missed: u32,
    pub marker_fail: u32,
    pub header_fail: u32,
    pub payload_fail: u32,
    pub corrupted: u32,
    pub mean_snr_db: f32,
    pub airtime_s: f64,
    pub goodput_bps: f64,
}

impl BenchResult {
    pub fn success_rate(&self) -> f64 {
        if self.frames == 0 {
            0.0
        } else {
            self.ok as f64 / self.frames as f64
        }
    }
}

pub fn test_frame(i: u32, payload_len: usize, rng: &mut Rng) -> Frame {
    let mut f = Frame::new(FrameType::Data, 0x6767, 0x7474, rng.bytes(payload_len));
    f.seq = i as u8;
    f
}

/// Degraded audio for one test frame, so people can hear what the receiver hears.
pub fn sample_audio(sc: &Scenario, id: ProfileId, band: Band, payload_len: usize, seed: u64) -> Vec<f32> {
    let mut rng = Rng::new(seed);
    let f = test_frame(0, payload_len, &mut rng);
    sim::apply(&modem::encode_frame(&f, id, band), &Channel { seed, ..sc.channel.clone() })
}

#[allow(clippy::too_many_arguments)]
pub fn run(sc: &Scenario, id: ProfileId, band: Band, decoder: Decoder, frames: u32, payload_len: usize, seed: u64) -> BenchResult {
    let mut r = BenchResult { frames, ..Default::default() };
    let mut rng = Rng::new(seed);
    let mut snr_sum = 0.0;
    for i in 0..frames {
        let f = test_frame(i, payload_len, &mut rng);
        let clean = modem::encode_frame(&f, id, band);
        r.airtime_s += clean.len() as f64 / SR as f64;
        let audio = sim::apply(&clean, &Channel { seed: seed.wrapping_mul(1000).wrapping_add(i as u64), ..sc.channel.clone() });
        let mut rx = Receiver::new(band);
        rx.decoder = decoder;
        let mut ev = Vec::new();
        for c in audio.chunks(2048) {
            ev.extend(rx.push(c));
        }
        let mut got_ok = false;
        let mut got_bad = false;
        for e in &ev {
            if let RxEvent::Frame { frame, snr_db, .. } = e {
                if *frame == f {
                    got_ok = true;
                    snr_sum += *snr_db as f64;
                } else {
                    got_bad = true;
                }
            }
        }
        if got_ok {
            r.ok += 1;
        } else if got_bad {
            r.corrupted += 1;
        } else if rx.stats.payload_fail > 0 {
            r.payload_fail += 1;
        } else if rx.stats.header_fail > 0 {
            r.header_fail += 1;
        } else if rx.stats.marker_fail > 0 {
            r.marker_fail += 1;
        } else {
            r.missed += 1;
        }
    }
    r.mean_snr_db = if r.ok > 0 { (snr_sum / r.ok as f64) as f32 } else { 0.0 };
    r.goodput_bps = if r.airtime_s > 0.0 { (r.ok as f64 * payload_len as f64 * 8.0) / r.airtime_s } else { 0.0 };
    r
}
