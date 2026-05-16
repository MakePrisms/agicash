//! Orchestrator that drives a [`MeltQuoteMachine`] forward by performing
//! the I/O for each [`Action`] against the CDK [`CashuProvider`] +
//! [`CashuMeltQuoteStorage`].
//!
//! Mirrors `app/features/send/cashu-send-quote-service.ts` —
//! `getLightningQuote` becomes [`CashuMeltQuoteService::get_quote`],
//! `createSendQuote` becomes [`CashuMeltQuoteService::create_quote`],
//! `markSendQuoteAsPending` + `initiateSend` + `completeSendQuote` collapse
//! into [`CashuMeltQuoteService::initiate_melt`], and a separate
//! [`CashuMeltQuoteService::poll_until_complete`] handles the long-running
//! PENDING state.
//!
//! Helper duplication: this module re-implements several utilities that
//! also live in `send_swap/service.rs` and `mint_quote/service.rs`
//! (`cashu_unit_for_currency`, `unit_for_currency`, keyset fetchers,
//! proof helpers, error classification). A future slice will collapse
//! the duplication into a shared `cdk_helpers` module — out of scope for
//! slice 8.

use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use agicash_domain::{Account, Currency, UserId};
use agicash_money::{Money, Unit};
use agicash_traits::{CashuMintWallet, CashuProvider, CashuProviderError};
use cdk::dhke::{blind_message, construct_proofs};
use cdk::nuts::nut02::Id as KeysetId;
use cdk::nuts::nut05::QuoteState as MeltState;
use cdk::nuts::{
    BlindSignature, BlindedMessage, CurrencyUnit, KeySet, KeySetInfo, MeltQuoteBolt11Request,
    MeltRequest, PaymentMethod, PreMint, PreMintSecrets, Proof, SecretKey,
};
use cdk::secret::Secret;
use cdk::Amount;
use chrono::{DateTime, TimeZone, Utc};
use lightning_invoice::Bolt11Invoice;
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;

use super::error::MeltQuoteError;
use super::state::{Event, MachineState, MeltQuoteMachine};
use super::storage::{
    CashuMeltQuoteStorage, CompleteMeltQuote, CompleteMeltQuoteResult, CreateMeltQuote,
    CreateMeltQuoteResult,
};
use super::types::{CashuMeltQuote, CashuMeltQuoteState};
use crate::receive_swap::types::TokenProof;
use crate::send_swap::ProofWithId;

/// Service that orchestrates NUT-05 melt quotes (Lightning sends).
#[derive(Clone)]
pub struct CashuMeltQuoteService {
    storage: Arc<dyn CashuMeltQuoteStorage>,
    cashu_provider: Arc<dyn CashuProvider>,
}

impl std::fmt::Debug for CashuMeltQuoteService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CashuMeltQuoteService")
            .finish_non_exhaustive()
    }
}

impl CashuMeltQuoteService {
    pub fn new(
        storage: Arc<dyn CashuMeltQuoteStorage>,
        cashu_provider: Arc<dyn CashuProvider>,
    ) -> Self {
        Self {
            storage,
            cashu_provider,
        }
    }

