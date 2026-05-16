//! `agicash receive lightning <amount>` subcommand.
//!
//! Requests a NUT-04 mint quote from the account's Cashu mint, prints the
//! resulting BOLT-11 invoice as a `quote-issued` JSON event, then (unless
//! `--no-wait`) polls until the mint reports PAID, mints the proofs, and
//! prints a final `received` receipt.
//!
//! Two-shot UX (`--no-wait` + `receive lightning-complete <quote_id>`) is
//! provided for callers that want to drive the polling externally.

use crate::composition::{AuthDeps, MintQuoteDeps, StorageDeps};
use agicash_cashu::{
    CashuMintQuote, CashuMintQuoteState, CompleteMintQuoteOutcome, MintQuoteError,
};
use agicash_domain::{Account, AccountId, AccountType, Currency, UserId};
use agicash_money::{Money, Unit};
use agicash_traits::{AuthError, SessionStorage, StorageError, UserStorage};
use rust_decimal::Decimal;
use serde::Serialize;
use std::str::FromStr;
use std::time::Duration;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum ReceiveLightningCmdError {
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
    #[error("unsupported currency: {0}")]
    UnsupportedCurrency(String),
    #[error("amount too small")]
    AmountTooSmall,
    #[error("quote not paid yet")]
    QuoteNotPaid,
    #[error(transparent)]
    Quote(#[from] MintQuoteError),
    #[error(transparent)]
    Storage(#[from] StorageError),
    #[error(transparent)]
    Auth(#[from] AuthError),
}

#[derive(Serialize)]
struct QuoteIssuedOutput<'a> {
    status: &'a str,
    quote_id: String,
    invoice: String,
    payment_hash: String,
    amount: String,
    unit: String,
    currency: String,
    expires_at: String,
    account_id: String,
}

#[derive(Serialize)]
struct ReceivedOutput<'a> {
    status: &'a str,
    amount: String,
    fee: String,
    unit: String,
    currency: String,
    account_id: String,
    quote_id: String,
    payment_hash: String,
}

#[derive(Serialize)]
struct TimedOutOutput<'a> {
    status: &'a str,
    quote_id: String,
    invoice: String,
    payment_hash: String,
}

#[derive(Serialize)]
struct FailedOutput<'a> {
    status: &'a str,
    quote_id: String,
    reason: String,
}

#[allow(clippy::too_many_arguments)]
pub async fn cmd_receive_lightning(
    auth: &AuthDeps,
    storage_deps: &StorageDeps,
    quote_deps: &MintQuoteDeps,
    amount: u64,
    account: Option<String>,
    currency: String,
    description: Option<String>,
    no_wait: bool,
    poll_ms: u64,
    timeout_s: u64,
) -> Result<(), ReceiveLightningCmdError> {
    let session = auth
        .storage
        .load()
        .await?
        .ok_or(ReceiveLightningCmdError::NotLoggedIn)?;
    let user_id = UserId::from(session.user_id);

    let currency_enum = currency_from_str(&currency)
        .ok_or_else(|| ReceiveLightningCmdError::UnsupportedCurrency(currency.clone()))?;
    let unit = unit_for_currency(currency_enum);
    if amount == 0 {
        return Err(ReceiveLightningCmdError::AmountTooSmall);
    }
    let amount_money = Money::new(Decimal::from(amount), currency_enum, unit);

    let accounts = storage_deps.storage.list_accounts(user_id).await?;
    let account_obj = pick_account(&accounts, account.as_deref(), currency_enum)?;

    let quote = quote_deps
        .service
        .create_quote(user_id, account_obj, amount_money, description)
        .await?;

    // Emit the quote-issued event so the user has the invoice immediately.
    print_quote_issued(&quote, account_obj);

    if no_wait {
        return Ok(());
    }

    let polled = quote_deps
        .service
        .poll_until_paid(
            account_obj,
            quote.clone(),
            Duration::from_millis(poll_ms),
            Duration::from_secs(timeout_s),
        )
        .await?;
    if matches!(polled.state, CashuMintQuoteState::Unpaid) {
        print_timed_out(&polled);
        return Ok(());
    }
    finish_complete(auth, quote_deps, account_obj, polled).await
}

