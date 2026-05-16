//! `agicash send lightning <bolt11>` subcommand.
//!
//! Requests a NUT-05 melt quote from the account's Cashu mint, reserves
//! proofs, marks the quote PENDING, calls `post_melt`, polls until PAID
//! (or the user opts out with `--no-wait`), then persists the change
//! proofs and prints a final receipt.

use crate::composition::{AuthDeps, MeltQuoteDeps, SendSwapDeps, StorageDeps};
use agicash_cashu::{
    CashuMeltQuote, CashuMeltQuoteState, MeltOutcome, MeltQuoteError, MeltQuotePreview,
};
use agicash_domain::{Account, AccountId, AccountType, UserId};
use agicash_traits::{AuthError, StorageError, UserStorage};
use serde::Serialize;
use std::str::FromStr;
use std::time::Duration;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum SendLightningCmdError {
    #[error("not logged in")]
    NotLoggedIn,
    #[error("no matching account")]
    NoMatchingAccount,
    #[error("account ambiguous — pass --account <id>")]
    AccountAmbiguous,
    #[error("invalid account id: {0}")]
    InvalidAccountId(String),
    #[error("invalid quote id: {0}")]
    InvalidQuoteId(String),
    #[error(transparent)]
    Quote(#[from] MeltQuoteError),
    #[error(transparent)]
    Storage(#[from] StorageError),
    #[error(transparent)]
    Auth(#[from] AuthError),
}

#[derive(Serialize)]
struct QuoteOutput<'a> {
    status: &'a str,
    amount: String,
    lightning_fee_reserve: String,
    cashu_fee: String,
    total_fee: String,
    total_amount: String,
    unit: String,
    currency: String,
    account_id: String,
    payment_hash: String,
}

#[derive(Serialize)]
struct QuoteIssuedOutput<'a> {
    status: &'a str,
    quote_id: String,
    invoice: String,
    amount: String,
    lightning_fee_reserve: String,
    cashu_fee: String,
    total_fee: String,
    expires_at: String,
    account_id: String,
    payment_hash: String,
}

#[derive(Serialize)]
struct PaidOutput<'a> {
    status: &'a str,
    quote_id: String,
    amount: String,
    lightning_fee: String,
    cashu_fee: String,
    total_fee: String,
    amount_spent: String,
    payment_preimage: String,
    account_id: String,
    payment_hash: String,
}

#[derive(Serialize)]
struct TimedOutOutput<'a> {
    status: &'a str,
    quote_id: String,
    payment_hash: String,
}

#[derive(Serialize)]
struct FailedOutput<'a> {
    status: &'a str,
    quote_id: String,
    reason: String,
}

#[allow(clippy::too_many_arguments)]
pub async fn cmd_send_lightning(
    auth: &AuthDeps,
    storage_deps: &StorageDeps,
    send_swap_deps: &SendSwapDeps,
    melt_deps: &MeltQuoteDeps,
    invoice: String,
    account: Option<String>,
    dry_run: bool,
    no_wait: bool,
    poll_ms: u64,
    timeout_s: u64,
) -> Result<(), SendLightningCmdError> {
    let session = auth
        .storage
        .load()
        .await?
        .ok_or(SendLightningCmdError::NotLoggedIn)?;
    let user_id = UserId::from(session.user_id);

    let accounts = storage_deps.storage.list_accounts(user_id).await?;
    let account_obj = pick_account(&accounts, account.as_deref())?;

    let proofs = send_swap_deps
        .storage
        .list_unspent_proofs(account_obj.id)
        .await
        .map_err(|e| {
            SendLightningCmdError::Quote(MeltQuoteError::Storage(
                agicash_cashu::MeltQuoteStorageError::Backend(format!("list_unspent_proofs: {e}")),
            ))
        })?;

    let preview = melt_deps
        .service
        .get_quote(account_obj, &proofs, &invoice)
        .await?;

    if dry_run {
        print_dry_run(&preview, account_obj);
        return Ok(());
    }

    let created = melt_deps
        .service
        .create_quote(user_id, account_obj, preview)
        .await?;
    let quote = created.quote;
    print_quote_issued(&quote, account_obj);

    if no_wait {
        return Ok(());
    }

    let seed = auth.client.get_cashu_seed().await?;
    let initial = melt_deps
        .service
        .initiate_melt(account_obj, quote.clone(), &seed)
        .await?;
    let final_outcome = match initial {
        MeltOutcome::Paid { .. } | MeltOutcome::Failed(_) => initial,
        MeltOutcome::Pending(pending_quote) => {
            melt_deps
                .service
                .poll_until_complete(
                    account_obj,
                    pending_quote,
                    &seed,
                    Duration::from_millis(poll_ms),
                    Duration::from_secs(timeout_s),
                )
                .await?
        }
    };
    print_outcome(&final_outcome, &quote);
    Ok(())
}

