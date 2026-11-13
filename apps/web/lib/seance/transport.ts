// Transports carry GGTP bytes between two spirit sessions. The session doesn't care which one
// it gets: an in-memory pair (instant), the Rust modem on simulated air, or the real link.

export type Progress = (sent: number, total: number) => void;

export interface Transport {
  /** Resolves true once the other side has the bytes, false if they were lost. */
  send(bytes: Uint8Array, onProgress?: Progress): Promise<boolean>;
  onReceive: ((bytes: Uint8Array) => void) | null;
  onLink: ((up: boolean, reason?: string) => void) | null;
  /** Bytes of an incoming message so far, while it is still arriving. */
  onPartial?: ((bytes: number) => void) | null;
  readonly up: boolean;
  /** Which side started the link. The caller speaks first, so the two don't talk over each other. */
  readonly role: "caller" | "answerer" | null;
}

class PairEnd implements Transport {
  onReceive: ((bytes: Uint8Array) => void) | null = null;
  onLink: ((up: boolean, reason?: string) => void) | null = null;
  onPartial: ((bytes: number) => void) | null = null;
  other: PairEnd | null = null;
  up = false;
  constructor(
    private delayMs: number,
    readonly role: "caller" | "answerer",
  ) {}
  send(bytes: Uint8Array, onProgress?: Progress) {
    const other = this.other;
    if (!this.up || !other) return Promise.resolve(false);
    const copy = bytes.slice();
    return new Promise<boolean>((resolve) =>
      setTimeout(() => {
        other.onReceive?.(copy);
        onProgress?.(copy.length, copy.length);
        resolve(true);
      }, this.delayMs),
    );
  }
}

/** Two ends wired together in memory. `delayMs` simulates a fixed delay per message. */
export function instantPair(delayMs = 0): { a: Transport; b: Transport; connect(): void; disconnect(reason?: string): void } {
  const a = new PairEnd(delayMs, "caller");
  const b = new PairEnd(delayMs, "answerer");
  a.other = b;
  b.other = a;
  return {
    a,
    b,
    connect() {
      a.up = b.up = true;
      a.onLink?.(true);
      b.onLink?.(true);
    },
    disconnect(reason = "disconnected") {
      a.up = b.up = false;
      a.onLink?.(false, reason);
      b.onLink?.(false, reason);
    },
  };
}

// ---------- real link and sim air ----------

/** The subset of station events a link transport needs. */
export type LinkEvent =
  | { type: "state"; state: string; role?: "caller" | "answerer" | null }
  | { type: "msg_rx"; kind: number; b64: string }
  | { type: "msg_status"; id: number; status: string }
  | { type: "ended"; reason: string }
  | { type: string };

export const KIND_GGTP = 1;

export function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * A transport over one GGTF link. `sendRaw` hands bytes to the station and returns the link
 * message id; `handle` must be called with every station event for this link.
 */
export class LinkTransport implements Transport {
  onReceive: ((bytes: Uint8Array) => void) | null = null;
  onLink: ((up: boolean, reason?: string) => void) | null = null;
  onPartial: ((bytes: number) => void) | null = null;
  up = false;
  role: "caller" | "answerer" | null = null;
  private waiting = new Map<number, (ok: boolean) => void>();
  private progress = new Map<number, Progress>();
  private early = new Map<number, boolean>();
  private lastReason = "";

  constructor(private sendRaw: (kind: number, bytes: Uint8Array) => Promise<number>) {}

  async send(bytes: Uint8Array, onProgress?: Progress): Promise<boolean> {
    if (!this.up) return false;
    const id = await this.sendRaw(KIND_GGTP, bytes);
    if (id < 0) return false;
    const done = this.early.get(id);
    if (done !== undefined) {
      this.early.delete(id);
      if (done) onProgress?.(bytes.length, bytes.length);
      return done;
    }
    if (onProgress) this.progress.set(id, onProgress);
    return new Promise((resolve) =>
      this.waiting.set(id, (ok) => {
        if (ok) onProgress?.(bytes.length, bytes.length);
        resolve(ok);
      }),
    );
  }

  handle(e: LinkEvent) {
    switch (e.type) {
      case "msg_progress": {
        const m = e as unknown as { id: number; sent: number; total: number };
        this.progress.get(m.id)?.(m.sent, m.total);
        break;
      }
      case "msg_partial": {
        const m = e as unknown as { kind: number; bytes: number };
        if (m.kind === KIND_GGTP) this.onPartial?.(m.bytes);
        break;
      }
      case "state": {
        const s = e as { state: string; role?: "caller" | "answerer" | null };
        const up = s.state === "connected";
        if (s.role !== undefined) this.role = s.role;
        if (up !== this.up) {
          this.up = up;
          if (!up) this.failAll();
          this.onLink?.(up, up ? undefined : this.lastReason || "the link closed");
          this.lastReason = "";
        }
        break;
      }
      case "ended":
        this.lastReason = (e as { reason: string }).reason;
        break;
      case "msg_rx": {
        const m = e as { kind: number; b64: string };
        if (m.kind === KIND_GGTP) this.onReceive?.(b64ToBytes(m.b64));
        break;
      }
      case "msg_status": {
        const m = e as { id: number; status: string };
        if (m.status !== "delivered" && m.status !== "failed") break;
        const ok = m.status === "delivered";
        const w = this.waiting.get(m.id);
        this.progress.delete(m.id);
        if (w) {
          this.waiting.delete(m.id);
          w(ok);
        } else {
          this.early.set(m.id, ok);
        }
        break;
      }
    }
  }

  private failAll() {
    for (const [, w] of this.waiting) w(false);
    this.waiting.clear();
    this.early.clear();
    this.progress.clear();
  }
}
