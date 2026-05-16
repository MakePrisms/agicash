//! `KeyProvider` + `TokenProvider` impls over opensecret 0.2.9.

pub mod client;
pub mod config;
pub mod error;
pub mod key_provider;
pub mod session;
// keyring-backed session storage is OS-native only. WASM consumers must
// wire their own `SessionStorage` impl (cookies / IndexedDB / web crypto)
// in a future browser-targeted slice.
#[cfg(not(target_arch = "wasm32"))]
pub mod storage;
pub mod token_provider;

pub use client::*;
pub use config::*;
pub use error::*;
pub use key_provider::*;
pub use session::*;
#[cfg(not(target_arch = "wasm32"))]
pub use storage::*;
pub use token_provider::*;
