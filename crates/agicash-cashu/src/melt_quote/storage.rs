//! Storage trait + DTOs for the melt-quote CRUD surface.
//!
//! Mirrors `app/features/send/cashu-send-quote-repository.ts`. Each method
//! backs onto a Postgres function (`create_cashu_send_quote`,
//! `mark_cashu_send_quote_as_pending`, `complete_cashu_send_quote`,
//! `expire_cashu_send_quote`, `fail_cashu_send_quote`).
//!
//! Encryption is hidden inside the implementation: the trait surface
//! speaks plaintext [`Money`] / [`TokenProof`] / [`Account`], and slice
//! 5's `PassthroughProofEncryption` is plugged in by the Supabase impl.

use super::types::CashuMeltQuote;
use crate::receive_swap::TokenProof;
use agicash_domain::{Account, AccountId, UserId};
use agicash_money::Money;
use agicash_traits::EncryptionError;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use uuid::Uuid;

#[async_trait]
pub trait CashuMeltQuoteStorage: Send + Sync {
    /// Persist a new UNPAID melt quote, reserving the chosen input proofs
    /// and bumping the account's keyset counter by
    /// `input.number_of_change_outputs`.
    async fn create(
        &self,
        input: CreateMeltQuote,
    ) -> Result<CreateMeltQuoteResult, MeltQuoteStorageError>;

    /// Transition UNPAID -> PENDING. Idempotent on PENDING (returns the
    /// existing row). Rejects from PAID/FAILED/EXPIRED with
    /// [`MeltQuoteStorageError::InvalidState`].
    async fn mark_as_pending(
        &self,
        quote_id: Uuid,
    ) -> Result<CashuMeltQuote, MeltQuoteStorageError>;

    /// Transition UNPAID/PENDING -> PAID with change proofs. Idempotent
    /// on PAID (returns existing row + account + already-spent proofs +
    /// already-credited change proofs).
    async fn complete(
        &self,
        input: CompleteMeltQuote,
    ) -> Result<CompleteMeltQuoteResult, MeltQuoteStorageError>;

    /// UNPAID -> EXPIRED. Idempotent on EXPIRED. Server-side guard
    /// rejects when the invoice has not yet passed its `expires_at`.
    async fn expire(&self, quote_id: Uuid) -> Result<CashuMeltQuote, MeltQuoteStorageError>;

    /// UNPAID/PENDING -> FAILED. Idempotent on FAILED. Server-side guard
    /// rejects from PAID/EXPIRED.
    async fn fail(
        &self,
        quote_id: Uuid,
        reason: &str,
    ) -> Result<CashuMeltQuote, MeltQuoteStorageError>;

    /// Fetch a single quote by primary key. Returns
    /// [`MeltQuoteStorageError::NotFound`] if absent.
    async fn get(&self, quote_id: Uuid) -> Result<CashuMeltQuote, MeltQuoteStorageError>;
}

/// Input to [`CashuMeltQuoteStorage::create`].
#[derive(Debug, Clone, PartialEq)]
pub struct CreateMeltQuote {
    pub user_id: UserId,
    pub account_id: AccountId,
    pub payment_request: String,
    pub payment_hash: String,
    pub expires_at: DateTime<Utc>,
    /// Mint-side melt quote id (plaintext); SHA-256 of this becomes
    /// `quote_id_hash` on the DB row.
    pub quote_id: String,
    pub amount_requested: Money,
    pub amount_requested_in_msat: u64,
    /// Amount the receiver will get, in the account's currency.
    pub amount_received: Money,
    pub lightning_fee_reserve: Money,
    pub cashu_fee: Money,
    /// Proofs reserved for the send.
    pub proofs: Vec<TokenProof>,
    /// DB row ids of the proofs to reserve (matches TS
    /// `inputProofs.map((p) => p.id)`).
    pub proof_ids: Vec<Uuid>,
    /// Sum of `proofs` in the account's currency.
    pub amount_reserved: Money,
    pub keyset_id: String,
    pub number_of_change_outputs: u32,
}

/// Output of [`CashuMeltQuoteStorage::create`].
#[derive(Debug, Clone, PartialEq)]
pub struct CreateMeltQuoteResult {
    pub quote: CashuMeltQuote,
    pub account: Account,
}

