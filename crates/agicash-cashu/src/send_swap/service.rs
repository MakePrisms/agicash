//! Orchestrator that drives a [`SendSwapMachine`] forward by performing the
//! I/O for each [`Action`] against the CDK [`CashuProvider`] +
//! [`CashuSendSwapStorage`].
//!
//! Mirrors `app/features/send/cashu-send-swap-service.ts` — `get_quote`,
//! `create`, `swap_for_proofs_to_send`, `complete`, `fail` keep the TS
//! shape; the inner CDK call replaces TS's `wallet.ops.send(...).asCustom(...).run()`.
//!
//! Slice 6 implements the sender-pays-fee mode only (TS's
//! `senderPaysFee=true` branch). Receiver-pays-fee, reverse, and
//! receiver-claim watching are deferred to future slices.

use super::error::SendSwapError;
use super::state::{Event, MachineState, SendSwapMachine};
use super::storage::{
    CashuSendSwapStorage, CommitProofsToSend, CreateSendSwap, CreateSendSwapResult, ProofWithId,
};
use super::types::{CashuSendSwap, CashuSendSwapState, OutputAmounts};
use crate::receive_swap::TokenProof;
use agicash_domain::{Account, Currency};
use agicash_money::{Money, Unit};
use agicash_traits::{CashuMintWallet, CashuProvider, CashuProviderError};
use cdk::amount::{FeeAndAmounts, SplitTarget};
use cdk::dhke::construct_proofs;
use cdk::mint_url::MintUrl;
use cdk::nuts::nut02::Id as KeysetId;
use cdk::nuts::{
    CurrencyUnit, KeySet, KeySetInfo, PreMintSecrets, Proof, RestoreRequest, SwapRequest, Token,
};
// `MintConnector` trait is brought into scope so its `post_swap` /
// `post_restore` / `get_mint_keysets` methods are callable on the dyn-Arc
// returned by `wallet.connector()`. The compiler reports it unused because
// the dyn-Arc auto-derefs to its trait methods, but removing it breaks
// compilation under stricter trait-resolution settings.
#[allow(unused_imports)]
use cdk::wallet::MintConnector;
use cdk::Amount;
// Re-export needed for tests; otherwise unused
#[cfg(test)]
use crate::send_swap::storage::SendSwapStorageError;
use rust_decimal::Decimal;
use sha2::{Digest, Sha256};
use std::str::FromStr;
use std::sync::Arc;

/// Service that orchestrates send-swap creation and the input swap.
///
/// Holds an [`Arc`] over the storage + provider traits so it can live behind
/// `Arc<Self>` in the CLI composition root without cloning callbacks.
#[derive(Clone)]
pub struct CashuSendSwapService {
    storage: Arc<dyn CashuSendSwapStorage>,
    cashu_provider: Arc<dyn CashuProvider>,
}

impl std::fmt::Debug for CashuSendSwapService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CashuSendSwapService")
            .finish_non_exhaustive()
    }
}

impl CashuSendSwapService {
    pub fn new(
        storage: Arc<dyn CashuSendSwapStorage>,
        cashu_provider: Arc<dyn CashuProvider>,
    ) -> Self {
        Self {
            storage,
            cashu_provider,
        }
    }

    /// Compute fees + proof selection for a hypothetical send. Does not
    /// persist. Mirrors TS `CashuSendSwapService.getQuote`.
    pub async fn get_quote(
        &self,
        account: &Account,
        proofs: &[ProofWithId],
        amount: Money,
    ) -> Result<SendQuote, SendSwapError> {
        ensure_currency_match(account, &amount)?;
        let amount_number = amount_as_u64(&amount)?;
        let prepared = self
            .prepare_proofs_and_fee(account, proofs, amount_number)
            .await?;
        let unit = unit_for_currency(account.currency);
        let to_money = |n: u64| Money::new(Decimal::from(n), account.currency, unit);
        let amount_to_send = amount_number + prepared.cashu_receive_fee;
        let total_amount = amount_to_send + prepared.cashu_send_fee;
        Ok(SendQuote {
            amount_requested: amount,
            amount_to_send: to_money(amount_to_send),
            total_amount: to_money(total_amount),
            total_fee: to_money(prepared.cashu_receive_fee + prepared.cashu_send_fee),
            cashu_receive_fee: to_money(prepared.cashu_receive_fee),
            cashu_send_fee: to_money(prepared.cashu_send_fee),
        })
    }

