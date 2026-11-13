//! WebAssembly bindings. Events cross the boundary as JSON strings to keep the JS side simple.

use ggtf_core::beam::BeamEvent;
use ggtf_core::bench;
use ggtf_core::bundle;
use ggtf_core::duo::Duo;
use ggtf_core::link::{LinkEvent, Role};
use ggtf_core::ml::{self, Decoder};
use ggtf_core::profile::{Band, ProfileId};
use ggtf_core::station::{Station, StationEvent};
use serde_json::{json, Value};
use wasm_bindgen::prelude::*;

/// Standard base64 (RFC 4648), so binary beams (images) can travel inside the JSON events.
fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

fn role_name(r: Option<Role>) -> Value {
    match r {
        Some(Role::Caller) => json!("caller"),
        Some(Role::Answerer) => json!("answerer"),
        None => Value::Null,
    }
}

fn event_json(e: &StationEvent) -> Value {
    match e {
        StationEvent::Detected { score, band } => json!({ "type": "detect", "score": score, "band": band.name() }),
        StationEvent::RxFailed { stage, band } => json!({ "type": "rx_failed", "stage": stage, "band": band.name() }),
        StationEvent::RxFrame { kind, profile, band, snr_db, from, own } => json!({
            "type": "rx_frame", "kind": kind.name(), "profile": profile.name(), "band": band.name(), "snr": snr_db, "from": from, "own": own
        }),
        StationEvent::Tx { kind, profile, band, ms } => json!({ "type": "tx", "kind": kind.name(), "profile": profile.name(), "band": band.name(), "ms": ms }),
        StationEvent::Beam(BeamEvent::Progress { id, from, have, count, got }) => json!({
            "type": "beam_progress", "id": id, "from": from, "have": have, "count": count,
            "got": got.iter().map(|&g| if g { '1' } else { '0' }).collect::<String>()
        }),
        StationEvent::Beam(BeamEvent::Complete { id, from, message }) => json!({
            "type": "beam_rx", "id": id, "from": from, "bytes": message.len(),
            "text": String::from_utf8_lossy(message), "b64": base64(message)
        }),
        StationEvent::BeamRound { id, round, chunks } => json!({ "type": "beam_round", "id": id, "round": round, "chunks": chunks }),
        StationEvent::BeamStopped { id, rounds } => json!({ "type": "beam_stopped", "id": id, "rounds": rounds }),
        StationEvent::Link(l) => match l {
            LinkEvent::State { state, role, peer, profile } => json!({
                "type": "state", "state": state.name(), "role": role_name(*role), "peer": peer, "profile": profile.name()
            }),
            LinkEvent::Sas { words } => json!({ "type": "sas", "words": words }),
            LinkEvent::PeerConfirmed => json!({ "type": "peer_confirmed" }),
            LinkEvent::Trained { mask, profile } => json!({ "type": "trained", "mask": mask, "profile": profile.name() }),
            LinkEvent::MsgStatus { id, status } => json!({ "type": "msg_status", "id": id, "status": status.name() }),
            LinkEvent::MsgReceived { kind, data } => json!({
                "type": "msg_rx", "kind": kind, "bytes": data.len(),
                "text": if *kind == ggtf_core::link::KIND_TEXT { String::from_utf8_lossy(data).into_owned() } else { String::new() },
                "b64": base64(data)
            }),
            LinkEvent::MsgProgress { id, sent, total } => json!({ "type": "msg_progress", "id": id, "sent": sent, "total": total }),
            LinkEvent::MsgPartial { kind, bytes } => json!({ "type": "msg_partial", "kind": kind, "bytes": bytes }),
            LinkEvent::Retry { what, attempt, profile } => json!({ "type": "retry", "what": what, "attempt": attempt, "profile": profile.name() }),
            LinkEvent::Log { text } => json!({ "type": "log", "text": text }),
            LinkEvent::Ended { reason } => json!({ "type": "ended", "reason": reason }),
            LinkEvent::Incoming { from, tag } => json!({ "type": "incoming", "from": from, "tag": hex(tag) }),
            LinkEvent::Answering { from, tag } => json!({ "type": "answering", "from": from, "tag": hex(tag) }),
            LinkEvent::IncomingGone => json!({ "type": "incoming_gone" }),
        },
    }
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn secret32(b: &[u8]) -> Option<[u8; 32]> {
    b.try_into().ok()
}

fn band(v: u8) -> Band {
    Band::from_u8(v).unwrap_or(Band::Mid)
}

fn profile(v: u8) -> ProfileId {
    ProfileId::from_u8(v).unwrap_or(ProfileId::Specter)
}

fn decoder(ml_on: bool) -> Decoder {
    if ml_on && ml::model_available() {
        Decoder::Ml
    } else {
        Decoder::Classic
    }
}

#[wasm_bindgen]
pub struct WasmStation {
    inner: Station,
}

#[wasm_bindgen]
impl WasmStation {
    #[wasm_bindgen(constructor)]
    pub fn new(id: u16, seed: u32) -> WasmStation {
        WasmStation { inner: Station::new(id, seed as u64) }
    }

    pub fn id(&self) -> u16 {
        self.inner.id()
    }

    pub fn push_samples(&mut self, samples: &[f32], now: f64) {
        self.inner.push_samples(samples, now);
    }

    pub fn tick(&mut self, now: f64) {
        self.inner.tick(now);
    }

    pub fn poll_tx(&mut self, now: f64) -> Option<Vec<f32>> {
        self.inner.poll_tx(now)
    }

    pub fn tx_done(&mut self, now: f64) {
        self.inner.tx_done(now);
    }

    pub fn call(&mut self, now: f64) {
        self.inner.call(now);
    }

    /// Calls with a tag (up to 16 bytes) that the answerer sees with the incoming call.
    pub fn call_tagged(&mut self, tag: &[u8], now: f64) {
        self.inner.call_tagged(now, tag);
    }

    /// Keep-alive interval in ms while connected and idle; 0 turns it off.
    pub fn set_keepalive(&mut self, ms: f64) {
        self.inner.link.set_keepalive(ms);
    }

    /// Lets the link pick the experimental Turbo profile (off by default).
    pub fn set_turbo(&mut self, on: bool) {
        self.inner.link.set_turbo(on);
    }

    /// Sends a binary message (kind 0 text, 1 GGTP). Returns the message id, or -1.
    pub fn send_bytes(&mut self, kind: u8, data: &[u8], now: f64) -> i32 {
        self.inner.send_msg(kind, data, now).map(|v| v as i32).unwrap_or(-1)
    }

    pub fn set_answer(&mut self, on: bool) {
        self.inner.set_answer(on);
    }

    /// Picks up a pending incoming call. Returns false if there is none (or it expired).
    pub fn accept(&mut self, now: f64) -> bool {
        self.inner.accept(now)
    }

    pub fn decline(&mut self) {
        self.inner.decline();
    }

    pub fn confirm(&mut self, now: f64) {
        self.inner.confirm(now);
    }

    pub fn reject(&mut self, now: f64) {
        self.inner.reject(now);
    }

    pub fn hangup(&mut self, now: f64) {
        self.inner.hangup(now);
    }

    /// Band for outgoing calls and beams: 0 low, 1 mid, 2 high.
    pub fn set_band(&mut self, b: u8) {
        self.inner.set_band(band(b));
    }

    /// Turns the ML symbol decoder on or off. Returns whether ML is now active.
    pub fn set_ml(&mut self, on: bool) -> bool {
        let d = decoder(on);
        self.inner.set_decoder(d);
        d == Decoder::Ml
    }

    /// Returns the message id, or -1 when the link isn't connected.
    pub fn send_text(&mut self, text: &str, now: f64) -> i32 {
        self.inner.send_text(text.as_bytes(), now).map(|v| v as i32).unwrap_or(-1)
    }

    /// Starts broadcasting `text`. `rounds` 0 = until stopped. Returns the beam id, or -1.
    pub fn beam_start(&mut self, text: &str, profile_id: u8, band_id: u8, rounds: u32) -> i32 {
        self.inner.beam_start(text.as_bytes(), profile(profile_id), band(band_id), rounds).map(|v| v as i32).unwrap_or(-1)
    }

    /// Broadcasts raw bytes (used for images). `chunk` is the bytes per frame (16 to 196).
    pub fn beam_start_bytes(&mut self, data: &[u8], profile_id: u8, band_id: u8, rounds: u32, chunk: u32) -> i32 {
        self.inner.beam_start_chunked(data, profile(profile_id), band(band_id), rounds, chunk as usize).map(|v| v as i32).unwrap_or(-1)
    }

    pub fn beam_stop(&mut self) {
        self.inner.beam_stop();
    }

    pub fn take_events(&mut self) -> String {
        let ev: Vec<Value> = self.inner.take_events().iter().map(event_json).collect();
        Value::Array(ev).to_string()
    }

    pub fn stats(&self) -> String {
        let r = self.inner.rx_stats();
        let s = &self.inner.stats;
        json!({
            "detections": r.detections, "frames": r.frames, "marker_fail": r.marker_fail,
            "header_fail": r.header_fail, "payload_fail": r.payload_fail,
            "last_snr": r.last_snr_db, "last_score": r.last_score,
            "tx_frames": s.tx_frames, "rx_frames": s.rx_frames, "own_frames": s.own_frames,
            "busy": self.inner.busy(), "beaming": self.inner.beaming(),
            "decoder": self.inner.decoder().name(), "band": self.inner.link.band().name(),
            "link": link_json(&self.inner.link)
        })
        .to_string()
    }
}

fn link_json(l: &ggtf_core::link::Link) -> Value {
    let s = l.link_stats;
    json!({
        "frag": l.frag_size(), "frag_limit": s.frag_limit, "acks": s.acks_sent, "piggybacked": s.acks_piggybacked,
        "pings": s.pings, "backlog": l.backlog(), "state": l.state().name(), "profile": l.profile().name(), "band": l.band().name()
    })
}

// ---------- spirit bundles ----------

/// Public key (32 bytes) for a 32-byte author secret. Empty if the secret has the wrong length.
#[wasm_bindgen]
pub fn author_public(secret: &[u8]) -> Vec<u8> {
    secret32(secret).map(|s| bundle::author_public(&s).to_vec()).unwrap_or_default()
}

/// The 4 author words for a public key, as a JSON array.
#[wasm_bindgen]
pub fn author_words(public: &[u8]) -> String {
    match <[u8; 32]>::try_from(public) {
        Ok(p) => json!(bundle::author_words(&p)).to_string(),
        Err(_) => "[]".into(),
    }
}

/// Compresses and signs a spirit source. Empty on failure (bad secret, source over 256 KB).
#[wasm_bindgen]
pub fn bundle_pack(secret: &[u8], source: &str) -> Vec<u8> {
    secret32(secret).and_then(|s| bundle::pack(&s, source.as_bytes())).unwrap_or_default()
}

/// Verifies and unpacks a bundle: `{ok, error?, author, words, hash, source, bytes}`.
#[wasm_bindgen]
pub fn bundle_open(data: &[u8]) -> String {
    match bundle::open(data) {
        Ok(o) => match String::from_utf8(o.source) {
            Ok(source) => json!({
                "ok": true, "author": hex(&o.author), "words": bundle::author_words(&o.author),
                "hash": hex(&o.hash), "source": source, "bytes": data.len()
            }),
            Err(_) => json!({ "ok": false, "error": "the spirit source is not valid text" }),
        },
        Err(e) => json!({ "ok": false, "error": e.message() }),
    }
    .to_string()
}

#[wasm_bindgen]
pub fn is_bundle(data: &[u8]) -> bool {
    bundle::is_bundle(data)
}

// ---------- sim air for Spirit Studio ----------

/// Two real stations on simulated air. Events come back tagged with `side` 0 (A) or 1 (B).
#[wasm_bindgen]
pub struct WasmDuo {
    inner: Duo,
}

#[wasm_bindgen]
impl WasmDuo {
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u32) -> WasmDuo {
        WasmDuo { inner: Duo::new(seed as u64) }
    }

    pub fn set_noise(&mut self, sigma: f32) {
        self.inner.noise = sigma.clamp(0.0, 0.5);
    }

    pub fn set_loss(&mut self, p: f32) {
        self.inner.loss = p.clamp(0.0, 0.5);
    }

    /// Band for the next call (0 low, 1 mid, 2 high). The answerer adopts the caller's band.
    pub fn set_band(&mut self, b: u8) {
        for st in self.inner.st.iter_mut() {
            st.set_band(band(b));
        }
    }

    /// Station A calls B; both sides confirm automatically.
    pub fn connect(&mut self) {
        self.inner.connect();
    }

    pub fn hangup(&mut self, side: u8) {
        let now = self.inner.now;
        self.inner.st[(side & 1) as usize].hangup(now);
    }

    /// Advances simulated time by `ms`.
    pub fn run(&mut self, ms: f64) {
        self.inner.run_for(ms);
    }

    pub fn now(&self) -> f64 {
        self.inner.now
    }

    pub fn state(&self, side: u8) -> String {
        self.inner.st[(side & 1) as usize].link.state().name().into()
    }

    pub fn send(&mut self, side: u8, kind: u8, data: &[u8]) -> i32 {
        let now = self.inner.now;
        self.inner.st[(side & 1) as usize].send_msg(kind, data, now).map(|v| v as i32).unwrap_or(-1)
    }

    pub fn link(&self, side: u8) -> String {
        link_json(&self.inner.st[(side & 1) as usize].link).to_string()
    }

    pub fn take_events(&mut self) -> String {
        let ev: Vec<Value> = self
            .inner
            .take_events()
            .iter()
            .map(|(s, e)| {
                let mut v = event_json(e);
                v["side"] = json!(s);
                v
            })
            .collect();
        Value::Array(ev).to_string()
    }
}