    /// Compute fees + proof selection for a hypothetical melt. Does not
    /// persist. Mirrors TS `getLightningQuote`. Returns the prepared
    /// preview which `create_quote` consumes.
    pub async fn get_quote(
        &self,
        account: &Account,
        proofs: &[ProofWithId],
        bolt11: &str,
    ) -> Result<MeltQuotePreview, MeltQuoteError> {
        // 1. Parse and validate the bolt11.
        let invoice = Bolt11Invoice::from_str(bolt11)
            .map_err(|e| MeltQuoteError::InvalidInvoice(format!("parse: {e}")))?;
        let amount_msat = invoice
            .amount_milli_satoshis()
            .ok_or(MeltQuoteError::AmountlessInvoice)?;
        if invoice.is_expired() {
            return Err(MeltQuoteError::QuoteExpired);
        }
        let payment_hash = hex::encode(invoice.payment_hash());

        // 2. Currency mapping.
        let cashu_unit = cashu_unit_for_currency(account.currency).ok_or_else(|| {
            MeltQuoteError::CurrencyMismatch {
                account: account.currency.to_string(),
                request: account.currency.to_string(),
            }
        })?;
        let unit = unit_for_currency(account.currency);

        // 3. Quote with the mint.
        let wallet = self.cashu_provider.wallet_for_account(account).await?;
        let melt_quote = wallet
            .connector()
            .post_melt_quote(MeltQuoteBolt11Request {
                request: invoice.clone(),
                unit: cashu_unit.clone(),
                options: None,
            })
            .await
            .map_err(|e| {
                MeltQuoteError::Mint(CashuProviderError::Network(format!("post_melt_quote: {e}")))
            })?;

        let quoted_amount = u64::from(melt_quote.amount);
        let fee_reserve = u64::from(melt_quote.fee_reserve);
        let amount_with_fee_reserve = quoted_amount + fee_reserve;

        // 4. Pick keyset for change blanks.
        let keysets = fetch_keyset_infos(&wallet).await?;
        let active = active_keyset_for_unit(&keysets, &cashu_unit).ok_or_else(|| {
            MeltQuoteError::Mint(CashuProviderError::Protocol(format!(
                "no active keyset for unit {cashu_unit}"
            )))
        })?;

        // 5. Select proofs covering amount + fee_reserve + cashu_fee.
        let send = select_send_proofs(proofs, amount_with_fee_reserve, &keysets)?;
        let cashu_fee_value = compute_fee_for_proofs(&send, &keysets);
        let proofs_total: u64 = send.iter().map(|p| p.proof.amount).sum();
        let needed = amount_with_fee_reserve + cashu_fee_value;
        if proofs_total < needed {
            return Err(MeltQuoteError::InsufficientBalance {
                needed: needed.to_string(),
                have: proofs_total.to_string(),
            });
        }

        // 6. Compute number of change blanks. Mirror TS:
        //    max_change = proofsTotal - meltQuote.amount - cashu_fee
        //    n = max_change == 0 ? 0 : ceil(log2(max_change)) || 1
        let max_change = proofs_total.saturating_sub(quoted_amount + cashu_fee_value);
        let number_of_change_outputs = number_of_change_blanks(max_change);

        let to_money = |n: u64| Money::new(Decimal::from(n), account.currency, unit);
        let amount_received = to_money(quoted_amount);
        let lightning_fee_reserve = to_money(fee_reserve);
        let cashu_fee = to_money(cashu_fee_value);
        let total_fee = to_money(fee_reserve + cashu_fee_value);
        let total_amount = to_money(quoted_amount + fee_reserve + cashu_fee_value);

        // The pre-bump keyset counter is what `create_cashu_send_quote`
        // returns to us via `keyset_counter` on the row; for the preview
        // we pass through whatever the active counter currently is so the
        // CLI can display it. The DB function authoritatively re-computes
        // and returns the correct value when we call create.
        let pre_bump_counter = account
            .details
            .get("keyset_counters")
            .and_then(|v| v.get(active.id.to_string()))
            .and_then(serde_json::Value::as_u64)
            .and_then(|c| u32::try_from(c).ok())
            .unwrap_or(0);

        let expires_at = Utc
            .timestamp_opt(i64::try_from(melt_quote.expiry).unwrap_or(0), 0)
            .single()
            .unwrap_or_else(|| Utc::now() + chrono::Duration::hours(1));

        Ok(MeltQuotePreview {
            bolt11: bolt11.to_string(),
            melt_quote_id: melt_quote.quote.clone(),
            amount_received,
            lightning_fee_reserve,
            cashu_fee,
            total_fee,
            total_amount,
            amount_requested: to_money(quoted_amount),
            amount_requested_in_msat: amount_msat,
            payment_hash,
            expires_at,
            keyset_id: active.id.to_string(),
            keyset_counter: pre_bump_counter,
            number_of_change_outputs,
            prepared_proofs: send,
            amount_reserved: to_money(proofs_total),
        })
    }

    /// Persist the UNPAID melt-quote row, reserving the chosen proofs.
    pub async fn create_quote(
        &self,
        user_id: UserId,
        account: &Account,
        preview: MeltQuotePreview,
    ) -> Result<CreateMeltQuoteResult, MeltQuoteError> {
        if Utc::now() >= preview.expires_at {
            return Err(MeltQuoteError::QuoteExpired);
        }
        let proof_ids: Vec<uuid::Uuid> = preview.prepared_proofs.iter().map(|p| p.id).collect();
        let proofs: Vec<TokenProof> = preview
            .prepared_proofs
            .iter()
            .map(|p| p.proof.clone())
            .collect();

        let input = CreateMeltQuote {
            user_id,
            account_id: account.id,
            payment_request: preview.bolt11,
            payment_hash: preview.payment_hash,
            expires_at: preview.expires_at,
            quote_id: preview.melt_quote_id,
            amount_requested: preview.amount_requested,
            amount_requested_in_msat: preview.amount_requested_in_msat,
            amount_received: preview.amount_received,
            lightning_fee_reserve: preview.lightning_fee_reserve,
            cashu_fee: preview.cashu_fee,
            proofs,
            proof_ids,
            amount_reserved: preview.amount_reserved,
            keyset_id: preview.keyset_id,
            number_of_change_outputs: preview.number_of_change_outputs,
        };
        Ok(self.storage.create(input).await?)
    }