    /// Persist a new send swap. Returns the resulting state (DRAFT if input
    /// swap required, PENDING otherwise) along with the updated account.
    pub async fn create(
        &self,
        account: &Account,
        proofs: &[ProofWithId],
        amount: Money,
    ) -> Result<CreateSendSwapResult, SendSwapError> {
        ensure_currency_match(account, &amount)?;
        let amount_number = amount_as_u64(&amount)?;

        let prepared = self
            .prepare_proofs_and_fee(account, proofs, amount_number)
            .await?;
        let unit = unit_for_currency(account.currency);
        let to_money = |n: u64| Money::new(Decimal::from(n), account.currency, unit);
        let amount_to_send = amount_number + prepared.cashu_receive_fee;
        let input_total = sum_token_proofs(&prepared.send);

        let mint_url_str = account_mint_url(account)?;
        let mint_url = MintUrl::from_str(&mint_url_str)
            .map_err(|e| SendSwapError::Mint(CashuProviderError::InvalidUrl(e.to_string())))?;

        let mut token_hash: Option<String> = None;
        let mut keyset_id: Option<String> = None;
        let mut output_amounts: Option<OutputAmounts> = None;

        if input_total == amount_to_send {
            // Exact-proofs path: the input proofs ARE the proofs-to-send.
            // Compute the wire-form token hash now so the storage row can
            // index by it.
            let cdk_proofs = prepared
                .send
                .iter()
                .map(|p| token_proof_to_cdk_proof(&p.proof))
                .collect::<Result<Vec<_>, _>>()?;
            let unit_for_token = cashu_unit_for_currency(account.currency);
            let token = Token::new(mint_url.clone(), cdk_proofs, None, unit_for_token);
            token_hash = Some(sha256_hex(&token.to_string()));
        } else {
            // Swap path: pick the active keyset, compute output splits.
            let wallet = self.cashu_provider.wallet_for_account(account).await?;
            let keysets = fetch_keyset_infos(&wallet).await?;
            let cashu_unit = cashu_unit_for_currency(account.currency);
            let active = active_keyset_for_unit(&keysets, &cashu_unit).ok_or_else(|| {
                SendSwapError::Mint(CashuProviderError::Protocol(format!(
                    "no active keyset for unit {cashu_unit}"
                )))
            })?;
            let fee_and_amounts = fee_and_amounts_for_keyset(active);
            let amount_to_keep = input_total
                .checked_sub(amount_to_send + prepared.cashu_send_fee)
                .ok_or(SendSwapError::AmountTooSmall)?;
            let send_split = split_amounts(amount_to_send, &fee_and_amounts)?;
            let change_split = split_amounts(amount_to_keep, &fee_and_amounts)?;
            keyset_id = Some(active.id.to_string());
            output_amounts = Some(OutputAmounts {
                send: send_split,
                change: change_split,
            });
        }

        let input = CreateSendSwap {
            account_id: account.id,
            user_id: account.user_id,
            token_mint_url: mint_url_str,
            amount_requested: amount,
            amount_to_send: to_money(amount_to_send),
            total_amount: to_money(amount_to_send + prepared.cashu_send_fee),
            cashu_send_fee: to_money(prepared.cashu_send_fee),
            cashu_receive_fee: to_money(prepared.cashu_receive_fee),
            input_proofs: prepared.send.iter().map(|p| p.proof.clone()).collect(),
            input_amount: to_money(input_total),
            input_proof_ids: prepared.send.iter().map(|p| p.id).collect(),
            token_hash,
            keyset_id,
            output_amounts,
        };

        Ok(self.storage.create(input).await?)
    }

    /// Drive a DRAFT swap to PENDING by performing the mint swap and
    /// committing the resulting send + change proofs.
    /// Idempotent: returns Ok on already-PENDING/COMPLETED swaps.
    #[allow(clippy::too_many_lines)]
    pub async fn swap_for_proofs_to_send(
        &self,
        account: &Account,
        swap: CashuSendSwap,
        seed: &[u8; 64],
    ) -> Result<CashuSendSwap, SendSwapError> {
        let mut machine = SendSwapMachine::from_existing(swap.clone());
        if matches!(
            machine.state(),
            MachineState::Pending(_) | MachineState::Completed(_) | MachineState::Reversed(_)
        ) {
            return Ok(swap);
        }

        let MachineState::Draft(_) = machine.state() else {
            return Err(SendSwapError::InvalidTransition {
                from: format!("{:?}", machine.state()),
                event: "swap_for_proofs_to_send".into(),
            });
        };

        let wallet = self.cashu_provider.wallet_for_account(account).await?;
        let keyset_id_str = swap.keyset_id.clone().ok_or_else(|| {
            SendSwapError::Mint(CashuProviderError::Protocol(
                "draft swap missing keyset_id".into(),
            ))
        })?;
        let keyset_counter = swap.keyset_counter.ok_or_else(|| {
            SendSwapError::Mint(CashuProviderError::Protocol(
                "draft swap missing keyset_counter".into(),
            ))
        })?;
        let output_amounts = swap.output_amounts.clone().ok_or_else(|| {
            SendSwapError::Mint(CashuProviderError::Protocol(
                "draft swap missing output_amounts".into(),
            ))
        })?;
        let keyset_id = KeysetId::from_str(&keyset_id_str).map_err(|e| {
            SendSwapError::Mint(CashuProviderError::Protocol(format!(
                "invalid keyset id {keyset_id_str}: {e}"
            )))
        })?;

        let keysets = fetch_keyset_infos(&wallet).await?;
        let keyset_info = keysets.iter().find(|k| k.id == keyset_id).ok_or_else(|| {
            SendSwapError::Mint(CashuProviderError::Protocol(format!(
                "keyset {keyset_id_str} not found on mint"
            )))
        })?;
        let mint_keys = fetch_keyset_keys(&wallet, keyset_id).await?;

        let send_total: u64 = output_amounts.send.iter().sum();
        let change_total: u64 = output_amounts.change.iter().sum();

        let result = self
            .perform_mint_swap(
                &wallet,
                seed,
                keyset_id,
                keyset_info,
                keyset_counter,
                &output_amounts.send,
                &output_amounts.change,
                &swap.input_proofs,
                &mint_keys,
                send_total,
                change_total,
            )
            .await;

        let (send_proofs, change_proofs) = match result {
            Ok((s, c)) => {
                machine.apply(Event::MintSwapSucceeded {
                    proofs_to_send: token_proofs(&s),
                    change_proofs: token_proofs(&c),
                })?;
                (s, c)
            }
            Err(SwapAttemptOutcome::AlreadyExecuted) => {
                machine.apply(Event::MintSwapAlreadyExecuted)?;
                let restored = self
                    .attempt_restore(
                        &wallet,
                        seed,
                        keyset_id,
                        keyset_counter,
                        &output_amounts.send,
                        &output_amounts.change,
                        &mint_keys,
                    )
                    .await?;
                if restored.0.is_empty() {
                    let failed = self
                        .storage
                        .fail(swap.id, "Mint swap already executed")
                        .await?;
                    machine.apply(Event::SwapFailed(failed.clone()))?;
                    return Ok(failed);
                }
                machine.apply(Event::MintRestoreSucceeded {
                    proofs_to_send: token_proofs(&restored.0),
                    change_proofs: token_proofs(&restored.1),
                })?;
                restored
            }
            Err(SwapAttemptOutcome::Other(e)) => return Err(e),
        };

        // Compute wire token hash over send proofs only.
        let mint_url_str = account_mint_url(account)?;
        let mint_url = MintUrl::from_str(&mint_url_str)
            .map_err(|e| SendSwapError::Mint(CashuProviderError::InvalidUrl(e.to_string())))?;
        let unit = cashu_unit_for_currency(account.currency);
        let token = Token::new(mint_url, send_proofs.clone(), None, unit);
        let token_hash = sha256_hex(&token.to_string());

        let commit = CommitProofsToSend {
            swap_id: swap.id,
            token_hash,
            proofs_to_send: token_proofs(&send_proofs),
            change_proofs: token_proofs(&change_proofs),
        };
        let updated = self.storage.commit_proofs_to_send(commit).await?;
        machine.apply(Event::ProofsCommitted(updated.clone()))?;
        Ok(updated)
    }

