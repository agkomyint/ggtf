//! Reed-Solomon over GF(2^8) with erasure hints.

use reed_solomon::{Decoder, Encoder};

/// Returns `data` followed by `parity` check bytes.
pub fn encode(data: &[u8], parity: usize) -> Vec<u8> {
    assert!(parity > 0 && data.len() + parity <= 255, "codeword too long");
    Encoder::new(parity).encode(data).to_vec()
}

/// Decodes a codeword. `suspects` lists byte positions ordered from least to most confident;
/// the decoder tries them as erasures (RS fixes twice as many erasures as unknown errors),
/// then falls back to plain error correction. `valid` (a CRC check) picks which attempt to trust,
/// so a miscorrection is rejected instead of passed on.
pub fn decode(cw: &[u8], parity: usize, suspects: &[usize], valid: impl Fn(&[u8]) -> bool) -> Option<Vec<u8>> {
    if cw.len() > 255 || cw.len() <= parity {
        return None;
    }
    let dec = Decoder::new(parity);
    let suspects: Vec<u8> = suspects.iter().filter(|&&i| i < cw.len()).map(|&i| i as u8).collect();
    let mut tried: Vec<usize> = Vec::new();
    for take in [suspects.len().min(parity), suspects.len().min(parity / 2), 0] {
        if tried.contains(&take) {
            continue;
        }
        tried.push(take);
        let res = if take == 0 { dec.correct(cw, None) } else { dec.correct(cw, Some(&suspects[..take])) };
        if let Ok(buf) = res {
            let d = buf.data();
            if valid(d) {
                return Some(d.to_vec());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn corrects_errors_and_erasures() {
        let data: Vec<u8> = (0..40).collect();
        let cw = encode(&data, 16);
        let mut bad = cw.clone();
        for i in 0..8 {
            bad[i * 3] ^= 0x5a;
        }
        assert_eq!(decode(&bad, 16, &[], |_| true).unwrap(), data);

        let mut bad = cw.clone();
        let er: Vec<usize> = (0..16).collect();
        for &i in &er {
            bad[i] = 0;
        }
        assert_eq!(decode(&bad, 16, &er, |_| true).unwrap(), data);
    }
}