pub async fn cmd_receive_lightning_complete(
    auth: &AuthDeps,
    storage_deps: &StorageDeps,
    quote_deps: &MintQuoteDeps,
    quote_id: String,
    poll_ms: u64,
    timeout_s: u64,
) -> Result<(), ReceiveLightningCmdError> {
    let session = auth
        .storage
        .load()
        .await?
        .ok_or(ReceiveLightningCmdError::NotLoggedIn)?;
    let user_id = UserId::from(session.user_id);
    let id = Uuid::parse_str(&quote_id)
        .map_err(|_| ReceiveLightningCmdError::InvalidQuoteId(quote_id.clone()))?;
    let quote = quote_deps
        .storage
        .get(id)
        .await
        .map_err(|e| ReceiveLightningCmdError::Quote(MintQuoteError::Storage(e)))?;
    if quote.user_id != user_id {
        return Err(ReceiveLightningCmdError::NoMatchingAccount);
    }
    let accounts = storage_deps.storage.list_accounts(user_id).await?;
    let account_obj = accounts
        .iter()
        .find(|a| a.id == quote.account_id && a.account_type == AccountType::Cashu)
        .ok_or(ReceiveLightningCmdError::NoMatchingAccount)?;

    // If still UNPAID, give the mint one more chance via a single poll cycle.
    let polled = match &quote.state {
        CashuMintQuoteState::Unpaid => {
            quote_deps
                .service
                .poll_until_paid(
                    account_obj,
                    quote.clone(),
                    Duration::from_millis(poll_ms),
                    Duration::from_secs(timeout_s),
                )
                .await?
        }
        _ => quote.clone(),
    };
    if matches!(polled.state, CashuMintQuoteState::Unpaid) {
        return Err(ReceiveLightningCmdError::QuoteNotPaid);
    }
    finish_complete(auth, quote_deps, account_obj, polled).await
}

async fn finish_complete(
    auth: &AuthDeps,
    quote_deps: &MintQuoteDeps,
    account: &Account,
    quote: CashuMintQuote,
) -> Result<(), ReceiveLightningCmdError> {
    let seed = auth.client.get_cashu_seed().await?;
    let outcome = quote_deps
        .service
        .complete_receive(account, quote.clone(), &seed)
        .await?;
    print_outcome(&outcome, &quote);
    Ok(())
}

fn print_quote_issued(quote: &CashuMintQuote, account: &Account) {
    let body = QuoteIssuedOutput {
        status: "quote-issued",
        quote_id: quote.id.to_string(),
        invoice: quote.payment_request.clone(),
        payment_hash: quote.payment_hash.clone(),
        amount: quote.amount.amount().to_string(),
        unit: quote.amount.unit().to_string(),
        currency: quote.amount.currency().to_string(),
        expires_at: quote.expires_at.to_rfc3339(),
        account_id: account.id.to_string(),
    };
    println!("{}", serde_json::to_string(&body).expect("serialize JSON"));
}

fn print_timed_out(quote: &CashuMintQuote) {
    let body = TimedOutOutput {
        status: "timed-out",
        quote_id: quote.id.to_string(),
        invoice: quote.payment_request.clone(),
        payment_hash: quote.payment_hash.clone(),
    };
    println!("{}", serde_json::to_string(&body).expect("serialize JSON"));
}

