//! Orchestrator that drives a [`ReceiveSwapMachine`] forward by performing
//! the I/O for each [`Action`] against the CDK [`CashuProvider`] +
//! [`CashuReceiveSwapStorage`].
//!
//! Mirrors `app/features/receive/cashu-receive-swap-service.ts` —
//! `create`, `fail`, and `complete_swap` keep the TS shape; the inner CDK
//! call replaces TS's `wallet.ops.receive(...).asCustom(outputData).run()`.

use super::error::ReceiveSwapError;
use super::state::{Action, Event, ReceiveSwapMachine};
use super::storage::{
    CashuReceiveSwapStorage, CompleteReceiveSwapResult, CreateReceiveSwap, CreateReceiveSwapResult,
};
use super::types::{CashuReceiveSwap, CashuReceiveSwapState, TokenProof};
use agicash_domain::{Account, Currency, UserId};
use agicash_money::{Money, Unit};
use agicash_traits::{CashuMintWallet, CashuProvider, CashuProviderError};
use cdk::amount::{FeeAndAmounts, SplitTarget};
use cdk::dhke::construct_proofs;
use cdk::error::ErrorCode;
use cdk::mint_url::MintUrl;
use cdk::nuts::nut02::Id as KeysetId;
use cdk::nuts::{
    CurrencyUnit, KeySet, KeySetInfo, PreMintSecrets, Proof, RestoreRequest, SwapRequest, Token,
};
use cdk::wallet::MintConnector;
use cdk::Amount;
use rust_decimal::Decimal;
use std::str::FromStr;
use std::sync::Arc;
use uuid::Uuid;

/// Service that orchestrates receive-swap creation and completion.
///
/// Holds an [`Arc`] over the storage + provider traits so it can live behind
/// `Arc<Self>` in the CLI composition root without cloning callbacks.
#[derive(Clone)]
pub struct CashuReceiveSwapService {
    storage: Arc<dyn CashuReceiveSwapStorage>,
    cashu_provider: Arc<dyn CashuProvider>,
}

impl std::fmt::Debug for CashuReceiveSwapService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CashuReceiveSwapService")
            .finish_non_exhaustive()
    }
}

impl CashuReceiveSwapService {
    pub fn new(
        storage: Arc<dyn CashuReceiveSwapStorage>,
        cashu_provider: Arc<dyn CashuProvider>,
    ) -> Self {
        Self {
            storage,
            cashu_provider,
        }
    }

