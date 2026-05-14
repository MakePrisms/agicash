use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct KeyOptions {
    pub private_key_derivation_path: Option<String>,
    pub seed_phrase_derivation_path: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_options_default_is_empty() {
        let opts = KeyOptions::default();
        assert!(opts.private_key_derivation_path.is_none());
        assert!(opts.seed_phrase_derivation_path.is_none());
    }

    #[test]
    fn key_options_with_paths_constructs() {
        let opts = KeyOptions {
            private_key_derivation_path: Some("m/0'/0".into()),
            seed_phrase_derivation_path: None,
        };
        assert_eq!(opts.private_key_derivation_path.as_deref(), Some("m/0'/0"));
    }
}
