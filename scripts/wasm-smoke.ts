// Smoke test for the built WASM: two stations pair and chat through a shared "air" buffer,
// using the same JS API the browser worker uses. Run with: bun scripts/wasm-smoke.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { initSync, WasmStation, bench_run, scenarios_json } from "../apps/web/public/wasm/ggtf_wasm.js";

initSync({ module: readFileSync(join(import.meta.dir, "../apps/web/public/wasm/ggtf_wasm_bg.wasm")) });

const CHUNK = 2048;
const a = new WasmStation(0x1111, 1);
const b = new WasmStation(0x2222, 2);
b.set_answer(true);

type Ev = { type: string; [k: string]: unknown };
const evA: Ev[] = [];
const evB: Ev[] = [];
let playA: Float32Array | null = null, posA = 0;
let playB: Float32Array | null = null, posB = 0;
let now = 0;

function step() {
  const mix = new Float32Array(CHUNK);
  for (const [p, pos] of [[playA, posA], [playB, posB]] as const) {
    if (!p) continue;
    for (let i = 0; i < CHUNK && pos + i < p.length; i++) mix[i] += p[pos + i];
  }
  posA += CHUNK;
  posB += CHUNK;
  now += (CHUNK * 1000) / 48000;
  a.push_samples(mix, now);
  b.push_samples(mix, now);
  if (playA && posA >= playA.length) { playA = null; a.tx_done(now); }
  if (playB && posB >= playB.length) { playB = null; b.tx_done(now); }
  a.tick(now);
  b.tick(now);
  if (!playA) { const s = a.poll_tx(now); if (s) { playA = s; posA = 0; } }
  if (!playB) { const s = b.poll_tx(now); if (s) { playB = s; posB = 0; } }
  evA.push(...JSON.parse(a.take_events()));
  evB.push(...JSON.parse(b.take_events()));
}

function until(ms: number, cond: () => boolean): boolean {
  const end = now + ms;
  while (now < end) { step(); if (cond()) return true; }
  return false;
}
const state = (ev: Ev[]) => [...ev].reverse().find((e) => e.type === "state")?.state;

a.call(now);
if (!until(90_000, () => state(evA) === "awaiting_confirm" && state(evB) === "awaiting_confirm")) throw new Error("no pairing");
const sasA = evA.find((e) => e.type === "sas")?.words;
const sasB = evB.find((e) => e.type === "sas")?.words;
console.log("pairing words:", sasA, sasB);
if (JSON.stringify(sasA) !== JSON.stringify(sasB)) throw new Error("words differ");
a.confirm(now);
b.confirm(now);
if (!until(60_000, () => state(evA) === "connected" && state(evB) === "connected")) throw new Error("not connected");
const id = a.send_text("hello through the dead air 👻", now);
if (id < 0) throw new Error("send refused");
if (!until(60_000, () => evB.some((e) => e.type === "msg_rx"))) throw new Error("message not received");
until(20_000, () => evA.some((e) => e.type === "msg_status" && e.status === "delivered"));
console.log("received:", evB.find((e) => e.type === "msg_rx")?.text);
console.log("delivered:", evA.some((e) => e.type === "msg_status" && e.status === "delivered"));
console.log("profile:", evA.find((e) => e.type === "trained")?.profile, `simulated ${(now / 1000).toFixed(1)} s`);

const scen = JSON.parse(scenarios_json());
const r = JSON.parse(bench_run(scen.findIndex((s: { key: string }) => s.key === "cafe"), 1, 5, 32, 42));
console.log("bench cafe/specter:", `${r.ok}/${r.frames}`);
console.log("WASM smoke test passed");
