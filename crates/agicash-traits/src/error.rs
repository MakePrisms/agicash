#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("network: {0}")]
    Network(String),
    #[error("not authenticated")]
    Unauthenticated,
    #[error("auth backend error: {0}")]
    Backend(String),
    #[error("internal error: {0}")]
    Internal(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_error_display_covers_each_variant() {
        let n = AuthError::Network("dns".into());
        assert!(n.to_string().contains("network"));

        let u = AuthError::Unauthenticated;
        assert!(u.to_string().to_lowercase().contains("auth"));

        let b = AuthError::Backend("oops".into());
        assert!(b.to_string().contains("oops"));

        let i = AuthError::Internal("bug".into());
        assert!(i.to_string().contains("bug"));
    }
}
