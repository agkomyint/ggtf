//! Two stations sharing simulated air: each hears the mix of both speakers plus noise, the
//! way two tabs on one laptop do. Used by tests and by Spirit Studio's "sim air" transport,
//! which runs the real modem faster than real time.

use crate::link::LinkEvent;
use crate::rng::Rng;
use crate::station::{Station, StationEvent};
use crate::SR;

pub const CHUNK: usize = 2048;
pub const ID_A: u16 = 0x5A11;
pub const ID_B: u16 = 0xB0B0;

pub struct Duo {
    pub st: [Station; 2],
    play: [Vec<f32>; 2],
    pos: [usize; 2],
    pub now: f64,
    rng: Rng,
    /// Gaussian noise sigma added to the shared air (signal peaks are about 0.5).
    pub noise: f32,
    /// Probability that a 43 ms chunk of air is lost entirely (a dropout).
    pub loss: f32,
    /// Confirm the SAS words automatically on both sides (nobody is in the middle of a simulation).
    pub auto_confirm: bool,
    /// A gone station neither hears nor plays, like a device that left the room.
    pub gone: [bool; 2],
    events: Vec<(usize, StationEvent)>,
}

impl Duo {
    pub fn new(seed: u64) -> Self {
        let a = Station::new(ID_A, seed.wrapping_mul(31).wrapping_add(1));
        let mut b = Station::new(ID_B, seed.wrapping_mul(37).wrapping_add(2));
        b.set_answer(true);
        Duo {
            st: [a, b],
            play: [Vec::new(), Vec::new()],
            pos: [0, 0],
            now: 0.0,
            rng: Rng::new(seed ^ 0x9E37_79B9),
            noise: 0.0,
            loss: 0.0,
            auto_confirm: true,
            gone: [false, false],
            events: Vec::new(),
        }
    }

    /// A calls B (B auto-answers). With `auto_confirm`, the link connects on its own.
    pub fn connect(&mut self) {
        let now = self.now;
        self.st[0].call(now);
    }

    /// Advances the air by one chunk (about 43 ms).
    pub fn step(&mut self) {
        let mut mix = vec![0f32; CHUNK];
        for s in 0..2 {
            if self.gone[s] {
                continue;
            }
            let (play, pos) = (&self.play[s], self.pos[s]);
            for (i, m) in mix.iter_mut().enumerate() {
                if let Some(v) = play.get(pos + i) {
                    *m += *v;
                }
            }
        }
        for p in self.pos.iter_mut() {
            *p += CHUNK;
        }
        if self.loss > 0.0 && (self.rng.next_f64() as f32) < self.loss {
            mix.iter_mut().for_each(|m| *m = 0.0);
        }
        if self.noise > 0.0 {
            for m in mix.iter_mut() {
                *m += self.noise * self.rng.gauss() as f32;
            }
        }
        self.now += CHUNK as f64 * 1000.0 / SR as f64;
        let now = self.now;
        for s in 0..2 {
            if self.gone[s] {
                continue;
            }
            let st = &mut self.st[s];
            st.push_samples(&mix, now);
            if !self.play[s].is_empty() && self.pos[s] >= self.play[s].len() {
                self.play[s].clear();
                self.pos[s] = 0;
                st.tx_done(now);
            }
            st.tick(now);
            if self.play[s].is_empty() {
                if let Some(samples) = st.poll_tx(now) {
                    self.play[s] = samples;
                    self.pos[s] = 0;
                }
            }
            for e in st.take_events() {
                if self.auto_confirm && matches!(e, StationEvent::Link(LinkEvent::Sas { .. })) {
                    st.confirm(now);
                }
                self.events.push((s, e));
            }
        }
    }

    /// Runs for `ms` of simulated time.
    pub fn run_for(&mut self, ms: f64) {
        let end = self.now + ms;
        while self.now < end {
            self.step();
        }
    }

    /// Runs until `done` returns true or `max_ms` passes. Returns whether `done` became true.
    pub fn run_until(&mut self, max_ms: f64, mut done: impl FnMut(&Duo) -> bool) -> bool {
        let end = self.now + max_ms;
        while self.now < end {
            self.step();
            if done(self) {
                return true;
            }
        }
        false
    }

    /// Events since the last call, tagged with the station index (0 = A, 1 = B).
    pub fn take_events(&mut self) -> Vec<(usize, StationEvent)> {
        std::mem::take(&mut self.events)
    }

    /// Events not yet taken, without removing them.
    pub fn events(&self) -> &[(usize, StationEvent)] {
        &self.events
    }
}
