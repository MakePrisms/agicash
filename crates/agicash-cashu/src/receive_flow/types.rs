//! Public types for the receive flow.
//!
//! These are the shapes that the UI layer (iOS / Android / WASM) sees.
//! The naming intentionally mirrors web's `ReceiveStep` /
//! `useReceiveCashuTokenAccounts` so the same mental model carries
//! across.

use serde::{Deserialize, Serialize};

/// Status discriminator for [`ReceiveFlowResult`].
///
/// Re-declared (rather than re-exported from `crate::receive_swap`) so the
/// receive-flow public surface is self-contained and FFI bindings don't
/// need to traverse multiple modules to find it.
///
/// Note: `AlreadyClaimed` is not represented here — it is now a dedicated
/// top-level [`ReceiveFlowState::AlreadyClaimed`] variant so the UI cannot
/// accidentally render its (meaningless) amount field. See issue #2 in
/// `docs/superpowers/specs/2026-05-15-cashu-receive-orchestrator-ui-spec.md`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReceiveStatus {
    /// Fresh successful claim — proofs were just credited.
    Received,
    /// Token was already spent / claimed elsewhere (not by this user).
    AlreadyFailed,
    /// Swap is still pending (rare; surfaces only when the receive flow
    /// returns early before the mint round-trip completes).
    Pending,
}

/// Receipt for a completed receive flow with a real (non-idempotent)
/// outcome — `Received`, `AlreadyFailed`, or `Pending`. All amounts are
/// decimal-stringified to match the existing [`crate::receive_swap`] FFI
/// receipt shape.
///
/// Idempotent re-paste of an already-claimed token does NOT come through
/// this struct — it surfaces as [`ReceiveFlowState::AlreadyClaimed`] with
/// no amount field, so UI code can't accidentally render "Received 0 sats".
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReceiveFlowResult {
    pub status: ReceiveStatus,
    pub amount: String,
    pub fee: String,
    pub unit: String,
    pub currency: String,
    pub account_id: String,
    pub mint_url: String,
    pub token_hash: String,
}

/// Snapshot of an idempotent re-paste of a token the same user already
/// claimed. The wallet did not credit anything this time around — the
/// proofs were swept the first time the token was pasted.
///
/// Deliberately carries NO `amount` field: the orchestrator does not (and
/// should not, without an extra DB lookup) know the original credited
/// amount, and surfacing `"0"` here was a footgun that made UI render
/// "Received 0 sats". UI should treat this variant as informational
/// ("you already received this") and the user dismisses.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AlreadyClaimedInfo {
    pub unit: String,
    pub currency: String,
    pub account_id: String,
    pub mint_url: String,
    pub token_hash: String,
}

/// Data the UI needs to render the "Add this mint?" prompt.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MintConfirmation {
    /// Mint URL as carried in the token (post-normalization).
    pub mint_url: String,
    /// Mint's human-readable name (NUT-06 `name`, falling back to the URL
    /// when the mint doesn't supply one).
    pub mint_name: String,
    /// Cashu sub-unit string (`"sat"`, `"usd"`, etc.).
    pub unit: String,
    /// Wallet account currency the mint would be added under (`"BTC"`,
    /// `"USD"`).
    pub currency: String,
    /// Decimal-stringified amount the token carries before fees.
    pub amount: String,
    /// Decimal-stringified fee the mint will deduct.
    pub fee: String,
}

