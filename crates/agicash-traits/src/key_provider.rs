use crate::{AuthError, KeyOptions};
use agicash_crypto::{Mnemonic, PublicKey, SecretKey, Signature, SigningAlgorithm};
use async_trait::async_trait;

#[async_trait]
pub trait KeyProvider: Send + Sync {
    async fn derive_private_key(&self, options: KeyOptions) -> Result<SecretKey, AuthError>;

    async fn derive_public_key(
        &self,
        algorithm: SigningAlgorithm,
        options: KeyOptions,
    ) -> Result<PublicKey, AuthError>;

    async fn sign_message(
        &self,
        message: &[u8],
        algorithm: SigningAlgorithm,
        options: KeyOptions,
    ) -> Result<Signature, AuthError>;

    async fn get_mnemonic(&self) -> Result<Mnemonic, AuthError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    struct DummyProvider;

    #[async_trait]
    impl KeyProvider for DummyProvider {
        async fn derive_private_key(&self, _options: KeyOptions) -> Result<SecretKey, AuthError> {
            Ok(SecretKey::new([0u8; 32]))
        }

        async fn derive_public_key(
            &self,
            _algorithm: SigningAlgorithm,
            _options: KeyOptions,
        ) -> Result<PublicKey, AuthError> {
            Ok(PublicKey::new(vec![], SigningAlgorithm::Schnorr))
        }

        async fn sign_message(
            &self,
            _message: &[u8],
            _algorithm: SigningAlgorithm,
            _options: KeyOptions,
        ) -> Result<Signature, AuthError> {
            Ok(Signature::new(vec![], SigningAlgorithm::Schnorr))
        }

        async fn get_mnemonic(&self) -> Result<Mnemonic, AuthError> {
            Mnemonic::parse(
                "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
            )
            .map_err(|e| AuthError::Internal(e.to_string()))
        }
    }

    #[tokio::test]
    async fn dummy_provider_implements_key_provider() {
        let p = DummyProvider;
        let _ = p.derive_private_key(KeyOptions::default()).await.unwrap();
        let _ = p
            .derive_public_key(SigningAlgorithm::Schnorr, KeyOptions::default())
            .await
            .unwrap();
        let _ = p
            .sign_message(b"hi", SigningAlgorithm::Schnorr, KeyOptions::default())
            .await
            .unwrap();
        let _ = p.get_mnemonic().await.unwrap();
    }
}