    /// PENDING → COMPLETED. Match TS: no-op on COMPLETED, error on
    /// non-PENDING.
    pub async fn complete(&self, swap: &CashuSendSwap) -> Result<CashuSendSwap, SendSwapError> {
        match &swap.state {
            CashuSendSwapState::Completed { .. } => Ok(swap.clone()),
            CashuSendSwapState::Pending { .. } => Ok(self.storage.complete(swap.id).await?),
            other => Err(SendSwapError::InvalidTransition {
                from: format!("{other:?}"),
                event: "complete".into(),
            }),
        }
    }

    /// DRAFT → FAILED with `reason`. Match TS: no-op on FAILED, error on
    /// non-DRAFT.
    pub async fn fail(
        &self,
        swap: &CashuSendSwap,
        reason: &str,
    ) -> Result<CashuSendSwap, SendSwapError> {
        match &swap.state {
            CashuSendSwapState::Failed { .. } => Ok(swap.clone()),
            CashuSendSwapState::Draft => Ok(self.storage.fail(swap.id, reason).await?),
            other => Err(SendSwapError::InvalidTransition {
                from: format!("{other:?}"),
                event: "fail".into(),
            }),
        }
    }

    /// Mirror TS `prepareProofsAndFee` — sender-pays-fee branch.
    ///
    /// Two-pass selection:
    /// 1. Greedy-select proofs covering `requested + fee_for_selected`. If
    ///    the selected total equals that sum, no swap is needed and the
    ///    receive-fee equals the input fee for the selected proofs.
    /// 2. Otherwise, estimate the receive-fee one would pay if claiming
    ///    `requested + estimated_receive_fee` with the active keyset (cost
    ///    of one input proof) and re-select for that larger amount; the
    ///    delta becomes `cashu_send_fee`.
    ///
    /// This matches the TS branch when `proofAmountSelected > amountToSend`.
    /// We don't model the pathological `proofAmountSelected < amountToSend`
    /// branch — `select_send_proofs` returns `InsufficientBalance` directly
    /// rather than reaching this method with a deficient set.
    async fn prepare_proofs_and_fee(
        &self,
        account: &Account,
        proofs: &[ProofWithId],
        requested_amount: u64,
    ) -> Result<PreparedSelection, SendSwapError> {
        // Reject zero-amount sends pre-quote. Cashu mints publish a
        // `min_amount` in their NUT-05/NUT-04 settings; nothing useful
        // can be sent at zero. Without this guard, `select_send_proofs`
        // short-circuits to `Ok(empty)` and `create()` walks the
        // exact-proofs path producing a valid-looking but empty token —
        // silently shipping a worthless string to the user. The TS web
        // app (`app/features/send/send-input.tsx`) already disables the
        // Continue button when `inputValue.isZero()`; this matches that
        // contract at the service layer for non-UI callers (CLI, FFI).
        if requested_amount == 0 {
            return Err(SendSwapError::AmountTooSmall);
        }
        let total_available = sum_proofs(proofs);
        if total_available < requested_amount {
            return Err(SendSwapError::InsufficientBalance {
                needed: requested_amount.to_string(),
                have: total_available.to_string(),
            });
        }

        // We need keyset info to compute the per-proof input fee + the
        // single-proof estimate for the receive side.
        let wallet = self.cashu_provider.wallet_for_account(account).await?;
        let keysets = fetch_keyset_infos(&wallet).await?;
        let cashu_unit = cashu_unit_for_currency(account.currency);
        let active = active_keyset_for_unit(&keysets, &cashu_unit).ok_or_else(|| {
            SendSwapError::Mint(CashuProviderError::Protocol(format!(
                "no active keyset for unit {cashu_unit}"
            )))
        })?;
        let active_input_fee_ppk = active.input_fee_ppk;

        // Pass 1.
        let send = select_send_proofs(proofs, requested_amount, &keysets)?;
        let fee_for_selected = compute_fee_for_proofs(&send, &keysets);
        let send_total = sum_proofs(&send);
        let amount_to_send = requested_amount + fee_for_selected;

        if send_total == amount_to_send {
            return Ok(PreparedSelection {
                send,
                cashu_send_fee: 0,
                cashu_receive_fee: fee_for_selected,
            });
        }

        // Pass 2 — re-select for `requested + estimated_receive_fee`.
        // Estimate matches TS's `getFeesEstimateToReceiveAtLeast`: assume
        // one input proof at the active keyset's per-proof fee.
        let estimated_receive_fee = active_input_fee_ppk.div_ceil(1000);
        let target = requested_amount + estimated_receive_fee;
        let send = select_send_proofs(proofs, target, &keysets)?;
        let send_total = sum_proofs(&send);
        let cashu_send_fee = compute_fee_for_proofs(&send, &keysets);
        let cashu_receive_fee = estimated_receive_fee;

        if send_total < target + cashu_send_fee {
            return Err(SendSwapError::InsufficientBalance {
                needed: (target + cashu_send_fee).to_string(),
                have: send_total.to_string(),
            });
        }
        if requested_amount == 0 {
            return Err(SendSwapError::AmountTooSmall);
        }
        Ok(PreparedSelection {
            send,
            cashu_send_fee,
            cashu_receive_fee,
        })
    }

