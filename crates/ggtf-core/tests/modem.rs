use ggtf_core::frame::{Frame, FrameType};
use ggtf_core::modem;
use ggtf_core::profile::{Band, ProfileId};
use ggtf_core::receiver::{Receiver, RxEvent};
use ggtf_core::sim::{self, Channel};

fn decode_all(audio: &[f32]) -> Vec<RxEvent> {
    decode_band(audio, Band::Mid)
}

fn decode_band(audio: &[f32], band: Band) -> Vec<RxEvent> {
    let mut rx = Receiver::new(band);
    let mut ev = Vec::new();
    for chunk in audio.chunks(2048) {
        ev.extend(rx.push(chunk));
    }
    ev
}

fn frames(ev: &[RxEvent]) -> Vec<(Frame, ProfileId)> {
    ev.iter()
        .filter_map(|e| match e {
            RxEvent::Frame { frame, profile, .. } => Some((frame.clone(), *profile)),
            _ => None,
        })
        .collect()
}

fn sample_frame(len: usize) -> Frame {
    let mut f = Frame::new(FrameType::Data, 0x1234, 0x5678, (0..len).map(|i| (i * 7 + 3) as u8).collect());
    f.seq = 42;
    f
}

#[test]
fn clean_roundtrip_every_profile_and_band() {
    for band in Band::ALL {
        for id in ProfileId::ALL {
            for len in [0usize, 1, 17, 80] {
                let f = sample_frame(len);
                let audio = sim::apply(&modem::encode_frame(&f, id, band), &Channel::default());
                let got = frames(&decode_band(&audio, band));
                assert_eq!(got, vec![(f.clone(), id)], "band {:?} profile {:?} len {}", band, id, len);
            }
        }
    }
}

#[test]
fn bands_do_not_hear_each_other() {
    let f = sample_frame(10);
    for tx in Band::ALL {
        let audio = sim::apply(&modem::encode_frame(&f, ProfileId::Specter, tx), &Channel::default());
        for rx in Band::ALL {
            let got = frames(&decode_band(&audio, rx));
            assert_eq!(got.len(), (tx == rx) as usize, "tx {:?} heard on {:?}", tx, rx);
        }
    }
}

#[test]
fn back_to_back_frames() {
    let mut audio = Vec::new();
    for id in ProfileId::ALL {
        audio.extend(modem::encode_frame(&sample_frame(24), id, Band::Mid));
    }
    let audio = sim::apply(&audio, &Channel::default());
    let got = frames(&decode_all(&audio));
    assert_eq!(got.len(), ProfileId::ALL.len());
}

#[test]
fn survives_moderate_noise_and_interruptions() {
    let f = sample_frame(40);
    let audio = modem::encode_frame(&f, ProfileId::Specter, Band::Mid);
    let mut ok = 0;
    for seed in 0..10 {
        let ch = Channel { seed, white_snr_db: Some(0.0), babble_snr_db: Some(10.0), dropouts: 1, dropout_ms: 40.0, ..Default::default() };
        let got = frames(&decode_all(&sim::apply(&audio, &ch)));
        if got.iter().any(|(g, _)| *g == f) {
            ok += 1;
        }
        assert!(got.iter().all(|(g, _)| *g == f), "decoded a wrong frame");
    }
    assert!(ok >= 8, "only {ok}/10 decoded");
}

#[test]
fn silence_and_noise_give_no_frames() {
    use ggtf_core::rng::Rng;
    let n = 48_000 * 20;
    let mut rng = Rng::new(7);
    let (w, b, m, p) = (sim::white(n, &mut rng), sim::babble(n, &mut rng), sim::music(n, &mut rng), sim::beeps(n, &mut rng));
    let mix: Vec<f32> = (0..n).map(|i| 0.05 * w[i] + 0.05 * b[i] + 0.1 * m[i] + 0.2 * p[i]).collect();
    let mut rx = Receiver::new(Band::Mid);
    let mut got = Vec::new();
    for chunk in mix.chunks(2048) {
        got.extend(rx.push(chunk));
    }
    assert!(frames(&got).is_empty());
    let detections = got.iter().filter(|e| matches!(e, RxEvent::Detected { .. })).count();
    assert!(detections <= 2, "{detections} false preamble detections in 20 s");
}
