// Link worker: runs the Rust/WASM station off the main thread.
// Audio arrives from the AudioWorklet over a MessagePort; UI commands and events use postMessage.

import init, {
  WasmStation,
  WasmDuo,
  profiles_json,
  bands_json,
  scenarios_json,
  bench_run,
  bench_sample,
  ml_available,
  bundle_pack,
  bundle_open,
  author_public,
  author_words,
} from "/wasm/ggtf_wasm.js";

let ready = null;
let station = null;
let audioPort = null;
let transmitting = false;
let lastStats = 0;
let peak = 0;

// Sim air (Spirit Studio): two stations on simulated air, run faster than real time.
let duo = null;
let duoTimer = null;
let duoSpeed = 0; // 0 = as fast as the CPU allows, otherwise a multiple of real time
let duoDebt = 0;
let duoLinksAt = 0;

function duoTick() {
  if (!duo) return;
  const t0 = now();
  const paired = duo.state(0) === "connected" && duo.state(1) === "connected";
  // Pairing always runs flat out; after that, the chosen speed applies.
  const speed = paired ? duoSpeed : 0;
  if (speed > 0) {
    duoDebt += 30 * speed;
    while (duoDebt > 0 && now() - t0 < 22) {
      duo.run(43);
      duoDebt -= 43;
    }
    if (duoDebt > 1000) duoDebt = 0;
  } else {
    while (now() - t0 < 22) duo.run(43);
  }
  const raw = duo.take_events();
  const t = now();
  const links = t - duoLinksAt > 250 ? [JSON.parse(duo.link(0)), JSON.parse(duo.link(1))] : null;
  if (links) duoLinksAt = t;
  if (raw !== "[]" || links) self.postMessage({ type: "duo-events", events: JSON.parse(raw), now: duo.now(), links });
}

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
        if (m.band !== undefined) station.set_band(m.band);
        if (m.ml !== undefined) station.set_ml(!!m.ml);
        if (m.beamReply !== undefined) station.set_beam_reply(!!m.beamReply);
        audioPort = m.port;
        audioPort.onmessage = onAudio;
        setInterval(pump, 40);
        self.postMessage({ type: "ready", profiles: JSON.parse(profiles_json()), bands: JSON.parse(bands_json()), mlAvailable: ml_available() });
        break;
      case "call":
        if (m.tag instanceof Uint8Array && m.tag.length) station?.call_tagged(m.tag, now());
        else station?.call(now());
        break;
      case "keepalive":
        station?.set_keepalive(m.ms);
        break;
      case "send-bytes": {
        const id = station ? station.send_bytes(m.kind, m.bytes, now()) : -1;
        self.postMessage({ type: "sent-bytes", ref: m.ref, id });
        break;
      }
      case "tools-init":
        await ensureReady();
        self.postMessage({ type: "tools-ready" });
        break;
      case "bundle-pack": {
        await ensureReady();
        const bytes = bundle_pack(m.secret, m.source);
        self.postMessage({ type: "reply", ref: m.ref, value: bytes.length ? bytes : null });
        break;
      }
      case "bundle-open": {
        await ensureReady();
        self.postMessage({ type: "reply", ref: m.ref, value: JSON.parse(bundle_open(m.bytes)) });
        break;
      }
      case "author": {
        await ensureReady();
        const pub = author_public(m.secret);
        self.postMessage({ type: "reply", ref: m.ref, value: { public: pub, words: JSON.parse(author_words(pub)) } });
        break;
      }
      case "duo-start":
        await ensureReady();
        if (duoTimer) clearInterval(duoTimer);
        duo?.free();
        duo = new WasmDuo(m.seed ?? 7);
        duo.set_noise(m.noise ?? 0);
        duo.set_loss(m.loss ?? 0);
        if (m.band !== undefined) duo.set_band(m.band);
        duoSpeed = m.speed ?? 0;
        duoDebt = 0;
        duo.connect();
        duoTimer = setInterval(duoTick, 30);
        break;
      case "duo-config":
        if (duo) {
          if (m.noise !== undefined) duo.set_noise(m.noise);
          if (m.loss !== undefined) duo.set_loss(m.loss);
          if (m.band !== undefined) duo.set_band(m.band);
        }
        if (m.speed !== undefined) duoSpeed = m.speed;
        break;
      case "duo-send": {
        const id = duo ? duo.send(m.side, m.kind, m.bytes) : -1;
        self.postMessage({ type: "duo-sent", ref: m.ref, side: m.side, id });
        break;
      }
      case "duo-hangup":
        duo?.hangup(m.side ?? 0);
        break;
      case "duo-connect":
        duo?.connect();
        break;
      case "duo-stop":
        if (duoTimer) clearInterval(duoTimer);
        duoTimer = null;
        duo?.free();
        duo = null;
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
      case "band":
        station?.set_band(m.band);
        break;
      case "ml": {
        const on = station ? station.set_ml(!!m.on) : false;
        self.postMessage({ type: "ml", on });
        break;
      }
      case "beam-start": {
        // Text and images both travel as bytes; `chunk` is bytes per frame.
        const bytes = m.bytes instanceof Uint8Array ? m.bytes : new TextEncoder().encode(m.text ?? "");
        station?.set_beam_stop_on_catch(!!m.stopOnCatch);
        const id = station ? station.beam_start_bytes(bytes, m.profile, m.band, m.rounds ?? 0, m.chunk ?? 48) : -1;
        self.postMessage({ type: "beam-started", id, bytes: bytes.length });
        break;
      }
      case "beam-reply":
        station?.set_beam_reply(!!m.on);
        break;
      case "beam-stop":
        station?.beam_stop();
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
        self.postMessage({ type: "bench-ready", scenarios: JSON.parse(scenarios_json()), profiles: JSON.parse(profiles_json()), bands: JSON.parse(bands_json()), mlAvailable: ml_available() });
        break;
      case "bench-run": {
        await ensureReady();
        const result = JSON.parse(bench_run(m.scenario, m.profile, m.band ?? 1, !!m.ml, m.frames, m.payload, m.seed));
        self.postMessage({ type: "bench-result", ref: m.ref, result });
        break;
      }
      case "bench-sample": {
        await ensureReady();
        const samples = bench_sample(m.scenario, m.profile, m.band ?? 1, m.payload, m.seed);
        self.postMessage({ type: "bench-sample", ref: m.ref, samples }, [samples.buffer]);
        break;
      }
    }
  } catch (err) {
    self.postMessage({ type: "error", message: String(err && err.message ? err.message : err) });
  }
  pump();
};
