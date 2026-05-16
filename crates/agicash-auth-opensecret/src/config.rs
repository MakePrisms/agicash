use agicash_traits::AuthError;
use uuid::Uuid;

pub const ENV_BASE_URL: &str = "OPENSECRET_BASE_URL";
pub const ENV_CLIENT_ID: &str = "OPENSECRET_CLIENT_ID";

#[derive(Debug, Clone)]
pub struct OpenSecretConfig {
    pub base_url: String,
    pub client_id: Uuid,
}

impl OpenSecretConfig {
    pub fn from_env() -> Result<Self, AuthError> {
        Self::from_env_vars(ENV_BASE_URL, ENV_CLIENT_ID)
    }

    pub fn from_env_vars(url_var: &str, id_var: &str) -> Result<Self, AuthError> {
        let base_url = std::env::var(url_var)
            .map_err(|_| AuthError::Internal(format!("missing env var: {url_var}")))?;
        let client_id_raw = std::env::var(id_var)
            .map_err(|_| AuthError::Internal(format!("missing env var: {id_var}")))?;
        let client_id = Uuid::parse_str(&client_id_raw)
            .map_err(|e| AuthError::Internal(format!("invalid {id_var}: {e}")))?;
        Ok(Self {
            base_url,
            client_id,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique(prefix: &str) -> (String, String) {
        let pid = std::process::id();
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        (
            format!("{prefix}_BASE_URL_{pid}_{n}"),
            format!("{prefix}_CLIENT_ID_{pid}_{n}"),
        )
    }

    #[test]
    fn from_env_reads_both_vars() {
        let (url_var, id_var) = unique("AGICASH_T1");
        let uuid = Uuid::new_v4();
        std::env::set_var(&url_var, "https://example.test");
        std::env::set_var(&id_var, uuid.to_string());

        let cfg = OpenSecretConfig::from_env_vars(&url_var, &id_var).unwrap();
        assert_eq!(cfg.base_url, "https://example.test");
        assert_eq!(cfg.client_id, uuid);

        std::env::remove_var(&url_var);
        std::env::remove_var(&id_var);
    }

    #[test]
    fn from_env_errors_when_missing_base_url() {
        let (url_var, id_var) = unique("AGICASH_T2");
        std::env::set_var(&id_var, Uuid::new_v4().to_string());
        let err = OpenSecretConfig::from_env_vars(&url_var, &id_var).unwrap_err();
        assert!(matches!(err, AuthError::Internal(_)));
        std::env::remove_var(&id_var);
    }

    #[test]
    fn from_env_errors_on_bad_uuid() {
        let (url_var, id_var) = unique("AGICASH_T3");
        std::env::set_var(&url_var, "https://example.test");
        std::env::set_var(&id_var, "not-a-uuid");
        let err = OpenSecretConfig::from_env_vars(&url_var, &id_var).unwrap_err();
        assert!(matches!(err, AuthError::Internal(_)));
        std::env::remove_var(&url_var);
        std::env::remove_var(&id_var);
    }
}
