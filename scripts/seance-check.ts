// End-to-end check of Spirit Studio and Séance OS in headless Chrome.
//
// Part 1 (no sound needed): Studio runs Ghost Grid as two peers over the instant transport and
// over sim air (the real Rust modem in a worker), then Spirit Board (GhostDB sync, offline edits
// merged on reconnect) and Ghost Wiki (GGTP serve/get). Publishes Ghost Grid to Séance OS.
//
// Part 2 (--air, uses the real speaker and mic): a second Chrome with an empty profile receives
// Ghost Grid over sound, installs it after the signature check, and the two play a move together.
//
// Usage: bun scripts/seance-check.ts [baseUrl] [--air]
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3210";
const withAir = process.argv.includes("--air");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
let ok = true;
const step = (name: string, pass: boolean, extra = "") => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${extra ? `  ${extra}` : ""}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  ok &&= pass;
  return pass;
};

class Tab {
  ws: WebSocket;
  id = 1;
  w = new Map<number, (v: any) => void>();
  contexts = new Map<number, { frameId: string }>();
  /** Out-of-process iframes (Chrome isolates sandboxed frames): CDP session ids. */
  frames = new Set<string>();
  mainFrame = "";
  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (m.id) this.w.get(m.id)?.(m);
      else if (m.method === "Runtime.executionContextCreated" && !m.sessionId && m.params.context.auxData?.isDefault) this.contexts.set(m.params.context.id, { frameId: m.params.context.auxData.frameId });
      else if (m.method === "Runtime.executionContextDestroyed" && !m.sessionId) this.contexts.delete(m.params.executionContextId);
      else if (m.method === "Runtime.executionContextsCleared" && !m.sessionId) this.contexts.clear();
      else if (m.method === "Target.attachedToTarget" && m.params.targetInfo.type === "iframe") {
        const sid = m.params.sessionId;
        this.frames.add(sid);
        void this.send("Runtime.enable", {}, sid);
        void this.send("Runtime.runIfWaitingForDebugger", {}, sid);
      } else if (m.method === "Target.detachedFromTarget") this.frames.delete(m.params.sessionId);
    };
  }
  async open() {
    await new Promise((r) => (this.ws.onopen = r));
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    this.mainFrame = (await this.send("Page.getFrameTree")).result.frameTree.frame.id;
  }
  send(method: string, params: object = {}, sessionId?: string) {
    return new Promise<any>((r) => {
      const i = this.id++;
      this.w.set(i, r);
      this.ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  /** `where` is an in-process context id or an iframe session id. */
  async ev<T = any>(e: string, where?: number | string): Promise<T> {
    const params = { expression: e, awaitPromise: true, returnByValue: true, userGesture: true, ...(typeof where === "number" ? { contextId: where } : {}) };
    const r = await this.send("Runtime.evaluate", params, typeof where === "string" ? where : undefined);
    return r.result?.result?.value;
  }
  click(text: string, selector = "button,[role=tab]") {
    return this.ev<boolean>(
      `(() => { const b = [...document.querySelectorAll(${JSON.stringify(selector)})].find(b => b.textContent.includes(${JSON.stringify(text)}) && !b.disabled); if (!b) return false; b.click(); return true; })()`,
    );
  }
  text() {
    return this.ev<string>(`document.body.innerText`);
  }
  async waitText(re: RegExp, ms: number) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (re.test((await this.text()) ?? "")) return true;
      await sleep(250);
    }
    return false;
  }
  async goto(url: string) {
    await this.send("Page.navigate", { url });
    await sleep(1500);
    this.mainFrame = (await this.send("Page.getFrameTree")).result.frameTree.frame.id;
  }
  /** Running spirits by side ("a", "b" or "me"): an iframe session id or a context id. */
  async spirits(): Promise<Record<string, number | string>> {
    const out: Record<string, number | string> = {};
    const where: (number | string)[] = [...this.frames, ...[...this.contexts].filter(([, c]) => c.frameId !== this.mainFrame).map(([id]) => id)];
    for (const w of where) {
      const side = await this.ev<string | null>(`typeof spirit === "undefined" ? null : spirit.me.side`, w);
      if (side) out[side] = w;
    }
    return out;
  }
  async waitIn(ctx: number | string, expr: string, ms: number) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await this.ev<boolean>(expr, ctx)) return true;
      await sleep(200);
    }
    return false;
  }
  setValue(selector: string, value: string, ctx?: number | string, proto = "HTMLInputElement") {
    return this.ev(
      `(() => { const i = document.querySelector(${JSON.stringify(selector)}); const set = Object.getOwnPropertyDescriptor(${proto}.prototype, 'value').set; set.call(i, ${JSON.stringify(value)}); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
      ctx,
    );
  }
}

async function chrome(port: number, profile: string, url: string, audio: boolean): Promise<{ proc: ChildProcess; tab: Tab }> {
  const args = [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--autoplay-policy=no-user-gesture-required",
    "--no-first-run",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--window-size=1440,1000",
    audio ? "--use-fake-ui-for-media-stream" : "--use-fake-device-for-media-stream",
    url,
  ];
  if (!audio) args.push("--use-fake-ui-for-media-stream");
  const proc = spawn(CHROME, args);
  let target: any = null;
  for (let i = 0; i < 80 && !target; i++) {
    try {
      target = ((await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as any[]).find((t) => t.type === "page");
    } catch {}
    if (!target) await sleep(250);
  }
  const tab = new Tab(target.webSocketDebuggerUrl);
  await tab.open();
  await sleep(2000);
  return { proc, tab };
}

const allReady = (n: number) => new RegExp(`(\\bready\\b[\\s\\S]*){${n}}`);
const markIn = `document.querySelectorAll('#board button')[0].textContent`;
const procs: ChildProcess[] = [];

try {
  // ---------------- part 1: studio ----------------
  const profileA = mkdtempSync(join(tmpdir(), "ggtf-seance-a-"));
  const { proc, tab: S } = await chrome(9351, profileA, `${base}/studio`, false);
  procs.push(proc);
  step("studio opens with a Ghost Grid project", await S.waitText(/Spirit Studio[\s\S]*Ghost Grid/, 15000));

  await S.click("Run");
  step("instant: A and B say HELLO and are ready", await S.waitText(allReady(2), 10000));
  let sp = await S.spirits();
  step("two sandboxed spirits found", !!sp.a && !!sp.b, JSON.stringify(sp));
  step("A (lower device id) has the first move", (await S.ev<string>(`document.getElementById('status').textContent`, sp.a))?.includes("Your move"));
  await S.ev(`document.querySelector('#board button:not(:disabled)').click()`, sp.a);
  step("instant: A's move shows up on B", await S.waitIn(sp.b, `${markIn} === "👻"`, 5000));
  step("network tab logged the MSG", (await S.click("Network")) && (await S.waitText(/\bMSG\b/, 3000)));
  const sandboxed = await S.ev<string>(`(() => { try { return String(document.querySelector('iframe').contentDocument) } catch (e) { return "blocked" } })()`);
  step("the OS can't reach into the spirit (opaque origin)", sandboxed === "null" || sandboxed === "blocked", sandboxed);
  const inside = await S.ev<string>(`(() => { try { return String(parent.document.title) } catch (e) { return "blocked" } })()`, sp.a);
  step("the spirit can't reach the OS page", inside === "blocked", inside);
  const escape = await S.ev<string>(`(async () => { try { await fetch("${base}/"); return "fetched" } catch (e) { return "blocked" } })()`, sp.a);
  step("CSP blocks network requests from inside a spirit (even same server)", escape === "blocked", escape);
  const storage = await S.ev<string>(`(() => { try { localStorage.getItem("ggtf.author.secret"); return "readable" } catch (e) { return "blocked" } })()`, sp.a);
  step("a spirit can't read the author key in localStorage", storage === "blocked", storage);
  const post = await S.ev<string>(
    `new Promise(res => { document.addEventListener('securitypolicyviolation', e => res(e.violatedDirective), { once: true }); const f = document.createElement('form'); f.action = "${base}/api/diag"; f.method = 'post'; document.body.append(f); f.requestSubmit(); setTimeout(() => res('not blocked'), 1500); })`,
    sp.a,
  );
  step("CSP blocks a real form post", post === "form-action", post);

  // sim air
  await S.click("Sim air (real modem)");
  await sleep(300);
  await S.click("Restart");
  const tPair = Date.now();
  const paired = await S.waitText(allReady(2), 120_000);
  const simAt = (await S.text()).match(/sim ([\d.]+) s/)?.[1];
  step("sim air: the two Rust stations pair and say HELLO", paired, `${((Date.now() - tPair) / 1000).toFixed(1)} s real, ${simAt} s simulated`);
  await sleep(500);
  sp = await S.spirits();
  await S.ev(`document.querySelector('#board button:not(:disabled)').click()`, sp.a);
  const tMove = Date.now();
  const moved = await S.waitIn(sp.b, `${markIn} === "👻"`, 60_000);
  step("sim air: A's move crosses the simulated air to B", moved, `${((Date.now() - tMove) / 1000).toFixed(1)} s real at 1×`);

  // Spirit Board: GhostDB sync, including offline edits merged on reconnect.
  await S.click("Instant");
  await S.click("New");
  await sleep(400);
  await S.click("Spirit Board", "[data-slot=card]");
  await sleep(800);
  await S.click("Run");
  step("Spirit Board ready", await S.waitText(allReady(2), 10000));
  sp = await S.spirits();
  await S.setValue("#t", "the candle went out", sp.a);
  await S.ev(`document.getElementById('f').requestSubmit()`, sp.a);
  step("GhostDB: A's note syncs to B", await S.waitIn(sp.b, `document.getElementById('notes').textContent.includes("the candle went out")`, 5000));
  await S.click("Disconnect");
  await sleep(300);
  await S.setValue("#t", "written while apart", sp.b);
  await S.ev(`document.getElementById('f').requestSubmit()`, sp.b);
  await sleep(300);
  const leaked = await S.ev<boolean>(`document.getElementById('notes').textContent.includes("written while apart")`, sp.a);
  await S.click("Connect");
  step("GhostDB: B's offline note arrives after reconnecting (and not before)", !leaked && (await S.waitIn(sp.a, `document.getElementById('notes').textContent.includes("written while apart")`, 5000)));

  // Ghost Wiki: GGTP serve and get.
  await S.click("New");
  await sleep(400);
  await S.click("Ghost Wiki", "[data-slot=card]");
  await sleep(800);
  await S.click("Run");
  step("Ghost Wiki ready", await S.waitText(allReady(2), 10000));
  sp = await S.spirits();
  await S.ev(`document.querySelector('details').open = true`, sp.a);
  await S.setValue("#title", "Vampire", sp.a);
  await S.setValue("#body", "Avoids garlic and mirrors.", sp.a, "HTMLTextAreaElement");
  await S.ev(`document.getElementById('w').requestSubmit()`, sp.a);
  await sleep(300);
  await S.setValue("#q", "garlic", sp.b);
  await S.ev(`document.getElementById('ask').click()`, sp.b);
  step("GGTP: B searches A's private pages", await S.waitIn(sp.b, `document.getElementById('hits').textContent.includes("Vampire (theirs)")`, 5000));
  await S.ev(`document.querySelector('#hits a').click()`, sp.b);
  step("GGTP: B fetches the page from A", await S.waitIn(sp.b, `document.getElementById('page').textContent.includes("Avoids garlic")`, 5000));
  const privateStays = await S.ev<boolean>(`spirit.db.list("local:").then(l => !l.some(e => e.value.title === "Vampire"))`, sp.b);
  step("local: pages did not sync by themselves", privateStays);

  // Publish Ghost Grid.
  const gridId = await S.ev<string>(`[...document.querySelector('select[aria-label=Project]').options].find(o => o.text === "Ghost Grid").value`);
  await S.setValue("select[aria-label=Project]", gridId, undefined, "HTMLSelectElement");
  await sleep(800);
  await S.click("Publish");
  step("publish signs Ghost Grid into the library", await S.waitText(/Ghost Grid v1 is in your Séance OS library/, 15000));
  await S.goto(`${base}/seance`);
  step("Séance OS lists it as published here", await S.waitText(/Ghost Grid[\s\S]*published on this device/, 10000));

  // ---------------- part 2: real air ----------------
  if (withAir) {
    const { proc: pb, tab: B } = await chrome(9352, mkdtempSync(join(tmpdir(), "ggtf-seance-b-")), `${base}/seance`, true);
    procs.push(pb);
    // Restart A with real audio on the same profile.
    S.ws.close();
    proc.kill();
    await sleep(1500);
    const { proc: pa, tab: A } = await chrome(9353, profileA, `${base}/seance`, true);
    procs.push(pa);
    await A.click("Turn on sound");
    await B.click("Turn on sound");
    step("both devices listening", (await A.waitText(/listening/, 15000)) && (await B.waitText(/listening/, 15000)));
    await B.click("Receive");
    await A.click("Share over sound");
    await sleep(500);
    await A.click("Start beaming");
    const tShare = Date.now();
    const offered = await B.waitText(/Summon “Ghost Grid”\?/, 300_000);
    step("B hears the spirit and checks its signature", offered, `${((Date.now() - tShare) / 1000).toFixed(1)} s`);
    await A.click("Stop");
    await A.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await B.click("Summon");
    step("B installs it", await B.waitText(/bound to this device/, 5000));
    await sleep(1500);
    step("B's library lists it, from A's station", await B.waitText(/Ghost Grid[\s\S]*received from #/, 5000));
    await B.click("Open");
    await A.click("Open");
    await sleep(1500);
    step("B can press Play together", await B.click("Play together"));
    const tCall = Date.now();
    step("A is asked to play Ghost Grid", await A.waitText(/Play Ghost Grid\?/, 60_000));
    await A.click("Accept and open");
    const sas = (await A.waitText(/Do the words match/, 90_000)) && (await B.waitText(/Do the words match/, 30_000));
    step("pairing words shown on both", sas, `${((Date.now() - tCall) / 1000).toFixed(1)} s`);
    // People don't press at the same millisecond; pressing together would make both CONFIRM frames collide.
    await A.click("They match");
    await sleep(2500);
    await B.click("They match");
    const tConfirm = Date.now();
    const both = (await A.waitText(/playing together/, 90_000)) && (await B.waitText(/playing together/, 30_000));
    step("HELLO matches: playing together over real sound", both, `${((Date.now() - tConfirm) / 1000).toFixed(1)} s after the second confirm, ${((Date.now() - tCall) / 1000).toFixed(1)} s from the call`);
    const ca = (await A.spirits()).me;
    const cb = (await B.spirits()).me;
    const aFirst = (await A.ev<string>(`document.getElementById('status').textContent`, ca))?.includes("Your move");
    const [mover, watcher, cm, cw] = aFirst ? [A, B, ca, cb] : [B, A, cb, ca];
    await mover.ev(`document.querySelector('#board button:not(:disabled)').click()`, cm);
    const tm = Date.now();
    const crossed = await watcher.waitIn(cw, `${markIn} === "👻"`, 90_000);
    step("a move crosses the room by sound", crossed, `${((Date.now() - tm) / 1000).toFixed(1)} s`);
    // And back: the other side answers with a move of its own.
    await sleep(500);
    await watcher.ev(`document.querySelector('#board button:not(:disabled)').click()`, cw);
    const tr = Date.now();
    const back = await mover.waitIn(cm, `[...document.querySelectorAll('#board button')].some(b => b.textContent === "🎃")`, 90_000);
    step("the reply move crosses back", back, `${((Date.now() - tr) / 1000).toFixed(1)} s`);
  }
} catch (e) {
  step(`crashed: ${e instanceof Error ? e.stack : e}`, false);
} finally {
  for (const p of procs) p.kill();
}
console.log(ok ? "\nALL PASS" : "\nSOME CHECKS FAILED");
process.exit(ok ? 0 : 1);
