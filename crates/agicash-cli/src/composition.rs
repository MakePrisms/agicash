use agicash_auth_opensecret::{
    KeyringSessionStorage, OpenSecretClient, OpenSecretConfig, OpenSecretTokenProvider,
    DEFAULT_SERVICE,
};
use agicash_cashu::CdkCashuProvider;
use agicash_exchange_rate::MempoolSpaceProvider;
use agicash_storage_supabase::{SupabaseStorage, SupabaseStorageConfig};
use agicash_traits::{AuthError, StorageError, TokenProvider};
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

pub struct CashuDeps {
    pub provider: CdkCashuProvider,
}

impl std::fmt::Debug for CashuDeps {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CashuDeps").finish_non_exhaustive()
    }
}

pub fn build_cashu_deps() -> CashuDeps {
    CashuDeps {
        provider: CdkCashuProvider::new(),
    }
}

pub struct ExchangeRateDeps {
    pub provider: MempoolSpaceProvider,
}

impl std::fmt::Debug for ExchangeRateDeps {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ExchangeRateDeps").finish_non_exhaustive()
    }
}

pub fn build_exchange_rate_deps() -> ExchangeRateDeps {
    ExchangeRateDeps {
        provider: MempoolSpaceProvider::new(),
    }
}