    /// Validate a parsed token against `account` and create the PENDING
    /// receive-swap row. Returns the created swap + updated account.
    ///
    /// Mirrors `CashuReceiveSwapService.create` in TS — rejects mint URL or
    /// currency mismatches, computes the mint fee, builds the
    /// powers-of-two output split, then hands off to storage.
    pub async fn create(
        &self,
        user_id: UserId,
        token: &ParsedToken,
        account: &Account,
        reversed_transaction_id: Option<Uuid>,
    ) -> Result<CreateReceiveSwapResult, ReceiveSwapError> {
        let account_mint = account
            .details
            .get("mint_url")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                ReceiveSwapError::Mint(CashuProviderError::InvalidUrl(
                    "account.details missing mint_url".into(),
                ))
            })?
            .to_string();
        if !mint_urls_equal(&token.mint_url, &account_mint) {
            return Err(ReceiveSwapError::MintMismatch {
                token: token.mint_url.clone(),
                account: account_mint,
            });
        }
        let token_currency = currency_from_cashu_unit(&token.unit).ok_or_else(|| {
            ReceiveSwapError::CurrencyMismatch {
                token: token.unit.to_string(),
                account: account.currency.to_string(),
            }
        })?;
        if token_currency != account.currency {
            return Err(ReceiveSwapError::CurrencyMismatch {
                token: token_currency.to_string(),
                account: account.currency.to_string(),
            });
        }

        let wallet = self.cashu_provider.wallet_for_account(account).await?;
        let keysets = fetch_keyset_infos(&wallet).await?;
        let active = active_keyset_for_unit(&keysets, &token.unit).ok_or_else(|| {
            ReceiveSwapError::Mint(CashuProviderError::Protocol(format!(
                "no active keyset for unit {}",
                token.unit
            )))
        })?;
        let input_total: u64 = token.proofs.iter().map(|p| p.amount).sum();
        let fee_for_proofs = compute_fee_for_proofs(&token.proofs, &keysets);
        if u64::from(fee_for_proofs) >= input_total {
            return Err(ReceiveSwapError::AmountTooSmall);
        }
        let amount_to_receive = input_total - u64::from(fee_for_proofs);
        let unit = unit_for_currency(account.currency);

        let fee_and_amounts = fee_and_amounts_for_keyset(active);
        let output_amounts = split_amounts(amount_to_receive, &fee_and_amounts)?;

        let input = CreateReceiveSwap {
            token_hash: token.hash.clone(),
            token_proofs: token.proofs.clone(),
            token_mint_url: token.mint_url.clone(),
            token_description: token.memo.clone(),
            user_id,
            account_id: account.id,
            keyset_id: active.id.to_string(),
            input_amount: Money::new(Decimal::from(input_total), account.currency, unit),
            fee_amount: Money::new(
                Decimal::from(u64::from(fee_for_proofs)),
                account.currency,
                unit,
            ),
            amount_received: Money::new(Decimal::from(amount_to_receive), account.currency, unit),
            output_amounts,
            reversed_transaction_id,
        };
        Ok(self.storage.create(input).await?)
    }

    /// Drive a PENDING swap to completion: call the mint, restore on
    /// "already signed", and persist the resulting proofs. Idempotent on
    /// COMPLETED/FAILED swaps (returns
    /// [`CompleteOutcome::AlreadyTerminal`]).
    pub async fn complete_swap(
        &self,
        account: &Account,
        swap: CashuReceiveSwap,
        seed: &[u8; 64],
    ) -> Result<CompleteOutcome, ReceiveSwapError> {
        let mut machine = ReceiveSwapMachine::from_existing(swap.clone());
        if machine.is_terminal() {
            return Ok(CompleteOutcome::AlreadyTerminal(swap));
        }

        let wallet = self.cashu_provider.wallet_for_account(account).await?;
        let keysets = fetch_keyset_infos(&wallet).await?;
        let keyset_id = KeysetId::from_str(&swap.keyset_id).map_err(|e| {
            ReceiveSwapError::Mint(CashuProviderError::Protocol(format!(
                "invalid keyset id {}: {e}",
                swap.keyset_id
            )))
        })?;
        let keyset_info = keysets.iter().find(|k| k.id == keyset_id).ok_or_else(|| {
            ReceiveSwapError::Mint(CashuProviderError::Protocol(format!(
                "keyset {} not found on mint",
                swap.keyset_id
            )))
        })?;
        let mint_keys = fetch_keyset_keys(&wallet, keyset_id).await?;

        // The machine starts in PendingMintSwap (we just constructed it
        // from a PENDING swap). One mint round-trip + one storage round-trip
        // takes it to Completed — or one storage failure to Failed. No
        // looping needed.
        let action = machine.next_action();
        let Action::SwapWithMint {
            keyset_id: _,
            keyset_counter,
            output_amounts,
        } = action
        else {
            return Err(ReceiveSwapError::InvalidTransition {
                from: format!("{:?}", machine.state()),
                event: format!("{action:?} in complete_swap"),
            });
        };

        let result = self
            .perform_mint_swap(
                &wallet,
                seed,
                keyset_id,
                keyset_info,
                keyset_counter,
                &output_amounts,
                &swap.token_proofs,
                &mint_keys,
            )
            .await;
        match result {
            Ok(proofs) => {
                machine.apply(Event::MintSwapSucceeded)?;
                self.finish_complete(&mut machine, &swap, &keyset_id, proofs)
                    .await
            }
            Err(SwapAttemptOutcome::AlreadyClaimed) => {
                machine.apply(Event::MintSwapAlreadyClaimed)?;
                let restored = self
                    .attempt_restore(
                        &wallet,
                        seed,
                        keyset_id,
                        keyset_counter,
                        &output_amounts,
                        &mint_keys,
                    )
                    .await?;
                if restored.is_empty() {
                    let failed = self
                        .storage
                        .fail(&swap.token_hash, swap.user_id, "Token already claimed")
                        .await?;
                    machine.apply(Event::SwapFailed(failed.clone()))?;
                    return Ok(CompleteOutcome::Failed(failed));
                }
                machine.apply(Event::MintRestoreSucceeded)?;
                self.finish_complete(&mut machine, &swap, &keyset_id, restored)
                    .await
            }
            Err(SwapAttemptOutcome::Other(e)) => Err(e),
        }
    }

    /// Persist the proofs and walk the machine to `Completed`.
    async fn finish_complete(
        &self,
        machine: &mut ReceiveSwapMachine,
        swap: &CashuReceiveSwap,
        keyset_id: &KeysetId,
        proofs: Vec<Proof>,
    ) -> Result<CompleteOutcome, ReceiveSwapError> {
        let token_proofs = proofs
            .iter()
            .map(|p| proof_to_token_proof(p, keyset_id))
            .collect::<Vec<_>>();
        let CompleteReceiveSwapResult {
            swap: updated_swap,
            account,
            added_proofs,
        } = self
            .storage
            .complete(&swap.token_hash, swap.user_id, token_proofs)
            .await?;
        machine.apply(Event::SwapCompleted(updated_swap.clone()))?;
        Ok(CompleteOutcome::Completed {
            swap: updated_swap,
            account,
            added_proofs,
        })
    }

    /// Fail a swap. Matches the TS shape: no-op on FAILED, error on
    /// COMPLETED, otherwise call storage.
    pub async fn fail(
        &self,
        swap: &CashuReceiveSwap,
        reason: &str,
    ) -> Result<CashuReceiveSwap, ReceiveSwapError> {
        match &swap.state {
            CashuReceiveSwapState::Failed { .. } => Ok(swap.clone()),
            CashuReceiveSwapState::Completed => Err(ReceiveSwapError::InvalidTransition {
                from: "Completed".into(),
                event: "fail".into(),
            }),
            CashuReceiveSwapState::Pending => Ok(self
                .storage
                .fail(&swap.token_hash, swap.user_id, reason)
                .await?),
        }
    }

    /// One attempt at calling the mint's `/v1/swap`. On
    /// "already-signed"/"already-spent" errors, signals `AlreadyClaimed`
    /// so the caller can attempt restore.
    #[allow(clippy::too_many_arguments)]
    async fn perform_mint_swap(
        &self,
        wallet: &Arc<CashuMintWallet>,
        seed: &[u8; 64],
        keyset_id: KeysetId,
        keyset_info: &KeySetInfo,
        keyset_counter: u32,
        output_amounts: &[u64],
        token_proofs: &[TokenProof],
        keyset_keys: &KeySet,
    ) -> Result<Vec<Proof>, SwapAttemptOutcome> {
        let fee_and_amounts = fee_and_amounts_for_keyset(keyset_info);
        let split = SplitTarget::Values(
            output_amounts
                .iter()
                .copied()
                .map(Amount::from)
                .collect::<Vec<_>>(),
        );
        let total: u64 = output_amounts.iter().sum();
        let pre_mint = PreMintSecrets::from_seed(
            keyset_id,
            keyset_counter,
            seed,
            Amount::from(total),
            &split,
            &fee_and_amounts,
        )
        .map_err(|e| {
            SwapAttemptOutcome::Other(ReceiveSwapError::Mint(CashuProviderError::Protocol(
                format!("pre-mint secrets: {e}"),
            )))
        })?;

        let inputs = token_proofs
            .iter()
            .map(token_proof_to_cdk_proof)
            .collect::<Result<Vec<_>, _>>()
            .map_err(SwapAttemptOutcome::Other)?;
        let blinded_messages = pre_mint.blinded_messages();
        let swap_request = SwapRequest::new(inputs, blinded_messages);

        let response = match wallet.connector().post_swap(swap_request).await {
            Ok(r) => r,
            Err(e) => {
                if is_already_claimed_error(&e) {
                    return Err(SwapAttemptOutcome::AlreadyClaimed);
                }
                return Err(SwapAttemptOutcome::Other(ReceiveSwapError::Mint(
                    CashuProviderError::Protocol(format!("post_swap: {e}")),
                )));
            }
        };

        let proofs = construct_proofs(
            response.signatures,
            pre_mint.rs(),
            pre_mint.secrets(),
            &keyset_keys.keys,
        )
        .map_err(|e| {
            SwapAttemptOutcome::Other(ReceiveSwapError::Mint(CashuProviderError::Protocol(
                format!("construct_proofs: {e}"),
            )))
        })?;
        Ok(proofs)
    }

    async fn attempt_restore(
        &self,
        wallet: &Arc<CashuMintWallet>,
        seed: &[u8; 64],
        keyset_id: KeysetId,
        keyset_counter: u32,
        output_amounts: &[u64],
        keyset_keys: &KeySet,
    ) -> Result<Vec<Proof>, ReceiveSwapError> {
        let len = u32::try_from(output_amounts.len()).map_err(|_| {
            ReceiveSwapError::Mint(CashuProviderError::Protocol(
                "output_amounts too large for u32 counter".into(),
            ))
        })?;
        let end = keyset_counter + len;
        let pre_mint = PreMintSecrets::restore_batch(keyset_id, seed, keyset_counter, end)
            .map_err(|e| {
                ReceiveSwapError::Mint(CashuProviderError::Protocol(format!("restore_batch: {e}")))
            })?;
        let blinded_messages = pre_mint.blinded_messages();
        let restore_request = RestoreRequest {
            outputs: blinded_messages,
        };
        let response = wallet
            .connector()
            .post_restore(restore_request)
            .await
            .map_err(|e| {
                ReceiveSwapError::Mint(CashuProviderError::Protocol(format!("post_restore: {e}")))
            })?;
        if response.signatures.is_empty() {
            return Ok(Vec::new());
        }
        // Match returned outputs to our premint secrets by blinded message.
        // The mint may return a subset (only those it has).
        let matched: Vec<_> = pre_mint
            .secrets
            .iter()
            .filter(|p| response.outputs.contains(&p.blinded_message))
            .collect();
        if matched.is_empty() {
            return Ok(Vec::new());
        }
        let proofs = construct_proofs(
            response.signatures,
            matched.iter().map(|p| p.r.clone()).collect(),
            matched.iter().map(|p| p.secret.clone()).collect(),
            &keyset_keys.keys,
        )
        .map_err(|e| {
            ReceiveSwapError::Mint(CashuProviderError::Protocol(format!(
                "construct_proofs (restore): {e}"
            )))
        })?;
        Ok(proofs)
    }
}

