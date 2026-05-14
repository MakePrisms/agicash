use agicash_traits::{AuthError, PersistedSession, SessionStorage};
use async_trait::async_trait;

pub const DEFAULT_SERVICE: &str = "com.agicash.cli";
const SESSION_KEY: &str = "session";

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

    fn entry(&self) -> Result<keyring::Entry, AuthError> {
        keyring::Entry::new(&self.service, SESSION_KEY)
            .map_err(|e| AuthError::Internal(format!("keyring entry: {e}")))
    }
}

impl Default for KeyringSessionStorage {
    fn default() -> Self {
        Self::new(DEFAULT_SERVICE)
    }
}

#[async_trait]
impl SessionStorage for KeyringSessionStorage {
    async fn store(&self, session: &PersistedSession) -> Result<(), AuthError> {
        let entry = self.entry()?;
        let blob = serde_json::to_string(session)
            .map_err(|e| AuthError::Internal(format!("serialize session: {e}")))?;
        tokio::task::spawn_blocking(move || entry.set_password(&blob))
            .await
            .map_err(|e| AuthError::Internal(format!("spawn_blocking: {e}")))?
            .map_err(|e| AuthError::Internal(format!("keyring set: {e}")))
    }

    async fn load(&self) -> Result<Option<PersistedSession>, AuthError> {
        let entry = self.entry()?;
        let result = tokio::task::spawn_blocking(move || entry.get_password())
            .await
            .map_err(|e| AuthError::Internal(format!("spawn_blocking: {e}")))?;
        match result {
            Ok(blob) => {
                let session = serde_json::from_str::<PersistedSession>(&blob)
                    .map_err(|e| AuthError::Internal(format!("deserialize session: {e}")))?;
                Ok(Some(session))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AuthError::Internal(format!("keyring get: {e}"))),
        }
    }

    async fn clear(&self) -> Result<(), AuthError> {
        let entry = self.entry()?;
        let result = tokio::task::spawn_blocking(move || entry.delete_credential())
            .await
            .map_err(|e| AuthError::Internal(format!("spawn_blocking: {e}")))?;
        match result {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AuthError::Internal(format!("keyring delete: {e}"))),
        }
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
