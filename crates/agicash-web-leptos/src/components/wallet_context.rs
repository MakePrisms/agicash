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
//! [`WalletData::refresh`] reads the persisted session
//! ([`BrowserSessionStorage`]) for the `user_id` and exposes it on
//! the context, then sets `accounts` to `Ready(vec![])`. This is real
//! — a fresh guest has zero accounts — but it does not (yet) call any
//! wallet-level "list accounts" RPC because no such call exists in the
//! wasm-reachable surface today (`agicash-wasm` is a version-string
//! stub, see `crates/agicash-wasm/src/lib.rs` and the slice 13 follow-up
//! noted in its `Cargo.toml`).
//!
//! When that binding arrives, **only the body of `refresh` changes**.
//! The signal shapes here, the consumers in `pages/home.rs`, the
//! reactive plumbing all stay put. The `// TODO[slice-13]` markers
//! below tag the swap point.
//!
//! ## Empty-state correctness
//!
//! A signed-in guest with no accounts is the steady-state behaviour
//! right now (no accounts are created at registration). The hero
//! renders `$ 0` / `≈ 0 sats` from these empty inputs, which matches
//! the iOS `HomeView` empty rendering exactly. The empty-state is
//! visually correct without any data plumbing — that's the whole point
//! of the design choice.

use leptos::prelude::*;
use uuid::Uuid;

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
    /// Smallest-unit balance.
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
    /// Today: reads the persisted session, populates `user_id`, sets
    /// `accounts` to `Ready(vec![])`.
    ///
    /// TODO[slice-13]: once `agicash-wasm` ships a `WalletClient` with
    /// `list_accounts()`, replace the empty-vec path below with a real
    /// call. The signal updates stay the same.
    pub fn refresh(self) {
        // Loading state visible immediately so the view can show a
        // spinner even before the async work yields.
        self.accounts.set(LoadState::Loading);

        leptos::task::spawn_local(async move {
            #[cfg(target_arch = "wasm32")]
            {
                match load_session_user_id().await {
                    Ok(uid) => {
                        self.user_id.set(uid);
                        // TODO[slice-13]: swap for
                        // `WalletClient::list_accounts(uid).await`.
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
