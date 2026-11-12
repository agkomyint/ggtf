// Can the microphone hear the speaker? Opens /link in Chrome with the REAL mic and speaker,
// plays the test beep and one CALL, and measures what the mic picks up in the GGTF band.
// Usage: bun scripts/mic-check.ts [baseUrl] [--visible]
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3210";
const visible = process.argv.includes("--visible");
const port = 9341;
const proc = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  ...(visible ? [] : ["--headless=new"]),
  `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "ggtf-mic-"))}`,
  "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--no-first-run",
  ...process.argv.filter((a) => a.startsWith("--enable-features") || a.startsWith("--disable-features")),
  "about:blank",
]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let url = "";
for (let i = 0; i < 60 && !url; i++) {
  try { url = ((await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as any[]).find((t) => t.type === "page")?.webSocketDebuggerUrl ?? ""; } catch {}
  if (!url) await sleep(250);
}
const ws = new WebSocket(url);
await new Promise((r) => (ws.onopen = r));
let id = 1;
const w = new Map<number, (v: any) => void>();
ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); if (m.id) w.get(m.id)?.(m); };
const send = (method: string, params: object = {}) => new Promise<any>((r) => { const i = id++; w.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression: string) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true })).result?.result?.value;
const click = (t: string) => ev(`[...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(t)}))?.click()`);

// Band energy (1.5–4.8 kHz) seen by the mic analyser, in dB, and raw peak.
const measure = `(() => {
  const g = window.__ggtf; const a = g.inMeter;
  const f = new Float32Array(a.frequencyBinCount); a.getFloatFrequencyData(f);
  const hz = a.context.sampleRate / 2 / f.length; let band = -200, out = -200;
  for (let i = 0; i < f.length; i++) { const v = f[i]; const fr = i * hz; if (fr >= 1500 && fr <= 4800) band = Math.max(band, v); else if (fr > 300) out = Math.max(out, v); }
  const t = new Float32Array(a.fftSize); a.getFloatTimeDomainData(t); let pk = 0; for (const x of t) pk = Math.max(pk, Math.abs(x));
  const o = new Float32Array(g.outMeter.fftSize); g.outMeter.getFloatTimeDomainData(o); let opk = 0; for (const x of o) opk = Math.max(opk, Math.abs(x));
  return { band: Math.round(band), other: Math.round(out), micPeak: +pk.toFixed(4), spkPeak: +opk.toFixed(3) };
})()`;
async function sample(label: string, ms: number) {
  const rows: any[] = [];
  const end = Date.now() + ms;
  while (Date.now() < end) { rows.push(await ev(measure)); await sleep(60); }
  const best = rows.reduce((a, r) => (r.band > a.band ? r : a), rows[0]);
  const spk = Math.max(...rows.map((r) => r.spkPeak));
  const mic = Math.max(...rows.map((r) => r.micPeak));
  console.log(`${label.padEnd(26)} speaker peak ${spk.toFixed(3)} | mic peak ${mic.toFixed(4)} | loudest in-band ${best.band} dB`);
  return { spk, mic, band: best.band };
}

await send("Page.navigate", { url: `${base}/link` });
await sleep(3000);
await click("Open the séance");
await sleep(3500);
const info = await ev(`(() => { const t = window.__ggtf?.stream.getAudioTracks()[0]; return t ? { label: t.label, settings: t.getSettings() } : null; })()`);
console.log("mic device:", info?.label);
console.log("mic settings reported by Chrome:", JSON.stringify(info?.settings));
const quiet = await sample("silence", 1500);
await click("Test speaker");
const beep = await sample("during test beep", 900);
await sleep(800);
await click("Call");
const call = await sample("during CALL", 1500);
await click("Hang up");
const log = await ev(`[...document.querySelectorAll('.font-mono.text-xs > div')].map(d => d.textContent).slice(-8)`);
console.log("event log tail:\n  " + (log ?? []).join("\n  "));
console.log(`\nIn-band rise over silence: beep +${beep.band - quiet.band} dB, CALL +${call.band - quiet.band} dB`);
console.log(call.band - quiet.band >= 20 ? "VERDICT: the mic hears the speaker clearly." : call.band - quiet.band >= 8 ? "VERDICT: the mic hears the speaker only weakly." : "VERDICT: the mic does NOT hear the speaker (system echo cancellation, muted mic, or wrong device).");
ws.close();
proc.kill();