/// Input to [`CashuMeltQuoteStorage::complete`].
#[derive(Debug, Clone, PartialEq)]
pub struct CompleteMeltQuote {
    pub quote: CashuMeltQuote,
    pub payment_preimage: String,
    /// Amount actually spent (proofs reserved minus change). Used to
    /// compute `lightning_fee = amount_spent - amount_received -
    /// cashu_fee`.
    pub amount_spent: Money,
    /// Change proofs (NUT-08 fee-reserve refund). May be empty if the
    /// mint charged the full reserve.
    pub change_proofs: Vec<TokenProof>,
}

/// Output of [`CashuMeltQuoteStorage::complete`].
#[derive(Debug, Clone, PartialEq)]
pub struct CompleteMeltQuoteResult {
    pub quote: CashuMeltQuote,
    pub account: Account,
    /// IDs of the change-proof rows the RPC inserted (mirrors TS
    /// `data.change_proofs.map((x) => x.id)`).
    pub added_change_proofs: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum MeltQuoteStorageError {
    /// The DB rejected reserving the chosen input proofs because they
    /// were modified by a concurrent transaction
    /// (`hint = 'CONCURRENCY_ERROR'`).
    #[error("concurrent modification: {0}")]
    Concurrency(String),
    /// No quote row matches the supplied id.
    #[error("not found")]
    NotFound,
    /// Server rejected a state transition.
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
        let input = CreateMeltQuote {
            user_id: UserId::new(),
            account_id: AccountId::new(),
            payment_request: "lnbc640n1...".into(),
            payment_hash: "deadbeef".into(),
            expires_at: Utc::now(),
            quote_id: "qid".into(),
            amount_requested: dummy_money(64),
            amount_requested_in_msat: 64_000,
            amount_received: dummy_money(64),
            lightning_fee_reserve: dummy_money(1),
            cashu_fee: dummy_money(0),
            proofs: vec![dummy_proof()],
            proof_ids: vec![Uuid::new_v4()],
            amount_reserved: dummy_money(64),
            keyset_id: "ks1".into(),
            number_of_change_outputs: 1,
        };
        assert_eq!(input.payment_hash, "deadbeef");
        assert_eq!(input.proof_ids.len(), 1);
    }

    #[test]
    fn complete_input_carries_change_proofs() {
        let q = CashuMeltQuote {
            id: Uuid::new_v4(),
            quote_id: "q".into(),
            user_id: UserId::new(),
            account_id: AccountId::new(),
            payment_request: "lnbc".into(),
            payment_hash: "h".into(),
            amount_requested: dummy_money(64),
            amount_requested_in_msat: 64_000,
            amount_received: dummy_money(64),
            lightning_fee_reserve: dummy_money(1),
            cashu_fee: dummy_money(0),
            proofs: vec![dummy_proof()],
            amount_reserved: dummy_money(64),
            keyset_id: "ks1".into(),
            keyset_counter: 0,
            number_of_change_outputs: 1,
            transaction_id: Uuid::new_v4(),
            created_at: Utc::now(),
            expires_at: Utc::now(),
            version: 0,
            state: super::super::types::CashuMeltQuoteState::Pending,
        };
        let input = CompleteMeltQuote {
            quote: q,
            payment_preimage: "preimage".into(),
            amount_spent: dummy_money(63),
            change_proofs: vec![dummy_proof(), dummy_proof()],
        };
        assert_eq!(input.change_proofs.len(), 2);
        assert_eq!(input.payment_preimage, "preimage");
    }

    #[test]
    fn storage_error_not_found_displays() {
        let e = MeltQuoteStorageError::NotFound;
        assert!(e.to_string().contains("not found"));
    }

    #[test]
    fn storage_error_from_encryption_error() {
        let inner = EncryptionError::NoKey;
        let e: MeltQuoteStorageError = inner.into();
        assert!(matches!(e, MeltQuoteStorageError::Encryption(_)));
    }

    #[test]
    fn storage_error_concurrency_displays() {
        let e = MeltQuoteStorageError::Concurrency("two writers".into());
        assert!(e.to_string().contains("concurrent"));
    }

    #[test]
    fn storage_error_is_send_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<MeltQuoteStorageError>();
    }
}