/// Result of [`CashuReceiveSwapService::complete_swap`].
#[derive(Debug, Clone)]
pub enum CompleteOutcome {
    /// Swap completed successfully — proofs were persisted.
    Completed {
        swap: CashuReceiveSwap,
        account: Account,
        added_proofs: Vec<String>,
    },
    /// Swap was already terminal when we tried to complete it.
    AlreadyTerminal(CashuReceiveSwap),
    /// Mint had already signed the outputs and restore yielded nothing —
    /// someone else claimed the token first.
    Failed(CashuReceiveSwap),
}

/// Token already parsed by [`ParsedToken::parse`].
///
/// Owns the raw string + a SHA-256 of it so the storage layer doesn't need
/// to re-encode. The hash is computed at parse time.
#[derive(Debug, Clone)]
pub struct ParsedToken {
    pub raw: String,
    pub mint_url: String,
    pub proofs: Vec<TokenProof>,
    pub memo: Option<String>,
    pub unit: CurrencyUnit,
    /// SHA-256 hex of `raw` (the encoded token string).
    pub hash: String,
}

impl ParsedToken {
    /// Parse a Cashu token string (`cashuA...` V3 or `cashuB...` V4).
    /// Re-encodes to canonical form when computing the hash so two
    /// representations of the same token map to the same row.
    pub async fn parse(
        raw: &str,
        cashu_provider: &Arc<dyn CashuProvider>,
    ) -> Result<Self, ReceiveSwapError> {
        let token = Token::from_str(raw)
            .map_err(|e| ReceiveSwapError::TokenParse(format!("decode token: {e}")))?;
        let mint_url = token
            .mint_url()
            .map_err(|e| ReceiveSwapError::TokenParse(format!("mint URL: {e}")))?;
        let unit = token
            .unit()
            .ok_or_else(|| ReceiveSwapError::TokenParse("missing unit".into()))?;
        // Hash the canonical re-encoded form rather than the raw input — TS
        // does the same (`computeSHA256(encodeToken(token))`).
        let encoded = token.to_string();
        let hash = sha256_hex(&encoded);

        // Fetch keyset infos so we can decode short keyset ids on V3 tokens.
        let mint_url_obj = MintUrl::from_str(&mint_url.to_string())
            .map_err(|e| ReceiveSwapError::Mint(CashuProviderError::InvalidUrl(e.to_string())))?;
        let mint_info = cashu_provider.mint_info(&mint_url_obj).await;
        // mint_info is only needed if the connector is cached; mint_info is
        // a free way to warm it. Ignore failures here (could be reachable
        // mint but slow); the keysets fetch below is the real check.
        let _ = mint_info;

        // We need the keysets to call `token.proofs(&mint_keysets)`. We need
        // the same connector that mint_info used; ask the provider again.
        // Use a stub Account-shaped lookup: we don't have an Account here so
        // we open a fresh connector via the provider's mint_info path. But
        // mint_info is the only public hook. Use an inline HttpClient
        // through CDK directly to fetch /v1/keysets.
        //
        // Workaround: build a small ad-hoc HttpClient. CDK's
        // `cdk::wallet::HttpClient::new` is available for this. We avoid
        // adding a new method to CashuProvider here so the slice 4 trait
        // surface stays narrow.
        let http_client = cdk::wallet::HttpClient::new(mint_url_obj.clone(), None);
        let keyset_response = http_client.get_mint_keysets().await.map_err(|e| {
            ReceiveSwapError::Mint(CashuProviderError::Network(format!(
                "get_mint_keysets: {e}"
            )))
        })?;
        let proofs_cdk = token
            .proofs(&keyset_response.keysets)
            .map_err(|e| ReceiveSwapError::TokenParse(format!("decode proofs: {e}")))?;
        let proofs = proofs_cdk.iter().map(cdk_proof_to_token_proof).collect();

        Ok(Self {
            raw: raw.to_string(),
            mint_url: mint_url.to_string(),
            proofs,
            memo: token.memo().clone(),
            unit,
            hash,
        })
    }
}

