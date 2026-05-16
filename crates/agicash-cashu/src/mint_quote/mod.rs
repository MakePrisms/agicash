//! Cashu lightning-receive (NUT-04 mint-quote) entity, state machine, and
//! orchestrator.
//!
//! Mirrors `app/features/receive/cashu-receive-quote*.ts`. Five layers,
//! added across the slice-7 commits:
//! - [`types`] — persisted entity + [`CashuMintQuoteState`] enum.
//! - [`storage`] — `CashuMintQuoteStorage` trait + DTOs.
//! - [`error`] — `MintQuoteError`.
//! - `state` — sans-IO state machine (Task 3).
//! - `service` — orchestrator with CDK + storage I/O (Task 4).

pub mod error;
pub mod storage;
pub mod types;

pub use error::*;
pub use storage::*;
pub use types::*;
