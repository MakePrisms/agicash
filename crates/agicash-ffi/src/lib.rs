//! Agicash FFI bindings.
//!
//! `UniFFI` surface for the Agicash wallet SDK. Phase 1 exposes auth (guest +
//! email login + logout + status) and a thin account listing endpoint. Cashu
//! mint operations and balance display arrive in Phase 2+.
//!
//! The shape follows CDK's `cdk-ffi` crate: a `setup_scaffolding!()` macro at
//! the crate root, FFI types in submodules, an FFI-only error enum, and an
//! `#[uniffi::Object]` wallet that owns the underlying clients.

#![allow(missing_docs)]
#![allow(missing_debug_implementations)]

pub mod account;
pub mod error;
pub mod session;
pub mod wallet;

pub use account::*;
pub use error::*;
pub use session::*;
pub use wallet::*;

uniffi::setup_scaffolding!();
