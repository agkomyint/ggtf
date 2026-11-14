# Requirements: GGTF (Ghost Gibberlink Transmission Framework)

## Introduction

GGTF is a two-way data link that works only through sound. Two devices exchange messages by playing audio from a speaker and decoding it from a microphone, with no Wi-Fi, Bluetooth or cable involved. The link must stay reliable in real rooms with speech, music, background noise and interruptions. A receiver-side neural model, trained on generated and augmented audio, improves decoding in conditions where classic signal processing fails.

GGTF is a Kiroween 2026 submission in the Frankenstein category. It combines 1960s-style acoustic modem ideas (tone signalling, band-split full duplex, dial-up handshakes) with Rust compiled to WebAssembly, a Next.js browser app on Bun, modern cryptography and an ML decoder trained in Python.

Out of scope for this spec: running actions on the host computer (no local helper program), file transfer larger than a few KB, and any transport other than sound.

## Glossary

- **Station**: one browser tab running GGTF. A station has a random station ID.
- **Caller / Answerer**: the station that starts a session and the station that responds.
- **Frame**: one transmitted unit (preamble, header, payload, checksums).
- **Modem core**: the Rust library that encodes frames to audio samples and decodes samples to frames.
- **Channel simulator**: code that degrades clean audio the way a real room would (noise, echo, interruptions).
- **Profile**: a named set of modem parameters (band, tone count, symbol length, error correction strength).
- **Classic decoder**: the decoder that uses FFT and correlation only.
- **ML decoder**: the decoder that uses the trained model for symbol estimation.
- **Baseline**: ggwave, used only for comparison in benchmarks.
- **Goodput**: correctly delivered payload bytes per second, after resends.

## Requirements

### Requirement 1: Encode and decode frames as sound

**User story:** As a user, I want text and small data turned into sound and back, so that two devices can exchange data without a network.

#### Acceptance criteria

1. WHEN the application sends a payload of 1 to 64 bytes, THE modem core SHALL produce a mono 48 kHz audio buffer containing one frame.
2. WHEN a payload is larger than one frame can hold, THE link layer SHALL split it into numbered frames and THE receiver SHALL reassemble them in order.
3. WHEN the receiver gets an undamaged frame buffer, THE modem core SHALL return exactly the original payload.
4. THE modem core SHALL include a CRC in every frame and SHALL reject frames whose CRC fails, never passing corrupted payloads to the application.
5. THE modem core SHALL apply Reed-Solomon error correction with interleaving so that a frame survives a burst of damaged symbols up to the limit defined by its profile.
6. WHEN the browser audio context does not run at 48 kHz, THE station SHALL resample input and output so the modem core always works at 48 kHz.

### Requirement 2: Find frames in noisy audio

**User story:** As a user, I want the receiver to notice a transmission even when the room is noisy, so that messages are not missed.

#### Acceptance criteria

1. THE modem core SHALL start every frame with a synchronization preamble designed for correlation detection.
2. WHEN a preamble is present in the input stream, THE receiver SHALL detect it and estimate its start time and frequency offset without the user pressing anything.
3. WHILE no GGTF signal is present, THE receiver SHALL keep its false detection rate below the target set in the design, measured by the benchmark.
4. WHEN a frame is cut off by an interruption, THE receiver SHALL discard it, recover, and detect the next preamble.

### Requirement 3: Two-way session over sound

**User story:** As a user, I want two stations to connect and talk back and forth, like a dial-up modem, so that delivery can be confirmed.

#### Acceptance criteria

1. WHEN a caller starts a session, THE caller SHALL transmit CALL frames until an ANSWER frame arrives or a timeout expires.
2. WHEN an answerer hears a CALL frame and the user has enabled answering, THE answerer SHALL reply with an ANSWER frame.
3. WHEN CALL and ANSWER have been exchanged, THE stations SHALL run a training phase that tests profiles from slowest to fastest and SHALL select the fastest profile that both sides decode reliably.
4. THE link layer SHALL number every data frame and SHALL resend any frame not acknowledged within the timeout, up to a maximum retry count.
5. WHEN the retry limit is reached, THE station SHALL report the failure to the user and SHALL fall back to a slower profile or end the session.
6. WHEN no frame has been received for the idle timeout, THE station SHALL end the session and tell the user.
7. WHERE half-duplex mode is selected, THE stations SHALL take turns transmitting and SHALL never transmit while expecting a reply.
8. WHERE full-duplex mode is selected, THE caller and answerer SHALL transmit in separate frequency bands and each station SHALL decode only the other station's band.

### Requirement 4: Ignore your own transmissions

**User story:** As a developer, I want two tabs on one computer to talk to each other, so that I can test without a second machine.

#### Acceptance criteria

1. THE station SHALL include its station ID in every frame header.
2. WHEN a station decodes a frame carrying its own station ID, THE station SHALL drop it.
3. THE station SHALL request microphone input with echo cancellation, noise suppression and automatic gain control turned off.
4. WHEN two stations run in two tabs or windows of the same browser on one computer, THE stations SHALL complete a session through the speaker and microphone.

### Requirement 5: Secure the link

**User story:** As a user, I want only the station I paired with to read and send my messages, so that a stranger or a recording cannot control the session.

#### Acceptance criteria

1. WHEN a session starts, THE stations SHALL exchange X25519 public keys over sound and derive session keys.
2. WHEN keys are derived, BOTH stations SHALL show the same short authentication code (4 digits or 4 words), and THE session SHALL not carry user data until the user confirms the codes match.
3. THE link layer SHALL encrypt and authenticate all data frames with an AEAD cipher.
4. WHEN a frame fails authentication, THE station SHALL drop it and log the event.
5. THE link layer SHALL reject frames whose sequence number has already been accepted, so replayed audio has no effect.

