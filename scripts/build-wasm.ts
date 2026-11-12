// Builds crates/ggtf-wasm into apps/web/public/wasm with wasm-pack.
// The output is committed so the web app runs with only Bun installed.
import { $ } from "bun";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const outDir = join(root, "apps", "web", "public", "wasm");

function findWasmPack(): string {
  const found = Bun.which("wasm-pack");
  if (found) return found;
  const exe = process.platform === "win32" ? "wasm-pack.exe" : "wasm-pack";
  const homes = [process.env.CARGO_HOME, join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".cargo")];
  for (const h of homes) {
    if (!h) continue;
    const p = join(h, "bin", exe);
    if (existsSync(p)) return p;
  }
  throw new Error("wasm-pack not found. Install it with: cargo install wasm-pack");
}

const wasmPack = findWasmPack();
await $`${wasmPack} build crates/ggtf-wasm --release --target web --out-dir ${outDir} --out-name ggtf_wasm --no-pack`.cwd(root);

// wasm-pack drops a .gitignore that ignores everything; remove it so the build is committed.
for (const f of [".gitignore", "package.json", "README.md"]) {
  const p = join(outDir, f);
  if (existsSync(p)) rmSync(p);
}
console.log(`WASM written to ${outDir}`);
