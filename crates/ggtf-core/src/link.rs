//! Half-duplex link layer: a pure state machine with no clock or audio inside.
//!
//! Caller                         Answerer
//!   CALL (broadcast)      ->
//!                         <-     ANSWER
//!   TRAIN x3 slow..fast   ->
//!                         <-     TRAIN_RESULT (which profiles decoded)
//!   KEY (profile, pubkey) ->
//!                         <-     KEY (pubkey)
//!   both show 4 SAS words; users confirm
//!   DATA[CONFIRM] / ACK, then DATA[MSG] / ACK, encrypted and authenticated
//!
//! Reliable frames use stop-and-wait ARQ. ACKs carry an AEAD tag so they can't be forged,
//! and they're sent in the same profile as the frame they answer. When the receiver has its
//! own data ready within `ACK_DELAY_MS`, the ACK rides inside that DATA frame instead
//! (the header's `ack` and `flags` are part of the DATA frame's authenticated data).
//!
//! Messages are binary and tagged with a kind (0 = chat text, 1 = GGTP). They are cut into
//! fragments only when sent, sized by the current profile and recent retries.

use crate::crypto::{self, KeyPair, SessionKeys, KIND_ACK, KIND_DATA};
use crate::frame::{Frame, FrameType, BROADCAST};
use crate::modem::airtime_ms;
use crate::profile::{Band, ProfileId};
use crate::rng::Rng;
use std::collections::VecDeque;

pub const MAX_CALL_ATTEMPTS: u32 = 8;
pub const MAX_RETRIES: u32 = 4;
pub const IDLE_TIMEOUT_MS: f64 = 180_000.0;
pub const REPLY_MARGIN_MS: f64 = 2500.0;
/// Largest message, in bytes.
pub const MAX_MESSAGE: usize = 12_000;
/// Largest fragment: 176 + 6 inner header + 16 tag = 198, under the 200-byte frame limit.
pub const MAX_FRAG: usize = 176;
pub const MIN_FRAG: usize = 32;
/// Send a keep-alive after this long without hearing the peer (plus 0–8 s of per-session jitter).
pub const KEEPALIVE_MS: f64 = 45_000.0;
/// How long the receiver of a DATA frame waits for its own data to piggyback the ACK on.
pub const ACK_DELAY_MS: f64 = 350.0;
/// Largest tag carried in a CALL frame.
pub const MAX_TAG: usize = 16;
/// DATA header flag: `ack` holds a piggybacked acknowledgement.
pub const FLAG_ACK: u8 = 0x01;
const TRAIN_LEN: usize = 24;
const FRAG_HEADER: usize = 6;

/// Message kinds.
pub const KIND_TEXT: u8 = 0;
pub const KIND_GGTP: u8 = 1;

const INNER_CONFIRM: u8 = 0;
const INNER_MSG: u8 = 1;
const INNER_BYE: u8 = 2;
const INNER_PING: u8 = 3;