    #[allow(clippy::too_many_arguments, clippy::too_many_lines)]
    async fn perform_mint_swap(
        &self,
        wallet: &Arc<CashuMintWallet>,
        seed: &[u8; 64],
        keyset_id: KeysetId,
        keyset_info: &KeySetInfo,
        keyset_counter: u32,
        send_amounts: &[u64],
        change_amounts: &[u64],
        input_proofs: &[TokenProof],
        keyset_keys: &KeySet,
        send_total: u64,
        change_total: u64,
    ) -> Result<(Vec<Proof>, Vec<Proof>), SwapAttemptOutcome> {
        let fee_and_amounts = fee_and_amounts_for_keyset(keyset_info);
        let send_split = SplitTarget::Values(
            send_amounts
                .iter()
                .copied()
                .map(Amount::from)
                .collect::<Vec<_>>(),
        );
        let change_split = SplitTarget::Values(
            change_amounts
                .iter()
                .copied()
                .map(Amount::from)
                .collect::<Vec<_>>(),
        );

        let send_pre_mint = PreMintSecrets::from_seed(
            keyset_id,
            keyset_counter,
            seed,
            Amount::from(send_total),
            &send_split,
            &fee_and_amounts,
        )
        .map_err(|e| {
            SwapAttemptOutcome::Other(SendSwapError::Mint(CashuProviderError::Protocol(format!(
                "pre-mint secrets (send): {e}"
            ))))
        })?;
        let send_count_u32 = u32::try_from(send_amounts.len()).map_err(|_| {
            SwapAttemptOutcome::Other(SendSwapError::Mint(CashuProviderError::Protocol(
                "send output count overflows u32".into(),
            )))
        })?;
        let change_counter = keyset_counter + send_count_u32;
        let change_pre_mint = PreMintSecrets::from_seed(
            keyset_id,
            change_counter,
            seed,
            Amount::from(change_total),
            &change_split,
            &fee_and_amounts,
        )
        .map_err(|e| {
            SwapAttemptOutcome::Other(SendSwapError::Mint(CashuProviderError::Protocol(format!(
                "pre-mint secrets (change): {e}"
            ))))
        })?;

        let inputs = input_proofs
            .iter()
            .map(token_proof_to_cdk_proof)
            .collect::<Result<Vec<_>, _>>()
            .map_err(SwapAttemptOutcome::Other)?;
        let mut blinded_messages = send_pre_mint.blinded_messages();
        blinded_messages.extend(change_pre_mint.blinded_messages());
        let swap_request = SwapRequest::new(inputs, blinded_messages);

        let response = match wallet.connector().post_swap(swap_request).await {
            Ok(r) => r,
            Err(e) => {
                if is_already_executed_error(&e) {
                    return Err(SwapAttemptOutcome::AlreadyExecuted);
                }
                return Err(SwapAttemptOutcome::Other(SendSwapError::Mint(
                    CashuProviderError::Protocol(format!("post_swap: {e}")),
                )));
            }
        };

        let send_count = send_pre_mint.secrets.len();
        let (send_sigs, change_sigs) = response.signatures.split_at(send_count);

        // NUT-12: verify each batch of blind signatures against the
        // outgoing blinded messages BEFORE unblinding. `construct_proofs`
        // records but never checks the DLEQ; without this a malicious
        // mint could sign with a key it doesn't commit to.
        crate::dleq::verify_blind_signatures(
            send_sigs,
            &send_pre_mint.blinded_messages(),
            keyset_keys,
        )
        .map_err(|e| SwapAttemptOutcome::Other(SendSwapError::DleqVerificationFailed(e)))?;
        crate::dleq::verify_blind_signatures(
            change_sigs,
            &change_pre_mint.blinded_messages(),
            keyset_keys,
        )
        .map_err(|e| SwapAttemptOutcome::Other(SendSwapError::DleqVerificationFailed(e)))?;

        let send_proofs = construct_proofs(
            send_sigs.to_vec(),
            send_pre_mint.rs(),
            send_pre_mint.secrets(),
            &keyset_keys.keys,
        )
        .map_err(|e| {
            SwapAttemptOutcome::Other(SendSwapError::Mint(CashuProviderError::Protocol(format!(
                "construct_proofs (send): {e}"
            ))))
        })?;
        let change_proofs = construct_proofs(
            change_sigs.to_vec(),
            change_pre_mint.rs(),
            change_pre_mint.secrets(),
            &keyset_keys.keys,
        )
        .map_err(|e| {
            SwapAttemptOutcome::Other(SendSwapError::Mint(CashuProviderError::Protocol(format!(
                "construct_proofs (change): {e}"
            ))))
        })?;
        Ok((send_proofs, change_proofs))
    }

