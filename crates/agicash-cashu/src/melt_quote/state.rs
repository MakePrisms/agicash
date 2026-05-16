//! Sans-IO state machine for a Cashu NUT-05 melt quote.
//!
//! Pure state transitions: no async, no network, no storage. The
//! orchestrator ([`super::service::CashuMeltQuoteService`]) drives this
//! machine forward by reading the requested [`Action`] and feeding back
//! the corresponding [`Event`].
//!
//! Lifecycle (mirroring `app/features/send/cashu-send-quote-service.ts`):
//!
//! ```text
//! NotStarted ──RequestQuote──> QuoteRequested ──> Unpaid
//!
//! Unpaid ──InitiateMelt──> QuoteMarkedPending ──> Pending
//!        │
//!        ├─[fast-PAID recovery: post_melt server-side committed but
//!        │  the mark_pending response was lost; next session sees the
//!        │  row still UNPAID and the storage RPC accepts UNPAID->PAID]
//!        │  ──QuoteCompleted──> Paid (terminal)
//!        │
//!        ├──Expire──> QuoteExpired ──> Expired (terminal)
//!        └──Fail──>  QuoteFailed ──> Failed (terminal)
//!
//! Pending ──PollStatus──> PollSawPending ──> [stay] (executor sleeps + polls again)
//!                      │
//!                      ├──QuoteCompleted──> Paid (terminal)
//!                      │
//!                      ├──PollSawUnpaid──> [stay; orchestrator decides
//!                      │                     whether to fail or retry]
//!                      │
//!                      └──Fail──> QuoteFailed ──> Failed (terminal)
//! ```

use super::error::MeltQuoteError;
use super::types::{CashuMeltQuote, CashuMeltQuoteState};

/// Drives a melt quote forward through its lifecycle.
#[derive(Debug, Clone)]
pub struct MeltQuoteMachine {
    state: MachineState,
}

/// Internal state. Each variant corresponds 1:1 with a persisted DB
/// state except `NotStarted`.
#[derive(Debug, Clone)]
pub enum MachineState {
    /// Quote not yet requested from the mint.
    NotStarted,
    /// Persisted UNPAID — proofs reserved, no melt call started.
    Unpaid(CashuMeltQuote),
    /// Persisted PENDING — melt in flight (Lightning payment in progress).
    Pending(CashuMeltQuote),
    /// Persisted PAID (terminal).
    Paid(CashuMeltQuote),
    /// Persisted EXPIRED (terminal).
    Expired(CashuMeltQuote),
    /// Persisted FAILED (terminal).
    Failed(CashuMeltQuote),
}

/// Next I/O the executor should perform.
#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    /// Ask the mint for a NUT-05 melt quote and persist the row.
    RequestQuote,
    /// Mark UNPAID -> PENDING (storage RPC) and call `post_melt`.
    InitiateMelt { quote_id: String },
    /// Poll the mint's `melt_quote/status` endpoint while in PENDING.
    PollStatus { quote_id: String },
    /// Persist the resulting change proofs and transition PENDING -> PAID.
    CompleteQuote { change_proofs_count: usize },
    /// Expire UNPAID quote.
    Expire,
    /// Fail UNPAID/PENDING quote with reason.
    Fail { reason: String },
    /// Terminal — nothing more to do.
    None,
}

/// Event the executor feeds back after performing an [`Action`].
#[derive(Debug, Clone)]
pub enum Event {
    /// Storage created the UNPAID quote row.
    QuoteRequested(CashuMeltQuote),
    /// Storage transitioned UNPAID -> PENDING.
    QuoteMarkedPending(CashuMeltQuote),
    /// Mint reports the melt still pending; stay in `Pending`.
    PollSawPending,
    /// Mint reports the invoice unpaid (fail-back from PENDING — mint
    /// gave up). Orchestrator decides whether to retry or fail.
    PollSawUnpaid,
    /// Storage persisted the change proofs and transitioned to PAID.
    QuoteCompleted(CashuMeltQuote),
    /// Storage transitioned UNPAID -> EXPIRED.
    QuoteExpired(CashuMeltQuote),
    /// Storage transitioned UNPAID/PENDING -> FAILED.
    QuoteFailed(CashuMeltQuote),
}

