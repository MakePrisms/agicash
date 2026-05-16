//! Sans-IO state machine for a Cashu NUT-04 mint quote.
//!
//! Pure state transitions: no async, no network, no storage. The orchestrator
//! ([`super::service::CashuMintQuoteService`]) drives this machine forward by
//! reading the requested [`Action`] and feeding back the corresponding
//! [`Event`].
//!
//! Lifecycle (mirroring `app/features/receive/cashu-receive-quote-service.ts`):
//!
//! ```text
//! NotStarted ──RequestQuote──> QuoteRequested ──> Unpaid
//! Unpaid ──PollStatus──> PollSawUnpaid ──> [stay, executor sleeps + polls]
//!                     │
//!                     ├─PollSawPaid    ──> [executor calls ProcessPayment]
//!                     │                    ──PaymentProcessed──> Paid
//!                     │
//!                     └─PollSawIssued  ──> [mint already minted — same as PollSawPaid,
//!                                          executor reconciles via restore in `Paid`]
//! Paid ──MintProofs──> MintSucceeded ──> [executor persists proofs]
//!                                    ──CompleteQuote──> QuoteCompleted ──> Completed (terminal)
//!                   │
//!                   └─MintAlreadyIssued──> [executor calls restore]
//!                                       ├─MintRestoreSucceeded ──> [persist] ──QuoteCompleted──> Completed
//!                                       └─else: FailQuote ──QuoteFailed──> Failed
//! Unpaid ──Expire──> QuoteExpired ──> Expired (terminal)
//! Unpaid ──Fail──> QuoteFailed ──> Failed (terminal)
//! ```

use super::error::MintQuoteError;
use super::types::{CashuMintQuote, CashuMintQuoteState};

/// Drives a mint-quote forward through its lifecycle.
#[derive(Debug, Clone)]
pub struct MintQuoteMachine {
    state: MachineState,
}

/// Internal state. The `Paid` variant always carries a quote whose
/// `state` is [`CashuMintQuoteState::Paid`]; the orchestrator relies on
/// that invariant when reading `keyset_id` / `keyset_counter` /
/// `output_amounts` to issue `MintProofs`.
#[derive(Debug, Clone)]
pub enum MachineState {
    /// Amount + account chosen, no quote requested yet.
    NotStarted,
    /// Invoice issued, awaiting external payment.
    Unpaid(CashuMintQuote),
    /// Mint reports PAID; keyset metadata persisted. Ready to mint.
    Paid(CashuMintQuote),
    /// Proofs minted, account credited (terminal).
    Completed(CashuMintQuote),
    /// Quote expired (terminal).
    Expired(CashuMintQuote),
    /// Quote failed (terminal).
    Failed(CashuMintQuote),
}

/// Next I/O the executor should perform.
#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    /// Ask the mint for a NUT-04 mint quote and persist the row.
    RequestQuote,
    /// Poll the mint's `mint_quote/status` endpoint.
    PollStatus { quote_id: String },
    /// Mint the proofs via NUT-04 mint endpoint, then persist them.
    MintProofs {
        keyset_id: String,
        keyset_counter: u32,
        output_amounts: Vec<u64>,
    },
    /// Terminal state — nothing more to do.
    None,
}

/// Event the executor feeds back after performing an [`Action`].
#[derive(Debug, Clone)]
pub enum Event {
    /// Storage created the UNPAID quote row.
    QuoteRequested(CashuMintQuote),
    /// Mint reports the invoice still unpaid; stay in `Unpaid`.
    PollSawUnpaid,
    /// Mint reports the invoice paid AND the executor has persisted the
    /// PAID transition (so the quote now carries keyset metadata).
    PaymentProcessed(CashuMintQuote),
    /// Mint accepted the mint request and returned blind signatures.
    MintSucceeded,
    /// Mint replied with `QUOTE_ALREADY_ISSUED` /
    /// `OUTPUT_ALREADY_SIGNED`. Executor should attempt restore.
    MintAlreadyIssued,
    /// Restore yielded usable proofs; we can now persist.
    MintRestoreSucceeded,
    /// Storage persisted the proofs and transitioned to COMPLETED.
    QuoteCompleted(CashuMintQuote),
    /// Storage transitioned the quote to EXPIRED.
    QuoteExpired(CashuMintQuote),
    /// Storage transitioned the quote to FAILED.
    QuoteFailed(CashuMintQuote),
}

