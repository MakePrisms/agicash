//! Cashu mint integration trait — abstract seam for the concrete CDK-backed
//! impl that lives in `agicash-cashu`. Higher layers depend on the trait, not
//! the impl, so test code can swap a fake provider.

use agicash_domain::Account;
use async_trait::async_trait;
use cdk::mint_url::MintUrl;
use cdk::nuts::MintInfo;
use cdk::wallet::MintConnector;
use std::sync::Arc;

/// One mint's wallet view — currently just a connector handle and its URL.
/// Future slices add proof storage and minting/melting/swap methods here.
#[derive(Clone)]
pub struct CashuMintWallet {
    client: Arc<dyn MintConnector + Send + Sync>,
    mint_url: MintUrl,
}

impl CashuMintWallet {
    pub fn new(client: Arc<dyn MintConnector + Send + Sync>, mint_url: MintUrl) -> Self {
        Self { client, mint_url }
    }

    pub fn mint_url(&self) -> &MintUrl {
        &self.mint_url
    }

    pub fn connector(&self) -> &Arc<dyn MintConnector + Send + Sync> {
        &self.client
    }
}

impl std::fmt::Debug for CashuMintWallet {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CashuMintWallet")
            .field("mint_url", &self.mint_url)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum CashuProviderError {
    #[error("mint unreachable: {0}")]
    Network(String),
    #[error("invalid mint URL: {0}")]
    InvalidUrl(String),
    #[error("mint protocol error: {0}")]
    Protocol(String),
}

#[async_trait]
pub trait CashuProvider: Send + Sync {
    /// Returns the connector handle for the mint linked to this Cashu account.
    /// Providers cache connectors keyed by mint URL; repeated calls for the
    /// same mint return the same underlying HTTP client.
    ///
    /// Mint URL is extracted from `account.details["mint_url"]` (JSONB).
    async fn wallet_for_account(
        &self,
        account: &Account,
    ) -> Result<Arc<CashuMintWallet>, CashuProviderError>;

    /// Fetches current mint metadata via NUT-06 info endpoint.
    async fn mint_info(&self, mint_url: &MintUrl) -> Result<MintInfo, CashuProviderError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cashu_provider_error_variants_construct() {
        let _ = CashuProviderError::Network("timeout".into());
        let _ = CashuProviderError::InvalidUrl("not-a-url".into());
        let _ = CashuProviderError::Protocol("bad json".into());
    }

    #[test]
    fn cashu_provider_error_is_send_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<CashuProviderError>();
    }
}
