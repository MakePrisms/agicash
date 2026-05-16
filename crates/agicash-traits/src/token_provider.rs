use crate::AuthError;
use async_trait::async_trait;

#[async_trait]
pub trait TokenProvider: Send + Sync {
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
