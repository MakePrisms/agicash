//! `mint` and `balance` subcommands.
//!
//! `mint add` fetches metadata from a Cashu mint, then calls
//! `upsert_user_with_accounts` to persist a Cashu account row.
//!
//! `balance` lists all active accounts and shows zero balance for each — real
//! proof aggregation lands in slice 5+. For non-BTC accounts, it asks the
//! configured exchange rate provider for a BTC equivalent so agents can see
//! cross-currency totals.

use crate::composition::{AuthDeps, CashuDeps, ExchangeRateDeps, StorageDeps};
use agicash_domain::{AccountPurpose, AccountType, Currency, UserId};
use agicash_exchange_rate::ExchangeRateProvider;
use agicash_traits::{
    AccountInput, AuthError, CashuProvider, CashuProviderError, SessionStorage, StorageError,
    UpsertUserInput, UserStorage,
};
use cdk::mint_url::MintUrl;
use serde::Serialize;
use serde_json::json;
use std::str::FromStr;

#[derive(Debug, thiserror::Error)]
pub enum MintCmdError {
    #[error("not logged in")]
    NotLoggedIn,
    #[error("invalid mint URL: {0}")]
    InvalidUrl(String),
    #[error("mint unreachable: {0}")]
    MintUnreachable(String),
    #[error("unsupported currency: {0}")]
    UnsupportedCurrency(String),
    #[error("user record missing — initialize user before adding a mint")]
    UserNotFound,
    #[error(transparent)]
    Storage(#[from] StorageError),
    #[error(transparent)]
    Auth(#[from] AuthError),
}

impl From<CashuProviderError> for MintCmdError {
    fn from(value: CashuProviderError) -> Self {
        match value {
            CashuProviderError::InvalidUrl(msg) => Self::InvalidUrl(msg),
            CashuProviderError::Network(msg) | CashuProviderError::Protocol(msg) => {
                Self::MintUnreachable(msg)
            }
        }
    }
}

#[derive(Serialize)]
struct MintAddOutput<'a> {
    status: &'a str,
    account_id: String,
    mint_name: String,
    mint_url: String,
}

pub async fn cmd_mint_add(
    auth: &AuthDeps,
    storage: &StorageDeps,
    cashu: &CashuDeps,
    url: &str,
    currency_str: &str,
) -> Result<(), MintCmdError> {
    let session = auth
        .storage
        .load()
        .await?
        .ok_or(MintCmdError::NotLoggedIn)?;
    let user_id = UserId::from(session.user_id);

    let currency = Currency::from_str(currency_str)
        .map_err(|_| MintCmdError::UnsupportedCurrency(currency_str.to_string()))?;

    let mint_url = MintUrl::from_str(url).map_err(|e| MintCmdError::InvalidUrl(e.to_string()))?;
    let info = cashu.provider.mint_info(&mint_url).await?;
    let mint_url_string = mint_url.to_string();
    let mint_name = info.name.clone().unwrap_or_else(|| mint_url_string.clone());

    let user = storage
        .storage
        .get_user(user_id)
        .await?
        .ok_or(MintCmdError::UserNotFound)?;

    let input = UpsertUserInput {
        user_id,
        email: user.email.clone(),
        email_verified: user.email_verified,
        accounts: vec![AccountInput {
            account_type: AccountType::Cashu,
            purpose: AccountPurpose::Transactional,
            currency,
            name: mint_name.clone(),
            details: json!({
                "mint_url": mint_url_string,
                "keyset_counters": {},
            }),
            is_default: false,
        }],
        cashu_locking_xpub: user.cashu_locking_xpub.clone(),
        encryption_public_key: user.encryption_public_key.clone(),
        spark_identity_public_key: user.spark_identity_public_key.clone(),
        terms_accepted_at: user.terms_accepted_at,
        gift_card_mint_terms_accepted_at: user.gift_card_mint_terms_accepted_at,
    };

    let result = storage.storage.upsert_user_with_accounts(input).await?;

    // Pick the account matching the new mint URL — upsert returns ALL the
    // user's accounts, not just the new one.
    let new_account = result
        .accounts
        .iter()
        .find(|a| {
            a.details
                .get("mint_url")
                .and_then(|v| v.as_str())
                .is_some_and(|s| s.trim_end_matches('/') == mint_url_string.trim_end_matches('/'))
        })
        .ok_or_else(|| {
            MintCmdError::Storage(StorageError::Internal(
                "upsert returned no account matching the new mint URL".into(),
            ))
        })?;

    print_json(&MintAddOutput {
        status: "added",
        account_id: new_account.id.to_string(),
        mint_name,
        mint_url: mint_url_string,
    });
    Ok(())
}

#[derive(Serialize)]
struct BalanceEntry {
    account_id: String,
    name: String,
    currency: String,
    balance: String,
    unit: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    btc_equivalent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rate_btc: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    btc_equivalent_error: Option<String>,
}

pub async fn cmd_balance(
    auth: &AuthDeps,
    storage: &StorageDeps,
    rates: &ExchangeRateDeps,
) -> Result<(), MintCmdError> {
    let session = auth
        .storage
        .load()
        .await?
        .ok_or(MintCmdError::NotLoggedIn)?;
    let user_id = UserId::from(session.user_id);
    let accounts = storage.storage.list_accounts(user_id).await?;

    let mut entries: Vec<BalanceEntry> = Vec::with_capacity(accounts.len());
    for account in accounts {
        // Stub zero balance — real proof aggregation lands in slice 5+.
        let (balance, unit) = match account.currency {
            Currency::Btc => ("0".to_string(), "sat".to_string()),
            Currency::Usd | Currency::Usdb => ("0".to_string(), "cent".to_string()),
        };

        let mut entry = BalanceEntry {
            account_id: account.id.to_string(),
            name: account.name.clone(),
            currency: account.currency.to_string(),
            balance,
            unit,
            btc_equivalent: None,
            rate_btc: None,
            btc_equivalent_error: None,
        };

        // Non-BTC accounts: fetch a BTC-equivalent for display. Failures are
        // surfaced per-account, not as a top-level error — a down rate
        // provider must not crash `balance`.
        if account.currency != Currency::Btc {
            match rates
                .provider
                .get_rate(account.currency, Currency::Btc)
                .await
            {
                Ok(rate) => {
                    // Stub balance is zero, so the BTC equivalent is zero too.
                    // Slice 5+ will multiply real balances by the rate here.
                    entry.btc_equivalent = Some("0".into());
                    entry.rate_btc = Some(rate.to_string());
                }
                Err(e) => {
                    entry.btc_equivalent_error = Some(classify_rate_error(&e));
                }
            }
        }

        entries.push(entry);
    }

    print_json(&entries);
    Ok(())
}

fn classify_rate_error(e: &agicash_exchange_rate::ExchangeRateError) -> String {
    use agicash_exchange_rate::ExchangeRateError;
    match e {
        ExchangeRateError::Network(_) => "network-error".into(),
        ExchangeRateError::InvalidResponse(_) => "invalid-response".into(),
        ExchangeRateError::UnsupportedPair { .. } => "unsupported-pair".into(),
    }
}

fn print_json<T: Serialize>(value: &T) {
    println!("{}", serde_json::to_string(value).expect("serialize JSON"));
}
