//! Melt-quote error type.
//!
//! Bundles together storage failures, mint protocol failures, and the
//! validation checks the service performs against the requested invoice +
//! account before it begins.

use super::storage::MeltQuoteStorageError;
use agicash_traits::CashuProviderError;

#[derive(Debug, thiserror::Error)]
pub enum MeltQuoteError {
    /// State machine asked to apply an event from a state that doesn't
    /// accept it.
    #[error("invalid state transition from {from} on event {event}")]
    InvalidTransition { from: String, event: String },

    /// Underlying storage backend failed.
    #[error("storage error: {0}")]
    Storage(#[from] MeltQuoteStorageError),

    /// CDK / mint network or protocol failure.
    #[error("mint error: {0}")]
    Mint(#[from] CashuProviderError),

    /// BOLT-11 invoice did not parse.
    #[error("invalid bolt11 invoice: {0}")]
    InvalidInvoice(String),

    /// Invoice carried no amount (NUT-05 amountless support deferred).
    #[error("amountless invoice not supported")]
    AmountlessInvoice,

    /// Requested amount is below the mint's minimum / converted to zero.
    #[error("amount too small")]
    AmountTooSmall,

    /// Account currency disagrees with what the mint quoted.
    #[error("currency mismatch: account {account} differs from request {request}")]
    CurrencyMismatch { account: String, request: String },

    /// Account proof balance can't cover amount + fees.
    #[error("insufficient balance: need {needed}, have {have}")]
    InsufficientBalance { needed: String, have: String },

    /// Invoice expired before we could initiate the melt.
    #[error("quote expired before payment")]
    QuoteExpired,

    /// Caller asked to poll an UNPAID quote (no melt initiated yet).
    #[error("quote not yet pending")]
    QuoteNotPending,

    /// Mint reported the melt failed.
    #[error("melt failed at mint: {0}")]
    MeltFailed(String),

    /// Operational state we can't recover from automatically.
    #[error("melt unrecoverable: {0}")]
    Unrecoverable(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_transition_displays_both_sides() {
        let e = MeltQuoteError::InvalidTransition {
            from: "Paid".into(),
            event: "InitiateMelt".into(),
        };
        let s = e.to_string();
        assert!(s.contains("Paid"));
        assert!(s.contains("InitiateMelt"));
    }

    #[test]
    fn currency_mismatch_includes_both() {
        let e = MeltQuoteError::CurrencyMismatch {
            account: "BTC".into(),
            request: "USD".into(),
        };
        let s = e.to_string();
        assert!(s.contains("BTC"));
        assert!(s.contains("USD"));
    }

    #[test]
    fn insufficient_balance_includes_amounts() {
        let e = MeltQuoteError::InsufficientBalance {
            needed: "100".into(),
            have: "50".into(),
        };
        let s = e.to_string();
        assert!(s.contains("100"));
        assert!(s.contains("50"));
    }

    #[test]
    fn error_is_send_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<MeltQuoteError>();
    }
}