    /// UNPAID -> PENDING + call `post_melt`. On success returns a
    /// [`MeltOutcome`] that the caller dispatches on.
    pub async fn initiate_melt(
        &self,
        account: &Account,
        quote: CashuMeltQuote,
        seed: &[u8; 64],
    ) -> Result<MeltOutcome, MeltQuoteError> {
        let mut machine = MeltQuoteMachine::from_existing(quote.clone());
        if machine.is_terminal() {
            return match &quote.state {
                CashuMeltQuoteState::Paid { .. } => Ok(MeltOutcome::Paid {
                    quote: quote.clone(),
                    account: account.clone(),
                    change_proofs_count: 0,
                }),
                _ => Err(MeltQuoteError::InvalidTransition {
                    from: format!("{:?}", quote.state),
                    event: "initiate_melt".into(),
                }),
            };
        }
        if matches!(machine.state(), MachineState::Pending(_)) {
            // Already pending — caller should poll instead.
            return Ok(MeltOutcome::Pending(quote));
        }

        let wallet = self.cashu_provider.wallet_for_account(account).await?;

        // 1. Mark pending.
        let updated = self.storage.mark_as_pending(quote.id).await?;
        machine.apply(Event::QuoteMarkedPending(updated.clone()))?;

        // 2. Build deterministic change blanks.
        let keyset_id = KeysetId::from_str(&quote.keyset_id).map_err(|e| {
            MeltQuoteError::Mint(CashuProviderError::Protocol(format!(
                "invalid keyset id {}: {e}",
                quote.keyset_id
            )))
        })?;
        let keysets = fetch_keyset_infos(&wallet).await?;
        let keyset_info = keysets.iter().find(|k| k.id == keyset_id).ok_or_else(|| {
            MeltQuoteError::Mint(CashuProviderError::Protocol(format!(
                "keyset {} not found on mint",
                quote.keyset_id
            )))
        })?;
        let mint_keys = fetch_keyset_keys(&wallet, keyset_id).await?;

        let pre_mint = build_change_pre_mint(
            keyset_id,
            keyset_info,
            quote.keyset_counter,
            quote.number_of_change_outputs,
            seed,
        )?;
        let blinded_messages = pre_mint.blinded_messages();

        // 3. Build inputs.
        let cdk_proofs = quote
            .proofs
            .iter()
            .map(token_proof_to_cdk_proof)
            .collect::<Result<Vec<_>, _>>()?;

        // 4. Call post_melt.
        let melt_request =
            MeltRequest::new(quote.quote_id.clone(), cdk_proofs, Some(blinded_messages));
        let response = match wallet
            .connector()
            .post_melt(&PaymentMethod::BOLT11, melt_request)
            .await
        {
            Ok(r) => r,
            Err(e) => {
                let reason = format!("post_melt: {e}");
                let failed = self.storage.fail(quote.id, &reason).await?;
                machine.apply(Event::QuoteFailed(failed.clone()))?;
                return Ok(MeltOutcome::Failed(failed));
            }
        };

        // 5. Dispatch on melt state.
        match response.state {
            MeltState::Paid => {
                let preimage = response.payment_preimage.unwrap_or_default();
                let change_proofs = construct_change_proofs(
                    &response.change.unwrap_or_default(),
                    &pre_mint,
                    &mint_keys,
                )?;
                let result = self
                    .complete_with_change(account, quote.clone(), preimage, change_proofs.clone())
                    .await?;
                machine.apply(Event::QuoteCompleted(result.quote.clone()))?;
                Ok(MeltOutcome::Paid {
                    quote: result.quote,
                    account: result.account,
                    change_proofs_count: change_proofs.len(),
                })
            }
            MeltState::Pending | MeltState::Unknown => Ok(MeltOutcome::Pending(updated)),
            MeltState::Unpaid | MeltState::Failed => {
                let reason = format!("mint reported {:?}", response.state);
                let failed = self.storage.fail(quote.id, &reason).await?;
                machine.apply(Event::QuoteFailed(failed.clone()))?;
                Ok(MeltOutcome::Failed(failed))
            }
        }
    }

