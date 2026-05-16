//! Sans-IO state machine for a Cashu receive swap.
//!
//! Pure state transitions: no async, no network, no storage. The orchestrator
//! ([`super::service::CashuReceiveSwapService`]) drives this machine forward
//! by reading the requested [`Action`] and feeding back the corresponding
//! [`Event`].
//!
//! Lifecycle (mirroring `app/features/receive/cashu-receive-swap-service.ts`):
//!
//! ```text
//! NotStarted ──CreateSwap──> SwapCreated ──> Pending
//! Pending ──SwapWithMint──> MintSwapSucceeded ──> [proofs ready]
//!                        │
//!                        └─MintSwapAlreadyClaimed──> [attempt restore]
//!                                               │
//!                                               ├─MintRestoreSucceeded ─> [proofs ready]
//!                                               └─else: FailSwap("already claimed")
//! Pending + proofs ready ──CompleteSwap──> SwapCompleted ──> Completed (terminal)
//! Pending ──FailSwap(reason)──> SwapFailed ──> Failed (terminal)
//! ```

use super::error::ReceiveSwapError;
use super::types::{CashuReceiveSwap, CashuReceiveSwapState};

/// Drives a receive swap forward through its lifecycle.
#[derive(Debug, Clone)]
pub struct ReceiveSwapMachine {
    state: MachineState,
}

/// Internal state. The `PendingMintSwap` / `PendingProofsReady` distinction
/// captures whether the mint roundtrip has happened yet, which determines
/// whether [`ReceiveSwapMachine::next_action`] returns `SwapWithMint` or
/// `CompleteSwap`.
#[derive(Debug, Clone)]
pub enum MachineState {
    /// Token parsed and account chosen, but no DB row exists yet.
    NotStarted,
    /// Swap row was persisted; the mint swap is still pending.
    PendingMintSwap(CashuReceiveSwap),
    /// Mint signed (or restore yielded proofs); now we just need to persist.
    PendingProofsReady(CashuReceiveSwap),
    /// Swap and proofs are persisted (terminal).
    Completed(CashuReceiveSwap),
    /// Swap failed (terminal).
    Failed(CashuReceiveSwap),
}

/// Next I/O the executor should perform.
#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    /// Persist the swap row + reserve keyset counters.
    CreateSwap,
    /// Call the mint's `/v1/swap` endpoint with blinded outputs.
    SwapWithMint {
        keyset_id: String,
        keyset_counter: u32,
        output_amounts: Vec<u64>,
    },
    /// Persist the resulting proofs and transition to COMPLETED.
    CompleteSwap { proofs_count: usize },
    /// Fail the swap with `reason`.
    FailSwap { reason: String },
    /// Terminal state — nothing more to do.
    None,
}

/// Event the executor feeds back after performing an [`Action`].
#[derive(Debug, Clone)]
pub enum Event {
    /// Storage created the swap row.
    SwapCreated(CashuReceiveSwap),
    /// Mint accepted the swap.
    MintSwapSucceeded,
    /// Mint replied with `TOKEN_ALREADY_SPENT` or `OUTPUT_ALREADY_SIGNED`.
    /// The executor should attempt to restore the outputs.
    MintSwapAlreadyClaimed,
    /// Mint restore returned proofs; we can move to `CompleteSwap`.
    MintRestoreSucceeded,
    /// Storage persisted the proofs and transitioned to COMPLETED.
    SwapCompleted(CashuReceiveSwap),
    /// Storage transitioned the swap to FAILED.
    SwapFailed(CashuReceiveSwap),
}

impl ReceiveSwapMachine {
    pub fn new() -> Self {
        Self {
            state: MachineState::NotStarted,
        }
    }

    pub fn from_existing(swap: CashuReceiveSwap) -> Self {
        let state = match &swap.state {
            CashuReceiveSwapState::Pending => MachineState::PendingMintSwap(swap),
            CashuReceiveSwapState::Completed => MachineState::Completed(swap),
            CashuReceiveSwapState::Failed { .. } => MachineState::Failed(swap),
        };
        Self { state }
    }

    pub fn state(&self) -> &MachineState {
        &self.state
    }

