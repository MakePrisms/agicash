//! `WalletData` — Leptos context for the user's wallet view-model.
//!
//! The home page (and every future protected page) reads its data from
//! here rather than calling FFI / SDK code inline. The struct itself is
//! `Clone + Debug` so it slots into `provide_context` / `expect_context`
//! the same way `AccessToken` does.
//!
//! ## Why a context instead of a per-page resource?
//!
//! Several pages need the same data (home shows the balance hero,
//! accounts page shows the same list, settings shows the user). A
//! single shared `RwSignal` means one fetch on load, immediate reactive
//! updates after a Receive completes, and no cross-page refetch on
//! navigation.
//!
//! ## Where does the data actually come from today?
//!
//! [`WalletData::refresh`] uses a **direct Supabase REST fetch path**
//! (via [`gloo_net`]) rather than the typed `agicash-storage-supabase`
//! crate. That crate's `SupabaseStorage` is not yet wasm-compat
//! because of rustls / ring / tokio-net dependencies; porting it is a
//! multi-day effort tracked in the followup spec named
//! `2026-05-17-storage-supabase-wasm-port-design.md`.
//!
//! The fetch path:
//!
//! 1. Read `user_id` from `BrowserSessionStorage` (already persisted by
//!    [`LoginView`] on successful auth).
//! 2. Build an `OpenSecretTokenProvider` from the [`AppConfig`] context
//!    and call `get_jwt()` to mint a Supabase-compatible JWT
//!    (`generate_third_party_token` against the enclave).
//! 3. `GET <supabase-url>/rest/v1/accounts?user_id=eq.<uuid>` with
//!    `Authorization: Bearer <jwt>` and `apikey: <anon_key>`.
//! 4. Map each row into [`AccountSummary`] (balance left at zero — see
//!    the balance follow-up note below).
//!
//! ### Why this is acceptable as the interim path
//!
//! - The Supabase REST surface is stable (it's just `PostgREST` over
//!   the `wallet.accounts` table; the typed `SupabaseStorage` calls
//!   the same endpoint).
//! - RLS on the server enforces `auth.uid() = user_id`, so a wrong
//!   JWT just returns an empty list (not a leak).
//! - When the storage-supabase wasm port lands, only the body of
//!   [`WalletData::refresh`] changes. The signal shapes, the
//!   `AccountSummary` struct, the consumers in `pages/home.rs` — all
//!   stay put. See the `// FOLLOWUP[storage-supabase-wasm]` marker on
//!   the fetch helpers.
//!
//! ## Balance: still zero per account in this slice
//!
//! `wallet.accounts` rows do NOT carry a `balance` column. The balance
//! lives in `wallet.cashu_proofs` (one row per UNSPENT proof) and must
//! be summed per account after decryption (see
//! `agicash-ffi::wallet::compute_cashu_balance` and
//! `agicash_storage_supabase::SupabaseCashuSendSwapStorage::list_unspent_proofs`).
//!
//! Decryption uses `agicash-cashu::PassthroughProofEncryption` for now,
//! but the proof storage also needs the same wasm-compat fixes as
//! the account storage. So this slice ships **account count + currency
//! list but zero balances**. The hero will render `$ 0 / ≈ 0 sats`
//! which is correct for a fresh account and gracefully degrades for
//! accounts with actual balance — the user sees the account exists,
//! the demo is visibly working, but the real balance number waits for
//! the next slice.
//!
//! ## Empty-state correctness
//!
//! A signed-in guest with no accounts is still the steady-state
//! behaviour for a fresh account. The hero renders `$ 0` / `≈ 0 sats`
//! from these empty inputs, matching iOS `HomeView` exactly.

use leptos::prelude::*;
use uuid::Uuid;

#[cfg(target_arch = "wasm32")]
use crate::config::AppConfig;

/// Loading state envelope. Replaces a tri-state Option pattern so the
/// view layer can distinguish "haven't asked yet" from "asked, still
/// waiting" from "asked, failed" from "asked, here's data".
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum LoadState<T> {
    /// `WalletData::refresh` hasn't been called yet (first paint).
    #[default]
    Idle,
    /// In-flight: an async refresh is running.
    Loading,
    /// Ready with data — could be an empty `Vec`, which is the canonical
    /// "signed-in guest, no accounts" state today.
    Ready(T),
    /// Refresh failed; carries a user-facing message.
    Error(String),
}

impl<T> LoadState<T> {
    /// True iff a refresh is in flight.
    #[must_use]
    pub const fn is_loading(&self) -> bool {
        matches!(self, Self::Loading)
    }

    /// Borrow the inner value if `Ready`. Returns `None` otherwise.
    pub const fn ready(&self) -> Option<&T> {
        match self {
            Self::Ready(value) => Some(value),
            _ => None,
        }
    }
}

