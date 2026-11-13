# GGTF · Ghost Gibberlink Transmission Framework

> Talk to machines through the dead air.

GGTF is a two-way, encrypted data link that works only through sound. Two browsers pair, agree on keys and chat using a speaker and a microphone. No Wi-Fi, Bluetooth or cable is involved.

Built for **Kiroween 2026**, Frankenstein category. It stitches together:

- 1960s acoustic-modem ideas: tone signalling, a dial-up style handshake with a line test, and stop-and-wait resends;
- a Rust modem compiled to **WebAssembly**, running in a browser **AudioWorklet** and **Web Worker**;
- modern cryptography: **X25519** key exchange over sound, four "spooky words" to compare, and **ChaCha20-Poly1305** for every frame;
- a seeded room simulator (talking, music, beeps, echoes, cut-outs, door slams, clock drift, speaker roll-off) that measures the decoder in the browser;
- a small **neural-network receiver** trained in PyTorch on that simulator and run by Rust inside the WASM, with an on/off switch;
- a **Next.js** + **shadcn/ui** front end, all run with **Bun**.

## Try it on one computer

1. Turn the speaker volume up. Don't use headphones, because the mic has to hear the speaker.
2. Open `/link` in **two tabs** (Chrome or Edge) and click **Open the séance** in both. Allow the microphone.
3. Click **Call** in one tab. An **Accept** button appears in the other tab within a few seconds. Click it. If you'd rather skip this step, turn on **Auto-accept calls**.
4. Both tabs show the same four words. Click **They match** in both, then chat.

Each station ignores its own echo, so both tabs can share one speaker and one mic. Two devices in the same room work the same way.

Some laptops cancel their own speaker in the microphone driver (Intel Smart Sound, Realtek, ASUS AI noise cancelling, NVIDIA Broadcast). If the other tab never shows **Incoming call**, turn those off, or use a laptop and a phone. `bun scripts/mic-check.ts --band=mid` measures whether your mic hears your speaker.

## Haunted QR: replace a QR code with sound

`/beam` broadcasts a link, a note or a Wi-Fi login to every device in the room. Nobody pairs and nobody needs a camera.

- The message and a CRC-32 are cut into 48-byte chunks and repeated in a carousel. A receiver can start listening at any time and fills gaps on the next round, in any order.
- Wi-Fi logins use the same `WIFI:T:WPA;S:…;P:…;;` text a Wi-Fi QR code holds. Receivers show the network and a **Copy password** button. Links get an **Open link** button, which only works for `http(s)`.
- Like a printed QR code, it's readable by anyone in earshot, so don't beam secrets.
- **Images:** the sender shrinks a picture to 48–128 px and compresses it to WebP (JPEG fallback), usually 0.5–3 KB. The receiver shows a live chunk map and then the image.
- **Speed options:** four speeds (Sturdy, Balanced, Fast, Turbo β) and big chunks (196 bytes per frame instead of 48). The page shows the bytes, the chunk count and the estimated time, then the measured B/s while sending and receiving.

**Measured over real air** (laptop speaker to its own mic, mid band, `bun scripts/real-air-beam.ts`):

| What | Speed | Chunks | Result |
|---|---|---|---|
| Link, 33 B | Balanced | 48 | 2.8 s |
| Link, 33 B | Turbo β | 48 | **1.2 s** (27 B/s) |
| Image, 928 B | Fast | 196 | **20.7 s (45 B/s)** |
| Image, 928 B | Fast | 96 | 26 s (36 B/s) |
| Image, 928 B | Turbo β | 96 / 196 | failed: long Turbo frames break over real air |

In simulated air with mild noise, a 3 KB blob arrived at 30 B/s (Fast, 48-byte chunks), 47 B/s (Fast, big chunks) and 68 B/s (Turbo, big chunks).

## Frequency bands and comfort

Every station listens on all three bands at once. The **Sound settings** card picks the band it sends on.

| Band | Range | Notes |
|---|---|---|
| Low | 0.5–4.1 kHz | Warmer; carries through small speakers; competes with voices and music |
| Mid | 1.5–5.1 kHz | Default; most reliable |
| High | 14.5–18.1 kHz | A faint whine most people barely notice; some speakers and mics can't reach it, so test it first |

There's also a **volume** slider, and symbols crossfade so there are no clicks. On the developer's laptop, the High band rose 67 dB above room noise at the mic.

## ML receiver

