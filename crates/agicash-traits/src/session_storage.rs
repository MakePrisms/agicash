use crate::AuthError;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PersistedSession {
    pub user_id: Uuid,
    pub refresh_token: String,
}

#[async_trait]
pub trait SessionStorage: Send + Sync {
    async fn store(&self, session: &PersistedSession) -> Result<(), AuthError>;
    async fn load(&self) -> Result<Option<PersistedSession>, AuthError>;
    async fn clear(&self) -> Result<(), AuthError>;
}

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
        async fn store(&self, session: &PersistedSession) -> Result<(), AuthError> {
            *self.session.lock().unwrap() = Some(session.clone());
            Ok(())
        }

        async fn load(&self) -> Result<Option<PersistedSession>, AuthError> {
            Ok(self.session.lock().unwrap().clone())
        }

        async fn clear(&self) -> Result<(), AuthError> {
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
}
