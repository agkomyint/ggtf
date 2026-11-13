"use client";

// Starter spirits: signed bundles shipped in /public/spirits (see scripts/pack-starters.ts).
// Every device gets the same bytes, so two people can play a starter together right away.

import { compareInstall, type InstalledSpirit } from "./bundle";
import { install } from "./library";
import { openBundle } from "./tools";

const REMOVED = "ggtf.starters.removed";

interface StarterIndex {
  author: string;
  words: string[];
  spirits: { key: string; file: string; name: string; version: number; bytes: number }[];
}

function removed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(REMOVED) ?? "[]");
  } catch {
    return [];
  }
}

/** Remembers that the user removed a starter, so it isn't reinstalled. */
export function forgetStarter(appId: string) {
  localStorage.setItem(REMOVED, JSON.stringify([...new Set([...removed(), appId])]));
}

/** Installs missing starters and updates older ones. Returns how many changed. */
export async function installStarters(library: InstalledSpirit[], force = false): Promise<number> {
  if (force) localStorage.removeItem(REMOVED);
  const res = await fetch("/spirits/index.json", { cache: "no-cache" }).catch(() => null);
  if (!res?.ok) return 0;
  const index = (await res.json()) as StarterIndex;
  const skip = new Set(removed());
  let changed = 0;
  for (const s of index.spirits) {
    const r = await fetch(s.file).catch(() => null);
    if (!r?.ok) continue;
    const bytes = new Uint8Array(await r.arrayBuffer());
    const opened = await openBundle(bytes);
    // Starters must be signed by the key the index names; anything else is ignored.
    if (!opened.ok || opened.bundle.author !== index.author || skip.has(opened.bundle.appId)) continue;
    const o = opened.bundle;
    const v = compareInstall(library, { appId: o.appId, hash: o.hash, manifest: o.source.manifest });
    if (v.kind === "same" || v.kind === "older") continue;
    if ((v.kind === "update" || v.kind === "changed") && v.existing.origin !== "preloaded") continue;
    await install({
      appId: o.appId,
      hash: o.hash,
      author: o.author,
      words: o.words,
      manifest: o.source.manifest,
      files: o.source.files,
      bundle: bytes,
      installedAt: Date.now() - 1e9, // keeps starters below spirits the user received or made
      from: null,
      origin: "preloaded",
    });
    changed++;
  }
  return changed;
}
