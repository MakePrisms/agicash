use std::fmt;
use zeroize::Zeroizing;

#[derive(Debug, thiserror::Error)]
pub enum SecretKeyError {
    #[error("expected 32 hex bytes (64 chars), got {0} chars")]
    BadLength(usize),
    #[error("invalid hex: {0}")]
    InvalidHex(#[from] hex::FromHexError),
}

pub struct SecretKey(Zeroizing<[u8; 32]>);

impl SecretKey {
    #[must_use]
    pub fn new(bytes: [u8; 32]) -> Self {
        Self(Zeroizing::new(bytes))
    }

    pub fn try_from_hex(s: &str) -> Result<Self, SecretKeyError> {
        if s.len() != 64 {
            return Err(SecretKeyError::BadLength(s.len()));
        }
        let mut out = [0u8; 32];
        hex::decode_to_slice(s, &mut out)?;
        Ok(Self::new(out))
    }

    #[must_use]
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl fmt::Debug for SecretKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SecretKey(***)")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEX_32: &str = "0101010101010101010101010101010101010101010101010101010101010101";

    #[test]
    fn secret_key_from_bytes_roundtrips() {
        let bytes = [0x42u8; 32];
        let k = SecretKey::new(bytes);
        assert_eq!(k.as_bytes(), &bytes);
    }

    #[test]
    fn secret_key_try_from_hex_parses_valid_input() {
        let k = SecretKey::try_from_hex(HEX_32).unwrap();
        assert_eq!(k.as_bytes(), &[0x01u8; 32]);
    }

    #[test]
    fn secret_key_try_from_hex_rejects_bad_length() {
        assert!(SecretKey::try_from_hex("aa").is_err());
        assert!(SecretKey::try_from_hex("").is_err());
    }

    #[test]
    fn secret_key_try_from_hex_rejects_non_hex() {
        assert!(SecretKey::try_from_hex(&"z".repeat(64)).is_err());
    }

    #[test]
    fn secret_key_debug_redacts() {
        let k = SecretKey::new([0x42u8; 32]);
        let dbg = format!("{k:?}");
        assert!(dbg.contains("SecretKey"));
        assert!(!dbg.contains("42"));
        assert!(!dbg.contains("66"));
    }
}
