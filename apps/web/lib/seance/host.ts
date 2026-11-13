// The OS side of the iframe bridge. Every call from a spirit arrives here, gets checked
// against the spirit's permissions, and goes to the session (peer, GGTP) or the GhostDB.

import type { Manifest } from "./bundle";
import { isSuccess, statusText, type Method } from "./ggtp";
import type { SpiritSession } from "./session";

export interface HostLog {
  level: "log" | "info" | "warn" | "error" | "os";
  text: string;
  at: number;
}

type Call = { t: "call"; id: number; fn: string; args: unknown[] };

const METHODS: Method[] = ["GET", "POST", "PUT", "DELETE"];
/** One link message carries up to 12,000 bytes; leave room for the GGTP header and topic. */
export const MAX_PEER_MESSAGE = 11_500;

export class SpiritHost {
  private win: Window | null = null;
  private servedRoutes = new Map<string, () => void>();
  private watches = new Map<string, () => void>();
  private serveSeq = 0;
  private serving = new Map<number, (r: { ok: boolean; value?: unknown; error?: string }) => void>();
  private unsub: (() => void)[] = [];
  private wid = 0;

  constructor(
    private session: SpiritSession,
    private manifest: Manifest,
    private onLog: (l: HostLog) => void,
  ) {
    this.unsub.push(session.db.watch("", (c) => this.evt("db:change", c)));
    this.unsub.push(
      session.listen({
        peerJoin: (p) => this.evt("peer:join", p),
        peerLeave: (reason) => this.evt("peer:leave", { reason }),
        peerMsg: (topic, body) => this.evt("peer:msg", { topic, body }),
        receiving: (bytes) => this.evt("peer:receiving", { bytes }),
        synced: (pulled) => this.evt("db:synced", { pulled }),
      }),
    );
  }

  /** Points the host at a (re)loaded iframe. */
  attach(win: Window | null) {
    this.win = win;
    for (const off of this.servedRoutes.values()) off();
    this.servedRoutes.clear();
    for (const stop of this.watches.values()) stop();
    this.watches.clear();
  }

  dispose() {
    this.attach(null);
    this.unsub.forEach((f) => f());
  }

  evt(name: string, data: unknown) {
    this.win?.postMessage({ t: "evt", name, data }, "*");
  }

  /** The page forwards every window message here; only our iframe's are handled. */
  handle(e: MessageEvent) {
    if (!this.win || e.source !== this.win) return;
    const m = e.data as { t?: string };
    if (!m || typeof m !== "object") return;
    if (m.t === "log") {
      const l = m as unknown as { level: HostLog["level"]; text: string };
      this.onLog({ level: l.level, text: String(l.text).slice(0, 2000), at: Date.now() });
    } else if (m.t === "hello") {
      if (this.session.state === "ready" && this.session.peer) this.evt("peer:join", this.session.peer);
    } else if (m.t === "call") {
      void this.call(m as Call);
    } else if (m.t === "served") {
      const r = m as unknown as { id: number; ok: boolean; value?: unknown; error?: string };
      this.serving.get(r.id)?.(r);
      this.serving.delete(r.id);
    }
  }

  private need(p: "peer" | "db") {
    if (!this.manifest.permissions.includes(p)) throw new Error(`this spirit didn't ask for the "${p}" permission (add it to spirit.json)`);
  }

  private async call(c: Call) {
    let value: unknown = null;
    try {
      value = await this.run(c.fn, Array.isArray(c.args) ? c.args : []);
      this.win?.postMessage({ t: "ret", id: c.id, ok: true, value }, "*");
    } catch (err) {
      this.win?.postMessage({ t: "ret", id: c.id, ok: false, error: err instanceof Error ? err.message : String(err) }, "*");
    }
  }

