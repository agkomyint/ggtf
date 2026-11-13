# Devpost submission draft: GGTF

**Category:** Frankenstein
**Live demo:** https://ggtfver.vercel.app/
**Repo:** https://github.com/agkomyint/ggtf (MIT)

## Tagline

Talk to machines through the dead air: an encrypted network, an app store and a multiplayer platform that run only on sound.

## Inspiration

Dial-up modems screamed data through phone lines. Gibberlink showed AI agents switching from speech to tones. We asked what a whole network would look like if the only wire were the air in the room: no Wi-Fi, no Bluetooth, no cable, no server.

## What it does

- **Séance link** (`/link`): two devices call, run a dial-up style line test, swap X25519 keys over sound, compare four spooky words and chat with every frame encrypted (ChaCha20-Poly1305).
- **Haunted QR** (`/beam`): one device broadcasts a link, a Wi-Fi login or a small image to everyone in earshot. No camera, no pairing.
- **Haunted room** (`/haunt`): a remote controls a room (lights, door, ghost) by sound in about 1.5 s.
- **Séance OS** (`/seance`): apps ("spirits") that travel through sound. Receive one, check its author's signature, run it offline, pass it on unchanged, or play it with someone nearby. Six starter spirits come preinstalled, so two people can play right away.
- **Spirit Studio** (`/studio`): write a spirit in the browser on a laptop or phone, run two copies connected instantly or over a simulation of the real modem with noise and dropouts, inspect every protocol message and both databases, then publish.
- **Haunted lab** (`/lab`): benchmark the decoder in 21 simulated rooms, with or without the ML receiver.

## How we built it (the Frankenstein parts)

| Part | Technology |
|---|---|
| Modem | Rust: 16-tone MFSK, chirp sync, Reed-Solomon, CRC, three bands (0.5, 1.5 and 14.5 kHz) |
| Browser audio | Rust compiled to WebAssembly in a Web Worker, fed by an AudioWorklet |
| Link | half-duplex stop-and-wait ARQ with profile fallback, ACKs that ride inside replies, keep-alives, tagged calls |
| Crypto | X25519, HKDF, ChaCha20-Poly1305, 4-word SAS; Ed25519 signed app bundles |
| ML | a 28k-parameter MLP trained in PyTorch on simulated rooms, run by Rust inside the WASM |
| Protocol | GGTP, a CoAP-style protocol with a 5-byte header (GET, POST, PUT, DELETE, WATCH) |
| Data | GhostDB: Lamport-clock last-writer-wins store with delta sync between peers |
| Apps | sandboxed iframes with a CSP, a `window.spirit` SDK, CodeMirror studio |
| Front end | Next.js 16, shadcn/ui, Bun everywhere |

## Measured results

| Test | Result |
|---|---|
| Damaged frames accepted as good, across every benchmark | 0 |
| Frames decoded in 21 simulated rooms (classic / ML) | 87% / 90% |
| App share (1,214 bytes) over a real speaker and mic | 28 s |
| From "Play together" to playing | about 30 s (pairing and key exchange included) |
| A game move crossing the room | 1.2–2.8 s |
| A 1,000-byte letter (Ghost Post) | 37.5 s, with progress on both sides |
| Automated checks | 36 Rust tests, 48 Bun tests, 42 Chrome end-to-end checks (including real sound) |

## Challenges

- Laptop mic drivers cancel the laptop's own speaker. We found it with a diagnostics endpoint and a mic-check script, and documented the fix.
- The fastest profile passed the short line test but lost long frames over real air. The link now leaves it off unless turned on explicitly.
- When both people pressed "They match" at once, their frames collided. Randomised backoff and a caller-speaks-first rule fixed it.
- Keeping apps safe: an opaque-origin sandbox and a CSP, verified by tests that try to reach the network, the parent page, the author key and form posts.

## What's next

Groups of three or more in one session, OFDM for more speed, ESP32 devices over WebSerial, and a reliability bench on more phones.

## How Kiro was used

- **Specs:** two spec folders drove the work. `.kiro/specs/ggtf/` covers the modem, link, beam and ML receiver. `.kiro/specs/seance-os/` covers the app platform: requirements in EARS form, a design with exact wire formats (link inner frames, bundle layout, GGTP header, GhostDB records), and a phased task list. The link upgrade was planned first because everything else depends on it, and the tasks were checked off as each phase passed its tests. `build-notes.md` records where the build differed from the plan.
- **Steering:**
  - `project.md` sets the rules (Bun only, Rust for anything touching audio or keys, Python only for ML, shadcn UI, never ignore `.kiro/`).
  - `tech.md` lists commands and conventions learned during the build (Next.js 16 changes, Base UI's `render` prop, the iframe sandbox rule, where secrets live).
  - `structure.md` says where new code goes.
- **Hooks** (`.kiro/hooks/`):
  - Bun tests run when a protocol file changes.
  - `cargo check` runs when Rust changes.
  - A reminder fires to rebuild the committed WASM and re-sign the starter apps.
  - A stop hook keeps the specs in sync with the code.
- **Agent work:** Kiro wrote and debugged the Rust modem and link, the WASM bindings, the TypeScript protocol layer and both apps. It also wrote the Chrome DevTools Protocol scripts that test everything end to end, including over the real speaker and mic. Several bugs were found by reading those runs' logs: the sandboxed forms, the BroadcastChannel not reaching its own page, Turbo losing long frames, and the confirm collision.
- **Property-based tests:** `proptest` checks round trips, no silent corruption, simulator determinism, key agreement and tamper detection.

## Demo video script (under 3 minutes)

| Time | Show | Say |
|---|---|---|
| 0:00–0:15 | Laptop and phone side by side, Wi-Fi visibly off | "No Wi-Fi, no Bluetooth, no server. Just sound." |
| 0:15–0:40 | `/link`: Call, Accept, the four words, a chat message | "A dial-up handshake, a key exchange over sound, and four words to rule out an eavesdropper." |
| 0:40–1:10 | `/studio`: open Ghost Grid, Run on sim air, show the Network tab | "Apps are written in the browser and tested on a simulation of the real modem." |
| 1:10–1:40 | Publish, then in `/seance` press Share over sound; the phone shows the install screen with the author words | "The app is signed. Anyone can pass it on, but nobody can change it." |
| 1:40–2:10 | Both open Ghost Grid, Play together, confirm the words, make a move | "Two devices play together with no host. Moves cross the room in about two seconds." |
| 2:10–2:35 | Ghost Post: send a long letter, show the progress bar | "Longer data works too: a kilobyte in under 40 seconds." |
| 2:35–2:55 | `/lab` table, then the `.kiro` folder | "Measured in 21 simulated rooms, built spec-first with Kiro." |
| 2:55–3:00 | Title card | "GGTF: talk to machines through the dead air." |