/// Per-account summary used by the home-page balance hero and the
/// accounts page list. Mirrors the FFI's `AccountFfi` field-for-field
/// (sans the iOS-only `id`, `name`, `mint_url`, `account_type` extras),
/// keeping the surface small so the home page never needs to grow
/// fields it doesn't render. The accounts page can lift this to a
/// richer struct later without touching the home flow.
///
/// `balance` is the raw smallest-unit total (sat for BTC, cent for
/// USD/USDB) as `u64` — matches the iOS hero's parse-the-decimal-string
/// step but skips the string round-trip since we own the data shape.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AccountSummary {
    /// `"BTC"` | `"USD"` | `"USDB"`. Same labels as `AccountFfi.currency`.
    pub currency: String,
    /// Smallest-unit balance. Always 0 in this slice; the proof-sum
    /// path lands when `agicash-storage-supabase` is wasm-compat.
    pub balance: u64,
}

/// Cross-page wallet view-model. Provide once at the App root; consumers
/// pull it out via `expect_context::<WalletData>()`.
#[derive(Clone, Debug)]
pub struct WalletData {
    /// The signed-in user's id (from the persisted session). `None`
    /// until [`WalletData::refresh`] runs.
    pub user_id: RwSignal<Option<Uuid>>,
    /// Account list keyed by load state. `Ready(vec![])` is the
    /// canonical empty-wallet state.
    pub accounts: RwSignal<LoadState<Vec<AccountSummary>>>,
}

impl WalletData {
    /// Fresh `WalletData` in `Idle` state. The App root constructs one
    /// of these next to `AccessToken`.
    #[must_use]
    pub fn new() -> Self {
        Self {
            user_id: RwSignal::new(None),
            accounts: RwSignal::new(LoadState::Idle),
        }
    }

    /// Kick off a refresh. Runs in the browser only — the native rlib
    /// build (used by `cargo test` on the pure pieces) treats this as a
    /// no-op so unit tests on view helpers don't need a browser.
    ///
    /// On wasm: loads the session, fetches accounts via the direct
    /// Supabase REST path (see the module docs for the rationale), and
    /// populates the signals. Balance stays at 0 per account in this
    /// slice — see the followup spec.
    pub fn refresh(self) {
        // Loading state visible immediately so the view can show a
        // spinner even before the async work yields.
        self.accounts.set(LoadState::Loading);

        // Capture context BEFORE spawning — `spawn_local` futures run
        // outside the reactive owner that provided the context, so
        // `use_context` inside the async block always returns None.
        // Reading it sync here threads the value through to the future.
        #[cfg(target_arch = "wasm32")]
        let config = use_context::<AppConfig>();

        leptos::task::spawn_local(async move {
            #[cfg(target_arch = "wasm32")]
            {
                let Some(config) = config else {
                    self.accounts
                        .set(LoadState::Error("AppConfig context missing".to_string()));
                    return;
                };

                match load_session_user_id().await {
                    Ok(Some(uid)) => {
                        self.user_id.set(Some(uid));
                        match fetch_accounts_via_rest(&config, uid).await {
                            Ok(accounts) => {
                                self.accounts.set(LoadState::Ready(accounts));
                            }
                            Err(msg) => {
                                self.accounts.set(LoadState::Error(msg));
                            }
                        }
                    }
                    Ok(None) => {
                        // No session — ProtectedLayout should have
                        // redirected, but we don't want to spin.
                        self.accounts.set(LoadState::Ready(Vec::new()));
                    }
                    Err(msg) => {
                        self.accounts.set(LoadState::Error(msg));
                    }
                }
            }
            #[cfg(not(target_arch = "wasm32"))]
            {
                // Native: don't touch anything async — the test runner
                // doesn't have a browser. Just settle into Ready(empty)
                // so any view tests rendering this state get the same
                // shape they'd see in the browser steady-state.
                self.accounts.set(LoadState::Ready(Vec::new()));
            }
        });
    }
}

impl Default for WalletData {
    fn default() -> Self {
        Self::new()
    }
}

/// Browser-only: read the `user_id` from `BrowserSessionStorage`.
/// Returns `Ok(None)` if no session is persisted (e.g. user landed on
/// `/` from a fresh tab before logging in — shouldn't happen because
/// `ProtectedLayout` redirects, but we don't want to panic if it does).
#[cfg(target_arch = "wasm32")]
async fn load_session_user_id() -> Result<Option<Uuid>, String> {
    use agicash_auth_opensecret::BrowserSessionStorage;
    use agicash_traits::SessionStorage;

    let storage = BrowserSessionStorage::new();
    match storage.load().await {
        Ok(Some(session)) => Ok(Some(session.user_id)),
        Ok(None) => Ok(None),
        Err(e) => Err(format!("session load failed: {e}")),
    }
}

