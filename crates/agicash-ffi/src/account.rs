//! FFI account value type.
//!
//! Mirrors `agicash_domain::Account` but flattens into Swift-codable
//! primitives. The balance + unit fields are populated by
//! [`AccountFfi::from_account_with_balance`], called from
//! `wallet::list_accounts` after summing the account's UNSPENT proofs.
//! Non-Cashu accounts (currently Spark only) get `balance == "0"` since
//! slice 9 has not wired their proof storage yet.

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
    /// Decimal-stringified balance in the account's smallest unit (`sat`
    /// for BTC, `cent` for USD/USDB). For Cashu accounts this is the sum of
    /// UNSPENT proof amounts; for Spark accounts (slice 9 pending) it is
    /// always `"0"`.
    pub balance: String,
    /// Sub-unit label that pairs with `balance`. `"sat"` for BTC accounts,
    /// `"cent"` for USD/USDB accounts. Empty string only for accounts whose
    /// currency we don't yet model.
    pub unit: String,
}

impl AccountFfi {
    /// Build a Swift-codable account row from a domain [`Account`] together
    /// with a pre-computed balance (in the account's smallest unit). The
    /// caller is responsible for summing the UNSPENT proofs — this lives at
    /// `wallet::list_accounts` so the FFI surface stays a thin mapper.
    #[must_use]
    pub fn from_account_with_balance(account: Account, balance: u64) -> Self {
        let mint_url = match account.account_type {
            AccountType::Cashu => account
                .details
                .get("mint_url")
                .and_then(|v| v.as_str())
                .map(str::to_owned),
            AccountType::Spark => None,
        };
        Self {
            id: account.id.to_string(),
            name: account.name,
            account_type: account.account_type.to_string(),
            currency: currency_label(account.currency),
            mint_url,
            balance: balance.to_string(),
            unit: unit_label(account.currency).to_string(),
        }
    }
}

fn currency_label(c: Currency) -> String {
    c.to_string()
}

/// Smallest-unit label for a currency. Mirrors `unit_for_currency` in
/// `agicash-cli/src/send.rs` and the `Unit` display impl in
/// `agicash-money` — kept inline here so the FFI doesn't pull in
/// `agicash-money` for a one-line mapping.
fn unit_label(c: Currency) -> &'static str {
    match c {
        Currency::Btc => "sat",
        Currency::Usd | Currency::Usdb => "cent",
    }
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
    fn cashu_account_extracts_mint_url_and_balance() {
        let a = cashu_account("https://mint.example");
        let ffi = AccountFfi::from_account_with_balance(a, 64);
        assert_eq!(ffi.account_type, "cashu");
        assert_eq!(ffi.currency, "BTC");
        assert_eq!(ffi.mint_url.as_deref(), Some("https://mint.example"));
        assert_eq!(ffi.balance, "64");
        assert_eq!(ffi.unit, "sat");
    }

    #[test]
    fn cashu_account_zero_balance_is_zero_string() {
        let a = cashu_account("https://mint.example");
        let ffi = AccountFfi::from_account_with_balance(a, 0);
        assert_eq!(ffi.balance, "0");
        assert_eq!(ffi.unit, "sat");
    }

    #[test]
    fn spark_account_has_no_mint_url() {
        let a = spark_account();
        let ffi = AccountFfi::from_account_with_balance(a, 0);
        assert_eq!(ffi.account_type, "spark");
        assert!(ffi.mint_url.is_none());
        assert_eq!(ffi.balance, "0");
        assert_eq!(ffi.unit, "sat");
    }

    #[test]
    fn usd_account_uses_cent_unit() {
        let mut a = cashu_account("https://mint.example");
        a.currency = Currency::Usd;
        let ffi = AccountFfi::from_account_with_balance(a, 100);
        assert_eq!(ffi.currency, "USD");
        assert_eq!(ffi.unit, "cent");
        assert_eq!(ffi.balance, "100");
    }
}