#[derive(Debug)]
enum SwapAttemptOutcome {
    AlreadyClaimed,
    Other(ReceiveSwapError),
}

// === Helpers ===

fn currency_from_cashu_unit(unit: &CurrencyUnit) -> Option<Currency> {
    match unit {
        CurrencyUnit::Sat => Some(Currency::Btc),
        CurrencyUnit::Usd => Some(Currency::Usd),
        _ => None,
    }
}

fn unit_for_currency(currency: Currency) -> Unit {
    match currency {
        Currency::Btc => Unit::Sat,
        Currency::Usd | Currency::Usdb => Unit::Cent,
    }
}

fn mint_urls_equal(a: &str, b: &str) -> bool {
    a.trim_end_matches('/') == b.trim_end_matches('/')
}

async fn fetch_keyset_infos(
    wallet: &Arc<CashuMintWallet>,
) -> Result<Vec<KeySetInfo>, ReceiveSwapError> {
    let response = wallet.connector().get_mint_keysets().await.map_err(|e| {
        ReceiveSwapError::Mint(CashuProviderError::Network(format!(
            "get_mint_keysets: {e}"
        )))
    })?;
    Ok(response.keysets)
}

async fn fetch_keyset_keys(
    wallet: &Arc<CashuMintWallet>,
    keyset_id: KeysetId,
) -> Result<KeySet, ReceiveSwapError> {
    wallet
        .connector()
        .get_mint_keyset(keyset_id)
        .await
        .map_err(|e| {
            ReceiveSwapError::Mint(CashuProviderError::Network(format!("get_mint_keyset: {e}")))
        })
}

