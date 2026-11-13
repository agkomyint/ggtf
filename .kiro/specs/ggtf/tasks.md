# Implementation plan: GGTF

Each phase ends with something that works on its own, so the project is submittable even if later phases are cut. Tasks marked `*` are optional. Notes in *italics* record where the build differs from the plan; see `build-notes.md`.

## Phase 0: Repository and toolchain

- [ ] 1. Set up the monorepo
  - [x] 1.1 Create root `package.json` with Bun workspaces and scripts: `build:wasm`, `dev`, `build`, `test`, `test:rust`, `test:ts`, `bench` *(no `test:py` yet)*
  - [x] 1.2 Create Cargo workspace with `crates/ggtf-core`, `crates/ggtf-wasm` *(`ggtf-py` deferred to Phase 3)*
  - [ ] 1.3 Create `ml/` Python project (`pyproject.toml`) with maturin build of `ggtf-py`
  - [x] 1.4 Add `.gitignore` for build output only (never `.kiro/`) *(no `.editorconfig`)*
  - [x] 1.5 Write README with required tools, versions and setup steps
  - _Requirements: 11.1, 11.2, 11.3_
- [x] 2. Update steering
  - [x] 2.1 Add `.kiro/steering/tech.md` (stack, commands, coding conventions)
  - [x] 2.2 Add `.kiro/steering/structure.md` (folder layout and where code belongs)
  - _Requirements: 11.1_

## Phase 1: Modem core in Rust

- [x] 3. Signal building blocks
  - [x] 3.1 MFSK tone generator with raised-cosine shaping and profile definitions
  - [x] 3.2 Chirp preamble generator and correlation detector with start time *(no frequency offset estimate; drift tolerance comes from the guard interval)*
  - [x] 3.3 Classic symbol decoder (Goertzel tone energies, soft output)
  - _Requirements: 1.1, 2.1, 2.2_
- [x] 4. Framing and error correction
  - [x] 4.1 Header encode/parse with CRC-16
  - [x] 4.2 Payload Reed-Solomon and CRC-32, with erasure support *(one codeword per part, so no interleaving)*
  - [x] 4.3 Fragmentation and reassembly of messages larger than one frame *(in the link layer, 60 bytes per frame)*
  - [x] 4.4* Property tests: round trip, no silent corruption (properties 1, 3) *(property 12 covered by the session test, not a property test)*
  - _Requirements: 1.2, 1.3, 1.4, 1.5_
- [x] 5. Channel simulator
  - [x] 5.1 Seeded stages: gain, clipping, reverb, white noise, synthetic talkers/music/beeps, dropouts, bursts, drift *(no competing-transmission stage yet)*
  - [x] 5.2* Property test: determinism (property 5) *(noise and burst tolerance measured by the benchmark instead)*
  - _Requirements: 8.1, 8.2_
- [x] 6. Streaming receiver
  - [x] 6.1 Continuous input buffer that finds preambles, decodes frames and recovers after cut-off frames
  - [x] 6.2 Tests using the simulator with interruptions mid-frame
  - _Requirements: 2.2, 2.4_
- [x] 7. Checkpoint: all Rust tests pass; a frame survives the simulator's moderate noise scenario

## Phase 2: Browser link, half-duplex

- [x] 8. WASM binding
  - [x] 8.1 `ggtf-wasm` exposing the station, benchmark and degraded-sample audio *(feature extraction comes with the ML phase)*
  - [x] 8.2 `build:wasm` script with `wasm-pack --target web` into `apps/web/public/wasm` (committed)
  - _Requirements: 8.3, 11.2_
- [x] 9. Next.js app shell on Bun
  - [x] 9.1 Create `apps/web`, base layout *(no COOP/COEP: not needed without SharedArrayBuffer)*
  - [x] 9.1a Tailwind + shadcn/ui (Base UI), lucide-react, Motion, Sonner, haunted theme as shadcn CSS variables
  - [x] 9.2 Landing page `/`
  - _Requirements: 7.4, 11.1_
- [x] 10. Audio pipeline
  - [x] 10.1 AudioWorklet for capture and playback, mic constraints with processing off
  - [x] 10.2 MessagePort transfer of 2048-sample chunks, plus linear resampler *(SharedArrayBuffer ring buffer skipped)*
  - [x] 10.3 Link worker that loads WASM and runs the station off the main thread
  - [ ] 10.4* `bun test` + `fast-check` tests for the resampler
  - _Requirements: 1.6, 4.3, 7.3_
- [x] 11. Link layer state machine (Rust)
  - [x] 11.1 States, CALL/ANSWER, stop-and-wait ARQ, timeouts, retries, idle timeout, BYE
  - [x] 11.2 Self-filter by station ID, duplicate and replay window
  - [x] 11.3 Training phase and profile selection with fallback
  - [ ] 11.4* Property tests: exactly-once delivery, self-filter, replay rejection (properties 6, 7, 8)
  - _Requirements: 3.1–3.7, 4.1, 4.2, 5.5_
