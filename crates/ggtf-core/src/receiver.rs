//! Streaming receiver: feed it microphone samples, it finds preambles and decodes frames.

use crate::dsp::{BandPass, Correlator};
use crate::frame::{self, Frame, Header, HEADER_CW_LEN};
use crate::ml::Decoder;
use crate::modem;
use crate::profile::{Band, ProfileId};
use crate::SR;

pub const CORR_NFFT: usize = 8192;
pub const DEFAULT_THRESHOLD: f32 = 0.22;
/// How far around a correlation peak we look for a stronger one before locking.
const PEAK_GUARD: usize = 480;

#[derive(Clone, Debug)]
pub enum RxEvent {
    Detected { at: u64, score: f32 },
    Frame { frame: Frame, profile: ProfileId, band: Band, snr_db: f32, score: f32, at: u64 },
    Failed { stage: &'static str, at: u64 },
}

#[derive(Clone, Debug, Default)]
pub struct RxStats {
    pub detections: u32,
    pub frames: u32,
    pub marker_fail: u32,
    pub header_fail: u32,
    pub payload_fail: u32,
    pub last_snr_db: f32,
    pub last_score: f32,
}

#[derive(Clone, Copy, Debug)]
enum State {
    Search,
    Marker { at: u64, score: f32 },
    Header { at: u64, id: ProfileId, score: f32 },
    Payload { at: u64, id: ProfileId, header: Header, snr_db: f32, score: f32 },
}

pub struct Receiver {
    pub band: Band,
    filter: BandPass,
    corr: Correlator,
    buf: Vec<f32>,
    /// Absolute sample index of `buf[0]`.
    base: u64,
    search_pos: u64,
    state: State,
    pub threshold: f32,
    pub stats: RxStats,
    pub decoder: Decoder,
}

impl Default for Receiver {
    fn default() -> Self {
        Self::new(Band::Mid)
    }
}

impl Receiver {
    pub fn new(band: Band) -> Self {
        let (lo, hi) = band.filter();
        Receiver {
            band,
            filter: BandPass::new(lo, hi, SR),
            corr: Correlator::new(&modem::preamble(band), CORR_NFFT),
            buf: Vec::new(),
            base: 0,
            search_pos: 0,
            state: State::Search,
            threshold: DEFAULT_THRESHOLD,
            stats: RxStats::default(),
            decoder: Decoder::Classic,
        }
    }

    /// True while the receiver is in the middle of a frame (used for carrier sense).
    pub fn busy(&self) -> bool {
        !matches!(self.state, State::Search)
    }

    pub fn push(&mut self, samples: &[f32]) -> Vec<RxEvent> {
        self.buf.reserve(samples.len());
        for &v in samples {
            let y = self.filter.process(v);
            self.buf.push(y);
        }
        let mut events = Vec::new();
        while self.step(&mut events) {}
        self.trim();
        events
    }

    fn slice(&self, from: u64, len: usize) -> Option<&[f32]> {
        if from < self.base {
            return None;
        }
        let s = (from - self.base) as usize;
        self.buf.get(s..s + len)
    }

    fn fail(&mut self, stage: &'static str, at: u64, events: &mut Vec<RxEvent>) {
        match stage {
            "marker" => self.stats.marker_fail += 1,
            "header" => self.stats.header_fail += 1,
            _ => self.stats.payload_fail += 1,
        }
        events.push(RxEvent::Failed { stage, at });
        self.search_pos = at;
        self.state = State::Search;
    }

