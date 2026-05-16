//! File-backed encrypted session storage for Android targets.
//!
//! Android's `keyring` crate ships no native backend (the `keyring`
//! crate today only wraps macOS Keychain, Windows Credential Vault, and
//! Linux `secret-service`/`KWallet`). To persist sessions across cold
//! starts on Android we use the app's private data directory — the
//! filesystem location that Android sandboxes per-application so other
//! apps cannot read it.
//!
//! ## Threat model
//!
//! Android's per-app data dir (`Context#getFilesDir()`) is:
//! - Owned by the app's Linux UID
//! - Unreadable by other apps on a non-rooted device
//! - Wiped when the user clears app data or uninstalls
//!
//! We additionally encrypt the stored blob with AES-256-GCM keyed by a
//! 32-byte random key persisted alongside the session blob. The
//! encryption layer guards against:
//! - Filesystem dumps off a rooted device (the attacker would also
//!   need the sibling key file from the same dir).
//! - Backup snapshots that include the session file but not the key
//!   (e.g. selective ADB backups, ill-configured cloud backup rules).
//!
//! It does **not** protect against an attacker with root who can read
//! the entire app data dir — for that, route through Android Keystore
//! via JNI (a follow-up).
//!
//! ## Layout
//!
//! Given a base dir `D` passed in at construction:
//! - `D/agicash_session.enc` — AES-256-GCM ciphertext over the JSON
//!   `PersistedSession`, with a 12-byte random nonce prepended.
//! - `D/agicash_session.key` — 32-byte AES key (raw bytes).
//!
//! Both files are written with `0o600` permissions where the platform
//! supports them. On Android the UID isolation is the primary control.
//!
//! ## Why a sibling key file (not derived from device id)?
//!
//! We deliberately avoid binding the key to a device-specific secret
//! (build fingerprint, IMEI, etc.). That would either need a JNI hop
//! (defeats the "no JNI" simplicity goal) or pull in device-id deps
//! that don't compile on host for tests. The sibling-key model is a
//! known tradeoff: it's no stronger than the filesystem ACL but it
//! gives us defense-in-depth against backup leakage and a clean
//! migration path — when we later add a Keystore-backed key wrap, the
//! sentinel file becomes the wrapped-key blob and the impl shape
//! doesn't change.

use agicash_traits::{AuthError, PersistedSession, SessionStorage, SessionStorageError};
use async_trait::async_trait;
use std::path::{Path, PathBuf};

const SESSION_FILE: &str = "agicash_session.enc";
const KEY_FILE: &str = "agicash_session.key";
const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;

/// Encrypted file-backed session storage rooted in the caller-provided
/// directory.
///
/// On Android the caller passes the application's private data dir
/// (`Context.getFilesDir().getAbsolutePath()` from Kotlin). The blob is
/// AES-256-GCM encrypted with a per-install random key stored in the
/// same dir.
#[derive(Debug, Clone)]
pub struct AndroidFileSessionStorage {
    base_dir: PathBuf,
}

impl AndroidFileSessionStorage {
    /// Construct a new storage rooted at `base_dir`.
    ///
    /// The directory is expected to exist (Android's `getFilesDir()`
    /// always does). If it doesn't, `store` will surface the underlying
    /// I/O error via `SessionStorageError::Io`.
    #[must_use]
    pub fn new(base_dir: impl Into<PathBuf>) -> Self {
        Self {
            base_dir: base_dir.into(),
        }
    }

    fn session_path(&self) -> PathBuf {
        self.base_dir.join(SESSION_FILE)
    }

    fn key_path(&self) -> PathBuf {
        self.base_dir.join(KEY_FILE)
    }
}

#[async_trait]
impl SessionStorage for AndroidFileSessionStorage {
    async fn store(&self, session: &PersistedSession) -> Result<(), AuthError> {
        let session = session.clone();
        let session_path = self.session_path();
        let key_path = self.key_path();
        tokio::task::spawn_blocking(move || -> Result<(), SessionStorageError> {
            let key = load_or_create_key(&key_path)?;
            let plaintext = serde_json::to_vec(&session)
                .map_err(|e| SessionStorageError::Decryption(format!("serialize session: {e}")))?;
            let blob = encrypt_blob(&key, &plaintext)?;
            write_file_atomically(&session_path, &blob)?;
            Ok(())
        })
        .await
        .map_err(|e| SessionStorageError::Io(format!("spawn_blocking join: {e}")))??;
        Ok(())
    }

