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
use crate::session::{AuthStatus, Session};
use agicash_auth_opensecret::{
    auth_error_from_opensecret, login_email, logout, register_guest, OpenSecretClient,
    OpenSecretConfig, OpenSecretTokenProvider,
};
use agicash_domain::UserId;
use agicash_storage_supabase::{SupabaseStorage, SupabaseStorageConfig};
use agicash_traits::{PersistedSession, TokenProvider, UserStorage};
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

#[derive(uniffi::Object)]
pub struct AgicashWallet {
    client: OpenSecretClient,
    storage: Arc<SupabaseStorage>,
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

        Ok(Arc::new(Self {
            client,
            storage,
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
