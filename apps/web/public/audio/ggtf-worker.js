// Link worker: runs the Rust/WASM station off the main thread.
// Audio arrives from the AudioWorklet over a MessagePort; UI commands and events use postMessage.

import init, { WasmStation, profiles_json, scenarios_json, bench_run, bench_sample } from "/wasm/ggtf_wasm.js";

let ready = null;
let station = null;
let audioPort = null;
let transmitting = false;
let lastStats = 0;
let peak = 0;

const now = () => performance.now();
const ensureReady = () => (ready ??= init({ module_or_path: "/wasm/ggtf_wasm_bg.wasm" }));

function flush() {
  if (!station) return;
  const raw = station.take_events();
  if (raw !== "[]") self.postMessage({ type: "events", events: JSON.parse(raw) });
  const t = now();
  if (t - lastStats > 250) {
    lastStats = t;
    self.postMessage({ type: "stats", stats: { ...JSON.parse(station.stats()), peak, transmitting } });
    peak = 0;
  }
}

function pump() {
  if (!station) return;
  const t = now();
  station.tick(t);
  if (!transmitting && audioPort) {
    const samples = station.poll_tx(t);
    if (samples) {
      transmitting = true;
      audioPort.postMessage({ type: "tx", samples }, [samples.buffer]);
    }
  }
  flush();
}

function onAudio(e) {
  const m = e.data;
  if (!station) return;
  if (m.type === "rx") {
    if (m.peak > peak) peak = m.peak;
    station.push_samples(m.samples, now());
  } else if (m.type === "txdone") {
    transmitting = false;
    station.tx_done(now());
  }
  pump();
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    switch (m.type) {
      case "init-station":
        await ensureReady();
        station = new WasmStation(m.id, m.seed);
        station.set_answer(!!m.answer);
        audioPort = m.port;
        audioPort.onmessage = onAudio;
        setInterval(pump, 40);
        self.postMessage({ type: "ready", profiles: JSON.parse(profiles_json()) });
        break;
      case "call":
        station?.call(now());
        break;
      case "answer":
        station?.set_answer(!!m.on);
        break;
      case "accept":
        if (station && !station.accept(now())) self.postMessage({ type: "events", events: [{ type: "incoming_gone" }, { type: "log", text: "that call is gone; ask the caller to summon again" }] });
        break;
      case "decline":
        station?.decline();
        break;
      case "confirm":
        station?.confirm(now());
        break;
      case "reject":
        station?.reject(now());
        break;
      case "hangup":
        station?.hangup(now());
        break;
      case "send": {
        const id = station ? station.send_text(m.text, now()) : -1;
        self.postMessage({ type: "sent", ref: m.ref, id });
        break;
      }
      case "bench-init":
        await ensureReady();
        self.postMessage({ type: "bench-ready", scenarios: JSON.parse(scenarios_json()), profiles: JSON.parse(profiles_json()) });
        break;
      case "bench-run": {
        await ensureReady();
        const result = JSON.parse(bench_run(m.scenario, m.profile, m.frames, m.payload, m.seed));
        self.postMessage({ type: "bench-result", ref: m.ref, result });
        break;
      }
      case "bench-sample": {
        await ensureReady();
        const samples = bench_sample(m.scenario, m.profile, m.payload, m.seed);
        self.postMessage({ type: "bench-sample", ref: m.ref, samples }, [samples.buffer]);
        break;
      }
    }
  } catch (err) {
    self.postMessage({ type: "error", message: String(err && err.message ? err.message : err) });
  }
  pump();
};
