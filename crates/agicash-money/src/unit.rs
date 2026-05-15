use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Unit {
    /// Bitcoin satoshi (1 BTC = `100_000_000` sat)
    Sat,
    /// Bitcoin millisatoshi (1 sat = `1_000` msat; 1 BTC = `100_000_000_000` msat)
    Msat,
    /// USD cent (1 USD = 100 cent)
    Cent,
    /// Major unit (BTC, USD, USDB itself)
    Major,
}

impl fmt::Display for Unit {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Sat => "sat",
            Self::Msat => "msat",
            Self::Cent => "cent",
            Self::Major => "major",
        })
    }
}
