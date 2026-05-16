//! Sans-IO state machine for a Cashu send swap.
//!
//! Pure state transitions: no async, no network, no storage. The orchestrator
//! ([`super::service::CashuSendSwapService`]) drives this machine forward by
//! reading the requested [`Action`] and feeding back the corresponding
//! [`Event`].
//!
//! Lifecycle (mirroring `app/features/send/cashu-send-swap-service.ts`):
//!
//! ```text
//! NotStarted ──CreateSwap{requires_swap=false}──> SwapCreated(PENDING) ──> Pending
//! NotStarted ──CreateSwap{requires_swap=true}──> SwapCreated(DRAFT) ──> Draft
//!
//! Draft ──SwapWithMint──> MintSwapSucceeded ──> ProofsReady ──CommitProofsToSend──> Pending
//!      │
//!      └─MintSwapAlreadyExecuted──> [executor calls restore]
//!                              │
//!                              ├─MintRestoreSucceeded──> ProofsReady ──CommitProofsToSend──> Pending
//!                              └─else: FailSwap ──> SwapFailed ──> Failed
//!
//! Draft ──FailSwap──> SwapFailed ──> Failed (terminal)
//! Pending ──CompleteSwap──> SwapCompleted ──> Completed (terminal)
//! ```

use super::error::SendSwapError;
use super::types::{CashuSendSwap, CashuSendSwapState};
use crate::receive_swap::TokenProof;

/// Drives a send swap forward through its lifecycle.
#[derive(Debug, Clone)]
pub struct SendSwapMachine {
    state: MachineState,
}

/// Internal state. The `DraftProofsReady` variant is a transient station the
/// machine reaches between `Draft` (before the mint swap) and `Pending`
/// (after `CommitProofsToSend`). Holding the swapped proofs in-memory lets
/// the executor decide what to do without re-querying the mint.
#[derive(Debug, Clone)]
pub enum MachineState {
    /// Caller has the input proofs picked but no DB row yet.
    NotStarted,
    /// Persisted DRAFT — input swap with mint pending.
    Draft(CashuSendSwap),
    /// Mint signed (or restore yielded proofs); now we just need to commit
    /// them to storage. Carries the swapped send + change proofs.
    DraftProofsReady {
        swap: CashuSendSwap,
        proofs_to_send: Vec<TokenProof>,
        change_proofs: Vec<TokenProof>,
    },
    /// Persisted PENDING — proofs-to-send live, awaiting receiver claim.
    Pending(CashuSendSwap),
    /// Persisted COMPLETED — receiver claimed the token (terminal).
    Completed(CashuSendSwap),
    /// Persisted FAILED — swap aborted before reaching PENDING (terminal).
    Failed(CashuSendSwap),
    /// Persisted REVERSED — sender swapped proofs back into the account
    /// (terminal). Reversal is a future slice; keep the variant so
    /// `from_existing` round-trips REVERSED rows.
    Reversed(CashuSendSwap),
}

/// Next I/O the executor should perform.
#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    /// Persist the swap row + reserve input proofs. If
    /// `requires_input_proofs_swap` is false, jumps straight to PENDING.
    CreateSwap { requires_input_proofs_swap: bool },
    /// Call the mint's `/v1/swap` endpoint with deterministic blinded
    /// outputs derived from `(keyset_id, keyset_counter, send_amounts +
    /// change_amounts)`.
    SwapWithMint {
        keyset_id: String,
        keyset_counter: u32,
        send_amounts: Vec<u64>,
        change_amounts: Vec<u64>,
    },
    /// Persist the resulting send + change proofs and transition
    /// DRAFT → PENDING.
    CommitProofsToSend { token_hash: String },
    /// PENDING → COMPLETED (caller detected receiver claim externally).
    CompleteSwap,
    /// DRAFT → FAILED with `reason`.
    FailSwap { reason: String },
    /// Terminal — nothing more to do.
    None,
}

/// Event the executor feeds back after performing an [`Action`].
#[derive(Debug, Clone)]
pub enum Event {
    /// Storage created the swap row (DRAFT or PENDING per the
    /// `CreateSwap` flag).
    SwapCreated(CashuSendSwap),
    /// Mint accepted the swap and returned new proofs.
    MintSwapSucceeded {
        proofs_to_send: Vec<TokenProof>,
        change_proofs: Vec<TokenProof>,
    },
    /// Mint replied with `OUTPUT_ALREADY_SIGNED` or `TOKEN_ALREADY_SPENT`.
    /// Executor is expected to follow up with either a
    /// `MintRestoreSucceeded` (with the restored proofs) or `SwapFailed`.
    MintSwapAlreadyExecuted,
    /// Mint restore returned proofs; we can move to commit.
    MintRestoreSucceeded {
        proofs_to_send: Vec<TokenProof>,
        change_proofs: Vec<TokenProof>,
    },
    /// Storage persisted proofs-to-send / change proofs and moved DRAFT →
    /// PENDING.
    ProofsCommitted(CashuSendSwap),
    /// Storage transitioned PENDING → COMPLETED.
    SwapCompleted(CashuSendSwap),
    /// Storage transitioned DRAFT → FAILED.
    SwapFailed(CashuSendSwap),
}

