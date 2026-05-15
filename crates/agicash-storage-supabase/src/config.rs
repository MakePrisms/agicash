use agicash_traits::StorageError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SupabaseStorageConfig {
    pub url: String,
    pub anon_key: String,
}

impl SupabaseStorageConfig {
    /// Load config from process env vars. Reads `SUPABASE_URL` first, falling
    /// back to `VITE_SUPABASE_URL`; same for the anon key. This accommodates
    /// the dev `.env` shared with the JS app.
    pub fn from_env() -> Result<Self, StorageError> {
        Self::from_env_vars(|name| std::env::var(name).map_err(|_| ()))
    }

    /// Test-friendly variant taking an env-var getter closure.
    pub fn from_env_vars<F>(get: F) -> Result<Self, StorageError>
    where
        F: Fn(&str) -> Result<String, ()>,
    {
        let url = get("SUPABASE_URL")
            .or_else(|_| get("VITE_SUPABASE_URL"))
            .map_err(|_| {
                StorageError::Internal(
                    "missing env var: SUPABASE_URL (or VITE_SUPABASE_URL)".into(),
                )
            })?;
        let anon_key = get("SUPABASE_ANON_KEY")
            .or_else(|_| get("VITE_SUPABASE_ANON_KEY"))
            .map_err(|_| {
                StorageError::Internal(
                    "missing env var: SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY)".into(),
                )
            })?;
        Ok(Self { url, anon_key })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_env_vars_parses_happy_path() {
        let cfg = SupabaseStorageConfig::from_env_vars(|name| match name {
            "SUPABASE_URL" => Ok("https://test.supabase.co".to_string()),
            "SUPABASE_ANON_KEY" => Ok("anon-key-abc".to_string()),
            _ => Err(()),
        })
        .unwrap();
        assert_eq!(cfg.url, "https://test.supabase.co");
        assert_eq!(cfg.anon_key, "anon-key-abc");
    }

    #[test]
    fn from_env_vars_falls_back_to_vite_prefix() {
        let cfg = SupabaseStorageConfig::from_env_vars(|name| match name {
            "VITE_SUPABASE_URL" => Ok("https://test.supabase.co".to_string()),
            "VITE_SUPABASE_ANON_KEY" => Ok("anon-key-abc".to_string()),
            _ => Err(()),
        })
        .unwrap();
        assert_eq!(cfg.url, "https://test.supabase.co");
        assert_eq!(cfg.anon_key, "anon-key-abc");
    }

    #[test]
    fn from_env_vars_reports_missing_url() {
        let err = SupabaseStorageConfig::from_env_vars(|name| match name {
            "SUPABASE_ANON_KEY" => Ok("anon".into()),
            _ => Err(()),
        })
        .unwrap_err();
        assert!(matches!(err, StorageError::Internal(_)));
        assert!(err.to_string().contains("SUPABASE_URL"));
    }

    #[test]
    fn from_env_vars_reports_missing_anon_key() {
        let err = SupabaseStorageConfig::from_env_vars(|name| match name {
            "SUPABASE_URL" => Ok("https://test.supabase.co".into()),
            _ => Err(()),
        })
        .unwrap_err();
        assert!(matches!(err, StorageError::Internal(_)));
        assert!(err.to_string().contains("SUPABASE_ANON_KEY"));
    }
}