fn active_keyset_for_unit<'a>(
    keysets: &'a [KeySetInfo],
    unit: &CurrencyUnit,
) -> Option<&'a KeySetInfo> {
    keysets.iter().find(|k| k.active && k.unit == *unit)
}

fn fee_and_amounts_for_keyset(keyset: &KeySetInfo) -> FeeAndAmounts {
    // Provide the standard power-of-two denominations a mint signs. CDK uses
    // 2^0..2^31 by default; cdk-common doesn't expose a constant so we list
    // them here. The fee value is per-proof input fee ppk.
    let amounts: Vec<u64> = (0..32).map(|i| 1u64 << i).collect();
    FeeAndAmounts::from((keyset.input_fee_ppk, amounts))
}

fn compute_fee_for_proofs(proofs: &[TokenProof], keysets: &[KeySetInfo]) -> Amount {
    // Per NUT-02 §3: fee = ceil(sum(input_fee_ppk per proof) / 1000).
    // Proofs reference a keyset by id; the fee is per the keyset that
    // minted them. Unknown keysets default to 0.
    let total_ppk: u64 = proofs
        .iter()
        .map(|p| {
            keysets
                .iter()
                .find(|k| k.id.to_string() == p.id)
                .map_or(0, |k| k.input_fee_ppk)
        })
        .sum();
    let fee = total_ppk.div_ceil(1000);
    Amount::from(fee)
}

