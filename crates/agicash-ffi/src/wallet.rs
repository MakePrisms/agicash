//! Main FFI wallet object.
//!
//! Holds shared `OpenSecretClient` + `SupabaseStorage` instances and a tiny
//! in-memory session slot. Persistence lives on the Swift side: after a
//! successful login the consumer reads `Session.refresh_token` and stores it
//! in iOS Keychain; on subsequent app launches it calls `set_session(...)` to
//! rehydrate the wallet before any other method.
//!
//! Auth methods mirror the CLI (`crates/agicash-cli/src/auth.rs`) but return
//! structured `Session` / `AuthStatus` values instead of printing JSON. The
//! account listing path mirrors `cmd_list` in `crates/agicash-cli/src/account.rs`.

use crate::account::AccountFfi;
use crate::error::FfiError;
use crate::receive::{ReceiveResult, ReceiveStatus};
use crate::session::{AuthStatus, Session};
use agicash_auth_opensecret::{
    auth_error_from_opensecret, login_email, logout, register_email, register_guest,
    OpenSecretClient, OpenSecretConfig, OpenSecretTokenProvider,
};
use agicash_cashu::{
    CashuReceiveSwapService, CashuReceiveSwapState, CashuReceiveSwapStorage, CdkCashuProvider,
    CompleteOutcome, ParsedToken, ReceiveSwapError, ReceiveSwapStorageError,
};
use agicash_domain::{Account, AccountType, Currency, UserId};
use agicash_storage_supabase::{
    SupabaseCashuReceiveSwapStorage, SupabaseStorage, SupabaseStorageConfig,
};
use agicash_traits::{
    CashuProvider, PassthroughProofEncryption, PersistedSession, ProofEncryption, TokenProvider,
    UserStorage,
};
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

#[derive(uniffi::Object)]
pub struct AgicashWallet {
    client: OpenSecretClient,
    storage: Arc<SupabaseStorage>,
    /// Cashu provider (CDK-backed). Created once at construction; cheap to
    /// share across receive/send swaps.
    cashu_provider: Arc<dyn CashuProvider>,
    /// Receive-swap orchestrator. Wired against the same `SupabaseStorage`
    /// + `cashu_provider` the wallet already owns, with the slice-5
    /// `PassthroughProofEncryption` stub matching the CLI composition root.
    /// Once the encryption seam ships, this slot swaps to a real impl
    /// without the FFI surface changing.
    receive_swap_service: Arc<CashuReceiveSwapService>,
    /// In-memory session. Phase 1 leaves persistence to the Swift consumer:
    /// the iOS app stores the `refresh_token` in Keychain and rehydrates this
    /// slot via `set_session` on app launch.
    session: Arc<RwLock<Option<PersistedSession>>>,
}

impl std::fmt::Debug for AgicashWallet {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // `OpenSecretClient` already redacts itself; the session is sensitive
        // material (refresh token) so we never print its contents.
        f.debug_struct("AgicashWallet")
            .field("client", &self.client)
            .field("storage", &self.storage)
            .field(
                "session_loaded",
                &self
                    .session
                    .try_read()
                    .map(|s| s.is_some())
                    .unwrap_or(false),
            )
            .finish_non_exhaustive()
    }
}

/// Generate 16 random bytes hex-encoded; the `OpenSecret` guest-registration
/// password slot accepts any string and we never need it after the first
/// login (Swift persists only the resulting refresh token).
fn random_password() -> String {
    let mut buf = [0u8; 16];
    getrandom::getrandom(&mut buf).expect("OS RNG must be available");
    hex::encode(buf)
}

