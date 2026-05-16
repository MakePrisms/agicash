//! FFI surface for the receive flow orchestrator.
//!
//! Exposes [`ReceiveFlow`] as a long-lived `uniffi::Object` the UI holds onto
//! for the duration of one receive interaction. Methods:
//!
//! - [`ReceiveFlow::current_state`] — snapshot the current state.
//! - [`ReceiveFlow::dispatch`] — feed a UI event in, get the next stable
//!   state back.
//!
//! Mirrors `app/features/receive/receive-cashu-token.tsx`'s React flow but
//! in a UI-agnostic shape — iOS/Android/WASM can each render the same
//! [`ReceiveFlowStateFfi`] without re-implementing the orchestration.

use crate::error::{auth_code, FfiError};
use agicash_auth_opensecret::OpenSecretClient;
use agicash_cashu::{
    CashuSeedProvider, MintConfirmation, ReceiveFlowError, ReceiveFlowEvent, ReceiveFlowResult,
    ReceiveFlowService, ReceiveFlowState, ReceiveFlowStatus,
};
use tokio::sync::Mutex;

/// FFI mirror of [`agicash_cashu::ReceiveFlowStatus`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum ReceiveStatusFfi {
    Received,
    AlreadyClaimed,
    AlreadyFailed,
    Pending,
}

impl From<ReceiveFlowStatus> for ReceiveStatusFfi {
    fn from(s: ReceiveFlowStatus) -> Self {
        match s {
            ReceiveFlowStatus::Received => Self::Received,
            ReceiveFlowStatus::AlreadyClaimed => Self::AlreadyClaimed,
            ReceiveFlowStatus::AlreadyFailed => Self::AlreadyFailed,
            ReceiveFlowStatus::Pending => Self::Pending,
        }
    }
}

/// FFI mirror of [`agicash_cashu::ReceiveFlowResult`]. Identical fields;
/// stringified for Swift codegen.
#[derive(Debug, Clone, uniffi::Record)]
pub struct ReceiveFlowResultFfi {
    pub status: ReceiveStatusFfi,
    pub amount: String,
    pub fee: String,
    pub unit: String,
    pub currency: String,
    pub account_id: String,
    pub mint_url: String,
    pub token_hash: String,
}

impl From<ReceiveFlowResult> for ReceiveFlowResultFfi {
    fn from(r: ReceiveFlowResult) -> Self {
        Self {
            status: r.status.into(),
            amount: r.amount,
            fee: r.fee,
            unit: r.unit,
            currency: r.currency,
            account_id: r.account_id,
            mint_url: r.mint_url,
            token_hash: r.token_hash,
        }
    }
}

/// FFI mirror of [`agicash_cashu::MintConfirmation`].
#[derive(Debug, Clone, uniffi::Record)]
pub struct MintConfirmationFfi {
    pub mint_url: String,
    pub mint_name: String,
    pub unit: String,
    pub currency: String,
    pub amount: String,
    pub fee: String,
}

impl From<MintConfirmation> for MintConfirmationFfi {
    fn from(m: MintConfirmation) -> Self {
        Self {
            mint_url: m.mint_url,
            mint_name: m.mint_name,
            unit: m.unit,
            currency: m.currency,
            amount: m.amount,
            fee: m.fee,
        }
    }
}

/// FFI mirror of [`agicash_cashu::ReceiveFlowState`]. Same variants in the
/// same order; the UI switches on the variant tag.
#[derive(Debug, Clone, uniffi::Enum)]
pub enum ReceiveFlowStateFfi {
    Idle,
    Parsing,
    NeedsMintConfirmation {
        confirmation: MintConfirmationFfi,
    },
    AddingMint {
        mint_url: String,
    },
    Swapping {
        account_id: String,
        mint_url: String,
    },
    Done {
        result: ReceiveFlowResultFfi,
    },
    Failed {
        reason: String,
        code: String,
    },
}

