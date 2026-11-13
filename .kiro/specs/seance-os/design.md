# Design: Séance OS

## Overview

```
 Spirit Studio (/studio)          Séance OS (/seance)                 another device
 ┌───────────────────────┐ publish ┌──────────────────────────┐ beam  ┌──────────────┐
 │ editor · preview A/B   │───────▶│ library (IndexedDB)       │──────▶│ install sheet │
 │ console · network · db │        │ receive · share · launch  │◀═════▶│ play together │
 └─────────┬─────────────┘        └─────────┬────────────────┘  link └──────────────┘
           │ instant / sim-air               │ real sound
     ┌─────▼──────────────────────────────────▼─────┐
     │ SpiritHost (TS): sandboxed iframe ⇄ bridge    │
     │   SpiritSession: HELLO, GGTP engine, GhostDB  │
     └─────────────────────┬─────────────────────────┘
                           │ Transport: send(bytes) / onReceive / onLink
     ┌─────────────────────▼─────────────────────────┐
     │ Rust/WASM: Station → Link (kind 1 messages)   │
     │           bundle pack/open, Duo (sim air)     │
     └───────────────────────────────────────────────┘
```

Rust keeps everything that touches audio, framing, crypto and signatures. TypeScript keeps the protocol above the link (GGTP, GhostDB, sessions), because it has to run the same way over three transports and talk to the iframe.

## 1. Link upgrades (`crates/ggtf-core/src/link.rs`)

### Inner plaintext (inside the encrypted DATA payload)

| Inner type | Bytes | Meaning |
|---|---|---|
| 0 CONFIRM | `[0]` | the user confirmed the SAS words |
| 1 MSG | `[1, kind, msg_id, frag_hi, frag_lo, last]` + data | one fragment of a message |
| 2 BYE | `[2]` | hang up |
| 3 PING | `[3]` | keep-alive |

Message kinds: 0 = chat text, 1 = GGTP. Up to 12,000 bytes per message.

### Fragmenting when sent

The outbox stores whole messages. Each time a DATA frame is built, the link cuts the next fragment at `min(base(profile), limit)`:

| Profile | Base fragment |
|---|---|
| wraith | 56 B |
| specter | 120 B |
| banshee, poltergeist | 176 B |

176 + 6 inner + 16 tag = 198, under the 200-byte frame limit. `limit` starts at 176. A fragment that needed 3 or more sends halves it (floor 32). Four clean first-try deliveries in a row double it.

### Piggybacked ACK

On a new DATA frame, the receiver waits up to 350 ms before sending the ACK. If it builds a DATA frame in that time, it sets `flags |= 0x01` and `ack = counter` in that frame's header. DATA frames now authenticate `[type, src, dst, seq, ack, flags]` as AAD, so a forged piggyback ACK fails the tag. BYE is acknowledged at once (the close-after logic needs a queued ACK). A request/response exchange drops from 4 frames to 3.

### Timers and keep-alive

- `Station::tick` calls `Link::defer_timers` while any receiver is mid-frame, so a long reply doesn't trigger a resend.
- While connected with an empty outbox and no frame from the peer for 45 s (plus a random 0–8 s per session), the link sends PING. A failed PING runs the normal retry-and-fallback path and ends with "link lost".

### CALL tag

`call_tagged(tag)` puts up to 16 bytes in the CALL payload. `Incoming { from, tag }` and `Answering { from, tag }` report it. Séance OS uses the first 8 bytes of the app id.

## 2. Bundles (`crates/ggtf-core/src/bundle.rs`)

```
offset 0   4 bytes   magic 00 47 53 01  ("\0GS" v1)
offset 4  32 bytes   author Ed25519 public key
offset 36 64 bytes   signature over "ggtf-spirit-v1" || body
offset 100 …         body = raw DEFLATE (miniz_oxide level 10) of the source
```

- Source is UTF-8 JSON: `{"manifest": {...}, "files": {"index.html", "app.js", "style.css"}}`.
- `open` checks the magic, verifies the signature (strict), and inflates with a 256 KB limit (no zip bombs).
- Bundle hash = SHA-256(body). Author words = SAS words of SHA-256(public key).
- App id (computed in TS) = SHA-256("ggtf-app" ‖ author public key ‖ name), first 8 bytes as 16 hex characters.
- Author key: 32 random bytes from `crypto.getRandomValues`, kept in `localStorage`. The public key is derived in Rust.

Manifest:

```json
{ "name": "Ghost Grid", "version": 1, "icon": "👻", "description": "…", "peers": 2, "permissions": ["peer", "db"] }
```

## 3. GGTP (`apps/web/lib/seance/ggtp.ts`)

Every message has the same layout:

