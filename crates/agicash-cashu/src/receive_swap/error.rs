//! Receive-swap error type.
//!
//! Bundles together storage failures, mint protocol failures, parsing
//! failures, and the validation checks the service performs against the
//! token + account before it begins.

use super::storage::ReceiveSwapStorageError;
use agicash_traits::CashuProviderError;

#[derive(Debug, thiserror::Error)]
pub enum ReceiveSwapError {
    /// State machine asked to apply an event from a state that doesn't
    /// accept it. Implementations should not surface this to users.
    #[error("invalid state transition from {from} on event {event}")]
    InvalidTransition { from: String, event: String },

    /// Underlying storage backend failed.
    #[error("storage error: {0}")]
    Storage(#[from] ReceiveSwapStorageError),

    /// CDK / mint network or protocol failure.
    #[error("mint error: {0}")]
    Mint(#[from] CashuProviderError),

    /// Token string could not be parsed.
    #[error("token parse error: {0}")]
    TokenParse(String),

    /// After deducting mint fees, the token is too small to claim.
    #[error("amount too small after fees")]
    AmountTooSmall,

    /// Token references a mint URL that doesn't match the account's mint.
    #[error("mint URL mismatch: token mint {token} differs from account mint {account}")]
    MintMismatch { token: String, account: String },

    /// Token unit doesn't map to the account's currency.
    #[error("currency mismatch: token currency {token} differs from account currency {account}")]
    CurrencyMismatch { token: String, account: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_transition_displays_both_sides() {
        let e = ReceiveSwapError::InvalidTransition {
            from: "Completed".into(),
            event: "SwapCompleted".into(),
        };
        let s = e.to_string();
        assert!(s.contains("Completed"));
        assert!(s.contains("SwapCompleted"));
    }

    #[test]
    fn mint_mismatch_includes_both_urls() {
        let e = ReceiveSwapError::MintMismatch {
            token: "https://a".into(),
            account: "https://b".into(),
        };
        let s = e.to_string();
        assert!(s.contains("https://a"));
        assert!(s.contains("https://b"));
    }

    #[test]
    fn error_is_send_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<ReceiveSwapError>();
    }
}