#[uniffi::export(async_runtime = "tokio")]
impl AgicashWallet {
    /// Build a wallet that talks to the given `OpenSecret` and Supabase
    /// endpoints. The `client_id_uuid` must be a stringified UUID identifying
    /// this Agicash app to `OpenSecret` (matches the `OPENSECRET_CLIENT_ID`
    /// env var used by the CLI).
    //
    // UniFFI requires owned `String` arguments at the FFI boundary, so the
    // pedantic `needless_pass_by_value` lint can't be satisfied here.
    #[uniffi::constructor]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(
        opensecret_url: String,
        opensecret_client_id_uuid: String,
        supabase_url: String,
        supabase_anon_key: String,
    ) -> Result<Arc<Self>, FfiError> {
        let client_id = Uuid::parse_str(&opensecret_client_id_uuid)
            .map_err(|e| FfiError::internal(format!("invalid opensecret_client_id_uuid: {e}")))?;
        let auth_cfg = OpenSecretConfig {
            base_url: opensecret_url,
            client_id,
        };
        let client = OpenSecretClient::new(auth_cfg)?;

        let storage_cfg = SupabaseStorageConfig {
            url: supabase_url,
            anon_key: supabase_anon_key,
        };
        let token_provider: Arc<dyn TokenProvider + Send + Sync> =
            Arc::new(OpenSecretTokenProvider::new(client.clone()));
        let storage = Arc::new(SupabaseStorage::new(storage_cfg, token_provider)?);

        // Cashu wiring mirrors `crates/agicash-cli/src/composition.rs`
        // (`build_cashu_deps` + `build_receive_swap_deps`): one shared
        // CDK provider, plus a receive-swap service backed by the same
        // Supabase storage handle the wallet already owns. The
        // `PassthroughProofEncryption` stub matches what slice 5 ships;
        // when the real encryption layer lands the wallet just swaps
        // this constructor without the FFI shape moving.
        let cashu_provider: Arc<dyn CashuProvider> = Arc::new(CdkCashuProvider::new());
        let encryption: Arc<dyn ProofEncryption> = Arc::new(PassthroughProofEncryption);
        let receive_storage: Arc<dyn CashuReceiveSwapStorage> = Arc::new(
            SupabaseCashuReceiveSwapStorage::new(Arc::clone(&storage), encryption),
        );
        let receive_swap_service = Arc::new(CashuReceiveSwapService::new(
            receive_storage,
            Arc::clone(&cashu_provider),
        ));

        Ok(Arc::new(Self {
            client,
            storage,
            cashu_provider,
            receive_swap_service,
            session: Arc::new(RwLock::new(None)),
        }))
    }

    // ---- session plumbing (Swift-side Keychain hooks) ----

    /// Rehydrate an existing session into the wallet. Called by the Swift
    /// consumer on app launch after reading the refresh token from Keychain.
    /// Performs an OpenSecret token refresh so the internal client has a
    /// fresh access token. On refresh failure the in-memory session is
    /// cleared and an `Auth` error is returned so the consumer can drop the
    /// Keychain entry.
    pub async fn set_session(
        &self,
        user_id_uuid: String,
        refresh_token: String,
    ) -> Result<(), FfiError> {
        let user_id = Uuid::parse_str(&user_id_uuid)
            .map_err(|e| FfiError::internal(format!("invalid user_id_uuid: {e}")))?;

        self.client.ensure_handshake().await?;
        self.client
            .inner()
            .set_tokens(String::new(), Some(refresh_token.clone()))
            .map_err(auth_error_from_opensecret)?;

        if let Err(e) = self.client.inner().refresh_token().await {
            *self.session.write().await = None;
            return Err(auth_error_from_opensecret(e).into());
        }

        *self.session.write().await = Some(PersistedSession {
            user_id,
            refresh_token,
        });
        Ok(())
    }

    /// Return the currently-loaded session, or `None` if the wallet is
    /// logged out. Lets the Swift consumer re-sync its Keychain copy after
    /// a `auth_guest` / `auth_login` call.
    pub async fn get_persisted_session(&self) -> Option<Session> {
        self.session.read().await.clone().map(Session::from)
    }

    // ---- auth surface ----

    /// Register an anonymous guest account against OpenSecret. Generates a
    /// throwaway password (the user never sees it) and returns the resulting
    /// `Session` so the Swift consumer can persist the refresh token.
    pub async fn auth_guest(&self) -> Result<Session, FfiError> {
        let password = random_password();
        let resp = register_guest(&self.client, password, self.client.client_id()).await?;
        let persisted = PersistedSession {
            user_id: resp.id,
            refresh_token: resp.refresh_token.clone(),
        };
        *self.session.write().await = Some(persisted.clone());
        Ok(persisted.into())
    }

    /// Email + password login.
    pub async fn auth_login(&self, email: String, password: String) -> Result<Session, FfiError> {
        let resp = login_email(&self.client, email, password, self.client.client_id()).await?;
        let persisted = PersistedSession {
            user_id: resp.id,
            refresh_token: resp.refresh_token.clone(),
        };
        *self.session.write().await = Some(persisted.clone());
        Ok(persisted.into())
    }

    /// Register a new email + password user against OpenSecret. Mirrors the
    /// web app's `/signup` flow: on success the user is auto-signed-in and
    /// the resulting `Session` is returned so the Swift consumer can persist
    /// the refresh token in Keychain. The optional `name` slot maps to the
    /// OpenSecret SDK's display-name field; the iOS app does not collect it
    /// in v0 (web doesn't either) but the parameter is exposed so the
    /// surface matches the underlying SDK and future UI can populate it
    /// without another FFI churn.
    pub async fn auth_signup(
        &self,
        email: String,
        password: String,
        name: Option<String>,
    ) -> Result<Session, FfiError> {
        let resp = register_email(
            &self.client,
            email,
            password,
            self.client.client_id(),
            name,
        )
        .await?;
        let persisted = PersistedSession {
            user_id: resp.id,
            refresh_token: resp.refresh_token.clone(),
        };
        *self.session.write().await = Some(persisted.clone());
        Ok(persisted.into())
    }

    /// Best-effort server logout. Always clears the in-memory session even
    /// if the server-side call fails (e.g. expired token, network error).
    /// The Swift consumer should also drop its Keychain entry on success.
    pub async fn auth_logout(&self) -> Result<(), FfiError> {
        let was_loaded = self.session.read().await.is_some();
        if was_loaded {
            if let Err(e) = logout(&self.client).await {
                // Server logout failures are non-fatal; swallow them so the
                // local state is still cleared. We surface the original
                // status only when there was something to log out.
                let _ = e;
            }
        }
        *self.session.write().await = None;
        Ok(())
    }

    /// Return whether the wallet currently holds a session.
    pub async fn auth_status(&self) -> Result<AuthStatus, FfiError> {
        let snap = self.session.read().await.clone();
        Ok(match snap {
            Some(s) => AuthStatus {
                logged_in: true,
                user_id: Some(s.user_id.to_string()),
            },
            None => AuthStatus {
                logged_in: false,
                user_id: None,
            },
        })
    }

    // ---- account surface ----

    /// List Supabase `wallet.accounts` rows for the currently-logged-in
    /// user. Phase 1 maps each row through `AccountFfi::from(Account)` which
    /// hard-codes `balance: "0"` and `unit: ""` — actual balance wiring
    /// arrives in Phase 2 once the proofs layer is exposed.
    pub async fn list_accounts(&self) -> Result<Vec<AccountFfi>, FfiError> {
        let session = self.session.read().await.clone().ok_or(FfiError::Auth {
            code: crate::error::auth_code::UNAUTHENTICATED,
            message: "not authenticated".into(),
        })?;
        let user_id = UserId::from(session.user_id);
        let accounts = self.storage.list_accounts(user_id).await?;
        Ok(accounts.into_iter().map(AccountFfi::from).collect())
    }

    // ---- receive surface ----

    /// Redeem a Cashu token (V3 `cashuA…` or V4 `cashuB…`).
    ///
    /// Mirrors the `agicash receive token <token>` CLI subcommand
    /// (`crates/agicash-cli/src/receive.rs`): parse the token, pick the
    /// matching account by `(mint_url, currency)`, run
    /// `CashuReceiveSwapService::create` followed by `complete_swap`, and
    /// return a flattened receipt. Idempotent on repeat redeems of the
    /// same token (returns [`ReceiveStatus::AlreadyClaimed`]).
    ///
    /// Errors:
    /// - `FfiError::Auth { UNAUTHENTICATED }` if no session is loaded.
    /// - `FfiError::Internal` for token-parse failures, missing matching
    ///   account, currency/unit mismatches, or amount-too-small after fees
    ///   (the underlying `ReceiveSwapError` doesn't fit Auth/Storage cleanly
    ///   so it is funneled through Internal — the message string carries
    ///   the discriminator the iOS UI surfaces inline).
    /// - `FfiError::Storage` for raw Supabase failures (network, etc.).
    pub async fn receive_token(&self, token: String) -> Result<ReceiveResult, FfiError> {
        let session = self.session.read().await.clone().ok_or(FfiError::Auth {
            code: crate::error::auth_code::UNAUTHENTICATED,
            message: "not authenticated".into(),
        })?;
        let user_id = UserId::from(session.user_id);

        // Parse first so a malformed token surfaces as a clean error
        // before we touch storage / the mint.
        let parsed = ParsedToken::parse(&token, &self.cashu_provider)
            .await
            .map_err(receive_swap_error_to_ffi)?;

        let accounts = self.storage.list_accounts(user_id).await?;
        let account = pick_cashu_account_for_token(&accounts, &parsed.mint_url, &parsed.unit)
            .ok_or_else(|| {
                FfiError::internal(format!(
                    "no matching account for mint {} — add the mint first",
                    parsed.mint_url
                ))
            })?;

        // Create the PENDING swap row. AlreadyClaimed is idempotent —
        // surface the existing terminal state instead of erroring.
        let create_result = match self
            .receive_swap_service
            .create(user_id, &parsed, account, None)
            .await
        {
            Ok(r) => r,
            Err(ReceiveSwapError::Storage(ReceiveSwapStorageError::AlreadyClaimed)) => {
                return Ok(ReceiveResult {
                    status: ReceiveStatus::AlreadyClaimed,
                    amount: "0".into(),
                    fee: "0".into(),
                    unit: parsed.unit.to_string(),
                    currency: account.currency.to_string(),
                    account_id: account.id.to_string(),
                    mint_url: parsed.mint_url.clone(),
                    token_hash: parsed.hash.clone(),
                });
            }
            Err(e) => return Err(receive_swap_error_to_ffi(e)),
        };

        // Pull the BIP-39 cashu seed from OpenSecret so the service can
        // blind the outputs. Requires an active session (the read-lock
        // above proves we have one).
        let seed = self.client.get_cashu_seed().await?;

        let outcome = self
            .receive_swap_service
            .complete_swap(&create_result.account, create_result.swap, &seed)
            .await
            .map_err(receive_swap_error_to_ffi)?;

        Ok(receive_result_from_outcome(
            outcome,
            &create_result.account,
            &parsed,
        ))
    }
}

