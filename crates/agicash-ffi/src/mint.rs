//! FFI mint value types.
//!
//! `MintAddResult` is what the Swift side receives after a successful
//! `wallet.mint_add(url)` call. The shape mirrors the CLI's `MintAddOutput`
//! JSON (`crates/agicash-cli/src/mint.rs`) but flattens into Swift-codable
//! primitives the iOS app can render directly — plus echoes back the mint
//! URL and currency so the Add Mint sheet can surface a "Added <name> at
//! <url>" toast without a follow-up `list_accounts` round-trip.
//!
//! The wallet exposes only `mint_add(url: String)` for now; the iOS UI hard-
//! codes BTC (matching the web's `add-mint-form.tsx` which also hard-codes
//! `ACCOUNT_CURRENCY = 'BTC'`). Currency selection lands later if we ever
//! ship the multi-currency picker the web doesn't have either.

/// Outcome of [`crate::wallet::AgicashWallet::mint_add`].
///
/// Mirrors the CLI's `MintAddOutput` (`crates/agicash-cli/src/mint.rs`):
/// the new account row's id + name, plus the canonical mint URL the row
/// was created against. Useful for an "Added <name>" toast and to navigate
/// the Accounts screen back to the newly-created row without an extra
/// `list_accounts` round-trip.
#[derive(Debug, Clone, uniffi::Record)]
pub struct MintAddResult {
    /// Stringified UUID of the new `wallet.accounts` row.
    pub account_id: String,
    /// Human-readable mint name (NUT-06 `name`, falling back to the URL
    /// itself when the mint doesn't supply one).
    pub mint_name: String,
    /// Canonical mint URL (parsed through `MintUrl`, so trailing-slash
    /// normalized).
    pub mint_url: String,
    /// Currency code the account was created with — always `"BTC"` for
    /// now, but exposed so the iOS UI can render it in the success state
    /// without a separate lookup.
    pub currency: String,
}