    #[allow(clippy::too_many_arguments)]
    async fn attempt_restore(
        &self,
        wallet: &Arc<CashuMintWallet>,
        seed: &[u8; 64],
        keyset_id: KeysetId,
        keyset_counter: u32,
        send_amounts: &[u64],
        change_amounts: &[u64],
        keyset_keys: &KeySet,
    ) -> Result<(Vec<Proof>, Vec<Proof>), SendSwapError> {
        let total_outputs =
            u32::try_from(send_amounts.len() + change_amounts.len()).map_err(|_| {
                SendSwapError::Mint(CashuProviderError::Protocol(
                    "output count too large for u32".into(),
                ))
            })?;
        let end = keyset_counter + total_outputs;
        let pre_mint = PreMintSecrets::restore_batch(keyset_id, seed, keyset_counter, end)
            .map_err(|e| {
                SendSwapError::Mint(CashuProviderError::Protocol(format!("restore_batch: {e}")))
            })?;
        let blinded_messages = pre_mint.blinded_messages();
        let response = wallet
            .connector()
            .post_restore(RestoreRequest {
                outputs: blinded_messages,
            })
            .await
            .map_err(|e| {
                SendSwapError::Mint(CashuProviderError::Protocol(format!("post_restore: {e}")))
            })?;
        if response.signatures.is_empty() {
            return Ok((Vec::new(), Vec::new()));
        }

        let matched: Vec<_> = pre_mint
            .secrets
            .iter()
            .filter(|p| response.outputs.contains(&p.blinded_message))
            .collect();
        if matched.is_empty() {
            return Ok((Vec::new(), Vec::new()));
        }
        let proofs = construct_proofs(
            response.signatures,
            matched.iter().map(|p| p.r.clone()).collect(),
            matched.iter().map(|p| p.secret.clone()).collect(),
            &keyset_keys.keys,
        )
        .map_err(|e| {
            SendSwapError::Mint(CashuProviderError::Protocol(format!(
                "construct_proofs (restore): {e}"
            )))
        })?;

        // Split restored proofs into send vs change by amount sequence.
        // The restore preserves order (send first, then change) per our
        // pre_mint construction. If the mint returned a subset, fall back
        // to all-as-send and let the caller treat it as a partial restore.
        let send_count = send_amounts.len().min(proofs.len());
        let send_part = proofs[..send_count].to_vec();
        let change_part = proofs[send_count..].to_vec();
        Ok((send_part, change_part))
    }
}

/// Result of [`CashuSendSwapService::get_quote`].
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct SendQuote {
    pub amount_requested: Money,
    pub amount_to_send: Money,
    pub total_amount: Money,
    pub total_fee: Money,
    pub cashu_receive_fee: Money,
    pub cashu_send_fee: Money,
}

#[derive(Debug)]
struct PreparedSelection {
    send: Vec<ProofWithId>,
    cashu_send_fee: u64,
    cashu_receive_fee: u64,
}

#[derive(Debug)]
enum SwapAttemptOutcome {
    AlreadyExecuted,
    Other(SendSwapError),
}

// === Helpers ===

fn ensure_currency_match(account: &Account, amount: &Money) -> Result<(), SendSwapError> {
    if account.currency != amount.currency() {
        return Err(SendSwapError::CurrencyMismatch {
            account: account.currency.to_string(),
            request: amount.currency().to_string(),
        });
    }
    Ok(())
}

fn amount_as_u64(money: &Money) -> Result<u64, SendSwapError> {
    use rust_decimal::prelude::ToPrimitive;
    let unit = unit_for_currency(money.currency());
    let in_unit = money
        .to_unit(unit)
        .map_err(|e| SendSwapError::TokenEncode(format!("amount unit: {e}")))?;
    in_unit
        .amount()
        .to_u64()
        .ok_or(SendSwapError::AmountTooSmall)
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

fn account_mint_url(account: &Account) -> Result<String, SendSwapError> {
    account
        .details
        .get("mint_url")
        .and_then(|v| v.as_str())
        .map(std::string::ToString::to_string)
        .ok_or_else(|| {
            SendSwapError::Mint(CashuProviderError::InvalidUrl(
                "account.details missing mint_url".into(),
            ))
        })
}

async fn fetch_keyset_infos(
    wallet: &Arc<CashuMintWallet>,
) -> Result<Vec<KeySetInfo>, SendSwapError> {
    let response = wallet.connector().get_mint_keysets().await.map_err(|e| {
        SendSwapError::Mint(CashuProviderError::Network(format!(
            "get_mint_keysets: {e}"
        )))
    })?;
    Ok(response.keysets)
}

async fn fetch_keyset_keys(
    wallet: &Arc<CashuMintWallet>,
    keyset_id: KeysetId,
) -> Result<KeySet, SendSwapError> {
    wallet
        .connector()
        .get_mint_keyset(keyset_id)
        .await
        .map_err(|e| {
            SendSwapError::Mint(CashuProviderError::Network(format!("get_mint_keyset: {e}")))
        })
}

fn active_keyset_for_unit<'a>(
    keysets: &'a [KeySetInfo],
    unit: &CurrencyUnit,
) -> Option<&'a KeySetInfo> {
    keysets.iter().find(|k| k.active && k.unit == *unit)
}

fn fee_and_amounts_for_keyset(keyset: &KeySetInfo) -> FeeAndAmounts {
    let amounts: Vec<u64> = (0..32).map(|i| 1u64 << i).collect();
    FeeAndAmounts::from((keyset.input_fee_ppk, amounts))
}

