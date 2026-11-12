// Headless Chrome check over the DevTools protocol.
// 1. /lab: runs the WASM benchmark in a real browser worker and reads the results table.
// 2. /link: opens the séance with Chrome's fake microphone and checks the worklet + worker start.
// Usage: bun scripts/browser-check.ts [chromePath] [baseUrl]
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chrome = process.argv[2] ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const base = process.argv[3] ?? "http://localhost:3000";
const port = 9333;
const profile = mkdtempSync(join(tmpdir(), "ggtf-chrome-"));
const proc = spawn(chrome, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "--use-fake-device-for-media-stream",
  "--use-fake-ui-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
  "--no-first-run",
  "about:blank",
]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function target(): Promise<string> {
  for (let i = 0; i < 50; i++) {
    try {
      const list = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error("Chrome did not start");
}

const ws = new WebSocket(await target());
await new Promise((r) => (ws.onopen = r));
let nextId = 1;
const waiters = new Map<number, (v: any) => void>();
const consoleLines: string[] = [];
ws.onmessage = (e) => {
  const m = JSON.parse(String(e.data));
  if (m.id && waiters.has(m.id)) {
    waiters.get(m.id)!(m);
    waiters.delete(m.id);
  } else if (m.method === "Runtime.consoleAPICalled") {
    consoleLines.push(`${m.params.type}: ${m.params.args.map((a: any) => a.value ?? a.description).join(" ")}`);
  } else if (m.method === "Runtime.exceptionThrown") {
    consoleLines.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
  }
};
function send(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((r) => waiters.set(id, r));
}
async function evaluate<T = unknown>(expression: string): Promise<T> {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value as T;
}
async function waitFor(expr: string, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await evaluate<boolean>(expr)) return true;
    await sleep(300);
  }
  return false;
}
const clickButton = (text: string) =>
  evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true; })()`);

let failed = false;
try {
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Browser.grantPermissions", { permissions: ["audioCapture"], origin: base }).catch(() => {});

  // ---- /lab ----
  await send("Page.navigate", { url: `${base}/lab` });
  const labReady = await waitFor(`[...document.querySelectorAll('tbody tr')].length >= 10`, 20000);
  console.log("lab: scenarios loaded from WASM:", labReady);
  await evaluate(`(() => { const i = document.querySelector('#frames'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '3'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await clickButton("Run all rooms");
  const labDone = await waitFor(`[...document.querySelectorAll('tbody tr')].every(r => /\\d+%/.test(r.cells[1].textContent))`, 180000);
  const rows = await evaluate<string[][]>(`[...document.querySelectorAll('tbody tr')].map(r => [r.cells[0].textContent, r.cells[1].textContent, r.cells[2].textContent])`);
  console.log("lab: all rooms finished:", labDone);
  for (const r of rows) console.log(`  ${r[0].padEnd(38)} ${r[1].padStart(5)}  ${r[2]}`);
  if (!labReady || !labDone) failed = true;

  // ---- /link ----
  await send("Page.navigate", { url: `${base}/link` });
  await waitFor(`!!document.querySelector('h1')`, 10000);
  await sleep(500);
  await clickButton("Open the séance");
  const started = await waitFor(`document.body.innerText.includes('listening at')`, 15000);
  const station = await evaluate<string>(`document.body.innerText.match(/station #[0-9A-F]{4}/)?.[0] ?? ''`);
  const rate = await evaluate<string>(`document.body.innerText.match(/(\\d+) Hz/)?.[0] ?? ''`);
  console.log("link: séance opened (worklet + worker + WASM running):", started, station, rate);
  await clickButton("Summon");
  const calling = await waitFor(`document.body.innerText.includes('→ CALL')`, 10000);
  console.log("link: CALL frame handed to the speaker:", calling);
  const heardOwn = await waitFor(`/Own echoes ignored\\s*[1-9]/.test(document.body.innerText)`, 8000);
  console.log("link: decoded its own CALL through the fake mic (expected false, fake mic plays a fixed tone):", heardOwn);
  if (!started || !calling) failed = true;

  const errors = consoleLines.filter((l) => /^(error|exception)/.test(l));
  console.log("console errors:", errors.length ? errors : "none");
  if (errors.length) failed = true;
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  ws.close();
  proc.kill();
}
console.log(failed ? "BROWSER CHECK FAILED" : "BROWSER CHECK PASSED");
process.exit(failed ? 1 : 0);
