//! Domain types for a Cashu send swap.
//!
//! Mirrors `app/features/send/cashu-send-swap.ts` — the per-token state
//! machine row a wallet stores when producing a Cashu token to hand to a
//! receiver. Two persisted paths:
//!
//! - **Exact proofs available**: account already holds proofs that sum to
//!   `amount_to_send`. No mint swap required; the row starts in `Pending`
//!   (the proofs themselves are the proofs-to-send).
//! - **Swap required**: account proofs sum to more than `amount_to_send`.
//!   The row starts in `Draft`; the orchestrator performs a NUT-03 swap
//!   with the mint, then commits the resulting send + change proofs and
//!   transitions to `Pending`.
//!
//! `TokenProof` (the wire-shape proof in encrypted DB blobs) is reused
//! from the slice-5 `receive_swap` module via the public re-export.

use crate::receive_swap::TokenProof;
use agicash_domain::{AccountId, UserId};
use agicash_money::Money;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// One persisted Cashu send-swap row.
///
/// The `state` field is a discriminated union flattened into the parent
/// object — matches the shape `app/features/send/cashu-send-swap.ts`
/// produces (`{ id, ..., state: "PENDING", tokenHash, proofsToSend, ... }`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CashuSendSwap {
    pub id: Uuid,
    pub account_id: AccountId,
    pub user_id: UserId,
    /// Proofs reserved from the account as inputs to the swap. In Draft
    /// state these are the ONLY proofs persisted; in Pending they remain
    /// reserved as the proofs the input swap consumed.
    pub input_proofs: Vec<TokenProof>,
    /// Sum of the input proofs in the account's currency.
    pub input_amount: Money,
    /// What the receiver will end up with after they claim the token.
    pub amount_received: Money,
    /// Fee the receiver will pay when claiming (sender pre-pays this in
    /// the token's encoded value).
    pub cashu_receive_fee: Money,
    /// `amount_received + cashu_receive_fee` — what's encoded in the
    /// token the receiver sees.
    pub amount_to_send: Money,
    /// Fee for the sender's input swap. Zero when exact-amount proofs
    /// are available (no mint round-trip needed).
    pub cashu_send_fee: Money,
    /// `amount_to_send + cashu_send_fee` — total deducted from account.
    pub amount_spent: Money,
    /// `cashu_send_fee + cashu_receive_fee`.
    pub total_fee: Money,
    /// Keyset used to derive the swap's blinded outputs. Set only in
    /// `Draft` state — exact-proofs path leaves this null.
    pub keyset_id: Option<String>,
    /// Starting counter for the swap's blinded outputs. Set only in
    /// `Draft` state.
    pub keyset_counter: Option<u32>,
    /// Per-output amount splits for send + change. Set only in `Draft`
    /// state.
    pub output_amounts: Option<OutputAmounts>,
    /// UUID of the corresponding wallet transaction row.
    pub transaction_id: Uuid,
    pub created_at: DateTime<Utc>,
    /// Optimistic-concurrency version (mirrors the DB column).
    pub version: u32,
    /// Lifecycle state. Flattened so the serialized form matches the TS
    /// discriminated-union shape: `{ ..., "state": "DRAFT" }`,
    /// `{ ..., "state": "PENDING", "token_hash": "...", "proofs_to_send": [...] }`,
    /// etc.
    #[serde(flatten)]
    pub state: CashuSendSwapState,
}

/// Per-output amount splits for the input swap. `send` is the split for
/// the proofs the receiver gets; `change` is the leftover that flows
/// back to the sender's account.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OutputAmounts {
    pub send: Vec<u64>,
    pub change: Vec<u64>,
}

/// Lifecycle state for a [`CashuSendSwap`].
///
/// The serde shape matches what the TS-side stores:
/// - `{ state: "DRAFT" }` — input swap still required (no extra fields).
/// - `{ state: "PENDING", token_hash, proofs_to_send }` — proofs ready,
///   awaiting receiver claim.
/// - `{ state: "COMPLETED", token_hash, proofs_to_send }` — receiver
///   claimed; proofs spent.
/// - `{ state: "FAILED", failure_reason }` — failed before reaching
///   Pending (e.g. mint rejected the swap).
/// - `{ state: "REVERSED" }` — sender swapped the proofs back into the
///   account before the receiver claimed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "state", rename_all = "UPPERCASE")]
pub enum CashuSendSwapState {
    Draft,
    Pending {
        token_hash: String,
        proofs_to_send: Vec<TokenProof>,
    },
    Completed {
        token_hash: String,
        proofs_to_send: Vec<TokenProof>,
    },
    Failed {
        failure_reason: String,
    },
    Reversed,
}

#[cfg(test)]
mod tests {
    use super::*;
    use agicash_domain::Currency;
    use agicash_money::Unit;
    use rust_decimal::Decimal;

    fn dummy_money(amount: u64) -> Money {
        Money::new(Decimal::from(amount), Currency::Btc, Unit::Sat)
    }