fn split_amounts(
    amount: u64,
    fee_and_amounts: &FeeAndAmounts,
) -> Result<Vec<u64>, ReceiveSwapError> {
    let parts = Amount::from(amount).split(fee_and_amounts).map_err(|e| {
        ReceiveSwapError::Mint(CashuProviderError::Protocol(format!("amount split: {e}")))
    })?;
    Ok(parts.into_iter().map(u64::from).collect())
}

fn token_proof_to_cdk_proof(proof: &TokenProof) -> Result<Proof, ReceiveSwapError> {
    use cdk::nuts::PublicKey;
    use cdk::secret::Secret;
    let keyset_id = KeysetId::from_str(&proof.id)
        .map_err(|e| ReceiveSwapError::TokenParse(format!("proof keyset id {}: {e}", proof.id)))?;
    let secret = Secret::from_str(&proof.secret)
        .map_err(|e| ReceiveSwapError::TokenParse(format!("proof secret: {e}")))?;
    let c = PublicKey::from_hex(&proof.c)
        .map_err(|e| ReceiveSwapError::TokenParse(format!("proof C: {e}")))?;
    Ok(Proof {
        amount: Amount::from(proof.amount),
        keyset_id,
        secret,
        c,
        witness: None,
        dleq: None,
    })
}

fn proof_to_token_proof(proof: &Proof, _keyset_id: &KeysetId) -> TokenProof {
    TokenProof {
        id: proof.keyset_id.to_string(),
        amount: u64::from(proof.amount),
        secret: proof.secret.to_string(),
        c: proof.c.to_hex(),
        dleq: None,
        witness: None,
    }
}

fn cdk_proof_to_token_proof(proof: &Proof) -> TokenProof {
    TokenProof {
        id: proof.keyset_id.to_string(),
        amount: u64::from(proof.amount),
        secret: proof.secret.to_string(),
        c: proof.c.to_hex(),
        dleq: None,
        witness: None,
    }
}

fn is_already_claimed_error(err: &cdk::error::Error) -> bool {
    // CDK's wallet `Error` enum bubbles mint-side errors through several
    // variants. We need to catch both "token already spent" (11001) and
    // "outputs already signed" (10002, a.k.a. BlindedMessageAlreadySigned).
    // We pattern-match on the public Error variants where possible and fall
    // back to ErrorCode parsing on the wrapped ErrorResponse.
    if matches!(
        err,
        cdk::error::Error::TokenAlreadySpent | cdk::error::Error::BlindedMessageAlreadySigned
    ) {
        return true;
    }
    let s = err.to_string().to_lowercase();
    if s.contains("already spent")
        || s.contains("already been signed")
        || s.contains("already signed")
    {
        return true;
    }
    // Look at the response code on ErrorResponse-wrapped variants.
    let code_str = format!("{err:?}");
    if code_str.contains("TokenAlreadySpent")
        || code_str.contains("BlindedMessageAlreadySigned")
        || code_str.contains("11001")
        || code_str.contains("10002")
    {
        return true;
    }
    // Final check: if it's an HTTP error carrying an ErrorResponse, the
    // response's `code` field will be one of those numeric codes. The
    // public ErrorCode enum has them, but Error wraps the response in a
    // private variant; the Debug-format string is the cheapest surface.
    let _ = ErrorCode::TokenAlreadySpent;
    false
}

