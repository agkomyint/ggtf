//! A station ties the receiver, the link state machine and the modem together.
//! The host (browser worker, test harness) feeds it microphone samples and plays what it returns.

use crate::frame::FrameType;
use crate::link::{Link, LinkEvent};
use crate::modem;
use crate::profile::ProfileId;
use crate::receiver::{Receiver, RxEvent};

#[derive(Clone, Debug)]
pub enum StationEvent {
    Link(LinkEvent),
    Detected { score: f32 },
    RxFrame { kind: FrameType, profile: ProfileId, snr_db: f32, from: u16, own: bool },
    RxFailed { stage: &'static str },
    Tx { kind: FrameType, profile: ProfileId, ms: f64 },
}

#[derive(Clone, Debug, Default)]
pub struct StationStats {
    pub tx_frames: u32,
    pub rx_frames: u32,
    pub own_frames: u32,
}

pub struct Station {
    pub link: Link,
    pub rx: Receiver,
    pub stats: StationStats,
    events: Vec<StationEvent>,
}

impl Station {
    pub fn new(id: u16, seed: u64) -> Self {
        Station { link: Link::new(id, seed), rx: Receiver::new(), stats: StationStats::default(), events: Vec::new() }
    }

    pub fn id(&self) -> u16 {
        self.link.id
    }

    fn drain_link(&mut self) {
        for e in self.link.take_events() {
            self.events.push(StationEvent::Link(e));
        }
    }

    pub fn push_samples(&mut self, samples: &[f32], now: f64) {
        for ev in self.rx.push(samples) {
            match ev {
                RxEvent::Detected { score, .. } => self.events.push(StationEvent::Detected { score }),
                RxEvent::Failed { stage, .. } => self.events.push(StationEvent::RxFailed { stage }),
                RxEvent::Frame { frame, profile, snr_db, .. } => {
                    let own = frame.src == self.link.id;
                    if own {
                        self.stats.own_frames += 1;
                    } else {
                        self.stats.rx_frames += 1;
                    }
                    self.events.push(StationEvent::RxFrame { kind: frame.ftype, profile, snr_db, from: frame.src, own });
                    if !own {
                        self.link.on_frame(&frame, profile, now);
                        self.drain_link();
                    }
                }
            }
        }
        self.drain_link();
    }

    pub fn tick(&mut self, now: f64) {
        self.link.tick(now);
        self.drain_link();
    }

    /// Next audio to play, if any. Holds back while the receiver is mid-frame (carrier sense).
    pub fn poll_tx(&mut self, _now: f64) -> Option<Vec<f32>> {
        if self.rx.busy() {
            return None;
        }
        let req = self.link.next_tx()?;
        let samples = modem::encode_frame(&req.frame, req.profile);
        self.stats.tx_frames += 1;
        self.events.push(StationEvent::Tx {
            kind: req.frame.ftype,
            profile: req.profile,
            ms: samples.len() as f64 * 1000.0 / crate::SR as f64,
        });
        self.drain_link();
        Some(samples)
    }

    pub fn tx_done(&mut self, now: f64) {
        self.link.tx_done(now);
        self.drain_link();
    }

    pub fn take_events(&mut self) -> Vec<StationEvent> {
        self.drain_link();
        std::mem::take(&mut self.events)
    }

    // user actions
    pub fn call(&mut self, now: f64) {
        self.link.call(now);
        self.drain_link();
    }
    pub fn set_answer(&mut self, on: bool) {
        self.link.set_answer(on);
    }
    pub fn accept(&mut self, now: f64) -> bool {
        let r = self.link.accept(now);
        self.drain_link();
        r
    }
    pub fn decline(&mut self) {
        self.link.decline();
        self.drain_link();
    }
    pub fn confirm(&mut self, now: f64) {
        self.link.confirm(now);
        self.drain_link();
    }
    pub fn reject(&mut self, now: f64) {
        self.link.reject(now);
        self.drain_link();
    }
    pub fn hangup(&mut self, now: f64) {
        self.link.hangup(now);
        self.drain_link();
    }
    pub fn send_text(&mut self, text: &[u8], _now: f64) -> Option<u32> {
        let r = self.link.send_text(text);
        self.drain_link();
        r
    }
}
