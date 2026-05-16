use crate::SupabaseStorageConfig;
use agicash_traits::{StorageError, TokenProvider};
use base64::Engine;
use rustls_platform_verifier::ConfigVerifierExt;
use std::sync::{Arc, OnceLock};

/// Extract just the `sub` claim from a JWT for logging.
///
/// Mirrors `agicash_ffi::observability::jwt_sub` — duplicated rather
/// than depending on `agicash-ffi` because that would invert the
/// dependency graph (FFI already depends on storage). The function
/// is tiny and stateless; keeping the logging-only helper local
/// avoids the cycle.
///
/// Returns the user-id portion only. The full token never leaves
/// this function.
fn jwt_sub_for_log(jwt: &str) -> String {
    let mut parts = jwt.split('.');
    let _header = parts.next();
    let Some(payload_b64) = parts.next() else {
        return "<unparseable>".into();
    };
    let Ok(payload_bytes) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload_b64)
    else {
        return "<unparseable>".into();
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&payload_bytes) else {
        return "<unparseable>".into();
    };
    value
        .get("sub")
        .and_then(|v| v.as_str())
        .map_or_else(|| "<missing-sub>".into(), std::string::ToString::to_string)
}

/// Schema name in the Supabase project where all wallet tables live.
pub(crate) const WALLET_SCHEMA: &str = "wallet";

/// Build the shared `reqwest::Client` once and reuse it. TLS chain validation
/// is delegated to the platform's native verifier (Security.framework on
/// macOS/iOS, `SChannel` on Windows, system roots on Linux) so the system trust
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

    // Fail fast on unreachable endpoints rather than spinning forever.
    // The iOS sim debug session of 2026-05-16 burned hours on a stale
    // Keychain session pointing at `http://127.0.0.1:3999`, which was
    // listening but unresponsive on `/health`. Without these timeouts
    // the app hung silently with no UI signal. Connect timeout covers
    // the TCP handshake; the overall request timeout bounds any single
    // HTTP exchange. Values chosen to be generous for slow mobile
    // networks while still surfacing real outages in < 30s.
    reqwest::Client::builder()
        .use_preconfigured_tls(tls_config)
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(30))
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
        tracing::info!(
            target: "agicash_storage_supabase::client",
            jwt_sub = %jwt_sub_for_log(&jwt),
            jwt_len = jwt.len(),
            "authenticated_client: jwt issued"
        );
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

    /// Regression guard for the iOS sim hang of 2026-05-16: a stale
    /// Keychain session pointed `wallet.setSession()` at a local
    /// endpoint that accepted the TCP handshake but never answered.
    /// Without `connect_timeout`/`timeout` the call hangs forever.
    /// We use TEST-NET-1 (`192.0.2.1`), an IANA-reserved
    /// documentation/non-routable block, so the request *cannot*
    /// complete a connection in any environment — the connect timeout
    /// is the only thing that can return us.
    ///
    /// The 5s connect-timeout target leaves a 2s slack budget to
    /// absorb scheduler/runtime jitter on a loaded CI box.
    #[tokio::test]
    async fn connect_timeout_fires_within_budget() {
        let client = http_client().expect("client builds");
        let start = std::time::Instant::now();
        let result = client.get("http://192.0.2.1:80").send().await;
        let elapsed = start.elapsed();
        assert!(result.is_err(), "expected connect error, got: {result:?}");
        assert!(
            elapsed < std::time::Duration::from_secs(7),
            "connect_timeout did not fire within budget: elapsed={elapsed:?}"
        );
    }
}
