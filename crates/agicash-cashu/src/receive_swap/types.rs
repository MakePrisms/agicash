//! Domain types for a Cashu receive swap.
//!
//! Mirrors `app/features/receive/cashu-receive-swap.ts` — the per-token state
//! machine row a wallet stores when claiming a token via NUT-03 swap with the
//! issuing mint.
//!
//! `TokenProof` mirrors the @cashu/cashu-ts `Proof` shape used in the encrypted
//! `tokenProofs` blob, not the live `cdk::nuts::Proof`. The two are isomorphic
//! but we own the wire format that goes into Supabase's `encrypted_data` and
//! into JSON exchanged between the CLI and web app, so the field names match
//! cashu-ts exactly (`id`, `amount`, `secret`, `C`, optional `dleq`/`witness`).

use agicash_domain::{AccountId, UserId};
use agicash_money::Money;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// One persisted Cashu receive swap row.
///
/// Two intentional shape choices:
/// - `state` is a discriminated union (PENDING / COMPLETED / FAILED) — same
///   discriminator scheme TS's `CashuReceiveSwapSchema` uses, so the JSON
///   round-trips between CLI, web app, and DB without translation.
/// - The Money-shaped fields live here even though the wire DB row stores them
///   inside an opaque `encrypted_data` blob; the storage layer is responsible
///   for the blob round-trip and presents a plaintext domain entity here.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CashuReceiveSwap {
    /// Hash of the token being received. Unique per `(token_hash, user_id)`.
    pub token_hash: String,
    /// Proofs being swapped as inputs to NUT-03 — i.e. the proofs that came in
    /// the token.
    pub token_proofs: Vec<TokenProof>,
    /// Optional memo from the token sender.
    pub token_description: Option<String>,
    pub user_id: UserId,
    pub account_id: AccountId,
    /// Sum of the input proofs in the account's currency. Will differ from
    /// `amount_received` when the mint charges fees.
    pub input_amount: Money,
    /// Amount actually credited to the wallet after mint fees.
    pub amount_received: Money,
    /// Fee the mint deducts to swap the input proofs.
    pub fee_amount: Money,
    /// ID of the keyset that minted the new blinded outputs.
    pub keyset_id: String,
    /// Starting counter used to derive the blinded outputs.
    pub keyset_counter: u32,
    /// Per-output amounts (split of `amount_received` across blinded messages).
    pub output_amounts: Vec<u64>,
    /// UUID of the corresponding wallet transaction row.
    pub transaction_id: Uuid,
    pub created_at: DateTime<Utc>,
    /// Optimistic-concurrency version (mirrors the DB column).
    pub version: u32,
    /// Lifecycle state. Flattened so the serialized form mirrors the TS
    /// discriminated-union shape: `{ ..., "state": "PENDING" }` or
    /// `{ ..., "state": "FAILED", "failure_reason": "..." }`.
    #[serde(flatten)]
    pub state: CashuReceiveSwapState,
}

/// Lifecycle state for a [`CashuReceiveSwap`].
///
/// The serde shape matches what the TS-side stores: `{ state: "PENDING" }`,
/// `{ state: "COMPLETED" }`, or `{ state: "FAILED", failure_reason: "..." }`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "state", rename_all = "UPPERCASE")]
pub enum CashuReceiveSwapState {
    /// Swap row exists, but we have not yet completed the NUT-03 swap with
    /// the mint.
    Pending,
    /// Swap is finished — proofs are stored, account is credited.
    Completed,
    /// Swap failed (e.g. token already claimed elsewhere).
    Failed { failure_reason: String },
}

