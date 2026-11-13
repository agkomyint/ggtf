# Tech steering

## Stack and where each language goes
- **Rust** (`crates/ggtf-core`): modem, framing, Reed-Solomon, link state machine, X25519/ChaCha20 crypto, Ed25519 spirit bundles, channel simulator, `Duo` (two stations on simulated air), ML inference. Compiled to WASM by `crates/ggtf-wasm`.
- **TypeScript** (`apps/web/lib/seance`): everything above the link that must run the same over three transports: GGTP, GhostDB, sessions, the iframe host and SDK. Keep it free of React so `bun test` can cover it.
- **Python** (`ml/`): training and ONNX export only. The model ships inside the WASM.
- **Bun** for every JS/TS command. Never npm, yarn or pnpm.

## Commands
| Task | Command |
|---|---|
| Rust tests | `cargo test --release --workspace` (set `CARGO_HOME=D:\.cargo` on the dev machine) |
| Web unit tests | `bun test apps/web` |
| Rebuild WASM (commit the output) | `bun run build:wasm` |
| Re-sign starter spirits (commit the output) | `bun scripts/pack-starters.ts` |
| Production build | `bun run build`, then `bun --bun next start -p 3210` in `apps/web` |
| End-to-end browser check | `bun run check:seance` (add `--air` for the real speaker and mic) |

## Conventions
- Next.js 16 has breaking changes: read `apps/web/node_modules/next/dist/docs` before using an unfamiliar API.
- shadcn/ui here is the Base UI flavour: use the `render` prop, not `asChild`; style links with `buttonVariants`.
- Don't assign refs during render (the lint rule `react-hooks/refs` fails); update them in an effect.
- Port 3000 belongs to another project on the dev machine; GGTF runs on 3210.
- Every protocol change gets a test: Rust in `crates/ggtf-core/tests`, TypeScript next to the file as `*.test.ts`.
- Spirits run in `sandbox="allow-scripts allow-forms"` iframes with the CSP in `runtime.ts`. Never add `allow-same-origin`.
- Secrets: the author key lives in the user's localStorage; the starter signing key lives in `.secrets/` (git-ignored). Never commit either.
