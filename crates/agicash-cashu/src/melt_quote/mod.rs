//! Cashu melt-quote (NUT-05 lightning-send) entity, state machine,
//! and orchestrator.
//!
//! Mirrors `app/features/send/cashu-send-quote*.ts`. Five layers
//! (in build order):
//! - [`types`] — persisted entity + [`CashuMeltQuoteState`] enum.
//! - `storage` — [`CashuMeltQuoteStorage`] trait + DTOs (Task 2).
//! - `error` — [`MeltQuoteError`] union (Task 3).
//! - `state` — sans-IO state machine (Task 3).
//! - `service` — orchestrator with CDK + storage I/O (Task 4).

pub mod storage;
pub mod types;

pub use storage::*;
pub use types::*;
