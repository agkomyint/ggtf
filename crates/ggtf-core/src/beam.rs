//! Beam mode ("haunted QR"): connectionless broadcast of a short message.
//!
//! The message (plus a CRC-32 of the whole message) is cut into numbered chunks, each sent as one
//! BEAM frame: [beam id hi][beam id lo][index][count][data...]. The sender repeats the set in a
//! carousel, so a receiver that starts listening late, or misses a chunk to noise, fills the gaps
//! on the next round. Chunks can arrive in any order. Nothing is encrypted: like a printed QR code,
//! anyone in the room can read it.

use crate::frame::{Frame, FrameType, BROADCAST, CRC32};
use std::collections::HashMap;

/// Default chunk size; `chunk_frames` accepts anything from 16 to `MAX_CHUNK`.
pub const CHUNK: usize = 48;
/// Largest chunk: 4 header bytes + chunk must fit in a frame payload.
pub const MAX_CHUNK: usize = crate::frame::MAX_PAYLOAD - 4;
/// Up to 255 chunks; 16 KB covers small images.
pub const MAX_MESSAGE: usize = 16 * 1024;
/// Forget partial messages not heard for this long.
pub const STALE_MS: f64 = 120_000.0;

pub fn chunk_frames(src: u16, beam_id: u16, msg: &[u8], chunk: usize) -> Vec<Frame> {
    let chunk = chunk.clamp(16, MAX_CHUNK);
    let mut body = msg.to_vec();
    body.extend_from_slice(&CRC32.checksum(msg).to_be_bytes());
    let chunks: Vec<&[u8]> = body.chunks(chunk).collect();
    let count = chunks.len() as u8;
    chunks
        .iter()
        .enumerate()
        .map(|(i, c)| {
            let mut p = vec![(beam_id >> 8) as u8, beam_id as u8, i as u8, count];
            p.extend_from_slice(c);
            Frame::new(FrameType::Beam, src, BROADCAST, p)
        })
        .collect()
}

#[derive(Clone, Debug, PartialEq)]
pub enum BeamEvent {
    /// `got[i]` is true once chunk `i` has arrived.
    Progress { id: u16, from: u16, have: u8, count: u8, got: Vec<bool> },
    Complete { id: u16, from: u16, message: Vec<u8> },
}

struct Assembly {
    from: u16,
    chunks: Vec<Option<Vec<u8>>>,
    last_seen: f64,
    done: bool,
}

#[derive(Default)]
pub struct BeamReceiver {
    parts: HashMap<(u16, u16), Assembly>,
}

impl BeamReceiver {
    pub fn on_frame(&mut self, f: &Frame, now: f64) -> Option<BeamEvent> {
        if f.ftype != FrameType::Beam || f.payload.len() < 5 {
            return None;
        }
        let id = u16::from_be_bytes([f.payload[0], f.payload[1]]);
        let (idx, count) = (f.payload[2], f.payload[3]);
        if count == 0 || idx >= count {
            return None;
        }
        self.parts.retain(|_, a| now - a.last_seen < STALE_MS);
        let a = self.parts.entry((f.src, id)).or_insert_with(|| Assembly { from: f.src, chunks: vec![None; count as usize], last_seen: now, done: false });
        if a.chunks.len() != count as usize {
            // Same id, different message: start over.
            *a = Assembly { from: f.src, chunks: vec![None; count as usize], last_seen: now, done: false };
        }
        a.last_seen = now;
        if a.done {
            return None;
        }
        a.chunks[idx as usize] = Some(f.payload[4..].to_vec());
        let have = a.chunks.iter().filter(|c| c.is_some()).count() as u8;
        if have < count {
            let got = a.chunks.iter().map(|c| c.is_some()).collect();
            return Some(BeamEvent::Progress { id, from: a.from, have, count, got });
        }
        let body: Vec<u8> = a.chunks.iter().flat_map(|c| c.clone().unwrap()).collect();
        if body.len() < 4 {
            return None;
        }
        let (msg, crc) = body.split_at(body.len() - 4);
        if CRC32.checksum(msg).to_be_bytes() != crc {
            // A chunk from another message slipped in; drop everything and collect again.
            a.chunks.iter_mut().for_each(|c| *c = None);
            return Some(BeamEvent::Progress { id, from: a.from, have: 0, count, got: vec![false; count as usize] });
        }
        a.done = true;
        Some(BeamEvent::Complete { id, from: a.from, message: msg.to_vec() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reassembles_out_of_order_and_across_rounds() {
        let msg = b"WIFI:T:WPA;S:Haunted House;P:boo-12345;;  https://example.com/a/very/long/path?with=query".to_vec();
        let frames = chunk_frames(7, 0xBEEF, &msg, CHUNK);
        assert_eq!(frames.len(), (msg.len() + 4).div_ceil(CHUNK));
        assert!(frames.len() >= 2);
        let mut rx = BeamReceiver::default();
        // round 1: lose chunk 1; round 2: receive in reverse.
        for (i, f) in frames.iter().enumerate() {
            if i != 1 {
                assert!(matches!(rx.on_frame(f, 0.0), Some(BeamEvent::Progress { .. })));
            }
        }
        let mut done = None;
        for f in frames.iter().rev() {
            if let Some(BeamEvent::Complete { message, .. }) = rx.on_frame(f, 1000.0) {
                done = Some(message);
            }
        }
        assert_eq!(done.unwrap(), msg);
        // later rounds don't report it again
        assert!(frames.iter().all(|f| rx.on_frame(f, 2000.0).is_none()));
    }

    #[test]
    fn big_chunks_and_binary() {
        let msg: Vec<u8> = (0..5000u32).map(|i| (i * 31 % 251) as u8).collect();
        let frames = chunk_frames(1, 2, &msg, MAX_CHUNK);
        assert_eq!(frames.len(), (msg.len() + 4).div_ceil(MAX_CHUNK));
        assert!(frames.iter().all(|f| f.payload.len() <= crate::frame::MAX_PAYLOAD));
        let mut rx = BeamReceiver::default();
        let done = frames.iter().filter_map(|f| rx.on_frame(f, 0.0)).last();
        assert_eq!(done, Some(BeamEvent::Complete { id: 2, from: 1, message: msg }));
    }
}