fn split_amounts(amount: u64, fee_and_amounts: &FeeAndAmounts) -> Result<Vec<u64>, SendSwapError> {
    if amount == 0 {
        return Ok(Vec::new());
    }
    let parts = Amount::from(amount).split(fee_and_amounts).map_err(|e| {
        SendSwapError::Mint(CashuProviderError::Protocol(format!("amount split: {e}")))
    })?;
    Ok(parts.into_iter().map(u64::from).collect())
}

fn compute_fee_for_proofs(proofs: &[ProofWithId], keysets: &[KeySetInfo]) -> u64 {
    let total_ppk: u64 = proofs
        .iter()
        .map(|p| {
            keysets
                .iter()
                .find(|k| k.id.to_string() == p.proof.id)
                .map_or(0, |k| k.input_fee_ppk)
        })
        .sum();
    total_ppk.div_ceil(1000)
}

fn sum_proofs(proofs: &[ProofWithId]) -> u64 {
    proofs.iter().map(|p| p.proof.amount).sum()
}

fn sum_token_proofs(proofs: &[ProofWithId]) -> u64 {
    sum_proofs(proofs)
}

/// Greedy proof selection mirroring TS `wallet.selectProofsToSend(...,
/// includeFeesInSendAmount=true)`. Sorts descending and accumulates until
/// the running sum covers `target_amount + per_proof_fee_so_far`.
///
/// Returns [`SendSwapError::InsufficientBalance`] if the available proofs
/// can't cover `target_amount + their fees`.
fn select_send_proofs(
    available: &[ProofWithId],
    target_amount: u64,
    keysets: &[KeySetInfo],
) -> Result<Vec<ProofWithId>, SendSwapError> {
    if target_amount == 0 {
        return Ok(Vec::new());
    }
    let total_avail = sum_proofs(available);
    if total_avail < target_amount {
        return Err(SendSwapError::InsufficientBalance {
            needed: target_amount.to_string(),
            have: total_avail.to_string(),
        });
    }

    let mut sorted: Vec<ProofWithId> = available.to_vec();
    sorted.sort_by(|a, b| b.proof.amount.cmp(&a.proof.amount));

    let mut chosen: Vec<ProofWithId> = Vec::new();
    for p in sorted {
        chosen.push(p);
        let chosen_total = sum_proofs(&chosen);
        let fee = compute_fee_for_proofs(&chosen, keysets);
        if chosen_total >= target_amount + fee {
            return Ok(chosen);
        }
    }
    let chosen_total = sum_proofs(&chosen);
    let fee = compute_fee_for_proofs(&chosen, keysets);
    Err(SendSwapError::InsufficientBalance {
        needed: (target_amount + fee).to_string(),
        have: chosen_total.to_string(),
    })
}

fn token_proofs(proofs: &[Proof]) -> Vec<TokenProof> {
    proofs
        .iter()
        .map(|p| TokenProof {
            id: p.keyset_id.to_string(),
            amount: u64::from(p.amount),
            secret: p.secret.to_string(),
            c: p.c.to_hex(),
            dleq: None,
            witness: None,
        })
        .collect()
}

fn token_proof_to_cdk_proof(proof: &TokenProof) -> Result<Proof, SendSwapError> {
    use cdk::nuts::PublicKey;
    use cdk::secret::Secret;
    let keyset_id = KeysetId::from_str(&proof.id).map_err(|e| {
        SendSwapError::Mint(CashuProviderError::Protocol(format!(
            "proof keyset id {}: {e}",
            proof.id
        )))
    })?;
    let secret = Secret::from_str(&proof.secret).map_err(|e| {
        SendSwapError::Mint(CashuProviderError::Protocol(format!("proof secret: {e}")))
    })?;
    let c = PublicKey::from_hex(&proof.c)
        .map_err(|e| SendSwapError::Mint(CashuProviderError::Protocol(format!("proof C: {e}"))))?;
    Ok(Proof {
        amount: Amount::from(proof.amount),
        keyset_id,
        secret,
        c,
        witness: None,
        dleq: None,
    })
}

fn is_already_executed_error(err: &cdk::error::Error) -> bool {
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
    let dbg = format!("{err:?}");
    dbg.contains("TokenAlreadySpent")
        || dbg.contains("BlindedMessageAlreadySigned")
        || dbg.contains("11001")
        || dbg.contains("10002")
}

