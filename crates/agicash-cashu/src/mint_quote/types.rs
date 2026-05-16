//! Domain types for a Cashu NUT-04 mint quote (Lightning receive).
//!
//! Mirrors `app/features/receive/cashu-receive-quote.ts`. Slice 7 covers the
//! LIGHTNING-typed branch only — the CASHU_TOKEN-typed subschema (which melts
//! proofs from one mint to fund a receive on another) is intentionally
//! omitted; the DB column tolerates either type but no Rust caller produces
//! `CASHU_TOKEN` quotes yet.

use agicash_domain::{AccountId, UserId};
use agicash_money::Money;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// One persisted Cashu lightning-receive quote row.
///
/// The mint-side `quote_id`, BOLT-11 `payment_request`, and the
/// per-state keyset metadata live inside the encrypted blob on the DB
/// side; the storage impl hides that round-trip behind this plaintext
/// shape.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CashuMintQuote {
    /// UUID of the quote row (DB primary key).
    pub id: Uuid,
    /// Mint-side quote id. Used to call NUT-04 `mint_quote/status` and
    /// `mint`. Stored encrypted in `encrypted_data`.
    pub quote_id: String,
    pub user_id: UserId,
    pub account_id: AccountId,
    /// Amount credited to the wallet on completion.
    pub amount: Money,
    /// Optional memo passed to the mint when requesting the quote.
    pub description: Option<String>,
    /// BOLT-11 invoice the user pays. Stored encrypted; exposed plaintext.
    pub payment_request: String,
    /// Payment hash of the BOLT-11 invoice (lowercase hex). Searchable
    /// column on the DB row.
    pub payment_hash: String,
    /// BIP-32 derivation path used for NUT-20 locking. Slice 7 always
    /// emits the empty string here (no locking); kept on the struct
    /// because the DB column is NOT NULL.
    pub locking_derivation_path: String,
    /// UUID of the corresponding wallet transaction row.
    pub transaction_id: Uuid,
    /// Fee charged by the mint on top of `amount` (added to the invoice
    /// amount). `None` when the mint charges nothing.
    pub minting_fee: Option<Money>,
    /// Sum of all fees the receive incurs. For LIGHTNING receives this
    /// equals `minting_fee` (or zero if absent).
    pub total_fee: Money,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub version: u32,
    /// Lifecycle state. Flattened so the serialized form mirrors the TS
    /// discriminated-union shape (`{ ..., "state": "UNPAID" }`,
    /// `{ ..., "state": "PAID", "keyset_id": ..., ... }`, etc.).
    #[serde(flatten)]
    pub state: CashuMintQuoteState,
}

/// Lifecycle state for a [`CashuMintQuote`].
///
/// The serde shape matches what the TS-side stores: `{ state: "UNPAID" }`,
/// `{ state: "PAID", keyset_id, keyset_counter, output_amounts }`,
/// `{ state: "COMPLETED", keyset_id, keyset_counter, output_amounts }`,
/// `{ state: "EXPIRED" }`, `{ state: "FAILED", failure_reason }`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "state", rename_all = "UPPERCASE")]
pub enum CashuMintQuoteState {
    /// Invoice issued, awaiting payment by the user.
    Unpaid,
    /// Mint detected payment but proofs not yet minted. Has the keyset
    /// metadata required to reproduce the blinded outputs.
    Paid {
        keyset_id: String,
        keyset_counter: u32,
        output_amounts: Vec<u64>,
    },
    /// Proofs minted, account credited.
    Completed {
        keyset_id: String,
        keyset_counter: u32,
        output_amounts: Vec<u64>,
    },
    /// Invoice expired without payment.
    Expired,
    /// Operational failure (e.g. mint rejected the mint call for reasons
    /// other than already-issued — already-issued is recovered via
    /// `wallet.restore`).
    Failed { failure_reason: String },
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

    fn dummy_quote(state: CashuMintQuoteState) -> CashuMintQuote {
        CashuMintQuote {
            id: Uuid::new_v4(),
            quote_id: "qid-abc".into(),
            user_id: UserId::new(),
            account_id: AccountId::new(),
            amount: dummy_money(64),
            description: Some("memo".into()),
            payment_request: "lnbc640n1...".into(),
            payment_hash: "deadbeef".into(),
            locking_derivation_path: String::new(),
            transaction_id: Uuid::new_v4(),
            minting_fee: Some(dummy_money(0)),
            total_fee: dummy_money(0),
            created_at: Utc::now(),
            expires_at: Utc::now(),
            version: 0,
            state,
        }
    }

