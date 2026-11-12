# Project steering

This is a Kiroween 2026 submission in the **Frankenstein** category: one working app that combines technologies that don't normally go together.

**Name:** GGTF, short for Ghost Gibberlink Transmission Framework. Tagline: "Talk to machines through the dead air."
**Concept:** data-over-sound. One device encodes commands as audio, nearby devices decode them through the microphone and run allow-listed actions.

## Rules for the agent
- Build only what the current spec asks for. No unrequested features.
- Keep the project runnable from a fresh clone. Document every setup step in README.md.
- Never put secrets in code or commits. Use environment variables and keep a `.env.example`.
- Never add `.kiro/` to `.gitignore`. The hackathon requires it in the public repo.
- Work through specs in `.kiro/specs/` (requirements, design, tasks) before writing code.

## Tech stack
- **Bun** everywhere on the JS/TS side: package manager, script runner, `bun test`, and runtime for Next.js (`bun --bun next`). Don't use npm, yarn, pnpm or Node-specific tooling.
- **UI:** shadcn/ui components on Tailwind CSS, lucide-react icons, Motion for animation, Sonner for toasts. Use an existing shadcn component before writing a custom one. Add components with `bunx shadcn@latest add <name>`.
- **Rust** for all signal processing, framing, error correction, crypto and the channel simulator, compiled to WebAssembly (`wasm-pack`) and to a Python extension (PyO3 + maturin).
- **Python** only for ML: data generation, training, ONNX export and benchmarks.

The full design is in `.kiro/specs/ggtf/design.md`.
