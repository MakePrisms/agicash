//! Cashu send-swap entity, state machine, storage trait, and orchestrator.
//!
//! Mirrors `app/features/send/cashu-send-swap*.ts`. Five layers (in build order):
//! - [`types`] — persisted entity + [`CashuSendSwapState`] enum.
//! - [`storage`] — [`CashuSendSwapStorage`] trait + DTOs.
//! - [`error`] — [`SendSwapError`] union.
//! - [`state`] — sans-IO state machine.
//! - [`service`] — orchestrator with CDK + storage I/O.

pub mod error;
pub mod service;
pub mod state;
pub mod storage;
pub mod types;

pub use error::*;
pub use service::*;
pub use state::*;
pub use storage::*;
pub use types::*;
