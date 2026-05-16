//! Sans-IO orchestrator for the Cashu receive-token flow.
//!
//! Mirrors `app/features/receive/receive-cashu-token.tsx` + its supporting
//! hooks/services as a single state machine that any UI shell (iOS, Android,
//! WASM) can drive. See `docs/superpowers/specs/2026-05-15-cashu-receive-orchestrator.md`.
//!
//! Three layers, matching the existing `receive_swap` module:
//! - [`types`] — public events, states, result + error shapes.
//! - [`state`] — pure state-machine transitions (no I/O).
//! - [`service`] — orchestrator that performs the I/O (mint-info, mint-add,
//!   receive-swap) for each pending action.

pub mod error;
pub mod service;
pub mod state;
pub mod types;

pub use error::*;
pub use service::*;
pub use state::*;
pub use types::*;