impl MeltQuoteMachine {
    pub fn new() -> Self {
        Self {
            state: MachineState::NotStarted,
        }
    }

    pub fn from_existing(quote: CashuMeltQuote) -> Self {
        let state = match &quote.state {
            CashuMeltQuoteState::Unpaid => MachineState::Unpaid(quote),
            CashuMeltQuoteState::Pending => MachineState::Pending(quote),
            CashuMeltQuoteState::Paid { .. } => MachineState::Paid(quote),
            CashuMeltQuoteState::Expired => MachineState::Expired(quote),
            CashuMeltQuoteState::Failed { .. } => MachineState::Failed(quote),
        };
        Self { state }
    }

    pub fn state(&self) -> &MachineState {
        &self.state
    }

    pub fn is_terminal(&self) -> bool {
        matches!(
            self.state,
            MachineState::Paid(_) | MachineState::Expired(_) | MachineState::Failed(_)
        )
    }

    /// Snapshot of the underlying persisted quote, when one exists.
    /// Returns `None` for `NotStarted` (no row yet).
    pub fn snapshot(&self) -> Option<&CashuMeltQuote> {
        match &self.state {
            MachineState::NotStarted => None,
            MachineState::Unpaid(q)
            | MachineState::Pending(q)
            | MachineState::Paid(q)
            | MachineState::Expired(q)
            | MachineState::Failed(q) => Some(q),
        }
    }

    pub fn next_action(&self) -> Action {
        match &self.state {
            MachineState::NotStarted => Action::RequestQuote,
            MachineState::Unpaid(q) => Action::InitiateMelt {
                quote_id: q.quote_id.clone(),
            },
            MachineState::Pending(q) => Action::PollStatus {
                quote_id: q.quote_id.clone(),
            },
            MachineState::Paid(_) | MachineState::Expired(_) | MachineState::Failed(_) => {
                Action::None
            }
        }
    }

    pub fn apply(&mut self, event: Event) -> Result<(), MeltQuoteError> {
        match (&self.state, event) {
            (MachineState::NotStarted, Event::QuoteRequested(quote)) => {
                self.state = MachineState::Unpaid(quote);
                Ok(())
            }
            (MachineState::Unpaid(_), Event::QuoteMarkedPending(quote)) => {
                self.state = MachineState::Pending(quote);
                Ok(())
            }
            // Tolerant fast-PAID recovery: storage's
            // `complete_cashu_send_quote` SQL guard accepts UNPAID->PAID
            // when an earlier `mark_pending` succeeded server-side but the
            // response was lost. Walk the machine UNPAID -> Paid in that
            // case rather than insisting on PENDING.
            (MachineState::Unpaid(_) | MachineState::Pending(_), Event::QuoteCompleted(quote)) => {
                self.state = MachineState::Paid(quote);
                Ok(())
            }
            (MachineState::Pending(_), Event::PollSawPending | Event::PollSawUnpaid) => Ok(()),
            (MachineState::Unpaid(_), Event::QuoteExpired(quote)) => {
                self.state = MachineState::Expired(quote);
                Ok(())
            }
            (MachineState::Unpaid(_) | MachineState::Pending(_), Event::QuoteFailed(quote)) => {
                self.state = MachineState::Failed(quote);
                Ok(())
            }
            (state, event) => Err(MeltQuoteError::InvalidTransition {
                from: format!("{state:?}"),
                event: format!("{event:?}"),
            }),
        }
    }
}

