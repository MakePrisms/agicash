//! Storage trait + DTOs for the receive-swap CRUD surface.
//!
//! Mirrors `app/features/receive/cashu-receive-swap-repository.ts`. Three
//! operations: [`CashuReceiveSwapStorage::create`],
//! [`CashuReceiveSwapStorage::complete`], and [`CashuReceiveSwapStorage::fail`].
//! Each backs onto a Postgres function (`create_cashu_receive_swap`,
//! `complete_cashu_receive_swap`, `fail_cashu_receive_swap`).
//!
//! Encryption is hidden inside the implementation: the trait surface speaks
//! plaintext [`TokenProof`] / [`Money`] / [`Account`], and slice-5's
//! `PassthroughProofEncryption` is plugged in by the Supabase impl. Real
//! encryption arrives in a future slice without touching this surface.
//!
//! This module lives in `agicash-cashu` rather than `agicash-traits` because
//! it depends on [`CashuReceiveSwap`] + [`TokenProof`], which themselves
//! depend on [`Money`] (in `agicash-money`, which depends on
//! `agicash-domain`). Hosting the trait in `agicash-traits` would create a
//! cycle.

use super::types::{CashuReceiveSwap, TokenProof};
use agicash_domain::{Account, AccountId, UserId};
use agicash_money::Money;
use agicash_traits::EncryptionError;
use async_trait::async_trait;
use uuid::Uuid;

#[async_trait]
pub trait CashuReceiveSwapStorage: Send + Sync {
    /// Create a new receive-swap row + reserve a keyset counter range on the
    /// account. Returns the swap (PENDING) and the updated account.
    ///
    /// Returns [`ReceiveSwapStorageError::AlreadyClaimed`] if a swap with the
    /// same `(token_hash, user_id)` already exists (Postgres error code
    /// `23505`).
    async fn create(
        &self,
        input: CreateReceiveSwap,
    ) -> Result<CreateReceiveSwapResult, ReceiveSwapStorageError>;

    /// Complete a PENDING receive swap: store the new proofs and transition
    /// the swap (and its transaction) to COMPLETED. Idempotent if the swap
    /// is already COMPLETED.
    async fn complete(
        &self,
        token_hash: &str,
        user_id: UserId,
        proofs: Vec<TokenProof>,
    ) -> Result<CompleteReceiveSwapResult, ReceiveSwapStorageError>;

    /// Mark a PENDING receive swap as FAILED with `reason`. Idempotent if
    /// already FAILED. Rejects with [`ReceiveSwapStorageError::InvalidState`]
    /// if the swap is COMPLETED.
    async fn fail(
        &self,
        token_hash: &str,
        user_id: UserId,
        reason: &str,
    ) -> Result<CashuReceiveSwap, ReceiveSwapStorageError>;
}

/// Input to [`CashuReceiveSwapStorage::create`].
///
/// `token_*` fields capture the inbound Cashu token (proofs, mint URL, memo);
/// `amount_received` / `fee_amount` / `output_amounts` describe the planned
/// swap with the mint.
#[derive(Debug, Clone, PartialEq)]
pub struct CreateReceiveSwap {
    /// SHA-256 of the encoded token string (the unique key).
    pub token_hash: String,
    /// Proofs being swapped as inputs (NUT-03).
    pub token_proofs: Vec<TokenProof>,
    /// Mint URL the token came from. Must match the account's mint.
    pub token_mint_url: String,
    /// Optional memo from the token.
    pub token_description: Option<String>,
    pub user_id: UserId,
    pub account_id: AccountId,
    /// Active keyset ID used to derive blinded outputs.
    pub keyset_id: String,
    /// Sum of the input proofs in the account currency.
    pub input_amount: Money,
    /// Fee deducted by the mint.
    pub fee_amount: Money,
    /// Amount that lands in the wallet (`input_amount - fee_amount`).
    pub amount_received: Money,
    /// Per-output amounts (the powers-of-two split). `output_amounts.len()`
    /// dictates the keyset counter advance.
    pub output_amounts: Vec<u64>,
    /// When this receive reverses a send swap (offline send retraction),
    /// the corresponding transaction id.
    pub reversed_transaction_id: Option<Uuid>,
}

