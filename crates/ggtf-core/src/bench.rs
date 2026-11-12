//! Benchmark: a fixed matrix of simulated rooms, run with fixed seeds.

use crate::frame::{Frame, FrameType};
use crate::modem;
use crate::profile::ProfileId;
use crate::receiver::{Receiver, RxEvent};
use crate::rng::Rng;
use crate::sim::{self, Channel};
use crate::SR;

#[derive(Clone, Debug)]
pub struct Scenario {
    pub key: &'static str,
    pub name: &'static str,
    pub channel: Channel,
}

pub fn scenarios() -> Vec<Scenario> {
    let d = Channel::default;
    vec![
        Scenario { key: "clean", name: "Clean room", channel: d() },
        Scenario { key: "white10", name: "Hiss, 10 dB", channel: Channel { white_snr_db: Some(10.0), ..d() } },
        Scenario { key: "white0", name: "Hiss, 0 dB", channel: Channel { white_snr_db: Some(0.0), ..d() } },
        Scenario { key: "white-6", name: "Hiss, -6 dB", channel: Channel { white_snr_db: Some(-6.0), ..d() } },
        Scenario { key: "talk5", name: "People talking, 5 dB", channel: Channel { babble_snr_db: Some(5.0), white_snr_db: Some(25.0), ..d() } },
        Scenario { key: "talk0", name: "People talking, 0 dB", channel: Channel { babble_snr_db: Some(0.0), white_snr_db: Some(25.0), ..d() } },
        Scenario { key: "music5", name: "Music, 5 dB", channel: Channel { music_snr_db: Some(5.0), white_snr_db: Some(25.0), ..d() } },
        Scenario { key: "music0", name: "Music, 0 dB", channel: Channel { music_snr_db: Some(0.0), white_snr_db: Some(25.0), ..d() } },
        Scenario { key: "beeps", name: "Notification beeps, 5 dB", channel: Channel { beeps_snr_db: Some(5.0), white_snr_db: Some(25.0), ..d() } },
        Scenario { key: "reverb", name: "Echoey room (RT60 300 ms)", channel: Channel { reverb_rt60_ms: Some(300.0), reverb_wet: 0.4, white_snr_db: Some(15.0), ..d() } },
        Scenario { key: "dropouts", name: "Cut-outs (2 x 80 ms)", channel: Channel { dropouts: 2, dropout_ms: 80.0, white_snr_db: Some(15.0), ..d() } },
        Scenario { key: "bursts", name: "Door slams (2 x 100 ms)", channel: Channel { bursts: 2, burst_ms: 100.0, white_snr_db: Some(15.0), ..d() } },
        Scenario { key: "drift", name: "Clock drift 200 ppm", channel: Channel { drift_ppm: 200.0, white_snr_db: Some(15.0), ..d() } },
        Scenario {
            key: "cafe",
            name: "Cafe (talk + music + echo + drift)",
            channel: Channel {
                babble_snr_db: Some(6.0),
                music_snr_db: Some(10.0),
                reverb_rt60_ms: Some(250.0),
                white_snr_db: Some(15.0),
                drift_ppm: 50.0,
                ..d()
            },
        },
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
pub fn sample_audio(sc: &Scenario, id: ProfileId, payload_len: usize, seed: u64) -> Vec<f32> {
    let mut rng = Rng::new(seed);
    let f = test_frame(0, payload_len, &mut rng);
    sim::apply(&modem::encode_frame(&f, id), &Channel { seed, ..sc.channel.clone() })
}

pub fn run(sc: &Scenario, id: ProfileId, frames: u32, payload_len: usize, seed: u64) -> BenchResult {
    let mut r = BenchResult { frames, ..Default::default() };
    let mut rng = Rng::new(seed);
    let mut snr_sum = 0.0;
    for i in 0..frames {
        let f = test_frame(i, payload_len, &mut rng);
        let clean = modem::encode_frame(&f, id);
        r.airtime_s += clean.len() as f64 / SR as f64;
        let audio = sim::apply(&clean, &Channel { seed: seed.wrapping_mul(1000).wrapping_add(i as u64), ..sc.channel.clone() });
        let mut rx = Receiver::new();
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
