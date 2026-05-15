use agicash_auth_opensecret::{
    auth_error_from_opensecret, KeyringSessionStorage, OpenSecretClient, OpenSecretConfig,
    OpenSecretTokenProvider, DEFAULT_SERVICE,
};
use agicash_storage_supabase::{SupabaseStorage, SupabaseStorageConfig};
use agicash_traits::{AuthError, SessionStorage, StorageError, TokenProvider};
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct AuthDeps {
    pub client: OpenSecretClient,
    pub storage: KeyringSessionStorage,
}

pub fn build_auth_deps() -> Result<AuthDeps, AuthError> {
    let config = OpenSecretConfig::from_env()?;
    let client = OpenSecretClient::new(config)?;
    let service =
        std::env::var("AGICASH_KEYRING_SERVICE").unwrap_or_else(|_| DEFAULT_SERVICE.to_string());
    let storage = KeyringSessionStorage::new(service);
    Ok(AuthDeps { client, storage })
}

#[derive(Clone)]
pub struct StorageDeps {
    pub storage: Arc<SupabaseStorage>,
}

impl std::fmt::Debug for StorageDeps {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StorageDeps").finish_non_exhaustive()
    }
}

pub fn build_storage_deps(auth: &AuthDeps) -> Result<StorageDeps, StorageError> {
    let config = SupabaseStorageConfig::from_env()?;
    let tokens: Arc<dyn TokenProvider + Send + Sync> =
        Arc::new(OpenSecretTokenProvider::new(auth.client.clone()));
    let storage = Arc::new(SupabaseStorage::new(config, tokens)?);
    Ok(StorageDeps { storage })
}

/// Load any persisted refresh token into the in-memory `OpenSecretClient`
/// so subsequent `TokenProvider::get_jwt()` calls succeed.
///
/// Returns `true` if a session was hydrated, `false` if the keyring was
/// empty. On refresh failure the keyring entry is cleared so the user
/// isn't stuck with a stale refresh token.
///
/// Call this from any command path that exercises `TokenProvider` before
/// the first request; commands that only need the local `PersistedSession`
/// (e.g. `auth status`) can skip it.
pub async fn rehydrate_session(deps: &AuthDeps) -> Result<bool, AuthError> {
    let Some(persisted) = deps.storage.load().await? else {
        return Ok(false);
    };

    deps.client.ensure_handshake().await?;

    // The SDK's `refresh_token()` only consults the refresh slot; the access
    // string is rewritten on success. Empty placeholder is fine here.
    deps.client
        .inner()
        .set_tokens(String::new(), Some(persisted.refresh_token))
        .map_err(auth_error_from_opensecret)?;

    if let Err(e) = deps.client.inner().refresh_token().await {
        // The stored refresh token is no good — wipe it so future runs
        // don't keep retrying the same dead session.
        let _ = deps.storage.clear().await;
        return Err(auth_error_from_opensecret(e));
    }

    Ok(true)
}
