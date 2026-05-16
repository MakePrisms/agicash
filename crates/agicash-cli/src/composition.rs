#[cfg(feature = "keyring-storage")]
use agicash_auth_opensecret::KeyringSessionStorage;
use agicash_auth_opensecret::{
    InMemorySessionStorage, OpenSecretClient, OpenSecretConfig, OpenSecretTokenProvider,
    DEFAULT_SERVICE,
};
use agicash_cashu::{
    CashuMeltQuoteService, CashuMeltQuoteStorage, CashuMintQuoteService, CashuMintQuoteStorage,
    CashuReceiveSwapService, CashuReceiveSwapStorage, CashuSendSwapService, CashuSendSwapStorage,
    CdkCashuProvider,
};
use agicash_exchange_rate::MempoolSpaceProvider;
use agicash_storage_supabase::{
    SupabaseCashuMeltQuoteStorage, SupabaseCashuMintQuoteStorage, SupabaseCashuReceiveSwapStorage,
    SupabaseCashuSendSwapStorage, SupabaseStorage, SupabaseStorageConfig,
};
use agicash_traits::{
    AuthError, CashuProvider, PassthroughProofEncryption, ProofEncryption, SessionStorage,
    StorageError, TokenProvider,
};
use std::sync::Arc;

#[derive(Clone)]
pub struct AuthDeps {
    pub client: OpenSecretClient,
    pub storage: Arc<dyn SessionStorage>,
}

impl std::fmt::Debug for AuthDeps {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AuthDeps")
            .field("client", &self.client)
            .finish_non_exhaustive()
    }
}

/// Build the auth dep bundle, selecting a session-storage backend via a
/// fallback chain so the CLI works on every supported target/use-case.
///
/// Selection order (highest priority first):
/// 1. `AGICASH_SESSION_FILE` env var or `--session-file` flag —
///    encrypted-file backend (stubbed; returns a clear error today; will
///    ship in the file-backed storage follow-up slice).
/// 2. OS keyring via [`KeyringSessionStorage`] when the
///    `keyring-storage` cargo feature is on AND the backend is reachable
///    at runtime. On `BackendUnavailable` we drop down to (3) with a
///    stderr warning.
/// 3. [`InMemorySessionStorage`] — always available. Sessions don't
///    survive process exit; the user is warned on stderr.
///
/// Pseudo-code:
/// ```text
/// if has_session_file():
///     return file_backend()  // currently stubbed
/// if cfg!(keyring-storage):
///     match try_probe_keyring():
///         Ok(_)                  => return keyring_backend()
///         Err(BackendUnavailable) => warn(stderr); fall through
///         Err(other)             => warn(stderr); fall through
/// return in_memory_backend()  // always available
/// ```
pub async fn build_auth_deps() -> Result<AuthDeps, AuthError> {
    let config = OpenSecretConfig::from_env()?;
    let client = OpenSecretClient::new(config)?;
    let storage = build_session_storage().await;
    Ok(AuthDeps { client, storage })
}

/// Resolve a [`SessionStorage`] backend via the fallback chain documented
/// on [`build_auth_deps`].
async fn build_session_storage() -> Arc<dyn SessionStorage> {
    // (1) Explicit user override → encrypted file backend.
    if let Ok(path) = std::env::var("AGICASH_SESSION_FILE") {
        eprintln!(
            "note: --session-file/AGICASH_SESSION_FILE set ({path}); \
             the encrypted-file backend is not yet implemented in this build. \
             Falling back to in-memory storage; sessions will not persist."
        );
        return Arc::new(InMemorySessionStorage::new());
    }

    // (2) OS keyring when feature-compiled AND runtime-reachable.
    #[cfg(feature = "keyring-storage")]
    {
        let service = std::env::var("AGICASH_KEYRING_SERVICE")
            .unwrap_or_else(|_| DEFAULT_SERVICE.to_string());
        let keyring = KeyringSessionStorage::new(service);
        match probe_keyring(&keyring).await {
            Ok(()) => return Arc::new(keyring),
            Err(reason) => {
                eprintln!(
                    "note: secure keyring unavailable ({reason}); \
                     session will not persist across runs"
                );
            }
        }
    }
    #[cfg(not(feature = "keyring-storage"))]
    {
        // Reference the const so the import isn't flagged as unused when
        // the keyring feature is off.
        let _ = DEFAULT_SERVICE;
    }

    // (3) Always-available fallback.
    Arc::new(InMemorySessionStorage::new())
}

/// Probe the keyring backend by attempting a `load`. Returns `Err` when
/// the backend is unreachable; treats "no entry" / `Ok(None)` as success
/// (the backend works, the user just isn't signed in yet).
#[cfg(feature = "keyring-storage")]
async fn probe_keyring(storage: &KeyringSessionStorage) -> Result<(), String> {
    match storage.load().await {
        Ok(_) => Ok(()),
        Err(AuthError::Backend(msg)) if msg.contains("session backend unavailable") => Err(msg),
        Err(e) => Err(e.to_string()),
    }
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

/// CLI-side dep bundle for the Cashu Lightning send (NUT-05 melt quote)
/// flow. Wires the slice-5 passthrough encryption stub onto a real
/// Supabase storage and the existing `CashuProvider`.
pub struct MeltQuoteDeps {
    pub service: Arc<CashuMeltQuoteService>,
    pub storage: Arc<dyn CashuMeltQuoteStorage>,
}

impl Clone for MeltQuoteDeps {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            storage: Arc::clone(&self.storage),
        }
    }
}

impl std::fmt::Debug for MeltQuoteDeps {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MeltQuoteDeps").finish_non_exhaustive()
    }
}

pub fn build_melt_quote_deps(storage_deps: &StorageDeps, cashu_deps: &CashuDeps) -> MeltQuoteDeps {
    let encryption: Arc<dyn ProofEncryption> = Arc::new(PassthroughProofEncryption);
    let quote_storage: Arc<dyn CashuMeltQuoteStorage> = Arc::new(
        SupabaseCashuMeltQuoteStorage::new(Arc::clone(&storage_deps.storage), encryption),
    );
    let service = Arc::new(CashuMeltQuoteService::new(
        Arc::clone(&quote_storage),
        Arc::clone(&cashu_deps.provider),
    ));
    MeltQuoteDeps {
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
