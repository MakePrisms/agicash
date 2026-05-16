use crate::error::auth_error_from_opensecret;
use crate::OpenSecretConfig;
use agicash_traits::AuthError;
use bip39::{Language, Mnemonic};
use opensecret::types::KeyOptions;
use opensecret::OpenSecretClient as OpensecretInner;
use std::sync::Arc;
use tokio::sync::OnceCell;

/// BIP-85 derivation path the web app uses for the Cashu BIP-39 child seed.
///
/// The TS-side source-of-truth is
/// `app/features/accounts/account-cryptography.ts` →
/// `getSeedPhraseDerivationPath('cashu', 12)` which renders the path
/// `m/83696968'/39'/0'/12'/0'`:
///   - `83696968` — BIP-85 application root (`SEED` in ASCII).
///   - `39`       — BIP-39 application id (mnemonic seed words).
///   - `0`        — English wordlist.
///   - `12`       — 12-word phrase.
///   - `0`        — Cashu index (Spark uses `1`).
///
/// DO NOT CHANGE without rotating every user's stored Cashu xpub.
const CASHU_SEED_DERIVATION_PATH: &str = "m/83696968'/39'/0'/12'/0'";

#[derive(Clone)]
pub struct OpenSecretClient {
    inner: Arc<OpensecretInner>,
    handshake: Arc<OnceCell<()>>,
    config: OpenSecretConfig,
}

impl std::fmt::Debug for OpenSecretClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // The opensecret client (`inner`) doesn't implement Debug, so we
        // intentionally omit it and mark the struct as non-exhaustive.
        f.debug_struct("OpenSecretClient")
            .field("config", &self.config)
            .field("handshake_completed", &self.handshake.initialized())
            .finish_non_exhaustive()
    }
}

impl OpenSecretClient {
    pub fn new(config: OpenSecretConfig) -> Result<Self, AuthError> {
        let inner =
            OpensecretInner::new_with_user_agent(config.base_url.clone(), "agicash-cli/0.1")
                .map_err(auth_error_from_opensecret)?;
        Ok(Self {
            inner: Arc::new(inner),
            handshake: Arc::new(OnceCell::new()),
            config,
        })
    }

    pub async fn ensure_handshake(&self) -> Result<(), AuthError> {
        self.handshake
            .get_or_try_init(|| async {
                self.inner
                    .perform_attestation_handshake()
                    .await
                    .map_err(auth_error_from_opensecret)
            })
            .await?;
        Ok(())
    }

    #[must_use]
    pub fn inner(&self) -> &OpensecretInner {
        &self.inner
    }

    #[must_use]
    pub fn client_id(&self) -> uuid::Uuid {
        self.config.client_id
    }

    /// Returns the 64-byte BIP-39 seed derived for the Cashu wallet.
    ///
    /// The seed is the source for the per-keyset blinding factors and
    /// secrets that NUT-13 / NUT-03 require. Open Secret derives a child
    /// 12-word mnemonic via BIP-85 at [`CASHU_SEED_DERIVATION_PATH`], then
    /// this method converts that mnemonic to a seed with an empty passphrase
    /// (matching the TS web app's `mnemonicToSeedSync(response.mnemonic)`).
    ///
    /// Requires an active session: `inner().get_private_key` calls a
    /// protected endpoint and returns
    /// [`AuthError::Unauthenticated`]-shaped errors if there is none.
    pub async fn get_cashu_seed(&self) -> Result<[u8; 64], AuthError> {
        let response = self
            .inner
            .get_private_key(Some(KeyOptions {
                seed_phrase_derivation_path: Some(CASHU_SEED_DERIVATION_PATH.to_string()),
                private_key_derivation_path: None,
            }))
            .await
            .map_err(auth_error_from_opensecret)?;
        let mnemonic = Mnemonic::parse_in(Language::English, &response.mnemonic).map_err(|e| {
            AuthError::Internal(format!("invalid cashu mnemonic from open secret: {e}"))
        })?;
        Ok(mnemonic.to_seed_normalized(""))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn fake_cfg() -> OpenSecretConfig {
        OpenSecretConfig {
            base_url: "https://does-not-resolve-agicash.invalid".to_string(),
            client_id: Uuid::nil(),
        }
    }

    #[tokio::test]
    async fn client_constructs_without_network() {
        let c = OpenSecretClient::new(fake_cfg()).unwrap();
        let _ = c.inner();
    }

    // tokio::OnceCell does not cache errors; failed handshakes retry on the next call.
    // This is intentional — transient network issues should not permanently block auth.
    // If the URL eventually resolves, the first successful call latches.
    #[tokio::test]
    async fn handshake_retries_after_failure() {
        let c = OpenSecretClient::new(fake_cfg()).unwrap();
        let r1 = c.ensure_handshake().await;
        let r2 = c.ensure_handshake().await;
        assert!(r1.is_err());
        assert!(r2.is_err());
    }

    #[tokio::test]
    async fn get_cashu_seed_without_session_returns_error() {
        // No session is initialized, and the URL is unresolvable, so the
        // protected call must fail. This test asserts the surface: an error,
        // not a panic.
        let c = OpenSecretClient::new(fake_cfg()).unwrap();
        let result = c.get_cashu_seed().await;
        assert!(result.is_err(), "expected error without session");
    }
}
