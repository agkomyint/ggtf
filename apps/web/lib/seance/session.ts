// A spirit session: one running spirit on one device, plus (when linked) the peer running the
// same spirit. It owns the GGTP endpoint and the GhostDB, checks HELLO, and syncs the database.

import { GgtpEndpoint, STATUS, isSuccess, type TraceEntry } from "./ggtp";
import { GhostDB, isPrivate, type WireRec } from "./ghostdb";
import type { Transport } from "./transport";

export interface SpiritIdentity {
  appId: string;
  /** First 16 hex characters of the bundle hash: peers must run identical code. */
  hash: string;
  version: number;
  name: string;
}

export interface PeerInfo {
  device: string;
  name: string;
  version: number;
}

export type SessionState = "offline" | "checking" | "ready" | "mismatch";

export interface SessionEvents {
  state?: (s: SessionState, detail?: string) => void;
  peerJoin?: (p: PeerInfo) => void;
  peerLeave?: (reason: string) => void;
  peerMsg?: (topic: string, body: unknown) => void;
  synced?: (pulled: number) => void;
  trace?: (t: TraceEntry) => void;
  log?: (text: string) => void;
}

interface Hello {
  a: string;
  h: string;
  v: number;
  n: string;
  d: string;
}

const PULL = "/~db/pull";
const PUSH = "~db/push";

/** Explains a HELLO mismatch in words. */
export function mismatchReason(me: SpiritIdentity, peer: Hello): string {
  if (peer.a !== me.appId) return `the other device is running "${peer.n}", not "${me.name}"`;
  if (peer.v !== me.version) return `the other device has version ${peer.v} and you have version ${me.version}. Share the newer one first.`;
  return "both have the same spirit, but the code differs. Share it again so both have the same copy.";
}

export class SpiritSession {
  readonly ggtp: GgtpEndpoint;
  state: SessionState = "offline";
  peer: PeerInfo | null = null;
  private transport: Transport | null = null;
  private helloSent = false;
  private helloTimer: ReturnType<typeof setTimeout> | null = null;
  private syncFallback: ReturnType<typeof setTimeout> | null = null;
  private syncing = false;
  private pulled = false;
  private unsubDb: () => void;
  private listeners = new Set<SessionEvents>();
  private ev: Required<SessionEvents>;

  constructor(
    readonly identity: SpiritIdentity,
    readonly db: GhostDB,
    first: SessionEvents = {},
    /** syncDb: false for spirits without the "db" permission, so no airtime goes to an empty sync. */
    private opts: { syncDb: boolean } = { syncDb: true },
  ) {
    this.listeners.add(first);
    const fan =
      <K extends keyof SessionEvents>(k: K) =>
      (...args: Parameters<NonNullable<SessionEvents[K]>>) => {
        for (const l of this.listeners) (l[k] as ((...a: typeof args) => void) | undefined)?.(...args);
      };
    this.ev = {
      state: fan("state"),
      peerJoin: fan("peerJoin"),
      peerLeave: fan("peerLeave"),
      peerMsg: fan("peerMsg"),
      synced: fan("synced"),
      trace: fan("trace"),
      log: fan("log"),
    };
    this.ggtp = new GgtpEndpoint({
      send: (bytes) => this.sendBytes(bytes),
      onTrace: (t) => this.ev.trace?.(t),
      onHello: (b) => this.onHello(b as Hello),
      onMsg: (topic, body) => this.onMsg(topic, body),
    });
    this.ggtp.close("no peer connected");
    this.ggtp.route("POST", PULL, (req) => {
      if (this.state !== "ready" || !this.peer) return { status: STATUS.FORBIDDEN, body: null };
      const since = Number((req.body as { since?: number })?.since ?? 0);
      // Our turn to pull comes after this response has gone out.
      if (this.transport?.role !== "answerer") setTimeout(() => this.startSync(), 0);
      return this.db.changesSince(Number.isFinite(since) ? since : 0, this.peer.device);
    });
    this.unsubDb = this.db.onLocalWrite((r) => {
      if (this.state === "ready" && this.opts.syncDb && !isPrivate(r.k)) this.ggtp.sendMsg(PUSH, { recs: [GhostDB.wire(r)], top: this.db.lseq });
    });
  }

  /** Adds a listener; returns a function that removes it. */
  listen(ev: SessionEvents) {
    this.listeners.add(ev);
    return () => {
      this.listeners.delete(ev);
    };
  }

  /** Hands bytes to the transport at once; the link keeps them in order. */
  private sendBytes(bytes: Uint8Array) {
    void this.transport?.send(bytes);
  }

