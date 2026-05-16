//! `KeyProvider` + `TokenProvider` impls over opensecret 0.2.9.

#[cfg(feature = "android-file-storage")]
pub mod android_storage;
pub mod client;
pub mod config;
pub mod error;
pub mod key_provider;
pub mod session;
// `storage` ships at least the always-available `InMemorySessionStorage`
// (works on every target including wasm). The OS-keyring impl inside this
// module is gated behind the `keyring-storage` cargo feature, so wasm
// builds compile in only the in-memory path. See `storage.rs` for details.
//
// On Android the `keyring` crate has no backend; the optional
// `android-file-storage` feature compiles in an `AndroidFileSessionStorage`
// (AES-256-GCM encrypted file in the app's private data dir). The
// `storage` module re-exports it when both the feature is on AND the
// target is android. See `android_storage.rs` for details.
pub mod storage;
pub mod token_provider;

#[cfg(all(feature = "android-file-storage", target_os = "android"))]
pub use android_storage::AndroidFileSessionStorage;
pub use client::*;
pub use config::*;
pub use error::*;
pub use key_provider::*;
pub use session::*;
pub use storage::*;
pub use token_provider::*;
