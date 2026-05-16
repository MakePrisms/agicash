use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AccountPurpose {
    Transactional,
    GiftCard,
}

#[derive(Debug, thiserror::Error)]
#[error("unknown account purpose: {0}")]
pub struct UnknownAccountPurpose(pub String);

impl fmt::Display for AccountPurpose {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Transactional => "transactional",
            Self::GiftCard => "gift-card",
        })
    }
}

impl FromStr for AccountPurpose {
    type Err = UnknownAccountPurpose;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "transactional" => Ok(Self::Transactional),
            "gift-card" => Ok(Self::GiftCard),
            _ => Err(UnknownAccountPurpose(s.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_purpose_display_uses_kebab_case() {
        assert_eq!(AccountPurpose::Transactional.to_string(), "transactional");
        assert_eq!(AccountPurpose::GiftCard.to_string(), "gift-card");
    }

    #[test]
    fn account_purpose_parses_kebab_case() {
        assert_eq!(
            "transactional".parse::<AccountPurpose>().unwrap(),
            AccountPurpose::Transactional
        );
        assert_eq!(
            "gift-card".parse::<AccountPurpose>().unwrap(),
            AccountPurpose::GiftCard
        );
    }

    #[test]
    fn account_purpose_parse_rejects_unknown() {
        assert!("voucher".parse::<AccountPurpose>().is_err());
        assert!("".parse::<AccountPurpose>().is_err());
        assert!("gift_card".parse::<AccountPurpose>().is_err());
    }

    #[test]
    fn account_purpose_serializes_as_kebab_case() {
        let json = serde_json::to_string(&AccountPurpose::Transactional).unwrap();
        assert_eq!(json, "\"transactional\"");
        let json = serde_json::to_string(&AccountPurpose::GiftCard).unwrap();
        assert_eq!(json, "\"gift-card\"");
    }

    #[test]
    fn account_purpose_deserializes_from_kebab_case() {
        let p: AccountPurpose = serde_json::from_str("\"gift-card\"").unwrap();
        assert_eq!(p, AccountPurpose::GiftCard);
    }
}
