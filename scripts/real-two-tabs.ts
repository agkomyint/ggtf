// Real-world test: a visible Chrome window, two tabs on /link, real speaker and real microphone.
// Clicks Open in both tabs, Call in tab A, Accept in tab B, They match in both, then sends a message.
// Usage: bun scripts/real-two-tabs.ts [baseUrl]
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] ?? "http://localhost:3210";
const port = 9340;
const proc = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "ggtf-real-"))}`,
  "--use-fake-ui-for-media-stream", // auto-allow the REAL microphone (no fake device)
  "--autoplay-policy=no-user-gesture-required",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "--no-first-run",
  "--new-window",
  `${base}/link`,
]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function targets(): Promise<any[]> {
  return (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as any[];
}
for (let i = 0; i < 60; i++) {
  try { if ((await targets()).some((t) => t.type === "page")) break; } catch {}
  await sleep(250);
}
await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(base + "/link")}`, { method: "PUT" });
await sleep(1500);
const pages = (await targets()).filter((t) => t.type === "page" && t.url.includes("/link"));
if (pages.length < 2) throw new Error(`expected 2 tabs, got ${pages.length}`);

class Tab {
  ws: WebSocket;
  id = 1;
  w = new Map<number, (v: any) => void>();
  constructor(public name: string, url: string) { this.ws = new WebSocket(url); this.ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); if (m.id) this.w.get(m.id)?.(m); }; }
  open() { return new Promise((r) => (this.ws.onopen = r)); }
  send(method: string, params: object = {}) { return new Promise<any>((r) => { const i = this.id++; this.w.set(i, r); this.ws.send(JSON.stringify({ id: i, method, params })); }); }
  async ev<T = any>(expression: string): Promise<T> { return (await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true })).result?.result?.value; }
  click(text: string) { return this.ev<boolean>(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(text)}) && !b.disabled); if (!b) return false; b.click(); return true; })()`); }
  text() { return this.ev<string>(`document.body.innerText`); }
  log() { return this.ev<string[]>(`[...document.querySelectorAll('.font-mono.text-xs > div')].map(d => d.textContent)`); }
  async waitText(re: RegExp, ms: number) { const end = Date.now() + ms; while (Date.now() < end) { if (re.test(await this.text())) return true; await sleep(400); } return false; }
}
const A = new Tab("A", pages[0].webSocketDebuggerUrl);
const B = new Tab("B", pages[1].webSocketDebuggerUrl);
await Promise.all([A.open(), B.open()]);
await sleep(1500);

const t0 = Date.now();
const say = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(5)} s] ${s}`);
let ok = true;
const check = (name: string, pass: boolean) => { say(`${pass ? "PASS" : "FAIL"} ${name}`); ok &&= pass; return pass; };

try {
  check("A: Open the séance", await A.click("Open the séance"));
  check("B: Open the séance", await B.click("Open the séance"));
  check("A listening", await A.waitText(/listening at \d+ Hz/, 15000));
  check("B listening", await B.waitText(/listening at \d+ Hz/, 15000));
  say(`A output device: ${(await A.text()).match(/Output: [^\n]+/)?.[0]}`);
  await A.click("Test speaker");
  await sleep(300);
  say(`A speaker level during test beep: ${await A.ev(`(() => { const a = window.__ggtf.outMeter; const d = new Float32Array(a.fftSize); a.getFloatTimeDomainData(d); return Math.max(...d.map(Math.abs)).toFixed(3); })()`)}`);
  await sleep(1000);

  check("A: Call", await A.click("Call"));
  const rang = check("B shows Incoming call", await B.waitText(/Incoming call/, 30000));
  if (rang) {
    check("B: Accept", await B.click("Accept"));
    const paired = check("both show the pairing words", (await A.waitText(/Do the words match/, 90000)) && (await B.waitText(/Do the words match/, 30000)));
    if (paired) {
      const wa = (await A.ev<string[]>(`[...document.querySelectorAll('[role=dialog] .font-display.text-2xl')].map(e => e.textContent)`)) ?? [];
      const wb = (await B.ev<string[]>(`[...document.querySelectorAll('[role=dialog] .font-display.text-2xl')].map(e => e.textContent)`)) ?? [];
      say(`words A: ${wa.join(" ")} | B: ${wb.join(" ")}`);
      check("words match", wa.length === 4 && wa.join() === wb.join());
      await A.click("They match");
      await B.click("They match");
      if (check("connected", (await A.waitText(/Connected through|Type a message/, 60000)) && (await B.waitText(/Type a message/, 30000)))) {
        await A.ev(`(() => { const i = document.querySelector('input[aria-label=Message]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'hello from tab A 👻'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        await sleep(200);
        await A.click("Send");
        check("B received the message", await B.waitText(/hello from tab A/, 60000));
        check("A shows delivered", await A.waitText(/delivered/, 30000));
      }
    }
  }
} catch (e) {
  console.error(e);
  ok = false;
}
for (const t of [A, B]) {
  const txt = await t.text();
  const stat = (k: string) => txt.match(new RegExp(`${k}\\s*\\n?\\s*([^\\n]+)`))?.[1];
  say(`${t.name} stats: sent ${stat("Frames sent")}, heard ${stat("Frames heard")}, own echoes ${stat("Own echoes ignored")}, preambles ${stat("Preambles detected")}, failures ${stat("Decode failures")}`);
  console.log(`---- ${t.name} event log (last 25) ----`);
  for (const l of ((await t.log()) ?? []).slice(-25)) console.log("  " + l);
}
console.log(ok ? "REAL TWO-TAB TEST PASSED" : "REAL TWO-TAB TEST FAILED");
A.ws.close();
B.ws.close();
proc.kill();
process.exit(ok ? 0 : 1);