  attach(t: Transport) {
    this.transport = t;
    t.onReceive = (b) => this.ggtp.receive(b);
    t.onLink = (up, reason) => (up ? this.linkUp() : this.linkDown(reason ?? "the link closed"));
    if (t.up) this.linkUp();
  }

  detach() {
    if (this.transport) {
      this.transport.onReceive = null;
      this.transport.onLink = null;
    }
    this.linkDown("left the spirit");
    this.transport = null;
  }

  dispose() {
    this.detach();
    this.unsubDb();
    this.listeners.clear();
  }

  private setState(s: SessionState, detail?: string) {
    this.state = s;
    this.ev.state?.(s, detail);
  }

  private hello(): Hello {
    const id = this.identity;
    return { a: id.appId, h: id.hash, v: id.version, n: id.name, d: this.db.device };
  }

  private linkUp() {
    this.ggtp.open();
    this.pulled = false;
    this.setState("checking");
    // The caller speaks first; the answerer replies to its HELLO (and the reply carries the
    // link ACK). If the caller's HELLO never comes, the answerer speaks anyway.
    if (this.transport?.role === "answerer") {
      this.helloSent = false;
      if (this.helloTimer) clearTimeout(this.helloTimer);
      this.helloTimer = setTimeout(() => {
        if (!this.helloSent && this.state === "checking") {
          this.helloSent = true;
          this.ggtp.sendHello(this.hello());
        }
      }, 30_000);
    } else {
      this.helloSent = true;
      this.ggtp.sendHello(this.hello());
    }
  }

  private linkDown(reason: string) {
    const was = this.state;
    if (this.helloTimer) clearTimeout(this.helloTimer);
    if (this.syncFallback) clearTimeout(this.syncFallback);
    this.ggtp.close(reason);
    this.helloSent = false;
    this.pulled = false;
    this.setState("offline", reason);
    if (was === "ready") this.ev.peerLeave?.(reason);
    this.peer = null;
  }

  private onHello(h: Hello) {
    if (!h || typeof h.a !== "string" || typeof h.d !== "string") return;
    if (!this.helloSent) {
      this.helloSent = true;
      this.ggtp.sendHello(this.hello());
    }
    const me = this.identity;
    if (h.a !== me.appId || h.h !== me.hash || h.v !== me.version) {
      const why = mismatchReason(me, h);
      this.ev.log?.(`HELLO mismatch: ${why}`);
      this.setState("mismatch", why);
      return;
    }
    if (this.state === "ready") return;
    this.peer = { device: h.d, name: h.n, version: h.v };
    this.setState("ready");
    this.ev.peerJoin?.(this.peer);
    if (!this.opts.syncDb) this.pulled = true;
    // Take turns so the two pulls don't cross in the air: the answerer pulls first, the caller
    // pulls after it has served that pull (or after a while, if the answerer never asks).
    else if (this.transport?.role === "answerer") this.startSync();
    else this.syncFallback = setTimeout(() => this.startSync(), 20_000);
  }

  private startSync() {
    if (this.syncing || this.pulled || !this.opts.syncDb || this.state !== "ready") return;
    if (this.syncFallback) clearTimeout(this.syncFallback);
    this.syncing = true;
    void this.sync().finally(() => (this.syncing = false));
  }

  private onMsg(topic: string, body: unknown) {
    if (this.state !== "ready") return;
    if (topic === PUSH) {
      const b = body as { recs?: WireRec[]; top?: number };
      if (Array.isArray(b?.recs)) this.db.merge(b.recs);
      // Only trust the cursor from pushes once the initial pull has finished.
      if (this.pulled && this.peer && typeof b.top === "number") this.db.setCursor(this.peer.device, b.top);
      return;
    }
    if (topic.startsWith("~")) return;
    this.ev.peerMsg?.(topic, body);
  }

  /** Pulls everything the peer changed since the last sync with it. */
  async sync() {
    let pulled = 0;
    for (let round = 0; round < 50 && this.state === "ready" && this.peer; round++) {
      const peer = this.peer.device;
      const r = await this.ggtp.request("POST", PULL, { since: this.db.cursor(peer) });
      if (!isSuccess(r.status)) {
        this.ev.log?.(`database sync stopped: ${String(r.body ?? r.status)}`);
        return;
      }
      const b = r.body as { recs: WireRec[]; top: number; more: boolean };
      pulled += this.db.merge(b.recs ?? []);
      this.db.setCursor(peer, b.top);
      if (!b.more) break;
    }
    this.pulled = true;
    this.ev.synced?.(pulled);
  }

  /** Sends a peer message; false when no peer is ready. */
  send(topic: string, body: unknown): boolean {
    if (this.state !== "ready") return false;
    if (topic.startsWith("~")) throw new Error("topics starting with ~ are reserved");
    return this.ggtp.sendMsg(topic, body);
  }
}