fn sha256_hex(data: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data.as_bytes());
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::send_swap::types::CashuSendSwapState;
    use agicash_domain::{AccountId, AccountPurpose, AccountState, AccountType, UserId};
    use async_trait::async_trait;
    use chrono::Utc;
    use serde_json::json;
    use uuid::Uuid;

    fn stub_account(currency: Currency, mint_url: &str) -> Account {
        Account {
            id: AccountId::new(),
            created_at: Utc::now(),
            user_id: UserId::new(),
            name: "Mint".into(),
            account_type: AccountType::Cashu,
            purpose: AccountPurpose::Transactional,
            currency,
            details: json!({"mint_url": mint_url}),
            version: 0,
            state: AccountState::Active,
            expires_at: None,
        }
    }

    fn money(amount: u64, currency: Currency) -> Money {
        let unit = unit_for_currency(currency);
        Money::new(Decimal::from(amount), currency, unit)
    }

    fn proof_with_id(amount: u64, keyset: &str) -> ProofWithId {
        ProofWithId {
            id: Uuid::new_v4(),
            proof: TokenProof {
                id: keyset.into(),
                amount,
                secret: format!("s{amount}"),
                c: format!("C{amount}"),
                dleq: None,
                witness: None,
            },
        }
    }

    /// Storage that should never be reached in unit tests.
    struct UnusedStorage;

    #[async_trait]
    impl CashuSendSwapStorage for UnusedStorage {
        async fn create(
            &self,
            _input: CreateSendSwap,
        ) -> Result<CreateSendSwapResult, SendSwapStorageError> {
            unreachable!()
        }
        async fn commit_proofs_to_send(
            &self,
            _input: CommitProofsToSend,
        ) -> Result<CashuSendSwap, SendSwapStorageError> {
            unreachable!()
        }
        async fn complete(&self, _swap_id: Uuid) -> Result<CashuSendSwap, SendSwapStorageError> {
            unreachable!()
        }
        async fn fail(
            &self,
            _swap_id: Uuid,
            _reason: &str,
        ) -> Result<CashuSendSwap, SendSwapStorageError> {
            unreachable!()
        }
        async fn list_unspent_proofs(
            &self,
            _account_id: agicash_domain::AccountId,
        ) -> Result<Vec<ProofWithId>, SendSwapStorageError> {
            unreachable!()
        }
        async fn get(&self, _swap_id: Uuid) -> Result<CashuSendSwap, SendSwapStorageError> {
            unreachable!()
        }
    }

    /// Storage that records the last `complete`/`fail` call for assertion
    /// and otherwise delegates to a panic.
    struct RecordingStorage {
        completed: parking_lot::Mutex<Option<Uuid>>,
        failed: parking_lot::Mutex<Option<(Uuid, String)>>,
        complete_response: CashuSendSwap,
        fail_response: CashuSendSwap,
    }

    #[async_trait]
    impl CashuSendSwapStorage for RecordingStorage {
        async fn create(
            &self,
            _input: CreateSendSwap,
        ) -> Result<CreateSendSwapResult, SendSwapStorageError> {
            unreachable!()
        }
        async fn commit_proofs_to_send(
            &self,
            _input: CommitProofsToSend,
        ) -> Result<CashuSendSwap, SendSwapStorageError> {
            unreachable!()
        }
        async fn complete(&self, swap_id: Uuid) -> Result<CashuSendSwap, SendSwapStorageError> {
            *self.completed.lock() = Some(swap_id);
            Ok(self.complete_response.clone())
        }
        async fn fail(
            &self,
            swap_id: Uuid,
            reason: &str,
        ) -> Result<CashuSendSwap, SendSwapStorageError> {
            *self.failed.lock() = Some((swap_id, reason.into()));
            Ok(self.fail_response.clone())
        }
        async fn list_unspent_proofs(
            &self,
            _account_id: agicash_domain::AccountId,
        ) -> Result<Vec<ProofWithId>, SendSwapStorageError> {
            unreachable!()
        }
        async fn get(&self, _swap_id: Uuid) -> Result<CashuSendSwap, SendSwapStorageError> {
            unreachable!()
        }
    }

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

    fn make_service() -> CashuSendSwapService {
        let storage: Arc<dyn CashuSendSwapStorage> = Arc::new(UnusedStorage);
        let provider: Arc<dyn CashuProvider> = Arc::new(UnusedProvider);
        CashuSendSwapService::new(storage, provider)
    }

    #[tokio::test]
    async fn get_quote_rejects_currency_mismatch() {
        let svc = make_service();
        let account = stub_account(Currency::Btc, "https://m");
        let amount = money(100, Currency::Usd);
        let err = svc.get_quote(&account, &[], amount).await.unwrap_err();
        assert!(matches!(err, SendSwapError::CurrencyMismatch { .. }));
    }

    #[test]
    fn select_send_proofs_picks_largest_first() {
        let proofs = vec![
            proof_with_id(8, "ks1"),
            proof_with_id(64, "ks1"),
            proof_with_id(2, "ks1"),
            proof_with_id(32, "ks1"),
        ];
        let keysets: Vec<KeySetInfo> = vec![];
        let chosen = select_send_proofs(&proofs, 50, &keysets).unwrap();
        let total = sum_proofs(&chosen);
        assert!(total >= 50);
        // Should pick largest first: 64 covers 50 alone.
        assert_eq!(chosen.len(), 1);
        assert_eq!(chosen[0].proof.amount, 64);
    }

    #[test]
    fn select_send_proofs_combines_when_no_single_proof_covers() {
        let proofs = vec![
            proof_with_id(8, "ks1"),
            proof_with_id(16, "ks1"),
            proof_with_id(32, "ks1"),
        ];
        let keysets: Vec<KeySetInfo> = vec![];
        let chosen = select_send_proofs(&proofs, 40, &keysets).unwrap();
        let total = sum_proofs(&chosen);
        assert!(total >= 40);
    }

    #[test]
    fn select_send_proofs_errors_when_insufficient() {
        let proofs = vec![proof_with_id(10, "ks1")];
        let keysets: Vec<KeySetInfo> = vec![];
        let err = select_send_proofs(&proofs, 100, &keysets).unwrap_err();
        assert!(matches!(err, SendSwapError::InsufficientBalance { .. }));
    }

    #[test]
    fn select_send_proofs_returns_empty_for_zero_target() {
        let proofs = vec![proof_with_id(10, "ks1")];
        let keysets: Vec<KeySetInfo> = vec![];
        let chosen = select_send_proofs(&proofs, 0, &keysets).unwrap();
        assert!(chosen.is_empty());
    }

    #[test]
    fn compute_fee_for_proofs_uses_keyset_input_fee_ppk() {
        // 3 proofs from a keyset with input_fee_ppk = 100 → 300 ppk
        // → ceil(300/1000) = 1.
        let keyset_id_str = "0011223344556677";
        let proofs = vec![
            proof_with_id(8, keyset_id_str),
            proof_with_id(8, keyset_id_str),
            proof_with_id(8, keyset_id_str),
        ];
        let id = KeysetId::from_str(keyset_id_str).unwrap();
        let info = KeySetInfo {
            id,
            unit: CurrencyUnit::Sat,
            active: true,
            input_fee_ppk: 100,
            final_expiry: None,
        };
        let fee = compute_fee_for_proofs(&proofs, &[info]);
        assert_eq!(fee, 1);
    }

    #[test]
    fn compute_fee_for_proofs_zero_when_keyset_unknown() {
        let proofs = vec![proof_with_id(8, "deadbeef")];
        let fee = compute_fee_for_proofs(&proofs, &[]);
        assert_eq!(fee, 0);
    }

    #[tokio::test]
    async fn complete_no_op_on_already_completed() {
        let svc = make_service();
        let mut swap = stub_swap();
        swap.state = CashuSendSwapState::Completed {
            token_hash: "h".into(),
            proofs_to_send: vec![],
        };
        let out = svc.complete(&swap).await.unwrap();
        assert!(matches!(out.state, CashuSendSwapState::Completed { .. }));
    }

    #[tokio::test]
    async fn complete_errors_on_draft() {
        let svc = make_service();
        let swap = stub_swap();
        let err = svc.complete(&swap).await.unwrap_err();
        assert!(matches!(err, SendSwapError::InvalidTransition { .. }));
    }

    #[tokio::test]
    async fn fail_no_op_on_already_failed() {
        let svc = make_service();
        let mut swap = stub_swap();
        swap.state = CashuSendSwapState::Failed {
            failure_reason: "x".into(),
        };
        let out = svc.fail(&swap, "again").await.unwrap();
        assert!(matches!(out.state, CashuSendSwapState::Failed { .. }));
    }

    #[tokio::test]
    async fn fail_errors_on_pending() {
        let svc = make_service();
        let mut swap = stub_swap();
        swap.state = CashuSendSwapState::Pending {
            token_hash: "h".into(),
            proofs_to_send: vec![],
        };
        let err = svc.fail(&swap, "x").await.unwrap_err();
        assert!(matches!(err, SendSwapError::InvalidTransition { .. }));
    }

    #[tokio::test]
    async fn complete_calls_storage_for_pending_swap() {
        let mut pending = stub_swap();
        pending.state = CashuSendSwapState::Pending {
            token_hash: "h".into(),
            proofs_to_send: vec![],
        };
        let mut completed_after = pending.clone();
        completed_after.state = CashuSendSwapState::Completed {
            token_hash: "h".into(),
            proofs_to_send: vec![],
        };
        let recording = Arc::new(RecordingStorage {
            completed: parking_lot::Mutex::new(None),
            failed: parking_lot::Mutex::new(None),
            complete_response: completed_after.clone(),
            fail_response: pending.clone(),
        });
        let provider: Arc<dyn CashuProvider> = Arc::new(UnusedProvider);
        let svc = CashuSendSwapService::new(recording.clone(), provider);
        let out = svc.complete(&pending).await.unwrap();
        assert!(matches!(out.state, CashuSendSwapState::Completed { .. }));
        assert_eq!(*recording.completed.lock(), Some(pending.id));
    }

    #[tokio::test]
    async fn fail_calls_storage_for_draft_swap() {
        let draft = stub_swap();
        let mut failed_after = draft.clone();
        failed_after.state = CashuSendSwapState::Failed {
            failure_reason: "user aborted".into(),
        };
        let recording = Arc::new(RecordingStorage {
            completed: parking_lot::Mutex::new(None),
            failed: parking_lot::Mutex::new(None),
            complete_response: draft.clone(),
            fail_response: failed_after.clone(),
        });
        let provider: Arc<dyn CashuProvider> = Arc::new(UnusedProvider);
        let svc = CashuSendSwapService::new(recording.clone(), provider);
        let out = svc.fail(&draft, "user aborted").await.unwrap();
        assert!(matches!(out.state, CashuSendSwapState::Failed { .. }));
        let recorded = recording.failed.lock().clone();
        assert_eq!(recorded, Some((draft.id, "user aborted".to_string())));
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

    #[test]
    fn account_mint_url_extracts_from_details() {
        let acct = stub_account(Currency::Btc, "https://m.test");
        assert_eq!(account_mint_url(&acct).unwrap(), "https://m.test");
    }

    #[test]
    fn account_mint_url_errors_when_missing() {
        let mut acct = stub_account(Currency::Btc, "https://m.test");
        acct.details = json!({});
        let err = account_mint_url(&acct).unwrap_err();
        assert!(matches!(err, SendSwapError::Mint(_)));
    }

    #[test]
    fn sha256_hex_matches_known_vector() {
        assert_eq!(
            sha256_hex("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    fn stub_swap() -> CashuSendSwap {
        CashuSendSwap {
            id: Uuid::new_v4(),
            account_id: AccountId::new(),
            user_id: UserId::new(),
            input_proofs: vec![],
            input_amount: money(0, Currency::Btc),
            amount_received: money(0, Currency::Btc),
            cashu_receive_fee: money(0, Currency::Btc),
            amount_to_send: money(0, Currency::Btc),
            cashu_send_fee: money(0, Currency::Btc),
            amount_spent: money(0, Currency::Btc),
            total_fee: money(0, Currency::Btc),
            keyset_id: None,
            keyset_counter: None,
            output_amounts: None,
            transaction_id: Uuid::new_v4(),
            created_at: Utc::now(),
            version: 0,
            state: CashuSendSwapState::Draft,
        }
    }
}
