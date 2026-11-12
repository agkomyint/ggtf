//! WebAssembly bindings. Events cross the boundary as JSON strings to keep the JS side simple.

use ggtf_core::bench;
use ggtf_core::link::{LinkEvent, Role};
use ggtf_core::profile::ProfileId;
use ggtf_core::station::{Station, StationEvent};
use serde_json::{json, Value};
use wasm_bindgen::prelude::*;

fn role_name(r: Option<Role>) -> Value {
    match r {
        Some(Role::Caller) => json!("caller"),
        Some(Role::Answerer) => json!("answerer"),
        None => Value::Null,
    }
}

fn event_json(e: &StationEvent) -> Value {
    match e {
        StationEvent::Detected { score } => json!({ "type": "detect", "score": score }),
        StationEvent::RxFailed { stage } => json!({ "type": "rx_failed", "stage": stage }),
        StationEvent::RxFrame { kind, profile, snr_db, from, own } => json!({
            "type": "rx_frame", "kind": kind.name(), "profile": profile.name(), "snr": snr_db, "from": from, "own": own
        }),
        StationEvent::Tx { kind, profile, ms } => json!({ "type": "tx", "kind": kind.name(), "profile": profile.name(), "ms": ms }),
        StationEvent::Link(l) => match l {
            LinkEvent::State { state, role, peer, profile } => json!({
                "type": "state", "state": state.name(), "role": role_name(*role), "peer": peer, "profile": profile.name()
            }),
            LinkEvent::Sas { words } => json!({ "type": "sas", "words": words }),
            LinkEvent::PeerConfirmed => json!({ "type": "peer_confirmed" }),
            LinkEvent::Trained { mask, profile } => json!({ "type": "trained", "mask": mask, "profile": profile.name() }),
            LinkEvent::MsgStatus { id, status } => json!({ "type": "msg_status", "id": id, "status": status.name() }),
            LinkEvent::MsgReceived { text } => json!({ "type": "msg_rx", "text": String::from_utf8_lossy(text) }),
            LinkEvent::Retry { what, attempt, profile } => json!({ "type": "retry", "what": what, "attempt": attempt, "profile": profile.name() }),
            LinkEvent::Log { text } => json!({ "type": "log", "text": text }),
            LinkEvent::Ended { reason } => json!({ "type": "ended", "reason": reason }),
            LinkEvent::Incoming { from } => json!({ "type": "incoming", "from": from }),
            LinkEvent::IncomingGone => json!({ "type": "incoming_gone" }),
        },
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

    /// Returns the message id, or -1 when the link isn't connected.
    pub fn send_text(&mut self, text: &str, now: f64) -> i32 {
        self.inner.send_text(text.as_bytes(), now).map(|v| v as i32).unwrap_or(-1)
    }

    pub fn take_events(&mut self) -> String {
        let ev: Vec<Value> = self.inner.take_events().iter().map(event_json).collect();
        Value::Array(ev).to_string()
    }

    pub fn stats(&self) -> String {
        let r = &self.inner.rx.stats;
        let s = &self.inner.stats;
        json!({
            "detections": r.detections, "frames": r.frames, "marker_fail": r.marker_fail,
            "header_fail": r.header_fail, "payload_fail": r.payload_fail,
            "last_snr": r.last_snr_db, "last_score": r.last_score,
            "tx_frames": s.tx_frames, "rx_frames": s.rx_frames, "own_frames": s.own_frames,
            "busy": self.inner.rx.busy()
        })
        .to_string()
    }
}

#[wasm_bindgen]
pub fn profiles_json() -> String {
    let v: Vec<Value> = ProfileId::ALL
        .iter()
        .map(|id| {
            let p = id.profile();
            json!({ "id": *id as u8, "name": p.name, "raw_bps": p.raw_bps(), "lo_hz": p.base_hz, "hi_hz": p.top_hz(), "parity": p.parity })
        })
        .collect();
    Value::Array(v).to_string()
}

#[wasm_bindgen]
pub fn scenarios_json() -> String {
    let v: Vec<Value> = bench::scenarios().iter().enumerate().map(|(i, s)| json!({ "index": i, "key": s.key, "name": s.name })).collect();
    Value::Array(v).to_string()
}

fn scenario(i: u32) -> Option<bench::Scenario> {
    bench::scenarios().into_iter().nth(i as usize)
}

#[wasm_bindgen]
pub fn bench_run(scenario_index: u32, profile: u8, frames: u32, payload_len: u32, seed: u32) -> String {
    let (Some(sc), Some(id)) = (scenario(scenario_index), ProfileId::from_u8(profile)) else {
        return json!({ "error": "unknown scenario or profile" }).to_string();
    };
    let r = bench::run(&sc, id, frames, payload_len.clamp(1, 64) as usize, seed as u64);
    json!({
        "scenario": sc.key, "name": sc.name, "profile": id.name(), "frames": r.frames, "ok": r.ok,
        "missed": r.missed, "marker_fail": r.marker_fail, "header_fail": r.header_fail, "payload_fail": r.payload_fail,
        "corrupted": r.corrupted, "success": r.success_rate(), "goodput_bps": r.goodput_bps, "mean_snr_db": r.mean_snr_db
    })
    .to_string()
}

/// One degraded test frame as audio, for the "listen" button in the lab.
#[wasm_bindgen]
pub fn bench_sample(scenario_index: u32, profile: u8, payload_len: u32, seed: u32) -> Vec<f32> {
    match (scenario(scenario_index), ProfileId::from_u8(profile)) {
        (Some(sc), Some(id)) => bench::sample_audio(&sc, id, payload_len.clamp(1, 64) as usize, seed as u64),
        _ => Vec::new(),
    }
}