/// Seconds of airtime for one beam round, computed by the real modem.
#[wasm_bindgen]
pub fn beam_round_seconds(bytes: u32, profile_id: u8, chunk: u32) -> f64 {
    let chunk = (chunk as usize).clamp(16, ggtf_core::beam::MAX_CHUNK);
    let total = bytes as usize + 4;
    let id = profile(profile_id);
    let mut ms = 0.0;
    let mut left = total;
    while left > 0 {
        let c = left.min(chunk);
        ms += ggtf_core::modem::airtime_ms(id, 4 + c);
        left -= c;
    }
    ms / 1000.0
}

#[wasm_bindgen]
pub fn ml_available() -> bool {
    ml::model_available()
}

#[wasm_bindgen]
pub fn profiles_json() -> String {
    let v: Vec<Value> = ProfileId::ALL
        .iter()
        .map(|id| {
            let p = id.profile();
            json!({ "id": *id as u8, "name": p.name, "raw_bps": p.raw_bps(), "groups": p.groups, "lo_hz": p.low_hz(Band::Mid), "hi_hz": p.top_hz(Band::Mid), "parity": p.parity })
        })
        .collect();
    Value::Array(v).to_string()
}

#[wasm_bindgen]
pub fn bands_json() -> String {
    let v: Vec<Value> = Band::ALL
        .iter()
        .map(|b| {
            let (lo, hi) = b.chirp();
            json!({ "id": *b as u8, "name": b.name(), "lo_hz": lo, "hi_hz": hi + 300.0 })
        })
        .collect();
    Value::Array(v).to_string()
}

