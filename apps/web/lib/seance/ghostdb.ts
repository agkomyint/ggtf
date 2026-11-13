// GhostDB: a small key-value store per spirit and device that syncs with the connected peer.
//
// Each record carries a Lamport clock `c` and the writing device `d`. The record with the
// larger (c, d) wins, so both peers end up with the same data whatever order changes arrive
// in. Deletes are kept as tombstones so they sync too. Every stored change also gets a local
// sequence number `l`, which lets a peer ask for "everything since I last synced with you".

export interface Rec {
  k: string;
  v: unknown;
  c: number;
  d: string;
  x?: 1;
  l: number;
}

/** Wire form: [key, value, clock, device, deleted, sender's local seq]. */
export type WireRec = [string, unknown, number, string, 0 | 1, number];

export interface DbState {
  clock: number;
  lseq: number;
  recs: Record<string, Rec>;
  cursors: Record<string, number>;
}

export interface DbChange {
  key: string;
  value: unknown;
  deleted: boolean;
  origin: "local" | "peer";
}

export const LIMITS = { key: 128, value: 4000, records: 2000 } as const;

/** Keys starting with "local:" stay on this device and never sync. */
export const isPrivate = (key: string) => key.startsWith("local:");

export const emptyState = (): DbState => ({ clock: 0, lseq: 0, recs: {}, cursors: {} });

const wins = (a: { c: number; d: string }, b: { c: number; d: string }) => a.c > b.c || (a.c === b.c && a.d > b.d);

export class GhostDB {
  private s: DbState;
  private watchers = new Set<{ prefix: string; fn: (c: DbChange) => void }>();
  private localWrite = new Set<(r: Rec) => void>();

  constructor(
    readonly device: string,
    state?: DbState,
    private onPersist?: (s: DbState) => void,
  ) {
    this.s = state ? structuredClone(state) : emptyState();
  }

  get(key: string): unknown {
    const r = this.s.recs[key];
    return r && !r.x ? structuredClone(r.v) : undefined;
  }

  /** Live (non-deleted) entries whose key starts with `prefix`, sorted by key. */
  list(prefix = ""): { key: string; value: unknown }[] {
    return Object.values(this.s.recs)
      .filter((r) => !r.x && r.k.startsWith(prefix))
      .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
      .map((r) => ({ key: r.k, value: structuredClone(r.v) }));
  }

  /** Every record including tombstones, for inspectors. */
  records(): Rec[] {
    return Object.values(this.s.recs).sort((a, b) => b.l - a.l);
  }

  get size() {
    return Object.values(this.s.recs).filter((r) => !r.x).length;
  }

  put(key: string, value: unknown): Rec {
    if (value === undefined) return this.del(key);
    if (typeof key !== "string" || !key || key.length > LIMITS.key) throw new Error(`keys must be 1–${LIMITS.key} characters`);
    if (key.startsWith("~")) throw new Error("keys starting with ~ are reserved");
    const json = JSON.stringify(value);
    if (json === undefined) throw new Error("values must be JSON");
    if (json.length > LIMITS.value) throw new Error(`a value can be at most ${LIMITS.value} bytes of JSON (it has to fit through sound)`);
    if (!this.s.recs[key] && Object.keys(this.s.recs).length >= LIMITS.records) throw new Error(`a spirit can store at most ${LIMITS.records} keys`);
    return this.write(key, JSON.parse(json), false);
  }

  del(key: string): Rec {
    return this.write(key, null, true);
  }

  private write(key: string, value: unknown, deleted: boolean): Rec {
    this.s.clock += 1;
    this.s.lseq += 1;
    const r: Rec = { k: key, v: value, c: this.s.clock, d: this.device, l: this.s.lseq, ...(deleted ? { x: 1 as const } : {}) };
    this.s.recs[key] = r;
    this.changed(r, "local");
    for (const fn of this.localWrite) fn(r);
    return r;
  }

  /** Called for every local write (the session pushes it to the peer). */
  onLocalWrite(fn: (r: Rec) => void) {
    this.localWrite.add(fn);
    return () => {
      this.localWrite.delete(fn);
    };
  }

  watch(prefix: string, fn: (c: DbChange) => void) {
    const w = { prefix, fn };
    this.watchers.add(w);
    return () => {
      this.watchers.delete(w);
    };
  }

  private changed(r: Rec, origin: DbChange["origin"]) {
    const change: DbChange = { key: r.k, value: r.x ? null : structuredClone(r.v), deleted: !!r.x, origin };
    for (const w of this.watchers) {
      if (r.k.startsWith(w.prefix)) {
        try {
          w.fn(change);
        } catch (err) {
          console.error(err);
        }
      }
    }
    this.onPersist?.(this.s);
  }

  /** Merges records from a peer. Returns how many changed the local data. */
  merge(recs: WireRec[]): number {
    let n = 0;
    for (const w of recs) {
      if (!Array.isArray(w) || w.length < 5) continue;
      const [k, v, c, d, x] = w;
      if (typeof k !== "string" || !k || k.length > LIMITS.key || k.startsWith("~") || isPrivate(k) || typeof c !== "number" || typeof d !== "string") continue;
      this.s.clock = Math.max(this.s.clock, c);
      const cur = this.s.recs[k];
      if (cur && !wins({ c, d }, cur)) continue;
      this.s.lseq += 1;
      const r: Rec = { k, v: x ? null : v, c, d, l: this.s.lseq, ...(x ? { x: 1 as const } : {}) };
      this.s.recs[k] = r;
      n++;
      this.changed(r, "peer");
    }
    return n;
  }

  static wire(r: Rec): WireRec {
    return [r.k, r.x ? null : r.v, r.c, r.d, r.x ? 1 : 0, r.l];
  }

  /**
   * Records changed after local sequence `since`, oldest first, skipping ones written by
   * `exclude` (the peer asking already has its own writes). Stops after about `maxBytes`.
   */
  changesSince(since: number, exclude: string, maxBytes = 1500): { recs: WireRec[]; top: number; more: boolean } {
    const all = Object.values(this.s.recs)
      .filter((r) => r.l > since)
      .sort((a, b) => a.l - b.l);
    const recs: WireRec[] = [];
    let size = 0;
    let top = since;
    for (const r of all) {
      if (r.d !== exclude && !isPrivate(r.k)) {
        const w = GhostDB.wire(r);
        const len = JSON.stringify(w).length;
        if (recs.length > 0 && size + len > maxBytes) return { recs, top, more: true };
        recs.push(w);
        size += len;
      }
      top = r.l;
    }
    return { recs, top: this.s.lseq, more: false };
  }

  cursor(peer: string): number {
    return this.s.cursors[peer] ?? 0;
  }

  setCursor(peer: string, n: number) {
    if (n > (this.s.cursors[peer] ?? 0)) {
      this.s.cursors[peer] = n;
      this.onPersist?.(this.s);
    }
  }

  get lseq() {
    return this.s.lseq;
  }

  snapshot(): DbState {
    return structuredClone(this.s);
  }

  /** Wipes all data (used when a spirit is removed or reset in the studio). */
  clear() {
    this.s = emptyState();
    this.onPersist?.(this.s);
  }
}
