use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AccountState {
    Active,
    Expired,
}

#[derive(Debug, thiserror::Error)]
#[error("unknown account state: {0}")]
pub struct UnknownAccountState(pub String);

impl fmt::Display for AccountState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Active => "active",
            Self::Expired => "expired",
        })
    }
}

impl FromStr for AccountState {
    type Err = UnknownAccountState;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "active" => Ok(Self::Active),
            "expired" => Ok(Self::Expired),
            _ => Err(UnknownAccountState(s.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_state_display_uses_lowercase() {
        assert_eq!(AccountState::Active.to_string(), "active");
        assert_eq!(AccountState::Expired.to_string(), "expired");
    }

    #[test]
    fn account_state_parses_lowercase() {
        assert_eq!(
            "active".parse::<AccountState>().unwrap(),
            AccountState::Active
        );
        assert_eq!(
            "expired".parse::<AccountState>().unwrap(),
            AccountState::Expired
        );
    }

    #[test]
    fn account_state_parse_rejects_unknown() {
        assert!("dormant".parse::<AccountState>().is_err());
        assert!("ACTIVE".parse::<AccountState>().is_err());
    }

    #[test]
    fn account_state_serializes_as_lowercase() {
        let json = serde_json::to_string(&AccountState::Active).unwrap();
        assert_eq!(json, "\"active\"");
    }

    #[test]
    fn account_state_deserializes_from_lowercase() {
        let s: AccountState = serde_json::from_str("\"expired\"").unwrap();
        assert_eq!(s, AccountState::Expired);
    }
}