### Requirement 6: Chat and messages

**User story:** As a user, I want to type messages and see the other station's replies, so that I can use the link for something real.

#### Acceptance criteria

1. WHEN a session is confirmed, THE web app SHALL let the user type and send a text message.
2. THE web app SHALL show each message's state: queued, sending, delivered (acknowledged) or failed.
3. WHEN a message arrives, THE web app SHALL show it once, even if its frames were received more than once.

### Requirement 7: Make the sound visible

**User story:** As a viewer of the demo, I want to see what is happening in the audio, so that the technology is understandable.

#### Acceptance criteria

1. WHILE the station is listening or sending, THE web app SHALL show a live spectrogram of the input and mark the bands used by each station.
2. THE web app SHALL show a link status panel with session state, current profile, signal-to-noise estimate, frames sent, frames resent and goodput.
3. THE web app SHALL keep the user interface responsive while decoding, by running signal processing off the main thread.
4. THE web app SHALL use a Halloween "haunted modem" visual style while keeping text readable and respecting reduced-motion settings.

### Requirement 8: Simulated channel for testing

**User story:** As a developer, I want to test the modem against hard audio conditions in code, so that reliability is measured instead of guessed.

#### Acceptance criteria

1. THE channel simulator SHALL apply, alone or combined: white noise at a set SNR, mixed-in noise recordings, room reverb from an impulse response, gain change, clipping, dropouts (silence bursts), clock drift between sender and receiver, and a competing GGTF transmission.
2. WHEN given the same seed and settings, THE channel simulator SHALL produce identical output.
3. THE channel simulator SHALL be usable from Rust tests, from the browser (through WebAssembly) and from Python (through bindings).

### Requirement 9: Receiver model trained for noisy conditions

**User story:** As a user, I want the receiver to keep working when people talk, music plays or something interrupts, so that the link is stable in real rooms.

#### Acceptance criteria

1. THE training pipeline SHALL generate labeled training data by encoding random frames with the modem core and degrading them with the channel simulator and noise datasets.
2. THE training pipeline SHALL compute model input features with the same Rust code the browser uses, so training and inference see identical features.
3. THE training pipeline SHALL export the trained model to ONNX, and THE web app SHALL run it in the browser with ONNX Runtime Web.
4. THE receiver SHALL let the user switch between the classic decoder and the ML decoder at runtime.
5. WHEN the ML model fails to load or runs too slowly for real time, THE receiver SHALL fall back to the classic decoder and tell the user.
6. THE ML decoder SHALL be accepted only if the benchmark shows a higher frame success rate than the classic decoder in the noisy scenarios, without a lower rate in the clean scenario.
7. THE training pipeline SHALL only use noise datasets whose licenses allow this use, and SHALL record each dataset's source and license.

### Requirement 10: Benchmarks

**User story:** As a judge or developer, I want numbers that show how reliable and fast the link is, so that claims about stability can be checked.

#### Acceptance criteria

1. THE benchmark SHALL run a fixed matrix of scenarios (clean, white noise at several SNRs, speech, music, café noise, reverb, dropouts, clock drift, competing transmission) with fixed seeds.
2. FOR each scenario and decoder (classic, ML, ggwave baseline), THE benchmark SHALL report frame success rate, bit error rate before error correction, goodput and decode time.
3. THE benchmark SHALL write results as a machine-readable file and a summary table in the repository.
4. THE web app SHALL include a live benchmark page that sends a numbered test sequence over real air between two tabs and reports the same metrics.
5. WHERE a live benchmark runs in two tabs on one computer, THE tabs MAY share ground truth through BroadcastChannel for scoring only, and SHALL never use it to carry link data.

### Requirement 11: Build, run and test with Bun

**User story:** As a developer or judge, I want one toolchain and simple commands, so that the project runs from a fresh clone.

#### Acceptance criteria

1. THE repository SHALL use Bun as the package manager, script runner, test runner for TypeScript, and runtime for the Next.js app.
2. THE repository SHALL provide Bun scripts to build the WebAssembly package, run the web app, run all tests (TypeScript, Rust and Python) and run the benchmark.
3. THE README SHALL list required tools and versions and the exact setup steps.
4. THE repository SHALL include the trained model file, or a script that downloads it, so the web app works without retraining.

### Requirement 12: Know when a Haunted QR beam was caught

**User story:** As someone beaming a link or Wi-Fi login, I want to see which devices caught it and optionally stop beaming on the first catch, so that I don't keep beaming after the other person already has it.

#### Acceptance criteria

1. WHEN a receiver has the whole beam and hears the last chunk of a round, THE receiver SHALL send a short `BEAM_REPLY` frame addressed to the sender, carrying the beam id, after a random delay of up to 400 ms.
2. AFTER each round except the last, THE sender SHALL stay quiet for a reply window (1.2 s) so that replies don't collide with the next chunk. WHEN it hears a reply, THE sender SHALL extend the window so other receivers can reply too.
3. WHEN the sender hears a reply for its current or most recent beam, THE sender SHALL report the replying station once per station.
4. WHERE "stop when caught" is on, THE sender SHALL stop the beam after the first reply.
5. THE receiver SHALL reply at most 3 times per beam, and the user SHALL be able to turn replies off. With replies off, the receiver SHALL stay silent.
6. A reply SHALL hold no message content, only the beam id and the two station ids.
