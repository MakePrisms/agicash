//! Send-swap error type.
//!
//! Bundles together storage failures, mint protocol failures, and the
//! validation checks the service performs against the requested amount +
//! account proofs before it begins.

use super::storage::SendSwapStorageError;
use agicash_traits::CashuProviderError;

#[derive(Debug, thiserror::Error)]
pub enum SendSwapError {
    /// State machine asked to apply an event from a state that doesn't
    /// accept it. Implementations should not surface this to users.
    #[error("invalid state transition from {from} on event {event}")]
    InvalidTransition { from: String, event: String },

    /// Underlying storage backend failed.
    #[error("storage error: {0}")]
    Storage(#[from] SendSwapStorageError),

    /// CDK / mint network or protocol failure.
    #[error("mint error: {0}")]
    Mint(#[from] CashuProviderError),

    /// Account proof balance can't cover requested amount + estimated fees.
    #[error("insufficient balance: need {needed}, have {have}")]
    InsufficientBalance { needed: String, have: String },

    /// After accounting for fees, the requested amount is non-positive.
    #[error("amount too small after fees")]
    AmountTooSmall,

    /// Account currency disagrees with the requested send amount.
    #[error("currency mismatch: account {account} differs from request {request}")]
    CurrencyMismatch { account: String, request: String },

    /// CDK token encode failed.
    #[error("token encode error: {0}")]
    TokenEncode(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_transition_displays_both_sides() {
        let e = SendSwapError::InvalidTransition {
            from: "Pending".into(),
            event: "FailSwap".into(),
        };
        let s = e.to_string();
        assert!(s.contains("Pending"));
        assert!(s.contains("FailSwap"));
    }

    #[test]
    fn insufficient_balance_includes_both_amounts() {
        let e = SendSwapError::InsufficientBalance {
            needed: "100".into(),
            have: "50".into(),
        };
        let s = e.to_string();
        assert!(s.contains("100"));
        assert!(s.contains("50"));
    }

    #[test]
    fn currency_mismatch_includes_both_currencies() {
        let e = SendSwapError::CurrencyMismatch {
            account: "BTC".into(),
            request: "USD".into(),
        };
        let s = e.to_string();
        assert!(s.contains("BTC"));
        assert!(s.contains("USD"));
    }

    #[test]
    fn error_is_send_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<SendSwapError>();
    }
}