    /// Poll the mint until `Paid`/`Failed`/`Unpaid` or timeout. Reconciles
    /// change proofs + storage on PAID; calls storage.fail on
    /// FAILED/UNPAID; returns the still-pending quote on timeout.
    pub async fn poll_until_complete(
        &self,
        account: &Account,
        quote: CashuMeltQuote,
        seed: &[u8; 64],
        poll_interval: Duration,
        timeout: Duration,
    ) -> Result<MeltOutcome, MeltQuoteError> {
        let mut machine = MeltQuoteMachine::from_existing(quote.clone());
        if matches!(machine.state(), MachineState::Paid(_)) {
            return Ok(MeltOutcome::Paid {
                quote: quote.clone(),
                account: account.clone(),
                change_proofs_count: 0,
            });
        }
        if !matches!(machine.state(), MachineState::Pending(_)) {
            return Err(MeltQuoteError::QuoteNotPending);
        }
        let wallet = self.cashu_provider.wallet_for_account(account).await?;
        let keyset_id = KeysetId::from_str(&quote.keyset_id).map_err(|e| {
            MeltQuoteError::Mint(CashuProviderError::Protocol(format!(
                "invalid keyset id {}: {e}",
                quote.keyset_id
            )))
        })?;
        let keysets = fetch_keyset_infos(&wallet).await?;
        let keyset_info = keysets.iter().find(|k| k.id == keyset_id).ok_or_else(|| {
            MeltQuoteError::Mint(CashuProviderError::Protocol(format!(
                "keyset {} not found on mint",
                quote.keyset_id
            )))
        })?;
        let mint_keys = fetch_keyset_keys(&wallet, keyset_id).await?;
        let pre_mint = build_change_pre_mint(
            keyset_id,
            keyset_info,
            quote.keyset_counter,
            quote.number_of_change_outputs,
            seed,
        )?;
        let deadline = std::time::Instant::now() + timeout;

        loop {
            let status = wallet
                .connector()
                .get_melt_quote_status(&quote.quote_id)
                .await
                .map_err(|e| {
                    MeltQuoteError::Mint(CashuProviderError::Network(format!(
                        "get_melt_quote_status: {e}"
                    )))
                })?;
            match status.state {
                MeltState::Paid => {
                    let preimage = status.payment_preimage.unwrap_or_default();
                    let change_proofs = construct_change_proofs(
                        &status.change.unwrap_or_default(),
                        &pre_mint,
                        &mint_keys,
                    )?;
                    let result = self
                        .complete_with_change(
                            account,
                            quote.clone(),
                            preimage,
                            change_proofs.clone(),
                        )
                        .await?;
                    machine.apply(Event::QuoteCompleted(result.quote.clone()))?;
                    return Ok(MeltOutcome::Paid {
                        quote: result.quote,
                        account: result.account,
                        change_proofs_count: change_proofs.len(),
                    });
                }
                MeltState::Pending | MeltState::Unknown => {
                    machine.apply(Event::PollSawPending)?;
                    if std::time::Instant::now() >= deadline {
                        return Ok(MeltOutcome::Pending(quote));
                    }
                    tokio::time::sleep(poll_interval).await;
                }
                MeltState::Unpaid => {
                    machine.apply(Event::PollSawUnpaid)?;
                    let failed = self
                        .storage
                        .fail(quote.id, "mint reported UNPAID after melt")
                        .await?;
                    machine.apply(Event::QuoteFailed(failed.clone()))?;
                    return Ok(MeltOutcome::Failed(failed));
                }
                MeltState::Failed => {
                    let failed = self.storage.fail(quote.id, "mint reported FAILED").await?;
                    machine.apply(Event::QuoteFailed(failed.clone()))?;
                    return Ok(MeltOutcome::Failed(failed));
                }
            }
        }
    }

    /// Expire an UNPAID quote.
    pub async fn expire(&self, quote: &CashuMeltQuote) -> Result<CashuMeltQuote, MeltQuoteError> {
        match &quote.state {
            CashuMeltQuoteState::Expired => Ok(quote.clone()),
            CashuMeltQuoteState::Unpaid => Ok(self.storage.expire(quote.id).await?),
            _ => Err(MeltQuoteError::InvalidTransition {
                from: format!("{:?}", quote.state),
                event: "expire".into(),
            }),
        }
    }

    /// Fail an UNPAID/PENDING quote. Mirrors TS: queries the mint to
    /// ensure it's still UNPAID before failing — refusing to fail a PAID
    /// quote.
    pub async fn fail(
        &self,
        account: &Account,
        quote: &CashuMeltQuote,
        reason: &str,
    ) -> Result<CashuMeltQuote, MeltQuoteError> {
        if matches!(quote.state, CashuMeltQuoteState::Failed { .. }) {
            return Ok(quote.clone());
        }
        if !matches!(
            quote.state,
            CashuMeltQuoteState::Unpaid | CashuMeltQuoteState::Pending
        ) {
            return Err(MeltQuoteError::InvalidTransition {
                from: format!("{:?}", quote.state),
                event: "fail".into(),
            });
        }
        let wallet = self.cashu_provider.wallet_for_account(account).await?;
        let status = wallet
            .connector()
            .get_melt_quote_status(&quote.quote_id)
            .await
            .map_err(|e| {
                MeltQuoteError::Mint(CashuProviderError::Network(format!(
                    "get_melt_quote_status: {e}"
                )))
            })?;
        if status.state != MeltState::Unpaid {
            return Err(MeltQuoteError::InvalidTransition {
                from: format!("mint reports {:?}", status.state),
                event: "fail".into(),
            });
        }
        Ok(self.storage.fail(quote.id, reason).await?)
    }

