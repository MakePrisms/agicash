//! FFI receive value types.
//!
//! `ReceiveResult` is what the Swift side receives after a successful Cashu
//! token redeem. The shape mirrors the CLI's `ReceiveOutput` JSON
//! (`crates/agicash-cli/src/receive.rs`) but flattens into Swift-codable
//! primitives the iOS app can render directly.
//!
//! `ReceiveStatus` discriminates the three terminal outcomes the underlying
//! `CashuReceiveSwapService::complete_swap` can return: a fresh successful
//! claim, an idempotent re-claim of an already-completed swap, and the
//! "someone else got there first" failure mode. The iOS app surfaces each
//! distinctly (success toast vs. error inline).

/// Status discriminator for [`ReceiveResult`]. Mirrors the JSON `status`
/// field the CLI emits — three terminal cases the Swift side switches on.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum ReceiveStatus {
    /// Token was claimed for the first time and proofs are now in the
    /// wallet. `amount` is the credited value (after mint fees).
    Received,
    /// The same token was claimed by this user before — the swap row was
    /// already in `Completed` state. Idempotent return; nothing was minted
    /// twice.
    AlreadyClaimed,
    /// Token was already spent/claimed elsewhere (different wallet, or
    /// previously failed). Surfaces as an error in the UI.
    AlreadyFailed,
    /// Swap is still in flight (rare; the receive flow normally drives to
    /// terminal in one round-trip). Treated as a soft state by the UI.
    Pending,
}

/// Outcome of [`crate::wallet::AgicashWallet::receive_token`].
///
/// All amounts are decimal-stringified (matching the CLI JSON shape) so
/// Swift consumers don't need to thread Rust's `Decimal` through the FFI
/// boundary. `unit` is the cashu sub-unit (`sat` / `usd` / etc.) and
/// `currency` is the wallet's account currency (`BTC` / `USD` / `USDB`).
#[derive(Debug, Clone, uniffi::Record)]
pub struct ReceiveResult {
    pub status: ReceiveStatus,
    /// Amount credited after mint fees. Decimal-stringified.
    pub amount: String,
    /// Mint fee deducted from the input proofs. Decimal-stringified.
    pub fee: String,
    /// Cashu sub-unit (`sat`, `cent`, etc.).
    pub unit: String,
    /// Wallet account currency (`BTC`, `USD`, `USDB`).
    pub currency: String,
    /// Stringified UUID of the account that received the proofs.
    pub account_id: String,
    /// Mint URL the token was redeemed against (canonical, no trailing
    /// slash normalization is applied at the FFI seam — the iOS app
    /// renders whatever the swap row carries).
    pub mint_url: String,
    /// SHA-256 hex of the encoded token. Useful for receipts and
    /// dedupe-by-hash UI.
    pub token_hash: String,
}