    fn dummy_proof(amount: u64) -> TokenProof {
        TokenProof {
            id: "ks1".into(),
            amount,
            secret: format!("secret{amount}"),
            c: format!("C{amount}"),
            dleq: None,
            witness: None,
        }
    }

    fn dummy_swap(state: CashuSendSwapState) -> CashuSendSwap {
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
            state,
        }
    }

    #[test]
    fn draft_swap_constructs() {
        let s = dummy_swap(CashuSendSwapState::Draft);
        assert!(matches!(s.state, CashuSendSwapState::Draft));
    }

    #[test]
    fn pending_swap_carries_token_hash_and_proofs() {
        let s = dummy_swap(CashuSendSwapState::Pending {
            token_hash: "deadbeef".into(),
            proofs_to_send: vec![dummy_proof(60)],
        });
        match &s.state {
            CashuSendSwapState::Pending {
                token_hash,
                proofs_to_send,
            } => {
                assert_eq!(token_hash, "deadbeef");
                assert_eq!(proofs_to_send.len(), 1);
            }
            other => panic!("unexpected state: {other:?}"),
        }
    }

    #[test]
    fn completed_swap_carries_token_hash_and_proofs() {
        let s = dummy_swap(CashuSendSwapState::Completed {
            token_hash: "deadbeef".into(),
            proofs_to_send: vec![dummy_proof(60)],
        });
        match &s.state {
            CashuSendSwapState::Completed {
                token_hash,
                proofs_to_send,
            } => {
                assert_eq!(token_hash, "deadbeef");
                assert_eq!(proofs_to_send.len(), 1);
            }
            other => panic!("unexpected state: {other:?}"),
        }
    }

    #[test]
    fn failed_swap_carries_reason() {
        let s = dummy_swap(CashuSendSwapState::Failed {
            failure_reason: "mint rejected".into(),
        });
        match s.state {
            CashuSendSwapState::Failed { failure_reason } => {
                assert_eq!(failure_reason, "mint rejected");
            }
            other => panic!("unexpected state: {other:?}"),
        }
    }

    #[test]
    fn reversed_swap_constructs() {
        let s = dummy_swap(CashuSendSwapState::Reversed);
        assert!(matches!(s.state, CashuSendSwapState::Reversed));
    }

    #[test]
    fn draft_state_serializes_with_uppercase_tag() {
        let s = dummy_swap(CashuSendSwapState::Draft);
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["state"].as_str(), Some("DRAFT"));
        assert!(json.get("token_hash").is_none());
    }

    #[test]
    fn pending_state_flattens_token_hash_and_proofs() {
        let s = dummy_swap(CashuSendSwapState::Pending {
            token_hash: "h".into(),
            proofs_to_send: vec![dummy_proof(60)],
        });
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["state"].as_str(), Some("PENDING"));
        assert_eq!(json["token_hash"].as_str(), Some("h"));
        assert!(json["proofs_to_send"].is_array());
    }

    #[test]
    fn failed_state_flattens_reason() {
        let s = dummy_swap(CashuSendSwapState::Failed {
            failure_reason: "boom".into(),
        });
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["state"].as_str(), Some("FAILED"));
        assert_eq!(json["failure_reason"].as_str(), Some("boom"));
    }

    #[test]
    fn reversed_state_has_no_extra_fields() {
        let s = dummy_swap(CashuSendSwapState::Reversed);
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["state"].as_str(), Some("REVERSED"));
        assert!(json.get("token_hash").is_none());
        assert!(json.get("proofs_to_send").is_none());
        assert!(json.get("failure_reason").is_none());
    }

    #[test]
    fn draft_state_round_trips_through_json() {
        let s = dummy_swap(CashuSendSwapState::Draft);
        let json = serde_json::to_string(&s).unwrap();
        let back: CashuSendSwap = serde_json::from_str(&json).unwrap();
        assert_eq!(s, back);
    }

    #[test]
    fn pending_state_round_trips_through_json() {
        let s = dummy_swap(CashuSendSwapState::Pending {
            token_hash: "abc".into(),
            proofs_to_send: vec![dummy_proof(60), dummy_proof(4)],
        });
        let json = serde_json::to_string(&s).unwrap();
        let back: CashuSendSwap = serde_json::from_str(&json).unwrap();
        assert_eq!(s, back);
    }

    #[test]
    fn failed_state_round_trips_through_json() {
        let s = dummy_swap(CashuSendSwapState::Failed {
            failure_reason: "Token already claimed".into(),
        });
        let json = serde_json::to_string(&s).unwrap();
        let back: CashuSendSwap = serde_json::from_str(&json).unwrap();
        assert_eq!(s, back);
    }

    #[test]
    fn output_amounts_round_trips() {
        let amounts = OutputAmounts {
            send: vec![32, 16, 8, 4],
            change: vec![2, 1],
        };
        let json = serde_json::to_string(&amounts).unwrap();
        let back: OutputAmounts = serde_json::from_str(&json).unwrap();
        assert_eq!(amounts, back);
    }
}
