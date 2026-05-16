//! Cashu lightning-receive (NUT-04 mint-quote) entity, state machine, and
//! orchestrator.
//!
//! Mirrors `app/features/receive/cashu-receive-quote*.ts`. Five layers:
//! - [`types`] — persisted entity + [`CashuMintQuoteState`] enum.
//! - [`storage`] — `CashuMintQuoteStorage` trait + DTOs.
//! - [`error`] — `MintQuoteError`.
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
