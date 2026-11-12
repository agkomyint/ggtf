// Screenshots of /link before and after "Open the séance" (fake mic). Usage: bun scripts/screenshot.ts [baseUrl] [outDir]
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] ?? "http://localhost:3210";
const out = process.argv[3] ?? join(tmpdir(), "ggtf-shots");
const port = 9335;
const proc = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "ggtf-shot-"))}`,
  "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--window-size=1400,1800", "about:blank",
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
const shot = async (name: string) => {
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  const p = join(out, name);
  require("node:fs").mkdirSync(out, { recursive: true });
  writeFileSync(p, Buffer.from(r.result.data, "base64"));
  console.log(p);
};
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 1700, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: `${base}/link` });
await sleep(3000);
await shot("1-before.png");
await send("Runtime.evaluate", { expression: `[...document.querySelectorAll('button')].find(b => b.textContent.includes('Open the'))?.click()` });
await sleep(4000);
await shot("2-after-open.png");
ws.close();
proc.kill();
