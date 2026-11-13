"use client";

// Publishing from the studio and installing bundles received over sound.

import { sourceToJson, validateManifest, type InstalledSpirit, type SpiritSource } from "./bundle";
import { announceLibrary, dbStates, spirits } from "./store";
import { openBundle, packBundle, type OpenedBundle } from "./tools";

export interface Packed {
  bytes: Uint8Array;
  opened: OpenedBundle;
}

/** Packs and signs a source with this browser's author key, then re-opens it as a check. */
export async function pack(source: SpiritSource): Promise<{ ok: true; packed: Packed } | { ok: false; error: string }> {
  const m = validateManifest(source.manifest);
  if (!m.ok) return { ok: false, error: m.errors.join("; ") };
  const bytes = await packBundle(sourceToJson({ ...source, manifest: m.manifest }));
  if (!bytes) return { ok: false, error: "the spirit is too large to pack (256 KB limit)" };
  const opened = await openBundle(bytes);
  if (!opened.ok) return { ok: false, error: opened.error };
  return { ok: true, packed: { bytes, opened: opened.bundle } };
}

export function toInstalled(p: Packed, from: number | null, origin: InstalledSpirit["origin"]): InstalledSpirit {
  const o = p.opened;
  return {
    appId: o.appId,
    hash: o.hash,
    author: o.author,
    words: o.words,
    manifest: o.source.manifest,
    files: o.source.files,
    bundle: p.bytes,
    installedAt: Date.now(),
    from,
    origin,
  };
}

export async function install(s: InstalledSpirit) {
  await spirits.put(s);
  announceLibrary();
}

export async function remove(appId: string) {
  await spirits.del(appId);
  await dbStates.del(`os:${appId}`);
  announceLibrary();
}

export async function library(): Promise<InstalledSpirit[]> {
  const all = await spirits.all();
  return all.sort((a, b) => b.installedAt - a.installedAt);
}
