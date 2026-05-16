//! Mint-quote error type.
//!
//! Bundles together storage failures, mint protocol failures, and the
//! validation checks the service performs against the requested amount +
//! account before it begins.

use super::storage::MintQuoteStorageError;
use crate::dleq::DleqVerificationError;
use agicash_traits::CashuProviderError;

#[derive(Debug, thiserror::Error)]
pub enum MintQuoteError {
    /// State machine asked to apply an event from a state that doesn't
    /// accept it.
    #[error("invalid state transition from {from} on event {event}")]
    InvalidTransition { from: String, event: String },

    /// Underlying storage backend failed.
    #[error("storage error: {0}")]
    Storage(#[from] MintQuoteStorageError),

    /// CDK / mint network or protocol failure.
    #[error("mint error: {0}")]
    Mint(#[from] CashuProviderError),

    /// Requested amount is below the mint's minimum.
    #[error("amount too small")]
    AmountTooSmall,

    /// Requested currency doesn't map to a known mint unit, or doesn't
    /// match the account's currency.
    #[error("currency mismatch: account {account} differs from request {request}")]
    CurrencyMismatch { account: String, request: String },

    /// Caller asked to complete an UNPAID quote.
    #[error("quote not yet paid")]
    QuoteNotPaid,

    /// Quote already expired (caller should call `expire`).
    #[error("quote expired before payment")]
    QuoteExpired,

    /// Mint reported `ISSUED` but no proofs are recoverable via restore.
    #[error("mint quote unrecoverable: {0}")]
    Unrecoverable(String),

    /// NUT-12 DLEQ verification failed on a mint-returned blind
    /// signature. Mint is malicious or compromised.
    #[error("DLEQ verification failed: {0}")]
    DleqVerificationFailed(#[from] DleqVerificationError),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_transition_displays_both_sides() {
        let e = MintQuoteError::InvalidTransition {
            from: "Completed".into(),
            event: "MintSucceeded".into(),
        };
        let s = e.to_string();
        assert!(s.contains("Completed"));
        assert!(s.contains("MintSucceeded"));
    }

    #[test]
    fn currency_mismatch_includes_both() {
        let e = MintQuoteError::CurrencyMismatch {
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
        assert_send_sync::<MintQuoteError>();
    }
}