pub async fn cmd_send_lightning_complete(
    auth: &AuthDeps,
    storage_deps: &StorageDeps,
    melt_deps: &MeltQuoteDeps,
    quote_id: String,
    poll_ms: u64,
    timeout_s: u64,
) -> Result<(), SendLightningCmdError> {
    let session = auth
        .storage
        .load()
        .await?
        .ok_or(SendLightningCmdError::NotLoggedIn)?;
    let user_id = UserId::from(session.user_id);
    let id = Uuid::parse_str(&quote_id)
        .map_err(|_| SendLightningCmdError::InvalidQuoteId(quote_id.clone()))?;
    let quote = melt_deps
        .storage
        .get(id)
        .await
        .map_err(|e| SendLightningCmdError::Quote(MeltQuoteError::Storage(e)))?;
    if quote.user_id != user_id {
        return Err(SendLightningCmdError::NoMatchingAccount);
    }
    let accounts = storage_deps.storage.list_accounts(user_id).await?;
    let account_obj = accounts
        .iter()
        .find(|a| a.id == quote.account_id && a.account_type == AccountType::Cashu)
        .ok_or(SendLightningCmdError::NoMatchingAccount)?;

    match &quote.state {
        CashuMeltQuoteState::Paid { .. } => {
            print_outcome(
                &MeltOutcome::Paid {
                    quote: quote.clone(),
                    account: account_obj.clone(),
                    change_proofs_count: 0,
                },
                &quote,
            );
            Ok(())
        }
        CashuMeltQuoteState::Failed { failure_reason } => {
            let body = FailedOutput {
                status: "failed",
                quote_id: quote.id.to_string(),
                reason: failure_reason.clone(),
            };
            println!("{}", serde_json::to_string(&body).expect("serialize JSON"));
            Ok(())
        }
        CashuMeltQuoteState::Expired => {
            let body = FailedOutput {
                status: "expired",
                quote_id: quote.id.to_string(),
                reason: "quote expired".into(),
            };
            println!("{}", serde_json::to_string(&body).expect("serialize JSON"));
            Ok(())
        }
        CashuMeltQuoteState::Unpaid | CashuMeltQuoteState::Pending => {
            let seed = auth.client.get_cashu_seed().await?;
            let initial = if matches!(quote.state, CashuMeltQuoteState::Unpaid) {
                melt_deps
                    .service
                    .initiate_melt(account_obj, quote.clone(), &seed)
                    .await?
            } else {
                MeltOutcome::Pending(quote.clone())
            };
            let final_outcome = match initial {
                MeltOutcome::Paid { .. } | MeltOutcome::Failed(_) => initial,
                MeltOutcome::Pending(pending_quote) => {
                    melt_deps
                        .service
                        .poll_until_complete(
                            account_obj,
                            pending_quote,
                            &seed,
                            Duration::from_millis(poll_ms),
                            Duration::from_secs(timeout_s),
                        )
                        .await?
                }
            };
            print_outcome(&final_outcome, &quote);
            Ok(())
        }
    }
}

fn print_dry_run(preview: &MeltQuotePreview, account: &Account) {
    let body = QuoteOutput {
        status: "quote",
        amount: preview.amount_received.amount().to_string(),
        lightning_fee_reserve: preview.lightning_fee_reserve.amount().to_string(),
        cashu_fee: preview.cashu_fee.amount().to_string(),
        total_fee: preview.total_fee.amount().to_string(),
        total_amount: preview.total_amount.amount().to_string(),
        unit: preview.amount_received.unit().to_string(),
        currency: preview.amount_received.currency().to_string(),
        account_id: account.id.to_string(),
        payment_hash: preview.payment_hash.clone(),
    };
    println!("{}", serde_json::to_string(&body).expect("serialize JSON"));
}

fn print_quote_issued(quote: &CashuMeltQuote, account: &Account) {
    let body = QuoteIssuedOutput {
        status: "quote-issued",
        quote_id: quote.id.to_string(),
        invoice: quote.payment_request.clone(),
        amount: quote.amount_received.amount().to_string(),
        lightning_fee_reserve: quote.lightning_fee_reserve.amount().to_string(),
        cashu_fee: quote.cashu_fee.amount().to_string(),
        total_fee: quote
            .lightning_fee_reserve
            .try_add(&quote.cashu_fee)
            .map_or_else(|_| "0".to_string(), |m| m.amount().to_string()),
        expires_at: quote.expires_at.to_rfc3339(),
        account_id: account.id.to_string(),
        payment_hash: quote.payment_hash.clone(),
    };
    println!("{}", serde_json::to_string(&body).expect("serialize JSON"));
}

