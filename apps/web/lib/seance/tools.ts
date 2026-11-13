"use client";

// Main-thread access to the Rust bundle code (pack, verify, author key) through a worker,
// plus the author key and device id kept in this browser.

import { appIdFor, bytesToHex, hexToBytes, parseSource, type SpiritSource } from "./bundle";

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let seq = 0;
const waiting = new Map<string, (v: unknown) => void>();

function tools(): Promise<Worker> {
  if (!worker) {
    worker = new Worker("/audio/ggtf-worker.js", { type: "module" });
    ready = new Promise<void>((resolve, reject) => {
      worker!.onmessage = (e) => {
        const m = e.data;
        if (m.type === "tools-ready") resolve();
        else if (m.type === "reply") {
          waiting.get(m.ref)?.(m.value);
          waiting.delete(m.ref);
        } else if (m.type === "error") reject(new Error(m.message));
      };
      worker!.onerror = (err) => reject(new Error(err.message || "the tools worker failed to load"));
    });
    worker.postMessage({ type: "tools-init" });
  }
  return ready!.then(() => worker!);
}

async function ask<T>(msg: Record<string, unknown>): Promise<T> {
  const w = await tools();
  const ref = `t${++seq}`;
  return new Promise<T>((resolve) => {
    waiting.set(ref, (v) => resolve(v as T));
    w.postMessage({ ...msg, ref });
  });
}

// ---------- identity kept in this browser ----------

const SECRET_KEY = "ggtf.author.secret";
const DEVICE_KEY = "ggtf.device";

/** This browser's author secret (created on first use). Never leaves the device. */
export function authorSecret(): Uint8Array {
  let hex = localStorage.getItem(SECRET_KEY);
  if (!hex || hex.length !== 64) {
    const b = crypto.getRandomValues(new Uint8Array(32));
    hex = bytesToHex(b);
    localStorage.setItem(SECRET_KEY, hex);
  }
  return hexToBytes(hex);
}

/** A random id for this device, used by GhostDB to break ties. */
export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = bytesToHex(crypto.getRandomValues(new Uint8Array(6)));
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export interface Author {
  publicHex: string;
  words: string[];
}

export async function author(): Promise<Author> {
  const r = await ask<{ public: Uint8Array; words: string[] }>({ type: "author", secret: authorSecret() });
  return { publicHex: bytesToHex(r.public), words: r.words };
}

// ---------- bundles ----------

export async function packBundle(source: string): Promise<Uint8Array | null> {
  return ask<Uint8Array | null>({ type: "bundle-pack", secret: authorSecret(), source });
}

export interface OpenedBundle {
  source: SpiritSource;
  author: string;
  words: string[];
  hash: string;
  appId: string;
  bytes: number;
}

/** Verifies the signature (in Rust), then checks the source and manifest. */
export async function openBundle(bytes: Uint8Array): Promise<{ ok: true; bundle: OpenedBundle } | { ok: false; error: string }> {
  const r = await ask<{ ok: boolean; error?: string; author: string; words: string[]; hash: string; source: string; bytes: number }>({ type: "bundle-open", bytes });
  if (!r.ok) return { ok: false, error: r.error ?? "invalid bundle" };
  const src = parseSource(r.source);
  if (!src.ok) return { ok: false, error: src.error };
  const appId = await appIdFor(r.author, src.source.manifest.name);
  return { ok: true, bundle: { source: src.source, author: r.author, words: r.words, hash: r.hash, appId, bytes: r.bytes } };
}

export const BUNDLE_MAGIC = [0x00, 0x47, 0x53, 0x01];
export const isBundle = (b: Uint8Array) => b.length > 4 && BUNDLE_MAGIC.every((x, i) => b[i] === x);
