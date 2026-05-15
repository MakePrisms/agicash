//! FFI error type.
//!
//! Shape mirrors CDK's `FfiError` (see `~/cdk/crates/cdk-ffi/src/error.rs`):
//! a flat enum with stable variant names and integer codes that consumers can
//! switch on without depending on Rust-side enum exhaustiveness.
//!
//! Variants map to the Agicash trait error families:
//! - `Auth` <- `agicash_traits::AuthError`
//! - `Storage` <- `agicash_traits::StorageError`
//! - `Internal` for anything that doesn't fit (bad input, FFI plumbing)

use agicash_traits::{AuthError, StorageError};

/// Stable integer codes for `FfiError::Auth.code`. Mirrors the variants of
/// `agicash_traits::AuthError`; numbering is FFI-stable, not protocol-derived.
pub mod auth_code {
    pub const NETWORK: u32 = 1;
    pub const UNAUTHENTICATED: u32 = 2;
    pub const BACKEND: u32 = 3;
    pub const INTERNAL: u32 = 4;
}

/// Stable integer codes for `FfiError::Storage.code`. Mirrors the variants of
/// `agicash_traits::StorageError`.
pub mod storage_code {
    pub const NETWORK: u32 = 1;
    pub const NOT_FOUND: u32 = 2;
    pub const BACKEND: u32 = 3;
    pub const INTERNAL: u32 = 4;
}

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum FfiError {
    /// Auth-layer error (`OpenSecret` or local session handling).
    #[error("[auth/{code}] {message}")]
    Auth { code: u32, message: String },

    /// Storage-layer error (Supabase REST + `postgrest`).
    #[error("[storage/{code}] {message}")]
    Storage { code: u32, message: String },

    /// Internal / programmer-error / FFI plumbing failure.
    #[error("{message}")]
    Internal { message: String },
}

impl FfiError {
    #[allow(clippy::needless_pass_by_value)]
    pub fn internal(msg: impl ToString) -> Self {
        Self::Internal {
            message: msg.to_string(),
        }
    }
}

impl From<AuthError> for FfiError {
    fn from(err: AuthError) -> Self {
        let (code, message) = match err {
            AuthError::Network(m) => (auth_code::NETWORK, m),
            AuthError::Unauthenticated => (auth_code::UNAUTHENTICATED, "not authenticated".into()),
            AuthError::Backend(m) => (auth_code::BACKEND, m),
            AuthError::Internal(m) => (auth_code::INTERNAL, m),
        };
        Self::Auth { code, message }
    }
}

impl From<StorageError> for FfiError {
    fn from(err: StorageError) -> Self {
        let (code, message) = match err {
            StorageError::Network(m) => (storage_code::NETWORK, m),
            StorageError::NotFound => (storage_code::NOT_FOUND, "not found".into()),
            StorageError::Backend(m) => (storage_code::BACKEND, m),
            StorageError::Internal(m) => (storage_code::INTERNAL, m),
        };
        Self::Storage { code, message }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_error_maps_each_variant() {
        let net: FfiError = AuthError::Network("dns".into()).into();
        assert!(matches!(net, FfiError::Auth { code, .. } if code == auth_code::NETWORK));

        let unauth: FfiError = AuthError::Unauthenticated.into();
        assert!(
            matches!(unauth, FfiError::Auth { code, .. } if code == auth_code::UNAUTHENTICATED)
        );

        let backend: FfiError = AuthError::Backend("opensecret 500".into()).into();
        assert!(matches!(backend, FfiError::Auth { code, .. } if code == auth_code::BACKEND));

        let internal: FfiError = AuthError::Internal("bug".into()).into();
        assert!(matches!(internal, FfiError::Auth { code, .. } if code == auth_code::INTERNAL));
    }

    #[test]
    fn storage_error_maps_each_variant() {
        let net: FfiError = StorageError::Network("dns".into()).into();
        assert!(matches!(net, FfiError::Storage { code, .. } if code == storage_code::NETWORK));

        let nf: FfiError = StorageError::NotFound.into();
        assert!(matches!(nf, FfiError::Storage { code, .. } if code == storage_code::NOT_FOUND));

        let backend: FfiError = StorageError::Backend("supabase 500".into()).into();
        assert!(matches!(backend, FfiError::Storage { code, .. } if code == storage_code::BACKEND));

        let internal: FfiError = StorageError::Internal("bug".into()).into();
        assert!(
            matches!(internal, FfiError::Storage { code, .. } if code == storage_code::INTERNAL)
        );
    }

    #[test]
    fn internal_constructor_preserves_message() {
        let e = FfiError::internal("oh no");
        assert!(matches!(e, FfiError::Internal { ref message } if message == "oh no"));
    }
}