impl From<ReceiveFlowState> for ReceiveFlowStateFfi {
    fn from(s: ReceiveFlowState) -> Self {
        match s {
            ReceiveFlowState::Idle => Self::Idle,
            ReceiveFlowState::Parsing => Self::Parsing,
            ReceiveFlowState::NeedsMintConfirmation(c) => Self::NeedsMintConfirmation {
                confirmation: c.into(),
            },
            ReceiveFlowState::AddingMint { mint_url } => Self::AddingMint { mint_url },
            ReceiveFlowState::Swapping {
                account_id,
                mint_url,
            } => Self::Swapping {
                account_id,
                mint_url,
            },
            ReceiveFlowState::Done(result) => Self::Done {
                result: result.into(),
            },
            ReceiveFlowState::Failed { reason, code } => Self::Failed { reason, code },
        }
    }
}

/// FFI mirror of [`agicash_cashu::ReceiveFlowEvent`].
#[derive(Debug, Clone, uniffi::Enum)]
pub enum ReceiveFlowEventFfi {
    Start { token: String },
    ConfirmAddMint,
    CancelAddMint,
    Retry,
    Dismiss,
}

impl From<ReceiveFlowEventFfi> for ReceiveFlowEvent {
    fn from(e: ReceiveFlowEventFfi) -> Self {
        match e {
            ReceiveFlowEventFfi::Start { token } => Self::Start { token },
            ReceiveFlowEventFfi::ConfirmAddMint => Self::ConfirmAddMint,
            ReceiveFlowEventFfi::CancelAddMint => Self::CancelAddMint,
            ReceiveFlowEventFfi::Retry => Self::Retry,
            ReceiveFlowEventFfi::Dismiss => Self::Dismiss,
        }
    }
}

/// Long-lived handle the UI holds for the duration of one receive flow.
///
/// Wraps a [`ReceiveFlowService`] behind a `Mutex` so the FFI can hand
/// out shared references and still mutate the underlying machine on
/// each `dispatch`. Each call to [`crate::wallet::AgicashWallet::receive_flow`]
/// returns a fresh handle — flows are not persisted across constructions.
#[derive(uniffi::Object)]
pub struct ReceiveFlow {
    inner: Mutex<ReceiveFlowService>,
}

impl std::fmt::Debug for ReceiveFlow {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ReceiveFlow").finish_non_exhaustive()
    }
}

impl ReceiveFlow {
    /// Construct a handle from an already-built service. Used by
    /// `AgicashWallet::receive_flow`.
    pub fn new(service: ReceiveFlowService) -> Self {
        Self {
            inner: Mutex::new(service),
        }
    }
}

#[uniffi::export(async_runtime = "tokio")]
impl ReceiveFlow {
    /// Snapshot the current state of the flow. Cheap; safe to call from a
    /// polling UI loop.
    pub async fn current_state(&self) -> ReceiveFlowStateFfi {
        self.inner.lock().await.current_state().into()
    }

    /// Send a UI event into the flow and run any side effects it triggers.
    /// Returns the next stable state (waiting on user input or terminal).
    pub async fn dispatch(
        &self,
        event: ReceiveFlowEventFfi,
    ) -> Result<ReceiveFlowStateFfi, FfiError> {
        let mut guard = self.inner.lock().await;
        let next = guard
            .dispatch(event.into())
            .await
            .map_err(receive_flow_error_to_ffi)?;
        Ok(next.into())
    }
}

/// CashuSeedProvider impl that pulls from a shared `OpenSecretClient`.
/// Lives in the FFI layer (rather than agicash-cashu) so the cashu crate
/// stays free of the auth dependency.
pub struct OpenSecretSeedProvider {
    client: OpenSecretClient,
}

impl OpenSecretSeedProvider {
    #[must_use]
    pub fn new(client: OpenSecretClient) -> Self {
        Self { client }
    }
}

#[async_trait::async_trait]
impl CashuSeedProvider for OpenSecretSeedProvider {
    async fn get_cashu_seed(&self) -> Result<[u8; 64], ReceiveFlowError> {
        self.client.get_cashu_seed().await.map_err(|e| {
            // The seed call returns an AuthError; we don't have a clean
            // variant on ReceiveFlowError for auth failures, so surface as
            // a Storage-style internal error. The orchestrator transitions
            // to Failed with code=swap-failed; UI shows the message.
            ReceiveFlowError::Storage(agicash_traits::StorageError::Internal(format!(
                "fetch cashu seed: {e}"
            )))
        })
    }
}