    // --- private helpers ---

    async fn complete_with_change(
        &self,
        _account: &Account,
        quote: CashuMeltQuote,
        payment_preimage: String,
        change_proofs: Vec<Proof>,
    ) -> Result<CompleteMeltQuoteResult, MeltQuoteError> {
        let unit = unit_for_currency(quote.amount_received.currency());
        let proofs_sum: u64 = quote.proofs.iter().map(|p| p.amount).sum();
        let change_sum: u64 = change_proofs.iter().map(|p| u64::from(p.amount)).sum();
        let amount_spent_value = proofs_sum.saturating_sub(change_sum);
        let amount_spent = Money::new(
            Decimal::from(amount_spent_value),
            quote.amount_received.currency(),
            unit,
        );
        let change_token_proofs: Vec<TokenProof> =
            change_proofs.iter().map(proof_to_token_proof).collect();
        let result = self
            .storage
            .complete(CompleteMeltQuote {
                quote,
                payment_preimage,
                amount_spent,
                change_proofs: change_token_proofs,
            })
            .await?;
        Ok(result)
    }
}

/// Output of [`CashuMeltQuoteService::get_quote`].
#[derive(Debug, Clone)]
pub struct MeltQuotePreview {
    pub bolt11: String,
    pub melt_quote_id: String,
    pub amount_received: Money,
    pub lightning_fee_reserve: Money,
    pub cashu_fee: Money,
    pub total_fee: Money,
    pub total_amount: Money,
    pub amount_requested: Money,
    pub amount_requested_in_msat: u64,
    pub payment_hash: String,
    pub expires_at: DateTime<Utc>,
    pub keyset_id: String,
    /// Pre-bump counter (informational; the create RPC re-derives the
    /// authoritative value).
    pub keyset_counter: u32,
    pub number_of_change_outputs: u32,
    pub prepared_proofs: Vec<ProofWithId>,
    pub amount_reserved: Money,
}

/// Result of [`CashuMeltQuoteService::initiate_melt`] /
/// [`CashuMeltQuoteService::poll_until_complete`].
#[derive(Debug, Clone)]
pub enum MeltOutcome {
    /// Mint settled the melt; quote persisted as PAID.
    Paid {
        quote: CashuMeltQuote,
        account: Account,
        change_proofs_count: usize,
    },
    /// Lightning payment in flight; caller should poll.
    Pending(CashuMeltQuote),
    /// Mint refused or marked UNPAID/FAILED; quote persisted as FAILED.
    Failed(CashuMeltQuote),
}

/// Used by callers that drive an already-Pending quote to a terminal
/// state (CLI's `lightning-complete` subcommand).
#[derive(Debug, Clone)]
pub enum CompleteMeltQuoteOutcome {
    Completed {
        quote: CashuMeltQuote,
        account: Account,
        change_proofs_count: usize,
    },
    AlreadyTerminal(CashuMeltQuote),
    Failed(CashuMeltQuote),
}

// === Helpers (duplicated from send_swap/mint_quote — collapse later) ===

fn cashu_unit_for_currency(currency: Currency) -> Option<CurrencyUnit> {
    match currency {
        Currency::Btc => Some(CurrencyUnit::Sat),
        Currency::Usd => Some(CurrencyUnit::Usd),
        Currency::Usdb => None,
    }
}

fn unit_for_currency(currency: Currency) -> Unit {
    match currency {
        Currency::Btc => Unit::Sat,
        Currency::Usd | Currency::Usdb => Unit::Cent,
    }
}

async fn fetch_keyset_infos(
    wallet: &Arc<CashuMintWallet>,
) -> Result<Vec<KeySetInfo>, MeltQuoteError> {
    let response = wallet.connector().get_mint_keysets().await.map_err(|e| {
        MeltQuoteError::Mint(CashuProviderError::Network(format!(
            "get_mint_keysets: {e}"
        )))
    })?;
    Ok(response.keysets)
}

async fn fetch_keyset_keys(
    wallet: &Arc<CashuMintWallet>,
    keyset_id: KeysetId,
) -> Result<KeySet, MeltQuoteError> {
    wallet
        .connector()
        .get_mint_keyset(keyset_id)
        .await
        .map_err(|e| {
            MeltQuoteError::Mint(CashuProviderError::Network(format!("get_mint_keyset: {e}")))
        })
}

fn active_keyset_for_unit<'a>(
    keysets: &'a [KeySetInfo],
    unit: &CurrencyUnit,
) -> Option<&'a KeySetInfo> {
    keysets.iter().find(|k| k.active && k.unit == *unit)
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

