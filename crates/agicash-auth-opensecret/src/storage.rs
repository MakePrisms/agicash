//! Concrete [`SessionStorage`] impls for the opensecret-backed CLI.
//!
//! Two implementations ship with this crate:
//!
//! - [`InMemorySessionStorage`] is always available. It holds the session
//!   in an `Arc<Mutex<Option<_>>>` and is used by tests, CI environments
//!   where the OS keyring backend isn't running (e.g. headless Linux
//!   without a `dbus-daemon`/`secret-service` pair), and as the runtime
//!   fallback when [`KeyringSessionStorage`] reports `BackendUnavailable`.
//! - [`KeyringSessionStorage`] is gated behind the `keyring-storage` cargo
//!   feature (default-on for native targets, unconditionally off on wasm
//!   because the `keyring` crate doesn't compile there). It wraps the OS
//!   secret store via the `keyring` crate.
//!
//! Downstream targets that need different persistence (Android `KeyStore`,
//! browser `IndexedDB` + `WebCrypto`, encrypted file) implement
//! [`agicash_traits::SessionStorage`] in their own crate and select the
//! backend at startup. The CLI's startup chain in `agicash-cli` shows the
//! intended composition pattern.

use agicash_traits::{AuthError, PersistedSession, SessionStorage, SessionStorageError};
use async_trait::async_trait;
use std::sync::{Arc, Mutex};

// ---------------------------------------------------------------------------
// In-memory backend — always available.
// ---------------------------------------------------------------------------

/// In-process session storage backed by `Arc<Mutex<Option<PersistedSession>>>`.
///
/// Useful for:
/// - Unit tests and CI runs where no secret backend exists.
/// - Headless Linux servers / containers without a D-Bus secret service.
/// - The runtime fallback path when [`KeyringSessionStorage`] reports
///   `BackendUnavailable`.
///
/// Sessions are *not* persisted across process restarts. The CLI prints a
/// stderr warning when it falls back to this backend so the user knows the
/// session won't survive `exit`.
#[derive(Debug, Clone, Default)]
pub struct InMemorySessionStorage {
    inner: Arc<Mutex<Option<PersistedSession>>>,
}

impl InMemorySessionStorage {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
impl SessionStorage for InMemorySessionStorage {
    async fn store(&self, session: &PersistedSession) -> Result<(), AuthError> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|e| SessionStorageError::Io(format!("mutex poisoned: {e}")))?;
        *guard = Some(session.clone());
        Ok(())
    }

    async fn load(&self) -> Result<Option<PersistedSession>, AuthError> {
        let guard = self
            .inner
            .lock()
            .map_err(|e| SessionStorageError::Io(format!("mutex poisoned: {e}")))?;
        Ok(guard.clone())
    }

    async fn clear(&self) -> Result<(), AuthError> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|e| SessionStorageError::Io(format!("mutex poisoned: {e}")))?;
        *guard = None;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Keyring backend — feature-gated.
// ---------------------------------------------------------------------------

#[cfg(feature = "keyring-storage")]
pub use self::keyring_backend::{KeyringSessionStorage, DEFAULT_SERVICE};

// Re-export the constant unconditionally so existing call sites that build
// only with `--no-default-features` still resolve the default service name
// (used by the CLI to derive a fallback service id even when the keyring
// backend itself isn't compiled in).
#[cfg(not(feature = "keyring-storage"))]
pub const DEFAULT_SERVICE: &str = "com.agicash.cli";

#[cfg(feature = "keyring-storage")]
mod keyring_backend {
    use super::{async_trait, AuthError, PersistedSession, SessionStorage, SessionStorageError};

    pub const DEFAULT_SERVICE: &str = "com.agicash.cli";
    const SESSION_KEY: &str = "session";

    /// Session storage backed by the OS secret store (Keychain on
    /// macOS/iOS, SChannel-style credential vault on Windows, D-Bus
    /// secret-service / `KWallet` on Linux).
    ///
    /// On headless or CI environments where the backend isn't running the
    /// underlying `keyring::Entry::new` / `get_password` call surfaces as
    /// [`SessionStorageError::BackendUnavailable`]. The CLI startup chain
    /// uses that signal to fall back to [`InMemorySessionStorage`].
    #[derive(Debug, Clone)]
    pub struct KeyringSessionStorage {
        service: String,
    }

    impl KeyringSessionStorage {
        #[must_use]
        pub fn new(service: impl Into<String>) -> Self {
            Self {
                service: service.into(),
            }
        }

        fn entry(&self) -> Result<keyring::Entry, SessionStorageError> {
            keyring::Entry::new(&self.service, SESSION_KEY).map_err(map_keyring_error)
        }
    }

    impl Default for KeyringSessionStorage {
        fn default() -> Self {
            Self::new(DEFAULT_SERVICE)
        }
    }

    // Keyring backend is native-only (the `keyring` crate doesn't compile
    // on wasm), so a plain `#[async_trait]` is fine here — no `?Send` gate
    // needed since this code path never reaches wasm.
    #[async_trait]
    impl SessionStorage for KeyringSessionStorage {
        async fn store(&self, session: &PersistedSession) -> Result<(), AuthError> {
            let entry = self.entry().map_err(AuthError::from)?;
            let blob = serde_json::to_string(session)
                .map_err(|e| SessionStorageError::Decryption(format!("serialize: {e}")))?;
            tokio::task::spawn_blocking(move || entry.set_password(&blob))
                .await
                .map_err(|e| SessionStorageError::Io(format!("spawn_blocking: {e}")))?
                .map_err(map_keyring_error)?;
            Ok(())
        }