fn print_outcome(outcome: &CompleteMintQuoteOutcome, fallback_quote: &CashuMintQuote) {
    match outcome {
        CompleteMintQuoteOutcome::Completed { quote, account, .. } => {
            let body = ReceivedOutput {
                status: "received",
                amount: quote.amount.amount().to_string(),
                fee: quote.total_fee.amount().to_string(),
                unit: quote.amount.unit().to_string(),
                currency: quote.amount.currency().to_string(),
                account_id: account.id.to_string(),
                quote_id: quote.id.to_string(),
                payment_hash: quote.payment_hash.clone(),
            };
            println!("{}", serde_json::to_string(&body).expect("serialize JSON"));
        }
        CompleteMintQuoteOutcome::AlreadyTerminal(quote) => {
            let status = match &quote.state {
                CashuMintQuoteState::Completed { .. } => "received",
                CashuMintQuoteState::Failed { .. } => "already-failed",
                CashuMintQuoteState::Expired => "already-expired",
                _ => "pending",
            };
            let body = ReceivedOutput {
                status,
                amount: quote.amount.amount().to_string(),
                fee: quote.total_fee.amount().to_string(),
                unit: quote.amount.unit().to_string(),
                currency: quote.amount.currency().to_string(),
                account_id: quote.account_id.to_string(),
                quote_id: quote.id.to_string(),
                payment_hash: quote.payment_hash.clone(),
            };
            println!("{}", serde_json::to_string(&body).expect("serialize JSON"));
        }
        CompleteMintQuoteOutcome::Failed(quote) => {
            let reason = match &quote.state {
                CashuMintQuoteState::Failed { failure_reason } => failure_reason.clone(),
                _ => "unknown".into(),
            };
            let body = FailedOutput {
                status: "failed",
                quote_id: fallback_quote.id.to_string(),
                reason,
            };
            println!("{}", serde_json::to_string(&body).expect("serialize JSON"));
        }
    }
}

fn pick_account<'a>(
    accounts: &'a [Account],
    requested: Option<&str>,
    currency: Currency,
) -> Result<&'a Account, ReceiveLightningCmdError> {
    let cashu: Vec<&Account> = accounts
        .iter()
        .filter(|a| a.account_type == AccountType::Cashu && a.currency == currency)
        .collect();
    match requested {
        Some(id_str) => {
            let id = Uuid::parse_str(id_str)
                .map_err(|_| ReceiveLightningCmdError::InvalidAccountId(id_str.to_string()))?;
            let account_id = AccountId::from(id);
            cashu
                .into_iter()
                .find(|a| a.id == account_id)
                .ok_or(ReceiveLightningCmdError::NoMatchingAccount)
        }
        None => match cashu.len() {
            0 => Err(ReceiveLightningCmdError::NoMatchingAccount),
            1 => Ok(cashu[0]),
            _ => Err(ReceiveLightningCmdError::AccountAmbiguous),
        },
    }
}

fn unit_for_currency(currency: Currency) -> Unit {
    match currency {
        Currency::Btc => Unit::Sat,
        Currency::Usd | Currency::Usdb => Unit::Cent,
    }
}

fn currency_from_str(s: &str) -> Option<Currency> {
    Currency::from_str(s).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use agicash_domain::{AccountPurpose, AccountState, AccountType};
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
        let picked = pick_account(&accounts, None, Currency::Btc).unwrap();
        assert_eq!(picked.account_type, AccountType::Cashu);
    }

    #[test]
    fn pick_account_errors_when_no_cashu_account_in_currency() {
        let accounts = vec![account(Currency::Usd, AccountType::Cashu)];
        let err = pick_account(&accounts, None, Currency::Btc).unwrap_err();
        assert!(matches!(err, ReceiveLightningCmdError::NoMatchingAccount));
    }

    #[test]
    fn pick_account_errors_when_multiple_cashu_no_id() {
        let accounts = vec![
            account(Currency::Btc, AccountType::Cashu),
            account(Currency::Btc, AccountType::Cashu),
        ];
        let err = pick_account(&accounts, None, Currency::Btc).unwrap_err();
        assert!(matches!(err, ReceiveLightningCmdError::AccountAmbiguous));
    }

    #[test]
    fn pick_account_rejects_invalid_uuid() {
        let accounts = vec![account(Currency::Btc, AccountType::Cashu)];
        let err = pick_account(&accounts, Some("not-a-uuid"), Currency::Btc).unwrap_err();
        assert!(matches!(err, ReceiveLightningCmdError::InvalidAccountId(_)));
    }

    #[test]
    fn currency_from_str_handles_btc_and_usd() {
        assert_eq!(currency_from_str("BTC"), Some(Currency::Btc));
        assert_eq!(currency_from_str("USD"), Some(Currency::Usd));
        assert_eq!(currency_from_str("XYZ"), None);
    }

    #[test]
    fn unit_for_currency_maps_btc_and_usd() {
        assert_eq!(unit_for_currency(Currency::Btc), Unit::Sat);
        assert_eq!(unit_for_currency(Currency::Usd), Unit::Cent);
    }
}