/// Greedy proof selection mirroring TS `selectProofsToSend(...,
/// includeFeesInSendAmount=true)`.
fn select_send_proofs(
    available: &[ProofWithId],
    target_amount: u64,
    keysets: &[KeySetInfo],
) -> Result<Vec<ProofWithId>, MeltQuoteError> {
    if target_amount == 0 {
        return Err(MeltQuoteError::AmountTooSmall);
    }
    let total_avail: u64 = available.iter().map(|p| p.proof.amount).sum();
    if total_avail < target_amount {
        return Err(MeltQuoteError::InsufficientBalance {
            needed: target_amount.to_string(),
            have: total_avail.to_string(),
        });
    }

    let mut sorted: Vec<ProofWithId> = available.to_vec();
    sorted.sort_by(|a, b| b.proof.amount.cmp(&a.proof.amount));

    let mut chosen: Vec<ProofWithId> = Vec::new();
    for p in sorted {
        chosen.push(p);
        let chosen_total: u64 = chosen.iter().map(|p| p.proof.amount).sum();
        let fee = compute_fee_for_proofs(&chosen, keysets);
        if chosen_total >= target_amount + fee {
            return Ok(chosen);
        }
    }
    let chosen_total: u64 = chosen.iter().map(|p| p.proof.amount).sum();
    let fee = compute_fee_for_proofs(&chosen, keysets);
    Err(MeltQuoteError::InsufficientBalance {
        needed: (target_amount + fee).to_string(),
        have: chosen_total.to_string(),
    })
}

/// Mirrors TS:
/// ```js
/// max_change == 0 ? 0 : Math.ceil(Math.log2(max_change)) || 1
/// ```
///
/// Uses integer math (`(64 - leading_zeros(n - 1))` == ceil(log2(n))) to
/// avoid f64 precision and casting lints. Returns `1` for `max_change ==
/// 1` (matches the TS `|| 1` clause: `log2(1) == 0`, then `0 || 1 == 1`).
fn number_of_change_blanks(max_change: u64) -> u32 {
    if max_change == 0 {
        return 0;
    }
    if max_change == 1 {
        return 1;
    }
    let n_minus_one = max_change - 1;
    // `64 - leading_zeros(n - 1)` == ceil(log2(n)) for n >= 2.
    let bits = u64::BITS - n_minus_one.leading_zeros();
    bits.max(1)
}

/// Build N deterministic NUT-08 change blanks from `seed` starting at
/// `keyset_counter`. Each blank carries `Amount::ZERO` (per NUT-08); the
/// mint fills in the actual returned amounts when it issues the change
/// signatures. Mirrors `PreMintSecrets::from_seed_blank` but uses our
/// caller-controlled count rather than deriving from a fee-reserve
/// amount, so the on-row `number_of_change_outputs` and the in-memory
/// pre-mint stay in sync.
fn build_change_pre_mint(
    keyset_id: KeysetId,
    _keyset_info: &KeySetInfo,
    keyset_counter: u32,
    number_of_change_outputs: u32,
    seed: &[u8; 64],
) -> Result<PreMintSecrets, MeltQuoteError> {
    if number_of_change_outputs == 0 {
        return Ok(PreMintSecrets::new(keyset_id));
    }
    let mut pre_mint = PreMintSecrets::new(keyset_id);
    let mut counter = keyset_counter;
    for _ in 0..number_of_change_outputs {
        let secret = Secret::from_seed(seed, keyset_id, counter).map_err(|e| {
            MeltQuoteError::Mint(CashuProviderError::Protocol(format!(
                "secret from seed: {e}"
            )))
        })?;
        let blinding_factor = SecretKey::from_seed(seed, keyset_id, counter).map_err(|e| {
            MeltQuoteError::Mint(CashuProviderError::Protocol(format!(
                "blinding factor from seed: {e}"
            )))
        })?;
        let (blinded, r) =
            blind_message(&secret.to_bytes(), Some(blinding_factor)).map_err(|e| {
                MeltQuoteError::Mint(CashuProviderError::Protocol(format!("blind_message: {e}")))
            })?;
        let amount = Amount::ZERO;
        let blinded_message = BlindedMessage::new(amount, keyset_id, blinded);
        pre_mint.secrets.push(PreMint {
            blinded_message,
            secret,
            r,
            amount,
        });
        counter += 1;
    }
    Ok(pre_mint)
}

fn construct_change_proofs(
    sigs: &[BlindSignature],
    pre_mint: &PreMintSecrets,
    mint_keys: &KeySet,
) -> Result<Vec<Proof>, MeltQuoteError> {
    if sigs.is_empty() {
        return Ok(Vec::new());
    }
    let proofs = construct_proofs(
        sigs.to_vec(),
        pre_mint.rs(),
        pre_mint.secrets(),
        &mint_keys.keys,
    )
    .map_err(|e| {
        MeltQuoteError::Mint(CashuProviderError::Protocol(format!(
            "construct_proofs (change): {e}"
        )))
    })?;
    Ok(proofs)
}