impl MintQuoteMachine {
    pub fn new() -> Self {
        Self {
            state: MachineState::NotStarted,
        }
    }

    pub fn from_existing(quote: CashuMintQuote) -> Self {
        let state = match &quote.state {
            CashuMintQuoteState::Unpaid => MachineState::Unpaid(quote),
            CashuMintQuoteState::Paid { .. } => MachineState::Paid(quote),
            CashuMintQuoteState::Completed { .. } => MachineState::Completed(quote),
            CashuMintQuoteState::Expired => MachineState::Expired(quote),
            CashuMintQuoteState::Failed { .. } => MachineState::Failed(quote),
        };
        Self { state }
    }

    pub fn state(&self) -> &MachineState {
        &self.state
    }

    pub fn is_terminal(&self) -> bool {
        matches!(
            self.state,
            MachineState::Completed(_) | MachineState::Expired(_) | MachineState::Failed(_)
        )
    }

    pub fn next_action(&self) -> Action {
        match &self.state {
            MachineState::NotStarted => Action::RequestQuote,
            MachineState::Unpaid(q) => Action::PollStatus {
                quote_id: q.quote_id.clone(),
            },
            MachineState::Paid(q) => match &q.state {
                CashuMintQuoteState::Paid {
                    keyset_id,
                    keyset_counter,
                    output_amounts,
                } => Action::MintProofs {
                    keyset_id: keyset_id.clone(),
                    keyset_counter: *keyset_counter,
                    output_amounts: output_amounts.clone(),
                },
                // Invariant: Paid(_) always wraps a Paid-state quote. If
                // that's not the case, surface as terminal so callers fail
                // safe.
                _ => Action::None,
            },
            MachineState::Completed(_) | MachineState::Expired(_) | MachineState::Failed(_) => {
                Action::None
            }
        }
    }

    pub fn apply(&mut self, event: Event) -> Result<(), MintQuoteError> {
        match (&self.state, event) {
            (MachineState::NotStarted, Event::QuoteRequested(quote)) => {
                self.state = MachineState::Unpaid(quote);
                Ok(())
            }
            // PollSawUnpaid is a no-op state change — the executor keeps
            // polling. We accept the event so the executor can apply
            // unconditionally without branching.
            (MachineState::Unpaid(_), Event::PollSawUnpaid) => Ok(()),
            (MachineState::Unpaid(_), Event::PaymentProcessed(quote)) => {
                // The orchestrator only emits PaymentProcessed after the
                // PAID storage RPC succeeds; the wrapped quote already
                // has CashuMintQuoteState::Paid.
                self.state = MachineState::Paid(quote);
                Ok(())
            }
            (MachineState::Unpaid(_), Event::QuoteExpired(quote)) => {
                self.state = MachineState::Expired(quote);
                Ok(())
            }
            (MachineState::Unpaid(_) | MachineState::Paid(_), Event::QuoteFailed(quote)) => {
                self.state = MachineState::Failed(quote);
                Ok(())
            }
            (MachineState::Paid(_), Event::MintSucceeded | Event::MintRestoreSucceeded) => {
                // Stay in Paid; the executor follows with QuoteCompleted
                // after persisting the proofs.
                Ok(())
            }
            (MachineState::Paid(_), Event::MintAlreadyIssued) => {
                // Stay in Paid; executor must attempt restore and follow
                // with MintRestoreSucceeded or QuoteFailed.
                Ok(())
            }
            (MachineState::Paid(_), Event::QuoteCompleted(quote)) => {
                self.state = MachineState::Completed(quote);
                Ok(())
            }
            (state, event) => Err(MintQuoteError::InvalidTransition {
                from: format!("{state:?}"),
                event: format!("{event:?}"),
            }),
        }
    }
}

