//! Root `<App/>` component.
//!
//! Pure CSR (no SSR shell): the surrounding `<html>...<body>` envelope
//! lives in `crates/agicash-web-leptos/index.html`, which loads the
//! wasm bundle and invokes `hydrate()` (see `lib.rs`). The previous
//! `shell()` function and `LeptosOptions` plumbing were removed when
//! the axum SSR pipeline was ripped on 2026-05-17.

use leptos::prelude::*;
use leptos_meta::{provide_meta_context, Stylesheet, Title};
use leptos_router::{
    components::{ParentRoute, Route, Router, Routes},
    path, StaticSegment,
};

use crate::components::ProtectedLayout;
use crate::pages::{
    AccountsAddPage, AccountsIndexPage, HomePage, LoginPage, ReceiveCashuPage, ReceivePage,
    SendPage, SettingsAppearancePage, SettingsContactsPage, SettingsIndexPage,
    SettingsProfilePage,
};

/// Auth signal stored in the Leptos context. `Some(access_token)` means
/// "logged in"; `None` redirects to `/login`. The access token stays in
/// memory only — the refresh token persists to `window.localStorage`
/// via `BrowserSessionStorage` so a page reload can rehydrate the
/// session (matches the legacy React app's convention).
#[derive(Clone, Debug)]
pub struct AccessToken(pub RwSignal<Option<String>>);

/// Root reactive component. Provides the `AccessToken` context, the
/// `<Title/>` + `<Stylesheet/>` from `leptos_meta`, and the router with
/// the route tree:
///
/// ```text
/// /login                        (public)
/// / (ProtectedLayout)           (auth-gated, renders <Outlet/> + BottomNav)
///   ├── ""                      Home
///   ├── receive                 Receive
///   ├── receive/cashu           Paste-Cashu-token receive flow (lane L4)
///   ├── send                    Send
///   ├── accounts                Accounts list
///   │     └── add               Add mint
///   └── settings                Settings index
///         ├── profile           Profile
///         ├── appearance        Appearance
///         └── contacts          Contacts
/// ```
///
/// The protected group uses `ParentRoute` so the `BottomNav` stays
/// mounted across navigations (no flash, no scroll-position loss).
#[component]
pub fn App() -> impl IntoView {
    provide_meta_context();

    // Empty on first paint — the LoginView reads + writes this; protected
    // routes redirect to /login when it's None.
    let access_token = AccessToken(RwSignal::new(None));
    provide_context(access_token);

    view! {
        <Stylesheet id="leptos" href="/style/main.css"/>
        <Title text="Agicash"/>

        <Router>
            <main>
                <Routes fallback=|| "Not found.">
                    <Route path=StaticSegment("/login") view=LoginPage/>

                    // Protected group. The empty-path ParentRoute matches
                    // every URL that didn't match `/login` above; the inner
                    // index child (also empty path) renders Home, siblings
                    // handle the named tabs + their nested sub-routes.
                    <ParentRoute path=StaticSegment("") view=ProtectedLayout>
                        <Route path=StaticSegment("") view=HomePage/>
                        <Route path=StaticSegment("receive") view=ReceivePage/>
                        // Paste-Cashu-token receive flow (lane L4).
                        // `path!` expands to a tuple of `StaticSegment`s
                        // for multi-segment static paths.
                        <Route path=path!("/receive/cashu") view=ReceiveCashuPage/>
                        <Route path=StaticSegment("send") view=SendPage/>
                        <Route path=StaticSegment("accounts") view=AccountsIndexPage/>
                        <Route path=(StaticSegment("accounts"), StaticSegment("add"))
                               view=AccountsAddPage/>
                        <Route path=StaticSegment("settings") view=SettingsIndexPage/>
                        <Route path=(StaticSegment("settings"), StaticSegment("profile"))
                               view=SettingsProfilePage/>
                        <Route path=(StaticSegment("settings"), StaticSegment("appearance"))
                               view=SettingsAppearancePage/>
                        <Route path=(StaticSegment("settings"), StaticSegment("contacts"))
                               view=SettingsContactsPage/>
                    </ParentRoute>
                </Routes>
            </main>
        </Router>
    }
}