fn proof_to_token_proof(proof: &Proof) -> TokenProof {
    TokenProof {
        id: proof.keyset_id.to_string(),
        amount: u64::from(proof.amount),
        secret: proof.secret.to_string(),
        c: proof.c.to_hex(),
        dleq: None,
        witness: None,
    }
}

fn token_proof_to_cdk_proof(proof: &TokenProof) -> Result<Proof, MeltQuoteError> {
    use cdk::nuts::PublicKey;
    use cdk::secret::Secret;
    let keyset_id = KeysetId::from_str(&proof.id).map_err(|e| {
        MeltQuoteError::Mint(CashuProviderError::Protocol(format!(
            "proof keyset id {}: {e}",
            proof.id
        )))
    })?;
    let secret = Secret::from_str(&proof.secret).map_err(|e| {
        MeltQuoteError::Mint(CashuProviderError::Protocol(format!("proof secret: {e}")))
    })?;
    let c = PublicKey::from_hex(&proof.c)
        .map_err(|e| MeltQuoteError::Mint(CashuProviderError::Protocol(format!("proof C: {e}"))))?;
    Ok(Proof {
        amount: Amount::from(proof.amount),
        keyset_id,
        secret,
        c,
        witness: None,
        dleq: None,
    })
}

#[allow(dead_code)]
fn money_to_minor_units(amount: &Money) -> Result<u64, MeltQuoteError> {
    let minor = unit_for_currency(amount.currency());
    let normalized = amount
        .to_unit(minor)
        .map_err(|e| MeltQuoteError::Mint(CashuProviderError::Protocol(format!("to_unit: {e}"))))?;
    normalized
        .amount()
        .to_u64()
        .ok_or(MeltQuoteError::AmountTooSmall)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::receive_swap::TokenProof;
    use agicash_domain::{AccountId, AccountPurpose, AccountState, AccountType, Currency};
    use async_trait::async_trait;
    use cdk::mint_url::MintUrl;
    use cdk::nuts::MintInfo;
    use chrono::Utc;
    use rust_decimal::Decimal;
    use serde_json::json;
    use uuid::Uuid;

    fn money(amount: u64, currency: Currency) -> Money {
        let unit = unit_for_currency(currency);
        Money::new(Decimal::from(amount), currency, unit)
    }

    fn stub_account(currency: Currency) -> Account {
        Account {
            id: AccountId::new(),
            created_at: Utc::now(),
            user_id: UserId::new(),
            name: "Mint".into(),
            account_type: AccountType::Cashu,
            purpose: AccountPurpose::Transactional,
            currency,
            details: json!({ "mint_url": "https://m.example", "keyset_counters": {} }),
            version: 0,
            state: AccountState::Active,
            expires_at: None,
        }
    }

    fn stub_quote(state: CashuMeltQuoteState) -> CashuMeltQuote {
        CashuMeltQuote {
            id: Uuid::new_v4(),
            quote_id: "qid".into(),
            user_id: UserId::new(),
            account_id: AccountId::new(),
            payment_request: "lnbc...".into(),
            payment_hash: "h".into(),
            amount_requested: money(64, Currency::Btc),
            amount_requested_in_msat: 64_000,
            amount_received: money(64, Currency::Btc),
            lightning_fee_reserve: money(1, Currency::Btc),
            cashu_fee: money(0, Currency::Btc),
            proofs: vec![TokenProof {
                id: "ks1".into(),
                amount: 64,
                secret: "s".into(),
                c: "C".into(),
                dleq: None,
                witness: None,
            }],
            amount_reserved: money(64, Currency::Btc),
            keyset_id: "00abcdef".into(),
            keyset_counter: 0,
            number_of_change_outputs: 1,
            transaction_id: Uuid::new_v4(),
            created_at: Utc::now(),
            expires_at: Utc::now() + chrono::Duration::hours(1),
            version: 0,
            state,
        }
    }

    struct UnusedStorage;

    #[async_trait]
    impl CashuMeltQuoteStorage for UnusedStorage {
        async fn create(
            &self,
            _input: CreateMeltQuote,
        ) -> Result<CreateMeltQuoteResult, super::super::storage::MeltQuoteStorageError> {
            unreachable!()
        }
        async fn mark_as_pending(
            &self,
            _quote_id: Uuid,
        ) -> Result<CashuMeltQuote, super::super::storage::MeltQuoteStorageError> {
            unreachable!()
        }
        async fn complete(
            &self,
            _input: CompleteMeltQuote,
        ) -> Result<CompleteMeltQuoteResult, super::super::storage::MeltQuoteStorageError> {
            unreachable!()
        }
        async fn expire(
            &self,
            _quote_id: Uuid,
        ) -> Result<CashuMeltQuote, super::super::storage::MeltQuoteStorageError> {
            unreachable!()
        }
        async fn fail(
            &self,
            _quote_id: Uuid,
            _reason: &str,
        ) -> Result<CashuMeltQuote, super::super::storage::MeltQuoteStorageError> {
            unreachable!()
        }
        async fn get(
            &self,
            _quote_id: Uuid,
        ) -> Result<CashuMeltQuote, super::super::storage::MeltQuoteStorageError> {
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
        async fn mint_info(&self, _mint_url: &MintUrl) -> Result<MintInfo, CashuProviderError> {
            unreachable!()
        }
    }

    fn make_service() -> CashuMeltQuoteService {
        let storage: Arc<dyn CashuMeltQuoteStorage> = Arc::new(UnusedStorage);
        let provider: Arc<dyn CashuProvider> = Arc::new(UnusedProvider);
        CashuMeltQuoteService::new(storage, provider)
    }

    #[tokio::test]
    async fn get_quote_rejects_invalid_invoice() {
        let svc = make_service();
        let account = stub_account(Currency::Btc);
        let err = svc
            .get_quote(&account, &[], "not-a-bolt11")
            .await
            .unwrap_err();
        assert!(matches!(err, MeltQuoteError::InvalidInvoice(_)));
    }

    #[tokio::test]
    async fn expire_is_noop_on_already_expired() {
        let svc = make_service();
        let q = stub_quote(CashuMeltQuoteState::Expired);
        let out = svc.expire(&q).await.unwrap();
        assert!(matches!(out.state, CashuMeltQuoteState::Expired));
    }

    #[tokio::test]
    async fn expire_errors_on_pending_quote() {
        let svc = make_service();
        let q = stub_quote(CashuMeltQuoteState::Pending);
        let err = svc.expire(&q).await.unwrap_err();
        assert!(matches!(err, MeltQuoteError::InvalidTransition { .. }));
    }

    #[tokio::test]
    async fn expire_errors_on_paid_quote() {
        let svc = make_service();
        let q = stub_quote(CashuMeltQuoteState::Paid {
            payment_preimage: "x".into(),
            lightning_fee: money(0, Currency::Btc),
            amount_spent: money(64, Currency::Btc),
            total_fee: money(0, Currency::Btc),
        });
        let err = svc.expire(&q).await.unwrap_err();
        assert!(matches!(err, MeltQuoteError::InvalidTransition { .. }));
    }

    #[test]
    fn currency_mapping_for_supported_units() {
        assert_eq!(
            cashu_unit_for_currency(Currency::Btc),
            Some(CurrencyUnit::Sat)
        );
        assert_eq!(
            cashu_unit_for_currency(Currency::Usd),
            Some(CurrencyUnit::Usd)
        );
        assert_eq!(cashu_unit_for_currency(Currency::Usdb), None);
    }

    #[test]
    fn number_of_change_blanks_zero_for_zero() {
        assert_eq!(number_of_change_blanks(0), 0);
    }

    #[test]
    fn number_of_change_blanks_at_least_one_for_small_max() {
        // log2(1) = 0 → 1 (TS `|| 1` clause).
        assert_eq!(number_of_change_blanks(1), 1);
        // log2(2) = 1 → ceil = 1.
        assert_eq!(number_of_change_blanks(2), 1);
        // log2(3) ≈ 1.58 → ceil = 2.
        assert_eq!(number_of_change_blanks(3), 2);
        // log2(64) = 6.
        assert_eq!(number_of_change_blanks(64), 6);
    }

    #[test]
    fn select_send_proofs_picks_largest_first() {
        let proofs = vec![
            ProofWithId {
                id: Uuid::new_v4(),
                proof: TokenProof {
                    id: "ks1".into(),
                    amount: 8,
                    secret: "s8".into(),
                    c: "C".into(),
                    dleq: None,
                    witness: None,
                },
            },
            ProofWithId {
                id: Uuid::new_v4(),
                proof: TokenProof {
                    id: "ks1".into(),
                    amount: 64,
                    secret: "s64".into(),
                    c: "C".into(),
                    dleq: None,
                    witness: None,
                },
            },
        ];
        let chosen = select_send_proofs(&proofs, 50, &[]).unwrap();
        assert_eq!(chosen.len(), 1);
        assert_eq!(chosen[0].proof.amount, 64);
    }

    #[test]
    fn select_send_proofs_errors_when_insufficient() {
        let proofs = vec![ProofWithId {
            id: Uuid::new_v4(),
            proof: TokenProof {
                id: "ks1".into(),
                amount: 10,
                secret: "s10".into(),
                c: "C".into(),
                dleq: None,
                witness: None,
            },
        }];
        let err = select_send_proofs(&proofs, 100, &[]).unwrap_err();
        assert!(matches!(err, MeltQuoteError::InsufficientBalance { .. }));
    }
}