impl SendSwapMachine {
    pub fn new() -> Self {
        Self {
            state: MachineState::NotStarted,
        }
    }

    pub fn from_existing(swap: CashuSendSwap) -> Self {
        let state = match &swap.state {
            CashuSendSwapState::Draft => MachineState::Draft(swap),
            CashuSendSwapState::Pending { .. } => MachineState::Pending(swap),
            CashuSendSwapState::Completed { .. } => MachineState::Completed(swap),
            CashuSendSwapState::Failed { .. } => MachineState::Failed(swap),
            CashuSendSwapState::Reversed => MachineState::Reversed(swap),
        };
        Self { state }
    }

    pub fn state(&self) -> &MachineState {
        &self.state
    }

    pub fn is_terminal(&self) -> bool {
        matches!(
            self.state,
            MachineState::Completed(_) | MachineState::Failed(_) | MachineState::Reversed(_)
        )
    }

    /// Snapshot of the underlying persisted swap, when one exists.
    /// Returns `None` for `NotStarted` (no row yet).
    pub fn snapshot(&self) -> Option<&CashuSendSwap> {
        match &self.state {
            MachineState::NotStarted => None,
            MachineState::Draft(s)
            | MachineState::DraftProofsReady { swap: s, .. }
            | MachineState::Pending(s)
            | MachineState::Completed(s)
            | MachineState::Failed(s)
            | MachineState::Reversed(s) => Some(s),
        }
    }

    pub fn next_action(&self) -> Action {
        match &self.state {
            // The orchestrator is responsible for telling the machine
            // whether the input proofs already match the requested
            // amount-to-send. NotStarted alone can't know — it returns
            // CreateSwap with a sentinel `requires_input_proofs_swap=true`,
            // which the orchestrator overrides via direct construction
            // when no swap is needed.
            MachineState::NotStarted => Action::CreateSwap {
                requires_input_proofs_swap: true,
            },
            MachineState::Draft(swap) => {
                let keyset_id = swap.keyset_id.clone().unwrap_or_default();
                let keyset_counter = swap.keyset_counter.unwrap_or(0);
                let (send_amounts, change_amounts) = swap
                    .output_amounts
                    .as_ref()
                    .map(|o| (o.send.clone(), o.change.clone()))
                    .unwrap_or_default();
                Action::SwapWithMint {
                    keyset_id,
                    keyset_counter,
                    send_amounts,
                    change_amounts,
                }
            }
            MachineState::DraftProofsReady { swap, .. } => {
                // Token hash is computed by the executor over proofs_to_send
                // before calling commit. Surface a placeholder; orchestrator
                // overrides when it issues the actual storage call.
                Action::CommitProofsToSend {
                    token_hash: swap.keyset_id.clone().unwrap_or_else(|| "pending".into()),
                }
            }
            MachineState::Pending(_) => Action::CompleteSwap,
            MachineState::Completed(_) | MachineState::Failed(_) | MachineState::Reversed(_) => {
                Action::None
            }
        }
    }

    pub fn apply(&mut self, event: Event) -> Result<(), SendSwapError> {
        match (&self.state, event) {
            // NotStarted -> SwapCreated dispatches by the swap's persisted
            // state. A swap created with no input swap required arrives
            // already-PENDING from storage; one that requires a swap
            // arrives DRAFT.
            (MachineState::NotStarted, Event::SwapCreated(swap)) => {
                self.state = match &swap.state {
                    CashuSendSwapState::Draft => MachineState::Draft(swap),
                    CashuSendSwapState::Pending { .. } => MachineState::Pending(swap),
                    other => {
                        return Err(SendSwapError::InvalidTransition {
                            from: "NotStarted".into(),
                            event: format!("SwapCreated with state {other:?}"),
                        });
                    }
                };
                Ok(())
            }
            (
                MachineState::Draft(swap),
                Event::MintSwapSucceeded {
                    proofs_to_send,
                    change_proofs,
                }
                | Event::MintRestoreSucceeded {
                    proofs_to_send,
                    change_proofs,
                },
            ) => {
                self.state = MachineState::DraftProofsReady {
                    swap: swap.clone(),
                    proofs_to_send,
                    change_proofs,
                };
                Ok(())
            }
            // MintSwapAlreadyExecuted is informational — the executor is
            // expected to follow up with either MintRestoreSucceeded or
            // SwapFailed. Without one of those, we stay in Draft; applying
            // this event is a no-op state change.
            (MachineState::Draft(_), Event::MintSwapAlreadyExecuted) => Ok(()),
            (MachineState::DraftProofsReady { .. }, Event::ProofsCommitted(swap)) => {
                self.state = MachineState::Pending(swap);
                Ok(())
            }
            (MachineState::Pending(_), Event::SwapCompleted(swap)) => {
                self.state = MachineState::Completed(swap);
                Ok(())
            }
            (MachineState::Draft(_), Event::SwapFailed(swap)) => {
                self.state = MachineState::Failed(swap);
                Ok(())
            }
            (state, event) => Err(SendSwapError::InvalidTransition {
                from: format!("{state:?}"),
                event: format!("{event:?}"),
            }),
        }
    }
}

