// Real-air beam test on one computer: station A plays through the real speaker, station B
// listens through the real microphone. Measures success and bytes/second for text and an image
// at several speeds. Needs laptop mic enhancements off (see README).
// Usage: bun scripts/real-air-beam.ts [baseUrl] [--band=mid|low|high]
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3210";
const band = { low: 0, mid: 1, high: 2 }[(process.argv.find((a) => a.startsWith("--band=")) ?? "--band=mid").slice(7)] ?? 1;
const port = 9342;
const proc = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "ggtf-air-"))}`,
  "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--no-first-run", "about:blank",
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
const ev = async <T = any>(expression: string): Promise<T> => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  return r.result.result.value as T;
};

await send("Page.navigate", { url: `${base}/` });
await sleep(1500);
console.log(await ev(`(async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
  const ctx = new AudioContext({ sampleRate: 48000 });
  await ctx.audioWorklet.addModule('/audio/ggtf-processor.js');
  const mic = ctx.createMediaStreamSource(stream);
  const mk = async (id, toSpeaker) => {
    const node = new AudioWorkletNode(ctx, 'ggtf-processor', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 1, channelCountMode: 'explicit' });
    mic.connect(node);
    if (toSpeaker) node.connect(ctx.destination); else { const z = ctx.createGain(); z.gain.value = 0; node.connect(z); z.connect(ctx.destination); }
    const worker = new Worker('/audio/ggtf-worker.js', { type: 'module' });
    const ch = new MessageChannel();
    node.port.postMessage({ type: 'port', port: ch.port1 }, [ch.port1]);
    const st = { events: [], worker };
    worker.onmessage = (e) => { if (e.data.type === 'events') st.events.push(...e.data.events); };
    await new Promise((res) => { const prev = worker.onmessage; worker.onmessage = (e) => { prev(e); if (e.data.type === 'ready') { worker.onmessage = prev; res(); } };
      worker.postMessage({ type: 'init-station', id, seed: id, answer: false, band: ${band}, ml: true, port: ch.port2 }, [ch.port2]); });
    return st;
  };
  window.A = await mk(0xA1A1, true);
  window.B = await mk(0xB2B2, false);
  await ctx.resume();
  return 'mic: ' + stream.getAudioTracks()[0].label + ' | audio ' + ctx.state;
})()`));

const image = `(async () => {
  const c = new OffscreenCanvas(72, 72); const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 72, 72); grad.addColorStop(0, '#6dff9c'); grad.addColorStop(1, '#5b2a86');
  g.fillStyle = grad; g.fillRect(0, 0, 72, 72); g.fillStyle = '#050a07'; g.beginPath(); g.arc(26, 30, 7, 0, 7); g.arc(46, 30, 7, 0, 7); g.fill();
  g.font = '14px monospace'; g.fillText('GGTF', 18, 58);
  const blob = await c.convertToBlob({ type: 'image/webp', quality: 0.55 });
  const raw = new Uint8Array(await blob.arrayBuffer());
  const bytes = new Uint8Array(6 + raw.length); bytes.set([0, 0x47, 0x49, 1, 72, 72]); bytes.set(raw, 6);
  return bytes;
})()`;
const PROFILES = ["Sturdy", "Balanced", "Fast", "Turbo"];
const tests = [
  { label: "link", profile: 1, chunk: 48, content: "'https://github.com/agkomyint/ggtf'" },
  { label: "link", profile: 2, chunk: 48, content: "'https://github.com/agkomyint/ggtf'" },
  { label: "link", profile: 3, chunk: 48, content: "'https://github.com/agkomyint/ggtf'" },
  { label: "image", profile: 2, chunk: 196, content: image },
  { label: "image", profile: 3, chunk: 196, content: image },
  { label: "image", profile: 3, chunk: 96, content: image },
  { label: "image", profile: 2, chunk: 96, content: image },
];
const rows: string[] = [];
for (const t of tests) {
  const r = await ev<string>(`(async () => {
    const content = await ${t.content};
    const isBytes = content instanceof Uint8Array;
    const len = isBytes ? content.length : new TextEncoder().encode(content).length;
    B.events.length = 0;
    const t0 = performance.now();
    A.worker.postMessage(isBytes ? { type: 'beam-start', bytes: content, profile: ${t.profile}, band: ${band}, rounds: 0, chunk: ${t.chunk} }
                                 : { type: 'beam-start', text: content, profile: ${t.profile}, band: ${band}, rounds: 0, chunk: ${t.chunk} });
    const limit = 90000;
    while (performance.now() - t0 < limit) {
      const got = B.events.find(e => e.type === 'beam_rx');
      if (got) { A.worker.postMessage({ type: 'beam-stop' }); const s = (performance.now() - t0) / 1000;
        return JSON.stringify({ ok: got.bytes === len, len, s: +s.toFixed(1), bps: +(len / s).toFixed(1), heard: B.events.filter(e => e.type === 'rx_frame' && e.kind === 'BEAM').length, failed: B.events.filter(e => e.type === 'rx_failed').length }); }
      await new Promise(r => setTimeout(r, 200));
    }
    A.worker.postMessage({ type: 'beam-stop' });
    const p = [...B.events].reverse().find(e => e.type === 'beam_progress');
    return JSON.stringify({ ok: false, len, s: limit / 1000, progress: p ? p.have + '/' + p.count : 'none', heard: B.events.filter(e => e.type === 'rx_frame' && e.kind === 'BEAM').length, failed: B.events.filter(e => e.type === 'rx_failed').length });
  })()`);
  const o = JSON.parse(r);
  const line = `${(t.label + " " + o.len + " B").padEnd(14)} ${PROFILES[t.profile].padEnd(9)} chunk ${String(t.chunk).padStart(3)}: ${o.ok ? `OK in ${o.s} s = ${o.bps} B/s` : `FAILED (${o.progress})`}  [frames heard ${o.heard}, decode failures ${o.failed}]`;
  console.log(line);
  rows.push(line);
  await sleep(1500);
}
ws.close();
proc.kill();
