// Spirit source format, manifest checks and identity helpers. Packing, signing and verifying
// happen in Rust (crates/ggtf-core/src/bundle.rs) through the worker; see tools.ts.

export type Permission = "peer" | "db";
export const PERMISSIONS: Record<Permission, string> = {
  peer: "talk to another device running this spirit (messages and GGTP requests)",
  db: "keep data on this device and sync it with the other device",
};

export interface Manifest {
  name: string;
  version: number;
  icon: string;
  description: string;
  /** 0 = runs alone; 2 = can connect to one other device running the same spirit. */
  peers: 0 | 2;
  permissions: Permission[];
}

export const FILE_NAMES = ["index.html", "app.js", "style.css"] as const;
export type FileName = (typeof FILE_NAMES)[number];
export type SpiritFiles = Record<FileName, string>;

export interface SpiritSource {
  manifest: Manifest;
  files: SpiritFiles;
}

/** A spirit stored in the Séance OS library. */
export interface InstalledSpirit {
  appId: string;
  /** Full SHA-256 of the bundle body, hex. */
  hash: string;
  author: string;
  words: string[];
  manifest: Manifest;
  files: SpiritFiles;
  bundle: Uint8Array;
  installedAt: number;
  /** Station that shared it with us, or null when published on this device or preloaded. */
  from: number | null;
  origin: "studio" | "sound" | "preloaded";
}

export const MAX_NAME = 32;

export function validateManifest(raw: unknown): { ok: true; manifest: Manifest } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: ["the manifest must be a JSON object"] };
  const m = raw as Record<string, unknown>;
  const name = typeof m.name === "string" ? m.name.trim() : "";
  if (!name) errors.push('"name" is required');
  else if (name.length > MAX_NAME) errors.push(`"name" can be at most ${MAX_NAME} characters`);
  const version = m.version ?? 1;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1 || version > 65535) errors.push('"version" must be a whole number from 1 to 65535');
  const icon = typeof m.icon === "string" && m.icon.trim() ? m.icon.trim() : "👻";
  if ([...icon].length > 4) errors.push('"icon" should be one emoji');
  const description = typeof m.description === "string" ? m.description.trim() : "";
  if (description.length > 160) errors.push('"description" can be at most 160 characters');
  const peers = m.peers ?? 0;
  if (peers !== 0 && peers !== 2) errors.push('"peers" must be 0 (alone) or 2 (two devices)');
  const perms = m.permissions ?? [];
  if (!Array.isArray(perms) || perms.some((p) => p !== "peer" && p !== "db")) errors.push('"permissions" can contain "peer" and "db"');
  if (peers === 2 && Array.isArray(perms) && !perms.includes("peer")) errors.push('a spirit with "peers": 2 needs the "peer" permission');
  for (const k of Object.keys(m)) {
    if (!["name", "version", "icon", "description", "peers", "permissions"].includes(k)) errors.push(`unknown field "${k}"`);
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    manifest: { name, version: version as number, icon, description, peers: peers as 0 | 2, permissions: [...new Set(perms as Permission[])] },
  };
}

/** Compact JSON for packing: this is what travels over sound. */
export function sourceToJson(src: SpiritSource): string {
  return JSON.stringify({ manifest: src.manifest, files: src.files });
}

export function parseSource(json: string): { ok: true; source: SpiritSource } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: "the spirit source is not valid JSON" };
  }
  const r = raw as { manifest?: unknown; files?: Record<string, unknown> };
  const m = validateManifest(r?.manifest);
  if (!m.ok) return { ok: false, error: `bad manifest: ${m.errors.join("; ")}` };
  if (!r.files || typeof r.files !== "object") return { ok: false, error: "the spirit has no files" };
  const files = {} as SpiritFiles;
  for (const f of FILE_NAMES) {
    const v = r.files[f] ?? "";
    if (typeof v !== "string") return { ok: false, error: `${f} is not text` };
    files[f] = v;
  }
  return { ok: true, source: { manifest: m.manifest, files } };
}

export function bytesToHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(h: string): Uint8Array {
  const clean = h.length % 2 ? "0" + h : h;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** App id: SHA-256("ggtf-app" || author public key || name), first 8 bytes as hex. */
export async function appIdFor(authorHex: string, name: string): Promise<string> {
  const enc = new TextEncoder();
  const parts = [enc.encode("ggtf-app"), hexToBytes(authorHex), enc.encode(name)];
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", all));
  return bytesToHex(digest.slice(0, 8));
}

/** The 8-byte tag sent with a "play together" call: the app id. */
export function callTag(appId: string): Uint8Array {
  return hexToBytes(appId.slice(0, 16));
}

export type InstallVerdict =
  | { kind: "new" }
  | { kind: "same"; existing: InstalledSpirit }
  | { kind: "update"; existing: InstalledSpirit }
  | { kind: "older"; existing: InstalledSpirit }
  | { kind: "changed"; existing: InstalledSpirit }
  | { kind: "other-author"; existing: InstalledSpirit };

/** How a received spirit relates to what is already installed. */
export function compareInstall(library: InstalledSpirit[], incoming: { appId: string; hash: string; manifest: Manifest }): InstallVerdict {
  const same = library.find((s) => s.appId === incoming.appId);
  if (same) {
    if (same.hash === incoming.hash) return { kind: "same", existing: same };
    if (incoming.manifest.version > same.manifest.version) return { kind: "update", existing: same };
    if (incoming.manifest.version < same.manifest.version) return { kind: "older", existing: same };
    return { kind: "changed", existing: same };
  }
  const lookalike = library.find((s) => s.manifest.name.toLowerCase() === incoming.manifest.name.toLowerCase());
  if (lookalike) return { kind: "other-author", existing: lookalike };
  return { kind: "new" };
}
