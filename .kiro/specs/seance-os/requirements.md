# Requirements: Séance OS

## Introduction

Séance OS turns GGTF into a small peer-to-peer app platform that works only through sound. A developer writes a small web app ("spirit") in the browser, on a laptop or a phone, and tests it there. When it works, they publish it and share it over sound. Anyone who received it can run it offline and share it again. Two people who have the same spirit can connect over sound and use it together. Spirits that need two-way traffic use GGTP (a compact request/response protocol) and GhostDB (a small synced key-value store).

This spec builds on `.kiro/specs/ggtf`. It first upgrades the two-way link, because every connected spirit depends on it.

Out of scope: groups of 3 or more peers in one session (stretch goal), spirits that use the internet, and a public app store.

## Glossary

- **Spirit**: a small app made of HTML, JavaScript, CSS and a manifest.
- **Bundle**: a packed spirit: compressed source, the author's public key and an Ed25519 signature.
- **Author key**: an Ed25519 key pair created in the author's browser. The public key identifies the author.
- **App id**: a value derived from the author key and the spirit name. Two bundles with the same app id are versions of the same spirit.
- **Bundle hash**: SHA-256 of the bundle's compressed body. Two peers can play together only when their bundle hashes match.
- **Séance OS**: the `/seance` page: launcher, receiving, installing, sharing and running spirits.
- **Spirit Studio**: the `/studio` page: editor, preview, two-peer testing, inspectors and publishing.
- **GGTP**: Ghost Gibberlink Transfer Protocol, a CoAP-style binary protocol carried inside link messages.
- **GhostDB**: a per-spirit key-value store on each device that syncs with the connected peer.
- **Peer**: the other device in a two-way session. Either side can serve requests.

## Requirements

### Requirement 1: Link upgrades

**User story:** As a spirit developer, I want the link to carry binary messages quickly and stay open while people are idle, so that apps can talk without the line dropping.

1. THE link SHALL carry binary messages up to 12,000 bytes, each tagged with a message kind (0 = chat text, 1 = GGTP).
2. THE link SHALL cut messages into fragments when they are sent, sized by the current profile (larger on faster profiles), and SHALL shrink the fragment size after repeated retries and grow it back after clean deliveries.
3. WHEN a data frame arrives and the receiver has its own data to send within a short delay, THE link SHALL carry the acknowledgement inside that data frame instead of sending a separate ACK. The acknowledgement SHALL be covered by the frame's authentication tag.
4. WHILE the receiver is in the middle of a frame, THE link SHALL postpone its retry timers so it does not resend over an incoming reply.
5. WHILE connected with no traffic for the keep-alive interval, THE link SHALL send an authenticated keep-alive. WHEN the keep-alive fails after all retries, THE link SHALL end the session with "link lost".
6. THE caller MAY attach a tag of up to 16 bytes to its CALL frames. THE answerer SHALL report the tag with the incoming call.
7. Text chat on `/link` SHALL keep working unchanged for the user.
8. WHILE a long message is being sent, THE link SHALL report progress (bytes acknowledged of the total) to the sender, and bytes received so far to the receiver.
9. THE line test SHALL NOT pick the experimental Turbo profile unless it is turned on explicitly.
10. Retry timers SHALL use a random backoff that grows with each attempt, so two stations that collided don't resend in step.

### Requirement 2: Bundles and authorship

**User story:** As a user, I want to know who made a spirit and that nobody changed it along the way, so that re-sharing is safe.

1. WHEN a spirit is published, THE studio SHALL compress its source and sign it with the author key.
2. WHEN a bundle is opened, THE OS SHALL verify the signature and SHALL refuse bundles whose signature or format is invalid.
3. THE OS SHALL refuse bundles whose source expands beyond 256 KB.
4. THE OS SHALL show the author as 4 spooky words derived from the author public key.
5. WHEN a received bundle has the same app id as an installed spirit, THE OS SHALL offer it as an update when the version is higher, and SHALL say it is already installed when the hash matches.
6. WHEN a received bundle has the same name as an installed spirit but a different author, THE OS SHALL warn the user before installing.