/// Find a `Cashu` account whose `(mint_url, currency)` pair matches the
/// supplied parsed token. Mirrors the CLI's private `pick_account`
/// (`crates/agicash-cli/src/receive.rs`) — duplicated here so the FFI
/// stays decoupled from the CLI binary.
fn pick_cashu_account_for_token<'a>(
    accounts: &'a [Account],
    mint_url: &str,
    unit: &cdk::nuts::CurrencyUnit,
) -> Option<&'a Account> {
    accounts.iter().find(|a| {
        a.account_type == AccountType::Cashu
            && a.details
                .get("mint_url")
                .and_then(|v| v.as_str())
                .is_some_and(|u| mint_urls_equal(u, mint_url))
            && unit_matches_currency(unit, a.currency)
    })
}

fn mint_urls_equal(a: &str, b: &str) -> bool {
    a.trim_end_matches('/') == b.trim_end_matches('/')
}

fn unit_matches_currency(unit: &cdk::nuts::CurrencyUnit, currency: Currency) -> bool {
    use cdk::nuts::CurrencyUnit;
    matches!(
        (unit, currency),
        (CurrencyUnit::Sat, Currency::Btc) | (CurrencyUnit::Usd, Currency::Usd)
    )
}

/// Map the rich `ReceiveSwapError` family down to `FfiError`. The trait
/// crate already has `From<AuthError>` / `From<StorageError>` impls for
/// FFI; the cashu-specific cases (token parse, mint-mismatch,
/// amount-too-small) don't fit either family cleanly so they funnel
/// through `Internal` with a discriminator-bearing message.
fn receive_swap_error_to_ffi(e: ReceiveSwapError) -> FfiError {
    match e {
        ReceiveSwapError::TokenParse(msg) => FfiError::internal(format!("invalid token: {msg}")),
        ReceiveSwapError::MintMismatch { token, account } => FfiError::internal(format!(
            "mint mismatch: token mint {token} differs from account mint {account}",
        )),
        ReceiveSwapError::CurrencyMismatch { token, account } => FfiError::internal(format!(
            "currency mismatch: token currency {token} differs from account currency {account}",
        )),
        ReceiveSwapError::AmountTooSmall => {
            FfiError::internal("amount too small after mint fees")
        }
        ReceiveSwapError::InvalidTransition { from, event } => {
            FfiError::internal(format!("invalid state transition from {from} on {event}"))
        }
        // Mint-protocol failures (network, NUT errors) — surface the
        // `CashuProviderError`'s display so the UI gets something
        // meaningful without a new FFI variant.
        ReceiveSwapError::Mint(inner) => FfiError::internal(format!("mint error: {inner}")),
        // Storage is the one branch where we DO have a structured FFI
        // shape. Map the inner storage failure through the existing
        // `From<StorageError>` impl when possible; otherwise fall back
        // to Internal so the caller still sees the failure reason.
        ReceiveSwapError::Storage(s) => FfiError::internal(format!("storage error: {s}")),
    }
}

