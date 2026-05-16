//! Agicash FFI bindings.
//!
//! `UniFFI` surface for the Agicash wallet SDK. Phase 1 exposes auth (guest +
//! email login + logout + status), a thin account listing endpoint, a Cashu
//! token receive flow, and `mint_add` for provisioning a new mint-backed
//! account. Send / balance / Lightning arrive in later phases.
//!
//! The shape follows CDK's `cdk-ffi` crate: a `setup_scaffolding!()` macro at
//! the crate root, FFI types in submodules, an FFI-only error enum, and an
//! `#[uniffi::Object]` wallet that owns the underlying clients.

#![allow(missing_docs)]
#![allow(missing_debug_implementations)]

pub mod account;
pub mod error;
pub mod mint;
pub mod receive;
pub mod session;
pub mod wallet;

pub use account::*;
pub use error::*;
pub use mint::*;
pub use receive::*;
pub use session::*;
pub use wallet::*;

uniffi::setup_scaffolding!();
