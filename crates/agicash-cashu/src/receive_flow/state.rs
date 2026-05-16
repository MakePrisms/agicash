//! Sans-IO state machine for the Cashu receive flow.
//!
//! The orchestrator ([`super::service::ReceiveFlowService`]) drives this
//! machine by:
//! 1. Reading the current [`ReceiveFlowState`].
//! 2. Performing the I/O appropriate to that state (parse, mint info, add,
//!    swap).
//! 3. Calling [`ReceiveFlowMachine::transition`] with the next state.
//!
//! UI events are validated by [`ReceiveFlowMachine::accepts`] — the
//! orchestrator surface uses it to reject events that don't belong to the
//! current state (e.g. `ConfirmAddMint` from `Swapping`).

use super::types::{ReceiveFlowEvent, ReceiveFlowState};

/// Holds the current public state and the pending context the orchestrator
/// needs between steps (parsed token, picked account, etc.).
#[derive(Debug, Clone)]
pub struct ReceiveFlowMachine {
    state: ReceiveFlowState,
}

impl ReceiveFlowMachine {
    #[must_use]
    pub fn new() -> Self {
        Self {
            state: ReceiveFlowState::Idle,
        }
    }

    #[must_use]
    pub fn state(&self) -> &ReceiveFlowState {
        &self.state
    }

    pub fn transition(&mut self, next: ReceiveFlowState) {
        self.state = next;
    }

    /// Whether the machine is in a terminal state.
    #[must_use]
    pub fn is_terminal(&self) -> bool {
        self.state.is_terminal()
    }

    /// Whether the supplied UI event is acceptable in the current state.
    /// The orchestrator calls this before performing any I/O; rejecting
    /// invalid events keeps the contract crisp for the UI shell.
    #[must_use]
    pub fn accepts(&self, event: &ReceiveFlowEvent) -> bool {
        use ReceiveFlowEvent as E;
        use ReceiveFlowState as S;
        match (&self.state, event) {
            // Start is only valid from Idle.
            (S::Idle, E::Start { .. }) => true,
            // Confirm / Cancel only apply when we're asking the user to
            // approve a mint add.
            (S::NeedsMintConfirmation(_), E::ConfirmAddMint | E::CancelAddMint) => true,
            // Retry / Dismiss only matter from terminal states.
            (S::Done(_) | S::Failed { .. }, E::Retry | E::Dismiss) => true,
            _ => false,
        }
    }
}

impl Default for ReceiveFlowMachine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::receive_flow::types::{MintConfirmation, ReceiveFlowResult, ReceiveStatus};

    fn done_state() -> ReceiveFlowState {
        ReceiveFlowState::Done(ReceiveFlowResult {
            status: ReceiveStatus::Received,
            amount: "64".into(),
            fee: "0".into(),
            unit: "sat".into(),
            currency: "BTC".into(),
            account_id: "a".into(),
            mint_url: "https://m".into(),
            token_hash: "h".into(),
        })
    }

    fn needs_mint() -> ReceiveFlowState {
        ReceiveFlowState::NeedsMintConfirmation(MintConfirmation {
            mint_url: "https://m".into(),
            mint_name: "Mint".into(),
            unit: "sat".into(),
            currency: "BTC".into(),
            amount: "100".into(),
            fee: "0".into(),
        })
    }

    #[test]
    fn machine_starts_in_idle() {
        let m = ReceiveFlowMachine::new();
        assert!(matches!(m.state(), ReceiveFlowState::Idle));
        assert!(!m.is_terminal());
    }

    #[test]
    fn idle_accepts_start_only() {
        let m = ReceiveFlowMachine::new();
        assert!(m.accepts(&ReceiveFlowEvent::Start {
            token: "x".into()
        }));
        assert!(!m.accepts(&ReceiveFlowEvent::ConfirmAddMint));
        assert!(!m.accepts(&ReceiveFlowEvent::Retry));
        assert!(!m.accepts(&ReceiveFlowEvent::Dismiss));
    }

    #[test]
    fn needs_mint_accepts_confirm_and_cancel_only() {
        let mut m = ReceiveFlowMachine::new();
        m.transition(needs_mint());
        assert!(m.accepts(&ReceiveFlowEvent::ConfirmAddMint));
        assert!(m.accepts(&ReceiveFlowEvent::CancelAddMint));
        assert!(!m.accepts(&ReceiveFlowEvent::Start {
            token: "x".into()
        }));
        assert!(!m.accepts(&ReceiveFlowEvent::Retry));
    }

    #[test]
    fn done_accepts_retry_and_dismiss_only() {
        let mut m = ReceiveFlowMachine::new();
        m.transition(done_state());
        assert!(m.is_terminal());
        assert!(m.accepts(&ReceiveFlowEvent::Retry));
        assert!(m.accepts(&ReceiveFlowEvent::Dismiss));
        assert!(!m.accepts(&ReceiveFlowEvent::Start {
            token: "x".into()
        }));
        assert!(!m.accepts(&ReceiveFlowEvent::ConfirmAddMint));
    }

    #[test]
    fn failed_accepts_retry_and_dismiss_only() {
        let mut m = ReceiveFlowMachine::new();
        m.transition(ReceiveFlowState::Failed {
            reason: "x".into(),
            code: "unknown".into(),
        });
        assert!(m.is_terminal());
        assert!(m.accepts(&ReceiveFlowEvent::Retry));
        assert!(m.accepts(&ReceiveFlowEvent::Dismiss));
        assert!(!m.accepts(&ReceiveFlowEvent::Start {
            token: "x".into()
        }));
    }

    #[test]
    fn intermediate_states_reject_all_user_events() {
        // While Parsing / AddingMint / Swapping, the UI shouldn't be able
        // to send any event — the orchestrator owns the transition.
        for s in [
            ReceiveFlowState::Parsing,
            ReceiveFlowState::AddingMint {
                mint_url: "u".into(),
            },
            ReceiveFlowState::Swapping {
                account_id: "a".into(),
                mint_url: "u".into(),
            },
        ] {
            let mut m = ReceiveFlowMachine::new();
            m.transition(s);
            assert!(!m.accepts(&ReceiveFlowEvent::Start {
                token: "x".into()
            }));
            assert!(!m.accepts(&ReceiveFlowEvent::ConfirmAddMint));
            assert!(!m.accepts(&ReceiveFlowEvent::CancelAddMint));
            assert!(!m.accepts(&ReceiveFlowEvent::Retry));
            assert!(!m.accepts(&ReceiveFlowEvent::Dismiss));
        }
    }

    #[test]
    fn transition_to_terminal_marks_terminal() {
        let mut m = ReceiveFlowMachine::new();
        assert!(!m.is_terminal());
        m.transition(done_state());
        assert!(m.is_terminal());
    }
}