#[wasm_bindgen]
pub fn scenarios_json() -> String {
    let v: Vec<Value> = bench::scenarios().iter().enumerate().map(|(i, s)| json!({ "index": i, "key": s.key, "name": s.name, "tier": s.tier })).collect();
    Value::Array(v).to_string()
}

fn scenario(i: u32) -> Option<bench::Scenario> {
    bench::scenarios().into_iter().nth(i as usize)
}

#[wasm_bindgen]
pub fn bench_run(scenario_index: u32, profile_id: u8, band_id: u8, ml_on: bool, frames: u32, payload_len: u32, seed: u32) -> String {
    let Some(sc) = scenario(scenario_index) else {
        return json!({ "error": "unknown scenario" }).to_string();
    };
    let (id, b, d) = (profile(profile_id), band(band_id), decoder(ml_on));
    let r = bench::run(&sc, id, b, d, frames, payload_len.clamp(1, 64) as usize, seed as u64);
    json!({
        "scenario": sc.key, "name": sc.name, "tier": sc.tier, "profile": id.name(), "band": b.name(), "decoder": d.name(),
        "frames": r.frames, "ok": r.ok, "missed": r.missed, "marker_fail": r.marker_fail, "header_fail": r.header_fail,
        "payload_fail": r.payload_fail, "corrupted": r.corrupted, "success": r.success_rate(), "goodput_bps": r.goodput_bps,
        "mean_snr_db": r.mean_snr_db
    })
    .to_string()
}

/// One degraded test frame as audio, for the "listen" button in the lab.
#[wasm_bindgen]
pub fn bench_sample(scenario_index: u32, profile_id: u8, band_id: u8, payload_len: u32, seed: u32) -> Vec<f32> {
    match scenario(scenario_index) {
        Some(sc) => bench::sample_audio(&sc, profile(profile_id), band(band_id), payload_len.clamp(1, 64) as usize, seed as u64),
        None => Vec::new(),
    }
}
