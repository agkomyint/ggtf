// GGTP: Ghost Gibberlink Transfer Protocol. A CoAP-style binary protocol carried inside
// link messages (kind 1). Every message has the same 5-byte header:
//
//   [0] 0x40 | type   0 REQ, 1 RES, 2 NOTIFY, 3 MSG, 4 CANCEL, 5 HELLO
//   [1] code          REQ: method; RES: status (class << 5 | detail); NOTIFY: sequence
//   [2] token         matches RES / NOTIFY / CANCEL to a REQ (1–255); 0 otherwise
//   [3] format        0 none, 1 text, 2 json, 3 bytes
//   [4] path length   then the UTF-8 path (REQ path or MSG topic), then the body
//
// The endpoint is symmetric: either side of a link can make and serve requests.

export const VERSION = 0x40;

export const MsgType = { Req: 0, Res: 1, Notify: 2, Msg: 3, Cancel: 4, Hello: 5 } as const;
export type MsgType = (typeof MsgType)[keyof typeof MsgType];

export const METHODS = { GET: 1, POST: 2, PUT: 3, DELETE: 4, WATCH: 5 } as const;
export type Method = keyof typeof METHODS;
const METHOD_NAMES: Record<number, Method> = { 1: "GET", 2: "POST", 3: "PUT", 4: "DELETE", 5: "WATCH" };

export const Format = { None: 0, Text: 1, Json: 2, Bytes: 3 } as const;
export type Format = (typeof Format)[keyof typeof Format];

const code = (cls: number, detail: number) => (cls << 5) | detail;
export const STATUS = {
  CREATED: code(2, 1),
  DELETED: code(2, 2),
  CHANGED: code(2, 4),
  CONTENT: code(2, 5),
  BAD_REQUEST: code(4, 0),
  FORBIDDEN: code(4, 3),
  NOT_FOUND: code(4, 4),
  NOT_ALLOWED: code(4, 5),
  SERVER_ERROR: code(5, 0),
  UNAVAILABLE: code(5, 3),
  TIMEOUT: code(5, 4),
} as const;

const STATUS_TEXT: Record<number, string> = {
  [STATUS.CREATED]: "Created",
  [STATUS.DELETED]: "Deleted",
  [STATUS.CHANGED]: "Changed",
  [STATUS.CONTENT]: "Content",
  [STATUS.BAD_REQUEST]: "Bad Request",
  [STATUS.FORBIDDEN]: "Forbidden",
  [STATUS.NOT_FOUND]: "Not Found",
  [STATUS.NOT_ALLOWED]: "Method Not Allowed",
  [STATUS.SERVER_ERROR]: "Server Error",
  [STATUS.UNAVAILABLE]: "Unavailable",
  [STATUS.TIMEOUT]: "Timeout",
};

/** "2.05 Content" style text for a status code. */
export function statusText(c: number): string {
  const s = `${c >> 5}.${String(c & 31).padStart(2, "0")}`;
  return STATUS_TEXT[c] ? `${s} ${STATUS_TEXT[c]}` : s;
}

export const isSuccess = (c: number) => c >> 5 === 2;

/** Maps HTTP-style numbers (200, 404 …) to GGTP codes; GGTP codes pass through. */
export function toStatus(n: number): number {
  const http: Record<number, number> = {
    200: STATUS.CONTENT,
    201: STATUS.CREATED,
    204: STATUS.CHANGED,
    400: STATUS.BAD_REQUEST,
    403: STATUS.FORBIDDEN,
    404: STATUS.NOT_FOUND,
    405: STATUS.NOT_ALLOWED,
    500: STATUS.SERVER_ERROR,
    503: STATUS.UNAVAILABLE,
  };
  if (http[n]) return http[n];
  return n >= 0x40 && n <= 0xbf ? n : STATUS.SERVER_ERROR;
}

export interface GgtpMessage {
  type: MsgType;
  code: number;
  token: number;
  format: Format;
  path: string;
  body: Uint8Array;
}

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });

export function encode(m: GgtpMessage): Uint8Array {
  const path = enc.encode(m.path);
  if (path.length > 255) throw new Error("GGTP path longer than 255 bytes");
  const out = new Uint8Array(5 + path.length + m.body.length);
  out.set([VERSION | m.type, m.code & 255, m.token & 255, m.format, path.length]);
  out.set(path, 5);
  out.set(m.body, 5 + path.length);
  return out;
}

/** Parses a message; returns null for anything malformed instead of throwing. */
export function decode(b: Uint8Array): GgtpMessage | null {
  if (b.length < 5 || (b[0] & 0xc0) !== VERSION) return null;
  const type = (b[0] & 0x3f) as MsgType;
  if (type > MsgType.Hello) return null;
  const format = b[3] as Format;
  if (format > Format.Bytes) return null;
  const plen = b[4];
  if (5 + plen > b.length) return null;
  let path: string;
  try {
    path = dec.decode(b.subarray(5, 5 + plen));
  } catch {
    return null;
  }
  return { type, code: b[1], token: b[2], format, path, body: b.slice(5 + plen) };
}

