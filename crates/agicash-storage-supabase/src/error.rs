use agicash_traits::StorageError;

/// Map a postgrest error to a `StorageError`. Postgrest 1.6's `execute()`
/// returns `reqwest::Error` (transitive); we don't import its type to avoid
/// committing to a specific reqwest version, so we accept anything `Display`.
pub fn map_postgrest_error(err: impl std::fmt::Display) -> StorageError {
    StorageError::Backend(format!("postgrest: {err}"))
}

/// Map a generic transport/decode error (typically from `response.text().await`
/// or `response.status()`) into a `StorageError`. Display-based to avoid
/// pinning the reqwest version.
pub fn map_network_error(err: impl std::fmt::Display) -> StorageError {
    StorageError::Network(format!("{err}"))
}

/// Map a `serde_json::Error` to a `StorageError`.
pub fn map_json_error(err: &serde_json::Error) -> StorageError {
    StorageError::Backend(format!("json decode: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn map_postgrest_error_is_backend() {
        let err = map_postgrest_error("oops");
        assert!(matches!(err, StorageError::Backend(_)));
        assert!(err.to_string().contains("oops"));
    }

    #[test]
    fn map_network_error_is_network() {
        let err = map_network_error("connect refused");
        assert!(matches!(err, StorageError::Network(_)));
        assert!(err.to_string().contains("connect refused"));
    }

    #[test]
    fn map_json_error_is_backend() {
        let err: serde_json::Error = serde_json::from_str::<i32>("not-an-int").unwrap_err();
        let mapped = map_json_error(&err);
        assert!(matches!(mapped, StorageError::Backend(_)));
    }
}
