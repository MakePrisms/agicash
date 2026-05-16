use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Errors surfaced from a [`SessionStorage`] backend.
///
/// Variants are intentionally finer-grained than [`crate::AuthError`] so the
/// CLI can drive a fallback chain (e.g. keyring → in-memory) when the OS
/// secret backend isn't running.
#[derive(Debug, thiserror::Error)]
pub enum SessionStorageError {
    /// The underlying backend cannot be reached at all (no D-Bus secret
    /// service, no Keychain access, no `IndexedDB` in the global scope, …).
    /// Callers may choose to retry against a fallback impl.
    #[error("session storage backend unavailable: {0}")]
    BackendUnavailable(String),
    /// The backend is healthy but holds no session for this caller.
    /// (Most impls model this as `Ok(None)` from `load`; this variant exists
    /// for backends — e.g. file-backed — where "not found" is a hard error.)
    #[error("no session present")]
    NotFound,
    /// A stored blob could not be decrypted or deserialised.
    #[error("session decryption/corruption: {0}")]
    Decryption(String),
    /// Filesystem / network / other I/O error.
    #[error("session storage io: {0}")]
    Io(String),
}

impl From<SessionStorageError> for crate::AuthError {
    fn from(err: SessionStorageError) -> Self {
        match err {
            SessionStorageError::BackendUnavailable(msg) => {
                crate::AuthError::Backend(format!("session backend unavailable: {msg}"))
            }
            SessionStorageError::NotFound => crate::AuthError::Unauthenticated,
            SessionStorageError::Decryption(msg) => {
                crate::AuthError::Internal(format!("session decryption: {msg}"))
            }
            SessionStorageError::Io(msg) => {
                crate::AuthError::Internal(format!("session io: {msg}"))
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PersistedSession {
    pub user_id: Uuid,
    pub refresh_token: String,
}

/// Pluggable persistence for a `PersistedSession`.
///
/// Implementations live behind cargo features in the relevant impl crate
/// (e.g. `keyring-storage` for the OS keyring backend in
/// `agicash-auth-opensecret`). An `InMemorySessionStorage` is always
/// available as a no-op fallback used by tests, CI, and the CLI when the
/// keyring backend can't be reached.
///
/// On `wasm32` the `Send + Sync` bound is dropped so the trait is usable
/// from single-threaded browser runtimes (where the underlying
/// `reqwest::Response` future is `!Send`).
#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
pub trait SessionStorage: SessionStorageBounds {
    async fn store(&self, session: &PersistedSession) -> Result<(), crate::AuthError>;
    async fn load(&self) -> Result<Option<PersistedSession>, crate::AuthError>;
    async fn clear(&self) -> Result<(), crate::AuthError>;
}

/// Helper alias so the trait object bound switches with `target_arch`
/// without sprinkling `cfg` blocks at every use site.
#[cfg(not(target_arch = "wasm32"))]
pub trait SessionStorageBounds: Send + Sync {}
#[cfg(not(target_arch = "wasm32"))]
impl<T: Send + Sync> SessionStorageBounds for T {}

#[cfg(target_arch = "wasm32")]
pub trait SessionStorageBounds {}
#[cfg(target_arch = "wasm32")]
impl<T> SessionStorageBounds for T {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct InMemStorage {
        session: Mutex<Option<PersistedSession>>,
    }

    #[async_trait]
    impl SessionStorage for InMemStorage {
        async fn store(&self, session: &PersistedSession) -> Result<(), crate::AuthError> {
            *self.session.lock().unwrap() = Some(session.clone());
            Ok(())
        }

        async fn load(&self) -> Result<Option<PersistedSession>, crate::AuthError> {
            Ok(self.session.lock().unwrap().clone())
        }

        async fn clear(&self) -> Result<(), crate::AuthError> {
            *self.session.lock().unwrap() = None;
            Ok(())
        }
    }

    #[tokio::test]
    async fn in_mem_storage_roundtrips() {
        let s = InMemStorage::default();
        assert!(s.load().await.unwrap().is_none());
        let session = PersistedSession {
            user_id: Uuid::new_v4(),
            refresh_token: "rt".to_string(),
        };
        s.store(&session).await.unwrap();
        assert_eq!(s.load().await.unwrap(), Some(session));
        s.clear().await.unwrap();
        assert!(s.load().await.unwrap().is_none());
    }

    #[test]
    fn persisted_session_roundtrips_through_json() {
        let session = PersistedSession {
            user_id: Uuid::new_v4(),
            refresh_token: "abc.def.ghi".to_string(),
        };
        let json = serde_json::to_string(&session).unwrap();
        let parsed: PersistedSession = serde_json::from_str(&json).unwrap();
        assert_eq!(session, parsed);
    }

    #[test]
    fn backend_unavailable_maps_to_auth_backend_error() {
        let e: crate::AuthError = SessionStorageError::BackendUnavailable("no dbus".into()).into();
        assert!(matches!(e, crate::AuthError::Backend(_)));
        assert!(e.to_string().contains("no dbus"));
    }

    #[test]
    fn not_found_maps_to_unauthenticated() {
        let e: crate::AuthError = SessionStorageError::NotFound.into();
        assert!(matches!(e, crate::AuthError::Unauthenticated));
    }
}
