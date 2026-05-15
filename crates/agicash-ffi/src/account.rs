//! FFI account value type.
//!
//! Mirrors `agicash_domain::Account` but flattens into Swift-codable
//! primitives. Phase 1 hard-codes `balance: "0"` and `unit: ""` because
//! slice-4 has no balance tracking yet; Phase 2+ will wire real values once
//! the proofs/wallet layer lands.

use agicash_domain::{Account, AccountType, Currency};

#[derive(Debug, Clone, uniffi::Record)]
pub struct AccountFfi {
    /// Stringified UUID for the account row.
    pub id: String,
    pub name: String,
    /// One of `"cashu"` or `"spark"` (matches the wire enum on the Rust side).
    pub account_type: String,
    /// One of `"BTC"`, `"USD"`, `"USDB"`.
    pub currency: String,
    /// Cashu mints set this to the mint URL from `details.mint_url`; Spark
    /// accounts return `None`.
    pub mint_url: Option<String>,
    /// Decimal-stringified balance. Phase 1 always returns `"0"` — the
    /// underlying wallet layer that tracks proofs/balance arrives in Phase 2+.
    pub balance: String,
    /// Sat / cent / usdb sub-unit label. Phase 1 returns an empty string.
    pub unit: String,
}

impl From<Account> for AccountFfi {
    fn from(a: Account) -> Self {
        let mint_url = match a.account_type {
            AccountType::Cashu => a
                .details
                .get("mint_url")
                .and_then(|v| v.as_str())
                .map(str::to_owned),
            AccountType::Spark => None,
        };
        Self {
            id: a.id.to_string(),
            name: a.name,
            account_type: a.account_type.to_string(),
            currency: currency_label(a.currency),
            mint_url,
            balance: "0".to_string(),
            unit: String::new(),
        }
    }
}

fn currency_label(c: Currency) -> String {
    c.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use agicash_domain::{AccountId, AccountPurpose, AccountState, UserId};
    use chrono::Utc;
    use serde_json::json;
    use uuid::Uuid;

    fn cashu_account(mint_url: &str) -> Account {
        Account {
            id: AccountId::from(Uuid::new_v4()),
            created_at: Utc::now(),
            user_id: UserId::from(Uuid::new_v4()),
            name: "My Mint".into(),
            account_type: AccountType::Cashu,
            purpose: AccountPurpose::Transactional,
            currency: Currency::Btc,
            details: json!({ "mint_url": mint_url }),
            version: 0,
            state: AccountState::Active,
            expires_at: None,
        }
    }

    fn spark_account() -> Account {
        Account {
            id: AccountId::from(Uuid::new_v4()),
            created_at: Utc::now(),
            user_id: UserId::from(Uuid::new_v4()),
            name: "Lightning".into(),
            account_type: AccountType::Spark,
            purpose: AccountPurpose::Transactional,
            currency: Currency::Btc,
            details: json!({}),
            version: 0,
            state: AccountState::Active,
            expires_at: None,
        }
    }

    #[test]
    fn cashu_account_extracts_mint_url() {
        let a = cashu_account("https://mint.example");
        let ffi: AccountFfi = a.into();
        assert_eq!(ffi.account_type, "cashu");
        assert_eq!(ffi.currency, "BTC");
        assert_eq!(ffi.mint_url.as_deref(), Some("https://mint.example"));
        assert_eq!(ffi.balance, "0");
        assert_eq!(ffi.unit, "");
    }

    #[test]
    fn spark_account_has_no_mint_url() {
        let a = spark_account();
        let ffi: AccountFfi = a.into();
        assert_eq!(ffi.account_type, "spark");
        assert!(ffi.mint_url.is_none());
    }
}
