// Clicks through the real /link UI in headless Chrome and measures the audio the page sends
// to the speaker after "Call". Usage: bun scripts/speaker-check.ts [baseUrl]
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] ?? "http://localhost:3210";
const port = 9336;
const proc = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "ggtf-spk-"))}`,
  "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", "about:blank",
]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let url = "";
for (let i = 0; i < 50 && !url; i++) {
  try { url = ((await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as any[]).find((t) => t.type === "page")?.webSocketDebuggerUrl ?? ""; } catch {}
  if (!url) await sleep(200);
}
const ws = new WebSocket(url);
await new Promise((r) => (ws.onopen = r));
let id = 1;
const w = new Map<number, (v: any) => void>();
ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); if (m.id) w.get(m.id)?.(m); };
const send = (method: string, params: object = {}) => new Promise<any>((r) => { const i = id++; w.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expression: string) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const click = (t: string) => ev(`[...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(t)}))?.click()`);

await send("Page.navigate", { url: `${base}/link` });
await sleep(3000);
await click("Open the séance");
await sleep(3000);
console.log("audio context state:", await ev(`window.__ggtf?.ctx.state`));
const rms = `(() => { const a = window.__ggtf.outMeter; const d = new Float32Array(a.fftSize); a.getFloatTimeDomainData(d); let s = 0; for (const v of d) s += v * v; return Math.sqrt(s / d.length); })()`;
console.log("speaker output before Call (rms):", (await ev(rms)).toFixed(4));
await click("Call");
let peak = 0;
const samples: string[] = [];
for (let i = 0; i < 30; i++) {
  await sleep(100);
  const v = await ev(rms);
  peak = Math.max(peak, v);
  if (i % 3 === 0) samples.push(v.toFixed(3));
}
console.log("speaker output in the 3 s after Call (rms, every 0.3 s):", samples.join(" "));
console.log("peak rms:", peak.toFixed(4), peak > 0.05 ? "→ SOUND IS PLAYING" : "→ SILENT");
await sleep(5000);
await click("Hang up");
await sleep(500);
await click("Test speaker");
let beep = 0;
for (let i = 0; i < 8; i++) {
  await sleep(80);
  beep = Math.max(beep, await ev(rms));
}
console.log("Test speaker beep rms:", beep.toFixed(4), beep > 0.05 ? "→ BEEP PLAYING" : "→ SILENT");
console.log("UI shows:", await ev(`document.body.innerText.match(/Output: [^\\n]+/)?.[0]`), "|", await ev(`document.body.innerText.match(/test beep played[^\\n]*/)?.[0]`));
console.log("status label:", await ev(`document.body.innerText.match(/sending \\w+|listening|receiving/)?.[0]`));
ws.close();
proc.kill();
process.exit(peak > 0.05 ? 0 : 1);
