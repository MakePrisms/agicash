use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SigningAlgorithm {
    Schnorr,
    Ecdsa,
}

#[derive(Debug, thiserror::Error)]
#[error("unknown signing algorithm: {0}")]
pub struct UnknownAlgorithm(pub String);

impl fmt::Display for SigningAlgorithm {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Schnorr => "schnorr",
            Self::Ecdsa => "ecdsa",
        })
    }
}

impl FromStr for SigningAlgorithm {
    type Err = UnknownAlgorithm;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "schnorr" => Ok(Self::Schnorr),
            "ecdsa" => Ok(Self::Ecdsa),
            _ => Err(UnknownAlgorithm(s.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn algorithm_display_uses_lowercase() {
        assert_eq!(SigningAlgorithm::Schnorr.to_string(), "schnorr");
        assert_eq!(SigningAlgorithm::Ecdsa.to_string(), "ecdsa");
    }

    #[test]
    fn algorithm_parses_case_insensitively() {
        assert_eq!(
            "schnorr".parse::<SigningAlgorithm>().unwrap(),
            SigningAlgorithm::Schnorr
        );
        assert_eq!(
            "ECDSA".parse::<SigningAlgorithm>().unwrap(),
            SigningAlgorithm::Ecdsa
        );
    }

    #[test]
    fn algorithm_parse_rejects_unknown() {
        assert!("ed25519".parse::<SigningAlgorithm>().is_err());
        assert!("".parse::<SigningAlgorithm>().is_err());
    }

    #[test]
    fn algorithm_serializes_as_lowercase() {
        let json = serde_json::to_string(&SigningAlgorithm::Schnorr).unwrap();
        assert_eq!(json, "\"schnorr\"");
    }

    #[test]
    fn algorithm_deserializes_from_lowercase() {
        let a: SigningAlgorithm = serde_json::from_str("\"ecdsa\"").unwrap();
        assert_eq!(a, SigningAlgorithm::Ecdsa);
    }
}
