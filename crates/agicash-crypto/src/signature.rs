use crate::SigningAlgorithm;
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Signature {
    bytes: Vec<u8>,
    algorithm: SigningAlgorithm,
}

impl Signature {
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

impl fmt::Display for Signature {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&hex::encode(&self.bytes))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signature_constructs_with_bytes_and_algorithm() {
        let s = Signature::new(vec![0x99], SigningAlgorithm::Schnorr);
        assert_eq!(s.bytes(), &[0x99]);
        assert_eq!(s.algorithm(), SigningAlgorithm::Schnorr);
    }

    #[test]
    fn signature_display_is_hex() {
        let s = Signature::new(vec![0xBE, 0xEF], SigningAlgorithm::Ecdsa);
        assert_eq!(s.to_string(), "beef");
    }

    #[test]
    fn signature_roundtrips_through_json() {
        let s = Signature::new(vec![1, 2, 3, 4], SigningAlgorithm::Ecdsa);
        let json = serde_json::to_string(&s).unwrap();
        let parsed: Signature = serde_json::from_str(&json).unwrap();
        assert_eq!(s, parsed);
    }
}