fn sha256_hex(data: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    // SHA-256 is the wire-correct hash (TS uses computeSHA256). We pull in
    // `cdk::dhke` for it implicitly; reach for `sha2` directly to avoid the
    // round trip.
    //
    // Note: cashu/dhke uses sha2 internally but doesn't expose a public
    // hash helper. Use the sha2 crate from the cashu dep tree.
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(data.as_bytes());
    let result = hasher.finalize();
    // Silence the unused-import lint on DefaultHasher (kept above for
    // discoverability if someone needs a non-crypto hash).
    let mut dh = DefaultHasher::new();
    "".hash(&mut dh);
    let _ = dh.finish();
    hex::encode(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use agicash_domain::{AccountId, AccountPurpose, AccountState, AccountType};
    use async_trait::async_trait;
    use chrono::Utc;
    use serde_json::json;

    fn stub_account(currency: Currency, mint_url: &str) -> Account {
        Account {
            id: AccountId::new(),
            created_at: Utc::now(),
            user_id: UserId::new(),
            name: "Mint".into(),
            account_type: AccountType::Cashu,
            purpose: AccountPurpose::Transactional,
            currency,
            details: json!({ "mint_url": mint_url, "keyset_counters": {} }),
            version: 0,
            state: AccountState::Active,
            expires_at: None,
        }
    }

    fn stub_token(mint_url: &str, unit: CurrencyUnit) -> ParsedToken {
        ParsedToken {
            raw: "cashuA...".into(),
            mint_url: mint_url.into(),
            proofs: vec![TokenProof {
                id: "00abcdef".into(),
                amount: 64,
                secret: "secret1".into(),
                c: "C1".into(),
                dleq: None,
                witness: None,
            }],
            memo: None,
            unit,
            hash: "h".into(),
        }
    }

    /// Storage that never gets called — we exercise the pre-storage
    /// validation paths only.
    struct UnusedStorage;

    #[async_trait]
    impl CashuReceiveSwapStorage for UnusedStorage {
        async fn create(
            &self,
            _input: CreateReceiveSwap,
        ) -> Result<CreateReceiveSwapResult, super::super::storage::ReceiveSwapStorageError>
        {
            unreachable!("storage.create should not be called in pre-storage validation tests")
        }
        async fn complete(
            &self,
            _token_hash: &str,
            _user_id: UserId,
            _proofs: Vec<TokenProof>,
        ) -> Result<CompleteReceiveSwapResult, super::super::storage::ReceiveSwapStorageError>
        {
            unreachable!()
        }
        async fn fail(
            &self,
            _token_hash: &str,
            _user_id: UserId,
            _reason: &str,
        ) -> Result<CashuReceiveSwap, super::super::storage::ReceiveSwapStorageError> {
            unreachable!()
        }
    }

    /// Cashu provider stub. `wallet_for_account` is never reached because
    /// the mint-mismatch / currency-mismatch checks fail first.
    struct UnusedProvider;

    #[async_trait]
    impl CashuProvider for UnusedProvider {
        async fn wallet_for_account(
            &self,
            _account: &Account,
        ) -> Result<Arc<CashuMintWallet>, CashuProviderError> {
            unreachable!()
        }
        async fn mint_info(
            &self,
            _mint_url: &MintUrl,
        ) -> Result<cdk::nuts::MintInfo, CashuProviderError> {
            unreachable!()
        }
    }

    fn make_service() -> CashuReceiveSwapService {
        let storage: Arc<dyn CashuReceiveSwapStorage> = Arc::new(UnusedStorage);
        let provider: Arc<dyn CashuProvider> = Arc::new(UnusedProvider);
        CashuReceiveSwapService::new(storage, provider)
    }

    #[tokio::test]
    async fn create_rejects_mint_url_mismatch() {
        let svc = make_service();
        let account = stub_account(Currency::Btc, "https://mint-a.example");
        let token = stub_token("https://mint-b.example", CurrencyUnit::Sat);
        let err = svc
            .create(UserId::new(), &token, &account, None)
            .await
            .unwrap_err();
        assert!(
            matches!(err, ReceiveSwapError::MintMismatch { .. }),
            "got: {err:?}"
        );
    }

    #[tokio::test]
    async fn create_rejects_currency_mismatch_via_unit() {
        let svc = make_service();
        let account = stub_account(Currency::Btc, "https://mint.example");
        let token = stub_token("https://mint.example", CurrencyUnit::Usd);
        let err = svc
            .create(UserId::new(), &token, &account, None)
            .await
            .unwrap_err();
        assert!(
            matches!(err, ReceiveSwapError::CurrencyMismatch { .. }),
            "got: {err:?}"
        );
    }

    #[tokio::test]
    async fn create_rejects_unknown_cashu_unit() {
        let svc = make_service();
        let account = stub_account(Currency::Btc, "https://mint.example");
        let token = stub_token("https://mint.example", CurrencyUnit::Custom("xyz".into()));
        let err = svc
            .create(UserId::new(), &token, &account, None)
            .await
            .unwrap_err();
        assert!(
            matches!(err, ReceiveSwapError::CurrencyMismatch { .. }),
            "got: {err:?}"
        );
    }

    #[tokio::test]
    async fn create_rejects_missing_mint_url_on_account() {
        let svc = make_service();
        let mut account = stub_account(Currency::Btc, "https://mint.example");
        account.details = json!({});
        let token = stub_token("https://mint.example", CurrencyUnit::Sat);
        let err = svc
            .create(UserId::new(), &token, &account, None)
            .await
            .unwrap_err();
        assert!(matches!(err, ReceiveSwapError::Mint(_)), "got: {err:?}");
    }

    #[tokio::test]
    async fn fail_is_noop_on_already_failed_swap() {
        use chrono::Utc;
        let svc = make_service();
        let swap = CashuReceiveSwap {
            token_hash: "h".into(),
            token_proofs: vec![],
            token_description: None,
            user_id: UserId::new(),
            account_id: AccountId::new(),
            input_amount: Money::new(Decimal::from(0u64), Currency::Btc, Unit::Sat),
            amount_received: Money::new(Decimal::from(0u64), Currency::Btc, Unit::Sat),
            fee_amount: Money::new(Decimal::from(0u64), Currency::Btc, Unit::Sat),
            keyset_id: "k".into(),
            keyset_counter: 0,
            output_amounts: vec![],
            transaction_id: Uuid::new_v4(),
            created_at: Utc::now(),
            version: 0,
            state: CashuReceiveSwapState::Failed {
                failure_reason: "x".into(),
            },
        };
        let out = svc.fail(&swap, "again").await.unwrap();
        assert!(matches!(out.state, CashuReceiveSwapState::Failed { .. }));
    }

    #[tokio::test]
    async fn fail_errors_on_completed_swap() {
        use chrono::Utc;
        let svc = make_service();
        let swap = CashuReceiveSwap {
            token_hash: "h".into(),
            token_proofs: vec![],
            token_description: None,
            user_id: UserId::new(),
            account_id: AccountId::new(),
            input_amount: Money::new(Decimal::from(0u64), Currency::Btc, Unit::Sat),
            amount_received: Money::new(Decimal::from(0u64), Currency::Btc, Unit::Sat),
            fee_amount: Money::new(Decimal::from(0u64), Currency::Btc, Unit::Sat),
            keyset_id: "k".into(),
            keyset_counter: 0,
            output_amounts: vec![],
            transaction_id: Uuid::new_v4(),
            created_at: Utc::now(),
            version: 0,
            state: CashuReceiveSwapState::Completed,
        };
        let err = svc.fail(&swap, "x").await.unwrap_err();
        assert!(
            matches!(err, ReceiveSwapError::InvalidTransition { .. }),
            "got: {err:?}"
        );
    }

    #[test]
    fn currency_mapping_round_trips() {
        assert_eq!(
            currency_from_cashu_unit(&CurrencyUnit::Sat),
            Some(Currency::Btc)
        );
        assert_eq!(
            currency_from_cashu_unit(&CurrencyUnit::Usd),
            Some(Currency::Usd)
        );
        assert_eq!(currency_from_cashu_unit(&CurrencyUnit::Msat), None);
    }

    #[test]
    fn mint_urls_equal_normalizes_trailing_slash() {
        assert!(mint_urls_equal("https://a", "https://a/"));
        assert!(mint_urls_equal("https://a/", "https://a"));
        assert!(!mint_urls_equal("https://a", "https://b"));
    }

    #[test]
    fn sha256_hex_matches_known_vector() {
        // Known vector: sha256("abc") = ba7816bf...
        let h = sha256_hex("abc");
        assert_eq!(
            h,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
