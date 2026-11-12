//! Two stations talking through simulated air. Both hear their own playback and each other,
//! the way two browser tabs on one laptop do.

use ggtf_core::link::{LinkEvent, LinkState, MsgStatus};
use ggtf_core::rng::Rng;
use ggtf_core::station::{Station, StationEvent};
use ggtf_core::SR;

const CHUNK: usize = 2048;

struct Air {
    a: Station,
    b: Station,
    play_a: Vec<f32>,
    pos_a: usize,
    play_b: Vec<f32>,
    pos_b: usize,
    now: f64,
    rng: Rng,
    noise: f32,
    ev_a: Vec<StationEvent>,
    ev_b: Vec<StationEvent>,
}

impl Air {
    fn new(noise: f32) -> Self {
        let mut a = Station::new(0xA11A, 1);
        let mut b = Station::new(0xB22B, 2);
        b.set_answer(true);
        a.set_answer(false);
        Air { a, b, play_a: vec![], pos_a: 0, play_b: vec![], pos_b: 0, now: 0.0, rng: Rng::new(9), noise, ev_a: vec![], ev_b: vec![] }
    }

    fn step(&mut self) {
        let mut mix = vec![0f32; CHUNK];
        for (play, pos) in [(&self.play_a, &mut self.pos_a), (&self.play_b, &mut self.pos_b)] {
            for (i, m) in mix.iter_mut().enumerate() {
                if let Some(v) = play.get(*pos + i) {
                    *m += *v;
                }
            }
            *pos += CHUNK;
        }
        for m in mix.iter_mut() {
            *m += self.noise * self.rng.gauss() as f32;
        }
        self.now += CHUNK as f64 * 1000.0 / SR as f64;
        let now = self.now;
        self.a.push_samples(&mix, now);
        self.b.push_samples(&mix, now);
        for (st, play, pos) in [(&mut self.a, &mut self.play_a, &mut self.pos_a), (&mut self.b, &mut self.play_b, &mut self.pos_b)] {
            if !play.is_empty() && *pos >= play.len() {
                play.clear();
                *pos = 0;
                st.tx_done(now);
            }
            st.tick(now);
            if play.is_empty() {
                if let Some(s) = st.poll_tx(now) {
                    *play = s;
                    *pos = 0;
                }
            }
        }
        self.ev_a.extend(self.a.take_events());
        self.ev_b.extend(self.b.take_events());
    }

    fn run_until(&mut self, max_ms: f64, mut done: impl FnMut(&Air) -> bool) -> bool {
        let end = self.now + max_ms;
        while self.now < end {
            self.step();
            if done(self) {
                return true;
            }
        }
        false
    }
}

fn received(ev: &[StationEvent]) -> Vec<String> {
    ev.iter()
        .filter_map(|e| match e {
            StationEvent::Link(LinkEvent::MsgReceived { text }) => Some(String::from_utf8_lossy(text).into_owned()),
            _ => None,
        })
        .collect()
}

fn delivered(ev: &[StationEvent]) -> usize {
    ev.iter().filter(|e| matches!(e, StationEvent::Link(LinkEvent::MsgStatus { status: MsgStatus::Delivered, .. }))).count()
}

fn connect(air: &mut Air) {
    let now = air.now;
    air.a.call(now);
    let paired = air.run_until(90_000.0, |s| s.a.link.state() == LinkState::AwaitingConfirm && s.b.link.state() == LinkState::AwaitingConfirm);
    assert!(paired, "no pairing: a={:?} b={:?}", air.a.link.state(), air.b.link.state());
    assert_eq!(air.a.link.sas(), air.b.link.sas(), "SAS words differ");
    let now = air.now;
    air.a.confirm(now);
    air.b.confirm(now);
    let ok = air.run_until(60_000.0, |s| s.a.link.state() == LinkState::Connected && s.b.link.state() == LinkState::Connected);
    assert!(ok, "never connected: a={:?} b={:?}", air.a.link.state(), air.b.link.state());
}

#[test]
fn two_stations_pair_chat_and_hang_up() {
    let mut air = Air::new(0.0);
    connect(&mut air);
    let fast = air.a.link.profile();
    println!("trained profile: {:?}", fast);

    let now = air.now;
    air.a.send_text(b"hello from the other side", now).unwrap();
    let long: String = "boo! ".repeat(30);
    air.a.send_text(long.as_bytes(), now).unwrap();
    assert!(air.run_until(120_000.0, |s| received(&s.ev_b).len() == 2), "messages not received");
    assert_eq!(received(&air.ev_b), vec!["hello from the other side".to_string(), long.clone()]);
    air.run_until(20_000.0, |s| delivered(&s.ev_a) == 2);
    assert_eq!(delivered(&air.ev_a), 2);

    let now = air.now;
    air.b.send_text("reply ✓".as_bytes(), now).unwrap();
    assert!(air.run_until(60_000.0, |s| received(&s.ev_a).len() == 1));

    let now = air.now;
    air.a.hangup(now);
    assert!(air.run_until(60_000.0, |s| s.a.link.state() == LinkState::Idle && s.b.link.state() == LinkState::Idle));
    println!("simulated time: {:.1} s", air.now / 1000.0);
}

#[test]
fn session_survives_background_noise() {
    // Full-band noise sigma 0.05 against a 0.35 rms-ish signal.
    let mut air = Air::new(0.05);
    connect(&mut air);
    let now = air.now;
    air.a.send_text(b"still here in the static", now).unwrap();
    assert!(air.run_until(120_000.0, |s| received(&s.ev_b).len() == 1));
}

#[test]
fn manual_accept_rings_then_connects() {
    let mut air = Air::new(0.0);
    air.b.set_answer(false);
    let now = air.now;
    air.a.call(now);
    let rang = air.run_until(20_000.0, |s| s.ev_b.iter().any(|e| matches!(e, StationEvent::Link(LinkEvent::Incoming { from: 0xA11A }))));
    assert!(rang, "B never saw the incoming call");
    assert_eq!(air.b.link.state(), LinkState::Idle, "B must not answer by itself");
    let now = air.now;
    assert!(air.b.accept(now), "accept failed");
    let paired = air.run_until(90_000.0, |s| s.a.link.state() == LinkState::AwaitingConfirm && s.b.link.state() == LinkState::AwaitingConfirm);
    assert!(paired, "no pairing after accept: a={:?} b={:?}", air.a.link.state(), air.b.link.state());
}