/// Translate a [`ReceiveFlowError`] from the inner orchestrator (which
/// happens on `dispatch` failures like invalid-event) to FfiError. Most
/// failure paths show up as a Failed state, not an error — the
/// `Err(...)` here is reserved for invalid-event and auth issues.
fn receive_flow_error_to_ffi(e: ReceiveFlowError) -> FfiError {
    match e {
        ReceiveFlowError::InvalidEvent { event, state } => {
            FfiError::internal(format!("invalid event {event} in state {state}"))
        }
        ReceiveFlowError::Storage(s) => FfiError::from(s),
        other => {
            // Belt and suspenders — the orchestrator translates these to a
            // Failed state, but if one slips through (e.g. async cancel
            // mid-dispatch) we don't want to lose the diagnostic.
            FfiError::Auth {
                code: auth_code::INTERNAL,
                message: other.to_string(),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use agicash_cashu::{ReceiveFlowResult as InnerResult, ReceiveFlowStatus as InnerStatus};

    #[test]
    fn status_round_trips_through_ffi_enum() {
        assert_eq!(
            ReceiveStatusFfi::from(InnerStatus::Received),
            ReceiveStatusFfi::Received,
        );
        assert_eq!(
            ReceiveStatusFfi::from(InnerStatus::AlreadyClaimed),
            ReceiveStatusFfi::AlreadyClaimed,
        );
        assert_eq!(
            ReceiveStatusFfi::from(InnerStatus::AlreadyFailed),
            ReceiveStatusFfi::AlreadyFailed,
        );
        assert_eq!(
            ReceiveStatusFfi::from(InnerStatus::Pending),
            ReceiveStatusFfi::Pending,
        );
    }

    #[test]
    fn state_idle_round_trips() {
        let s: ReceiveFlowStateFfi = ReceiveFlowState::Idle.into();
        assert!(matches!(s, ReceiveFlowStateFfi::Idle));
    }

    #[test]
    fn state_done_carries_receipt() {
        let r = InnerResult {
            status: InnerStatus::Received,
            amount: "64".into(),
            fee: "0".into(),
            unit: "sat".into(),
            currency: "BTC".into(),
            account_id: "a".into(),
            mint_url: "https://m".into(),
            token_hash: "h".into(),
        };
        let s: ReceiveFlowStateFfi = ReceiveFlowState::Done(r).into();
        match s {
            ReceiveFlowStateFfi::Done { result } => {
                assert_eq!(result.amount, "64");
                assert_eq!(result.status, ReceiveStatusFfi::Received);
            }
            other => panic!("expected Done, got {other:?}"),
        }
    }

    #[test]
    fn state_failed_carries_reason_and_code() {
        let s: ReceiveFlowStateFfi = ReceiveFlowState::Failed {
            reason: "bad".into(),
            code: "token-parse".into(),
        }
        .into();
        match s {
            ReceiveFlowStateFfi::Failed { reason, code } => {
                assert_eq!(reason, "bad");
                assert_eq!(code, "token-parse");
            }
            other => panic!("expected Failed, got {other:?}"),
        }
    }

    #[test]
    fn event_ffi_into_inner_event() {
        assert!(matches!(
            ReceiveFlowEvent::from(ReceiveFlowEventFfi::Start { token: "x".into() }),
            ReceiveFlowEvent::Start { .. }
        ));
        assert!(matches!(
            ReceiveFlowEvent::from(ReceiveFlowEventFfi::ConfirmAddMint),
            ReceiveFlowEvent::ConfirmAddMint
        ));
        assert!(matches!(
            ReceiveFlowEvent::from(ReceiveFlowEventFfi::Retry),
            ReceiveFlowEvent::Retry
        ));
    }

    #[test]
    fn invalid_event_error_maps_to_internal() {
        let e = ReceiveFlowError::InvalidEvent {
            event: "Confirm".into(),
            state: "Idle".into(),
        };
        let ffi = receive_flow_error_to_ffi(e);
        assert!(matches!(ffi, FfiError::Internal { .. }));
    }
}
