"use client";

// Sim air: two real Rust stations in a worker sharing simulated air (noise and dropouts),
// exposed as two link transports. Spirit Studio uses it to test a two-peer spirit over the
// actual modem, link and crypto, without speakers.

import type { LinkInfo } from "@/lib/ggtf/types";
import { LinkTransport, type LinkEvent } from "./transport";

export interface AirLine {
  side: 0 | 1;
  /** Simulated time in ms. */
  at: number;
  tone: "tx" | "rx" | "warn" | "info" | "good";
  text: string;
}

export interface AirStatus {
  now: number;
  links: [LinkInfo, LinkInfo] | null;
}

export interface AirOptions {
  noise: number;
  loss: number;
  /** 0 = as fast as possible, otherwise a multiple of real time. */
  speed: number;
  /** 0 low, 1 mid, 2 high. Applies to the next call. */
  band: number;
}

type DuoEvent = LinkEvent & { side: 0 | 1; [k: string]: unknown };

export class SimAir {
  readonly a: LinkTransport;
  readonly b: LinkTransport;
  now = 0;
  onLine: ((l: AirLine) => void) | null = null;
  onStatus: ((s: AirStatus) => void) | null = null;
  private worker: Worker;
  private seq = 0;
  private sent = new Map<string, (id: number) => void>();

  constructor() {
    this.worker = new Worker("/audio/ggtf-worker.js", { type: "module" });
    this.a = new LinkTransport((kind, bytes) => this.sendRaw(0, kind, bytes));
    this.b = new LinkTransport((kind, bytes) => this.sendRaw(1, kind, bytes));
    this.worker.onmessage = (e) => this.onMessage(e.data);
  }

  start(o: AirOptions, seed = Math.floor(Math.random() * 1e6)) {
    this.worker.postMessage({ type: "duo-start", seed, noise: o.noise, loss: o.loss, speed: o.speed, band: o.band });
  }

  config(o: Partial<AirOptions>) {
    this.worker.postMessage({ type: "duo-config", ...o });
  }

  /** A hangs up (both sides end the session). */
  hangup() {
    this.worker.postMessage({ type: "duo-hangup", side: 0 });
  }

  /** A calls B again. */
  reconnect() {
    this.worker.postMessage({ type: "duo-connect" });
  }

  stop() {
    this.worker.postMessage({ type: "duo-stop" });
    this.worker.terminate();
    for (const [, r] of this.sent) r(-1);
    this.sent.clear();
  }

  private sendRaw(side: 0 | 1, kind: number, bytes: Uint8Array): Promise<number> {
    const ref = `s${++this.seq}`;
    return new Promise((resolve) => {
      this.sent.set(ref, resolve);
      this.worker.postMessage({ type: "duo-send", side, kind, bytes, ref });
    });
  }

  private onMessage(m: { type: string; [k: string]: unknown }) {
    if (m.type === "duo-sent") {
      this.sent.get(m.ref as string)?.(m.id as number);
      this.sent.delete(m.ref as string);
    } else if (m.type === "duo-events") {
      this.now = m.now as number;
      for (const e of m.events as DuoEvent[]) {
        (e.side === 0 ? this.a : this.b).handle(e);
        const line = describe(e, this.now);
        if (line) this.onLine?.(line);
      }
      if (m.links || (m.events as unknown[]).length) this.onStatus?.({ now: this.now, links: (m.links as [LinkInfo, LinkInfo]) ?? null });
    } else if (m.type === "error") {
      this.onLine?.({ side: 0, at: this.now, tone: "warn", text: `sim error: ${String(m.message)}` });
    }
  }
}

function describe(e: DuoEvent, now: number): AirLine | null {
  const side = e.side;
  const at = now;
  switch (e.type) {
    case "tx":
      return { side, at, tone: "tx", text: `→ ${e.kind} (${e.profile}, ${(Number(e.ms) / 1000).toFixed(2)} s)` };
    case "rx_frame":
      return e.own ? null : { side, at, tone: "rx", text: `← ${e.kind} (${Number(e.snr).toFixed(1)} dB)` };
    case "rx_failed":
      return { side, at, tone: "warn", text: `heard a ${e.stage} but couldn't decode it` };
    case "retry":
      return { side, at, tone: "warn", text: `resending ${e.what} (attempt ${e.attempt}, ${e.profile})` };
    case "state":
      return { side, at, tone: e.state === "connected" ? "good" : "info", text: `link ${e.state}` };
    case "ended":
      return { side, at, tone: "warn", text: `link ended: ${e.reason}` };
    case "trained":
      return { side, at, tone: "good", text: `line test picked ${e.profile}` };
    default:
      return null;
  }
}
