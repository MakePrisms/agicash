//! Errors raised by the receive flow's service layer.
//!
//! Mostly a thin wrapper that lets `ReceiveFlowService` carry
//! `ReceiveSwapError`, storage errors, and mint-add failures uniformly.

use crate::receive_swap::ReceiveSwapError;
use agicash_traits::{CashuProviderError, StorageError};

/// Stable string discriminator for the Failed state's `code` field. Kept as
/// a free constant block (not an enum) so the FFI shape stays string-typed
/// and easy to switch on from Swift / Kotlin / TypeScript.
pub mod code {
    pub const TOKEN_PARSE: &str = "token-parse";
    pub const TOKEN_SPENT: &str = "token-spent";
    pub const MINT_OFFLINE: &str = "mint-offline";
    pub const MINT_ADD_FAILED: &str = "mint-add-failed";
    pub const SWAP_FAILED: &str = "swap-failed";
    pub const ALREADY_CLAIMED: &str = "already-claimed";
    pub const CANCELLED: &str = "cancelled";
    /// Authentication / session failure (e.g. the seed-provider's
    /// `OpenSecret` call returns `Unauthenticated` or `Backend`). Distinct
    /// from `UNKNOWN` so the UI can prompt the user to re-authenticate
    /// instead of showing a generic error.
    pub const AUTH: &str = "auth";
    pub const UNKNOWN: &str = "unknown";
}

#[derive(Debug, thiserror::Error)]
pub enum ReceiveFlowError {
    /// Token failed to parse / proofs decoded to empty.
    #[error("token parse error: {0}")]
    TokenParse(String),

    /// User dispatched an event that the current state doesn't accept.
    #[error("invalid event {event} in state {state}")]
    InvalidEvent { event: String, state: String },

    /// Mint discovery failed (NUT-06).
    #[error("mint discovery failed: {0}")]
    MintDiscovery(#[source] CashuProviderError),

    /// `upsert_user_with_accounts` failed.
    #[error("mint add failed: {0}")]
    MintAdd(#[source] StorageError),

    /// Underlying swap failed.
    #[error("swap failed: {0}")]
    Swap(#[from] ReceiveSwapError),

    /// Generic storage failure (e.g. `list_accounts`).
    #[error("storage error: {0}")]
    Storage(#[from] StorageError),

    /// Auth / session failure (e.g. seed-provider couldn't reach
    /// `OpenSecret`, session expired, backend rejected the token). The
    /// message is suitable for display to a developer; the UI should
    /// surface a friendly "please sign in again" prompt.
    #[error("auth error: {0}")]
    Auth(String),
}

impl ReceiveFlowError {
    /// Map an error to the stable `code` field surfaced on `ReceiveFlowState::Failed`.
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            Self::TokenParse(_) | Self::Swap(ReceiveSwapError::TokenParse(_)) => code::TOKEN_PARSE,
            Self::MintDiscovery(_) => code::MINT_OFFLINE,
            Self::MintAdd(_) => code::MINT_ADD_FAILED,
            Self::Swap(ReceiveSwapError::Storage(
                crate::receive_swap::ReceiveSwapStorageError::AlreadyClaimed,
            )) => code::ALREADY_CLAIMED,
            Self::Swap(_) => code::SWAP_FAILED,
            Self::Auth(_) => code::AUTH,
            Self::InvalidEvent { .. } | Self::Storage(_) => code::UNKNOWN,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_error_code_is_token_parse() {
        let e = ReceiveFlowError::TokenParse("bad".into());
        assert_eq!(e.code(), code::TOKEN_PARSE);
    }

    #[test]
    fn invalid_event_code_is_unknown() {
        let e = ReceiveFlowError::InvalidEvent {
            event: "Confirm".into(),
            state: "Idle".into(),
        };
        assert_eq!(e.code(), code::UNKNOWN);
    }

    #[test]
    fn swap_already_claimed_maps_to_already_claimed_code() {
        let e = ReceiveFlowError::Swap(ReceiveSwapError::Storage(
            crate::receive_swap::ReceiveSwapStorageError::AlreadyClaimed,
        ));
        assert_eq!(e.code(), code::ALREADY_CLAIMED);
    }

    #[test]
    fn auth_error_code_is_auth() {
        let e = ReceiveFlowError::Auth("session expired".into());
        assert_eq!(e.code(), code::AUTH);
    }

    #[test]
    fn mint_discovery_maps_to_mint_offline_code() {
        let e = ReceiveFlowError::MintDiscovery(CashuProviderError::Network("timeout".into()));
        assert_eq!(e.code(), code::MINT_OFFLINE);
    }

    #[test]
    fn error_is_send_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<ReceiveFlowError>();
    }
}