/// Successful output of [`CashuReceiveSwapStorage::create`].
#[derive(Debug, Clone, PartialEq)]
pub struct CreateReceiveSwapResult {
    pub swap: CashuReceiveSwap,
    pub account: Account,
}

/// Successful output of [`CashuReceiveSwapStorage::complete`].
#[derive(Debug, Clone, PartialEq)]
pub struct CompleteReceiveSwapResult {
    pub swap: CashuReceiveSwap,
    pub account: Account,
    /// Public-key-y identifiers of the proofs that were inserted. Matches
    /// TS's `addedProofs: data.added_proofs.map((x) => x.id)`. Each entry is
    /// the row's `id` (UUID stringified).
    pub added_proofs: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ReceiveSwapStorageError {
    /// Token already claimed by this user (DB unique constraint on
    /// `(token_hash, user_id)`, Postgres error code `23505`).
    #[error("token already claimed")]
    AlreadyClaimed,
    /// No swap row matches the supplied `(token_hash, user_id)`.
    #[error("not found")]
    NotFound,
    /// Server rejected a state transition (e.g. completing an already-FAILED
    /// swap, or failing a COMPLETED one).
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
    use crate::receive_swap::types::CashuReceiveSwapState;
    use agicash_domain::{AccountPurpose, AccountState, AccountType, Currency};
    use agicash_money::Unit;
    use chrono::Utc;
    use rust_decimal::Decimal;
    use serde_json::json;

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

    fn dummy_account() -> Account {
        Account {
            id: AccountId::new(),
            created_at: Utc::now(),
            user_id: UserId::new(),
            name: "Mint".into(),
            account_type: AccountType::Cashu,
            purpose: AccountPurpose::Transactional,
            currency: Currency::Btc,
            details: json!({"mint_url": "https://example.com"}),
            version: 0,
            state: AccountState::Active,
            expires_at: None,
        }
    }

    fn dummy_swap() -> CashuReceiveSwap {
        CashuReceiveSwap {
            token_hash: "deadbeef".into(),
            token_proofs: vec![dummy_proof()],
            token_description: None,
            user_id: UserId::new(),
            account_id: AccountId::new(),
            input_amount: dummy_money(64),
            amount_received: dummy_money(64),
            fee_amount: dummy_money(0),
            keyset_id: "ks1".into(),
            keyset_counter: 0,
            output_amounts: vec![64],
            transaction_id: Uuid::new_v4(),
            created_at: Utc::now(),
            version: 0,
            state: CashuReceiveSwapState::Pending,
        }
    }

    #[test]
    fn create_input_constructs() {
        let input = CreateReceiveSwap {
            token_hash: "hash".into(),
            token_proofs: vec![dummy_proof()],
            token_mint_url: "https://mint.example".into(),
            token_description: Some("memo".into()),
            user_id: UserId::new(),
            account_id: AccountId::new(),
            keyset_id: "ks1".into(),
            input_amount: dummy_money(100),
            fee_amount: dummy_money(1),
            amount_received: dummy_money(99),
            output_amounts: vec![64, 32, 2, 1],
            reversed_transaction_id: None,
        };
        assert_eq!(input.output_amounts.len(), 4);
    }

    #[test]
    fn create_result_constructs() {
        let r = CreateReceiveSwapResult {
            swap: dummy_swap(),
            account: dummy_account(),
        };
        assert_eq!(r.swap.token_hash, "deadbeef");
    }

    #[test]
    fn complete_result_constructs() {
        let r = CompleteReceiveSwapResult {
            swap: dummy_swap(),
            account: dummy_account(),
            added_proofs: vec!["02abc".into()],
        };
        assert_eq!(r.added_proofs.len(), 1);
    }

    #[test]
    fn storage_error_already_claimed_displays() {
        let e = ReceiveSwapStorageError::AlreadyClaimed;
        assert!(e.to_string().contains("already claimed"));
    }

    #[test]
    fn storage_error_from_encryption_error() {
        let inner = EncryptionError::NoKey;
        let e: ReceiveSwapStorageError = inner.into();
        assert!(matches!(e, ReceiveSwapStorageError::Encryption(_)));
    }

    #[test]
    fn storage_error_is_send_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<ReceiveSwapStorageError>();
    }
}
