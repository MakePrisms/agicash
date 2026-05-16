use crate::SigningAlgorithm;
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PublicKey {
    bytes: Vec<u8>,
    algorithm: SigningAlgorithm,
}

impl PublicKey {
    #[must_use]
    pub fn new(bytes: Vec<u8>, algorithm: SigningAlgorithm) -> Self {
        Self { bytes, algorithm }
    }

    #[must_use]
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    #[must_use]
    pub fn algorithm(&self) -> SigningAlgorithm {
        self.algorithm
    }
}

impl fmt::Display for PublicKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&hex::encode(&self.bytes))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_key_constructs_with_bytes_and_algorithm() {
        let k = PublicKey::new(vec![0xAA, 0xBB], SigningAlgorithm::Schnorr);
        assert_eq!(k.bytes(), &[0xAA, 0xBB]);
        assert_eq!(k.algorithm(), SigningAlgorithm::Schnorr);
    }

    #[test]
    fn public_key_display_is_hex() {
        let k = PublicKey::new(vec![0xDE, 0xAD, 0xBE, 0xEF], SigningAlgorithm::Ecdsa);
        assert_eq!(k.to_string(), "deadbeef");
    }

    #[test]
    fn public_key_roundtrips_through_json() {
        let k = PublicKey::new(vec![1, 2, 3], SigningAlgorithm::Schnorr);
        let json = serde_json::to_string(&k).unwrap();
        let parsed: PublicKey = serde_json::from_str(&json).unwrap();
        assert_eq!(k, parsed);
    }
}