/// One Cashu proof as it appears in a token / the encrypted DB blob.
///
/// Matches `@cashu/cashu-ts` `Proof` so the JSON shape round-trips through
/// `encrypted_data` in `wallet.cashu_receive_swaps`. The `C` and `id` field
/// renames are wire-required.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TokenProof {
    /// Keyset id (cashu `id` field).
    pub id: String,
    pub amount: u64,
    pub secret: String,
    /// Unblinded signature (cashu `C` field).
    #[serde(rename = "C")]
    pub c: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dleq: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub witness: Option<serde_json::Value>,
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

    fn dummy_swap(state: CashuReceiveSwapState) -> CashuReceiveSwap {
        CashuReceiveSwap {
            token_hash: "deadbeef".into(),
            token_proofs: vec![TokenProof {
                id: "ks1".into(),
                amount: 100,
                secret: "secret1".into(),
                c: "C1".into(),
                dleq: None,
                witness: None,
            }],
            token_description: Some("test memo".into()),
            user_id: UserId::new(),
            account_id: AccountId::new(),
            input_amount: dummy_money(100),
            amount_received: dummy_money(99),
            fee_amount: dummy_money(1),
            keyset_id: "ks1".into(),
            keyset_counter: 7,
            output_amounts: vec![64, 32, 2, 1],
            transaction_id: Uuid::new_v4(),
            created_at: Utc::now(),
            version: 0,
            state,
        }
    }

    #[test]
    fn pending_swap_constructs() {
        let s = dummy_swap(CashuReceiveSwapState::Pending);
        assert!(matches!(s.state, CashuReceiveSwapState::Pending));
    }

    #[test]
    fn completed_swap_constructs() {
        let s = dummy_swap(CashuReceiveSwapState::Completed);
        assert!(matches!(s.state, CashuReceiveSwapState::Completed));
    }

    #[test]
    fn failed_swap_carries_reason() {
        let s = dummy_swap(CashuReceiveSwapState::Failed {
            failure_reason: "token already claimed".into(),
        });
        match s.state {
            CashuReceiveSwapState::Failed { failure_reason } => {
                assert_eq!(failure_reason, "token already claimed");
            }
            other => panic!("unexpected state: {other:?}"),
        }
    }

    #[test]
    fn pending_state_serializes_with_uppercase_tag() {
        let s = dummy_swap(CashuReceiveSwapState::Pending);
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["state"].as_str(), Some("PENDING"));
    }

    #[test]
    fn completed_state_serializes_with_uppercase_tag() {
        let s = dummy_swap(CashuReceiveSwapState::Completed);
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["state"].as_str(), Some("COMPLETED"));
    }

    #[test]
    fn failed_state_serializes_with_reason() {
        let s = dummy_swap(CashuReceiveSwapState::Failed {
            failure_reason: "boom".into(),
        });
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["state"].as_str(), Some("FAILED"));
        assert_eq!(json["failure_reason"].as_str(), Some("boom"));
    }

    #[test]
    fn pending_state_round_trips_through_json() {
        let s = dummy_swap(CashuReceiveSwapState::Pending);
        let json = serde_json::to_string(&s).unwrap();
        let back: CashuReceiveSwap = serde_json::from_str(&json).unwrap();
        assert_eq!(s, back);
    }

    #[test]
    fn failed_state_round_trips_through_json() {
        let s = dummy_swap(CashuReceiveSwapState::Failed {
            failure_reason: "Token already claimed".into(),
        });
        let json = serde_json::to_string(&s).unwrap();
        let back: CashuReceiveSwap = serde_json::from_str(&json).unwrap();
        assert_eq!(s, back);
    }

    #[test]
    fn token_proof_serializes_c_field_uppercase() {
        let p = TokenProof {
            id: "ks1".into(),
            amount: 64,
            secret: "s".into(),
            c: "Ckey".into(),
            dleq: None,
            witness: None,
        };
        let json = serde_json::to_value(&p).unwrap();
        assert_eq!(json["C"].as_str(), Some("Ckey"));
        assert!(json.get("c").is_none());
        // Optional fields are omitted when None to match TS shape.
        assert!(json.get("dleq").is_none());
        assert!(json.get("witness").is_none());
    }

    #[test]
    fn token_proof_deserializes_c_field() {
        let raw = serde_json::json!({
            "id": "ks2",
            "amount": 32,
            "secret": "abc",
            "C": "Cval",
        });
        let p: TokenProof = serde_json::from_value(raw).unwrap();
        assert_eq!(p.c, "Cval");
        assert_eq!(p.id, "ks2");
        assert_eq!(p.amount, 32);
    }
}