/// Fragment size for a profile before retry-based shrinking: slow profiles get short frames,
/// so one burst of noise costs less airtime to resend.
pub fn frag_base(p: ProfileId) -> usize {
    match p {
        ProfileId::Wraith => 56,
        ProfileId::Specter => 120,
        ProfileId::Banshee | ProfileId::Poltergeist => MAX_FRAG,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LinkState {
    Idle,
    Calling,
    Ringing,
    Training,
    KeyExchange,
    AwaitingConfirm,
    Connected,
    Closing,
}

impl LinkState {
    pub fn name(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Calling => "calling",
            Self::Ringing => "ringing",
            Self::Training => "training",
            Self::KeyExchange => "key_exchange",
            Self::AwaitingConfirm => "awaiting_confirm",
            Self::Connected => "connected",
            Self::Closing => "closing",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Caller,
    Answerer,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MsgStatus {
    Queued,
    Sending,
    Delivered,
    Failed,
}

impl MsgStatus {
    pub fn name(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Sending => "sending",
            Self::Delivered => "delivered",
            Self::Failed => "failed",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum LinkEvent {
    State { state: LinkState, role: Option<Role>, peer: Option<u16>, profile: ProfileId },
    Sas { words: [&'static str; 4] },
    PeerConfirmed,
    Trained { mask: u8, profile: ProfileId },
    MsgStatus { id: u32, status: MsgStatus },
    MsgReceived { kind: u8, data: Vec<u8> },
    /// A fragment of our message `id` was acknowledged: `sent` of `total` bytes are across.
    MsgProgress { id: u32, sent: usize, total: usize },
    /// A fragment of an incoming message arrived; `bytes` so far (the total isn't known yet).
    MsgPartial { kind: u8, bytes: usize },
    Retry { what: &'static str, attempt: u32, profile: ProfileId },
    Log { text: String },
    Ended { reason: String },
    /// Someone is calling and auto-answer is off. Call `accept` to pick up.
    Incoming { from: u16, tag: Vec<u8> },
    /// This station is answering a call (by accept or auto-answer), with the caller's tag.
    Answering { from: u16, tag: Vec<u8> },
    /// The pending incoming call went away (caller stopped, or it was declined/answered).
    IncomingGone,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Expect {
    Answer,
    Trains,
    TrainResult,
    Key,
    KeyReply,
    Ack,
}

#[derive(Clone, Debug)]
pub struct TxRequest {
    pub frame: Frame,
    pub profile: ProfileId,
    pub band: Band,
    expect: Option<Expect>,
    close_after: bool,
}

enum Pending {
    /// A single-frame control message (confirm, bye, ping).
    Control(Vec<u8>),
    /// A message still being cut into fragments.
    Msg { id: u32, kind: u8, data: Vec<u8>, sent: usize, frag: u16 },
}

impl Pending {
    fn msg_id(&self) -> Option<u32> {
        match self {
            Pending::Control(_) => None,
            Pending::Msg { id, .. } => Some(*id),
        }
    }
}

struct InFlight {
    counter: u64,
    frame: Frame,
    msg_id: Option<u32>,
    last: bool,
    bye: bool,
}

/// Link-level counters, for the UI and tests.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct LinkStats {
    pub acks_sent: u32,
    pub acks_piggybacked: u32,
    pub pings: u32,
    pub frag_limit: usize,
}

pub struct Link {
    pub id: u16,
    rng: Rng,
    events: Vec<LinkEvent>,
    answer_enabled: bool,
    state: LinkState,
    role: Option<Role>,
    peer: Option<u16>,
    profile: ProfileId,
    /// Band of the current session.
    band: Band,
    /// Band the user picked for outgoing calls.
    pref_band: Band,
    queue: VecDeque<TxRequest>,
    /// Some(..) while a frame is handed out and still playing.
    transmitting: Option<(Option<Expect>, bool)>,
    timer: Option<(f64, Expect)>,
    attempts: u32,
    keypair: Option<KeyPair>,
    peer_pub: Option<[u8; 32]>,
    keys: Option<SessionKeys>,
    train_mask: u8,
    train_deadline: Option<f64>,
    outbox: VecDeque<Pending>,
    in_flight: Option<InFlight>,
    tx_counter: u64,
    rx_counter: u64,
    reasm: Vec<u8>,
    /// (message id, kind, next fragment index) of the message being reassembled.
    reasm_at: Option<(u8, u8, u16)>,
    next_msg_id: u32,
    local_confirmed: bool,
    peer_confirmed: bool,
    last_rx: f64,
    /// Most recent caller heard while idle with auto-answer off: (station, time heard, band, tag).
    incoming: Option<(u16, f64, Band, Vec<u8>)>,
    /// Tag sent in our CALL frames.
    call_tag: Vec<u8>,
    /// Tag the caller sent, when we answered.
    peer_tag: Vec<u8>,
    /// ACK we owe the peer, held back briefly so it can ride on our own DATA: (counter, profile, due).
    ack_due: Option<(u64, ProfileId, f64)>,
    /// Upper bound on fragment size, adjusted by retries.
    frag_limit: usize,
    clean_streak: u32,
    keepalive_ms: f64,
    keepalive_jitter: f64,
    /// Allow the experimental Turbo (poltergeist) profile when the line test passes it.
    turbo: bool,
    pub link_stats: LinkStats,
}

/// How long an unanswered incoming call stays acceptable after its last CALL frame.
pub const INCOMING_TTL_MS: f64 = 12_000.0;

fn aad(f: &Frame, field: u8) -> [u8; 6] {
    [f.ftype as u8, (f.src >> 8) as u8, f.src as u8, (f.dst >> 8) as u8, f.dst as u8, field]
}

/// DATA frames also authenticate `ack` and `flags`, so a piggybacked ACK can't be forged or stripped.
fn aad_data(f: &Frame) -> [u8; 8] {
    [f.ftype as u8, (f.src >> 8) as u8, f.src as u8, (f.dst >> 8) as u8, f.dst as u8, f.seq, f.ack, f.flags]
}

fn train_payload(idx: u8, count: u8) -> Vec<u8> {
    let mut p = vec![idx, count];
    p.extend((0..TRAIN_LEN - 2).map(|i| (i as u8).wrapping_mul(37).wrapping_add(11)));
    p
}

impl Link {
    pub fn new(id: u16, seed: u64) -> Self {
        Link {
            id,
            rng: Rng::new(seed),
            events: Vec::new(),
            answer_enabled: false,
            state: LinkState::Idle,
            role: None,
            peer: None,
            profile: ProfileId::Wraith,
            band: Band::Mid,
            pref_band: Band::Mid,
            queue: VecDeque::new(),
            transmitting: None,
            timer: None,
            attempts: 0,
            keypair: None,
            peer_pub: None,
            keys: None,
            train_mask: 0,
            train_deadline: None,
            outbox: VecDeque::new(),
            in_flight: None,
            tx_counter: 0,
            rx_counter: 0,
            reasm: Vec::new(),
            reasm_at: None,
            next_msg_id: 1,
            local_confirmed: false,
            peer_confirmed: false,
            last_rx: 0.0,
            incoming: None,
            call_tag: Vec::new(),
            peer_tag: Vec::new(),
            ack_due: None,
            frag_limit: MAX_FRAG,
            clean_streak: 0,
            keepalive_ms: KEEPALIVE_MS,
            keepalive_jitter: 0.0,
            turbo: false,
            link_stats: LinkStats { frag_limit: MAX_FRAG, ..LinkStats::default() },
        }
    }

    pub fn incoming(&self) -> Option<u16> {
        self.incoming.as_ref().map(|(id, ..)| *id)
    }

    /// Tag the caller attached to the current session (empty if none, or if we called).
    pub fn peer_tag(&self) -> &[u8] {
        &self.peer_tag
    }

    /// Keep-alive interval while connected and idle; 0 turns keep-alives off.
    pub fn set_keepalive(&mut self, ms: f64) {
        self.keepalive_ms = ms.max(0.0);
    }

    /// Lets the line test pick the experimental Turbo profile (off by default).
    pub fn set_turbo(&mut self, on: bool) {
        self.turbo = on;
    }

    /// Fragment size the next DATA frame would use.
    pub fn frag_size(&self) -> usize {
        frag_base(self.profile).min(self.frag_limit)
    }

    pub fn band(&self) -> Band {
        self.band
    }

    /// Band used for the next outgoing call (takes effect when idle).
    pub fn set_band(&mut self, b: Band) {
        self.pref_band = b;
        if self.state == LinkState::Idle {
            self.band = b;
        }
    }

    /// Picks up the pending incoming call, if it is still fresh.
    pub fn accept(&mut self, now: f64) -> bool {
        match self.incoming.take() {
            Some((from, at, band, tag)) if self.state == LinkState::Idle && now - at <= INCOMING_TTL_MS => {
                self.answer_call(from, band, tag, now);
                true
            }
            _ => false,
        }
    }

    pub fn decline(&mut self) {
        if self.incoming.take().is_some() {
            self.events.push(LinkEvent::IncomingGone);
        }
    }

    fn answer_call(&mut self, from: u16, band: Band, tag: Vec<u8>, now: f64) {
        self.reset_session();
        self.band = band;
        if self.incoming.take().is_some() {
            self.events.push(LinkEvent::IncomingGone);
        }
        self.role = Some(Role::Answerer);
        self.peer = Some(from);
        self.peer_tag = tag.clone();
        self.events.push(LinkEvent::Answering { from, tag });
        self.last_rx = now;
        self.attempts = 1;
        self.set_state(LinkState::Ringing);
        self.send_answer();
    }

    pub fn state(&self) -> LinkState {
        self.state
    }
    pub fn role(&self) -> Option<Role> {
        self.role
    }
    pub fn peer(&self) -> Option<u16> {
        self.peer
    }
    pub fn profile(&self) -> ProfileId {
        self.profile
    }
    pub fn answer_enabled(&self) -> bool {
        self.answer_enabled
    }
    pub fn sas(&self) -> Option<[&'static str; 4]> {
        self.keys.as_ref().map(|k| crypto::sas_words(k.sas))
    }
    pub fn take_events(&mut self) -> Vec<LinkEvent> {
        std::mem::take(&mut self.events)
    }

    // ---------- helpers ----------

    fn set_state(&mut self, s: LinkState) {
        self.state = s;
        self.events.push(LinkEvent::State { state: s, role: self.role, peer: self.peer, profile: self.profile });
    }

    fn log(&mut self, t: impl Into<String>) {
        self.events.push(LinkEvent::Log { text: t.into() });
    }

    fn frame(&self, ftype: FrameType, payload: Vec<u8>) -> Frame {
        Frame::new(ftype, self.id, self.peer.unwrap_or(BROADCAST), payload)
    }

    fn enqueue(&mut self, frame: Frame, profile: ProfileId, expect: Option<Expect>, front: bool) {
        let r = TxRequest { frame, profile, band: self.band, expect, close_after: false };
        if front {
            self.queue.push_front(r)
        } else {
            self.queue.push_back(r)
        }
    }

    fn drop_queued(&mut self, t: FrameType) {
        self.queue.retain(|r| r.frame.ftype != t);
    }

    fn reply_ms(&self, e: Expect) -> f64 {
        match e {
            Expect::Answer => airtime_ms(ProfileId::Wraith, 0),
            Expect::Trains => ProfileId::ALL.iter().map(|&p| airtime_ms(p, TRAIN_LEN)).sum(),
            Expect::TrainResult => airtime_ms(ProfileId::Wraith, 1),
            Expect::Key => airtime_ms(ProfileId::Wraith, 33),
            Expect::KeyReply => airtime_ms(self.profile, 33),
            Expect::Ack => airtime_ms(self.profile, 16),
        }
    }

    fn reset_session(&mut self) {
        self.role = None;
        self.peer = None;
        self.profile = ProfileId::Wraith;
        self.band = self.pref_band;
        self.queue.clear();
        self.timer = None;
        self.attempts = 0;
        self.keypair = None;
        self.peer_pub = None;
        self.keys = None;
        self.train_mask = 0;
        self.train_deadline = None;
        self.outbox.clear();
        self.in_flight = None;
        self.tx_counter = 0;
        self.rx_counter = 0;
        self.reasm.clear();
        self.reasm_at = None;
        self.local_confirmed = false;
        self.peer_confirmed = false;
        self.peer_tag.clear();
        self.ack_due = None;
        self.frag_limit = MAX_FRAG;
        self.clean_streak = 0;
        self.keepalive_jitter = self.rng.range(0.0, 8000.0);
        self.link_stats = LinkStats { frag_limit: MAX_FRAG, ..LinkStats::default() };
    }

    fn end(&mut self, reason: impl Into<String>) {
        let mut failed: Vec<u32> = self.in_flight.iter().filter_map(|f| f.msg_id).collect();
        failed.extend(self.outbox.iter().filter_map(Pending::msg_id));
        failed.dedup();
        for id in failed {
            self.events.push(LinkEvent::MsgStatus { id, status: MsgStatus::Failed });
        }
        self.reset_session();
        self.set_state(LinkState::Idle);
        self.events.push(LinkEvent::Ended { reason: reason.into() });
    }

    // ---------- user actions ----------

    pub fn set_answer(&mut self, on: bool) {
        self.answer_enabled = on;
    }

    pub fn call(&mut self, now: f64) {
        self.call_tagged(now, &[]);
    }

    /// Calls with a tag (up to `MAX_TAG` bytes) that the answerer sees with the incoming call.
    pub fn call_tagged(&mut self, now: f64, tag: &[u8]) {
        if self.state != LinkState::Idle {
            return;
        }
        self.reset_session();
        self.decline();
        self.call_tag = tag[..tag.len().min(MAX_TAG)].to_vec();
        self.role = Some(Role::Caller);
        self.last_rx = now;
        self.attempts = 1;
        self.set_state(LinkState::Calling);
        self.send_call();
    }

    pub fn confirm(&mut self, _now: f64) {
        if self.state != LinkState::AwaitingConfirm || self.local_confirmed {
            return;
        }
        self.local_confirmed = true;
        self.queue_reliable(vec![INNER_CONFIRM]);
        if self.peer_confirmed {
            self.set_state(LinkState::Connected);
        } else {
            self.log("waiting for the other side to confirm the words");
        }
    }

    pub fn reject(&mut self, now: f64) {
        self.hangup(now);
    }

    pub fn hangup(&mut self, _now: f64) {
        match self.state {
            LinkState::Idle => {}
            LinkState::AwaitingConfirm | LinkState::Connected if self.keys.is_some() => {
                let pending: Vec<u32> = self.outbox.iter().filter_map(Pending::msg_id).collect();
                for id in pending {
                    self.events.push(LinkEvent::MsgStatus { id, status: MsgStatus::Failed });
                }
                self.outbox.clear();
                self.queue_reliable(vec![INNER_BYE]);
                self.set_state(LinkState::Closing);
            }
            _ => self.end("hung up"),
        }
    }

    /// Queues a text message (kind 0). Returns its id, or None when not connected.
    pub fn send_text(&mut self, text: &[u8]) -> Option<u32> {
        self.send_msg(KIND_TEXT, text)
    }

    /// Queues a binary message of the given kind. Returns its id, or None when not connected
    /// or when the message is empty or longer than `MAX_MESSAGE`.
    pub fn send_msg(&mut self, kind: u8, data: &[u8]) -> Option<u32> {
        if self.state != LinkState::Connected || data.is_empty() || data.len() > MAX_MESSAGE {
            return None;
        }
        let id = self.next_msg_id;
        self.next_msg_id += 1;
        self.events.push(LinkEvent::MsgStatus { id, status: MsgStatus::Queued });
        self.outbox.push_back(Pending::Msg { id, kind, data: data.to_vec(), sent: 0, frag: 0 });
        self.pump();
        Some(id)
    }

    /// Messages waiting to be sent, plus the one in flight.
    pub fn backlog(&self) -> usize {
        self.outbox.len() + self.in_flight.is_some() as usize
    }

    // ---------- transmit side ----------

    pub fn next_tx(&mut self) -> Option<TxRequest> {
        if self.transmitting.is_some() {
            return None;
        }
        let r = self.queue.pop_front()?;
        self.transmitting = Some((r.expect, r.close_after));
        Some(r)
    }

    pub fn tx_done(&mut self, now: f64) {
        let Some((expect, close)) = self.transmitting.take() else { return };
        if let Some(e) = expect {
            // Random backoff that grows with each attempt, so two stations that collided
            // don't resend in step and collide again.
            let spread = 1200.0 * self.attempts.clamp(1, 3) as f64;
            let t = now + self.reply_ms(e) + REPLY_MARGIN_MS + self.rng.range(0.0, spread);
            self.timer = Some((t, e));
        }
        if close {
            self.end("the other side hung up");
        }
    }

    pub fn is_transmitting(&self) -> bool {
        self.transmitting.is_some()
    }

    fn send_call(&mut self) {
        self.drop_queued(FrameType::Call);
        let f = Frame::new(FrameType::Call, self.id, BROADCAST, self.call_tag.clone());
        self.enqueue(f, ProfileId::Wraith, Some(Expect::Answer), false);
    }

    fn send_answer(&mut self) {
        self.drop_queued(FrameType::Answer);
        let f = self.frame(FrameType::Answer, vec![]);
        self.enqueue(f, ProfileId::Wraith, Some(Expect::Trains), false);
    }

    fn send_trains(&mut self) {
        self.drop_queued(FrameType::Train);
        let n = ProfileId::ALL.len();
        for (i, &p) in ProfileId::ALL.iter().enumerate() {
            let f = self.frame(FrameType::Train, train_payload(i as u8, n as u8));
            let expect = if i + 1 == n { Some(Expect::TrainResult) } else { None };
            self.enqueue(f, p, expect, false);
        }
    }

    fn send_train_result(&mut self) {
        self.drop_queued(FrameType::TrainResult);
        let f = self.frame(FrameType::TrainResult, vec![self.train_mask]);
        self.enqueue(f, ProfileId::Wraith, Some(Expect::Key), false);
    }

    fn key_payload(&self) -> Vec<u8> {
        let mut p = vec![self.profile as u8];
        p.extend_from_slice(&self.keypair.as_ref().expect("keypair").public);
        p
    }

    fn send_key(&mut self) {
        self.drop_queued(FrameType::Key);
        let f = self.frame(FrameType::Key, self.key_payload());
        self.enqueue(f, self.profile, Some(Expect::KeyReply), false);
    }

    fn send_key_reply(&mut self) {
        self.drop_queued(FrameType::Key);
        let f = self.frame(FrameType::Key, self.key_payload());
        self.enqueue(f, self.profile, None, true);
    }

    fn queue_reliable(&mut self, pt: Vec<u8>) {
        self.outbox.push_back(Pending::Control(pt));
        self.pump();
    }

    /// Takes the next plaintext to send: a control message, or the next fragment of a message.
    /// Returns (plaintext, message id, last fragment of its message).
    fn next_plaintext(&mut self) -> Option<(Vec<u8>, Option<u32>, bool)> {
        let size = self.frag_size();
        let front = self.outbox.front_mut()?;
        let out = match front {
            Pending::Control(pt) => (std::mem::take(pt), None, true),
            Pending::Msg { id, kind, data, sent, frag } => {
                let end = (*sent + size).min(data.len());
                let last = end == data.len();
                let mut pt = Vec::with_capacity(FRAG_HEADER + end - *sent);
                pt.extend_from_slice(&[INNER_MSG, *kind, *id as u8, (*frag >> 8) as u8, *frag as u8, last as u8]);
                pt.extend_from_slice(&data[*sent..end]);
                if *frag == 0 {
                    self.events.push(LinkEvent::MsgStatus { id: *id, status: MsgStatus::Sending });
                }
                let id = *id;
                *sent = end;
                *frag += 1;
                (pt, Some(id), last)
            }
        };
        if out.2 {
            self.outbox.pop_front();
        }
        Some(out)
    }

    fn pump(&mut self) {
        if self.in_flight.is_some() || self.keys.is_none() || self.outbox.is_empty() {
            return;
        }
        let Some((plaintext, msg_id, last)) = self.next_plaintext() else { return };
        let keys = self.keys.as_ref().unwrap();
        let counter = self.tx_counter;
        let mut f = self.frame(FrameType::Data, vec![]);
        f.seq = counter as u8;
        if let Some((ack, _, _)) = self.ack_due.take() {
            // Our data is ready before the ACK timer: the ACK rides along.
            f.ack = ack as u8;
            f.flags |= FLAG_ACK;
            self.link_stats.acks_piggybacked += 1;
        }
        f.payload = crypto::seal(&keys.tx, KIND_DATA, counter, &aad_data(&f), &plaintext);
        let bye = plaintext.first() == Some(&INNER_BYE);
        self.in_flight = Some(InFlight { counter, frame: f.clone(), msg_id, last, bye });
        self.attempts = 1;
        self.enqueue(f, self.profile, Some(Expect::Ack), false);
    }

    fn send_ack(&mut self, counter: u64, profile: ProfileId) {
        let Some(keys) = self.keys.as_ref() else { return };
        let mut f = self.frame(FrameType::Ack, vec![]);
        f.ack = counter as u8;
        f.payload = crypto::seal(&keys.tx, KIND_ACK, counter, &aad(&f, f.ack), &[]);
        self.drop_queued(FrameType::Ack);
        self.link_stats.acks_sent += 1;
        self.enqueue(f, profile, None, true);
    }

    /// While a receiver is in the middle of a frame, hold retry timers back: the frame may be
    /// the reply we're waiting for, and resending over it would only collide. The hold ends at a
    /// random point after the frame, so two stations hearing the same frame don't fire together.
    pub fn defer_timers(&mut self, now: f64) {
        if let Some((t, e)) = self.timer {
            if t < now + 300.0 {
                self.timer = Some((now + 300.0 + self.rng.range(0.0, 1500.0), e));
            }
        }
    }

    /// Bumps the attempt counter; past the retry limit, drops to a slower profile.
    /// Returns false when there is nothing slower left.
    fn next_attempt(&mut self, what: &'static str) -> bool {
        self.attempts += 1;
        if self.attempts > MAX_RETRIES {
            match self.profile.slower() {
                Some(s) => {
                    self.profile = s;
                    self.attempts = 1;
                    self.log(format!("too many retries, falling back to {}", s.name()));
                }
                None => return false,
            }
        }
        self.events.push(LinkEvent::Retry { what, attempt: self.attempts, profile: self.profile });
        true
    }

    // ---------- timers ----------

    pub fn tick(&mut self, now: f64) {
        if let Some(&(_, at, _, _)) = self.incoming.as_ref() {
            if now - at > INCOMING_TTL_MS {
                self.incoming = None;
                self.events.push(LinkEvent::IncomingGone);
            }
        }
        if self.state != LinkState::Idle && now - self.last_rx > IDLE_TIMEOUT_MS {
            self.end("the line went dead (idle timeout)");
            return;
        }
        if let Some((c, p, due)) = self.ack_due {
            if now >= due {
                self.ack_due = None;
                self.send_ack(c, p);
            }
        }
        if self.state == LinkState::Connected
            && self.keepalive_ms > 0.0
            && self.backlog() == 0
            && self.queue.is_empty()
            && self.transmitting.is_none()
            && now - self.last_rx > self.keepalive_ms + self.keepalive_jitter
        {
            self.link_stats.pings += 1;
            self.queue_reliable(vec![INNER_PING]);
        }
        if let Some(d) = self.train_deadline {
            if now >= d {
                self.train_deadline = None;
                self.send_train_result();
            }
        }
        if let Some((t, e)) = self.timer {
            if now >= t && self.transmitting.is_none() {
                self.timer = None;
                self.on_timeout(e);
            }
        }
    }

    fn on_timeout(&mut self, e: Expect) {
        match e {
            Expect::Answer if self.state == LinkState::Calling => {
                if self.attempts >= MAX_CALL_ATTEMPTS {
                    self.end("no answer from the other side");
                } else {
                    self.attempts += 1;
                    self.events.push(LinkEvent::Retry { what: "call", attempt: self.attempts, profile: ProfileId::Wraith });
                    self.send_call();
                }
            }
            Expect::Trains if self.state == LinkState::Ringing => {
                if self.attempts > MAX_RETRIES {
                    self.end("the caller went silent");
                } else {
                    self.attempts += 1;
                    self.events.push(LinkEvent::Retry { what: "answer", attempt: self.attempts, profile: ProfileId::Wraith });
                    self.send_answer();
                }
            }
            Expect::TrainResult if self.state == LinkState::Training => {
                if self.attempts > MAX_RETRIES {
                    self.end("training failed");
                } else {
                    self.attempts += 1;
                    self.events.push(LinkEvent::Retry { what: "train", attempt: self.attempts, profile: ProfileId::Wraith });
                    self.send_trains();
                }
            }
            Expect::Key if self.state == LinkState::Training => {
                if self.attempts > MAX_RETRIES {
                    self.end("key exchange never started");
                } else {
                    self.attempts += 1;
                    self.events.push(LinkEvent::Retry { what: "train_result", attempt: self.attempts, profile: ProfileId::Wraith });
                    self.send_train_result();
                }
            }
            Expect::KeyReply if self.state == LinkState::KeyExchange => {
                if self.next_attempt("key") {
                    self.send_key();
                } else {
                    self.end("key exchange failed");
                }
            }
            Expect::Ack => self.retry_in_flight(),
            _ => {}
        }
    }

    fn retry_in_flight(&mut self) {
        if self.in_flight.is_none() {
            return;
        }
        if !self.next_attempt("data") {
            self.end("link lost: too many retries");
            return;
        }
        let f = self.in_flight.as_ref().unwrap().frame.clone();
        self.enqueue(f, self.profile, Some(Expect::Ack), false);
    }

    // ---------- receive side ----------

    pub fn on_frame(&mut self, f: &Frame, rx_profile: ProfileId, rx_band: Band, now: f64) {
        if f.src == self.id || (f.dst != self.id && f.dst != BROADCAST) {
            return;
        }
        if f.ftype == FrameType::Call {
            self.on_call(f, rx_band, now);
            return;
        }
        let from_peer = self.peer == Some(f.src);
        let new_answer = self.state == LinkState::Calling && f.ftype == FrameType::Answer && f.dst == self.id;
        if !from_peer && !new_answer {
            return;
        }
        self.last_rx = now;
        let caller = self.role == Some(Role::Caller);
        match (f.ftype, self.state) {
            (FrameType::Answer, LinkState::Calling) => {
                self.peer = Some(f.src);
                self.timer = None;
                self.attempts = 1;
                self.set_state(LinkState::Training);
                self.send_trains();
            }
            (FrameType::Train, LinkState::Ringing | LinkState::Training) if !caller => self.on_train(f, rx_profile, now),
            (FrameType::TrainResult, LinkState::Training) if caller => {
                let mask = f.payload.first().copied().unwrap_or(0);
                // Turbo passes the short line test but long frames often fail over real air,
                // so it is only picked when turned on explicitly.
                let best = ProfileId::ALL
                    .iter()
                    .rev()
                    .filter(|&&p| self.turbo || p != ProfileId::Poltergeist)
                    .find(|&&p| mask & (1 << p as u8) != 0)
                    .copied()
                    .unwrap_or(ProfileId::Wraith);
                self.timer = None;
                self.profile = best;
                self.events.push(LinkEvent::Trained { mask, profile: best });
                self.keypair = Some(KeyPair::generate());
                self.attempts = 1;
                self.set_state(LinkState::KeyExchange);
                self.send_key();
            }
            (FrameType::Key, LinkState::Ringing | LinkState::Training | LinkState::AwaitingConfirm) if !caller => {
                self.on_key_as_answerer(f, rx_profile)
            }
            (FrameType::Key, LinkState::KeyExchange) if caller => self.on_key_as_caller(f),
            (FrameType::Data, LinkState::AwaitingConfirm | LinkState::Connected | LinkState::Closing) => self.on_data(f, rx_profile, now),
            (FrameType::Ack, LinkState::AwaitingConfirm | LinkState::Connected | LinkState::Closing) => self.on_ack(f),
            (FrameType::Bye, _) if self.keys.is_none() => self.end("the other side hung up"),
            _ => {}
        }
    }

    fn on_call(&mut self, f: &Frame, band: Band, now: f64) {
        let tag = f.payload[..f.payload.len().min(MAX_TAG)].to_vec();
        if self.state == LinkState::Idle && self.answer_enabled {
            self.answer_call(f.src, band, tag, now);
        } else if self.state == LinkState::Calling && self.role == Some(Role::Caller) && f.src != self.id && self.id < f.src {
            // Both sides pressed Call ("glare"): the lower station id gives way and answers.
            self.log(format!("both sides called at once; answering {:04X}", f.src));
            self.answer_call(f.src, band, tag, now);
        } else if self.state == LinkState::Idle {
            // Announce once per caller; later CALL retries just keep it fresh.
            let new = self.incoming.as_ref().map(|(id, ..)| *id) != Some(f.src);
            self.incoming = Some((f.src, now, band, tag.clone()));
            if new {
                self.events.push(LinkEvent::Incoming { from: f.src, tag });
            }
        } else if self.state == LinkState::Ringing && self.peer == Some(f.src) {
            self.last_rx = now;
            self.send_answer();
        }
    }

    fn on_train(&mut self, f: &Frame, rx_profile: ProfileId, now: f64) {
        if self.state == LinkState::Ringing {
            self.set_state(LinkState::Training);
        }
        self.timer = None;
        let (idx, count) = (f.payload.first().copied().unwrap_or(0), f.payload.get(1).copied().unwrap_or(1));
        if idx == 0 {
            self.train_mask = 0;
        }
        if f.payload == train_payload(idx, count) {
            self.train_mask |= 1 << rx_profile as u8;
        }
        if idx + 1 >= count {
            self.train_deadline = None;
            self.send_train_result();
        } else {
            let rest: f64 = ProfileId::ALL.iter().skip(idx as usize + 1).map(|&p| airtime_ms(p, TRAIN_LEN)).sum();
            self.train_deadline = Some(now + rest + 1500.0);
        }
    }

    fn parse_key(f: &Frame) -> Option<(ProfileId, [u8; 32])> {
        if f.payload.len() != 33 {
            return None;
        }
        let mut k = [0u8; 32];
        k.copy_from_slice(&f.payload[1..]);
        Some((ProfileId::from_u8(f.payload[0])?, k))
    }

    fn on_key_as_answerer(&mut self, f: &Frame, rx_profile: ProfileId) {
        let Some((_, pk)) = Self::parse_key(f) else { return };
        // Reply in the profile the caller used, which is the one it is able to receive.
        self.profile = rx_profile;
        if self.keys.is_none() {
            let kp = KeyPair::generate();
            let Some(keys) = crypto::derive(&kp, &pk, false) else {
                self.end("received an invalid key");
                return;
            };
            self.keypair = Some(kp);
            self.peer_pub = Some(pk);
            self.keys = Some(keys);
            self.timer = None;
            self.train_deadline = None;
            self.drop_queued(FrameType::TrainResult);
            self.set_state(LinkState::AwaitingConfirm);
            let words = self.sas().unwrap();
            self.events.push(LinkEvent::Sas { words });
        } else if self.peer_pub != Some(pk) {
            self.log("ignored a KEY with a different public key");
            return;
        }
        self.send_key_reply();
    }

    fn on_key_as_caller(&mut self, f: &Frame) {
        let Some((_, pk)) = Self::parse_key(f) else { return };
        let Some(keys) = crypto::derive(self.keypair.as_ref().unwrap(), &pk, true) else {
            self.end("received an invalid key");
            return;
        };
        self.peer_pub = Some(pk);
        self.keys = Some(keys);
        self.timer = None;
        self.drop_queued(FrameType::Key);
        self.set_state(LinkState::AwaitingConfirm);
        let words = self.sas().unwrap();
        self.events.push(LinkEvent::Sas { words });
        self.pump();
    }

    fn on_data(&mut self, f: &Frame, rx_profile: ProfileId, now: f64) {
        let Some(keys) = self.keys.as_ref() else { return };
        if f.seq == self.rx_counter as u8 {
            match crypto::open(&keys.rx, KIND_DATA, self.rx_counter, &aad_data(f), &f.payload) {
                Some(pt) => {
                    let c = self.rx_counter;
                    self.rx_counter += 1;
                    if pt.first() == Some(&INNER_BYE) {
                        // Acknowledge at once: the close-after logic needs the ACK queued.
                        self.ack_due = None;
                        self.send_ack(c, rx_profile);
                    } else {
                        self.ack_due = Some((c, rx_profile, now + ACK_DELAY_MS));
                    }
                    if f.flags & FLAG_ACK != 0 {
                        // Authenticated by the DATA tag above.
                        self.ack_received(f.ack);
                    }
                    self.handle_plain(pt);
                }
                None => self.log("dropped a DATA frame that failed authentication"),
            }
        } else if self.rx_counter > 0 && f.seq == (self.rx_counter - 1) as u8 {
            // Our ACK was lost (or is still waiting): acknowledge now, deliver nothing.
            self.ack_due = None;
            self.send_ack(self.rx_counter - 1, rx_profile);
        }
    }

    fn handle_plain(&mut self, pt: Vec<u8>) {
        match pt.first().copied() {
            Some(INNER_CONFIRM) => {
                if !self.peer_confirmed {
                    self.peer_confirmed = true;
                    self.events.push(LinkEvent::PeerConfirmed);
                    if self.local_confirmed && self.state == LinkState::AwaitingConfirm {
                        self.set_state(LinkState::Connected);
                    }
                }
            }
            Some(INNER_MSG) if pt.len() >= FRAG_HEADER => {
                if !(self.local_confirmed && self.peer_confirmed) {
                    self.log("dropped a message that arrived before pairing was confirmed");
                    return;
                }
                let (kind, id, frag, last) = (pt[1], pt[2], u16::from_be_bytes([pt[3], pt[4]]), pt[5] & 1 != 0);
                if frag == 0 {
                    self.reasm.clear();
                    self.reasm_at = Some((id, kind, 0));
                }
                if self.reasm_at != Some((id, kind, frag)) {
                    self.log("dropped a fragment out of order");
                    self.reasm.clear();
                    self.reasm_at = None;
                    return;
                }
                self.reasm.extend_from_slice(&pt[FRAG_HEADER..]);
                if self.reasm.len() > MAX_MESSAGE {
                    self.log("dropped a message larger than the limit");
                    self.reasm.clear();
                    self.reasm_at = None;
                    return;
                }
                if last {
                    self.reasm_at = None;
                    let data = std::mem::take(&mut self.reasm);
                    self.events.push(LinkEvent::MsgReceived { kind, data });
                } else {
                    self.reasm_at = Some((id, kind, frag + 1));
                    self.events.push(LinkEvent::MsgPartial { kind, bytes: self.reasm.len() });
                }
            }
            Some(INNER_PING) => {}
            Some(INNER_BYE) => {
                self.set_state(LinkState::Closing);
                if let Some(r) = self.queue.iter_mut().find(|r| r.frame.ftype == FrameType::Ack) {
                    r.close_after = true;
                } else {
                    self.end("the other side hung up");
                }
            }
            _ => {}
        }
    }

    fn on_ack(&mut self, f: &Frame) {
        let (Some(keys), Some(inf)) = (self.keys.as_ref(), self.in_flight.as_ref()) else { return };
        if f.ack != inf.counter as u8 {
            return;
        }
        if crypto::open(&keys.rx, KIND_ACK, inf.counter, &aad(f, f.ack), &f.payload).is_none() {
            self.log("ignored an ACK that failed authentication");
            return;
        }
        self.ack_received(f.ack);
    }

    /// The peer acknowledged `ack` (already authenticated by the caller).
    fn ack_received(&mut self, ack: u8) {
        if self.in_flight.as_ref().map(|i| i.counter as u8) != Some(ack) {
            return;
        }
        let inf = self.in_flight.take().unwrap();
        if matches!(self.timer, Some((_, Expect::Ack))) {
            self.timer = None;
        }
        self.drop_queued(FrameType::Data);
        self.tx_counter += 1;
        // Adapt the fragment size: halve after a hard-won frame, double after a clean run.
        if self.attempts >= 3 {
            self.frag_limit = (self.frag_size() / 2).max(MIN_FRAG);
            self.clean_streak = 0;
        } else if self.attempts <= 1 {
            self.clean_streak += 1;
            if self.clean_streak >= 4 && self.frag_limit < MAX_FRAG {
                self.frag_limit = (self.frag_limit * 2).min(MAX_FRAG);
                self.clean_streak = 0;
            }
        }
        self.link_stats.frag_limit = self.frag_limit;
        self.attempts = 0;
        if inf.last {
            if let Some(id) = inf.msg_id {
                self.events.push(LinkEvent::MsgStatus { id, status: MsgStatus::Delivered });
            }
        } else if let (Some(id), Some(Pending::Msg { id: front, sent, data, .. })) = (inf.msg_id, self.outbox.front()) {
            if *front == id {
                self.events.push(LinkEvent::MsgProgress { id, sent: *sent, total: data.len() });
            }
        }
        if inf.bye {
            self.end("hung up");
            return;
        }
        self.pump();
    }
}
