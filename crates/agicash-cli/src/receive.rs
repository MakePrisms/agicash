//! `agicash receive <token>` subcommand.
//!
//! Parses a Cashu token, picks the matching account by mint URL +
//! currency, runs `CashuReceiveSwapService.create` then `complete_swap`,
//! and emits a JSON receipt to stdout.

use crate::composition::{AuthDeps, CashuDeps, ReceiveSwapDeps, StorageDeps};
use agicash_cashu::{CompleteOutcome, ParsedToken, ReceiveSwapError, ReceiveSwapStorageError};
use agicash_domain::{Account, AccountType, UserId};
use agicash_traits::{AuthError, SessionStorage, StorageError, UserStorage};
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum ReceiveCmdError {
    #[error("not logged in")]
    NotLoggedIn,
    #[error("invalid token: {0}")]
    InvalidToken(String),
    #[error("no matching account for mint {0} — run `agicash mint add` first")]
    NoMatchingAccount(String),
    #[error(transparent)]
    Receive(#[from] ReceiveSwapError),
    #[error(transparent)]
    Storage(#[from] StorageError),
    #[error(transparent)]
    Auth(#[from] AuthError),
}

#[derive(Serialize)]
struct ReceiveOutput<'a> {
    status: &'a str,
    amount: String,
    fee: String,
    unit: String,
    currency: String,
    account_id: String,
    mint_url: String,
    token_hash: String,
}

#[derive(Serialize)]
struct AlreadyClaimedOutput<'a> {
    status: &'a str,
    token_hash: String,
}

pub async fn cmd_receive(
    auth: &AuthDeps,
    storage_deps: &StorageDeps,
    cashu_deps: &CashuDeps,
    receive_deps: &ReceiveSwapDeps,
    token_str: &str,
) -> Result<(), ReceiveCmdError> {
    let session = auth
        .storage
        .load()
        .await?
        .ok_or(ReceiveCmdError::NotLoggedIn)?;
    let user_id = UserId::from(session.user_id);

    let parsed = ParsedToken::parse(token_str, &cashu_deps.provider)
        .await
        .map_err(|e| match e {
            ReceiveSwapError::TokenParse(msg) => ReceiveCmdError::InvalidToken(msg),
            other => ReceiveCmdError::Receive(other),
        })?;

    let accounts = storage_deps.storage.list_accounts(user_id).await?;
    let account = pick_account(&accounts, &parsed)
        .ok_or_else(|| ReceiveCmdError::NoMatchingAccount(parsed.mint_url.clone()))?;

    let create_result = match receive_deps
        .service
        .create(user_id, &parsed, account, None)
        .await
    {
        Ok(r) => r,
        Err(ReceiveSwapError::Storage(ReceiveSwapStorageError::AlreadyClaimed)) => {
            let out = AlreadyClaimedOutput {
                status: "already-claimed",
                token_hash: parsed.hash.clone(),
            };
            println!("{}", serde_json::to_string(&out).expect("serialize JSON"));
            return Ok(());
        }
        Err(e) => return Err(ReceiveCmdError::Receive(e)),
    };

    // Need to obtain the BIP-39 seed for blinding. Pull from open secret —
    // requires an active session (the load() above confirmed one exists,
    // but rehydration in main.rs happens before this command runs).
    let seed = auth.client.get_cashu_seed().await?;

    let outcome = receive_deps
        .service
        .complete_swap(account, create_result.swap, &seed)
        .await?;
    print_outcome(&outcome, &create_result.account, &parsed);
    Ok(())
}

fn pick_account<'a>(accounts: &'a [Account], parsed: &ParsedToken) -> Option<&'a Account> {
    accounts.iter().find(|a| {
        a.account_type == AccountType::Cashu
            && a.details
                .get("mint_url")
                .and_then(|v| v.as_str())
                .is_some_and(|u| mint_urls_equal(u, &parsed.mint_url))
            && unit_matches_currency(&parsed.unit, a.currency)
    })
}

fn mint_urls_equal(a: &str, b: &str) -> bool {
    a.trim_end_matches('/') == b.trim_end_matches('/')
}

fn unit_matches_currency(
    unit: &cdk::nuts::CurrencyUnit,
    currency: agicash_domain::Currency,
) -> bool {
    use agicash_domain::Currency;
    use cdk::nuts::CurrencyUnit;
    matches!(
        (unit, currency),
        (CurrencyUnit::Sat, Currency::Btc) | (CurrencyUnit::Usd, Currency::Usd)
    )
}

