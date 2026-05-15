use crate::{AccountId, Currency, UserId};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct User {
    pub id: UserId,
    pub created_at: DateTime<Utc>,
    pub email: Option<String>,
    pub email_verified: bool,
    pub username: String,
    pub default_btc_account_id: Option<AccountId>,
    pub default_usd_account_id: Option<AccountId>,
    pub default_currency: Currency,
    pub cashu_locking_xpub: String,
    pub encryption_public_key: String,
    pub spark_identity_public_key: String,
    pub terms_accepted_at: DateTime<Utc>,
    pub gift_card_mint_terms_accepted_at: Option<DateTime<Utc>>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn user_roundtrips_through_realistic_supabase_row_json() {
        let raw = json!({
            "id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "created_at": "2026-03-01T12:00:00Z",
            "email": "test@example.com",
            "email_verified": true,
            "username": "user-eeeeeeeeeeee",
            "default_btc_account_id": "11111111-2222-3333-4444-555555555555",
            "default_usd_account_id": null,
            "default_currency": "BTC",
            "cashu_locking_xpub": "xpub6Cabc123",
            "encryption_public_key": "schnorrpub123",
            "spark_identity_public_key": "sparkpub123",
            "terms_accepted_at": "2026-03-01T12:00:00Z",
            "gift_card_mint_terms_accepted_at": null
        });
        let parsed: User = serde_json::from_value(raw.clone()).unwrap();
        assert_eq!(parsed.email.as_deref(), Some("test@example.com"));
        assert!(parsed.email_verified);
        assert_eq!(parsed.username, "user-eeeeeeeeeeee");
        assert_eq!(parsed.default_currency, Currency::Btc);
        assert!(parsed.default_btc_account_id.is_some());
        assert!(parsed.default_usd_account_id.is_none());
        assert!(parsed.gift_card_mint_terms_accepted_at.is_none());

        let reserialized = serde_json::to_value(&parsed).unwrap();
        let parsed2: User = serde_json::from_value(reserialized).unwrap();
        assert_eq!(parsed, parsed2);
    }

    #[test]
    fn user_with_no_email_deserializes() {
        // Guest users have null email until they upgrade.
        let raw = json!({
            "id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "created_at": "2026-03-01T12:00:00Z",
            "email": null,
            "email_verified": false,
            "username": "user-eeeeeeeeeeee",
            "default_btc_account_id": "11111111-2222-3333-4444-555555555555",
            "default_usd_account_id": null,
            "default_currency": "BTC",
            "cashu_locking_xpub": "xpub6Cabc123",
            "encryption_public_key": "schnorrpub123",
            "spark_identity_public_key": "sparkpub123",
            "terms_accepted_at": "2026-03-01T12:00:00Z",
            "gift_card_mint_terms_accepted_at": null
        });
        let parsed: User = serde_json::from_value(raw).unwrap();
        assert!(parsed.email.is_none());
        assert!(!parsed.email_verified);
    }
}
