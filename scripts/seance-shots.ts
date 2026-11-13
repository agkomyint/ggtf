// Screenshots of Spirit Studio (desktop and phone) and Séance OS. Usage: bun scripts/seance-shots.ts [baseUrl] [outDir]
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] ?? "http://localhost:3210";
const out = process.argv[3] ?? join(process.cwd(), ".shots", "seance");
const port = 9361;
const proc = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "ggtf-sshot-"))}`,
  "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--window-size=1440,1000", "about:blank",
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
const ev = (expression: string) => send("Runtime.evaluate", { expression, awaitPromise: true, userGesture: true });
const click = (text: string) => ev(`[...document.querySelectorAll('button,[role=tab]')].find(b => b.textContent.includes(${JSON.stringify(text)}) && !b.disabled)?.click()`);
mkdirSync(out, { recursive: true });
const shot = async (name: string) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(out, name), Buffer.from(r.result.data, "base64"));
  console.log(join(out, name));
};
const viewport = (width: number, height: number, mobile = false) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });

await send("Page.enable");
await viewport(1440, 1000);
await send("Page.navigate", { url: `${base}/studio` });
await sleep(3000);
await click("Run");
await sleep(2500);
await click("Network");
await sleep(500);
await shot("studio-desktop.png");
await viewport(390, 844, true);
await sleep(800);
await click("Preview");
await sleep(800);
await shot("studio-phone-preview.png");
await click("Code");
await sleep(800);
await shot("studio-phone-code.png");
await viewport(1440, 1000);
await sleep(500);
await click("Publish");
await sleep(2500);
await send("Page.navigate", { url: `${base}/seance` });
await sleep(3000);
await shot("seance-library.png");
await click("Open");
await sleep(2500);
await shot("seance-window.png");
await send("Page.navigate", { url: `${base}/docs` });
await sleep(2000);
await shot("docs.png");
ws.close();
proc.kill();