The classic decoder picks the loudest of 16 tones in each symbol. That's near-optimal for hiss, but notification beeps, echoes and sustained music notes fool it. The ML receiver sees more context for each tone: tone power over the whole symbol, over four quarters of it, and over the previous and next symbols. A 3-layer MLP (28,400 parameters, 114 KB) turns that into 16 probabilities. If the ML decode fails its CRC, the classic decoder retries the same audio, so turning ML on can only add frames. Low-confidence outputs become Reed-Solomon erasures.

- Training data comes from the same Rust modem and simulator: `bun run ml:data` writes 516k labeled symbols from random rooms.
- `bun run ml:train` trains on the GPU in about 6 seconds. It writes `crates/ggtf-core/models/symbol_mlp.bin` (embedded in the WASM) and `ml/models/symbol_mlp.onnx`.
- `bun run ml:eval` checks that Rust inference matches PyTorch.
- Validation symbol accuracy: classic 89.8% → ML 91.6% (18% fewer symbol errors).

Turn it on or off in **Sound settings** on `/link` and `/beam`, or with **Compare with ML** in `/lab`.

The **Haunted lab** (`/lab`) runs 21 simulated rooms in 3 tiers (easy, hard, brutal) for any band and profile, classic vs ML. Each room has a button that plays what the receiver hears.

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

The latest simulated results are in [`bench/results.md`](bench/results.md). These are 210 cells (21 rooms × profiles × bands, classic and ML), 20 frames each:

- **Classic:** 89.6% of frames overall, 83.2% in hard and brutal rooms.
- **ML:** 92.2% overall, 87.4% in hard and brutal rooms.
- Biggest gains: notification beeps on banshee went from 35% to 100%; loud music on the low band from 0% to 70%; beeps at 0 dB on the low band from 65% to 100%.
- Still failing: a big echoing hall (RT60 800 ms) breaks every profile, and the High band fails through a phone speaker that cuts off at 7 kHz.
- No corrupted frame was ever accepted.

These are simulated rooms. Real-room numbers still need to be measured.

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
| Bands (`profile.rs`) | Low, mid and high; the same tone layout shifted by the band base. One receiver per band runs in parallel. |
| Sync | A 100 ms chirp across the band, found by FFT cross-correlation after a band-pass filter, then 2 marker symbols that announce the profile. |
| ML (`ml.rs`) | Context features, embedded MLP, ML-then-classic fallback. |
| Beam (`beam.rs`) | Connectionless chunked broadcast with a message CRC and any-order reassembly. |
| Framing | Header and payload are separate Reed-Solomon codewords with CRC-16 / CRC-32. Low-confidence tones become erasures, and the CRC decides which decode to trust. |
| Link (`link.rs`) | CALL → ANSWER → 3 test frames, slow to fast → TRAIN_RESULT → KEY/KEY → 4 words → CONFIRM → chat. Stop-and-wait with authenticated ACKs. 4 retries, then a slower profile, then hang up. If both sides press Call, the lower station ID answers. |
| Security (`crypto.rs`) | Ephemeral X25519, HKDF-SHA256 to directional keys, ChaCha20-Poly1305 with a counter nonce. Replays are rejected. User data is blocked until both people confirm the words. |
| Simulator (`sim.rs`) | Deterministic noise, synthetic talkers, music, beeps, reverb, dropouts, bursts, drift and clipping. Used by the tests, the benchmark and `/lab`. |

## Repository layout

```
.kiro/                 specs (requirements, design, tasks), steering, hooks
apps/web/              Next.js app (Bun, shadcn/ui, Tailwind, Motion)
  public/audio/        AudioWorklet processor and link worker
  public/wasm/         compiled ggtf-wasm (committed)
crates/ggtf-core/      modem, receiver, link, crypto, beam, ML decoder, simulator, benchmark (+ tests)
  models/              trained symbol_mlp.bin (embedded in the WASM)
ml/                    PyTorch training script, ONNX copy, report
crates/ggtf-wasm/      wasm-bindgen wrapper
scripts/               WASM build, smoke test, headless Chrome checks
bench/                 benchmark results
```

## Status

Built and tested:
- the Rust core and WASM binding;
- three bands;
- half-duplex secure chat;
- beam mode;
- the ML receiver;
- the in-browser lab;
- automated tests: 24 Rust unit, property and session tests, 7 Bun tests, a WASM smoke test and headless Chrome checks.

Not built yet (see `.kiro/specs/ggtf/tasks.md`):
- the ggwave baseline;
- the live over-the-air benchmark and capture pages;
- full-duplex mode;
- deployment.

## License

MIT, see [LICENSE](LICENSE).
