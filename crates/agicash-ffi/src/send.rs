//! FFI send-swap value types.
//!
//! Wrappers around `agicash_cashu::send_swap::{CashuSendSwap, SendQuote,
//! CashuSendSwapState}` flattened into Swift-codable primitives.
//!
//! Three records cover the iOS-facing surface:
//!
//! - [`SendQuotePreview`] — returned from `prepare_send_quote`. Carries
//!   the fee breakdown the confirm screen displays. No persistence
//!   side effect (mirrors `cmd_send --dry-run`).
//! - [`SendSwapHandle`] — returned from `create_send_swap`. Carries the
//!   wire-form token to share + the swap id for polling.
//! - [`SendSwapClaimSnapshot`] — returned from `check_send_swap_claimed`.
//!   A state discriminator the iOS poll loop reacts to.

/// Pre-commit quote shown on the confirmation screen.
///
/// All `Money`-valued fields are decimal-stringified to match the
/// [`crate::receive::ReceiveResult`] convention.
#[derive(Debug, Clone, uniffi::Record)]
pub struct SendQuotePreview {
    /// What the user asked to send (their typed amount).
    pub amount_requested: String,
    /// What is encoded in the token the receiver claims. Equals
    /// `amount_requested + cashu_receive_fee` because the sender
    /// pre-pays the receive fee out of their own proofs.
    pub amount_to_send: String,
    /// `amount_to_send + cashu_send_fee` — total deducted from the
    /// sender's account.
    pub total_amount: String,
    /// `cashu_send_fee + cashu_receive_fee`.
    pub total_fee: String,
    /// Mint fee for the sender's input swap. Zero when the account
    /// already holds exact-amount proofs.
    pub cashu_send_fee: String,
    /// Mint fee the receiver pays when claiming (pre-paid by sender via
    /// the token's encoded value).
    pub cashu_receive_fee: String,
    /// Cashu sub-unit (`sat`, `usd`).
    pub unit: String,
    /// Wallet account currency (`BTC`, `USD`).
    pub currency: String,
    /// UUID of the account the send debits.
    pub account_id: String,
    /// Canonical mint URL.
    pub mint_url: String,
}

/// Handle returned by `create_send_swap`. The swap row is persisted
/// PENDING; `token` is the wire-form V4 string the sender hands to the
/// receiver; `swap_id` is the wallet-side UUID for follow-up polling.
#[derive(Debug, Clone, uniffi::Record)]
pub struct SendSwapHandle {
    /// Wallet-side UUID. Pass to `check_send_swap_claimed`.
    pub swap_id: String,
    /// V4 (`cashuB…`) wire token the sender shares.
    pub token: String,
    /// What the receiver will get on claim. Decimal-stringified.
    pub amount: String,
    /// Total fee paid (decimal-stringified).
    pub fee: String,
    /// Cashu sub-unit (`sat`, `usd`).
    pub unit: String,
    /// Wallet account currency (`BTC`, `USD`).
    pub currency: String,
    /// UUID of the account that was debited.
    pub account_id: String,
    /// Canonical mint URL.
    pub mint_url: String,
}

/// Claim state of a previously-created send swap.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum SendSwapClaimState {
    /// At least one proof in the token is still UNSPENT — receiver
    /// hasn't claimed yet, keep polling.
    Pending,
    /// All proofs are SPENT (or the swap row is already COMPLETED) —
    /// receiver claimed. The poll loop stops here.
    Completed,
    /// Swap is FAILED. Shouldn't happen post-PENDING in practice;
    /// included so the iOS UI can render a terminal error if it does.
    Failed,
}

/// Snapshot returned by `check_send_swap_claimed`.
///
/// `failure_reason` is only populated when `state == Failed`.
#[derive(Debug, Clone, uniffi::Record)]
pub struct SendSwapClaimSnapshot {
    pub state: SendSwapClaimState,
    pub failure_reason: Option<String>,
}