- [x] 12. Security
  - [x] 12.1 X25519 key exchange, HKDF, SAS (4 words), ChaCha20-Poly1305 data frames and authenticated ACKs
  - [x] 12.2 Confirmation step that blocks user data until both users confirm
  - [x] 12.3* Property tests: authentication and key agreement (properties 9, 10)
  - _Requirements: 5.1–5.4_
- [x] 13. `/link` page
  - [x] 13.1 Summon/answer controls, SAS confirmation dialog, chat with message states
  - [x] 13.2 Live spectrogram with band markers, status panel with metrics, event log
  - [x] 13.3 Error states: mic denied, insecure origin, sample-rate fallback, decode failures, session end reasons
  - _Requirements: 6.1–6.3, 7.1, 7.2_
- [x] 14. Checkpoint: two tabs on one laptop complete a secure half-duplex chat over the speaker and mic
  - *Verified over a real speaker and mic (two Chrome profiles on one laptop, `scripts/seance-check.ts --air`) and by the developer on separate devices.*

## Phase 3: Benchmarks and baseline

- [ ] 15. Offline benchmark
  - [ ] 15.1 `ggtf-py` PyO3 bindings for encoder, decoder, simulator and features
  - [ ] 15.2 Collect noise datasets, check licenses, document them in `ml/datasets.md`
  - [ ] 15.3 `bench.py` scenario matrix for the classic decoder and ggwave, writing JSON and markdown results
    - *A Rust benchmark (`bun run bench` → `bench/results.md`) and the in-browser `/lab` page already cover the classic decoder; ggwave is not compared yet.*
  - _Requirements: 8.3, 9.7, 10.1–10.3_
- [ ] 16. Live benchmark and capture
  - [ ] 16.1 `/bench` page with numbered test sequence and BroadcastChannel ground truth
  - [ ] 16.2 `/capture` page that records labeled real-air sessions
  - _Requirements: 10.4, 10.5_
- [ ] 17. Tune profiles, bands and timeouts from benchmark results
  - *The simulator is currently too kind: harder rooms (lower SNR, speaker frequency response) are needed before tuning.*
- [ ] 18. Checkpoint: benchmark results committed; classic decoder meets the clean-scenario target

## Phase 4: ML receiver

- [x] 19. Training pipeline
  - [x] 19.1 Synthetic labeled data from the Rust encoder, simulator and features *(Rust example `ml_data` instead of `generate.py`)*
  - [x] 19.2 `ml/train.py`: small MLP symbol decoder with a separately seeded validation set *(MLP, not CNN)*
  - [x] 19.3 Export: `symbol_mlp.bin` for Rust + ONNX copy; parity checked by `ml_eval`
  - [ ] 19.4* `pytest` + `hypothesis` tests for feature parity and export parity (property 11)
  - _Requirements: 9.1–9.3_
- [x] 20. Browser inference
  - [x] 20.1 Model embedded in the WASM and run by Rust in the link worker *(no onnxruntime-web)*; classic/ML switch in the UI
  - [x] 20.2 Map model probabilities to RS erasures
  - [x] 20.3 Fallback to classic when no model is bundled, and per frame when the ML decode fails its CRC
  - _Requirements: 9.3–9.5_
- [ ] 21. Add the ML decoder to the benchmark; validate on real captures *(benchmark done; real captures not yet)*
  - _Requirements: 9.6, 10.2_
- [x] 22. Checkpoint: ML decoder beats classic in noisy scenarios without losing in clean; model committed
  - _Requirements: 9.6, 11.4_

## Phase 4b: Bands, comfort and beam (added in round 2)

- [x] B1. Low / mid / high bands; one receiver per band; answerer adopts the caller's band
- [x] B2. Output volume control; high band as the quiet option
- [x] B3. Beam mode (`/beam`, "Haunted QR"): chunked carousel broadcast, message CRC, Wi-Fi and link helpers
- [x] B4. Glare: both sides pressing Call resolves by station id
- [x] B5. Harder benchmark rooms (21 rooms in 3 tiers, speaker roll-off) and classic-vs-ML tables per profile and band

## Phase 5: Full-duplex (stretch)

- [ ] 23. Band-split profiles for caller and answerer, receiver band filtering
- [ ] 24. Sliding-window ARQ with piggybacked ACKs
- [ ] 25. Half/full-duplex switch on `/link` and in the benchmark
- [ ] 26. Checkpoint: full-duplex chat works between two tabs and two devices
  - _Requirements: 3.8_

## Phase 6: Submission

- [x] 27. Deploy the web app to an HTTPS host and test the deployed URL on two devices *(https://ggtfver.vercel.app/)*
- [x] 28. Finish README: features, architecture diagram, benchmark table, how to test with two tabs
- [x] 29. Write the "How Kiro was used" write-up (specs, steering, hooks, MCP, PBT) *(`docs/devpost.md`)*
- [ ] 30. Record the demo video (under 3 minutes) and fill in the Devpost form

## Phase 7: Séance OS

- [x] 31. App platform over sound: see `.kiro/specs/seance-os/` (link upgrades, GGTP, GhostDB, Studio, OS, starters)
