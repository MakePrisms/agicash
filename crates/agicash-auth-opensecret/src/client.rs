use crate::error::auth_error_from_opensecret;
use crate::OpenSecretConfig;
use agicash_traits::AuthError;
use opensecret::OpenSecretClient as OpensecretInner;
use std::sync::Arc;
use tokio::sync::OnceCell;

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
            OpensecretInner::new(config.base_url.clone()).map_err(auth_error_from_opensecret)?;
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

    #[tokio::test]
    async fn handshake_runs_at_most_once() {
        let c = OpenSecretClient::new(fake_cfg()).unwrap();
        let r1 = c.ensure_handshake().await;
        let r2 = c.ensure_handshake().await;
        assert!(r1.is_err());
        assert!(r2.is_err());
    }
}