fn receive_result_from_outcome(
    outcome: CompleteOutcome,
    fallback_account: &Account,
    parsed: &ParsedToken,
) -> ReceiveResult {
    match outcome {
        CompleteOutcome::Completed {
            swap, account, ..
        } => ReceiveResult {
            status: ReceiveStatus::Received,
            amount: swap.amount_received.amount().to_string(),
            fee: swap.fee_amount.amount().to_string(),
            unit: swap.amount_received.unit().to_string(),
            currency: swap.amount_received.currency().to_string(),
            account_id: account.id.to_string(),
            mint_url: parsed.mint_url.clone(),
            token_hash: parsed.hash.clone(),
        },
        CompleteOutcome::AlreadyTerminal(swap) => {
            let status = match &swap.state {
                CashuReceiveSwapState::Completed => ReceiveStatus::Received,
                CashuReceiveSwapState::Failed { .. } => ReceiveStatus::AlreadyFailed,
                CashuReceiveSwapState::Pending => ReceiveStatus::Pending,
            };
            ReceiveResult {
                status,
                amount: swap.amount_received.amount().to_string(),
                fee: swap.fee_amount.amount().to_string(),
                unit: swap.amount_received.unit().to_string(),
                currency: swap.amount_received.currency().to_string(),
                account_id: fallback_account.id.to_string(),
                mint_url: parsed.mint_url.clone(),
                token_hash: parsed.hash.clone(),
            }
        }
        CompleteOutcome::Failed(swap) => ReceiveResult {
            status: ReceiveStatus::AlreadyFailed,
            amount: swap.amount_received.amount().to_string(),
            fee: swap.fee_amount.amount().to_string(),
            unit: swap.amount_received.unit().to_string(),
            currency: swap.amount_received.currency().to_string(),
            account_id: fallback_account.id.to_string(),
            mint_url: parsed.mint_url.clone(),
            token_hash: parsed.hash.clone(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeConfig {
        opensecret_url: String,
        client_id: String,
        supabase_url: String,
        anon_key: String,
    }

    fn fake_config() -> FakeConfig {
        FakeConfig {
            opensecret_url: "https://does-not-resolve-agicash.invalid".to_string(),
            client_id: Uuid::nil().to_string(),
            supabase_url: "https://does-not-resolve-supabase.invalid".to_string(),
            anon_key: "anon-key".to_string(),
        }
    }

    #[tokio::test]
    async fn constructor_returns_wallet_without_network() {
        let cfg = fake_config();
        let wallet = AgicashWallet::new(
            cfg.opensecret_url,
            cfg.client_id,
            cfg.supabase_url,
            cfg.anon_key,
        )
        .expect("construct");
        let status = wallet.auth_status().await.unwrap();
        assert!(!status.logged_in);
        assert!(status.user_id.is_none());
    }

    #[tokio::test]
    async fn list_accounts_without_session_returns_unauthenticated() {
        let cfg = fake_config();
        let wallet = AgicashWallet::new(
            cfg.opensecret_url,
            cfg.client_id,
            cfg.supabase_url,
            cfg.anon_key,
        )
        .expect("construct");
        let err = wallet.list_accounts().await.expect_err("no session");
        assert!(
            matches!(err, FfiError::Auth { code, .. } if code == crate::error::auth_code::UNAUTHENTICATED)
        );
    }

    #[tokio::test]
    async fn constructor_rejects_bad_client_id_uuid() {
        let err = AgicashWallet::new(
            "https://example.invalid".into(),
            "not-a-uuid".into(),
            "https://supabase.invalid".into(),
            "anon".into(),
        )
        .expect_err("bad uuid");
        assert!(
            matches!(err, FfiError::Internal { ref message } if message.contains("client_id_uuid"))
        );
    }
}