### Requirement 3: Install, run offline and re-share

**User story:** As a user, I want to receive a spirit over sound, run it without sound afterwards, and pass it on.

1. WHILE listening, THE OS SHALL recognise spirit bundles inside beams and SHALL open an install screen showing the name, version, author words, who shared it, size, hash and requested permissions.
2. WHEN the user installs a spirit, THE OS SHALL store the bundle on the device so the spirit opens with no sound.
3. THE OS SHALL run each spirit in a sandboxed iframe with no same-origin access and a content security policy that blocks network requests.
4. THE OS SHALL let the user share any installed spirit over sound, whoever authored it, without changing the bundle.
5. THE OS SHALL let the user remove a spirit and its local data.

### Requirement 4: Two peers in one spirit

**User story:** As two users who both have a spirit, we want to connect and use it together, with no host device.

1. WHEN a user presses Play together in a spirit with `peers: 2`, THE OS SHALL call with the spirit's app tag.
2. WHEN a call with a known app tag arrives, THE OS SHALL name the spirit in the incoming-call prompt.
3. WHEN the link connects, both sides SHALL exchange a HELLO with the app id, version and bundle hash, and SHALL only start the spirit session when the hashes match. On a mismatch, both sides SHALL show why.
4. Either peer SHALL be able to send messages, serve GGTP requests and make GGTP requests.
5. THE caller SHALL send HELLO first and the answerer SHALL reply, so the two don't talk over each other. GhostDB pulls SHALL take turns the same way.
6. THE user SHALL be able to choose the band (low, mid, high) for Play together and for sharing a spirit.
7. `spirit.peer.send` SHALL resolve only once the peer has the whole message, and SHALL accept an `onProgress` callback.

### Requirement 4b: Starter spirits

1. Séance OS SHALL install a set of starter spirits on first visit, signed by one GGTF key so every device has identical copies and can play them together without sharing first.
2. THE OS SHALL only install starters signed by the key named in the starter index.
3. WHEN the user removes a starter, THE OS SHALL NOT reinstall it until the user asks to restore the starters.

### Requirement 5: GGTP

1. GGTP SHALL support requests (GET, POST, PUT, DELETE, WATCH), responses with CoAP-style status codes, notifications for watched paths, cancel, peer messages and HELLO.
2. Every request SHALL carry a token, and THE responder SHALL echo it so concurrent requests match their responses.
3. A request with no response within the timeout SHALL fail with a timeout status.
4. THE codec SHALL reject malformed messages without throwing into the app.

### Requirement 6: GhostDB

1. Each spirit SHALL have its own store on each device with get, put, delete, list by prefix and watch.
2. Writes SHALL be ordered with Lamport clocks and resolved last-writer-wins per key, with the device id as tie-breaker, so both peers end up with the same data.
3. WHEN peers connect, each side SHALL fetch only the records changed since its last sync with that peer. WHILE connected, local writes SHALL be pushed to the peer.
4. Deletes SHALL be kept as tombstones so they sync.

### Requirement 7: Spirit Studio

1. THE studio SHALL provide a code editor for the manifest, HTML, JavaScript and CSS, with a layout that works on desktop and phone.
2. THE studio SHALL run the spirit in a preview. For `peers: 2`, it SHALL run two previews connected by either an instant transport or simulated air (the real modem with adjustable noise and audio loss).
3. THE studio SHALL show a console, a GGTP network log, both GhostDB copies, and a budget with bundle size and install time per speed.
4. THE studio SHALL offer templates: an offline toy, a two-player game, a shared board, a wiki, a long-letter app and a drawing app.
5. THE studio SHALL publish a spirit into the device's Séance OS library, signed with the author key.
6. Projects SHALL be saved in the browser.

### Requirement 8: Documentation

1. A `/docs` page SHALL describe the spirit SDK, GGTP, GhostDB, the bundle format and the security model.
