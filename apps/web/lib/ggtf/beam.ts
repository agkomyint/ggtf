// Helpers for beam mode: Wi-Fi QR strings, link detection and airtime estimates.

/** Escapes a value for the WIFI: QR format (backslash, semicolon, comma, colon, quote). */
function wifiEscape(s: string): string {
  return s.replace(/([\\;,:"])/g, "\\$1");
}

export type WifiSecurity = "WPA" | "WEP" | "nopass";

/** Same string a Wi-Fi QR code contains; phones and many apps understand it. */
export function wifiString(ssid: string, password: string, security: WifiSecurity, hidden = false): string {
  const parts = [`T:${security}`, `S:${wifiEscape(ssid)}`];
  if (security !== "nopass") parts.push(`P:${wifiEscape(password)}`);
  if (hidden) parts.push("H:true");
  return `WIFI:${parts.join(";")};;`;
}

export interface WifiInfo {
  ssid: string;
  password: string;
  security: string;
}

export function parseWifi(text: string): WifiInfo | null {
  if (!text.startsWith("WIFI:")) return null;
  const fields: Record<string, string> = {};
  let key = "";
  let val = "";
  let inKey = true;
  for (let i = 5; i < text.length; i++) {
    const c = text[i];
    if (c === "\\" && i + 1 < text.length) {
      val += text[++i];
    } else if (inKey && c === ":") {
      inKey = false;
    } else if (!inKey && c === ";") {
      fields[key] = val;
      key = "";
      val = "";
      inKey = true;
    } else if (inKey) {
      key += c;
    } else {
      val += c;
    }
  }
  if (!("S" in fields)) return null;
  return { ssid: fields.S, password: fields.P ?? "", security: fields.T ?? "nopass" };
}

/** Only http(s) links are offered as "Open", so a beam can't launch other URL schemes. */
export function safeLink(text: string): string | null {
  const t = text.trim();
  if (!/^https?:\/\/\S+$/i.test(t)) return null;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// Airtime model, mirroring crates/ggtf-core/src/modem.rs (48 kHz samples).
const PROFILES = [
  { name: "wraith", label: "Sturdy", L: 2400, ramp: 120, parity: 24, groups: 2 },
  { name: "specter", label: "Balanced", L: 1440, ramp: 120, parity: 16, groups: 2 },
  { name: "banshee", label: "Fast", L: 720, ramp: 60, parity: 12, groups: 2 },
  { name: "poltergeist", label: "Turbo β", L: 720, ramp: 60, parity: 12, groups: 3 },
] as const;
export const BEAM_PROFILES = PROFILES;
export const CHUNK_SMALL = 48;
export const CHUNK_LARGE = 196;
const HEADER_CW = 19;

function payloadParity(base: number, len: number): number {
  return Math.max(2, Math.min(base * Math.ceil(Math.max(1, len) / 96), 255 - 4 - Math.min(len, 250)));
}

export function beamChunks(bytes: number, chunk = CHUNK_SMALL): number {
  return Math.ceil((bytes + 4) / chunk);
}

/** Seconds for one full round of the carousel. */
export function beamRoundSeconds(bytes: number, profile: number, chunk = CHUNK_SMALL): number {
  const p = PROFILES[profile] ?? PROFILES[1];
  let left = bytes + 4;
  let total = 0;
  while (left > 0) {
    const data = Math.min(left, chunk);
    left -= data;
    const payload = 4 + data;
    const cw = payload + 4 + payloadParity(p.parity, payload);
    const sym = (n: number) => Math.ceil((2 * n) / p.groups);
    total += 5280 + 4800 + sym(HEADER_CW) * p.L + sym(cw) * p.L + p.ramp + 960;
  }
  return total / 48000;
}

export function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

// ---------- images ----------
// Envelope: [0x00, 'G', 'I', mime (1 = webp, 2 = jpeg), width, height] + image bytes.
// Text beams never start with 0x00, so receivers can tell them apart.
const IMG_MAGIC = [0x00, 0x47, 0x49];

export interface ImagePreset {
  key: string;
  label: string;
  size: number;
  quality: number;
}
export const IMAGE_PRESETS: ImagePreset[] = [
  { key: "tiny", label: "Tiny 48 px", size: 48, quality: 0.5 },
  { key: "small", label: "Small 72 px", size: 72, quality: 0.55 },
  { key: "medium", label: "Medium 96 px", size: 96, quality: 0.6 },
  { key: "large", label: "Large 128 px", size: 128, quality: 0.6 },
];

/** Shrinks an image to fit `size` px, compresses it (WebP, falling back to JPEG) and wraps it. */
export async function encodeImage(file: Blob, preset: ImagePreset, gray = false): Promise<{ bytes: Uint8Array; url: string; w: number; h: number }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, preset.size / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  if (gray) ctx.filter = "grayscale(1)";
  ctx.drawImage(bmp, 0, 0, w, h);
  const toBlob = (type: string) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, preset.quality));
  let blob = await toBlob("image/webp");
  let mime = 1;
  if (!blob || blob.type !== "image/webp") {
    blob = await toBlob("image/jpeg");
    mime = 2;
  }
  const img = new Uint8Array(await blob!.arrayBuffer());
  const bytes = new Uint8Array(6 + img.length);
  bytes.set([...IMG_MAGIC, mime, Math.min(w, 255), Math.min(h, 255)]);
  bytes.set(img, 6);
  return { bytes, url: URL.createObjectURL(blob!), w, h };
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** If the bytes are an image envelope, returns a data URL for it. */
export function decodeImage(bytes: Uint8Array): { url: string; w: number; h: number; mime: string } | null {
  if (bytes.length < 7 || bytes[0] !== IMG_MAGIC[0] || bytes[1] !== IMG_MAGIC[1] || bytes[2] !== IMG_MAGIC[2]) return null;
  const mime = bytes[3] === 1 ? "image/webp" : bytes[3] === 2 ? "image/jpeg" : null;
  if (!mime) return null;
  const blob = new Blob([bytes.slice(6)], { type: mime });
  return { url: URL.createObjectURL(blob), w: bytes[4], h: bytes[5], mime };
}