fn print_outcome(outcome: &MeltOutcome, fallback: &CashuMeltQuote) {
    match outcome {
        MeltOutcome::Paid { quote, .. } => {
            let (preimage, lightning_fee, amount_spent, total_fee) = match &quote.state {
                CashuMeltQuoteState::Paid {
                    payment_preimage,
                    lightning_fee,
                    amount_spent,
                    total_fee,
                } => (
                    payment_preimage.clone(),
                    lightning_fee.amount().to_string(),
                    amount_spent.amount().to_string(),
                    total_fee.amount().to_string(),
                ),
                _ => (
                    String::new(),
                    "0".to_string(),
                    quote.amount_received.amount().to_string(),
                    quote.cashu_fee.amount().to_string(),
                ),
            };
            let body = PaidOutput {
                status: "paid",
                quote_id: quote.id.to_string(),
                amount: quote.amount_received.amount().to_string(),
                lightning_fee,
                cashu_fee: quote.cashu_fee.amount().to_string(),
                total_fee,
                amount_spent,
                payment_preimage: preimage,
                account_id: quote.account_id.to_string(),
                payment_hash: quote.payment_hash.clone(),
            };
            println!("{}", serde_json::to_string(&body).expect("serialize JSON"));
        }
        MeltOutcome::Pending(quote) => {
            let body = TimedOutOutput {
                status: "timed-out",
                quote_id: quote.id.to_string(),
                payment_hash: quote.payment_hash.clone(),
            };
            println!("{}", serde_json::to_string(&body).expect("serialize JSON"));
        }
        MeltOutcome::Failed(quote) => {
            let reason = match &quote.state {
                CashuMeltQuoteState::Failed { failure_reason } => failure_reason.clone(),
                _ => "unknown".into(),
            };
            let body = FailedOutput {
                status: "failed",
                quote_id: fallback.id.to_string(),
                reason,
            };
            println!("{}", serde_json::to_string(&body).expect("serialize JSON"));
        }
    }
}

fn pick_account<'a>(
    accounts: &'a [Account],
    requested: Option<&str>,
) -> Result<&'a Account, SendLightningCmdError> {
    let cashu: Vec<&Account> = accounts
        .iter()
        .filter(|a| a.account_type == AccountType::Cashu)
        .collect();
    match requested {
        Some(id_str) => {
            let id = Uuid::from_str(id_str)
                .map_err(|_| SendLightningCmdError::InvalidAccountId(id_str.to_string()))?;
            let account_id = AccountId::from(id);
            cashu
                .into_iter()
                .find(|a| a.id == account_id)
                .ok_or(SendLightningCmdError::NoMatchingAccount)
        }
        None => match cashu.len() {
            0 => Err(SendLightningCmdError::NoMatchingAccount),
            1 => Ok(cashu[0]),
            _ => Err(SendLightningCmdError::AccountAmbiguous),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use agicash_domain::{AccountPurpose, AccountState, AccountType, Currency};
    use chrono::Utc;
    use serde_json::json;

    fn account(currency: Currency, ty: AccountType) -> Account {
        Account {
            id: AccountId::new(),
            created_at: Utc::now(),
            user_id: UserId::new(),
            name: "test".into(),
            account_type: ty,
            purpose: AccountPurpose::Transactional,
            currency,
            details: json!({ "mint_url": "https://m", "keyset_counters": {} }),
            version: 0,
            state: AccountState::Active,
            expires_at: None,
        }
    }

    #[test]
    fn pick_account_returns_only_cashu_when_no_id_passed() {
        let accounts = vec![
            account(Currency::Btc, AccountType::Spark),
            account(Currency::Btc, AccountType::Cashu),
        ];
        let picked = pick_account(&accounts, None).unwrap();
        assert_eq!(picked.account_type, AccountType::Cashu);
    }

    #[test]
    fn pick_account_errors_when_no_cashu() {
        let accounts = vec![account(Currency::Btc, AccountType::Spark)];
        let err = pick_account(&accounts, None).unwrap_err();
        assert!(matches!(err, SendLightningCmdError::NoMatchingAccount));
    }

    #[test]
    fn pick_account_errors_when_multiple_cashu_no_id() {
        let accounts = vec![
            account(Currency::Btc, AccountType::Cashu),
            account(Currency::Btc, AccountType::Cashu),
        ];
        let err = pick_account(&accounts, None).unwrap_err();
        assert!(matches!(err, SendLightningCmdError::AccountAmbiguous));
    }

    #[test]
    fn pick_account_rejects_invalid_uuid() {
        let accounts = vec![account(Currency::Btc, AccountType::Cashu)];
        let err = pick_account(&accounts, Some("not-a-uuid")).unwrap_err();
        assert!(matches!(err, SendLightningCmdError::InvalidAccountId(_)));
    }
}
