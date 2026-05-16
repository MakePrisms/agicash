//! Storage trait + DTOs for the send-swap CRUD surface.
//!
//! Mirrors `app/features/send/cashu-send-swap-repository.ts`. Four
//! operations: [`CashuSendSwapStorage::create`],
//! [`CashuSendSwapStorage::commit_proofs_to_send`],
//! [`CashuSendSwapStorage::complete`], and [`CashuSendSwapStorage::fail`].
//! Each backs onto a Postgres function (`create_cashu_send_swap`,
//! `commit_proofs_to_send`, `complete_cashu_send_swap`, `fail_cashu_send_swap`).
//!
//! Encryption is hidden inside the impl: the trait surface speaks plaintext
//! [`TokenProof`] / [`Money`] / [`Account`], and slice 5's
//! `PassthroughProofEncryption` plugs in via the Supabase impl. Real
//! encryption arrives in a future slice without touching this surface.
//!
//! This module lives in `agicash-cashu` (alongside the receive-swap storage)
//! rather than `agicash-traits` because it depends on [`CashuSendSwap`] +
//! [`TokenProof`], which themselves depend on [`Money`] (in `agicash-money`,
//! which depends on `agicash-domain`). Hosting the trait in `agicash-traits`
//! would create a cycle.

use super::types::{CashuSendSwap, OutputAmounts};
use crate::receive_swap::TokenProof;
use agicash_domain::{Account, AccountId, UserId};
use agicash_money::Money;
use agicash_traits::EncryptionError;
use async_trait::async_trait;
use uuid::Uuid;

#[async_trait]
pub trait CashuSendSwapStorage: Send + Sync {
    /// Create a send-swap row, reserving the chosen input proofs from the
    /// account. If `input_amount != amount_to_send`, the swap starts DRAFT
    /// (input swap with mint required). Otherwise PENDING (proofs ARE the
    /// proofs-to-send).
    async fn create(
        &self,
        input: CreateSendSwap,
    ) -> Result<CreateSendSwapResult, SendSwapStorageError>;

    /// Persist swapped proofs and transition DRAFT → PENDING.
    /// `proofs_to_send` stay reserved for the swap; `change_proofs` flow
    /// back into the account as UNSPENT.
    async fn commit_proofs_to_send(
        &self,
        input: CommitProofsToSend,
    ) -> Result<CashuSendSwap, SendSwapStorageError>;

    /// PENDING → COMPLETED. Idempotent on COMPLETED.
    async fn complete(&self, swap_id: Uuid) -> Result<CashuSendSwap, SendSwapStorageError>;

    /// DRAFT → FAILED with `reason`. Idempotent on FAILED. Rejects from
    /// PENDING/COMPLETED with [`SendSwapStorageError::InvalidState`].
    async fn fail(
        &self,
        swap_id: Uuid,
        reason: &str,
    ) -> Result<CashuSendSwap, SendSwapStorageError>;
}

/// Input to [`CashuSendSwapStorage::create`].
///
/// Three "amount" Money fields look very similar — see the per-field doc for
/// what each one captures (sender pays the sum of `amount_to_send` +
/// `cashu_send_fee`, encoded into a token at `amount_to_send`).
#[derive(Debug, Clone, PartialEq)]
pub struct CreateSendSwap {
    pub account_id: AccountId,
    pub user_id: UserId,
    pub token_mint_url: String,
    /// What the receiver will end up with after they claim the token.
    pub amount_requested: Money,
    /// `amount_requested + cashu_receive_fee` — what the produced token
    /// encodes (proofs-to-send sum to this amount).
    pub amount_to_send: Money,
    /// `amount_to_send + cashu_send_fee` — what gets deducted from the
    /// account total.
    pub total_amount: Money,
    pub cashu_send_fee: Money,
    pub cashu_receive_fee: Money,
    /// Proofs reserved from the account as inputs to the swap.
    pub input_proofs: Vec<TokenProof>,
    /// Sum of `input_proofs` in the account's currency.
    pub input_amount: Money,
    /// Proof-id list the storage layer reserves on the account row.
    /// Mirrors TS `inputProofs.map((p) => p.id)`.
    pub input_proof_ids: Vec<Uuid>,
    /// Set only when `input_amount == amount_to_send` (no swap needed —
    /// the input proofs are the token).
    pub token_hash: Option<String>,
    /// Set only when input swap required.
    pub keyset_id: Option<String>,
    /// Set only when input swap required.
    pub output_amounts: Option<OutputAmounts>,
}

/// Successful output of [`CashuSendSwapStorage::create`].
#[derive(Debug, Clone, PartialEq)]
pub struct CreateSendSwapResult {
    pub swap: CashuSendSwap,
    pub account: Account,
}