    async fn load(&self) -> Result<Option<PersistedSession>, AuthError> {
        let session_path = self.session_path();
        let key_path = self.key_path();
        let result = tokio::task::spawn_blocking(
            move || -> Result<Option<PersistedSession>, SessionStorageError> {
                if !session_path.exists() {
                    return Ok(None);
                }
                // Session blob without key file is a corrupted state
                // (likely an interrupted clear or a half-restored
                // backup); surface that explicitly instead of returning
                // Ok(None).
                let Some(key) = load_key(&key_path)? else {
                    return Err(SessionStorageError::Decryption(
                        "session file present but key file missing".into(),
                    ));
                };
                let blob = std::fs::read(&session_path)
                    .map_err(|e| SessionStorageError::Io(format!("read session file: {e}")))?;
                let plaintext = decrypt_blob(&key, &blob)?;
                let session =
                    serde_json::from_slice::<PersistedSession>(&plaintext).map_err(|e| {
                        SessionStorageError::Decryption(format!("deserialize session: {e}"))
                    })?;
                Ok(Some(session))
            },
        )
        .await
        .map_err(|e| SessionStorageError::Io(format!("spawn_blocking join: {e}")))??;
        Ok(result)
    }

    async fn clear(&self) -> Result<(), AuthError> {
        let session_path = self.session_path();
        let key_path = self.key_path();
        tokio::task::spawn_blocking(move || -> Result<(), SessionStorageError> {
            remove_if_exists(&session_path)?;
            remove_if_exists(&key_path)?;
            Ok(())
        })
        .await
        .map_err(|e| SessionStorageError::Io(format!("spawn_blocking join: {e}")))??;
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Crypto + I/O helpers. Pulled out as free functions so the host test
// suite can exercise them on macOS/Linux without target-gating the test
// itself. The Android `AndroidFileSessionStorage` impl above is the only
// caller in production.
// ---------------------------------------------------------------------------

/// Encrypt `plaintext` with AES-256-GCM keyed by `key`.
///
/// The returned blob is `nonce (12 bytes) || ciphertext+tag`. A fresh
/// random nonce is generated for every call.
pub(crate) fn encrypt_blob(
    key: &[u8; KEY_LEN],
    plaintext: &[u8],
) -> Result<Vec<u8>, SessionStorageError> {
    use aes_gcm::aead::{Aead, KeyInit};
    use aes_gcm::{Aes256Gcm, Nonce};

    let cipher = Aes256Gcm::new(key.into());
    let mut nonce_bytes = [0u8; NONCE_LEN];
    getrandom::getrandom(&mut nonce_bytes)
        .map_err(|e| SessionStorageError::Io(format!("rng: {e}")))?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| SessionStorageError::Decryption(format!("aes-gcm encrypt: {e}")))?;
    let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Inverse of [`encrypt_blob`].
pub(crate) fn decrypt_blob(
    key: &[u8; KEY_LEN],
    blob: &[u8],
) -> Result<Vec<u8>, SessionStorageError> {
    use aes_gcm::aead::{Aead, KeyInit};
    use aes_gcm::{Aes256Gcm, Nonce};

    if blob.len() < NONCE_LEN {
        return Err(SessionStorageError::Decryption(format!(
            "blob shorter than nonce ({} bytes)",
            blob.len()
        )));
    }
    let (nonce_bytes, ciphertext) = blob.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new(key.into());
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| SessionStorageError::Decryption(format!("aes-gcm decrypt: {e}")))
}

/// Load a 32-byte key from `path`, or generate + persist a new one if
/// the file doesn't exist. Returns the key bytes.
pub(crate) fn load_or_create_key(path: &Path) -> Result<[u8; KEY_LEN], SessionStorageError> {
    if let Some(existing) = load_key(path)? {
        return Ok(existing);
    }
    let mut key = [0u8; KEY_LEN];
    getrandom::getrandom(&mut key).map_err(|e| SessionStorageError::Io(format!("rng: {e}")))?;
    write_file_atomically(path, &key)?;
    Ok(key)
}

/// Load a key from `path` if it exists. Returns `Ok(None)` for a
/// missing file, `Err` for any other I/O failure or wrong size.
pub(crate) fn load_key(path: &Path) -> Result<Option<[u8; KEY_LEN]>, SessionStorageError> {
    match std::fs::read(path) {
        Ok(bytes) => {
            if bytes.len() != KEY_LEN {
                return Err(SessionStorageError::Decryption(format!(
                    "key file wrong size: {} (expected {})",
                    bytes.len(),
                    KEY_LEN
                )));
            }
            let mut out = [0u8; KEY_LEN];
            out.copy_from_slice(&bytes);
            Ok(Some(out))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(SessionStorageError::Io(format!("read key file: {e}"))),
    }
}

/// Atomic-rename write: write to `path.tmp`, then rename onto `path`.
/// Ensures readers never see a half-written file.
pub(crate) fn write_file_atomically(path: &Path, bytes: &[u8]) -> Result<(), SessionStorageError> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes)
        .map_err(|e| SessionStorageError::Io(format!("write tmp file: {e}")))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // Best-effort: tighten permissions to owner-only. On Android
        // the per-app UID isolation already prevents other apps from
        // reading the file, but explicit 0o600 doesn't hurt and helps
        // host tests / future Linux usage.
        if let Ok(meta) = std::fs::metadata(&tmp) {
            let mut perms = meta.permissions();
            perms.set_mode(0o600);
            let _ = std::fs::set_permissions(&tmp, perms);
        }
    }
    std::fs::rename(&tmp, path)
        .map_err(|e| SessionStorageError::Io(format!("rename tmp into place: {e}")))?;
    Ok(())
}

