//! A station ties the receivers, the link state machine, beam mode and the modem together.
//! The host (browser worker, test harness) feeds it microphone samples and plays what it returns.
//!
//! One receiver runs per band, so a station hears low, mid and high transmissions at the same time.

use crate::beam::{self, BeamEvent, BeamReceiver};
use crate::frame::{Frame, FrameType};
use crate::link::{Link, LinkEvent};
use crate::ml::Decoder;
use crate::modem;
use crate::profile::{Band, ProfileId};
use crate::receiver::{Receiver, RxEvent, RxStats};

#[derive(Clone, Debug)]
pub enum StationEvent {
    Link(LinkEvent),
    Detected { score: f32, band: Band },
    RxFrame { kind: FrameType, profile: ProfileId, band: Band, snr_db: f32, from: u16, own: bool },
    RxFailed { stage: &'static str, band: Band },
    Tx { kind: FrameType, profile: ProfileId, band: Band, ms: f64 },
    Beam(BeamEvent),
    BeamRound { id: u16, round: u32, chunks: u8 },
    BeamStopped { id: u16, rounds: u32 },
}

#[derive(Clone, Debug, Default)]
pub struct StationStats {
    pub tx_frames: u32,
    pub rx_frames: u32,
    pub own_frames: u32,
}

struct BeamTx {
    id: u16,
    frames: Vec<Frame>,
    profile: ProfileId,
    band: Band,
    next: usize,
    round: u32,
    max_rounds: u32,
}

pub struct Station {
    pub link: Link,
    pub rx: Vec<Receiver>,
    pub stats: StationStats,
    beam_rx: BeamReceiver,
    beam_tx: Option<BeamTx>,
    beam_counter: u16,
    events: Vec<StationEvent>,
}

impl Station {
    pub fn new(id: u16, seed: u64) -> Self {
        Station {
            link: Link::new(id, seed),
            rx: Band::ALL.iter().map(|&b| Receiver::new(b)).collect(),
            stats: StationStats::default(),
            beam_rx: BeamReceiver::default(),
            beam_tx: None,
            beam_counter: (seed as u16) ^ id,
            events: Vec::new(),
        }
    }

    pub fn id(&self) -> u16 {
        self.link.id
    }

    pub fn busy(&self) -> bool {
        self.rx.iter().any(|r| r.busy())
    }

    /// Combined receiver statistics over all bands.
    pub fn rx_stats(&self) -> RxStats {
        let mut s = RxStats::default();
        for r in &self.rx {
            s.detections += r.stats.detections;
            s.frames += r.stats.frames;
            s.marker_fail += r.stats.marker_fail;
            s.header_fail += r.stats.header_fail;
            s.payload_fail += r.stats.payload_fail;
            if r.stats.frames > 0 {
                s.last_snr_db = r.stats.last_snr_db;
            }
            s.last_score = s.last_score.max(r.stats.last_score);
        }
        s
    }

    /// Switches every receiver between the classic and the ML symbol decoder.
    pub fn set_decoder(&mut self, d: Decoder) {
        for r in self.rx.iter_mut() {
            r.decoder = d;
        }
    }

    pub fn decoder(&self) -> Decoder {
        self.rx[0].decoder
    }

    pub fn set_band(&mut self, b: Band) {
        self.link.set_band(b);
    }

    fn drain_link(&mut self) {
        for e in self.link.take_events() {
            self.events.push(StationEvent::Link(e));
        }
    }

    pub fn push_samples(&mut self, samples: &[f32], now: f64) {
        let mut all = Vec::new();
        for r in self.rx.iter_mut() {
            let band = r.band;
            all.extend(r.push(samples).into_iter().map(|e| (band, e)));
        }
        for (band, ev) in all {
            self.handle(band, ev, now);
        }
        self.drain_link();
    }

