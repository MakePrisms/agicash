//! Storage trait + DTOs for the mint-quote CRUD surface.
//!
//! Mirrors `app/features/receive/cashu-receive-quote-repository.ts`. Each
//! method backs onto a Postgres function (`create_cashu_receive_quote`,
//! `process_cashu_receive_quote_payment`, `complete_cashu_receive_quote`,
//! `expire_cashu_receive_quote`, `fail_cashu_receive_quote`).
//!
//! Encryption is hidden inside the implementation: the trait surface speaks
//! plaintext [`Money`] / [`TokenProof`] / [`Account`], and slice-5's
//! `PassthroughProofEncryption` is plugged in by the Supabase impl.
//!
//! `mark_cashu_receive_quote_cashu_token_melt_initiated` is intentionally
//! NOT exposed — it is only valid on `CASHU_TOKEN`-typed quotes, which slice 7
//! does not produce.

use super::types::CashuMintQuote;
use crate::receive_swap::TokenProof;
use agicash_domain::{Account, AccountId, UserId};
use agicash_money::Money;
use agicash_traits::EncryptionError;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use uuid::Uuid;

#[async_trait]
pub trait CashuMintQuoteStorage: Send + Sync {
    /// Persist a new UNPAID mint quote (and its draft transaction).
    async fn create(&self, input: CreateMintQuote)
        -> Result<CashuMintQuote, MintQuoteStorageError>;

    /// Transition UNPAID -> PAID. Stores the keyset metadata needed to
    /// reproduce blinded outputs and bumps the account's keyset counter.
    /// Idempotent on PAID/COMPLETED (returns the existing row + account).
    async fn process_payment(
        &self,
        input: ProcessMintQuotePayment,
    ) -> Result<ProcessMintQuotePaymentResult, MintQuoteStorageError>;

    /// Transition PAID -> COMPLETED with the minted proofs. Idempotent on
    /// COMPLETED.
    async fn complete(
        &self,
        input: CompleteMintQuote,
    ) -> Result<CompleteMintQuoteResult, MintQuoteStorageError>;

    /// Transition UNPAID -> EXPIRED. Idempotent on EXPIRED. The server
    /// rejects if the invoice is not yet past `expires_at`.
    async fn expire(&self, quote_id: Uuid) -> Result<CashuMintQuote, MintQuoteStorageError>;

    /// Transition UNPAID -> FAILED with `reason`. Idempotent on FAILED.
    /// Rejects from PAID/COMPLETED.
    async fn fail(
        &self,
        quote_id: Uuid,
        reason: &str,
    ) -> Result<CashuMintQuote, MintQuoteStorageError>;

    /// Fetch a single quote by primary key. Returns
    /// [`MintQuoteStorageError::NotFound`] if absent.
    async fn get(&self, quote_id: Uuid) -> Result<CashuMintQuote, MintQuoteStorageError>;
}

/// Input to [`CashuMintQuoteStorage::create`].
#[derive(Debug, Clone, PartialEq)]
pub struct CreateMintQuote {
    pub user_id: UserId,
    pub account_id: AccountId,
    /// Amount the wallet wants to receive (this is `amountReceived` in the
    /// TS shape).
    pub amount: Money,
    pub description: Option<String>,
    /// Mint-side quote id (plaintext). The repository computes a
    /// SHA-256(quote_id) and sends that as `quote_id_hash`.
    pub quote_id: String,
    pub payment_request: String,
    pub payment_hash: String,
    pub expires_at: DateTime<Utc>,
    /// Empty string in slice 7 (no NUT-20 locking yet); the DB column is
    /// `NOT NULL` so we always send something.
    pub locking_derivation_path: String,
    pub minting_fee: Option<Money>,
    pub total_fee: Money,
}

/// Input to [`CashuMintQuoteStorage::process_payment`].
#[derive(Debug, Clone, PartialEq)]
pub struct ProcessMintQuotePayment {
    pub quote: CashuMintQuote,
    /// Active keyset chosen by the wallet for the blinded outputs.
    pub keyset_id: String,
    /// Per-output denominations (powers of two summing to `quote.amount`).
    pub output_amounts: Vec<u64>,
}

/// Output of [`CashuMintQuoteStorage::process_payment`].
#[derive(Debug, Clone, PartialEq)]
pub struct ProcessMintQuotePaymentResult {
    pub quote: CashuMintQuote,
    pub account: Account,
}

/// Input to [`CashuMintQuoteStorage::complete`].
#[derive(Debug, Clone, PartialEq)]
pub struct CompleteMintQuote {
    pub quote_id: Uuid,
    pub proofs: Vec<TokenProof>,
}

/// Output of [`CashuMintQuoteStorage::complete`].
#[derive(Debug, Clone, PartialEq)]
pub struct CompleteMintQuoteResult {
    pub quote: CashuMintQuote,
    pub account: Account,
    /// Identifiers of the proof rows inserted by the RPC. Matches the TS
    /// `addedProofs: data.added_proofs.map((x) => x.id)`.
    pub added_proofs: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum MintQuoteStorageError {
    /// No quote row matches the supplied id.
    #[error("not found")]
    NotFound,
    /// Server rejected a state transition (e.g. expiring a PAID quote).
    #[error("invalid state transition: {0}")]
    InvalidState(String),
    /// Generic storage-backend failure (network, JSON decoding, postgrest
    /// status code, etc.).
    #[error("storage backend error: {0}")]
    Backend(String),
    /// The encryption seam returned an error.
    #[error("encryption error: {0}")]
    Encryption(#[from] EncryptionError),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::receive_swap::types::TokenProof;
    use agicash_domain::Currency;
    use agicash_money::Unit;
    use rust_decimal::Decimal;

    fn dummy_money(amount: u64) -> Money {
        Money::new(Decimal::from(amount), Currency::Btc, Unit::Sat)
    }

    fn dummy_proof() -> TokenProof {
        TokenProof {
            id: "ks1".into(),
            amount: 64,
            secret: "secret".into(),
            c: "C".into(),
            dleq: None,
            witness: None,
        }
    }

    #[test]
    fn create_input_constructs() {
        let input = CreateMintQuote {
            user_id: UserId::new(),
            account_id: AccountId::new(),
            amount: dummy_money(64),
            description: Some("memo".into()),
            quote_id: "qid".into(),
            payment_request: "lnbc640n1...".into(),
            payment_hash: "deadbeef".into(),
            expires_at: Utc::now(),
            locking_derivation_path: String::new(),
            minting_fee: Some(dummy_money(0)),
            total_fee: dummy_money(0),
        };
        assert_eq!(input.payment_hash, "deadbeef");
    }

    #[test]
    fn complete_input_carries_proofs() {
        let input = CompleteMintQuote {
            quote_id: Uuid::new_v4(),
            proofs: vec![dummy_proof(), dummy_proof()],
        };
        assert_eq!(input.proofs.len(), 2);
    }

    #[test]
    fn storage_error_not_found_displays() {
        let e = MintQuoteStorageError::NotFound;
        assert!(e.to_string().contains("not found"));
    }

    #[test]
    fn storage_error_from_encryption_error() {
        let inner = EncryptionError::NoKey;
        let e: MintQuoteStorageError = inner.into();
        assert!(matches!(e, MintQuoteStorageError::Encryption(_)));
    }

    #[test]
    fn storage_error_is_send_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<MintQuoteStorageError>();
    }
}
