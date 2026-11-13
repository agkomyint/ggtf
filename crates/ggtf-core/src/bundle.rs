//! Spirit bundles: a signed, compressed app that can be beamed, installed and shared again.
//!
//! ```text
//! 0    4 bytes  magic 00 47 53 01 ("\0GS", version 1)
//! 4   32 bytes  author Ed25519 public key
//! 36  64 bytes  signature over "ggtf-spirit-v1" || body
//! 100 ...       body: raw DEFLATE of the source (UTF-8 JSON with the manifest and files)
//! ```
//!
//! Anyone can pass a bundle on, but changing one byte breaks the signature, so the person who
//! receives it knows it is exactly what the author published.

use crate::crypto;
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use sha2::{Digest, Sha256};

pub const MAGIC: [u8; 4] = [0x00, b'G', b'S', 0x01];
pub const HEADER_LEN: usize = 4 + 32 + 64;
/// Largest source a bundle may expand to. Stops compression bombs.
pub const MAX_SOURCE: usize = 256 * 1024;
const CONTEXT: &[u8] = b"ggtf-spirit-v1";

#[derive(Debug, PartialEq, Eq)]
pub enum BundleError {
    TooShort,
    BadMagic,
    BadKey,
    BadSignature,
    BadBody,
    TooLarge,
}

impl BundleError {
    pub fn message(&self) -> &'static str {
        match self {
            Self::TooShort => "not a spirit bundle (too short)",
            Self::BadMagic => "not a spirit bundle (wrong header)",
            Self::BadKey => "the author key is invalid",
            Self::BadSignature => "the signature does not match: the bundle was changed or damaged",
            Self::BadBody => "the bundle body could not be unpacked",
            Self::TooLarge => "the spirit unpacks to more than 256 KB",
        }
    }
}

#[derive(Debug)]
pub struct Opened {
    pub author: [u8; 32],
    /// SHA-256 of the compressed body: identical code has an identical hash.
    pub hash: [u8; 32],
    pub source: Vec<u8>,
}

pub fn is_bundle(b: &[u8]) -> bool {
    b.len() >= 4 && b[..4] == MAGIC
}

pub fn author_public(secret: &[u8; 32]) -> [u8; 32] {
    SigningKey::from_bytes(secret).verifying_key().to_bytes()
}

/// Four spooky words for an author key, so people can recognise who made a spirit.
pub fn author_words(public: &[u8; 32]) -> [&'static str; 4] {
    let h = Sha256::digest(public);
    crypto::sas_words([h[0], h[1], h[2]])
}

fn signed_message(body: &[u8]) -> Vec<u8> {
    let mut m = Vec::with_capacity(CONTEXT.len() + body.len());
    m.extend_from_slice(CONTEXT);
    m.extend_from_slice(body);
    m
}

/// Compresses and signs `source`. Returns None if the source is too large.
pub fn pack(secret: &[u8; 32], source: &[u8]) -> Option<Vec<u8>> {
    if source.len() > MAX_SOURCE {
        return None;
    }
    let key = SigningKey::from_bytes(secret);
    let body = miniz_oxide::deflate::compress_to_vec(source, 10);
    let sig = key.sign(&signed_message(&body));
    let mut out = Vec::with_capacity(HEADER_LEN + body.len());
    out.extend_from_slice(&MAGIC);
    out.extend_from_slice(&key.verifying_key().to_bytes());
    out.extend_from_slice(&sig.to_bytes());
    out.extend_from_slice(&body);
    Some(out)
}

/// Checks the header and signature, then unpacks the source.
pub fn open(b: &[u8]) -> Result<Opened, BundleError> {
    if b.len() < HEADER_LEN + 1 {
        return Err(if is_bundle(b) { BundleError::TooShort } else { BundleError::BadMagic });
    }
    if !is_bundle(b) {
        return Err(BundleError::BadMagic);
    }
    let mut author = [0u8; 32];
    author.copy_from_slice(&b[4..36]);
    let mut sig = [0u8; 64];
    sig.copy_from_slice(&b[36..100]);
    let body = &b[HEADER_LEN..];
    let key = VerifyingKey::from_bytes(&author).map_err(|_| BundleError::BadKey)?;
    key.verify_strict(&signed_message(body), &Signature::from_bytes(&sig)).map_err(|_| BundleError::BadSignature)?;
    let source = miniz_oxide::inflate::decompress_to_vec_with_limit(body, MAX_SOURCE).map_err(|e| match e.status {
        miniz_oxide::inflate::TINFLStatus::HasMoreOutput => BundleError::TooLarge,
        _ => BundleError::BadBody,
    })?;
    let hash: [u8; 32] = Sha256::digest(body).into();
    Ok(Opened { author, hash, source })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: [u8; 32] = [7u8; 32];

    fn source() -> Vec<u8> {
        br#"{"manifest":{"name":"Ghost Grid","version":1},"files":{"app.js":"spirit.log('boo')"}}"#.repeat(4)
    }

    #[test]
    fn round_trip_and_hash_is_stable() {
        let b = pack(&SECRET, &source()).unwrap();
        assert!(is_bundle(&b));
        assert!(b.len() < source().len(), "compression should shrink a repetitive source");
        let o = open(&b).unwrap();
        assert_eq!(o.source, source());
        assert_eq!(o.author, author_public(&SECRET));
        assert_eq!(o.hash, open(&pack(&SECRET, &source()).unwrap()).unwrap().hash);
    }

    #[test]
    fn any_changed_byte_is_rejected() {
        let b = pack(&SECRET, &source()).unwrap();
        for i in [4, 40, 99, 100, b.len() - 1] {
            let mut t = b.clone();
            t[i] ^= 0x10;
            assert!(open(&t).is_err(), "byte {i} changed but the bundle still opened");
        }
    }

    #[test]
    fn re_signing_with_another_key_changes_the_author() {
        let mut b = pack(&SECRET, &source()).unwrap();
        let other = pack(&[9u8; 32], &source()).unwrap();
        // Swapping in another author's key without their signature fails.
        b[4..36].copy_from_slice(&other[4..36]);
        assert_eq!(open(&b).unwrap_err(), BundleError::BadSignature);
        assert_ne!(open(&other).unwrap().author, author_public(&SECRET));
        assert_ne!(author_words(&author_public(&SECRET)), author_words(&author_public(&[9u8; 32])));
    }

    #[test]
    fn rejects_junk_and_bombs() {
        assert_eq!(open(b"hello").unwrap_err(), BundleError::BadMagic);
        assert_eq!(open(&MAGIC).unwrap_err(), BundleError::TooShort);
        assert!(pack(&SECRET, &vec![b'a'; MAX_SOURCE + 1]).is_none());
        // A body that inflates past the limit, signed properly.
        let key = SigningKey::from_bytes(&SECRET);
        let body = miniz_oxide::deflate::compress_to_vec(&vec![0u8; MAX_SOURCE + 10], 10);
        let sig = key.sign(&signed_message(&body));
        let mut b = MAGIC.to_vec();
        b.extend_from_slice(&key.verifying_key().to_bytes());
        b.extend_from_slice(&sig.to_bytes());
        b.extend_from_slice(&body);
        assert_eq!(open(&b).unwrap_err(), BundleError::TooLarge);
    }
}