impl Default for MintQuoteMachine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use agicash_domain::{AccountId, Currency, UserId};
    use agicash_money::{Money, Unit};
    use chrono::Utc;
    use rust_decimal::Decimal;
    use uuid::Uuid;

    fn dummy_money(amount: u64) -> Money {
        Money::new(Decimal::from(amount), Currency::Btc, Unit::Sat)
    }

    fn unpaid_quote() -> CashuMintQuote {
        CashuMintQuote {
            id: Uuid::new_v4(),
            quote_id: "qid".into(),
            user_id: UserId::new(),
            account_id: AccountId::new(),
            amount: dummy_money(64),
            description: None,
            payment_request: "lnbc...".into(),
            payment_hash: "h".into(),
            locking_derivation_path: String::new(),
            transaction_id: Uuid::new_v4(),
            minting_fee: None,
            total_fee: dummy_money(0),
            created_at: Utc::now(),
            expires_at: Utc::now(),
            version: 0,
            state: CashuMintQuoteState::Unpaid,
        }
    }

    fn paid_quote() -> CashuMintQuote {
        let mut q = unpaid_quote();
        q.state = CashuMintQuoteState::Paid {
            keyset_id: "ks1".into(),
            keyset_counter: 3,
            output_amounts: vec![64],
        };
        q
    }

    fn completed_quote() -> CashuMintQuote {
        let mut q = unpaid_quote();
        q.state = CashuMintQuoteState::Completed {
            keyset_id: "ks1".into(),
            keyset_counter: 3,
            output_amounts: vec![64],
        };
        q
    }

    fn expired_quote() -> CashuMintQuote {
        let mut q = unpaid_quote();
        q.state = CashuMintQuoteState::Expired;
        q
    }

    fn failed_quote() -> CashuMintQuote {
        let mut q = unpaid_quote();
        q.state = CashuMintQuoteState::Failed {
            failure_reason: "nope".into(),
        };
        q
    }

    #[test]
    fn new_machine_starts_in_not_started() {
        let m = MintQuoteMachine::new();
        assert!(matches!(m.state(), MachineState::NotStarted));
        assert_eq!(m.next_action(), Action::RequestQuote);
        assert!(!m.is_terminal());
    }

    #[test]
    fn from_existing_unpaid_yields_poll_action() {
        let m = MintQuoteMachine::from_existing(unpaid_quote());
        assert!(matches!(m.state(), MachineState::Unpaid(_)));
        match m.next_action() {
            Action::PollStatus { quote_id } => assert_eq!(quote_id, "qid"),
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn from_existing_paid_yields_mint_action() {
        let m = MintQuoteMachine::from_existing(paid_quote());
        assert!(matches!(m.state(), MachineState::Paid(_)));
        match m.next_action() {
            Action::MintProofs {
                keyset_id,
                keyset_counter,
                output_amounts,
            } => {
                assert_eq!(keyset_id, "ks1");
                assert_eq!(keyset_counter, 3);
                assert_eq!(output_amounts, vec![64]);
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn from_existing_completed_is_terminal() {
        let m = MintQuoteMachine::from_existing(completed_quote());
        assert!(m.is_terminal());
        assert_eq!(m.next_action(), Action::None);
    }

    #[test]
    fn from_existing_expired_is_terminal() {
        let m = MintQuoteMachine::from_existing(expired_quote());
        assert!(m.is_terminal());
    }

    #[test]
    fn from_existing_failed_is_terminal() {
        let m = MintQuoteMachine::from_existing(failed_quote());
        assert!(m.is_terminal());
    }

    #[test]
    fn happy_path_runs_to_completion() {
        let mut m = MintQuoteMachine::new();
        assert_eq!(m.next_action(), Action::RequestQuote);
        m.apply(Event::QuoteRequested(unpaid_quote())).unwrap();

        assert!(matches!(m.state(), MachineState::Unpaid(_)));
        match m.next_action() {
            Action::PollStatus { .. } => {}
            other => panic!("unexpected: {other:?}"),
        }
        // Two PollSawUnpaid events keep us in Unpaid.
        m.apply(Event::PollSawUnpaid).unwrap();
        m.apply(Event::PollSawUnpaid).unwrap();
        assert!(matches!(m.state(), MachineState::Unpaid(_)));

        // Now mint reports PAID; orchestrator persists and applies.
        m.apply(Event::PaymentProcessed(paid_quote())).unwrap();
        assert!(matches!(m.state(), MachineState::Paid(_)));
        assert!(matches!(m.next_action(), Action::MintProofs { .. }));

        m.apply(Event::MintSucceeded).unwrap();
        assert!(matches!(m.state(), MachineState::Paid(_)));

        m.apply(Event::QuoteCompleted(completed_quote())).unwrap();
        assert!(matches!(m.state(), MachineState::Completed(_)));
        assert!(m.is_terminal());
        assert_eq!(m.next_action(), Action::None);
    }

    #[test]
    fn restore_path_after_already_issued() {
        let mut m = MintQuoteMachine::from_existing(paid_quote());
        m.apply(Event::MintAlreadyIssued).unwrap();
        // Stay in Paid until executor follows up.
        assert!(matches!(m.state(), MachineState::Paid(_)));

        m.apply(Event::MintRestoreSucceeded).unwrap();
        assert!(matches!(m.state(), MachineState::Paid(_)));

        m.apply(Event::QuoteCompleted(completed_quote())).unwrap();
        assert!(matches!(m.state(), MachineState::Completed(_)));
    }

    #[test]
    fn restore_fail_path_transitions_to_failed() {
        let mut m = MintQuoteMachine::from_existing(paid_quote());
        m.apply(Event::MintAlreadyIssued).unwrap();
        // No restore; executor failed the quote on the storage side.
        m.apply(Event::QuoteFailed(failed_quote())).unwrap();
        assert!(matches!(m.state(), MachineState::Failed(_)));
        assert!(m.is_terminal());
    }

    #[test]
    fn unpaid_can_expire() {
        let mut m = MintQuoteMachine::from_existing(unpaid_quote());
        m.apply(Event::QuoteExpired(expired_quote())).unwrap();
        assert!(matches!(m.state(), MachineState::Expired(_)));
        assert!(m.is_terminal());
    }

    #[test]
    fn unpaid_can_fail() {
        let mut m = MintQuoteMachine::from_existing(unpaid_quote());
        m.apply(Event::QuoteFailed(failed_quote())).unwrap();
        assert!(matches!(m.state(), MachineState::Failed(_)));
        assert!(m.is_terminal());
    }

    #[test]
    fn cannot_complete_from_unpaid() {
        let mut m = MintQuoteMachine::from_existing(unpaid_quote());
        let err = m
            .apply(Event::QuoteCompleted(completed_quote()))
            .unwrap_err();
        assert!(matches!(err, MintQuoteError::InvalidTransition { .. }));
    }

    #[test]
    fn cannot_mint_from_not_started() {
        let mut m = MintQuoteMachine::new();
        let err = m.apply(Event::MintSucceeded).unwrap_err();
        assert!(matches!(err, MintQuoteError::InvalidTransition { .. }));
    }

    #[test]
    fn cannot_apply_to_completed() {
        let mut m = MintQuoteMachine::from_existing(completed_quote());
        let err = m.apply(Event::MintSucceeded).unwrap_err();
        assert!(matches!(err, MintQuoteError::InvalidTransition { .. }));
    }

    #[test]
    fn cannot_expire_from_paid() {
        let mut m = MintQuoteMachine::from_existing(paid_quote());
        let err = m.apply(Event::QuoteExpired(expired_quote())).unwrap_err();
        assert!(matches!(err, MintQuoteError::InvalidTransition { .. }));
    }
}
