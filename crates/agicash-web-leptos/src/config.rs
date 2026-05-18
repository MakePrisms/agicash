//! Runtime app config — endpoint URLs + client ids — read from `<meta>`
//! tags in `index.html` on browser startup.
//!
//! ## Why `<meta>` tags
//!
//! The PWA needs to ship one wasm bundle that the operator can point at
//! either the local-dev stack or the prod stack without recompiling. The
//! brief listed three options:
//!
//! - **Build-time `cfg` flag** (`--features prod`): forces a separate
//!   wasm bundle per environment. Recompiles for every endpoint change.
//! - **Fetched `/config.json`**: adds a network round-trip before any
//!   render, including before `LoginView` can even build its
//!   `OpenSecretClient` (which needs the base URL to construct).
//! - **`<meta>` tags** (this approach): the static `index.html` carries
//!   the values, the wasm reads them on hydrate. No recompile, no extra
//!   fetch, the operator edits one HTML file per environment.
//!
//! The Supabase anon key is a public-by-design JWT (it's enforced by RLS
//! on the server); shipping it in the HTML is the same posture every
//! Supabase web app uses.
//!
//! ## Fallbacks
//!
//! Missing tags fall back to the local-dev stack so a contributor who
//! runs `aweb` without touching `index.html` still gets a working
//! local-dev configuration.

use uuid::Uuid;

/// Runtime configuration provided via Leptos context. Built once on
/// startup by [`AppConfig::load`], then read by [`LoginView`] (for the
/// `OpenSecretClient` constructor) and by `WalletData::refresh` (for
/// the `SupabaseStorage` constructor).
#[derive(Clone, Debug)]
pub struct AppConfig {
    pub opensecret_base_url: String,
    pub opensecret_client_id: Uuid,
    pub supabase_url: String,
    pub supabase_anon_key: String,
}

/// Local-dev fallbacks — mirror `nix/shells/default.nix` so a clean
/// `aweb` against the local stack works without editing `index.html`.
const DEV_OPENSECRET_BASE_URL: &str = "http://127.0.0.1:3999";
const DEV_OPENSECRET_CLIENT_ID: &str = "ba5a14b5-d915-47b1-b7b1-afda52bc5fc6";
const DEV_SUPABASE_URL: &str = "https://127.0.0.1:54321";
/// Empty fallback for the anon key — the local stack rotates it on every
/// `supabase start`, so we don't pin a value. Any code path that needs
/// Supabase must surface an error if the key is empty.
const DEV_SUPABASE_ANON_KEY: &str = "";

impl AppConfig {
    /// Build a config from `<meta>` tags + dev fallbacks. Browser-only.
    /// The native rlib build returns a dev-defaults struct so unit
    /// tests can construct one without a DOM.
    #[must_use]
    pub fn load() -> Self {
        #[cfg(target_arch = "wasm32")]
        {
            Self::load_from_meta()
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            Self::dev_defaults()
        }
    }

    /// Dev-defaults config, used by the native rlib build and as the
    /// fallback when a `<meta>` tag is missing on wasm.
    #[must_use]
    pub fn dev_defaults() -> Self {
        Self {
            opensecret_base_url: DEV_OPENSECRET_BASE_URL.to_string(),
            opensecret_client_id: DEV_OPENSECRET_CLIENT_ID
                .parse()
                .expect("dev client_id is a valid UUID"),
            supabase_url: DEV_SUPABASE_URL.to_string(),
            supabase_anon_key: DEV_SUPABASE_ANON_KEY.to_string(),
        }
    }

    #[cfg(target_arch = "wasm32")]
    fn load_from_meta() -> Self {
        let dev = Self::dev_defaults();

        let opensecret_base_url =
            meta_content("opensecret-base-url").unwrap_or(dev.opensecret_base_url);

        // Parse the client_id meta if present; fall back to the dev id
        // rather than panicking so a typo doesn't dead-end the entire
        // app at startup.
        let opensecret_client_id = meta_content("opensecret-client-id")
            .and_then(|raw| raw.parse::<Uuid>().ok())
            .unwrap_or(dev.opensecret_client_id);

        let supabase_url = meta_content("supabase-url").unwrap_or(dev.supabase_url);

        let supabase_anon_key = meta_content("supabase-anon-key").unwrap_or(dev.supabase_anon_key);

        Self {
            opensecret_base_url,
            opensecret_client_id,
            supabase_url,
            supabase_anon_key,
        }
    }
}

/// Look up `<meta name="<name>" content="...">` in the document head.
/// Returns `None` if the tag is missing, has no `content` attribute, or
/// the document has no `head` element. Tolerates whitespace-only values
/// (returns `None` for those too).
#[cfg(target_arch = "wasm32")]
fn meta_content(name: &str) -> Option<String> {
    let document = web_sys::window()?.document()?;
    let selector = format!(r#"meta[name="{name}"]"#);
    let element = document.query_selector(&selector).ok()??;
    let content = element.get_attribute("content")?;
    let trimmed = content.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_defaults_has_valid_client_id() {
        let cfg = AppConfig::dev_defaults();
        assert!(!cfg.opensecret_base_url.is_empty());
        // The fallback UUID must round-trip — anything else would
        // mean a typo in the constant.
        let _: Uuid = cfg.opensecret_client_id;
    }

    #[test]
    fn dev_defaults_supabase_anon_key_is_empty() {
        // Anon key is empty by design on dev — the local supabase
        // stack rotates it on every start. Anyone wanting to use
        // Supabase locally must edit index.html (or pass via meta).
        let cfg = AppConfig::dev_defaults();
        assert!(cfg.supabase_anon_key.is_empty());
    }
}
