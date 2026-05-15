#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("network: {0}")]
    Network(String),
    #[error("not found")]
    NotFound,
    #[error("storage backend error: {0}")]
    Backend(String),
    #[error("internal error: {0}")]
    Internal(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_error_display_covers_each_variant() {
        let n = StorageError::Network("dns".into());
        assert!(n.to_string().contains("network"));

        let nf = StorageError::NotFound;
        assert!(nf.to_string().to_lowercase().contains("not found"));

        let b = StorageError::Backend("oops".into());
        assert!(b.to_string().contains("oops"));

        let i = StorageError::Internal("bug".into());
        assert!(i.to_string().contains("bug"));
    }

    #[test]
    fn storage_error_is_a_std_error() {
        fn assert_error<E: std::error::Error>() {}
        assert_error::<StorageError>();
    }
}