    #[test]
    fn unpaid_quote_constructs() {
        let q = dummy_quote(CashuMintQuoteState::Unpaid);
        assert!(matches!(q.state, CashuMintQuoteState::Unpaid));
    }

    #[test]
    fn paid_quote_constructs_with_keyset_metadata() {
        let q = dummy_quote(CashuMintQuoteState::Paid {
            keyset_id: "ks1".into(),
            keyset_counter: 5,
            output_amounts: vec![64],
        });
        match q.state {
            CashuMintQuoteState::Paid {
                ref keyset_id,
                keyset_counter,
                ref output_amounts,
            } => {
                assert_eq!(keyset_id, "ks1");
                assert_eq!(keyset_counter, 5);
                assert_eq!(output_amounts, &vec![64]);
            }
            other => panic!("unexpected state: {other:?}"),
        }
    }

    #[test]
    fn completed_quote_constructs() {
        let q = dummy_quote(CashuMintQuoteState::Completed {
            keyset_id: "ks1".into(),
            keyset_counter: 6,
            output_amounts: vec![32, 32],
        });
        assert!(matches!(q.state, CashuMintQuoteState::Completed { .. }));
    }

    #[test]
    fn expired_quote_constructs() {
        let q = dummy_quote(CashuMintQuoteState::Expired);
        assert!(matches!(q.state, CashuMintQuoteState::Expired));
    }

    #[test]
    fn failed_quote_carries_reason() {
        let q = dummy_quote(CashuMintQuoteState::Failed {
            failure_reason: "operator cancelled".into(),
        });
        match q.state {
            CashuMintQuoteState::Failed { failure_reason } => {
                assert_eq!(failure_reason, "operator cancelled");
            }
            other => panic!("unexpected state: {other:?}"),
        }
    }

    #[test]
    fn unpaid_state_serializes_with_uppercase_tag() {
        let q = dummy_quote(CashuMintQuoteState::Unpaid);
        let json = serde_json::to_value(&q).unwrap();
        assert_eq!(json["state"].as_str(), Some("UNPAID"));
        // No keyset fields at this state.
        assert!(json.get("keyset_id").is_none());
        assert!(json.get("output_amounts").is_none());
    }

    #[test]
    fn paid_state_serializes_with_keyset_fields() {
        let q = dummy_quote(CashuMintQuoteState::Paid {
            keyset_id: "ks1".into(),
            keyset_counter: 7,
            output_amounts: vec![64],
        });
        let json = serde_json::to_value(&q).unwrap();
        assert_eq!(json["state"].as_str(), Some("PAID"));
        assert_eq!(json["keyset_id"].as_str(), Some("ks1"));
        assert_eq!(json["keyset_counter"].as_u64(), Some(7));
        assert_eq!(
            json["output_amounts"].as_array().map(std::vec::Vec::len),
            Some(1)
        );
    }

    #[test]
    fn failed_state_serializes_with_reason() {
        let q = dummy_quote(CashuMintQuoteState::Failed {
            failure_reason: "boom".into(),
        });
        let json = serde_json::to_value(&q).unwrap();
        assert_eq!(json["state"].as_str(), Some("FAILED"));
        assert_eq!(json["failure_reason"].as_str(), Some("boom"));
    }

    #[test]
    fn unpaid_state_round_trips_through_json() {
        let q = dummy_quote(CashuMintQuoteState::Unpaid);
        let json = serde_json::to_string(&q).unwrap();
        let back: CashuMintQuote = serde_json::from_str(&json).unwrap();
        assert_eq!(q, back);
    }

    #[test]
    fn paid_state_round_trips_through_json() {
        let q = dummy_quote(CashuMintQuoteState::Paid {
            keyset_id: "ks2".into(),
            keyset_counter: 10,
            output_amounts: vec![16, 8, 4],
        });
        let json = serde_json::to_string(&q).unwrap();
        let back: CashuMintQuote = serde_json::from_str(&json).unwrap();
        assert_eq!(q, back);
    }

    #[test]
    fn failed_state_round_trips_through_json() {
        let q = dummy_quote(CashuMintQuoteState::Failed {
            failure_reason: "Mint rejected".into(),
        });
        let json = serde_json::to_string(&q).unwrap();
        let back: CashuMintQuote = serde_json::from_str(&json).unwrap();
        assert_eq!(q, back);
    }
}