/** Picks the smallest format for a JS value. */
export function packBody(value: unknown): { format: Format; body: Uint8Array } {
  if (value === undefined || value === null) return { format: Format.None, body: new Uint8Array() };
  if (value instanceof Uint8Array) return { format: Format.Bytes, body: value };
  if (typeof value === "string") return { format: Format.Text, body: enc.encode(value) };
  return { format: Format.Json, body: enc.encode(JSON.stringify(value)) };
}

export function unpackBody(m: Pick<GgtpMessage, "format" | "body">): unknown {
  try {
    switch (m.format) {
      case Format.None:
        return null;
      case Format.Text:
        return dec.decode(m.body);
      case Format.Json:
        return JSON.parse(dec.decode(m.body));
      default:
        return m.body;
    }
  } catch {
    return null;
  }
}

export function splitPath(full: string): { path: string; query: Record<string, string> } {
  const i = full.indexOf("?");
  if (i < 0) return { path: full, query: {} };
  const query: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(full.slice(i + 1))) query[k] = v;
  return { path: full.slice(0, i), query };
}

// ---------- endpoint ----------

export interface GgtpRequest {
  method: Method;
  path: string;
  query: Record<string, string>;
  body: unknown;
}

export interface GgtpResponse {
  status: number;
  body: unknown;
}

export type Handler = (req: GgtpRequest) => unknown | Promise<unknown>;

export interface TraceEntry {
  dir: "out" | "in";
  msg: GgtpMessage;
  bytes: number;
}

interface Route {
  method: Method | "*";
  pattern: string;
  handler: Handler;
}

interface Pending {
  resolve: (r: GgtpResponse) => void;
  timer: ReturnType<typeof setTimeout>;
  watch?: (body: unknown) => void;
}

export interface EndpointOptions {
  send: (bytes: Uint8Array) => void;
  timeoutMs?: number;
  onTrace?: (t: TraceEntry) => void;
  onMsg?: (topic: string, body: unknown) => void;
  onHello?: (body: unknown) => void;
}

/** A value a handler returns becomes a 2.05 body, unless it is exactly `{status, body?}`. */
function asResponse(v: unknown): GgtpResponse {
  if (v && typeof v === "object" && !(v instanceof Uint8Array)) {
    const keys = Object.keys(v);
    const o = v as { status?: unknown; body?: unknown };
    if (typeof o.status === "number" && keys.every((k) => k === "status" || k === "body")) {
      return { status: toStatus(o.status), body: o.body ?? null };
    }
  }
  return { status: STATUS.CONTENT, body: v ?? null };
}

function matches(pattern: string, path: string): boolean {
  return pattern.endsWith("*") ? path.startsWith(pattern.slice(0, -1)) : pattern === path;
}

export class GgtpEndpoint {
  private routes: Route[] = [];
  private pending = new Map<number, Pending>();
  /** Server side: path → tokens that are watching it. */
  private watchers = new Map<string, Set<number>>();
  private notifySeq = 0;
  private nextToken = 1;
  private closed = false;

  constructor(private opts: EndpointOptions) {}

  private out(m: GgtpMessage) {
    const bytes = encode(m);
    this.opts.onTrace?.({ dir: "out", msg: m, bytes: bytes.length });
    this.opts.send(bytes);
  }

  private token(): number {
    for (let i = 0; i < 255; i++) {
      const t = this.nextToken;
      this.nextToken = (this.nextToken % 255) + 1;
      if (!this.pending.has(t)) return t;
    }
    throw new Error("too many GGTP requests in flight");
  }

  /** Re-opens the endpoint after `close`, for a new link session. */
  open() {
    this.closed = false;
  }

  route(method: Method | "*", pattern: string, handler: Handler): () => void {
    const r: Route = { method, pattern, handler };
    this.routes.push(r);
    return () => {
      this.routes = this.routes.filter((x) => x !== r);
    };
  }

