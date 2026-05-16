//! Domain types for a Cashu NUT-05 melt quote (Lightning send).
//!
//! Mirrors `app/features/send/cashu-send-quote.ts`. Slice 8 covers the
//! direct-bolt11 branch only — `destinationDetails` (Lightning address /
//! agicash contact) is intentionally omitted; the DB column tolerates
//! either shape but no Rust caller produces destination metadata yet.

use crate::receive_swap::TokenProof;
use agicash_domain::{AccountId, UserId};
use agicash_money::Money;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// One persisted Cashu lightning-send quote row.
///
/// The mint-side `quote_id`, BOLT-11 `payment_request`, fee/amount
/// breakdown, and (after PAID) the payment preimage live inside the
/// encrypted blob on the DB side; the storage impl hides that round-trip
/// behind this plaintext shape.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CashuMeltQuote {
    /// UUID of the quote row (DB primary key).
    pub id: Uuid,
    /// Mint-side melt-quote id. Used to call NUT-23 `melt_quote/status` and
    /// `melt`. Stored encrypted on the DB row.
    pub quote_id: String,
    pub user_id: UserId,
    pub account_id: AccountId,
    /// BOLT-11 invoice the mint pays on our behalf.
    pub payment_request: String,
    /// Payment hash of the BOLT-11 invoice (lowercase hex). Searchable
    /// column on the DB row.
    pub payment_hash: String,
    /// What the user asked to send. For amount-bearing invoices this
    /// matches `amount_received`; for FX-ready flows (future) it can
    /// differ. Slice 8 always equals `amount_received`.
    pub amount_requested: Money,
    /// `amount_requested` converted to milli-satoshis. Mirrors the TS
    /// field of the same name. Slice 8 derives from the BOLT-11 invoice's
    /// own msat amount (no FX), so this matches the invoice msat.
    pub amount_requested_in_msat: u64,
    /// Amount the receiver gets, in the account's currency.
    pub amount_received: Money,
    /// Mint-quoted Lightning fee reserve, in the account's currency.
    pub lightning_fee_reserve: Money,
    /// Mint-quoted cashu input fee for the proofs we'll spend.
    pub cashu_fee: Money,
    /// Proofs reserved for the melt. Sum >= `amount_received` +
    /// `lightning_fee_reserve` + `cashu_fee`.
    pub proofs: Vec<TokenProof>,
    /// Sum of `proofs` in the account's currency.
    pub amount_reserved: Money,
    /// Keyset used to derive the change blank outputs.
    pub keyset_id: String,
    /// Counter at the time the quote was created (DB-side reservation
    /// bumps the account counter by `number_of_change_outputs`; this
    /// captures the pre-bump value so we can rebuild the deterministic
    /// outputs).
    pub keyset_counter: u32,
    /// Number of change blanks issued for the NUT-08 fee-reserve refund.
    pub number_of_change_outputs: u32,
    /// UUID of the corresponding wallet transaction row.
    pub transaction_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub version: u32,
    /// Lifecycle state. Flattened so the serialized form mirrors the TS
    /// discriminated-union shape.
    #[serde(flatten)]
    pub state: CashuMeltQuoteState,
}

/// Lifecycle state for a [`CashuMeltQuote`].
///
/// Mirrors what the TS-side stores:
/// - `{ state: "UNPAID" }` — quote created, no melt issued.
/// - `{ state: "PENDING" }` — `post_melt` issued, Lightning payment in flight.
/// - `{ state: "PAID", payment_preimage, lightning_fee, amount_spent, total_fee }` —
///   mint settled the melt.
/// - `{ state: "EXPIRED" }` — invoice expired before melt issued.
/// - `{ state: "FAILED", failure_reason }` — operational failure.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "state", rename_all = "UPPERCASE")]
pub enum CashuMeltQuoteState {
    /// Quote created, no melt call started yet.
    Unpaid,
    /// `post_melt` issued; awaiting mint completion (Lightning payment in
    /// flight). May stay here for tens of seconds.
    Pending,
    /// Mint reports `PAID`; proofs spent + change persisted (terminal).
    Paid {
        payment_preimage: String,
        /// Actual Lightning fee charged
        /// (`lightning_fee_reserve` − change), in the account's currency.
        lightning_fee: Money,
        /// `amount_received + lightning_fee` — what really left the
        /// account in network terms.
        amount_spent: Money,
        /// `lightning_fee + cashu_fee`.
        total_fee: Money,
    },
    /// Quote expired before melt was initiated (terminal).
    Expired,
    /// Operational failure (terminal). `failure_reason` is the mint /
    /// network message we surface to the operator.
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

    fn dummy_quote(state: CashuMeltQuoteState) -> CashuMeltQuote {
        CashuMeltQuote {
            id: Uuid::new_v4(),
            quote_id: "qid-abc".into(),
            user_id: UserId::new(),
            account_id: AccountId::new(),
            payment_request: "lnbc640n1...".into(),
            payment_hash: "deadbeef".into(),
            amount_requested: dummy_money(64),
            amount_requested_in_msat: 64_000,
            amount_received: dummy_money(64),
            lightning_fee_reserve: dummy_money(1),
            cashu_fee: dummy_money(0),
            proofs: vec![dummy_proof()],
            amount_reserved: dummy_money(64),
            keyset_id: "ks1".into(),
            keyset_counter: 7,
            number_of_change_outputs: 1,
            transaction_id: Uuid::new_v4(),
            created_at: Utc::now(),
            expires_at: Utc::now(),
            version: 0,
            state,
        }
    }