    fn handle(&mut self, band: Band, ev: RxEvent, now: f64) {
        match ev {
            RxEvent::Detected { score, .. } => self.events.push(StationEvent::Detected { score, band }),
            RxEvent::Failed { stage, .. } => self.events.push(StationEvent::RxFailed { stage, band }),
            RxEvent::Frame { frame, profile, snr_db, .. } => {
                let own = frame.src == self.link.id;
                if own {
                    self.stats.own_frames += 1;
                } else {
                    self.stats.rx_frames += 1;
                }
                self.events.push(StationEvent::RxFrame { kind: frame.ftype, profile, band, snr_db, from: frame.src, own });
                if own {
                    return;
                }
                if frame.ftype == FrameType::Beam {
                    if let Some(e) = self.beam_rx.on_frame(&frame, now) {
                        self.events.push(StationEvent::Beam(e));
                    }
                } else {
                    self.link.on_frame(&frame, profile, band, now);
                    self.drain_link();
                }
            }
        }
    }

    pub fn tick(&mut self, now: f64) {
        self.link.tick(now);
        self.drain_link();
    }

    /// Next audio to play, if any. Holds back while any receiver is mid-frame (carrier sense).
    /// Link frames go first; beam chunks fill the gaps.
    pub fn poll_tx(&mut self, _now: f64) -> Option<Vec<f32>> {
        if self.busy() {
            return None;
        }
        let (frame, profile, band) = if let Some(req) = self.link.next_tx() {
            (req.frame, req.profile, req.band)
        } else {
            self.next_beam_frame()?
        };
        let samples = modem::encode_frame(&frame, profile, band);
        self.stats.tx_frames += 1;
        self.events.push(StationEvent::Tx { kind: frame.ftype, profile, band, ms: samples.len() as f64 * 1000.0 / crate::SR as f64 });
        self.drain_link();
        Some(samples)
    }

    fn next_beam_frame(&mut self) -> Option<(Frame, ProfileId, Band)> {
        let b = self.beam_tx.as_mut()?;
        if b.next >= b.frames.len() {
            b.next = 0;
            b.round += 1;
            self.events.push(StationEvent::BeamRound { id: b.id, round: b.round, chunks: b.frames.len() as u8 });
            if b.max_rounds > 0 && b.round >= b.max_rounds {
                let (id, rounds) = (b.id, b.round);
                self.beam_tx = None;
                self.events.push(StationEvent::BeamStopped { id, rounds });
                return None;
            }
        }
        let b = self.beam_tx.as_mut()?;
        let f = b.frames[b.next].clone();
        b.next += 1;
        Some((f, b.profile, b.band))
    }

    pub fn tx_done(&mut self, now: f64) {
        self.link.tx_done(now);
        self.drain_link();
    }

    pub fn take_events(&mut self) -> Vec<StationEvent> {
        self.drain_link();
        std::mem::take(&mut self.events)
    }

    // ---------- beam mode ----------

    /// Starts broadcasting `msg` in a carousel. `rounds == 0` repeats until `beam_stop`.
    /// Returns the beam id, or None if the message is empty or too long.
    pub fn beam_start(&mut self, msg: &[u8], profile: ProfileId, band: Band, rounds: u32) -> Option<u16> {
        self.beam_start_chunked(msg, profile, band, rounds, beam::CHUNK)
    }

    /// Like `beam_start`, with a chosen chunk size (bigger chunks: less overhead, more to lose per error).
    pub fn beam_start_chunked(&mut self, msg: &[u8], profile: ProfileId, band: Band, rounds: u32, chunk: usize) -> Option<u16> {
        if msg.is_empty() || msg.len() > beam::MAX_MESSAGE {
            return None;
        }
        self.beam_counter = self.beam_counter.wrapping_add(0x3D29);
        let id = self.beam_counter;
        let frames = beam::chunk_frames(self.link.id, id, msg, chunk);
        if frames.len() > 255 {
            return None;
        }
        self.beam_tx = Some(BeamTx { id, frames, profile, band, next: 0, round: 0, max_rounds: rounds });
        Some(id)
    }

    pub fn beam_stop(&mut self) {
        if let Some(b) = self.beam_tx.take() {
            self.events.push(StationEvent::BeamStopped { id: b.id, rounds: b.round });
        }
    }

    pub fn beaming(&self) -> bool {
        self.beam_tx.is_some()
    }

    // ---------- link actions ----------

    pub fn call(&mut self, now: f64) {
        self.beam_stop();
        self.link.call(now);
        self.drain_link();
    }
    pub fn set_answer(&mut self, on: bool) {
        self.link.set_answer(on);
    }
    pub fn accept(&mut self, now: f64) -> bool {
        self.beam_stop();
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