/// Input to [`CashuSendSwapStorage::commit_proofs_to_send`].
#[derive(Debug, Clone, PartialEq)]
pub struct CommitProofsToSend {
    pub swap_id: Uuid,
    pub token_hash: String,
    /// Proofs the receiver will claim (kept RESERVED on the swap row).
    pub proofs_to_send: Vec<TokenProof>,
    /// Change proofs from the input swap (added back to the account UNSPENT).
    pub change_proofs: Vec<TokenProof>,
}

#[derive(Debug, thiserror::Error)]
pub enum SendSwapStorageError {
    /// The DB rejected reserving the chosen input proofs because they were
    /// modified by a concurrent transaction
    /// (`hint = 'CONCURRENCY_ERROR'`).
    #[error("concurrent modification: {0}")]
    Concurrency(String),
    /// No swap row matches the supplied id.
    #[error("not found")]
    NotFound,
    /// Server rejected a state transition (e.g. completing a DRAFT swap, or
    /// failing a PENDING/COMPLETED one).
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
    use crate::receive_swap::TokenProof;
    use crate::send_swap::types::{CashuSendSwapState, OutputAmounts};
    use agicash_domain::{AccountId, AccountPurpose, AccountState, AccountType, Currency, UserId};
    use agicash_money::Unit;
    use chrono::Utc;
    use rust_decimal::Decimal;
    use serde_json::json;

    fn dummy_money(amount: u64) -> Money {
        Money::new(Decimal::from(amount), Currency::Btc, Unit::Sat)
    }

    fn dummy_proof(amount: u64) -> TokenProof {
        TokenProof {
            id: "ks1".into(),
            amount,
            secret: format!("s{amount}"),
            c: format!("C{amount}"),
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

    fn dummy_swap() -> CashuSendSwap {
        CashuSendSwap {
            id: Uuid::new_v4(),
            account_id: AccountId::new(),
            user_id: UserId::new(),
            input_proofs: vec![dummy_proof(64)],
            input_amount: dummy_money(64),
            amount_received: dummy_money(60),
            cashu_receive_fee: dummy_money(0),
            amount_to_send: dummy_money(60),
            cashu_send_fee: dummy_money(4),
            amount_spent: dummy_money(64),
            total_fee: dummy_money(4),
            keyset_id: Some("ks1".into()),
            keyset_counter: Some(3),
            output_amounts: Some(OutputAmounts {
                send: vec![32, 16, 8, 4],
                change: vec![],
            }),
            transaction_id: Uuid::new_v4(),
            created_at: Utc::now(),
            version: 0,
            state: CashuSendSwapState::Draft,
        }
    }

    #[test]
    fn create_send_swap_input_constructs() {
        let input = CreateSendSwap {
            account_id: AccountId::new(),
            user_id: UserId::new(),
            token_mint_url: "https://m.test".into(),
            amount_requested: dummy_money(100),
            amount_to_send: dummy_money(101),
            total_amount: dummy_money(105),
            cashu_send_fee: dummy_money(4),
            cashu_receive_fee: dummy_money(1),
            input_proofs: vec![dummy_proof(64), dummy_proof(64)],
            input_amount: dummy_money(128),
            input_proof_ids: vec![Uuid::new_v4(), Uuid::new_v4()],
            token_hash: None,
            keyset_id: Some("ks1".into()),
            output_amounts: Some(OutputAmounts {
                send: vec![64, 32, 4, 1],
                change: vec![16, 4, 2, 1],
            }),
        };
        assert_eq!(input.input_proofs.len(), 2);
        assert_eq!(input.input_proof_ids.len(), 2);
        assert!(input.token_hash.is_none());
    }

    #[test]
    fn create_result_constructs() {
        let r = CreateSendSwapResult {
            swap: dummy_swap(),
            account: dummy_account(),
        };
        assert_eq!(r.swap.input_proofs.len(), 1);
    }

    #[test]
    fn commit_input_constructs() {
        let input = CommitProofsToSend {
            swap_id: Uuid::new_v4(),
            token_hash: "hash".into(),
            proofs_to_send: vec![dummy_proof(60)],
            change_proofs: vec![dummy_proof(4)],
        };
        assert_eq!(input.proofs_to_send.len(), 1);
        assert_eq!(input.change_proofs.len(), 1);
    }

    #[test]
    fn storage_error_concurrency_displays() {
        let e = SendSwapStorageError::Concurrency("two writers".into());
        assert!(e.to_string().contains("concurrent"));
    }

    #[test]
    fn storage_error_from_encryption_error() {
        let inner = EncryptionError::NoKey;
        let e: SendSwapStorageError = inner.into();
        assert!(matches!(e, SendSwapStorageError::Encryption(_)));
    }

    #[test]
    fn storage_error_is_send_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<SendSwapStorageError>();
    }
}
