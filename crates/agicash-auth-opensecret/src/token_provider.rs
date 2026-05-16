use crate::error::auth_error_from_opensecret;
use crate::OpenSecretClient;
use agicash_traits::{AuthError, TokenProvider};
use async_trait::async_trait;

#[derive(Debug, Clone)]
pub struct OpenSecretTokenProvider {
    client: OpenSecretClient,
}

impl OpenSecretTokenProvider {
    #[must_use]
    pub fn new(client: OpenSecretClient) -> Self {
        Self { client }
    }
}

// On wasm32 reqwest's response future contains `Rc<RefCell<…>>` +
// `Closure<dyn FnMut + 'static>` — both `!Send`. The `TokenProvider` trait
// is now `?Send` on wasm, but the impl still needs the matching attribute
// (async-trait expands to a `Box<dyn Future + Send>` by default). The
// WASM worker recommended cfg-gating the impl native-only until a browser
// wallet shim lands (slice 13b); we follow that here. The inherent
// methods on `OpenSecretClient` stay available on wasm.
#[cfg(not(target_arch = "wasm32"))]
#[async_trait]
impl TokenProvider for OpenSecretTokenProvider {
    async fn get_jwt(&self) -> Result<String, AuthError> {
        self.client.ensure_handshake().await?;
        let resp = self
            .client
            .inner()
            .generate_third_party_token(None)
            .await
            .map_err(auth_error_from_opensecret)?;
        Ok(resp.token)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[allow(dead_code)]
    async fn _provider_satisfies_trait(client: OpenSecretClient) {
        let p = OpenSecretTokenProvider::new(client);
        let _: Result<String, AuthError> = p.get_jwt().await;
    }
}
