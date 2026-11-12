# Build notes (working plan for the first build)

Scope of this build: Phase 0 to Phase 2 plus the simulator lab. ML (Phase 4), Python bindings and ggwave baseline (Phase 3), and full duplex (Phase 5) come later.

## Decisions taken while building (update design.md when stable)
- Modem: MFSK, 16 tones x 2 parallel groups, 4 bits per group per symbol. Goertzel per tone, no FFT for symbols.
  - wraith: window 1920, guard 480, base 1800 Hz, spacing 50 Hz, RS parity 24 (160 bps raw)
  - specter: window 960, guard 480, base 1500 Hz, spacing 100 Hz, RS parity 16 (267 bps raw)
  - banshee: window 480, guard 240, base 1500 Hz, spacing 100 Hz, RS parity 12 (533 bps raw)
  - Guard works like a cyclic prefix: echoes shorter than the guard don't hit the analysis window. Symbols crossfade over guard/4.
- Frame: chirp preamble 1500->4800 Hz (100 ms) + 10 ms gap + 2 wraith "marker" symbols that say which profile follows + header codeword + payload codeword.
  - Header: ver/type, src(2), dst(2), seq, ack, flags, len + CRC-16, RS parity 8 = 19 bytes.
  - Payload: bytes + CRC-32, RS parity from profile. One RS codeword each (frames are < 255 bytes), so no interleaving needed.
  - Low-confidence symbols become RS erasures; CRC decides which decode attempt is accepted.
- Receiver: 4th-order band-pass 1100-5600 Hz, FFT normalized correlation (rustfft, NFFT 8192) for the preamble, threshold 0.22.
- Link: half-duplex stop-and-wait. CALL -> ANSWER -> TRAIN x3 (slow to fast) -> TRAIN_RESULT -> KEY/KEY (X25519) -> SAS 4 spooky words -> CONFIRM (encrypted, reliable) -> chat.
  - ACKs are authenticated (AEAD tag of empty message). ACKs mirror the profile of the frame they answer.
  - 4 retries per profile, then fall back to a slower profile, then end the session.
  - Carrier sense: a station doesn't transmit while its receiver is in the middle of a frame.
- Browser: worklet and worker live in `apps/web/public/audio/` and load the WASM from `apps/web/public/wasm/`, so no bundler config is needed. Built WASM is committed so the app runs with only Bun.
- No SharedArrayBuffer for now: the worklet posts 2048-sample chunks straight to the worker through a MessageChannel.

## Progress
- [x] Rust core compiles; 18 Rust tests pass (unit, property-based, two-station session)
- [x] WASM builds (466 KB) and passes `scripts/wasm-smoke.ts`
- [x] Next.js + shadcn app builds with `bun --bun next build`
- [x] /link: two stations pair and chat in headless Chrome over a virtual cable (`scripts/browser-loopback.ts`)
- [x] /lab simulator page runs all 14 rooms in Chrome (`scripts/browser-check.ts`)
- [x] README
- [ ] Real speaker + mic test with two tabs (needs a person at the laptop)

## Bugs found while verifying
- Newer Chrome returns a Promise from `scrollIntoView`, so `useEffect(() => el.scrollIntoView())` handed React a non-function cleanup and crashed `/link`. Effects now use block bodies and scroll the boxes directly.
