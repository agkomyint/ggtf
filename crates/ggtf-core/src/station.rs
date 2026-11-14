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
use crate::rng::Rng;
use std::collections::HashMap;

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
    /// A receiver replied that it caught our beam. Reported once per station.
    BeamCaught { id: u16, by: u16 },
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
    /// End of the reply window after a round, while one is open.
    hold_until: Option<f64>,
}

/// A reply waiting for its random delay.
struct PendingReply {
    to: u16,
    id: u16,
    at: f64,
    profile: ProfileId,
    band: Band,
}

pub struct Station {
    pub link: Link,
    pub rx: Vec<Receiver>,
    pub stats: StationStats,
    beam_rx: BeamReceiver,
    beam_tx: Option<BeamTx>,
    beam_counter: u16,
    /// Reply when we catch a beam.
    beam_reply: bool,
    /// Stop our own beam on the first reply.
    beam_stop_on_catch: bool,
    replies_due: Vec<PendingReply>,
    replies_sent: HashMap<(u16, u16), u8>,
    /// Stations that caught our most recent beam (kept after it stops).
    catchers: Option<(u16, Vec<u16>)>,
    rng: Rng,
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
            beam_reply: true,
            beam_stop_on_catch: false,
            replies_due: Vec::new(),
            replies_sent: HashMap::new(),
            catchers: None,
            rng: Rng::new(seed ^ 0xBEA7_5EED),
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
                    self.queue_reply(&frame, profile, band, now);
                } else if frame.ftype == FrameType::BeamReply {
                    self.on_reply(&frame, now);
                } else {
                    self.link.on_frame(&frame, profile, band, now);
                    self.drain_link();
                }
            }
        }
    }

    pub fn tick(&mut self, now: f64) {
        if self.busy() {
            self.link.defer_timers(now);
        }
        self.link.tick(now);
        self.drain_link();
    }

    /// Next audio to play, if any. Holds back while any receiver is mid-frame (carrier sense).
    /// Link frames go first; beam chunks fill the gaps.
    pub fn poll_tx(&mut self, now: f64) -> Option<Vec<f32>> {
        if self.busy() {
            return None;
        }
        let (frame, profile, band) = if let Some(req) = self.link.next_tx() {
            (req.frame, req.profile, req.band)
        } else if let Some(r) = self.next_reply(now) {
            r
        } else {
            self.next_beam_frame(now)?
        };
        let samples = modem::encode_frame(&frame, profile, band);
        self.stats.tx_frames += 1;
        self.events.push(StationEvent::Tx { kind: frame.ftype, profile, band, ms: samples.len() as f64 * 1000.0 / crate::SR as f64 });
        self.drain_link();
        Some(samples)
    }

    fn next_beam_frame(&mut self, now: f64) -> Option<(Frame, ProfileId, Band)> {
        let b = self.beam_tx.as_mut()?;
        if b.next >= b.frames.len() {
            match b.hold_until {
                None => {
                    // A round just ended.
                    b.round += 1;
                    self.events.push(StationEvent::BeamRound { id: b.id, round: b.round, chunks: b.frames.len() as u8 });
                    if b.max_rounds > 0 && b.round >= b.max_rounds {
                        let (id, rounds) = (b.id, b.round);
                        self.beam_tx = None;
                        self.events.push(StationEvent::BeamStopped { id, rounds });
                        return None;
                    }
                    // Stay quiet so receivers that have the whole message can say so.
                    b.hold_until = Some(now + beam::REPLY_WINDOW_MS);
                    return None;
                }
                Some(t) if now < t => return None,
                Some(_) => {
                    b.hold_until = None;
                    b.next = 0;
                }
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
        self.beam_tx = Some(BeamTx { id, frames, profile, band, next: 0, round: 0, max_rounds: rounds, hold_until: None });
        self.catchers = Some((id, Vec::new()));
        Some(id)
    }

    /// Whether this station replies when it catches a beam (on by default).
    pub fn set_beam_reply(&mut self, on: bool) {
        self.beam_reply = on;
        if !on {
            self.replies_due.clear();
        }
    }

    pub fn beam_reply(&self) -> bool {
        self.beam_reply
    }

    /// Whether our beam stops on the first reply (off by default). Applies to a running beam too.
    pub fn set_beam_stop_on_catch(&mut self, on: bool) {
        self.beam_stop_on_catch = on;
    }

    /// Stations that caught our most recent beam.
    pub fn beam_catchers(&self) -> &[u16] {
        self.catchers.as_ref().map(|(_, c)| c.as_slice()).unwrap_or(&[])
    }

    /// Queues a reply when we have the whole beam and just heard the last chunk of a round,
    /// which is when the sender opens its reply window.
    fn queue_reply(&mut self, f: &Frame, profile: ProfileId, band: Band, now: f64) {
        let Some((id, idx, count)) = beam::chunk_info(f) else { return };
        // Any chunk of this beam means the previous window has closed.
        self.replies_due.retain(|r| !(r.to == f.src && r.id == id));
        if !self.beam_reply || idx as usize + 1 != count as usize || !self.beam_rx.is_done(f.src, id) {
            return;
        }
        if self.replies_sent.get(&(f.src, id)).copied().unwrap_or(0) >= beam::MAX_REPLIES {
            return;
        }
        let at = now + self.rng.range(0.0, beam::REPLY_JITTER_MS);
        self.replies_due.push(PendingReply { to: f.src, id, at, profile, band });
    }

    fn next_reply(&mut self, now: f64) -> Option<(Frame, ProfileId, Band)> {
        // Too late once the sender's window has passed; the next round gives another chance.
        self.replies_due.retain(|r| now < r.at + beam::REPLY_WINDOW_MS);
        let i = self.replies_due.iter().position(|r| now >= r.at)?;
        let r = self.replies_due.remove(i);
        if self.replies_sent.len() > 256 {
            self.replies_sent.clear();
        }
        *self.replies_sent.entry((r.to, r.id)).or_insert(0) += 1;
        Some((beam::reply_frame(self.link.id, r.to, r.id), r.profile, r.band))
    }

    fn on_reply(&mut self, f: &Frame, now: f64) {
        if f.dst != self.link.id {
            return;
        }
        let id = beam::reply_beam_id(f);
        let Some((cid, list)) = self.catchers.as_mut() else { return };
        if *cid != id {
            return;
        }
        if !list.contains(&f.src) {
            list.push(f.src);
            self.events.push(StationEvent::BeamCaught { id, by: f.src });
        }
        if !self.beam_tx.as_ref().is_some_and(|b| b.id == id) {
            return;
        }
        if self.beam_stop_on_catch {
            self.beam_stop();
        } else if let Some(t) = self.beam_tx.as_mut().and_then(|b| b.hold_until.as_mut()) {
            // Others may still be waiting to reply.
            *t = t.max(now + beam::REPLY_WINDOW_MS);
        }
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
        self.call_tagged(now, &[]);
    }
    /// Calls with a tag the answerer sees (Séance OS sends the spirit's app id).
    pub fn call_tagged(&mut self, now: f64, tag: &[u8]) {
        self.beam_stop();
        self.link.call_tagged(now, tag);
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
    /// Sends a binary message of `kind` over the connected link.
    pub fn send_msg(&mut self, kind: u8, data: &[u8], _now: f64) -> Option<u32> {
        let r = self.link.send_msg(kind, data);
        self.drain_link();
        r
    }
}