    pub fn is_terminal(&self) -> bool {
        matches!(
            self.state,
            MachineState::Completed(_) | MachineState::Failed(_)
        )
    }

    pub fn next_action(&self) -> Action {
        match &self.state {
            MachineState::NotStarted => Action::CreateSwap,
            MachineState::PendingMintSwap(swap) => Action::SwapWithMint {
                keyset_id: swap.keyset_id.clone(),
                keyset_counter: swap.keyset_counter,
                output_amounts: swap.output_amounts.clone(),
            },
            MachineState::PendingProofsReady(swap) => Action::CompleteSwap {
                proofs_count: swap.output_amounts.len(),
            },
            MachineState::Completed(_) | MachineState::Failed(_) => Action::None,
        }
    }

    pub fn apply(&mut self, event: Event) -> Result<(), ReceiveSwapError> {
        match (&self.state, event) {
            (MachineState::NotStarted, Event::SwapCreated(swap)) => {
                self.state = MachineState::PendingMintSwap(swap);
                Ok(())
            }
            // already-claimed and restore-succeeded are stations on the way to
            // PendingProofsReady; the executor decides which event to feed
            // based on the restore outcome.
            (
                MachineState::PendingMintSwap(swap),
                Event::MintSwapSucceeded | Event::MintRestoreSucceeded,
            ) => {
                self.state = MachineState::PendingProofsReady(swap.clone());
                Ok(())
            }
            // MintSwapAlreadyClaimed is informational: the executor is
            // expected to follow up with either MintRestoreSucceeded or
            // FailSwap (via the SwapFailed event). Without one of those, we
            // stay in PendingMintSwap; applying this event is a no-op state
            // change.
            (MachineState::PendingMintSwap(_), Event::MintSwapAlreadyClaimed) => Ok(()),
            (MachineState::PendingProofsReady(_), Event::SwapCompleted(swap)) => {
                self.state = MachineState::Completed(swap);
                Ok(())
            }
            (MachineState::PendingMintSwap(_), Event::SwapFailed(swap)) => {
                self.state = MachineState::Failed(swap);
                Ok(())
            }
            (state, event) => Err(ReceiveSwapError::InvalidTransition {
                from: format!("{state:?}"),
                event: format!("{event:?}"),
            }),
        }
    }
}