```
[0] 0x40 | type    type: 0 REQ, 1 RES, 2 NOTIFY, 3 MSG, 4 CANCEL, 5 HELLO
[1] code           REQ: 1 GET 2 POST 3 PUT 4 DELETE 5 WATCH; RES: CoAP status (class<<5 | detail)
[2] token          matches RES/NOTIFY/CANCEL to a REQ (1–255; 0 for MSG/HELLO)
[3] format         0 none, 1 text, 2 json, 3 bytes
[4] path length    then UTF-8 path (REQ, MSG topic); 0 otherwise
[…] body
```

Overhead is 5 bytes plus the path. Status codes: 2.01 created, 2.02 deleted, 2.04 changed, 2.05 content, 4.00 bad request, 4.03 forbidden, 4.04 not found, 4.05 method not allowed, 5.00 server error, 5.03 unavailable, 5.04 timeout (local only).

`GgtpEndpoint` is symmetric: it sends requests (default timeout 120 s), routes incoming requests to handlers (`/~db/…` reserved for the OS), tracks WATCH tokens per path, and sends NOTIFY when `notify(path)` is called.

## 4. Session (`apps/web/lib/seance/session.ts`)

1. Link up → send `HELLO {app, h (hash, 16 hex), v, n, d (device)}`.
2. Peer HELLO arrives → if `h` matches: `ready`, emit `peer:join`, start GhostDB sync. Otherwise `mismatch` with a reason ("peer has version 2", "peer is running Spirit Board").
3. Link down → `peer:leave`, pending requests fail with 5.03.

## 5. GhostDB (`apps/web/lib/seance/ghostdb.ts`)

Record: `{k, v, c (Lamport clock), d (device id), x (deleted), l (local sequence)}`.

- Local write: `clock += 1`, `lseq += 1`, store with `d = me`.
- Merge: the incoming record wins when `(c, d)` is greater than the local `(c, d)`; on a win, `lseq += 1` and store with the new `l`. `clock = max(clock, c)`.
- Pull on connect: `REQ POST /~db/pull {since: cursor[peer]}` → `RES {recs, top, more}`, at most about 1.5 KB per response, skipping records whose `d` is the requester. Repeat while `more`. Then `cursor[peer] = top`.
- Push while connected: each local write is sent as `MSG ~db/push {recs, top}`. The receiver advances its cursor from pushes only after its pull finished.
- Persistence: one JSON blob per app in IndexedDB, saved with a 300 ms debounce. The core class is pure and tested with `bun test`.

## 6. Runtime (`apps/web/lib/seance/runtime.ts`, `components/seance/spirit-frame.tsx`)

- `<iframe sandbox="allow-scripts allow-forms" srcdoc=…>`: opaque origin, so no access to the OS's storage, cookies or DOM. `allow-forms` only lets submit events fire; the CSP's `form-action 'none'` blocks real posts.
- srcdoc = CSP meta (`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; form-action 'none'`) + style + SDK + `index.html` body + `app.js`.
- Bridge: `postMessage` both ways. The host only accepts messages whose `source` is its own iframe window. Calls are `{t:"call", id, fn, args}` → `{t:"ret", id, ok, value|error}`. Events are `{t:"evt", name, data}`.
- SDK (`window.spirit`): `me`, `on(event)`, `peer.send/on/connected`, `db.get/put/del/list/watch`, `ggtp.get/post/put/del/watch`, `serve(method, path, fn)`, `notify(path, body)`, `log`.
- Known limit: a spirit can still navigate its own frame to a URL. It only has its own data, and the CSP blocks fetch, XHR, WebSocket, images from the network and form posts.

## 7. Transports

| Transport | Used by | How |
|---|---|---|
| Instant | Studio | in-memory pair, delivered on the next microtask |
| Sim air | Studio | `WasmDuo` in the worker: two Rust stations, mixed audio, Gaussian noise and chunk loss, auto-pair and auto-confirm, runs faster than real time |
| Real sound | Séance OS | `useStation` link, message kind 1 |

## 8. Pages

- `/seance`: header with station status. Tabs: **Spirits** (launcher, Share, Remove), **Receive** (listen, chunk map, install sheet), and an app window overlay with Play together, the SAS words, peer status and the GGTP activity strip.
- `/studio`: toolbar (project, template, Run, transport, noise, loss, Publish). Desktop: files and editor | previews A and B, with a bottom panel (Console, Network, GhostDB, Budget). Phone: tabs Code / Preview / Panels.
- `/docs`: SDK, GGTP, GhostDB, bundle format and security.

## 9. Testing

- Rust: link tests (binary 5 KB message, piggyback removes the standalone ACK, keep-alive keeps an idle link and ends a dead one, CALL tag, lossy delivery), bundle tests (round trip, tamper, wrong key, zip bomb), Duo test.
- Bun: GGTP codec round trip and malformed input, endpoint request/response/watch/timeout over a fake pair, GhostDB convergence and delta sync, runtime srcdoc includes the CSP, bundle source validation.
- Browser: Chrome script that publishes in Studio, runs two peers on sim air, and checks the Ghost Grid move goes across.
