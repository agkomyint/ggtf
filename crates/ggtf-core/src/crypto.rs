//! Session security: X25519 key agreement, HKDF-SHA256 key derivation, ChaCha20-Poly1305,
//! and a short authentication string (4 spooky words) that both users compare.

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use hkdf::Hkdf;
use sha2::Sha256;
use x25519_dalek::{PublicKey, StaticSecret};

pub const KIND_DATA: u8 = 0;
pub const KIND_ACK: u8 = 1;

pub struct KeyPair {
    secret: StaticSecret,
    pub public: [u8; 32],
}

impl KeyPair {
    pub fn generate() -> Self {
        let mut b = [0u8; 32];
        getrandom::getrandom(&mut b).expect("system random source unavailable");
        Self::from_bytes(b)
    }

    pub fn from_bytes(b: [u8; 32]) -> Self {
        let secret = StaticSecret::from(b);
        let public = PublicKey::from(&secret).to_bytes();
        KeyPair { secret, public }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionKeys {
    pub tx: [u8; 32],
    pub rx: [u8; 32],
    pub sas: [u8; 3],
}

/// Derives directional keys. Returns None for a non-contributory (low-order) peer key.
pub fn derive(kp: &KeyPair, peer: &[u8; 32], is_caller: bool) -> Option<SessionKeys> {
    let shared = kp.secret.diffie_hellman(&PublicKey::from(*peer));
    if !shared.was_contributory() {
        return None;
    }
    let (caller_pub, answerer_pub) = if is_caller { (kp.public, *peer) } else { (*peer, kp.public) };
    let mut salt = [0u8; 64];
    salt[..32].copy_from_slice(&caller_pub);
    salt[32..].copy_from_slice(&answerer_pub);
    let hk = Hkdf::<Sha256>::new(Some(&salt), shared.as_bytes());
    let mut okm = [0u8; 67];
    hk.expand(b"ggtf v1 session", &mut okm).ok()?;
    let mut c2a = [0u8; 32];
    let mut a2c = [0u8; 32];
    c2a.copy_from_slice(&okm[..32]);
    a2c.copy_from_slice(&okm[32..64]);
    let sas = [okm[64], okm[65], okm[66]];
    Some(if is_caller { SessionKeys { tx: c2a, rx: a2c, sas } } else { SessionKeys { tx: a2c, rx: c2a, sas } })
}

fn nonce(kind: u8, counter: u64) -> [u8; 12] {
    let mut n = [0u8; 12];
    n[0] = kind;
    n[4..].copy_from_slice(&counter.to_be_bytes());
    n
}

pub fn seal(key: &[u8; 32], kind: u8, counter: u64, aad: &[u8], pt: &[u8]) -> Vec<u8> {
    let c = ChaCha20Poly1305::new(Key::from_slice(key));
    c.encrypt(Nonce::from_slice(&nonce(kind, counter)), Payload { msg: pt, aad }).expect("encrypt")
}

pub fn open(key: &[u8; 32], kind: u8, counter: u64, aad: &[u8], ct: &[u8]) -> Option<Vec<u8>> {
    let c = ChaCha20Poly1305::new(Key::from_slice(key));
    c.decrypt(Nonce::from_slice(&nonce(kind, counter)), Payload { msg: ct, aad }).ok()
}

pub const SAS_WORDS: [&str; 64] = [
    "crypt", "raven", "moth", "tomb", "ghoul", "wraith", "banshee", "specter",
    "lantern", "coffin", "candle", "bat", "owl", "spider", "cobweb", "skull",
    "bone", "grave", "mist", "fog", "moon", "howl", "fang", "claw",
    "cauldron", "potion", "broom", "witch", "hex", "curse", "rune", "omen",
    "shadow", "ember", "ash", "crow", "wolf", "attic", "cellar", "chain",
    "bell", "organ", "mirror", "portrait", "pumpkin", "scarecrow", "lich", "zombie",
    "mummy", "phantom", "poltergeist", "seance", "ouija", "relic", "tarot", "vampire",
    "casket", "shroud", "gargoyle", "haunt", "wisp", "cackle", "dusk", "hollow",
];

pub fn sas_words(sas: [u8; 3]) -> [&'static str; 4] {
    let v = ((sas[0] as u32) << 16) | ((sas[1] as u32) << 8) | sas[2] as u32;
    [SAS_WORDS[((v >> 18) & 63) as usize], SAS_WORDS[((v >> 12) & 63) as usize], SAS_WORDS[((v >> 6) & 63) as usize], SAS_WORDS[(v & 63) as usize]]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn both_sides_agree_and_tampering_fails() {
        let a = KeyPair::generate();
        let b = KeyPair::generate();
        let ka = derive(&a, &b.public, true).unwrap();
        let kb = derive(&b, &a.public, false).unwrap();
        assert_eq!(ka.tx, kb.rx);
        assert_eq!(ka.rx, kb.tx);
        assert_eq!(sas_words(ka.sas), sas_words(kb.sas));
        let ct = seal(&ka.tx, KIND_DATA, 5, b"hdr", b"boo");
        assert_eq!(open(&kb.rx, KIND_DATA, 5, b"hdr", &ct).unwrap(), b"boo");
        assert!(open(&kb.rx, KIND_DATA, 6, b"hdr", &ct).is_none());
        assert!(open(&kb.rx, KIND_DATA, 5, b"hdx", &ct).is_none());
        let mut bad = ct.clone();
        bad[0] ^= 1;
        assert!(open(&kb.rx, KIND_DATA, 5, b"hdr", &bad).is_none());
    }

    #[test]
    fn word_list_is_unique() {
        let mut w = SAS_WORDS.to_vec();
        w.sort();
        w.dedup();
        assert_eq!(w.len(), 64);
    }
}
