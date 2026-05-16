//! Cashu send-swap entity, state machine, storage trait, and orchestrator.
//!
//! Mirrors `app/features/send/cashu-send-swap*.ts`. Five layers (in build order):
//! - [`types`] — persisted entity + [`CashuSendSwapState`] enum.
//! - [`storage`] — [`CashuSendSwapStorage`] trait + DTOs.
//! - `error` — `SendSwapError` union (next commit).
//! - `state` — sans-IO state machine (next commit).
//! - `service` — orchestrator with CDK + storage I/O (next commit).

pub mod storage;
pub mod types;

pub use storage::*;
pub use types::*;
