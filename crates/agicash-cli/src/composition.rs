use agicash_auth_opensecret::{
    KeyringSessionStorage, OpenSecretClient, OpenSecretConfig, DEFAULT_SERVICE,
};
use agicash_traits::AuthError;

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
