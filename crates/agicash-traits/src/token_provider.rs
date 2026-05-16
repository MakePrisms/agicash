use crate::AuthError;
use async_trait::async_trait;

/// Marker bound alias — `Send + Sync` on native, empty on wasm.
#[cfg(not(target_arch = "wasm32"))]
pub trait TokenProviderBounds: Send + Sync {}
#[cfg(not(target_arch = "wasm32"))]
impl<T: Send + Sync> TokenProviderBounds for T {}

#[cfg(target_arch = "wasm32")]
pub trait TokenProviderBounds {}
#[cfg(target_arch = "wasm32")]
impl<T> TokenProviderBounds for T {}

#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
pub trait TokenProvider: TokenProviderBounds {
    async fn get_jwt(&self) -> Result<String, AuthError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    struct DummyToken;

    #[async_trait]
    impl TokenProvider for DummyToken {
        async fn get_jwt(&self) -> Result<String, AuthError> {
            Ok("token".to_string())
        }
    }

    #[tokio::test]
    async fn dummy_token_provider_returns_jwt() {
        assert_eq!(DummyToken.get_jwt().await.unwrap(), "token");
    }
}