    /// Advances one stage. Returns false when more samples are needed.
    fn step(&mut self, events: &mut Vec<RxEvent>) -> bool {
        match self.state {
            State::Search => {
                let Some(x) = self.slice(self.search_pos, self.corr.nfft()) else { return false };
                let c = self.corr.correlate(x);
                let (k, best) = c
                    .iter()
                    .enumerate()
                    .fold((0usize, f32::MIN), |acc, (i, &v)| if v > acc.1 { (i, v) } else { acc });
                if best >= self.threshold {
                    // Peak near the end of the block: re-centre so a stronger peak just past it isn't missed.
                    if k + PEAK_GUARD >= c.len() && k > PEAK_GUARD {
                        self.search_pos += (k - PEAK_GUARD) as u64;
                        return true;
                    }
                    let at = self.search_pos + k as u64;
                    self.stats.detections += 1;
                    self.stats.last_score = best;
                    events.push(RxEvent::Detected { at, score: best });
                    self.state = State::Marker { at: at + modem::marker_offset() as u64, score: best };
                } else {
                    self.search_pos += c.len() as u64;
                }
                true
            }
            State::Marker { at, score } => {
                let Some(x) = self.slice(at, modem::marker_len()) else { return false };
                match modem::decode_marker(x, self.band) {
                    Some(id) => self.state = State::Header { at: at + modem::marker_len() as u64, id, score },
                    None => self.fail("marker", at, events),
                }
                true
            }
            State::Header { at, id, score } => {
                let p = id.profile();
                let len = modem::header_samples(p);
                let Some(x) = self.slice(at, len) else { return false };
                let (soft, hdr) = self.try_decoders(|d| {
                    let s = modem::demod_bytes(p, self.band, x, HEADER_CW_LEN, d);
                    let h = frame::decode_header(&s.bytes, &s.suspects());
                    (s, h)
                });
                match hdr {
                    Some(h) if h.len == 0 => {
                        self.finish(Frame::from_parts(h, Vec::new()), id, soft.snr_db, score, at, at + len as u64, events)
                    }
                    Some(h) => {
                        self.state = State::Payload { at: at + len as u64, id, header: h, snr_db: soft.snr_db, score }
                    }
                    None => self.fail("header", at, events),
                }
                true
            }
            State::Payload { at, id, header, snr_db, score } => {
                let p = id.profile();
                let n = modem::payload_cw_len(p, header.len as usize);
                let len = modem::payload_samples(p, header.len as usize);
                let Some(x) = self.slice(at, len) else { return false };
                let want = header.len as usize;
                let (soft, pay) = self.try_decoders(|d| {
                    let s = modem::demod_bytes(p, self.band, x, n, d);
                    let r = frame::decode_payload(&s.bytes, modem::payload_parity(p, want), &s.suspects()).filter(|v| v.len() == want);
                    (s, r)
                });
                match pay {
                    Some(payload) if payload.len() == header.len as usize => {
                        let snr = (snr_db + soft.snr_db) / 2.0;
                        self.finish(Frame::from_parts(header, payload), id, snr, score, at, at + len as u64, events)
                    }
                    _ => self.fail("payload", at, events),
                }
                true
            }
        }
    }

    /// Runs the decode with the selected decoder; in ML mode, retries with classic if the CRC fails.
    /// Both results are CRC-checked, so the fallback can only add frames, never wrong ones.
    fn try_decoders<T>(&self, mut f: impl FnMut(Decoder) -> (modem::Soft, Option<T>)) -> (modem::Soft, Option<T>) {
        let first = f(self.decoder);
        if first.1.is_some() || self.decoder == Decoder::Classic {
            return first;
        }
        let second = f(Decoder::Classic);
        if second.1.is_some() {
            second
        } else {
            first
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn finish(&mut self, f: Frame, id: ProfileId, snr_db: f32, score: f32, at: u64, end: u64, events: &mut Vec<RxEvent>) {
        self.stats.frames += 1;
        self.stats.last_snr_db = snr_db;
        events.push(RxEvent::Frame { frame: f, profile: id, band: self.band, snr_db, score, at });
        self.search_pos = end;
        self.state = State::Search;
    }

    fn trim(&mut self) {
        let keep_from = match self.state {
            State::Search => self.search_pos,
            State::Marker { at, .. } | State::Header { at, .. } | State::Payload { at, .. } => at,
        };
        let drop = keep_from.saturating_sub(self.base) as usize;
        if drop > 96_000 && drop <= self.buf.len() {
            self.buf.drain(..drop);
            self.base += drop as u64;
        }
    }
}
