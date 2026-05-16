//! Root `<App/>` component + the SSR `shell` function cargo-leptos invokes
//! to wrap the page in the standard `<html>...<body>` envelope.

use leptos::prelude::*;
use leptos_meta::{provide_meta_context, MetaTags, Stylesheet, Title};
use leptos_router::{
    components::{Route, Router, Routes},
    StaticSegment,
};

use crate::pages::{HomePage, LoginPage};

/// Auth signal stored in the Leptos context. `Some(access_token)` means
/// "logged in"; `None` redirects to `/login`. Spec §7 keeps the access
/// token in memory only and never localStorage. Refresh token sits in an
/// httpOnly cookie set by the axum auth proxy.
#[derive(Clone, Debug)]
pub struct AccessToken(pub RwSignal<Option<String>>);

/// SSR shell. cargo-leptos calls this per request to render the outer HTML
/// envelope; the inner `<App/>` is what gets hydrated.
pub fn shell(options: LeptosOptions) -> impl IntoView {
    view! {
        <!DOCTYPE html>
        <html lang="en">
            <head>
                <meta charset="utf-8"/>
                <meta name="viewport" content="width=device-width, initial-scale=1"/>
                <meta name="theme-color" content="#ffffff"/>
                <link rel="manifest" href="/manifest.json"/>
                <link rel="icon" type="image/x-icon" href="/favicon.ico"/>
                <link rel="apple-touch-icon" href="/icon-192x192.png"/>
                <meta name="apple-mobile-web-app-capable" content="yes"/>
                <meta name="apple-mobile-web-app-status-bar-style" content="default"/>
                // Fonts from the design-tokens system (design/tokens.json):
                // Kode Mono for UI text, Teko for monetary numerics.
                <link rel="preconnect" href="https://fonts.googleapis.com"/>
                <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin=""/>
                <link
                    rel="stylesheet"
                    href="https://fonts.googleapis.com/css2?family=Kode+Mono:wght@400..700&family=Teko:wght@300..700&display=swap"
                />
                <AutoReload options=options.clone() />
                <HydrationScripts options/>
                <MetaTags/>
            </head>
            <body>
                <App/>
                // Register the service worker after hydration. Best-effort —
                // browsers without SW support silently skip. Kept out of the
                // App component proper so it only fires once per page load.
                <script>
                    "if ('serviceWorker' in navigator) {
                        window.addEventListener('load', function() {
                            navigator.serviceWorker.register('/service-worker.js').catch(function(){});
                        });
                    }"
                </script>
            </body>
        </html>
    }
}

/// Root reactive component. Provides the `AccessToken` context, the
/// `<Title/>` + `<Stylesheet/>` from `leptos_meta`, and the router with
/// the two routes Phase-1-partial ships: `/login` and `/`.
#[component]
pub fn App() -> impl IntoView {
    provide_meta_context();

    // Empty on first paint — the LoginView reads + writes this; protected
    // routes redirect to /login when it's None.
    let access_token = AccessToken(RwSignal::new(None));
    provide_context(access_token);

    view! {
        <Stylesheet id="leptos" href="/pkg/agicash-web-leptos.css"/>
        <Title text="Agicash"/>

        <Router>
            <main>
                <Routes fallback=|| "Not found.">
                    <Route path=StaticSegment("/login") view=LoginPage/>
                    <Route path=StaticSegment("") view=HomePage/>
                </Routes>
            </main>
        </Router>
    }
}
