// Two full browser stations (AudioWorklet + worker + WASM) in one headless Chrome page,
// joined by a virtual audio cable: each station's input is the mix of both outputs,
// so each also hears its own echo, as with one speaker and one mic.
// Usage: bun scripts/browser-loopback.ts [chromePath] [baseUrl]
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chrome = process.argv[2] ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const base = process.argv[3] ?? "http://localhost:3000";
const port = 9334;
const proc = spawn(chrome, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "ggtf-loop-"))}`,
  "--autoplay-policy=no-user-gesture-required",
  "--no-first-run",
  "about:blank",
]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let wsUrl = "";
for (let i = 0; i < 50 && !wsUrl; i++) {
  try {
    const list = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
    wsUrl = list.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? "";
  } catch {}
  if (!wsUrl) await sleep(200);
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let id = 1;
const waiters = new Map<number, (v: any) => void>();
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data));
  if (m.id) waiters.get(m.id)?.(m);
};
const send = (method: string, params: object = {}) =>
  new Promise<any>((r) => {
    const i = id++;
    waiters.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async <T>(expression: string): Promise<T> => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  return r.result.result.value as T;
};

const setup = `
(async () => {
  const ctx = new AudioContext({ sampleRate: 48000 });
  await ctx.audioWorklet.addModule('/audio/ggtf-processor.js');
  const air = ctx.createGain();
  const noise = ctx.createBufferSource();
  const nb = ctx.createBuffer(1, 48000 * 2, 48000);
  const d = nb.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.03;
  noise.buffer = nb; noise.loop = true; noise.connect(air); noise.start();
  const mk = async (id, answer) => {
    const node = new AudioWorkletNode(ctx, 'ggtf-processor', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
    node.connect(air);
    air.connect(node);
    const worker = new Worker('/audio/ggtf-worker.js', { type: 'module' });
    const ch = new MessageChannel();
    node.port.postMessage({ type: 'port', port: ch.port1 }, [ch.port1]);
    const st = { id, events: [], worker };
    worker.onmessage = (e) => { if (e.data.type === 'events') st.events.push(...e.data.events); if (e.data.type === 'error') st.events.push({ type: 'error', message: e.data.message }); };
    await new Promise((res) => { const prev = worker.onmessage; worker.onmessage = (e) => { prev(e); if (e.data.type === 'ready') { worker.onmessage = prev; res(); } }; worker.postMessage({ type: 'init-station', id, seed: id, answer, port: ch.port2 }, [ch.port2]); });
    return st;
  };
  // keep the graph pulled
  const sink = ctx.createGain(); sink.gain.value = 0; air.connect(sink); sink.connect(ctx.destination);
  window.A = await mk(0xA0A0, false);
  window.B = await mk(0xB0B0, false);
  await ctx.resume();
  window.ctxState = ctx.state;
  return ctx.state;
})()`;

const lastState = (who: string) => `(${who}.events.filter(e => e.type === 'state').at(-1) || {}).state`;
async function waitFor(expr: string, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await evaluate<boolean>(expr)) return true;
    await sleep(500);
  }
  return false;
}

let ok = true;
const t0 = Date.now();
const step = (name: string, pass: boolean) => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  ok &&= pass;
};
try {
  await send("Page.navigate", { url: `${base}/` });
  await sleep(1500);
  console.log("audio context:", await evaluate<string>(setup));
  await evaluate(`A.worker.postMessage({ type: 'call' })`);
  step("B shows an incoming call", await waitFor(`B.events.some(e => e.type === 'incoming' && e.from === 0xA0A0)`, 20000));
  await evaluate(`B.worker.postMessage({ type: 'accept' })`);
  step("pairing over the virtual cable", await waitFor(`${lastState("A")} === 'awaiting_confirm' && ${lastState("B")} === 'awaiting_confirm'`, 90000));
  const words = await evaluate<string>(`JSON.stringify([A.events.find(e => e.type === 'sas')?.words, B.events.find(e => e.type === 'sas')?.words])`);
  const [wa, wb] = JSON.parse(words);
  console.log("      words A:", wa?.join(" "), " B:", wb?.join(" "));
  step("both stations show the same words", !!wa && JSON.stringify(wa) === JSON.stringify(wb));
  await evaluate(`A.worker.postMessage({ type: 'confirm' }); B.worker.postMessage({ type: 'confirm' })`);
  step("connected", await waitFor(`${lastState("A")} === 'connected' && ${lastState("B")} === 'connected'`, 60000));
  const prof = await evaluate<string>(`(A.events.find(e => e.type === 'trained') || {}).profile`);
  console.log("      trained profile:", prof);
  await evaluate(`A.worker.postMessage({ type: 'send', text: 'boo from tab A 👻', ref: 'x' })`);
  step("A → B message arrives", await waitFor(`B.events.some(e => e.type === 'msg_rx' && e.text === 'boo from tab A 👻')`, 60000));
  step("A sees it delivered", await waitFor(`A.events.some(e => e.type === 'msg_status' && e.status === 'delivered')`, 30000));
  await evaluate(`B.worker.postMessage({ type: 'send', text: 'the dead reply', ref: 'y' })`);
  step("B → A message arrives", await waitFor(`A.events.some(e => e.type === 'msg_rx' && e.text === 'the dead reply')`, 60000));
  const own = await evaluate<number>(`A.events.filter(e => e.type === 'rx_frame' && e.own).length`);
  console.log("      own echoes A ignored:", own);
  await evaluate(`A.worker.postMessage({ type: 'hangup' })`);
  step("hang-up reaches both", await waitFor(`${lastState("A")} === 'idle' && ${lastState("B")} === 'idle'`, 60000));
  const errs = await evaluate<string>(`JSON.stringify([...A.events, ...B.events].filter(e => e.type === 'error'))`);
  step("no worker errors", errs === "[]");
} catch (e) {
  console.error(e);
  ok = false;
} finally {
  ws.close();
  proc.kill();
}
console.log(ok ? "LOOPBACK PASSED" : "LOOPBACK FAILED");
process.exit(ok ? 0 : 1);
