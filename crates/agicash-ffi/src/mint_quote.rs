//! FFI mint-quote (Lightning receive) value types.
//!
//! Wrappers around `agicash_cashu::mint_quote::{CashuMintQuote,
//! CashuMintQuoteState}` flattened into Swift-codable primitives.
//!
//! The Rust-side domain shape carries `Money` (which is Decimal-typed) and a
//! per-state enum with conditional `keyset_id` / `output_amounts` payload.
//! The Swift consumer doesn't need any of the internal state machinery — it
//! only needs to know which terminal bucket the quote is in (so it can
//! render UNPAID vs PAID vs COMPLETED vs FAILED) and the visible BOLT-11 +
//! amount fields. Two FFI records cover both shapes:
//!
//! - [`MintQuoteHandle`] — returned from `start_mint_quote`. Carries the
//!   BOLT-11 invoice, both quote ids (wallet-side UUID for subsequent
//!   `poll`/`complete` calls, mint-side string id surfaced only for
//!   transparency / debugging), the requested amount + fee, and the expiry
//!   so the iOS UI can show a countdown.
//! - [`MintQuoteSnapshot`] — returned from `poll_mint_quote`. A bare state
//!   discriminator plus optional `failure_reason` for FAILED quotes.
//!
//! `complete_mint_quote` reuses the existing [`crate::receive::ReceiveResult`]
//! shape so the success state can be rendered identically to a Cashu-token
//! receive — same headline, same amount/unit/account display.

/// Lightning receive handle. Mirrors the CLI's `QuoteIssuedOutput` JSON
/// (`crates/agicash-cli/src/receive_lightning.rs`) but with the Swift-side
/// fields the carousel's `LightningReceiveView` needs to render:
/// - `invoice` for the QR code + copy-to-clipboard,
/// - `quote_id` / `mint_quote_id` for follow-up FFI calls,
/// - `amount` + `fee` for the breakdown card,
/// - `expires_at` for the countdown timer.
///
/// `quote_id` is the **wallet-side** UUID (Supabase `wallet.mint_quotes` PK)
/// — that's what `poll_mint_quote` and `complete_mint_quote` expect.
/// `mint_quote_id` is the mint-side string identifier returned by NUT-04
/// `POST /v1/mint/quote/bolt11`; exposed for receipt/debugging only.
#[derive(Debug, Clone, uniffi::Record)]
pub struct MintQuoteHandle {
    /// Wallet-side UUID of the persisted quote row. Pass this to
    /// `poll_mint_quote` and `complete_mint_quote`.
    pub quote_id: String,
    /// Mint-side NUT-04 quote id string. Informational; not used for
    /// follow-up FFI calls.
    pub mint_quote_id: String,
    /// BOLT-11 payment request the user pays.
    pub invoice: String,
    /// Hex-encoded BOLT-11 payment hash.
    pub payment_hash: String,
    /// Amount credited on completion. Decimal-stringified (matches the
    /// `ReceiveResult.amount` convention).
    pub amount: String,
    /// Mint fee added to the invoice amount. Decimal-stringified.
    /// `"0"` when the mint charges nothing.
    pub fee: String,
    /// Cashu sub-unit (`sat`, `usd`).
    pub unit: String,
    /// Wallet account currency (`BTC`, `USD`).
    pub currency: String,
    /// UUID of the account that will receive the proofs.
    pub account_id: String,
    /// ISO 8601 timestamp at which the invoice expires.
    pub expires_at: String,
}

/// Lifecycle state for a [`MintQuoteHandle`]. Mirrors
/// `agicash_cashu::mint_quote::CashuMintQuoteState` but flattens the
/// per-state payload out (the iOS UI never needs the keyset metadata —
/// `complete_mint_quote` does the proof minting internally).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum MintQuoteFfiState {
    /// Invoice issued, awaiting payment.
    Unpaid,
    /// Mint detected payment; iOS should now call `complete_mint_quote`
    /// to mint proofs.
    Paid,
    /// Proofs minted; quote is fully complete. `complete_mint_quote`
    /// returns `ReceiveResult` instead of re-walking the machine.
    Completed,
    /// Invoice expired without payment.
    Expired,
    /// Operational failure (mint rejected, already-issued with no
    /// recoverable proofs).
    Failed,
}

/// Snapshot returned by [`crate::wallet::AgicashWallet::poll_mint_quote`].
///
/// `failure_reason` is only populated when `state == Failed`; for the
/// other states it is `None`.
#[derive(Debug, Clone, uniffi::Record)]
pub struct MintQuoteSnapshot {
    pub state: MintQuoteFfiState,
    pub failure_reason: Option<String>,
}