        async fn load(&self) -> Result<Option<PersistedSession>, AuthError> {
            let entry = self.entry().map_err(AuthError::from)?;
            let result = tokio::task::spawn_blocking(move || entry.get_password())
                .await
                .map_err(|e| SessionStorageError::Io(format!("spawn_blocking: {e}")))?;
            match result {
                Ok(blob) => {
                    let session = serde_json::from_str::<PersistedSession>(&blob).map_err(|e| {
                        SessionStorageError::Decryption(format!("deserialize: {e}"))
                    })?;
                    Ok(Some(session))
                }
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(e) => Err(map_keyring_error(e).into()),
            }
        }

        async fn clear(&self) -> Result<(), AuthError> {
            let entry = self.entry().map_err(AuthError::from)?;
            let result = tokio::task::spawn_blocking(move || entry.delete_credential())
                .await
                .map_err(|e| SessionStorageError::Io(format!("spawn_blocking: {e}")))?;
            match result {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(e) => Err(map_keyring_error(e).into()),
            }
        }
    }

    /// Translate a raw `keyring::Error` into our
    /// [`SessionStorageError`] taxonomy. Anything that looks like "no D-Bus
    /// secret service running" / "platform backend not initialised" maps to
    /// `BackendUnavailable` so the CLI fallback chain kicks in. Everything
    /// else surfaces as `Io`.
    fn map_keyring_error(e: keyring::Error) -> SessionStorageError {
        match e {
            keyring::Error::PlatformFailure(inner) => {
                let msg = inner.to_string();
                // The platform-specific error strings we want to catch:
                //   - linux (secret-service): "org.freedesktop.DBus.Error.*",
                //     "No such interface", "Failed to connect to socket"
                //   - macOS (rare in practice): "errSecNotAvailable"
                //   - windows (rare): "The system cannot find the file specified"
                //
                // We deliberately use substring matching on the lowercased
                // string. A more structured classification belongs upstream
                // in the keyring crate.
                let needle = msg.to_lowercase();
                if needle.contains("dbus")
                    || needle.contains("socket")
                    || needle.contains("connect")
                    || needle.contains("not available")
                {
                    SessionStorageError::BackendUnavailable(msg)
                } else {
                    SessionStorageError::Io(msg)
                }
            }
            keyring::Error::NoStorageAccess(inner) => {
                SessionStorageError::BackendUnavailable(inner.to_string())
            }
            // Catch-all: anything else surfaces as a generic Io error. The
            // keyring crate's enum is non-exhaustive, so we can't enumerate.
            other => SessionStorageError::Io(other.to_string()),
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use uuid::Uuid;

        fn keyring_available() -> bool {
            if std::env::var("CI").is_ok() {
                return false;
            }
            #[cfg(target_os = "macos")]
            {
                true
            }
            #[cfg(not(target_os = "macos"))]
            {
                false
            }
        }

        #[tokio::test]
        async fn keyring_roundtrips_when_available() {
            if !keyring_available() {
                eprintln!("skipping: keyring unavailable in this environment");
                return;
            }
            let pid = std::process::id();
            let service = format!("com.agicash.cli.test.{pid}");
            let s = KeyringSessionStorage::new(&service);

            let _ = s.clear().await;

            assert!(s.load().await.unwrap().is_none());
            let session = PersistedSession {
                user_id: Uuid::new_v4(),
                refresh_token: "test-refresh-token".to_string(),
            };
            s.store(&session).await.unwrap();
            let loaded = s.load().await.unwrap();
            assert_eq!(loaded, Some(session));
            s.clear().await.unwrap();
            assert!(s.load().await.unwrap().is_none());
        }
    }
}

#[cfg(test)]
#[allow(clippy::wildcard_imports)]
mod in_memory_tests {
    use super::*;
    use uuid::Uuid;

    #[tokio::test]
    async fn in_memory_roundtrips() {
        let s = InMemorySessionStorage::new();
        assert!(s.load().await.unwrap().is_none());
        let session = PersistedSession {
            user_id: Uuid::new_v4(),
            refresh_token: "rt".to_string(),
        };
        s.store(&session).await.unwrap();
        assert_eq!(s.load().await.unwrap(), Some(session.clone()));
        s.clear().await.unwrap();
        assert!(s.load().await.unwrap().is_none());
    }

    #[tokio::test]
    async fn in_memory_clones_share_state() {
        // Crucial: the CLI's fallback chain hands the same Arc-backed
        // storage to every dep that needs it. Cloning must NOT split the
        // session.
        let a = InMemorySessionStorage::new();
        let b = a.clone();
        let session = PersistedSession {
            user_id: Uuid::new_v4(),
            refresh_token: "shared".to_string(),
        };
        a.store(&session).await.unwrap();
        assert_eq!(b.load().await.unwrap(), Some(session));
    }
}
