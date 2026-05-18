//! Browser-backed [`SessionStorage`] using `window.localStorage`.
//!
//! Wasm-only. Matches the legacy React web app's session-persistence
//! convention (refresh token stored as a JSON blob keyed by an
//! app-specific name). The XSS exposure on the refresh token is
//! accepted — same threat surface as the React app. See the operator's
//! pivot note dated 2026-05-17 for the decision rationale (browser
//! storage chosen over `IndexedDB` + `WebCrypto` and over `HttpOnly`
//! cookies).
//!
//! Run the browser-driven tests from the workspace root with:
//!
//! ```sh
//! wasm-pack test --headless --chrome crates/agicash-auth-opensecret
//! ```
//!
//! (substitute `--firefox` / `--safari` if Chrome isn't installed).

use agicash_traits::{AuthError, PersistedSession, SessionStorage, SessionStorageError};
use async_trait::async_trait;
use wasm_bindgen::JsValue;

/// Default localStorage key. Distinct from any name the React app might
/// have used so running both side-by-side during the cutover doesn't
/// collide; callers that need isolation (e.g. tests, per-tenant apps)
/// can construct with [`BrowserSessionStorage::with_key`].
pub const DEFAULT_STORAGE_KEY: &str = "agicash_session";

/// Refresh-token persistence backed by `window.localStorage`.
///
/// The stored blob is a JSON-encoded [`PersistedSession`]. Reads / writes
/// are synchronous against the underlying `Storage` API; the async
/// signature on the trait is preserved so call sites stay uniform across
/// targets (the keyring backend on native, the in-memory backend in
/// tests, etc.).
#[derive(Debug, Clone)]
pub struct BrowserSessionStorage {
    key: String,
}

impl BrowserSessionStorage {
    /// Storage keyed at the default app-specific name
    /// ([`DEFAULT_STORAGE_KEY`]).
    #[must_use]
    pub fn new() -> Self {
        Self {
            key: DEFAULT_STORAGE_KEY.to_string(),
        }
    }

    /// Storage keyed at a custom name. Tests use this to isolate state
    /// across `wasm_bindgen_test` cases that share a single browser
    /// origin (and therefore a single shared localStorage namespace).
    #[must_use]
    pub fn with_key(key: impl Into<String>) -> Self {
        Self { key: key.into() }
    }
}

impl Default for BrowserSessionStorage {
    fn default() -> Self {
        Self::new()
    }
}

/// Convert a JS-thrown error into our typed `SessionStorageError`.
/// `localStorage` raises `QuotaExceededError`, `SecurityError`, etc.; we
/// surface them as `Io` since the caller's recovery path is uniform
/// (clear + retry / surface to the user).
fn js_err_to_storage_error(err: &JsValue) -> SessionStorageError {
    SessionStorageError::Io(format!("{err:?}"))
}

/// Resolve the browser's `localStorage` handle, mapping the layered
/// failure modes (no window, no storage, storage disabled) into
/// `BackendUnavailable` so the caller can fall back gracefully.
fn local_storage() -> Result<web_sys::Storage, SessionStorageError> {
    let window = web_sys::window().ok_or_else(|| {
        SessionStorageError::BackendUnavailable("no window (non-browser context)".to_string())
    })?;
    window
        .local_storage()
        .map_err(|e| js_err_to_storage_error(&e))?
        .ok_or_else(|| {
            // Some browsers (Safari private mode, embedded webviews with
            // storage disabled) return `Ok(None)` here. Treat the same
            // as a missing backend so callers fall through to in-memory.
            SessionStorageError::BackendUnavailable("localStorage not available".to_string())
        })
}

#[async_trait(?Send)]
impl SessionStorage for BrowserSessionStorage {
    async fn store(&self, session: &PersistedSession) -> Result<(), AuthError> {
        let storage = local_storage().map_err(AuthError::from)?;
        let blob = serde_json::to_string(session)
            .map_err(|e| SessionStorageError::Decryption(format!("serialize: {e}")))?;
        storage
            .set_item(&self.key, &blob)
            .map_err(|e| SessionStorageError::Io(format!("{e:?}")))?;
        Ok(())
    }

    async fn load(&self) -> Result<Option<PersistedSession>, AuthError> {
        let storage = local_storage().map_err(AuthError::from)?;
        let raw = storage
            .get_item(&self.key)
            .map_err(|e| SessionStorageError::Io(format!("{e:?}")))?;
        match raw {
            None => Ok(None),
            Some(blob) => {
                let session = serde_json::from_str::<PersistedSession>(&blob)
                    .map_err(|e| SessionStorageError::Decryption(format!("deserialize: {e}")))?;
                Ok(Some(session))
            }
        }
    }

    async fn clear(&self) -> Result<(), AuthError> {
        let storage = local_storage().map_err(AuthError::from)?;
        storage
            .remove_item(&self.key)
            .map_err(|e| SessionStorageError::Io(format!("{e:?}")))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    fn unique_key(label: &str) -> String {
        // wasm_bindgen_test runs every case under the same browser origin
        // / localStorage namespace; isolating each case under a unique key
        // keeps them independent in case the harness ever runs in
        // parallel.
        format!("{}-{}-{}", DEFAULT_STORAGE_KEY, label, Uuid::new_v4())
    }

    #[wasm_bindgen_test]
    async fn store_load_clear_roundtrip() {
        let storage = BrowserSessionStorage::with_key(unique_key("roundtrip"));
        assert!(storage.load().await.unwrap().is_none());

        let session = PersistedSession {
            user_id: Uuid::new_v4(),
            refresh_token: "rt.test.123".to_string(),
        };
        storage.store(&session).await.unwrap();
        assert_eq!(storage.load().await.unwrap(), Some(session.clone()));

        storage.clear().await.unwrap();
        assert!(storage.load().await.unwrap().is_none());
    }

    #[wasm_bindgen_test]
    async fn store_overwrites_previous() {
        let storage = BrowserSessionStorage::with_key(unique_key("overwrite"));
        let s1 = PersistedSession {
            user_id: Uuid::new_v4(),
            refresh_token: "rt.first".to_string(),
        };
        let s2 = PersistedSession {
            user_id: Uuid::new_v4(),
            refresh_token: "rt.second".to_string(),
        };
        storage.store(&s1).await.unwrap();
        storage.store(&s2).await.unwrap();
        assert_eq!(storage.load().await.unwrap(), Some(s2));
    }

    #[wasm_bindgen_test]
    async fn load_corrupt_blob_surfaces_decryption_error() {
        // Manually poke a malformed blob into the slot to simulate
        // browser-side tampering / version skew. The trait surface
        // doesn't have a typed `SessionStorageError` returned (it's
        // collapsed into `AuthError`), but the message preserves the
        // category from `SessionStorageError::Decryption`.
        let key = unique_key("corrupt");
        let storage = BrowserSessionStorage::with_key(&key);
        let inner = local_storage().unwrap();
        inner.set_item(&key, "{not valid json").unwrap();

        let err = storage.load().await.unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("decryption") || msg.contains("deserialize"),
            "expected decryption error, got: {msg}"
        );
    }
}
