"use client";

// IndexedDB storage for Séance OS: the spirit library, studio projects and GhostDB data.

import type { InstalledSpirit, SpiritFiles } from "./bundle";
import type { DbState } from "./ghostdb";

const NAME = "seance-os";
const VERSION = 1;
let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("spirits")) db.createObjectStore("spirits", { keyPath: "appId" });
      if (!db.objectStoreNames.contains("projects")) db.createObjectStore("projects", { keyPath: "id" });
      if (!db.objectStoreNames.contains("ghostdb")) db.createObjectStore("ghostdb");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

function table<T>(store: string) {
  return {
    all: () => run<T[]>(store, "readonly", (s) => s.getAll()),
    get: (key: string) => run<T | undefined>(store, "readonly", (s) => s.get(key)),
    put: (value: T) => run<IDBValidKey>(store, "readwrite", (s) => s.put(value)),
    del: (key: string) => run<undefined>(store, "readwrite", (s) => s.delete(key)),
  };
}

export const spirits = table<InstalledSpirit>("spirits");

export interface Project {
  id: string;
  /** Raw spirit.json text, so a half-typed manifest still saves. */
  manifestText: string;
  files: SpiritFiles;
  updatedAt: number;
}
export const projects = table<Project>("projects");

export const dbStates = {
  get: (key: string) => run<DbState | undefined>("ghostdb", "readonly", (s) => s.get(key)),
  put: (key: string, state: DbState) => run<IDBValidKey>("ghostdb", "readwrite", (s) => s.put(state, key)),
  del: (key: string) => run<undefined>("ghostdb", "readwrite", (s) => s.delete(key)),
};

/** A save function that writes at most every 300 ms. */
export function persister(key: string): (s: DbState) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest: DbState | null = null;
  return (s) => {
    latest = s;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (latest) void dbStates.put(key, structuredClone(latest));
    }, 300);
  };
}

/** Lets this page and other open pages (studio, OS) know the library changed. */
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("seance-os") : null;
const local = new Set<() => void>();
export function announceLibrary() {
  // A BroadcastChannel never delivers to the object that posted, so tell this page directly.
  for (const fn of local) fn();
  channel?.postMessage({ type: "library" });
}
export function onLibrary(fn: () => void) {
  const h = (e: MessageEvent) => e.data?.type === "library" && fn();
  local.add(fn);
  channel?.addEventListener("message", h);
  return () => {
    local.delete(fn);
    channel?.removeEventListener("message", h);
  };
}
