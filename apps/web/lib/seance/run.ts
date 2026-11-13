"use client";

// One running spirit: its GhostDB, session and iframe host, wired together.

import type { Manifest, SpiritFiles } from "./bundle";
import { GhostDB, type DbState } from "./ghostdb";
import type { TraceEntry } from "./ggtp";
import { SpiritHost, type HostLog } from "./host";
import { buildSrcdoc, type SpiritMe } from "./runtime";
import { SpiritSession, type SessionEvents, type SpiritIdentity } from "./session";

export interface RunOptions {
  manifest: Manifest;
  files: SpiritFiles;
  identity: SpiritIdentity;
  me: SpiritMe;
  dbState?: DbState;
  persist?: (s: DbState) => void;
  onLog?: (l: HostLog) => void;
  onTrace?: (t: TraceEntry) => void;
  events?: SessionEvents;
}

export class SpiritRun {
  readonly db: GhostDB;
  readonly session: SpiritSession;
  readonly host: SpiritHost;
  readonly srcdoc: string;

  constructor(o: RunOptions) {
    this.db = new GhostDB(o.me.device, o.dbState, o.persist);
    this.session = new SpiritSession(
      o.identity,
      this.db,
      {
        ...o.events,
        trace: (t) => {
          o.onTrace?.(t);
          o.events?.trace?.(t);
        },
        log: (text) => {
          o.onLog?.({ level: "os", text, at: Date.now() });
          o.events?.log?.(text);
        },
      },
      { syncDb: o.manifest.permissions.includes("db") },
    );
    this.host = new SpiritHost(this.session, o.manifest, (l) => o.onLog?.(l));
    this.srcdoc = buildSrcdoc(o.files, o.manifest, o.me);
  }

  dispose() {
    this.host.dispose();
    this.session.dispose();
  }
}