impl Default for ReceiveSwapMachine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::receive_swap::types::TokenProof;
    use agicash_domain::{AccountId, Currency, UserId};
    use agicash_money::{Money, Unit};
    use chrono::Utc;
    use rust_decimal::Decimal;
    use uuid::Uuid;

    fn dummy_money(amount: u64) -> Money {
        Money::new(Decimal::from(amount), Currency::Btc, Unit::Sat)
    }

    fn pending_swap() -> CashuReceiveSwap {
        CashuReceiveSwap {
            token_hash: "abc".into(),
            token_proofs: vec![TokenProof {
                id: "ks1".into(),
                amount: 64,
                secret: "secret".into(),
                c: "C".into(),
                dleq: None,
                witness: None,
            }],
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

    fn completed_swap() -> CashuReceiveSwap {
        let mut s = pending_swap();
        s.state = CashuReceiveSwapState::Completed;
        s
    }

    fn failed_swap(reason: &str) -> CashuReceiveSwap {
        let mut s = pending_swap();
        s.state = CashuReceiveSwapState::Failed {
            failure_reason: reason.into(),
        };
        s
    }

    #[test]
    fn new_machine_starts_in_not_started() {
        let m = ReceiveSwapMachine::new();
        assert!(matches!(m.state(), MachineState::NotStarted));
        assert_eq!(m.next_action(), Action::CreateSwap);
        assert!(!m.is_terminal());
    }

    #[test]
    fn from_existing_pending_picks_mint_swap_action() {
        let m = ReceiveSwapMachine::from_existing(pending_swap());
        assert!(matches!(m.state(), MachineState::PendingMintSwap(_)));
        match m.next_action() {
            Action::SwapWithMint {
                keyset_id,
                keyset_counter,
                output_amounts,
            } => {
                assert_eq!(keyset_id, "ks1");
                assert_eq!(keyset_counter, 0);
                assert_eq!(output_amounts, vec![64]);
            }
            other => panic!("unexpected next_action: {other:?}"),
        }
    }

    #[test]
    fn from_existing_completed_is_terminal() {
        let m = ReceiveSwapMachine::from_existing(completed_swap());
        assert!(matches!(m.state(), MachineState::Completed(_)));
        assert!(m.is_terminal());
        assert_eq!(m.next_action(), Action::None);
    }

    #[test]
    fn from_existing_failed_is_terminal() {
        let m = ReceiveSwapMachine::from_existing(failed_swap("nope"));
        assert!(matches!(m.state(), MachineState::Failed(_)));
        assert!(m.is_terminal());
        assert_eq!(m.next_action(), Action::None);
    }

    #[test]
    fn happy_path_runs_to_completion() {
        let mut m = ReceiveSwapMachine::new();
        assert_eq!(m.next_action(), Action::CreateSwap);
        m.apply(Event::SwapCreated(pending_swap())).unwrap();

        assert!(matches!(m.state(), MachineState::PendingMintSwap(_)));
        assert!(matches!(m.next_action(), Action::SwapWithMint { .. }));
        m.apply(Event::MintSwapSucceeded).unwrap();

        assert!(matches!(m.state(), MachineState::PendingProofsReady(_)));
        match m.next_action() {
            Action::CompleteSwap { proofs_count } => assert_eq!(proofs_count, 1),
            other => panic!("expected CompleteSwap, got: {other:?}"),
        }
        m.apply(Event::SwapCompleted(completed_swap())).unwrap();

        assert!(m.is_terminal());
        assert_eq!(m.next_action(), Action::None);
    }

    #[test]
    fn restore_path_after_already_claimed_then_proofs() {
        // Mint says "already signed"; restore returns proofs we can claim.
        let mut m = ReceiveSwapMachine::from_existing(pending_swap());
        m.apply(Event::MintSwapAlreadyClaimed).unwrap();
        // After AlreadyClaimed alone, state still PendingMintSwap.
        assert!(matches!(m.state(), MachineState::PendingMintSwap(_)));

        m.apply(Event::MintRestoreSucceeded).unwrap();
        assert!(matches!(m.state(), MachineState::PendingProofsReady(_)));
        m.apply(Event::SwapCompleted(completed_swap())).unwrap();
        assert!(m.is_terminal());
    }

    #[test]
    fn fail_from_pending_transitions_to_failed() {
        let mut m = ReceiveSwapMachine::from_existing(pending_swap());
        m.apply(Event::SwapFailed(failed_swap("already claimed")))
            .unwrap();
        assert!(matches!(m.state(), MachineState::Failed(_)));
        assert!(m.is_terminal());
        assert_eq!(m.next_action(), Action::None);
    }

    #[test]
    fn complete_swap_event_before_proofs_ready_is_invalid() {
        // Cannot apply SwapCompleted from PendingMintSwap.
        let mut m = ReceiveSwapMachine::from_existing(pending_swap());
        let err = m.apply(Event::SwapCompleted(completed_swap())).unwrap_err();
        assert!(matches!(err, ReceiveSwapError::InvalidTransition { .. }));
    }

    #[test]
    fn mint_swap_succeeded_from_not_started_is_invalid() {
        let mut m = ReceiveSwapMachine::new();
        let err = m.apply(Event::MintSwapSucceeded).unwrap_err();
        assert!(matches!(err, ReceiveSwapError::InvalidTransition { .. }));
    }

    #[test]
    fn applying_to_terminal_state_is_invalid() {
        let mut m = ReceiveSwapMachine::from_existing(completed_swap());
        let err = m.apply(Event::MintSwapSucceeded).unwrap_err();
        assert!(matches!(err, ReceiveSwapError::InvalidTransition { .. }));
    }

    #[test]
    fn fail_after_proofs_ready_is_invalid() {
        // We don't allow failing a swap whose mint round trip succeeded —
        // at that point, the proofs are ours to claim.
        let mut m = ReceiveSwapMachine::from_existing(pending_swap());
        m.apply(Event::MintSwapSucceeded).unwrap();
        let err = m.apply(Event::SwapFailed(failed_swap("late"))).unwrap_err();
        assert!(matches!(err, ReceiveSwapError::InvalidTransition { .. }));
    }
}
