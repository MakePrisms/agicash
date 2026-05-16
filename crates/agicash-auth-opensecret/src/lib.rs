//! `KeyProvider` + `TokenProvider` impls over opensecret 0.2.9.

pub mod client;
pub mod config;
pub mod error;
pub mod key_provider;
pub mod session;
// `storage` ships at least the always-available `InMemorySessionStorage`
// (works on every target including wasm). The OS-keyring impl inside this
// module is gated behind the `keyring-storage` cargo feature, so wasm
// builds compile in only the in-memory path. See `storage.rs` for details.
pub mod storage;
pub mod token_provider;

pub use client::*;
pub use config::*;
pub use error::*;
pub use key_provider::*;
pub use session::*;
pub use storage::*;
pub use token_provider::*;