  request(method: Method, path: string, body?: unknown, opts: { timeoutMs?: number; watch?: (body: unknown) => void } = {}): Promise<GgtpResponse & { token: number }> {
    if (this.closed) return Promise.resolve({ status: STATUS.UNAVAILABLE, body: "no peer connected", token: 0 });
    const token = this.token();
    const { format, body: bytes } = packBody(body);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(token);
        resolve({ status: STATUS.TIMEOUT, body: "no answer from the other side", token });
      }, opts.timeoutMs ?? this.opts.timeoutMs ?? 120_000);
      this.pending.set(token, { resolve: (r) => resolve({ ...r, token }), timer, watch: opts.watch });
      this.out({ type: MsgType.Req, code: METHODS[method], token, format, path, body: bytes });
    });
  }

  /** Watches a path on the other side: the first response, then `onChange` for every NOTIFY. */
  async watch(path: string, onChange: (body: unknown) => void, timeoutMs?: number) {
    const r = await this.request("WATCH", path, undefined, { timeoutMs, watch: onChange });
    if (!isSuccess(r.status)) this.stopWatch(r.token, false);
    return { ...r, cancel: () => this.stopWatch(r.token, true) };
  }

  private stopWatch(token: number, tell: boolean) {
    const p = this.pending.get(token);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(token);
    if (tell && !this.closed) this.out({ type: MsgType.Cancel, code: 0, token, format: Format.None, path: "", body: new Uint8Array() });
  }

  /** Sends NOTIFY to everyone watching `path`. Returns how many watchers were told. */
  notify(path: string, body: unknown): number {
    const tokens = this.watchers.get(path);
    if (!tokens || this.closed) return 0;
    const { format, body: bytes } = packBody(body);
    this.notifySeq = (this.notifySeq + 1) & 255;
    for (const token of tokens) this.out({ type: MsgType.Notify, code: this.notifySeq, token, format, path: "", body: bytes });
    return tokens.size;
  }

  sendMsg(topic: string, body: unknown) {
    if (this.closed) return false;
    const { format, body: bytes } = packBody(body);
    this.out({ type: MsgType.Msg, code: 0, token: 0, format, path: topic, body: bytes });
    return true;
  }

  sendHello(body: unknown) {
    const { format, body: bytes } = packBody(body);
    this.out({ type: MsgType.Hello, code: 0, token: 0, format, path: "", body: bytes });
  }

  /** Ends the session: pending requests fail with 5.03 and watches are dropped. */
  close(reason = "the link closed") {
    this.closed = true;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve({ status: STATUS.UNAVAILABLE, body: reason });
    }
    this.pending.clear();
    this.watchers.clear();
  }

  receive(bytes: Uint8Array) {
    const m = decode(bytes);
    if (!m) return;
    this.opts.onTrace?.({ dir: "in", msg: m, bytes: bytes.length });
    switch (m.type) {
      case MsgType.Req:
        void this.serve(m);
        break;
      case MsgType.Res: {
        const p = this.pending.get(m.token);
        if (!p) return;
        if (p.watch && isSuccess(m.code)) {
          // Keep the token: NOTIFY messages for this watch will follow.
          clearTimeout(p.timer);
          p.resolve({ status: m.code, body: unpackBody(m) });
          p.resolve = () => {};
        } else {
          clearTimeout(p.timer);
          this.pending.delete(m.token);
          p.resolve({ status: m.code, body: unpackBody(m) });
        }
        break;
      }
      case MsgType.Notify:
        this.pending.get(m.token)?.watch?.(unpackBody(m));
        break;
      case MsgType.Cancel:
        for (const set of this.watchers.values()) set.delete(m.token);
        break;
      case MsgType.Msg:
        this.opts.onMsg?.(m.path, unpackBody(m));
        break;
      case MsgType.Hello:
        this.opts.onHello?.(unpackBody(m));
        break;
    }
  }

  private async serve(m: GgtpMessage) {
    const method = METHOD_NAMES[m.code];
    const reply = (r: GgtpResponse) => {
      const { format, body } = packBody(r.body);
      this.out({ type: MsgType.Res, code: r.status, token: m.token, format, path: "", body });
    };
    if (!method) return reply({ status: STATUS.BAD_REQUEST, body: "unknown method" });
    const { path, query } = splitPath(m.path);
    // WATCH is answered by the GET handler, then registered for NOTIFY.
    const lookup = method === "WATCH" ? "GET" : method;
    const route = this.routes.find((r) => (r.method === "*" || r.method === lookup) && matches(r.pattern, path));
    if (!route) {
      const any = this.routes.some((r) => matches(r.pattern, path));
      return reply({ status: any ? STATUS.NOT_ALLOWED : STATUS.NOT_FOUND, body: null });
    }
    let res: GgtpResponse;
    try {
      res = asResponse(await route.handler({ method, path, query, body: unpackBody(m) }));
    } catch (err) {
      res = { status: STATUS.SERVER_ERROR, body: err instanceof Error ? err.message : String(err) };
    }
    if (this.closed) return;
    if (method === "WATCH" && isSuccess(res.status)) {
      const set = this.watchers.get(m.path) ?? new Set<number>();
      set.add(m.token);
      this.watchers.set(m.path, set);
    }
    reply(res);
  }
}
