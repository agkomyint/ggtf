//! Property-based tests for the correctness properties in design.md.

use ggtf_core::crypto::{self, KeyPair};
use ggtf_core::frame::{Frame, FrameType};
use ggtf_core::modem;
use ggtf_core::profile::ProfileId;
use ggtf_core::receiver::{Receiver, RxEvent};
use ggtf_core::sim::{self, Channel};
use proptest::prelude::*;

fn decode(audio: &[f32]) -> Vec<Frame> {
    let mut rx = Receiver::new();
    let mut out = Vec::new();
    for c in audio.chunks(2048) {
        for e in rx.push(c) {
            if let RxEvent::Frame { frame, .. } = e {
                out.push(frame);
            }
        }
    }
    out
}

fn profile() -> impl Strategy<Value = ProfileId> {
    prop_oneof![Just(ProfileId::Wraith), Just(ProfileId::Specter), Just(ProfileId::Banshee)]
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(24))]

    /// Property 1: round trip on a clean channel.
    #[test]
    fn roundtrip(payload in prop::collection::vec(any::<u8>(), 1..=64), id in profile(), src in 0u16..0xFFFF, seq: u8) {
        let mut f = Frame::new(FrameType::Data, src, 0x0101, payload);
        f.seq = seq;
        let got = decode(&sim::apply(&modem::encode_frame(&f, id), &Channel::default()));
        prop_assert_eq!(got, vec![f]);
    }

    /// Property 3: no silent corruption. Whatever the damage, we get the frame or nothing.
    #[test]
    fn no_silent_corruption(payload in prop::collection::vec(any::<u8>(), 1..=64), id in profile(), seed: u64,
                            snr in -12.0f32..6.0, dropouts in 0u32..4) {
        let f = Frame::new(FrameType::Data, 7, 9, payload);
        let ch = Channel { seed, white_snr_db: Some(snr), dropouts, dropout_ms: 80.0, ..Default::default() };
        for g in decode(&sim::apply(&modem::encode_frame(&f, id), &ch)) {
            prop_assert_eq!(&g, &f);
        }
    }

    /// Property 5: the simulator is deterministic.
    #[test]
    fn simulator_deterministic(seed: u64, snr in -5.0f32..20.0) {
        let s = modem::encode_frame(&Frame::new(FrameType::Ack, 1, 2, vec![1, 2, 3]), ProfileId::Banshee);
        let ch = Channel { seed, white_snr_db: Some(snr), babble_snr_db: Some(snr), reverb_rt60_ms: Some(200.0), drift_ppm: 80.0, dropouts: 1, ..Default::default() };
        prop_assert_eq!(sim::apply(&s, &ch), sim::apply(&s, &ch));
    }

    /// Property 9: flipping any ciphertext bit makes the frame fail authentication.
    #[test]
    fn tamper_detected(pt in prop::collection::vec(any::<u8>(), 0..80), counter: u64, bit in 0usize..(96 * 8)) {
        let a = KeyPair::generate();
        let b = KeyPair::generate();
        let ka = crypto::derive(&a, &b.public, true).unwrap();
        let kb = crypto::derive(&b, &a.public, false).unwrap();
        let mut ct = crypto::seal(&ka.tx, 0, counter, b"aad", &pt);
        let bit = bit % (ct.len() * 8);
        ct[bit / 8] ^= 1 << (bit % 8);
        prop_assert!(crypto::open(&kb.rx, 0, counter, b"aad", &ct).is_none());
    }

    /// Property 10: both sides always derive the same keys and words.
    #[test]
    fn key_agreement(sa: [u8; 32], sb: [u8; 32]) {
        let a = KeyPair::from_bytes(sa);
        let b = KeyPair::from_bytes(sb);
        if let (Some(ka), Some(kb)) = (crypto::derive(&a, &b.public, true), crypto::derive(&b, &a.public, false)) {
            prop_assert_eq!(ka.tx, kb.rx);
            prop_assert_eq!(ka.rx, kb.tx);
            prop_assert_eq!(crypto::sas_words(ka.sas), crypto::sas_words(kb.sas));
        }
    }
}
