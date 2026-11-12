//! Frame layout: a header codeword (always present) and an optional payload codeword.
//!
//! header bytes: [version<<4 | type][src hi][src lo][dst hi][dst lo][seq][ack][flags][len] + CRC-16
//! payload:      payload bytes + CRC-32
//! Each part is protected by its own Reed-Solomon codeword, so the receiver can learn the
//! payload length even when the payload itself is damaged.

use crate::fec;
use crc::{Crc, CRC_16_IBM_3740, CRC_32_ISO_HDLC};

pub const CRC16: Crc<u16> = Crc::<u16>::new(&CRC_16_IBM_3740);
pub const CRC32: Crc<u32> = Crc::<u32>::new(&CRC_32_ISO_HDLC);

pub const VERSION: u8 = 1;
pub const BROADCAST: u16 = 0xFFFF;
pub const HEADER_FIELDS: usize = 9;
pub const HEADER_DATA_LEN: usize = HEADER_FIELDS + 2;
pub const HEADER_PARITY: usize = 8;
pub const HEADER_CW_LEN: usize = HEADER_DATA_LEN + HEADER_PARITY;
pub const MAX_PAYLOAD: usize = 96;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FrameType {
    Call = 1,
    Answer = 2,
    Train = 3,
    TrainResult = 4,
    Key = 5,
    Data = 6,
    Ack = 7,
    Bye = 8,
}

impl FrameType {
    pub fn from_u8(v: u8) -> Option<Self> {
        Some(match v {
            1 => Self::Call,
            2 => Self::Answer,
            3 => Self::Train,
            4 => Self::TrainResult,
            5 => Self::Key,
            6 => Self::Data,
            7 => Self::Ack,
            8 => Self::Bye,
            _ => return None,
        })
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Call => "CALL",
            Self::Answer => "ANSWER",
            Self::Train => "TRAIN",
            Self::TrainResult => "TRAIN_RESULT",
            Self::Key => "KEY",
            Self::Data => "DATA",
            Self::Ack => "ACK",
            Self::Bye => "BYE",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Frame {
    pub ftype: FrameType,
    pub src: u16,
    pub dst: u16,
    pub seq: u8,
    pub ack: u8,
    pub flags: u8,
    pub payload: Vec<u8>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Header {
    pub ftype: FrameType,
    pub src: u16,
    pub dst: u16,
    pub seq: u8,
    pub ack: u8,
    pub flags: u8,
    pub len: u8,
}

impl Header {
    pub fn to_bytes(&self) -> [u8; HEADER_FIELDS] {
        [
            (VERSION << 4) | self.ftype as u8,
            (self.src >> 8) as u8,
            self.src as u8,
            (self.dst >> 8) as u8,
            self.dst as u8,
            self.seq,
            self.ack,
            self.flags,
            self.len,
        ]
    }

    pub fn from_bytes(b: &[u8]) -> Option<Self> {
        if b.len() < HEADER_FIELDS || b[0] >> 4 != VERSION {
            return None;
        }
        let len = b[8];
        if len as usize > MAX_PAYLOAD {
            return None;
        }
        Some(Header {
            ftype: FrameType::from_u8(b[0] & 0x0f)?,
            src: u16::from_be_bytes([b[1], b[2]]),
            dst: u16::from_be_bytes([b[3], b[4]]),
            seq: b[5],
            ack: b[6],
            flags: b[7],
            len,
        })
    }
}

impl Frame {
    pub fn new(ftype: FrameType, src: u16, dst: u16, payload: Vec<u8>) -> Self {
        Frame { ftype, src, dst, seq: 0, ack: 0, flags: 0, payload }
    }

    pub fn header(&self) -> Header {
        assert!(self.payload.len() <= MAX_PAYLOAD, "payload too large");
        Header {
            ftype: self.ftype,
            src: self.src,
            dst: self.dst,
            seq: self.seq,
            ack: self.ack,
            flags: self.flags,
            len: self.payload.len() as u8,
        }
    }

    pub fn header_codeword(&self) -> Vec<u8> {
        let h = self.header().to_bytes();
        let mut d = h.to_vec();
        d.extend_from_slice(&CRC16.checksum(&h).to_be_bytes());
        fec::encode(&d, HEADER_PARITY)
    }

    pub fn payload_codeword(&self, parity: usize) -> Option<Vec<u8>> {
        if self.payload.is_empty() {
            return None;
        }
        let mut d = self.payload.clone();
        d.extend_from_slice(&CRC32.checksum(&self.payload).to_be_bytes());
        Some(fec::encode(&d, parity))
    }

    pub fn from_parts(h: Header, payload: Vec<u8>) -> Self {
        Frame { ftype: h.ftype, src: h.src, dst: h.dst, seq: h.seq, ack: h.ack, flags: h.flags, payload }
    }
}

fn header_valid(d: &[u8]) -> bool {
    d.len() == HEADER_DATA_LEN
        && CRC16.checksum(&d[..HEADER_FIELDS]).to_be_bytes() == d[HEADER_FIELDS..]
        && Header::from_bytes(&d[..HEADER_FIELDS]).is_some()
}

fn payload_valid(d: &[u8]) -> bool {
    d.len() > 4 && {
        let (p, c) = d.split_at(d.len() - 4);
        CRC32.checksum(p).to_be_bytes() == c
    }
}

pub fn decode_header(cw: &[u8], suspects: &[usize]) -> Option<Header> {
    let d = fec::decode(cw, HEADER_PARITY, suspects, header_valid)?;
    Header::from_bytes(&d[..HEADER_FIELDS])
}

pub fn decode_payload(cw: &[u8], parity: usize, suspects: &[usize]) -> Option<Vec<u8>> {
    let d = fec::decode(cw, parity, suspects, payload_valid)?;
    Some(d[..d.len() - 4].to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn header_roundtrip() {
        let mut f = Frame::new(FrameType::Data, 0x1234, 0xBEEF, vec![1, 2, 3]);
        f.seq = 7;
        f.ack = 9;
        let cw = f.header_codeword();
        assert_eq!(cw.len(), HEADER_CW_LEN);
        assert_eq!(decode_header(&cw, &[]).unwrap(), f.header());
        let p = f.payload_codeword(16).unwrap();
        assert_eq!(decode_payload(&p, 16, &[]).unwrap(), f.payload);
    }
}
