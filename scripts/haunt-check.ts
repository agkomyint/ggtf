// Real-air test of the haunted-room sandbox: two tabs of /haunt in one Chrome, real speaker and mic.
// Tab B is the room, tab A the remote. The remote types the room code and presses buttons; we check
// that the room obeys, and that a wrong code is ignored.
// Usage: bun scripts/haunt-check.ts [baseUrl]
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] ?? "http://localhost:3210";
const port = 9343;
const proc = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "ggtf-haunt-"))}`,
  "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--no-first-run",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", `${base}/haunt`,
]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const targets = async () => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as any[];
for (let i = 0; i < 60; i++) {
  try { if ((await targets()).some((t) => t.type === "page")) break; } catch {}
  await sleep(250);
}
await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(base + "/haunt")}`, { method: "PUT" });
await sleep(2500);
const pages = (await targets()).filter((t) => t.type === "page" && t.url.includes("/haunt"));

class Tab {
  ws: WebSocket;
  id = 1;
  w = new Map<number, (v: any) => void>();
  constructor(url: string) { this.ws = new WebSocket(url); this.ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); if (m.id) this.w.get(m.id)?.(m); }; }
  open() { return new Promise((r) => (this.ws.onopen = r)); }
  send(method: string, params: object = {}) { return new Promise<any>((r) => { const i = this.id++; this.w.set(i, r); this.ws.send(JSON.stringify({ id: i, method, params })); }); }
  async ev<T = any>(e: string): Promise<T> { return (await this.send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true, userGesture: true })).result?.result?.value; }
  click(text: string) { return this.ev<boolean>(`(() => { const b = [...document.querySelectorAll('button,[role=tab]')].find(b => b.textContent.includes(${JSON.stringify(text)}) && !b.disabled); if (!b) return false; b.click(); return true; })()`); }
  text() { return this.ev<string>(`document.body.innerText`); }
  async waitText(re: RegExp, ms: number) { const end = Date.now() + ms; while (Date.now() < end) { if (re.test(await this.text())) return true; await sleep(300); } return false; }
}
const A = new Tab(pages[0].webSocketDebuggerUrl);
const B = new Tab(pages[1].webSocketDebuggerUrl);
await Promise.all([A.open(), B.open()]);
const t0 = Date.now();
let ok = true;
const step = (name: string, pass: boolean) => { console.log(`${pass ? "PASS" : "FAIL"}  ${name}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`); ok &&= pass; };

try {
  await A.click("Open the séance");
  await B.click("Open the séance");
  step("both tabs listening", (await A.waitText(/Listening on all bands/, 15000)) && (await B.waitText(/Listening on all bands/, 15000)));
  const code = await B.ev<string>(`document.body.innerText.match(/Room code \\(type this on the remote\\)\\s*(\\d{4})/)?.[1]`);
  console.log("      room code:", code);
  await A.click("I am the remote");
  await sleep(500);
  await A.ev(`(() => { const i = document.querySelector('#code'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(code)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(300);

  const press = async (button: string, expect: RegExp, label: string) => {
    const t = Date.now();
    await A.click(button);
    const pass = await B.waitText(expect, 20000);
    step(`${label} (${((Date.now() - t) / 1000).toFixed(1)} s)`, pass);
    await sleep(2500); // let the second round finish so commands don't overlap
  };
  await press("Blood red", /lamp → #ff3355/, "lamp turns blood red");
  await press("Summon ghost", /ghost appears/, "ghost appears");
  await press("Open door", /door opened/, "door opens");

  // Wrong code must be ignored.
  const wrong = String((Number(code) % 9000) + 1000 === Number(code) ? Number(code) + 1 : 1000).padStart(4, "0");
  await A.ev(`(() => { const i = document.querySelector('#code'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(wrong)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(300);
  await A.click("Close door");
  step("command with the wrong code is ignored", await B.waitText(/ignored door closed: wrong room code/, 20000));
  const doorStillOpen = !(await B.text()).includes("door closed (from");
  step("door stayed open", doorStillOpen);
} catch (e) {
  console.error(e);
  ok = false;
}
const heard = await B.ev<string>(`[...document.querySelectorAll('li.text-primary, li.text-muted-foreground')].map(l => l.textContent).join('\\n')`);
console.log("---- what the room heard ----\n" + heard);
console.log(ok ? "HAUNT CHECK PASSED" : "HAUNT CHECK FAILED");
A.ws.close();
B.ws.close();
proc.kill();
process.exit(ok ? 0 : 1);
