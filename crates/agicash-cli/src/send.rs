//! `agicash send <amount>` subcommand.
//!
//! Selects proofs from a Cashu account, swaps with the mint when needed
//! per NUT-03, encodes the resulting proofs into a Cashu V3/V4 token, and
//! prints a JSON receipt to stdout. Slice 6 leaves the swap in PENDING
//! after producing the token — receiver-claim detection lands in a
//! future slice.

use crate::composition::{AuthDeps, CashuDeps, SendSwapDeps, StorageDeps};
use agicash_cashu::{CashuSendSwapState, SendSwapError, TokenProof};
use agicash_domain::{Account, AccountId, AccountType, Currency, UserId};
use agicash_money::{Money, Unit};
use agicash_traits::{AuthError, StorageError, UserStorage};
use cdk::mint_url::MintUrl;
use cdk::nuts::nut02::Id as KeysetId;
use cdk::nuts::{CurrencyUnit, Proof, Token};
use cdk::Amount;
use rust_decimal::Decimal;
use serde::Serialize;
use std::str::FromStr;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum SendCmdError {
    #[error("not logged in")]
    NotLoggedIn,
    #[error("no matching account")]
    NoMatchingAccount,
    #[error("account ambiguous — pass --account <id>")]
    AccountAmbiguous,
    #[error("invalid account id: {0}")]
    InvalidAccountId(String),
    #[error("unsupported token version: {0}")]
    UnsupportedTokenVersion(u8),
    #[error("token encode error: {0}")]
    TokenEncode(String),
    #[error(transparent)]
    Send(#[from] SendSwapError),
    #[error(transparent)]
    Storage(#[from] StorageError),
    #[error(transparent)]
    Auth(#[from] AuthError),
}

#[derive(Serialize)]
struct SendOutput<'a> {
    status: &'a str,
    token: String,
    amount: String,
    fee: String,
    unit: String,
    currency: String,
    account_id: String,
    mint_url: String,
    swap_id: String,
    token_hash: String,
}

#[derive(Serialize)]
struct QuoteOutput<'a> {
    status: &'a str,
    amount_requested: String,
    amount_to_send: String,
    total_amount: String,
    total_fee: String,
    cashu_send_fee: String,
    cashu_receive_fee: String,
    unit: String,
    currency: String,
    account_id: String,
    mint_url: String,
}

#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
pub async fn cmd_send(
    auth: &AuthDeps,
    storage_deps: &StorageDeps,
    _cashu_deps: &CashuDeps,
    send_deps: &SendSwapDeps,
    amount: u64,
    account: Option<String>,
    token_version: u8,
    dry_run: bool,
) -> Result<(), SendCmdError> {
    if token_version != 3 && token_version != 4 {
        return Err(SendCmdError::UnsupportedTokenVersion(token_version));
    }
    let session = auth
        .storage
        .load()
        .await?
        .ok_or(SendCmdError::NotLoggedIn)?;
    let user_id = UserId::from(session.user_id);

    let accounts = storage_deps.storage.list_accounts(user_id).await?;
    let account_obj = pick_account(&accounts, account.as_deref())?;
    let mint_url_str = account_obj
        .details
        .get("mint_url")
        .and_then(|v| v.as_str())
        .map(std::string::ToString::to_string)
        .ok_or_else(|| {
            SendCmdError::Storage(StorageError::Internal(
                "account.details missing mint_url".into(),
            ))
        })?;

    let unit = unit_for_currency(account_obj.currency);
    let amount_money = Money::new(Decimal::from(amount), account_obj.currency, unit);

    let proofs = send_deps
        .storage
        .list_unspent_proofs(account_obj.id)
        .await
        .map_err(|e| SendCmdError::Send(SendSwapError::Storage(e)))?;

    if dry_run {
        let quote = send_deps
            .service
            .get_quote(account_obj, &proofs, amount_money)
            .await?;
        let body = QuoteOutput {
            status: "quote",
            amount_requested: quote.amount_requested.amount().to_string(),
            amount_to_send: quote.amount_to_send.amount().to_string(),
            total_amount: quote.total_amount.amount().to_string(),
            total_fee: quote.total_fee.amount().to_string(),
            cashu_send_fee: quote.cashu_send_fee.amount().to_string(),
            cashu_receive_fee: quote.cashu_receive_fee.amount().to_string(),
            unit: quote.amount_to_send.unit().to_string(),
            currency: account_obj.currency.to_string(),
            account_id: account_obj.id.to_string(),
            mint_url: mint_url_str,
        };
        println!("{}", serde_json::to_string(&body).expect("serialize JSON"));
        return Ok(());
    }

    let create_result = send_deps
        .service
        .create(account_obj, &proofs, amount_money)
        .await?;
    let swap = match &create_result.swap.state {
        CashuSendSwapState::Draft => {
            // Need the seed to perform the input swap with deterministic
            // outputs.
            let seed = auth.client.get_cashu_seed().await?;
            send_deps
                .service
                .swap_for_proofs_to_send(account_obj, create_result.swap.clone(), &seed)
                .await?
        }
        CashuSendSwapState::Pending { .. } => create_result.swap.clone(),
        other => {
            return Err(SendCmdError::Send(SendSwapError::InvalidTransition {
                from: format!("{other:?}"),
                event: "create".into(),
            }));
        }
    };

    let (token_hash, proofs_to_send) = match &swap.state {
        CashuSendSwapState::Pending {
            token_hash,
            proofs_to_send,
        }
        | CashuSendSwapState::Completed {
            token_hash,
            proofs_to_send,
        } => (token_hash.clone(), proofs_to_send.clone()),
        other => {
            return Err(SendCmdError::Send(SendSwapError::InvalidTransition {
                from: format!("{other:?}"),
                event: "produce-token".into(),
            }));
        }
    };

    let token_str = encode_token(
        &mint_url_str,
        &proofs_to_send,
        account_obj.currency,
        token_version,
    )?;
    let body = SendOutput {
        status: "sent",
        token: token_str,
        // `amount` is the user-facing send amount — what the receiver
        // gets after claiming. `amount_to_send` (encoded into the token)
        // includes the receive-side fee they pay back to the mint, so we
        // surface `amount_received` to keep the CLI contract readable.
        amount: swap.amount_received.amount().to_string(),
        fee: swap.total_fee.amount().to_string(),
        unit: swap.amount_received.unit().to_string(),
        currency: account_obj.currency.to_string(),
        account_id: account_obj.id.to_string(),
        mint_url: mint_url_str,
        swap_id: swap.id.to_string(),
        token_hash,
    };
    println!("{}", serde_json::to_string(&body).expect("serialize JSON"));
    Ok(())
}

fn pick_account<'a>(
    accounts: &'a [Account],
    requested: Option<&str>,
) -> Result<&'a Account, SendCmdError> {
    let cashu: Vec<&Account> = accounts
        .iter()
        .filter(|a| a.account_type == AccountType::Cashu)
        .collect();
    match requested {
        Some(id_str) => {
            let id = Uuid::parse_str(id_str)
                .map_err(|_| SendCmdError::InvalidAccountId(id_str.to_string()))?;
            let account_id = AccountId::from(id);
            cashu
                .into_iter()
                .find(|a| a.id == account_id)
                .ok_or(SendCmdError::NoMatchingAccount)
        }
        None => match cashu.len() {
            0 => Err(SendCmdError::NoMatchingAccount),
            1 => Ok(cashu[0]),
            _ => Err(SendCmdError::AccountAmbiguous),
        },
    }
}