  private async run(fn: string, a: unknown[]): Promise<unknown> {
    const s = this.session;
    switch (fn) {
      case "db.get":
        this.need("db");
        return s.db.get(String(a[0]));
      case "db.put":
        this.need("db");
        s.db.put(String(a[0]), a[1]);
        return true;
      case "db.del":
        this.need("db");
        s.db.del(String(a[0]));
        return true;
      case "db.list":
        this.need("db");
        return s.db.list(String(a[0] ?? ""));
      case "peer.send": {
        this.need("peer");
        const topic = String(a[0] ?? "");
        if (!topic) throw new Error("peer.send needs a topic");
        const size = JSON.stringify(a[1] ?? null).length;
        if (size > MAX_PEER_MESSAGE) throw new Error(`that message is ${size} bytes; one message can carry up to ${MAX_PEER_MESSAGE} (about 4–5 minutes of sound)`);
        if (s.state !== "ready") throw new Error("no peer is connected");
        const pid = a[2];
        const ok = await s.send(topic, a[1], pid ? (sent, total) => this.evt("peer:progress", { pid, sent, total }) : undefined);
        if (!ok) throw new Error("the message didn't make it across (the link dropped)");
        return true;
      }
      case "ggtp.request": {
        this.need("peer");
        const method = String(a[0]).toUpperCase() as Method;
        if (!METHODS.includes(method)) throw new Error(`unknown method ${method}`);
        const path = String(a[1] ?? "");
        if (!path.startsWith("/") || path.startsWith("/~")) throw new Error('paths start with "/" (and "/~" is reserved)');
        const opts = (a[3] ?? {}) as { timeoutMs?: number };
        const r = await s.ggtp.request(method, path, a[2], { timeoutMs: opts.timeoutMs });
        return { status: statusText(r.status), code: r.status, ok: isSuccess(r.status), body: r.body };
      }
      case "ggtp.watch": {
        this.need("peer");
        const path = String(a[0] ?? "");
        if (!path.startsWith("/") || path.startsWith("/~")) throw new Error('paths start with "/"');
        const wid = `w${++this.wid}`;
        const r = await s.ggtp.watch(path, (body) => this.evt("ggtp:notify", { wid, body }));
        if (isSuccess(r.status)) this.watches.set(wid, r.cancel);
        return { wid: isSuccess(r.status) ? wid : null, status: statusText(r.status), ok: isSuccess(r.status), body: r.body };
      }
      case "ggtp.unwatch": {
        const stop = this.watches.get(String(a[0]));
        stop?.();
        this.watches.delete(String(a[0]));
        return true;
      }
      case "serve": {
        this.need("peer");
        const method = String(a[0]).toUpperCase() as Method;
        const path = String(a[1] ?? "");
        if (!METHODS.includes(method)) throw new Error(`can't serve ${method}`);
        if (!path.startsWith("/") || path.startsWith("/~")) throw new Error('served paths start with "/" (and "/~" is reserved)');
        const key = `${method} ${path}`;
        this.servedRoutes.get(key)?.();
        this.servedRoutes.set(
          key,
          s.ggtp.route(method, path, (req) => this.forward(key, req)),
        );
        return true;
      }
      case "notify":
        this.need("peer");
        return s.ggtp.notify(String(a[0] ?? ""), a[1]);
      default:
        throw new Error(`unknown call ${fn}`);
    }
  }

  /** Runs a served route inside the iframe and waits for its answer. */
  private forward(key: string, req: unknown): Promise<unknown> {
    const win = this.win;
    if (!win) return Promise.reject(new Error("the spirit is not running"));
    const id = ++this.serveSeq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.serving.delete(id);
        reject(new Error("the spirit's handler took longer than 10 s"));
      }, 10_000);
      this.serving.set(id, (r) => {
        clearTimeout(timer);
        if (r.ok) resolve(r.value);
        else reject(new Error(r.error ?? "handler failed"));
      });
      win.postMessage({ t: "serve", id, key, req }, "*");
    });
  }
}