/// Snapshot of the current flow state. The UI observes this and renders
/// accordingly.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ReceiveFlowState {
    /// Nothing started. `Start` event moves us out of this.
    Idle,
    /// Token is being parsed and source mint resolved.
    Parsing,
    /// Token parsed; source mint is unknown to the user. UI shows
    /// "Add this mint?" prompt. UI dispatches `ConfirmAddMint` or
    /// `CancelAddMint`.
    NeedsMintConfirmation(MintConfirmation),
    /// Adding the mint to the user's accounts.
    AddingMint { mint_url: String },
    /// Running the swap with the mint (create + complete).
    Swapping {
        account_id: String,
        mint_url: String,
    },
    /// Terminal success. UI shows the receipt — the `amount` field is
    /// meaningful (a fresh credit, a discovered-failed swap, or a pending
    /// swap reflecting the inner swap's recorded amount).
    ///
    /// **Does not** carry the `AlreadyClaimed` idempotent case — that lives
    /// as its own [`Self::AlreadyClaimed`] variant.
    Done(ReceiveFlowResult),
    /// Terminal: the same user previously claimed this token. No new
    /// proofs were credited; the wallet returned the idempotent receipt.
    /// UI should display an informational "you already received this token"
    /// message (not "Received 0 sats").
    AlreadyClaimed(AlreadyClaimedInfo),
    /// Terminal failure. UI shows the reason + Dismiss/Retry.
    Failed { reason: String, code: String },
}

impl ReceiveFlowState {
    #[must_use]
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            Self::Done(_) | Self::AlreadyClaimed(_) | Self::Failed { .. }
        )
    }
}

/// Events the UI dispatches into the machine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReceiveFlowEvent {
    /// Begin a new flow with this token.
    Start { token: String },
    /// User said yes to the "Add this mint?" prompt.
    ConfirmAddMint,
    /// User said no; flow transitions to Failed("cancelled").
    CancelAddMint,
    /// Reset terminal state back to Idle so a new flow can start.
    Retry,
    /// Drop a terminal state and go back to Idle.
    Dismiss,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_is_not_terminal() {
        assert!(!ReceiveFlowState::Idle.is_terminal());
    }

    #[test]
    fn done_is_terminal() {
        let r = ReceiveFlowResult {
            status: ReceiveStatus::Received,
            amount: "64".into(),
            fee: "0".into(),
            unit: "sat".into(),
            currency: "BTC".into(),
            account_id: "x".into(),
            mint_url: "https://m.example".into(),
            token_hash: "h".into(),
        };
        assert!(ReceiveFlowState::Done(r).is_terminal());
    }

    #[test]
    fn already_claimed_is_terminal() {
        let info = AlreadyClaimedInfo {
            unit: "sat".into(),
            currency: "BTC".into(),
            account_id: "a".into(),
            mint_url: "https://m.example".into(),
            token_hash: "h".into(),
        };
        assert!(ReceiveFlowState::AlreadyClaimed(info).is_terminal());
    }

    #[test]
    fn failed_is_terminal() {
        assert!(ReceiveFlowState::Failed {
            reason: "bad".into(),
            code: "unknown".into(),
        }
        .is_terminal());
    }

    #[test]
    fn intermediate_states_are_not_terminal() {
        assert!(!ReceiveFlowState::Parsing.is_terminal());
        assert!(!ReceiveFlowState::AddingMint {
            mint_url: "u".into()
        }
        .is_terminal());
        assert!(!ReceiveFlowState::Swapping {
            account_id: "a".into(),
            mint_url: "u".into(),
        }
        .is_terminal());
    }

    #[test]
    fn state_round_trips_through_json() {
        let s = ReceiveFlowState::NeedsMintConfirmation(MintConfirmation {
            mint_url: "https://mint.example".into(),
            mint_name: "Mint".into(),
            unit: "sat".into(),
            currency: "BTC".into(),
            amount: "100".into(),
            fee: "0".into(),
        });
        let j = serde_json::to_string(&s).unwrap();
        let back: ReceiveFlowState = serde_json::from_str(&j).unwrap();
        assert_eq!(s, back);
    }

    #[test]
    fn event_round_trips_through_json() {
        let e = ReceiveFlowEvent::Start {
            token: "cashuA".into(),
        };
        let j = serde_json::to_string(&e).unwrap();
        let back: ReceiveFlowEvent = serde_json::from_str(&j).unwrap();
        assert_eq!(e, back);
    }
}
