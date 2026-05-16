use crate::error::auth_error_from_opensecret;
use crate::OpenSecretClient;
use agicash_crypto::{Mnemonic, PublicKey, SecretKey, Signature, SigningAlgorithm};
use agicash_traits::{AuthError, KeyOptions, KeyProvider};
use async_trait::async_trait;
use base64::Engine;

/// Convert our [`KeyOptions`] into the opensecret SDK's equivalent.
///
/// Orphan rules block a `From` impl here, so impls call this helper instead.
#[must_use]
pub fn key_options_to_opensecret(ours: KeyOptions) -> opensecret::KeyOptions {
    opensecret::KeyOptions {
        private_key_derivation_path: ours.private_key_derivation_path,
        seed_phrase_derivation_path: ours.seed_phrase_derivation_path,
    }
}

/// Convert our [`SigningAlgorithm`] into the opensecret SDK's equivalent.
#[must_use]
pub fn signing_algorithm_to_opensecret(a: SigningAlgorithm) -> opensecret::SigningAlgorithm {
    match a {
        SigningAlgorithm::Schnorr => opensecret::SigningAlgorithm::Schnorr,
        SigningAlgorithm::Ecdsa => opensecret::SigningAlgorithm::Ecdsa,
    }
}

#[derive(Debug, Clone)]
pub struct OpenSecretKeyProvider {
    client: OpenSecretClient,
}

impl OpenSecretKeyProvider {
    #[must_use]
    pub fn new(client: OpenSecretClient) -> Self {
        Self { client }
    }
}

// `KeyProvider: Send + Sync` is incompatible with wasm's reqwest (futures
// hold `Rc<...>` / `wasm_bindgen::Closure<dyn FnMut + 'static>` which are
// `!Send`). The trait is `?Send` on wasm, but `async_trait` on the impl
// expands to a `Send` future by default. Per the WASM worker's report,
// browser callers should reach for inherent methods on `OpenSecretClient`
// until a wasm-shim provider lands (slice 13b).
#[cfg(not(target_arch = "wasm32"))]
#[async_trait]
impl KeyProvider for OpenSecretKeyProvider {
    async fn derive_private_key(&self, options: KeyOptions) -> Result<SecretKey, AuthError> {
        self.client.ensure_handshake().await?;
        let resp = self
            .client
            .inner()
            .get_private_key_bytes(Some(key_options_to_opensecret(options)))
            .await
            .map_err(auth_error_from_opensecret)?;
        SecretKey::try_from_hex(&resp.private_key)
            .map_err(|e| AuthError::Backend(format!("decode private_key: {e}")))
    }

    async fn derive_public_key(
        &self,
        algorithm: SigningAlgorithm,
        options: KeyOptions,
    ) -> Result<PublicKey, AuthError> {
        self.client.ensure_handshake().await?;
        let resp = self
            .client
            .inner()
            .get_public_key(
                signing_algorithm_to_opensecret(algorithm),
                Some(key_options_to_opensecret(options)),
            )
            .await
            .map_err(auth_error_from_opensecret)?;
        let bytes = hex::decode(&resp.public_key)
            .map_err(|e| AuthError::Backend(format!("decode public_key: {e}")))?;
        Ok(PublicKey::new(bytes, algorithm))
    }

    async fn sign_message(
        &self,
        message: &[u8],
        algorithm: SigningAlgorithm,
        options: KeyOptions,
    ) -> Result<Signature, AuthError> {
        self.client.ensure_handshake().await?;
        let resp = self
            .client
            .inner()
            .sign_message(
                message,
                signing_algorithm_to_opensecret(algorithm),
                Some(key_options_to_opensecret(options)),
            )
            .await
            .map_err(auth_error_from_opensecret)?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&resp.signature)
            .map_err(|e| AuthError::Backend(format!("decode signature: {e}")))?;
        Ok(Signature::new(bytes, algorithm))
    }

    async fn get_mnemonic(&self) -> Result<Mnemonic, AuthError> {
        self.client.ensure_handshake().await?;
        let resp = self
            .client
            .inner()
            .get_private_key(None)
            .await
            .map_err(auth_error_from_opensecret)?;
        Mnemonic::parse(&resp.mnemonic).map_err(|e| AuthError::Backend(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_options_converts_to_opensecret() {
        let ours = KeyOptions {
            private_key_derivation_path: Some("m/0'/0".into()),
            seed_phrase_derivation_path: Some("m/44'/0'/0'".into()),
        };
        let theirs = key_options_to_opensecret(ours);
        assert_eq!(
            theirs.private_key_derivation_path.as_deref(),
            Some("m/0'/0")
        );
        assert_eq!(
            theirs.seed_phrase_derivation_path.as_deref(),
            Some("m/44'/0'/0'")
        );
    }

    #[test]
    fn signing_algorithm_converts_to_opensecret() {
        let s = signing_algorithm_to_opensecret(SigningAlgorithm::Schnorr);
        let _ = matches!(s, opensecret::SigningAlgorithm::Schnorr);
    }

    #[allow(dead_code)]
    async fn _provider_satisfies_trait(client: OpenSecretClient) {
        let p = OpenSecretKeyProvider::new(client);
        let _: Result<SecretKey, AuthError> = p.derive_private_key(KeyOptions::default()).await;
        let _: Result<PublicKey, AuthError> = p
            .derive_public_key(SigningAlgorithm::Schnorr, KeyOptions::default())
            .await;
        let _: Result<Signature, AuthError> = p
            .sign_message(b"hi", SigningAlgorithm::Schnorr, KeyOptions::default())
            .await;
        let _: Result<Mnemonic, AuthError> = p.get_mnemonic().await;
    }
}
