use std::fmt;

#[derive(Debug, thiserror::Error)]
#[error("invalid BIP39 mnemonic: {0}")]
pub struct MnemonicError(pub String);

pub struct Mnemonic(String);

impl Mnemonic {
    pub fn parse(phrase: &str) -> Result<Self, MnemonicError> {
        bip39::Mnemonic::parse(phrase).map_err(|e| MnemonicError(e.to_string()))?;
        Ok(Self(phrase.to_string()))
    }

    #[must_use]
    pub fn phrase(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Mnemonic {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Mnemonic(***)")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID_12: &str =
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    #[test]
    fn mnemonic_parse_accepts_valid_12_word_phrase() {
        let m = Mnemonic::parse(VALID_12).unwrap();
        assert_eq!(m.phrase(), VALID_12);
    }

    #[test]
    fn mnemonic_parse_rejects_invalid_phrase() {
        assert!(Mnemonic::parse("not a real mnemonic phrase at all here please").is_err());
        assert!(Mnemonic::parse("").is_err());
    }

    #[test]
    fn mnemonic_parse_rejects_bad_checksum() {
        let bad = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon";
        assert!(Mnemonic::parse(bad).is_err());
    }

    #[test]
    fn mnemonic_debug_redacts() {
        let m = Mnemonic::parse(VALID_12).unwrap();
        let dbg = format!("{m:?}");
        assert!(dbg.contains("Mnemonic"));
        assert!(!dbg.contains("abandon"));
        assert!(!dbg.contains("about"));
    }
}