impl Default for SendSwapMachine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::receive_swap::TokenProof;
    use crate::send_swap::types::{CashuSendSwapState, OutputAmounts};
    use agicash_domain::{AccountId, Currency, UserId};
    use agicash_money::{Money, Unit};
    use chrono::Utc;
    use rust_decimal::Decimal;
    use uuid::Uuid;

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

    fn draft_swap() -> CashuSendSwap {
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

    fn pending_swap() -> CashuSendSwap {
        let mut s = draft_swap();
        s.keyset_id = None;
        s.keyset_counter = None;
        s.output_amounts = None;
        s.state = CashuSendSwapState::Pending {
            token_hash: "h".into(),
            proofs_to_send: vec![dummy_proof(60)],
        };
        s
    }

    fn completed_swap() -> CashuSendSwap {
        let mut s = draft_swap();
        s.state = CashuSendSwapState::Completed {
            token_hash: "h".into(),
            proofs_to_send: vec![dummy_proof(60)],
        };
        s
    }

    fn failed_swap(reason: &str) -> CashuSendSwap {
        let mut s = draft_swap();
        s.state = CashuSendSwapState::Failed {
            failure_reason: reason.into(),
        };
        s
    }

    fn reversed_swap() -> CashuSendSwap {
        let mut s = draft_swap();
        s.state = CashuSendSwapState::Reversed;
        s
    }

    #[test]
    fn new_machine_starts_in_not_started() {
        let m = SendSwapMachine::new();
        assert!(matches!(m.state(), MachineState::NotStarted));
        assert_eq!(
            m.next_action(),
            Action::CreateSwap {
                requires_input_proofs_swap: true,
            }
        );
        assert!(!m.is_terminal());
        assert!(m.snapshot().is_none());
    }

    #[test]
    fn from_existing_draft_picks_swap_with_mint_action() {
        let m = SendSwapMachine::from_existing(draft_swap());
        assert!(matches!(m.state(), MachineState::Draft(_)));
        match m.next_action() {
            Action::SwapWithMint {
                keyset_id,
                keyset_counter,
                send_amounts,
                change_amounts,
            } => {
                assert_eq!(keyset_id, "ks1");
                assert_eq!(keyset_counter, 3);
                assert_eq!(send_amounts, vec![32, 16, 8, 4]);
                assert!(change_amounts.is_empty());
            }
            other => panic!("unexpected next_action: {other:?}"),
        }
    }

    #[test]
    fn from_existing_pending_picks_complete_action() {
        let m = SendSwapMachine::from_existing(pending_swap());
        assert!(matches!(m.state(), MachineState::Pending(_)));
        assert_eq!(m.next_action(), Action::CompleteSwap);
        assert!(!m.is_terminal());
    }

    #[test]
    fn from_existing_completed_is_terminal() {
        let m = SendSwapMachine::from_existing(completed_swap());
        assert!(matches!(m.state(), MachineState::Completed(_)));
        assert!(m.is_terminal());
        assert_eq!(m.next_action(), Action::None);
    }

    #[test]
    fn from_existing_failed_is_terminal() {
        let m = SendSwapMachine::from_existing(failed_swap("nope"));
        assert!(matches!(m.state(), MachineState::Failed(_)));
        assert!(m.is_terminal());
        assert_eq!(m.next_action(), Action::None);
    }

    #[test]
    fn from_existing_reversed_is_terminal() {
        let m = SendSwapMachine::from_existing(reversed_swap());
        assert!(matches!(m.state(), MachineState::Reversed(_)));
        assert!(m.is_terminal());
        assert_eq!(m.next_action(), Action::None);
    }

    #[test]
    fn happy_exact_proofs_path_jumps_to_pending() {
        let mut m = SendSwapMachine::new();
        m.apply(Event::SwapCreated(pending_swap())).unwrap();
        assert!(matches!(m.state(), MachineState::Pending(_)));
        assert_eq!(m.next_action(), Action::CompleteSwap);
        // PENDING -> COMPLETED requires external receiver claim.
        m.apply(Event::SwapCompleted(completed_swap())).unwrap();
        assert!(m.is_terminal());
        assert_eq!(m.next_action(), Action::None);
    }

    #[test]
    fn happy_swap_path_runs_through_draft_to_pending() {
        let mut m = SendSwapMachine::new();
        m.apply(Event::SwapCreated(draft_swap())).unwrap();
        assert!(matches!(m.state(), MachineState::Draft(_)));
        assert!(matches!(m.next_action(), Action::SwapWithMint { .. }));

        m.apply(Event::MintSwapSucceeded {
            proofs_to_send: vec![dummy_proof(60)],
            change_proofs: vec![],
        })
        .unwrap();
        assert!(matches!(m.state(), MachineState::DraftProofsReady { .. }));
        assert!(matches!(m.next_action(), Action::CommitProofsToSend { .. }));

        m.apply(Event::ProofsCommitted(pending_swap())).unwrap();
        assert!(matches!(m.state(), MachineState::Pending(_)));
        assert_eq!(m.next_action(), Action::CompleteSwap);
    }

    #[test]
    fn restore_path_after_already_executed_then_proofs() {
        let mut m = SendSwapMachine::from_existing(draft_swap());
        m.apply(Event::MintSwapAlreadyExecuted).unwrap();
        // Still Draft after just AlreadyExecuted.
        assert!(matches!(m.state(), MachineState::Draft(_)));

        m.apply(Event::MintRestoreSucceeded {
            proofs_to_send: vec![dummy_proof(60)],
            change_proofs: vec![],
        })
        .unwrap();
        assert!(matches!(m.state(), MachineState::DraftProofsReady { .. }));
        m.apply(Event::ProofsCommitted(pending_swap())).unwrap();
        assert!(matches!(m.state(), MachineState::Pending(_)));
    }

    #[test]
    fn restore_fail_path_transitions_to_failed() {
        let mut m = SendSwapMachine::from_existing(draft_swap());
        m.apply(Event::MintSwapAlreadyExecuted).unwrap();
        assert!(matches!(m.state(), MachineState::Draft(_)));
        m.apply(Event::SwapFailed(failed_swap("mint already executed")))
            .unwrap();
        assert!(matches!(m.state(), MachineState::Failed(_)));
        assert!(m.is_terminal());
        assert_eq!(m.next_action(), Action::None);
    }

    #[test]
    fn fail_from_draft_transitions_to_failed() {
        let mut m = SendSwapMachine::from_existing(draft_swap());
        m.apply(Event::SwapFailed(failed_swap("user aborted")))
            .unwrap();
        assert!(matches!(m.state(), MachineState::Failed(_)));
        assert!(m.is_terminal());
    }

    #[test]
    fn complete_swap_event_from_draft_is_invalid() {
        let mut m = SendSwapMachine::from_existing(draft_swap());
        let err = m.apply(Event::SwapCompleted(completed_swap())).unwrap_err();
        assert!(matches!(err, SendSwapError::InvalidTransition { .. }));
    }

    #[test]
    fn fail_swap_event_from_pending_is_invalid() {
        let mut m = SendSwapMachine::from_existing(pending_swap());
        let err = m.apply(Event::SwapFailed(failed_swap("late"))).unwrap_err();
        assert!(matches!(err, SendSwapError::InvalidTransition { .. }));
    }

    #[test]
    fn mint_swap_event_from_pending_is_invalid() {
        let mut m = SendSwapMachine::from_existing(pending_swap());
        let err = m
            .apply(Event::MintSwapSucceeded {
                proofs_to_send: vec![],
                change_proofs: vec![],
            })
            .unwrap_err();
        assert!(matches!(err, SendSwapError::InvalidTransition { .. }));
    }

    #[test]
    fn applying_event_to_terminal_state_is_invalid() {
        let mut m = SendSwapMachine::from_existing(completed_swap());
        let err = m.apply(Event::SwapCompleted(completed_swap())).unwrap_err();
        assert!(matches!(err, SendSwapError::InvalidTransition { .. }));
    }

    #[test]
    fn snapshot_returns_persisted_swap_after_creation() {
        let mut m = SendSwapMachine::new();
        m.apply(Event::SwapCreated(draft_swap())).unwrap();
        let snap = m.snapshot().expect("draft swap snapshot");
        assert!(matches!(snap.state, CashuSendSwapState::Draft));
    }
}