fn print_outcome(outcome: &CompleteOutcome, fallback_account: &Account, parsed: &ParsedToken) {
    match outcome {
        CompleteOutcome::Completed {
            swap,
            account,
            added_proofs: _,
        } => {
            let body = ReceiveOutput {
                status: "received",
                amount: swap.amount_received.amount().to_string(),
                fee: swap.fee_amount.amount().to_string(),
                unit: swap.amount_received.unit().to_string(),
                currency: swap.amount_received.currency().to_string(),
                account_id: account.id.to_string(),
                mint_url: parsed.mint_url.clone(),
                token_hash: parsed.hash.clone(),
            };
            println!("{}", serde_json::to_string(&body).expect("serialize JSON"));
        }
        CompleteOutcome::AlreadyTerminal(swap) => {
            let status = match &swap.state {
                agicash_cashu::CashuReceiveSwapState::Completed => "received",
                agicash_cashu::CashuReceiveSwapState::Failed { .. } => "already-failed",
                agicash_cashu::CashuReceiveSwapState::Pending => "pending",
            };
            let body = ReceiveOutput {
                status,
                amount: swap.amount_received.amount().to_string(),
                fee: swap.fee_amount.amount().to_string(),
                unit: swap.amount_received.unit().to_string(),
                currency: swap.amount_received.currency().to_string(),
                account_id: fallback_account.id.to_string(),
                mint_url: parsed.mint_url.clone(),
                token_hash: parsed.hash.clone(),
            };
            println!("{}", serde_json::to_string(&body).expect("serialize JSON"));
        }
        CompleteOutcome::Failed(swap) => {
            let reason = match &swap.state {
                agicash_cashu::CashuReceiveSwapState::Failed { failure_reason } => {
                    failure_reason.clone()
                }
                _ => "unknown".into(),
            };
            let body = FailedOutput {
                status: "already-claimed",
                reason,
                token_hash: parsed.hash.clone(),
            };
            println!("{}", serde_json::to_string(&body).expect("serialize JSON"));
        }
    }
}

#[derive(Serialize)]
struct FailedOutput<'a> {
    status: &'a str,
    reason: String,
    token_hash: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use agicash_domain::{AccountId, AccountPurpose, AccountState, AccountType, Currency, UserId};
    use cdk::nuts::CurrencyUnit;
    use chrono::Utc;
    use serde_json::json;

    fn account(currency: Currency, mint_url: &str, ty: AccountType) -> Account {
        Account {
            id: AccountId::new(),
            created_at: Utc::now(),
            user_id: UserId::new(),
            name: "test".into(),
            account_type: ty,
            purpose: AccountPurpose::Transactional,
            currency,
            details: json!({ "mint_url": mint_url, "keyset_counters": {} }),
            version: 0,
            state: AccountState::Active,
            expires_at: None,
        }
    }

    fn token(mint_url: &str, unit: CurrencyUnit) -> ParsedToken {
        ParsedToken {
            raw: "cashuA...".into(),
            mint_url: mint_url.into(),
            proofs: vec![],
            memo: None,
            unit,
            hash: "h".into(),
        }
    }

    #[test]
    fn pick_account_matches_btc_sat_with_same_mint() {
        let accounts = vec![
            account(Currency::Usd, "https://a", AccountType::Cashu),
            account(Currency::Btc, "https://b", AccountType::Cashu),
            account(Currency::Btc, "https://a", AccountType::Spark),
            account(Currency::Btc, "https://a", AccountType::Cashu),
        ];
        let parsed = token("https://a", CurrencyUnit::Sat);
        let picked = pick_account(&accounts, &parsed).expect("found");
        assert_eq!(picked.account_type, AccountType::Cashu);
        assert_eq!(picked.currency, Currency::Btc);
    }

    #[test]
    fn pick_account_returns_none_when_no_matching_cashu_account() {
        let accounts = vec![
            account(Currency::Btc, "https://a", AccountType::Spark),
            account(Currency::Btc, "https://b", AccountType::Cashu),
        ];
        let parsed = token("https://a", CurrencyUnit::Sat);
        assert!(pick_account(&accounts, &parsed).is_none());
    }

    #[test]
    fn pick_account_rejects_currency_mismatch() {
        let accounts = vec![account(Currency::Usd, "https://a", AccountType::Cashu)];
        let parsed = token("https://a", CurrencyUnit::Sat);
        assert!(pick_account(&accounts, &parsed).is_none());
    }

    #[test]
    fn pick_account_normalizes_trailing_slash_on_mint_url() {
        let accounts = vec![account(Currency::Btc, "https://a/", AccountType::Cashu)];
        let parsed = token("https://a", CurrencyUnit::Sat);
        assert!(pick_account(&accounts, &parsed).is_some());
    }

    #[test]
    fn unit_matches_currency_covers_sat_btc_and_usd_usd_only() {
        use agicash_domain::Currency;
        assert!(unit_matches_currency(&CurrencyUnit::Sat, Currency::Btc));
        assert!(unit_matches_currency(&CurrencyUnit::Usd, Currency::Usd));
        assert!(!unit_matches_currency(&CurrencyUnit::Sat, Currency::Usd));
        assert!(!unit_matches_currency(&CurrencyUnit::Msat, Currency::Btc));
    }
}
