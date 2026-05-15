use crate::SupabaseStorageConfig;
use agicash_traits::{StorageError, TokenProvider};
use std::sync::Arc;

/// Schema name in the Supabase project where all wallet tables live.
pub(crate) const WALLET_SCHEMA: &str = "wallet";

#[derive(Clone)]
pub struct SupabaseStorage {
    /// REST endpoint base (e.g. `https://xxx.supabase.co/rest/v1`).
    pub(crate) rest_url: String,
    pub(crate) anon_key: String,
    pub(crate) tokens: Arc<dyn TokenProvider + Send + Sync>,
}

impl std::fmt::Debug for SupabaseStorage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SupabaseStorage")
            .field("rest_url", &self.rest_url)
            .field("anon_key", &"<redacted>")
            .finish()
    }
}

impl SupabaseStorage {
    pub fn new(
        config: SupabaseStorageConfig,
        tokens: Arc<dyn TokenProvider + Send + Sync>,
    ) -> Result<Self, StorageError> {
        // Normalize `<base>` -> `<base>/rest/v1`. Strip a trailing slash if any.
        let base = config.url.trim_end_matches('/');
        let rest_url = format!("{base}/rest/v1");
        Ok(Self {
            rest_url,
            anon_key: config.anon_key,
            tokens,
        })
    }

    /// Build a `postgrest::Postgrest` instance scoped to the `wallet` schema
    /// with per-request auth headers. Called once per RPC/select.
    pub(crate) async fn authenticated_client(
        &self,
    ) -> Result<postgrest::Postgrest, StorageError> {
        let jwt = self
            .tokens
            .get_jwt()
            .await
            .map_err(|e| StorageError::Backend(format!("token provider: {e}")))?;
        let client = postgrest::Postgrest::new(&self.rest_url)
            .schema(WALLET_SCHEMA)
            .insert_header("apikey", &self.anon_key)
            .insert_header("Authorization", format!("Bearer {jwt}"));
        Ok(client)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use agicash_traits::AuthError;
    use async_trait::async_trait;

    struct StubTokens;

    #[async_trait]
    impl TokenProvider for StubTokens {
        async fn get_jwt(&self) -> Result<String, AuthError> {
            Ok("stub.jwt.token".into())
        }
    }

    #[test]
    fn constructor_normalizes_trailing_slash() {
        let cfg = SupabaseStorageConfig {
            url: "https://test.supabase.co/".into(),
            anon_key: "anon".into(),
        };
        let s = SupabaseStorage::new(cfg, Arc::new(StubTokens)).unwrap();
        assert_eq!(s.rest_url, "https://test.supabase.co/rest/v1");
    }

    #[tokio::test]
    async fn authenticated_client_calls_token_provider() {
        let cfg = SupabaseStorageConfig {
            url: "https://test.supabase.co".into(),
            anon_key: "anon-key".into(),
        };
        let s = SupabaseStorage::new(cfg, Arc::new(StubTokens)).unwrap();
        let _client = s.authenticated_client().await.unwrap();
    }
}
