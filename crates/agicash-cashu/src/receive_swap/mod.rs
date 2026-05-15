//! Cashu receive-swap entity, state machine, and orchestrator.
//!
//! Mirrors `app/features/receive/cashu-receive-swap*.ts`. Three layers:
//! - [`types`] — persisted entity + [`CashuReceiveSwapState`] enum (this file).
//! - `state` — sans-IO state machine (Task 4).
//! - `service` — orchestrator with CDK + storage I/O (Task 5).

pub mod error;
pub mod state;
pub mod storage;
pub mod types;

pub use error::*;
pub use state::*;
pub use storage::*;
pub use types::*;
