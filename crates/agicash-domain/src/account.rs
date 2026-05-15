use crate::{AccountId, AccountPurpose, AccountState, Currency, UserId};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AccountType {
    Cashu,
    Spark,
}

impl fmt::Display for AccountType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Cashu => "cashu",
            Self::Spark => "spark",
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Account {
    pub id: AccountId,
    pub created_at: DateTime<Utc>,
    pub user_id: UserId,
    pub name: String,
    #[serde(rename = "type")]
    pub account_type: AccountType,
    pub purpose: AccountPurpose,
    pub currency: Currency,
    pub details: serde_json::Value,
    pub version: i32,
    pub state: AccountState,
    pub expires_at: Option<DateTime<Utc>>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn account_type_serializes_as_lowercase() {
        let json = serde_json::to_string(&AccountType::Cashu).unwrap();
        assert_eq!(json, "\"cashu\"");
        let json = serde_json::to_string(&AccountType::Spark).unwrap();
        assert_eq!(json, "\"spark\"");
    }

    #[test]
    fn account_type_display_matches_serialize() {
        assert_eq!(AccountType::Cashu.to_string(), "cashu");
        assert_eq!(AccountType::Spark.to_string(), "spark");
    }

    #[test]
    fn account_roundtrips_through_realistic_supabase_row_json() {
        // Shape mirrors a postgrest select * row from wallet.accounts.
        let raw = json!({
            "id": "11111111-2222-3333-4444-555555555555",
            "created_at": "2026-03-01T12:00:00Z",
            "user_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "name": "Test Mint",
            "type": "cashu",
            "purpose": "transactional",
            "currency": "BTC",
            "details": {
                "mint_url": "https://mint.example",
                "keyset_counters": {},
                "is_default": true
            },
            "version": 0,
            "state": "active",
            "expires_at": null
        });
        let parsed: Account = serde_json::from_value(raw.clone()).unwrap();
        assert_eq!(parsed.name, "Test Mint");
        assert_eq!(parsed.account_type, AccountType::Cashu);
        assert_eq!(parsed.purpose, AccountPurpose::Transactional);
        assert_eq!(parsed.currency, Currency::Btc);
        assert_eq!(parsed.state, AccountState::Active);
        assert!(parsed.expires_at.is_none());
        assert_eq!(
            parsed.details.get("mint_url").and_then(|v| v.as_str()),
            Some("https://mint.example")
        );

        let reserialized = serde_json::to_value(&parsed).unwrap();
        assert_eq!(
            reserialized.get("type").and_then(|v| v.as_str()),
            Some("cashu")
        );
        let parsed2: Account = serde_json::from_value(reserialized).unwrap();
        assert_eq!(parsed, parsed2);
    }

    #[test]
    fn account_with_expires_at_populated_deserializes() {
        let raw = json!({
            "id": "11111111-2222-3333-4444-555555555555",
            "created_at": "2026-03-01T12:00:00Z",
            "user_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "name": "Gift Card",
            "type": "cashu",
            "purpose": "gift-card",
            "currency": "USD",
            "details": {},
            "version": 3,
            "state": "active",
            "expires_at": "2026-04-01T00:00:00Z"
        });
        let parsed: Account = serde_json::from_value(raw).unwrap();
        assert_eq!(parsed.version, 3);
        assert_eq!(parsed.purpose, AccountPurpose::GiftCard);
        assert!(parsed.expires_at.is_some());
    }
}
