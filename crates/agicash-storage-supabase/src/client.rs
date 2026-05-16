use crate::SupabaseStorageConfig;
use agicash_traits::{StorageError, TokenProvider};
use rustls_platform_verifier::ConfigVerifierExt;
use std::sync::{Arc, OnceLock};

/// Schema name in the Supabase project where all wallet tables live.
pub(crate) const WALLET_SCHEMA: &str = "wallet";

/// Build the shared `reqwest::Client` once and reuse it. TLS chain validation
/// is delegated to the platform's native verifier (Security.framework on
/// macOS/iOS, SChannel on Windows, system roots on Linux) so the system trust
/// store — including any user-installed mkcert root in the iOS simulator
/// keychain — is honored. Replaces the previous `rustls-tls-native-roots`
/// approach, which only consulted the host trust store and silently failed
/// on iOS targets.
fn http_client() -> Result<reqwest::Client, StorageError> {
    // `rustls-platform-verifier` builds a `ClientConfig` against the process
    // default `CryptoProvider`. Install ring exactly once before the first
    // call. `install_default` returns `Err` if a provider is already
    // installed, which is fine — we just need *some* provider available.
    static PROVIDER_INSTALL: OnceLock<()> = OnceLock::new();
    PROVIDER_INSTALL.get_or_init(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });

    let tls_config = rustls::ClientConfig::with_platform_verifier()
        .map_err(|e| StorageError::Backend(format!("rustls platform verifier: {e}")))?;

    reqwest::Client::builder()
        .use_preconfigured_tls(tls_config)
        .build()
        .map_err(|e| StorageError::Backend(format!("reqwest client build: {e}")))
}

#[derive(Clone)]
pub struct SupabaseStorage {
    /// REST endpoint base (e.g. `https://xxx.supabase.co/rest/v1`).
    pub(crate) rest_url: String,
    pub(crate) anon_key: String,
    pub(crate) tokens: Arc<dyn TokenProvider + Send + Sync>,
    /// Reqwest client wired to the platform-native TLS verifier. Shared
    /// across all RPC/select calls so the connection pool is reused.
    pub(crate) http: reqwest::Client,
}

impl std::fmt::Debug for SupabaseStorage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SupabaseStorage")
            .field("rest_url", &self.rest_url)
            .field("anon_key", &"<redacted>")
            .finish_non_exhaustive()
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
        let http = http_client()?;
        Ok(Self {
            rest_url,
            anon_key: config.anon_key,
            tokens,
            http,
        })
    }

    /// Build a `postgrest::Postgrest` instance scoped to the `wallet` schema
    /// with per-request auth headers. Called once per RPC/select. Reuses the
    /// shared `reqwest::Client` so platform-verifier TLS settings are applied
    /// to every request.
    pub(crate) async fn authenticated_client(&self) -> Result<postgrest::Postgrest, StorageError> {
        let jwt = self
            .tokens
            .get_jwt()
            .await
            .map_err(|e| StorageError::Backend(format!("token provider: {e}")))?;
        let client = postgrest::Postgrest::new_with_client(&self.rest_url, self.http.clone())
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
