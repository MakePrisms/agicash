use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Currency {
    Btc,
    Usd,
    Usdb,
}

#[derive(Debug, thiserror::Error)]
#[error("unknown currency: {0}")]
pub struct UnknownCurrency(pub String);

impl fmt::Display for Currency {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Btc => "BTC",
            Self::Usd => "USD",
            Self::Usdb => "USDB",
        })
    }
}

impl FromStr for Currency {
    type Err = UnknownCurrency;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_uppercase().as_str() {
            "BTC" => Ok(Self::Btc),
            "USD" => Ok(Self::Usd),
            "USDB" => Ok(Self::Usdb),
            _ => Err(UnknownCurrency(s.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn currency_display_uses_uppercase_ticker() {
        assert_eq!(Currency::Btc.to_string(), "BTC");
        assert_eq!(Currency::Usd.to_string(), "USD");
        assert_eq!(Currency::Usdb.to_string(), "USDB");
    }

    #[test]
    fn currency_parses_case_insensitively() {
        assert_eq!("btc".parse::<Currency>().unwrap(), Currency::Btc);
        assert_eq!("BTC".parse::<Currency>().unwrap(), Currency::Btc);
        assert_eq!("Usd".parse::<Currency>().unwrap(), Currency::Usd);
    }

    #[test]
    fn currency_parse_rejects_unknown() {
        assert!("EUR".parse::<Currency>().is_err());
        assert!("".parse::<Currency>().is_err());
    }

    #[test]
    fn currency_serializes_as_uppercase_string() {
        let json = serde_json::to_string(&Currency::Btc).unwrap();
        assert_eq!(json, "\"BTC\"");
    }

    #[test]
    fn currency_deserializes_from_uppercase_string() {
        let c: Currency = serde_json::from_str("\"USDB\"").unwrap();
        assert_eq!(c, Currency::Usdb);
    }
}