impl Default for MeltQuoteMachine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::receive_swap::TokenProof;
    use agicash_domain::{AccountId, Currency, UserId};
    use agicash_money::{Money, Unit};
    use chrono::Utc;
    use rust_decimal::Decimal;
    use uuid::Uuid;

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

    fn unpaid_quote() -> CashuMeltQuote {
        CashuMeltQuote {
            id: Uuid::new_v4(),
            quote_id: "qid".into(),
            user_id: UserId::new(),
            account_id: AccountId::new(),
            payment_request: "lnbc...".into(),
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
            state: CashuMeltQuoteState::Unpaid,
        }
    }

    fn pending_quote() -> CashuMeltQuote {
        let mut q = unpaid_quote();
        q.state = CashuMeltQuoteState::Pending;
        q
    }

    fn paid_quote() -> CashuMeltQuote {
        let mut q = unpaid_quote();
        q.state = CashuMeltQuoteState::Paid {
            payment_preimage: "pre".into(),
            lightning_fee: dummy_money(1),
            amount_spent: dummy_money(65),
            total_fee: dummy_money(1),
        };
        q
    }

    fn expired_quote() -> CashuMeltQuote {
        let mut q = unpaid_quote();
        q.state = CashuMeltQuoteState::Expired;
        q
    }

    fn failed_quote() -> CashuMeltQuote {
        let mut q = unpaid_quote();
        q.state = CashuMeltQuoteState::Failed {
            failure_reason: "nope".into(),
        };
        q
    }

    #[test]
    fn new_machine_starts_in_not_started() {
        let m = MeltQuoteMachine::new();
        assert!(matches!(m.state(), MachineState::NotStarted));
        assert_eq!(m.next_action(), Action::RequestQuote);
        assert!(!m.is_terminal());
        assert!(m.snapshot().is_none());
    }

    #[test]
    fn from_existing_unpaid_yields_initiate_action() {
        let m = MeltQuoteMachine::from_existing(unpaid_quote());
        assert!(matches!(m.state(), MachineState::Unpaid(_)));
        match m.next_action() {
            Action::InitiateMelt { quote_id } => assert_eq!(quote_id, "qid"),
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn from_existing_pending_yields_poll_action() {
        let m = MeltQuoteMachine::from_existing(pending_quote());
        assert!(matches!(m.state(), MachineState::Pending(_)));
        match m.next_action() {
            Action::PollStatus { quote_id } => assert_eq!(quote_id, "qid"),
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn from_existing_paid_is_terminal() {
        let m = MeltQuoteMachine::from_existing(paid_quote());
        assert!(m.is_terminal());
        assert_eq!(m.next_action(), Action::None);
    }

    #[test]
    fn from_existing_expired_is_terminal() {
        let m = MeltQuoteMachine::from_existing(expired_quote());
        assert!(m.is_terminal());
    }

    #[test]
    fn from_existing_failed_is_terminal() {
        let m = MeltQuoteMachine::from_existing(failed_quote());
        assert!(m.is_terminal());
    }

    #[test]
    fn happy_slow_path_runs_to_completion() {
        let mut m = MeltQuoteMachine::new();
        assert_eq!(m.next_action(), Action::RequestQuote);
        m.apply(Event::QuoteRequested(unpaid_quote())).unwrap();

        assert!(matches!(m.state(), MachineState::Unpaid(_)));
        assert!(matches!(m.next_action(), Action::InitiateMelt { .. }));

        m.apply(Event::QuoteMarkedPending(pending_quote())).unwrap();
        assert!(matches!(m.state(), MachineState::Pending(_)));
        assert!(matches!(m.next_action(), Action::PollStatus { .. }));

        // Two PollSawPending events keep us in Pending.
        m.apply(Event::PollSawPending).unwrap();
        m.apply(Event::PollSawPending).unwrap();
        assert!(matches!(m.state(), MachineState::Pending(_)));

        m.apply(Event::QuoteCompleted(paid_quote())).unwrap();
        assert!(matches!(m.state(), MachineState::Paid(_)));
        assert!(m.is_terminal());
        assert_eq!(m.next_action(), Action::None);
    }

    #[test]
    fn happy_fast_path_unpaid_to_paid_then_terminal() {
        // Fast-PAID recovery: storage allows UNPAID -> PAID directly when
        // a prior mark_pending committed but the response was lost.
        let mut m = MeltQuoteMachine::from_existing(unpaid_quote());
        m.apply(Event::QuoteCompleted(paid_quote())).unwrap();
        assert!(matches!(m.state(), MachineState::Paid(_)));
        assert!(m.is_terminal());
    }

    #[test]
    fn poll_saw_unpaid_keeps_pending_state() {
        let mut m = MeltQuoteMachine::from_existing(pending_quote());
        m.apply(Event::PollSawUnpaid).unwrap();
        assert!(matches!(m.state(), MachineState::Pending(_)));
    }

    #[test]
    fn unpaid_can_expire() {
        let mut m = MeltQuoteMachine::from_existing(unpaid_quote());
        m.apply(Event::QuoteExpired(expired_quote())).unwrap();
        assert!(matches!(m.state(), MachineState::Expired(_)));
        assert!(m.is_terminal());
    }

    #[test]
    fn unpaid_can_fail() {
        let mut m = MeltQuoteMachine::from_existing(unpaid_quote());
        m.apply(Event::QuoteFailed(failed_quote())).unwrap();
        assert!(matches!(m.state(), MachineState::Failed(_)));
        assert!(m.is_terminal());
    }

    #[test]
    fn pending_can_fail() {
        let mut m = MeltQuoteMachine::from_existing(pending_quote());
        m.apply(Event::QuoteFailed(failed_quote())).unwrap();
        assert!(matches!(m.state(), MachineState::Failed(_)));
        assert!(m.is_terminal());
    }

    #[test]
    fn cannot_poll_from_unpaid() {
        let mut m = MeltQuoteMachine::from_existing(unpaid_quote());
        let err = m.apply(Event::PollSawPending).unwrap_err();
        assert!(matches!(err, MeltQuoteError::InvalidTransition { .. }));
    }

    #[test]
    fn cannot_expire_from_pending() {
        let mut m = MeltQuoteMachine::from_existing(pending_quote());
        let err = m.apply(Event::QuoteExpired(expired_quote())).unwrap_err();
        assert!(matches!(err, MeltQuoteError::InvalidTransition { .. }));
    }

    #[test]
    fn cannot_apply_to_paid_terminal() {
        let mut m = MeltQuoteMachine::from_existing(paid_quote());
        let err = m.apply(Event::PollSawPending).unwrap_err();
        assert!(matches!(err, MeltQuoteError::InvalidTransition { .. }));
    }

    #[test]
    fn cannot_apply_to_failed_terminal() {
        let mut m = MeltQuoteMachine::from_existing(failed_quote());
        let err = m.apply(Event::QuoteCompleted(paid_quote())).unwrap_err();
        assert!(matches!(err, MeltQuoteError::InvalidTransition { .. }));
    }

    #[test]
    fn cannot_apply_to_expired_terminal() {
        let mut m = MeltQuoteMachine::from_existing(expired_quote());
        let err = m.apply(Event::PollSawPending).unwrap_err();
        assert!(matches!(err, MeltQuoteError::InvalidTransition { .. }));
    }

    #[test]
    fn cannot_request_quote_from_unpaid() {
        let mut m = MeltQuoteMachine::from_existing(unpaid_quote());
        let err = m.apply(Event::QuoteRequested(unpaid_quote())).unwrap_err();
        assert!(matches!(err, MeltQuoteError::InvalidTransition { .. }));
    }

    #[test]
    fn snapshot_returns_persisted_quote_after_creation() {
        let mut m = MeltQuoteMachine::new();
        m.apply(Event::QuoteRequested(unpaid_quote())).unwrap();
        let snap = m.snapshot().expect("unpaid quote snapshot");
        assert!(matches!(snap.state, CashuMeltQuoteState::Unpaid));
    }
}