fn unit_for_currency(currency: Currency) -> Unit {
    match currency {
        Currency::Btc => Unit::Sat,
        Currency::Usd | Currency::Usdb => Unit::Cent,
    }
}

fn cashu_unit_for_currency(currency: Currency) -> CurrencyUnit {
    match currency {
        Currency::Btc => CurrencyUnit::Sat,
        Currency::Usd | Currency::Usdb => CurrencyUnit::Usd,
    }
}

fn encode_token(
    mint_url: &str,
    proofs: &[TokenProof],
    currency: Currency,
    token_version: u8,
) -> Result<String, SendCmdError> {
    let mint = MintUrl::from_str(mint_url)
        .map_err(|e| SendCmdError::TokenEncode(format!("mint url: {e}")))?;
    let cdk_proofs: Vec<Proof> = proofs
        .iter()
        .map(token_proof_to_cdk_proof)
        .collect::<Result<Vec<_>, _>>()?;
    let unit = cashu_unit_for_currency(currency);
    let token = Token::new(mint, cdk_proofs, None, unit);
    Ok(match token_version {
        3 => token.to_v3_string(),
        _ => token.to_string(),
    })
}

fn token_proof_to_cdk_proof(proof: &TokenProof) -> Result<Proof, SendCmdError> {
    use cdk::nuts::PublicKey;
    use cdk::secret::Secret;
    let keyset_id = KeysetId::from_str(&proof.id)
        .map_err(|e| SendCmdError::TokenEncode(format!("keyset id {}: {e}", proof.id)))?;
    let secret = Secret::from_str(&proof.secret)
        .map_err(|e| SendCmdError::TokenEncode(format!("secret: {e}")))?;
    let c =
        PublicKey::from_hex(&proof.c).map_err(|e| SendCmdError::TokenEncode(format!("C: {e}")))?;
    Ok(Proof {
        amount: Amount::from(proof.amount),
        keyset_id,
        secret,
        c,
        witness: None,
        dleq: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use agicash_domain::{AccountPurpose, AccountState, AccountType, Currency, UserId};
    use chrono::Utc;
    use serde_json::json;

    fn account(currency: Currency, ty: AccountType, mint_url: &str) -> Account {
        Account {
            id: AccountId::new(),
            created_at: Utc::now(),
            user_id: UserId::new(),
            name: "Mint".into(),
            account_type: ty,
            purpose: AccountPurpose::Transactional,
            currency,
            details: json!({"mint_url": mint_url}),
            version: 0,
            state: AccountState::Active,
            expires_at: None,
        }
    }

    #[test]
    fn pick_account_returns_only_cashu_when_no_id_passed() {
        let accounts = vec![
            account(Currency::Btc, AccountType::Spark, "https://a"),
            account(Currency::Btc, AccountType::Cashu, "https://m"),
        ];
        let picked = pick_account(&accounts, None).unwrap();
        assert_eq!(picked.account_type, AccountType::Cashu);
    }

    #[test]
    fn pick_account_errors_when_multiple_cashu_no_id() {
        let accounts = vec![
            account(Currency::Btc, AccountType::Cashu, "https://m1"),
            account(Currency::Btc, AccountType::Cashu, "https://m2"),
        ];
        let err = pick_account(&accounts, None).unwrap_err();
        assert!(matches!(err, SendCmdError::AccountAmbiguous));
    }

    #[test]
    fn pick_account_errors_when_no_cashu_account() {
        let accounts = vec![account(Currency::Btc, AccountType::Spark, "https://a")];
        let err = pick_account(&accounts, None).unwrap_err();
        assert!(matches!(err, SendCmdError::NoMatchingAccount));
    }

    #[test]
    fn pick_account_finds_by_id() {
        let target = account(Currency::Btc, AccountType::Cashu, "https://m1");
        let target_id = target.id;
        let accounts = vec![
            account(Currency::Btc, AccountType::Cashu, "https://m2"),
            target,
        ];
        let picked = pick_account(&accounts, Some(&target_id.to_string())).unwrap();
        assert_eq!(picked.id, target_id);
    }

    #[test]
    fn pick_account_rejects_invalid_uuid() {
        let accounts = vec![account(Currency::Btc, AccountType::Cashu, "https://m")];
        let err = pick_account(&accounts, Some("not-a-uuid")).unwrap_err();
        assert!(matches!(err, SendCmdError::InvalidAccountId(_)));
    }

    #[test]
    fn unit_for_currency_maps_btc_and_usd() {
        assert_eq!(unit_for_currency(Currency::Btc), Unit::Sat);
        assert_eq!(unit_for_currency(Currency::Usd), Unit::Cent);
    }

    #[test]
    fn cashu_unit_for_currency_maps_btc_and_usd() {
        assert!(matches!(
            cashu_unit_for_currency(Currency::Btc),
            CurrencyUnit::Sat
        ));
        assert!(matches!(
            cashu_unit_for_currency(Currency::Usd),
            CurrencyUnit::Usd
        ));
    }
}
