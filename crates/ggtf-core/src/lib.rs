//! GGTF core: sound modem, framing, error correction, link layer, crypto and channel simulator.
//!
//! Everything here is plain Rust with no audio device or clock inside, so the same code runs
//! in the browser (through `ggtf-wasm`), in native tests and in benchmarks.

pub mod beam;
pub mod bench;
pub mod bundle;
pub mod crypto;
pub mod dsp;
pub mod duo;
pub mod fec;
pub mod frame;
pub mod link;
pub mod ml;
pub mod modem;
pub mod profile;
pub mod receiver;
pub mod rng;
pub mod sim;
pub mod station;

pub const SAMPLE_RATE: u32 = 48_000;
pub const SR: f32 = SAMPLE_RATE as f32;
