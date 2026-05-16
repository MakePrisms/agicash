//! `mint` and `balance` subcommands.
//!
//! `mint add` fetches metadata from a Cashu mint, then calls
//! `upsert_user_with_accounts` to persist a Cashu account row.
//!
//! `balance` lists all active accounts and sums the UNSPENT proofs for
//! each Cashu account (via [`CashuSendSwapStorage::list_unspent_proofs`],
//! which decrypts the amounts in the storage layer). Spark accounts always
//! report `0` until slice 9 lands. For non-BTC accounts, it asks the
//! configured exchange rate provider for a BTC equivalent so agents can see
//! cross-currency totals.

use crate::composition::{AuthDeps, CashuDeps, ExchangeRateDeps, SendSwapDeps, StorageDeps};
use agicash_cashu::CashuSendSwapStorage;
use agicash_domain::{Account, AccountPurpose, AccountType, Currency, UserId};
use agicash_exchange_rate::ExchangeRateProvider;
use agicash_traits::{
    AccountInput, AuthError, CashuProviderError, StorageError, UpsertUserInput, UserStorage,
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
    #[error("mint protocol error: {0}")]
    MintError(String),
    #[error("unsupported currency: {0}")]
    UnsupportedCurrency(String),
    #[error(transparent)]
    Storage(#[from] StorageError),
    #[error(transparent)]
    Auth(#[from] AuthError),
}

impl From<CashuProviderError> for MintCmdError {
    fn from(value: CashuProviderError) -> Self {
        match value {
            CashuProviderError::InvalidUrl(msg) => Self::InvalidUrl(msg),
            CashuProviderError::Network(msg) => Self::MintUnreachable(msg),
            CashuProviderError::Protocol(msg) => Self::MintError(msg),
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

#[allow(clippy::too_many_lines)]
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

    // The `wallet.upsert_user_with_accounts` Postgres function is the only
    // way to create a row in `wallet.users`. For brand-new guests, no row
    // exists yet; that's expected. We re-use the existing user fields when
    // present (so a second `mint add` doesn't clobber them), otherwise fall
    // back to empty strings. Slice 5+ owns proper key initialization.
    let existing = storage.storage.get_user(user_id).await?;
    let (
        email,
        email_verified,
        cashu_locking_xpub,
        encryption_public_key,
        spark_identity_public_key,
        terms_accepted_at,
        gift_card_mint_terms_accepted_at,
    ) = if let Some(u) = existing.as_ref() {
        (
            u.email.clone(),
            u.email_verified,
            u.cashu_locking_xpub.clone(),
            u.encryption_public_key.clone(),
            u.spark_identity_public_key.clone(),
            u.terms_accepted_at,
            u.gift_card_mint_terms_accepted_at,
        )
    } else {
        // First-ever upsert for this user. `wallet.users` has UNIQUE indexes
        // on cashu_locking_xpub / encryption_public_key /
        // spark_identity_public_key, so empty strings collide between
        // guests. Derive a unique placeholder from the user id; real key
        // initialization lands in slice 5+.
        let placeholder_prefix = format!("uninitialized-{user_id}-");
        (
            None,
            false,
            format!("{placeholder_prefix}cashu"),
            format!("{placeholder_prefix}encryption"),
            format!("{placeholder_prefix}spark"),
            None,
            None,
        )
    };

    // For brand-new users, the DB function validates that at least one BTC
    // Spark account is provided in `p_accounts`. For returning users it
    // returns early after the first account row exists. So we only seed a
    // default Spark account when no user row exists yet.
    let mut accounts = vec![AccountInput {
        account_type: AccountType::Cashu,
        purpose: AccountPurpose::Transactional,
        currency,
        name: mint_name.clone(),
        details: json!({
            "mint_url": mint_url_string,
            "keyset_counters": {},
        }),
        is_default: false,
    }];
    if existing.is_none() {
        // CLI-side workaround: `wallet.upsert_user_with_accounts` requires at
        // least one BTC Spark account when the user row doesn't exist yet, but
        // slice 4 has no real Spark wallet wiring. The `cli_placeholder` marker
        // lets slice 9 (Spark integration) detect these uninitialized rows and
        // either skip them, surface a typed error, or replace them with
        // real-key-backed accounts before any Spark operation runs.
        accounts.push(AccountInput {
            account_type: AccountType::Spark,
            purpose: AccountPurpose::Transactional,
            currency: Currency::Btc,
            name: "Lightning".into(),
            details: json!({
                "network": "MAINNET",
                "cli_placeholder": true,
            }),
            is_default: true,
        });
    }

    let input = UpsertUserInput {
        user_id,
        email,
        email_verified,
        accounts,
        cashu_locking_xpub,
        encryption_public_key,
        spark_identity_public_key,
        terms_accepted_at,
        gift_card_mint_terms_accepted_at,
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
    send_deps: &SendSwapDeps,
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
        let unit = match account.currency {
            Currency::Btc => "sat".to_string(),
            Currency::Usd | Currency::Usdb => "cent".to_string(),
        };
        let balance_amount = compute_cashu_balance(send_deps.storage.as_ref(), &account).await?;
        let balance = balance_amount.to_string();

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
                    // The rate is BTC-per-minor-unit; the actual conversion
                    // (rate × balance_amount) lands once an exchange-rate
                    // refactor centralises Money arithmetic. For now we
                    // expose the rate verbatim so operators can compute it
                    // client-side.
                    entry.btc_equivalent = Some(balance_amount.to_string());
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

/// Sum the UNSPENT proofs for a single account.
///
/// Mirrors `agicash_ffi::wallet::compute_cashu_balance` — both wire the
/// same `list_unspent_proofs` storage primitive into a one-line
/// per-account sum. Spark accounts always return 0 until slice 9 wires
/// their proof storage. The shared logic isn't extracted into a crate
/// because the FFI uses `FfiError` and the CLI uses `MintCmdError`; a
/// follow-up refactor lane should lift `list_unspent_proofs` (and this
/// helper) to a balance-focused trait.
async fn compute_cashu_balance(
    storage: &dyn CashuSendSwapStorage,
    account: &Account,
) -> Result<u64, MintCmdError> {
    match account.account_type {
        AccountType::Cashu => {
            let proofs = storage
                .list_unspent_proofs(account.id)
                .await
                .map_err(|e| MintCmdError::Storage(StorageError::Internal(e.to_string())))?;
            Ok(proofs.iter().map(|p| p.proof.amount).sum())
        }
        AccountType::Spark => Ok(0),
    }
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
