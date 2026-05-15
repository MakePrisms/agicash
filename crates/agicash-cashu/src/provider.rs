//! CDK-backed [`CashuProvider`] implementation.
//!
//! Caches one [`HttpClient`] per mint URL via a `parking_lot::RwLock<HashMap>`
//! with double-checked locking on the read path so the hot case takes only a
//! reader lock.

use crate::error::{map_cdk_error, map_url_error};
use agicash_domain::Account;
use agicash_traits::{CashuMintWallet, CashuProvider, CashuProviderError};
use async_trait::async_trait;
use cdk::mint_url::MintUrl;
use cdk::nuts::MintInfo;
use cdk::wallet::{HttpClient, MintConnector};
use parking_lot::RwLock;
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;

pub struct CdkCashuProvider {
    clients: RwLock<HashMap<String, Arc<HttpClient>>>,
}

impl CdkCashuProvider {
    pub fn new() -> Self {
        Self {
            clients: RwLock::new(HashMap::new()),
        }
    }

    fn get_or_create(&self, mint_url: &MintUrl) -> Arc<HttpClient> {
        let key = mint_url.to_string();
        {
            let map = self.clients.read();
            if let Some(c) = map.get(&key) {
                return Arc::clone(c);
            }
        }
        let mut map = self.clients.write();
        if let Some(c) = map.get(&key) {
            return Arc::clone(c);
        }
        let client = Arc::new(HttpClient::new(mint_url.clone(), None));
        map.insert(key, Arc::clone(&client));
        client
    }
}

impl Default for CdkCashuProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Debug for CdkCashuProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CdkCashuProvider").finish_non_exhaustive()
    }
}

#[async_trait]
impl CashuProvider for CdkCashuProvider {
    async fn wallet_for_account(
        &self,
        account: &Account,
    ) -> Result<Arc<CashuMintWallet>, CashuProviderError> {
        let mint_url_str = account
            .details
            .get("mint_url")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                CashuProviderError::InvalidUrl("account.details missing mint_url".into())
            })?;
        let mint_url = MintUrl::from_str(mint_url_str).map_err(map_url_error)?;
        let client = self.get_or_create(&mint_url);
        let connector: Arc<dyn MintConnector + Send + Sync> = client;
        Ok(Arc::new(CashuMintWallet::new(connector, mint_url)))
    }

    async fn mint_info(&self, mint_url: &MintUrl) -> Result<MintInfo, CashuProviderError> {
        let client = self.get_or_create(mint_url);
        client.get_mint_info().await.map_err(map_cdk_error)
    }
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn provider_constructs() {
        let _ = CdkCashuProvider::new();
    }

    #[tokio::test]
    async fn wallet_for_account_fails_on_missing_mint_url() {
        use agicash_domain::{
            AccountId, AccountPurpose, AccountState, AccountType, Currency, UserId,
        };
        use chrono::Utc;
        use serde_json::json;

        let account = Account {
            id: AccountId::new(),
            created_at: Utc::now(),
            user_id: UserId::new(),
            name: "test".into(),
            account_type: AccountType::Cashu,
            purpose: AccountPurpose::Transactional,
            currency: Currency::Btc,
            details: json!({}),
            version: 0,
            state: AccountState::Active,
            expires_at: None,
        };
        let provider = CdkCashuProvider::new();
        let result = provider.wallet_for_account(&account).await;
        assert!(matches!(result, Err(CashuProviderError::InvalidUrl(_))));
    }
}

#[cfg(all(test, feature = "real-mint-tests"))]
mod real_mint_tests {
    use super::*;

    // cargo test -p agicash-cashu --features real-mint-tests
    #[tokio::test]
    async fn mint_info_fetches_from_real_mint() {
        let _ = dotenvy::dotenv();
        let url_str = std::env::var("AGICASH_TEST_MINT_URL")
            .unwrap_or_else(|_| "https://testnut.cashu.space".into());
        let mint_url = MintUrl::from_str(&url_str).expect("valid mint URL");

        let provider = CdkCashuProvider::new();
        let info = provider
            .mint_info(&mint_url)
            .await
            .expect("mint_info should succeed against live mint");
        println!("Mint name: {:?}", info.name);
    }

    #[tokio::test]
    async fn wallet_for_account_constructs_connector() {
        use agicash_domain::{
            AccountId, AccountPurpose, AccountState, AccountType, Currency, UserId,
        };
        use chrono::Utc;
        use serde_json::json;

        let _ = dotenvy::dotenv();
        let url_str = std::env::var("AGICASH_TEST_MINT_URL")
            .unwrap_or_else(|_| "https://testnut.cashu.space".into());

        let account = Account {
            id: AccountId::new(),
            created_at: Utc::now(),
            user_id: UserId::new(),
            name: "test".into(),
            account_type: AccountType::Cashu,
            purpose: AccountPurpose::Transactional,
            currency: Currency::Btc,
            details: json!({ "mint_url": url_str }),
            version: 0,
            state: AccountState::Active,
            expires_at: None,
        };

        let provider = CdkCashuProvider::new();
        let wallet = provider
            .wallet_for_account(&account)
            .await
            .expect("should construct wallet");
        assert_eq!(
            wallet.mint_url().to_string().trim_end_matches('/'),
            url_str.trim_end_matches('/')
        );
    }
}