pub(crate) fn remove_if_exists(path: &Path) -> Result<(), SessionStorageError> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(SessionStorageError::Io(format!(
            "remove file {}: {}",
            path.display(),
            e
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use agicash_traits::PersistedSession;
    use uuid::Uuid;

    fn test_session() -> PersistedSession {
        PersistedSession {
            user_id: Uuid::new_v4(),
            refresh_token: "test.refresh.token".to_string(),
        }
    }

    #[test]
    fn encrypt_decrypt_roundtrips() {
        let key = [7u8; KEY_LEN];
        let plaintext = b"hello, agicash";
        let blob = encrypt_blob(&key, plaintext).unwrap();
        let decrypted = decrypt_blob(&key, &blob).unwrap();
        assert_eq!(plaintext.to_vec(), decrypted);
    }

    #[test]
    fn encrypt_uses_fresh_nonce_per_call() {
        // Encrypting the same plaintext twice must yield different
        // ciphertexts (because the nonce is random per call). Without
        // this, nonce reuse under the same key would leak plaintext
        // structure across stores.
        let key = [11u8; KEY_LEN];
        let plaintext = b"same input";
        let a = encrypt_blob(&key, plaintext).unwrap();
        let b = encrypt_blob(&key, plaintext).unwrap();
        assert_ne!(a, b, "two encrypts of same plaintext must differ");
        // Both must still decrypt back to the same plaintext.
        assert_eq!(decrypt_blob(&key, &a).unwrap(), plaintext);
        assert_eq!(decrypt_blob(&key, &b).unwrap(), plaintext);
    }

    #[test]
    fn decrypt_rejects_tampered_ciphertext() {
        let key = [13u8; KEY_LEN];
        let plaintext = b"sensitive";
        let mut blob = encrypt_blob(&key, plaintext).unwrap();
        // Flip a byte deep in the ciphertext (past the nonce).
        let idx = blob.len() - 1;
        blob[idx] ^= 0xff;
        let err = decrypt_blob(&key, &blob).unwrap_err();
        assert!(matches!(err, SessionStorageError::Decryption(_)));
    }

    #[test]
    fn decrypt_rejects_wrong_key() {
        let plaintext = b"sensitive";
        let blob = encrypt_blob(&[1u8; KEY_LEN], plaintext).unwrap();
        let err = decrypt_blob(&[2u8; KEY_LEN], &blob).unwrap_err();
        assert!(matches!(err, SessionStorageError::Decryption(_)));
    }

    #[test]
    fn decrypt_rejects_short_blob() {
        let err = decrypt_blob(&[0u8; KEY_LEN], &[0u8; 5]).unwrap_err();
        assert!(matches!(err, SessionStorageError::Decryption(_)));
    }

    #[test]
    fn load_or_create_key_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let key_path = dir.path().join(KEY_FILE);
        let k1 = load_or_create_key(&key_path).unwrap();
        let k2 = load_or_create_key(&key_path).unwrap();
        assert_eq!(k1, k2, "second call must read the same key, not regenerate");
    }

    #[test]
    fn load_key_returns_none_for_missing_file() {
        let dir = tempfile::tempdir().unwrap();
        let key_path = dir.path().join(KEY_FILE);
        assert!(load_key(&key_path).unwrap().is_none());
    }

    #[test]
    fn load_key_rejects_wrong_size() {
        let dir = tempfile::tempdir().unwrap();
        let key_path = dir.path().join(KEY_FILE);
        std::fs::write(&key_path, b"too short").unwrap();
        let err = load_key(&key_path).unwrap_err();
        assert!(matches!(err, SessionStorageError::Decryption(_)));
    }

    #[test]
    fn write_file_atomically_replaces_existing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("blob");
        write_file_atomically(&path, b"first").unwrap();
        write_file_atomically(&path, b"second").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"second");
    }

    #[test]
    fn remove_if_exists_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ghost");
        remove_if_exists(&path).unwrap();
        std::fs::write(&path, b"x").unwrap();
        remove_if_exists(&path).unwrap();
        assert!(!path.exists());
        remove_if_exists(&path).unwrap();
    }

    // The full async SessionStorage roundtrip is exercised on host
    // even though the production `AndroidFileSessionStorage` type is
    // gated behind `cfg(target_os = "android")` — we drive the same
    // helpers directly to keep coverage on macOS/Linux CI. The type
    // gate keeps the *exposed* surface Android-only; the underlying
    // file-backed logic compiles everywhere because it's pure stdlib +
    // aes-gcm.
    #[tokio::test]
    async fn end_to_end_roundtrip_using_helpers() {
        let dir = tempfile::tempdir().unwrap();
        let session = test_session();

        // Store
        let session_path = dir.path().join(SESSION_FILE);
        let key_path = dir.path().join(KEY_FILE);
        let key = load_or_create_key(&key_path).unwrap();
        let plaintext = serde_json::to_vec(&session).unwrap();
        let blob = encrypt_blob(&key, &plaintext).unwrap();
        write_file_atomically(&session_path, &blob).unwrap();

        // Reload
        let key2 = load_key(&key_path).unwrap().unwrap();
        assert_eq!(key, key2);
        let blob2 = std::fs::read(&session_path).unwrap();
        let plaintext2 = decrypt_blob(&key2, &blob2).unwrap();
        let session2: PersistedSession = serde_json::from_slice(&plaintext2).unwrap();
        assert_eq!(session, session2);

        // Clear
        remove_if_exists(&session_path).unwrap();
        remove_if_exists(&key_path).unwrap();
        assert!(!session_path.exists());
        assert!(!key_path.exists());
    }

    // Also exercise the AndroidFileSessionStorage type itself on host.
    // The production gate (`cfg(target_os = "android")`) only governs
    // the *re-export* in storage.rs; the implementation itself is plain
    // Rust + stdlib + aes-gcm and compiles + runs everywhere.
    #[tokio::test]
    async fn storage_full_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let storage = AndroidFileSessionStorage::new(dir.path());

        // Empty state.
        assert!(storage.load().await.unwrap().is_none());

        // Store -> load.
        let session = test_session();
        storage.store(&session).await.unwrap();
        let loaded = storage.load().await.unwrap();
        assert_eq!(loaded, Some(session.clone()));

        // Overwrite.
        let session2 = PersistedSession {
            user_id: Uuid::new_v4(),
            refresh_token: "rt2".to_string(),
        };
        storage.store(&session2).await.unwrap();
        let loaded2 = storage.load().await.unwrap();
        assert_eq!(loaded2, Some(session2));

        // Clear.
        storage.clear().await.unwrap();
        assert!(storage.load().await.unwrap().is_none());
    }

    #[tokio::test]
    async fn storage_clear_is_idempotent_on_empty_dir() {
        let dir = tempfile::tempdir().unwrap();
        let storage = AndroidFileSessionStorage::new(dir.path());
        storage.clear().await.unwrap();
        storage.clear().await.unwrap();
    }

    #[tokio::test]
    async fn storage_load_after_key_corruption_errors() {
        let dir = tempfile::tempdir().unwrap();
        let storage = AndroidFileSessionStorage::new(dir.path());
        storage.store(&test_session()).await.unwrap();

        // Truncate the key file to simulate a half-restored backup.
        std::fs::write(dir.path().join(KEY_FILE), b"oops").unwrap();
        let err = storage.load().await.unwrap_err();
        // Error should bubble through AuthError::Internal (the From
        // impl for SessionStorageError maps Decryption variant there).
        assert!(format!("{err}").to_lowercase().contains("session"));
    }
}