// ---- Direct Supabase REST fetch path ----------------------------------
//
// FOLLOWUP[storage-supabase-wasm]: when `agicash-storage-supabase`
// builds on wasm32 (see `2026-05-17-storage-supabase-wasm-port-design.md`),
// delete this section and call `SupabaseStorage::list_accounts(uid)`
// directly. The `AccountSummary` mapping is the only piece that needs
// to stay (the typed `agicash_domain::Account` carries more fields).

/// Account row shape returned by `GET /rest/v1/accounts`. Subset of
/// the full `wallet.accounts` schema — only the fields the home hero
/// and accounts page render. Postgres returns ISO timestamp strings
/// and JSON values directly; we strip `details` since the home page
/// does not render mint URLs.
#[cfg(target_arch = "wasm32")]
#[derive(Debug, serde::Deserialize)]
struct AccountRow {
    currency: String,
}

#[cfg(target_arch = "wasm32")]
async fn fetch_accounts_via_rest(
    config: &AppConfig,
    user_id: Uuid,
) -> Result<Vec<AccountSummary>, String> {
    if config.supabase_anon_key.is_empty() {
        return Err(
            "Supabase anon key missing — set <meta name=\"supabase-anon-key\"> in \
             index.html or you'll only see auth-only state."
                .to_string(),
        );
    }

    let jwt = mint_supabase_jwt(config).await?;

    // Postgrest filter: `user_id=eq.<uuid>`. The `select=currency`
    // narrows the projection to only the columns we deserialize.
    let url = format!(
        "{base}/rest/v1/accounts?user_id=eq.{user_id}&select=currency",
        base = config.supabase_url.trim_end_matches('/'),
    );

    let response = gloo_net::http::Request::get(&url)
        .header("apikey", &config.supabase_anon_key)
        .header("Authorization", &format!("Bearer {jwt}"))
        .header("Accept", "application/json")
        // PostgREST switches schema via the `Accept-Profile` (read) /
        // `Content-Profile` (write) headers. The typed client (`postgrest::Postgrest::schema`)
        // does the same thing under the hood; here we set it directly.
        .header("Accept-Profile", "wallet")
        .send()
        .await
        .map_err(|e| format!("supabase fetch failed: {e}"))?;

    let status = response.status();
    if !(200..300).contains(&status) {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("supabase returned {status}: {body}"));
    }

    let rows: Vec<AccountRow> = response
        .json()
        .await
        .map_err(|e| format!("supabase response decode failed: {e}"))?;

    // FOLLOWUP[balances]: per-account balance sums need
    // `cashu_proofs` + the CashuSendSwapStorage decryption path.
    // Today every account renders zero, which still gives a visibly
    // correct hero ($ 0 / ≈ 0 sats) and a populated currency list.
    let summaries = rows
        .into_iter()
        .map(|row| AccountSummary {
            currency: row.currency,
            balance: 0,
        })
        .collect();

    Ok(summaries)
}

/// Mint a Supabase-compatible JWT via opensecret's
/// `generate_third_party_token` (wasm-clean). Wraps the
/// `OpenSecretTokenProvider` from `agicash-auth-opensecret` so the same
/// machinery the native FFI uses is exercised on wasm too.
#[cfg(target_arch = "wasm32")]
async fn mint_supabase_jwt(config: &AppConfig) -> Result<String, String> {
    use agicash_auth_opensecret::{OpenSecretClient, OpenSecretConfig, OpenSecretTokenProvider};
    use agicash_traits::TokenProvider;

    let client = OpenSecretClient::new(OpenSecretConfig {
        base_url: config.opensecret_base_url.clone(),
        client_id: config.opensecret_client_id,
    })
    .map_err(|e| format!("build opensecret client: {e}"))?;

    // OpenSecretTokenProvider re-uses the client's session (refresh
    // token in browser localStorage). The handshake is cached, so
    // back-to-back refresh() calls don't pay it twice.
    let provider = OpenSecretTokenProvider::new(client);
    provider
        .get_jwt()
        .await
        .map_err(|e| format!("supabase jwt mint failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_state_default_is_idle() {
        let ls: LoadState<Vec<u8>> = LoadState::default();
        assert!(matches!(ls, LoadState::Idle));
        assert!(!ls.is_loading());
        assert!(ls.ready().is_none());
    }

    #[test]
    fn load_state_loading_predicate() {
        let ls: LoadState<()> = LoadState::Loading;
        assert!(ls.is_loading());
        assert!(ls.ready().is_none());
    }

    #[test]
    fn load_state_ready_exposes_inner() {
        let ls = LoadState::Ready(vec![1u8, 2, 3]);
        assert_eq!(ls.ready(), Some(&vec![1u8, 2, 3]));
        assert!(!ls.is_loading());
    }

    #[test]
    fn load_state_error_carries_message() {
        let ls: LoadState<()> = LoadState::Error("boom".to_string());
        assert!(!ls.is_loading());
        assert!(ls.ready().is_none());
        match ls {
            LoadState::Error(msg) => assert_eq!(msg, "boom"),
            _ => panic!("expected Error variant"),
        }
    }
}
