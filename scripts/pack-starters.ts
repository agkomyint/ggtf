// Packs the studio templates as signed "starter spirits" that Séance OS installs on first visit.
// Every device gets byte-identical bundles from one author key, so two people can play a
// starter together without sharing it first.
//
// The signing key comes from GGTF_STARTER_KEY (64 hex chars) or .secrets/starter-key.hex,
// which is created on first run and must not be committed.
// Usage: bun scripts/pack-starters.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { author_public, author_words, bundle_open, bundle_pack, initSync } from "../apps/web/public/wasm/ggtf_wasm.js";
import { bytesToHex, hexToBytes, sourceToJson } from "../apps/web/lib/seance/bundle";
import { TEMPLATES } from "../apps/web/lib/seance/templates";

const root = join(import.meta.dir, "..");
initSync({ module: readFileSync(join(root, "apps/web/public/wasm/ggtf_wasm_bg.wasm")) });

const keyFile = join(root, ".secrets", "starter-key.hex");
let hex = process.env.GGTF_STARTER_KEY ?? (existsSync(keyFile) ? readFileSync(keyFile, "utf8").trim() : "");
if (!/^[0-9a-f]{64}$/i.test(hex)) {
  hex = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  mkdirSync(join(root, ".secrets"), { recursive: true });
  writeFileSync(keyFile, hex + "\n");
  console.log(`created a new starter key in ${keyFile} (keep it, don't commit it)`);
}
const secret = hexToBytes(hex);
const pub = author_public(secret);
const words: string[] = JSON.parse(author_words(pub));

const out = join(root, "apps/web/public/spirits");
mkdirSync(out, { recursive: true });
const spirits = [];
for (const t of TEMPLATES) {
  const bytes = bundle_pack(secret, sourceToJson(t.source));
  const check = JSON.parse(bundle_open(bytes));
  if (!check.ok) throw new Error(`${t.key}: ${check.error}`);
  writeFileSync(join(out, `${t.key}.ggs`), bytes);
  spirits.push({ key: t.key, file: `/spirits/${t.key}.ggs`, name: t.source.manifest.name, version: t.source.manifest.version, bytes: bytes.length, hash: check.hash });
  console.log(`${t.key.padEnd(8)} ${String(bytes.length).padStart(5)} B  ${t.source.manifest.name}`);
}
writeFileSync(join(out, "index.json"), JSON.stringify({ author: bytesToHex(pub), words, spirits }, null, 2) + "\n");
console.log(`signed by ${words.join(" · ")}`);