    #[test]
    fn unpaid_quote_constructs() {
        let q = dummy_quote(CashuMeltQuoteState::Unpaid);
        assert!(matches!(q.state, CashuMeltQuoteState::Unpaid));
    }

    #[test]
    fn pending_quote_constructs() {
        let q = dummy_quote(CashuMeltQuoteState::Pending);
        assert!(matches!(q.state, CashuMeltQuoteState::Pending));
    }

    #[test]
    fn paid_quote_carries_preimage_and_fee_breakdown() {
        let q = dummy_quote(CashuMeltQuoteState::Paid {
            payment_preimage: "abcdef".into(),
            lightning_fee: dummy_money(1),
            amount_spent: dummy_money(65),
            total_fee: dummy_money(1),
        });
        match &q.state {
            CashuMeltQuoteState::Paid {
                payment_preimage,
                lightning_fee,
                amount_spent,
                total_fee,
            } => {
                assert_eq!(payment_preimage, "abcdef");
                assert_eq!(lightning_fee.amount(), Decimal::from(1u64));
                assert_eq!(amount_spent.amount(), Decimal::from(65u64));
                assert_eq!(total_fee.amount(), Decimal::from(1u64));
            }
            other => panic!("unexpected state: {other:?}"),
        }
    }

    #[test]
    fn expired_quote_constructs() {
        let q = dummy_quote(CashuMeltQuoteState::Expired);
        assert!(matches!(q.state, CashuMeltQuoteState::Expired));
    }

    #[test]
    fn failed_quote_carries_reason() {
        let q = dummy_quote(CashuMeltQuoteState::Failed {
            failure_reason: "operator cancelled".into(),
        });
        match q.state {
            CashuMeltQuoteState::Failed { failure_reason } => {
                assert_eq!(failure_reason, "operator cancelled");
            }
            other => panic!("unexpected state: {other:?}"),
        }
    }

    #[test]
    fn unpaid_state_serializes_with_uppercase_tag() {
        let q = dummy_quote(CashuMeltQuoteState::Unpaid);
        let json = serde_json::to_value(&q).unwrap();
        assert_eq!(json["state"].as_str(), Some("UNPAID"));
        assert!(json.get("payment_preimage").is_none());
    }

    #[test]
    fn pending_state_serializes_with_no_extra_fields() {
        let q = dummy_quote(CashuMeltQuoteState::Pending);
        let json = serde_json::to_value(&q).unwrap();
        assert_eq!(json["state"].as_str(), Some("PENDING"));
        assert!(json.get("payment_preimage").is_none());
        assert!(json.get("failure_reason").is_none());
    }

    #[test]
    fn paid_state_serializes_with_preimage_and_fees() {
        let q = dummy_quote(CashuMeltQuoteState::Paid {
            payment_preimage: "deadbeef".into(),
            lightning_fee: dummy_money(2),
            amount_spent: dummy_money(66),
            total_fee: dummy_money(2),
        });
        let json = serde_json::to_value(&q).unwrap();
        assert_eq!(json["state"].as_str(), Some("PAID"));
        assert_eq!(json["payment_preimage"].as_str(), Some("deadbeef"));
        assert!(json.get("lightning_fee").is_some());
        assert!(json.get("amount_spent").is_some());
        assert!(json.get("total_fee").is_some());
    }

    #[test]
    fn failed_state_serializes_with_reason() {
        let q = dummy_quote(CashuMeltQuoteState::Failed {
            failure_reason: "boom".into(),
        });
        let json = serde_json::to_value(&q).unwrap();
        assert_eq!(json["state"].as_str(), Some("FAILED"));
        assert_eq!(json["failure_reason"].as_str(), Some("boom"));
    }

    #[test]
    fn unpaid_state_round_trips_through_json() {
        let q = dummy_quote(CashuMeltQuoteState::Unpaid);
        let json = serde_json::to_string(&q).unwrap();
        let back: CashuMeltQuote = serde_json::from_str(&json).unwrap();
        assert_eq!(q, back);
    }

    #[test]
    fn pending_state_round_trips_through_json() {
        let q = dummy_quote(CashuMeltQuoteState::Pending);
        let json = serde_json::to_string(&q).unwrap();
        let back: CashuMeltQuote = serde_json::from_str(&json).unwrap();
        assert_eq!(q, back);
    }

    #[test]
    fn paid_state_round_trips_through_json() {
        let q = dummy_quote(CashuMeltQuoteState::Paid {
            payment_preimage: "abcd".into(),
            lightning_fee: dummy_money(3),
            amount_spent: dummy_money(67),
            total_fee: dummy_money(3),
        });
        let json = serde_json::to_string(&q).unwrap();
        let back: CashuMeltQuote = serde_json::from_str(&json).unwrap();
        assert_eq!(q, back);
    }

    #[test]
    fn expired_state_round_trips_through_json() {
        let q = dummy_quote(CashuMeltQuoteState::Expired);
        let json = serde_json::to_string(&q).unwrap();
        let back: CashuMeltQuote = serde_json::from_str(&json).unwrap();
        assert_eq!(q, back);
    }

    #[test]
    fn failed_state_round_trips_through_json() {
        let q = dummy_quote(CashuMeltQuoteState::Failed {
            failure_reason: "Mint rejected".into(),
        });
        let json = serde_json::to_string(&q).unwrap();
        let back: CashuMeltQuote = serde_json::from_str(&json).unwrap();
        assert_eq!(q, back);
    }
}
