# GGTF · Ghost Gibberlink Transmission Framework

> Talk to machines through the dead air.

GGTF is a two-way, encrypted data link that works only through sound. Two browsers pair, agree on keys and chat using a speaker and a microphone. No Wi-Fi, Bluetooth or cable is involved.

Built for **Kiroween 2026**, Frankenstein category. It stitches together:

- 1960s acoustic-modem ideas: tone signalling, a dial-up style handshake with a line test, and stop-and-wait resends;
- a Rust modem compiled to **WebAssembly**, running in a browser **AudioWorklet** and **Web Worker**;
- modern cryptography: **X25519** key exchange over sound, four "spooky words" to compare, and **ChaCha20-Poly1305** for every frame;
- a seeded room simulator (talking, music, beeps, echoes, cut-outs, door slams, clock drift) that measures the decoder in the browser;
- a **Next.js** + **shadcn/ui** front end, all run with **Bun**.

## Try it on one computer

1. Turn the speaker volume up. Don't use headphones, because the mic has to hear the speaker.
2. Open `/link` in **two tabs** (Chrome or Edge) and click **Open the séance** in both. Allow the microphone.
3. Click **Call** in one tab. An **Accept** button appears in the other tab within a few seconds. Click it. If you'd rather skip this step, turn on **Auto-accept calls**.
4. Both tabs show the same four words. Click **They match** in both, then chat.

Each station ignores its own echo, so both tabs can share one speaker and one mic. Two devices in the same room work the same way.

The **Haunted lab** (`/lab`) runs the decoder against 14 simulated rooms in your browser. Each room has a button that plays what the receiver hears.

## Run it

Requirements: [Bun](https://bun.sh) 1.4 or later. The compiled WebAssembly is committed in `apps/web/public/wasm/`, so you don't need Rust just to run the app.

```bash
bun install
bun run build
bun run start        # http://localhost:3000
# or: bun run dev
```

The microphone only works on `https://` or `http://localhost`.

### Rebuilding the Rust core

Needs Rust (stable) with the `wasm32-unknown-unknown` target and `wasm-pack` (`cargo install wasm-pack`).

```bash
bun run build:wasm   # crates/ggtf-wasm -> apps/web/public/wasm
```

## Tests and benchmarks

```bash
bun run test:rust    # unit, property-based (proptest) and two-station session tests
bun run test:ts      # bun test
bun run bench        # writes bench/results.md and bench/results.json
bun scripts/wasm-smoke.ts                 # two stations through the compiled .wasm in Bun
bun scripts/browser-check.ts              # headless Chrome: /lab benchmark + /link start-up (server on :3000)
bun scripts/browser-loopback.ts           # two full browser stations over a virtual audio cable in Chrome
```

The browser scripts take an optional Chrome path and base URL, for example `bun scripts/browser-check.ts "C:/Program Files/Google/Chrome/Application/chrome.exe" http://localhost:3000`.

The latest simulated results are in [`bench/results.md`](bench/results.md). Every room decodes 100% on every profile except in-band notification beeps (wraith 100%, specter 90%, banshee 35%). Across all runs, no corrupted frame was ever accepted. These are simulated rooms. Real speakers and microphones are harder, and real-room numbers still need to be measured.

## How it works

```
 Station (browser tab)
   React UI (shadcn) ── commands/events ──► Web Worker: ggtf-wasm Station
                                               Link state machine ─ Modem ─ Receiver
   AudioWorklet  ◄── MessagePort (2048-sample chunks) ──►
      │ speaker                     ▲ microphone
      ▼                             │
                ~~~~~~~~ air ~~~~~~~~
```

| Layer | What it does |
|---|---|
| Modem (`crates/ggtf-core/src/modem.rs`) | MFSK: 16 tones × 2 parallel groups, 4 bits per group per symbol. A guard interval absorbs echoes. Symbols crossfade to avoid clicks. |
| Profiles | `wraith` 160 bps raw (most robust), `specter` 267 bps, `banshee` 533 bps (fastest). |
| Sync | A 100 ms chirp (1.5 to 4.8 kHz) found by FFT cross-correlation after a band-pass filter, then 2 marker symbols that announce the profile. |
| Framing | Header and payload are separate Reed-Solomon codewords with CRC-16 / CRC-32. Low-confidence tones become erasures, and the CRC decides which decode to trust. |
| Link (`link.rs`) | CALL → ANSWER → 3 test frames, slow to fast → TRAIN_RESULT → KEY/KEY → 4 words → CONFIRM → chat. Stop-and-wait with authenticated ACKs. 4 retries, then a slower profile, then hang up. |
| Security (`crypto.rs`) | Ephemeral X25519, HKDF-SHA256 to directional keys, ChaCha20-Poly1305 with a counter nonce. Replays are rejected. User data is blocked until both people confirm the words. |
| Simulator (`sim.rs`) | Deterministic noise, synthetic talkers, music, beeps, reverb, dropouts, bursts, drift and clipping. Used by the tests, the benchmark and `/lab`. |

## Repository layout

```
.kiro/                 specs (requirements, design, tasks), steering, hooks
apps/web/              Next.js app (Bun, shadcn/ui, Tailwind, Motion)
  public/audio/        AudioWorklet processor and link worker
  public/wasm/         compiled ggtf-wasm (committed)
crates/ggtf-core/      modem, receiver, link, crypto, simulator, benchmark (+ tests)
crates/ggtf-wasm/      wasm-bindgen wrapper
scripts/               WASM build, smoke test, headless Chrome checks
bench/                 benchmark results
```

## Status

Built and tested: the Rust core, the WASM binding, half-duplex secure chat between two browser stations, the in-browser lab, and automated tests (Rust unit/property/session tests, a Bun smoke test, and headless Chrome checks).

Not built yet (see `.kiro/specs/ggtf/tasks.md`):
- the ML receiver (Python training, ONNX in the browser);
- the ggwave baseline and the Python bindings;
- the live over-the-air benchmark and capture pages;
- full-duplex mode;
- deployment.

## License

MIT, see [LICENSE](LICENSE).
