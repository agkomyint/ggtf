//! Haunted QR catch replies: receivers tell the sender they caught a beam (Requirement 12).
//! Several stations share simulated air; each hears the mix of every speaker, its own included.

use ggtf_core::frame::FrameType;
use ggtf_core::profile::{Band, ProfileId};
use ggtf_core::rng::Rng;
use ggtf_core::station::{Station, StationEvent};
use ggtf_core::SR;

const CHUNK: usize = 2048;
const SENDER: u16 = 0x5E4D;

struct Air {
    st: Vec<Station>,
    play: Vec<(Vec<f32>, usize)>,
    ev: Vec<Vec<StationEvent>>,
    now: f64,
    rng: Rng,
    noise: f32,
}

impl Air {
    /// Station 0 is the sender; the rest are receivers.
    fn new(receivers: usize, noise: f32) -> Self {
        let mut st = vec![Station::new(SENDER, 11)];
        for i in 0..receivers {
            st.push(Station::new(0xC000 + i as u16, 100 + i as u64));
        }
        let n = st.len();
        Air { st, play: vec![(Vec::new(), 0); n], ev: vec![Vec::new(); n], now: 0.0, rng: Rng::new(5), noise }
    }

    fn step(&mut self) {
        let mut mix = vec![0f32; CHUNK];
        for (p, pos) in &self.play {
            for (i, m) in mix.iter_mut().enumerate() {
                if let Some(v) = p.get(pos + i) {
                    *m += *v;
                }
            }
        }
        if self.noise > 0.0 {
            for m in mix.iter_mut() {
                *m += self.noise * self.rng.gauss() as f32;
            }
        }
        self.now += CHUNK as f64 * 1000.0 / SR as f64;
        let now = self.now;
        for (i, s) in self.st.iter_mut().enumerate() {
            s.push_samples(&mix, now);
            let (p, pos) = &mut self.play[i];
            *pos += CHUNK;
            if !p.is_empty() && *pos >= p.len() {
                p.clear();
                *pos = 0;
                s.tx_done(now);
            }
            s.tick(now);
            if p.is_empty() {
                if let Some(x) = s.poll_tx(now) {
                    *p = x;
                    *pos = 0;
                }
            }
            self.ev[i].extend(s.take_events());
        }
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

    fn caught_by(&self) -> Vec<u16> {
        self.ev[0].iter().filter_map(|e| if let StationEvent::BeamCaught { by, .. } = e { Some(*by) } else { None }).collect()
    }

    fn stopped(&self) -> bool {
        self.ev[0].iter().any(|e| matches!(e, StationEvent::BeamStopped { .. }))
    }

    fn received(&self, i: usize) -> bool {
        self.ev[i].iter().any(|e| matches!(e, StationEvent::Beam(ggtf_core::beam::BeamEvent::Complete { .. })))
    }

    fn replies_sent(&self, i: usize) -> usize {
        self.ev[i].iter().filter(|e| matches!(e, StationEvent::Tx { kind: FrameType::BeamReply, .. })).count()
    }
}

const MSG: &[u8] = b"WIFI:T:WPA;S:Haunted House;P:boo-12345;;";

#[test]
fn stop_on_catch_ends_the_beam_after_the_first_reply() {
    let mut air = Air::new(1, 0.01);
    air.st[0].set_beam_stop_on_catch(true);
    air.st[0].beam_start(MSG, ProfileId::Banshee, Band::Mid, 0).unwrap();
    assert!(air.run_until(30_000.0, |a| a.stopped()), "beam never stopped on its own");
    // One chunk plus the reply: the first round's window is enough.
    assert!(air.now < 6_000.0, "took {:.0} ms", air.now);
    assert!(air.received(1));
    assert_eq!(air.caught_by(), vec![0xC000]);
    assert_eq!(air.st[0].beam_catchers(), &[0xC000]);
    assert!(!air.st[0].beaming());
}

#[test]
fn keep_beaming_counts_each_catcher_once() {
    let mut air = Air::new(2, 0.01);
    air.st[0].beam_start(MSG, ProfileId::Banshee, Band::Mid, 0).unwrap();
    // Two receivers may collide; later rounds give them another chance.
    assert!(air.run_until(60_000.0, |a| a.caught_by().len() == 2), "caught by {:x?}", air.caught_by());
    // Keep going: no duplicate catch events, at most 3 replies each, beam still running.
    air.run_until(30_000.0, |_| false);
    let mut by = air.caught_by();
    by.sort();
    assert_eq!(by, vec![0xC000, 0xC001]);
    assert!(air.st[0].beaming());
    for i in 1..=2 {
        assert!(air.replies_sent(i) <= 3, "station {i} sent {} replies", air.replies_sent(i));
    }
}

#[test]
fn replies_off_keeps_the_receiver_silent() {
    let mut air = Air::new(1, 0.01);
    air.st[1].set_beam_reply(false);
    air.st[0].set_beam_stop_on_catch(true);
    air.st[0].beam_start(MSG, ProfileId::Banshee, Band::Mid, 0).unwrap();
    assert!(air.run_until(30_000.0, |a| a.received(1)));
    air.run_until(15_000.0, |_| false);
    assert_eq!(air.replies_sent(1), 0);
    assert!(air.caught_by().is_empty());
    assert!(air.st[0].beaming());
}

#[test]
fn a_reply_to_the_final_round_still_counts() {
    // One round only: no window follows it, but the sender keeps listening after the beam ends.
    let mut air = Air::new(1, 0.0);
    air.st[0].beam_start(b"https://example.com", ProfileId::Banshee, Band::Mid, 1).unwrap();
    assert!(air.run_until(20_000.0, |a| !a.caught_by().is_empty()), "no reply counted");
    assert!(air.stopped());
}
