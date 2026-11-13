# Implementation plan: Séance OS

Order matters: the link comes first, because GGTP, GhostDB and two-peer spirits all run on it. Each phase leaves the project working.

## Phase 1: Link upgrades (Rust)

- [x] 1.1 Binary messages with a kind byte; `send_msg(kind, bytes)`; `send_text` becomes kind 0; 12,000-byte limit
- [x] 1.2 Lazy fragmenting by profile, with shrink-on-retry and grow-on-success
- [x] 1.3 Delayed and piggybacked ACK; DATA AAD covers ack and flags
- [x] 1.4 Defer retry timers while a receiver is mid-frame
- [x] 1.5 Keep-alive PING while connected and idle
- [x] 1.6 CALL tag; `Incoming { from, tag }`, `Answering { from, tag }`
- [x] 1.7 Tests: 5 KB binary message, piggyback, keep-alive alive and dead, tag, noisy long message; existing tests still pass
- _Requirements: 1.1–1.7_

## Phase 2: Bundles and sim air (Rust + WASM)

- [x] 2.1 `bundle.rs`: pack, open, author public key, author words; tests for tamper, wrong key, bad magic, size limit
- [x] 2.2 `duo.rs`: two stations on simulated air with noise and loss, auto-pair; test
- [x] 2.3 WASM: `send_bytes`, `call_tagged`, `set_keepalive`, new events, bundle functions, `WasmDuo`; rebuild `public/wasm`
- [x] 2.4 Worker and `useStation`: raw byte messages, event subscription, tagged calls; `/link` shows link details
- _Requirements: 1, 2.1–2.4_

## Phase 3: Protocol layer (TypeScript)

- [x] 3.1 `ggtp.ts`: codec and symmetric endpoint (requests, routes, watch, notify, timeouts)
- [x] 3.2 `ghostdb.ts`: LWW store, delta pull, push, persistence adapter
- [x] 3.3 `session.ts`: HELLO, mismatch reasons, DB sync wiring
- [x] 3.4 `transport.ts`: instant pair, sim air, real link
- [x] 3.5 Tests with `bun test`
- _Requirements: 4.3, 4.4, 5, 6_

## Phase 4: Runtime and bundles in the browser

- [x] 4.1 SDK script and srcdoc builder with CSP
- [x] 4.2 `SpiritHost` bridge and `<SpiritFrame>`
- [x] 4.3 `bundle.ts`: source JSON, manifest validation, app id, author key storage
- [x] 4.4 IndexedDB store: library, projects, GhostDB blobs
- _Requirements: 2, 3.2, 3.3_

## Phase 5: Séance OS (`/seance`)

- [x] 5.1 Spirits tab: launcher, Share over sound, Remove
- [x] 5.2 Receive tab: listen, progress, install sheet (author words, shared by, permissions, update and author warnings)
- [x] 5.3 App window: run offline; Play together with the tagged call, incoming prompt naming the spirit, SAS words, HELLO check, peer status
- _Requirements: 3, 4.1–4.3_

## Phase 6: Spirit Studio (`/studio`)

- [x] 6.1 CodeMirror editor, files, projects saved in the browser, templates
- [x] 6.2 Run: one preview, or two peers on instant or sim air (noise, loss)
- [x] 6.3 Panels: Console, Network, GhostDB (A and B), Budget
- [x] 6.4 Publish to the Séance OS library
- [x] 6.5 Phone layout
- _Requirements: 7_

## Phase 7: Examples, docs and checks

- [x] 7.1 Templates: Fortune (offline), Ghost Grid (peer messages), Spirit Board (GhostDB), Ghost Wiki (GGTP serve/get)
- [x] 7.2 `/docs` page; README section; navigation links
- [x] 7.3 Browser check script: studio two-peer sim air run, publish, OS install from a loopback beam
- _Requirements: 7.4, 8_
