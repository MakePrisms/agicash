use agicash_auth_opensecret::{
    KeyringSessionStorage, OpenSecretClient, OpenSecretConfig, OpenSecretTokenProvider,
    DEFAULT_SERVICE,
};
use agicash_cashu::{
    CashuMintQuoteService, CashuMintQuoteStorage, CashuReceiveSwapService, CashuReceiveSwapStorage,
    CashuSendSwapService, CashuSendSwapStorage, CdkCashuProvider,
};
use agicash_exchange_rate::MempoolSpaceProvider;
use agicash_storage_supabase::{
    SupabaseCashuMintQuoteStorage, SupabaseCashuReceiveSwapStorage, SupabaseCashuSendSwapStorage,
    SupabaseStorage, SupabaseStorageConfig,
};
use agicash_traits::{
    AuthError, CashuProvider, PassthroughProofEncryption, ProofEncryption, StorageError,
    TokenProvider,
};
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
    pub provider: Arc<dyn CashuProvider>,
}

impl Clone for CashuDeps {
    fn clone(&self) -> Self {
        Self {
            provider: Arc::clone(&self.provider),
        }
    }
}

impl std::fmt::Debug for CashuDeps {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CashuDeps").finish_non_exhaustive()
    }
}

pub fn build_cashu_deps() -> CashuDeps {
    CashuDeps {
        provider: Arc::new(CdkCashuProvider::new()),
    }
}

/// CLI-side dep bundle for the Cashu receive flow. Wires the slice-5
/// passthrough encryption stub onto a real Supabase storage and the
/// existing `CashuProvider`.
pub struct ReceiveSwapDeps {
    pub service: Arc<CashuReceiveSwapService>,
    pub storage: Arc<dyn CashuReceiveSwapStorage>,
}

impl Clone for ReceiveSwapDeps {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            storage: Arc::clone(&self.storage),
        }
    }
}

impl std::fmt::Debug for ReceiveSwapDeps {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ReceiveSwapDeps").finish_non_exhaustive()
    }
}

pub fn build_receive_swap_deps(
    storage_deps: &StorageDeps,
    cashu_deps: &CashuDeps,
) -> ReceiveSwapDeps {
    let encryption: Arc<dyn ProofEncryption> = Arc::new(PassthroughProofEncryption);
    let receive_storage: Arc<dyn CashuReceiveSwapStorage> = Arc::new(
        SupabaseCashuReceiveSwapStorage::new(Arc::clone(&storage_deps.storage), encryption),
    );
    let service = Arc::new(CashuReceiveSwapService::new(
        Arc::clone(&receive_storage),
        Arc::clone(&cashu_deps.provider),
    ));
    ReceiveSwapDeps {
        service,
        storage: receive_storage,
    }
}

/// CLI-side dep bundle for the Cashu send flow. Wires the slice-5
/// passthrough encryption stub onto a real Supabase storage and the
/// existing `CashuProvider`.
pub struct SendSwapDeps {
    pub service: Arc<CashuSendSwapService>,
    pub storage: Arc<dyn CashuSendSwapStorage>,
}

impl Clone for SendSwapDeps {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            storage: Arc::clone(&self.storage),
        }
    }
}

impl std::fmt::Debug for SendSwapDeps {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SendSwapDeps").finish_non_exhaustive()
    }
}

/// CLI-side dep bundle for the Cashu Lightning receive (NUT-04 mint quote)
/// flow. Wires the slice-5 passthrough encryption stub onto a real Supabase
/// storage and the existing `CashuProvider`.
pub struct MintQuoteDeps {
    pub service: Arc<CashuMintQuoteService>,
    pub storage: Arc<dyn CashuMintQuoteStorage>,
}

impl Clone for MintQuoteDeps {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            storage: Arc::clone(&self.storage),
        }
    }
}

impl std::fmt::Debug for MintQuoteDeps {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MintQuoteDeps").finish_non_exhaustive()
    }
}

pub fn build_mint_quote_deps(storage_deps: &StorageDeps, cashu_deps: &CashuDeps) -> MintQuoteDeps {
    let encryption: Arc<dyn ProofEncryption> = Arc::new(PassthroughProofEncryption);
    let quote_storage: Arc<dyn CashuMintQuoteStorage> = Arc::new(
        SupabaseCashuMintQuoteStorage::new(Arc::clone(&storage_deps.storage), encryption),
    );
    let service = Arc::new(CashuMintQuoteService::new(
        Arc::clone(&quote_storage),
        Arc::clone(&cashu_deps.provider),
    ));
    MintQuoteDeps {
        service,
        storage: quote_storage,
    }
}

pub fn build_send_swap_deps(storage_deps: &StorageDeps, cashu_deps: &CashuDeps) -> SendSwapDeps {
    let encryption: Arc<dyn ProofEncryption> = Arc::new(PassthroughProofEncryption);
    let send_storage: Arc<dyn CashuSendSwapStorage> = Arc::new(SupabaseCashuSendSwapStorage::new(
        Arc::clone(&storage_deps.storage),
        encryption,
    ));
    let service = Arc::new(CashuSendSwapService::new(
        Arc::clone(&send_storage),
        Arc::clone(&cashu_deps.provider),
    ));
    SendSwapDeps {
        service,
        storage: send_storage,
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
