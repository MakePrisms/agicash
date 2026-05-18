//! `/receive/cashu` — paste-and-claim Cashu token receive route.
//!
//! Thin wrapper around `CashuTokenPasteView`. Mirrors the React route
//! shape (`_protected.receive.cashu_.token.tsx` on the `master` branch)
//! and the iOS `CashuTokenPasteView` (carousel slot under
//! `ReceiveCarouselView`). Unlike the React route, we don't yet read the
//! token from the URL hash — the entire input flow lives in the
//! component's textarea. Hash-driven entry can be added later once
//! deep-link share UX is in scope.
//!
//! Protected: redirects to `/login` if no access token (same pattern as
//! `pages/home.rs`).

use leptos::prelude::*;
use leptos_router::hooks::use_navigate;
use leptos_router::NavigateOptions;

use crate::app::AccessToken;
use crate::components::CashuTokenPasteView;

#[component]
pub fn ReceiveCashuPage() -> impl IntoView {
    let AccessToken(token) = expect_context::<AccessToken>();
    let navigate = use_navigate();

    // Redirect to /login when no access token. Same client-only Effect
    // pattern home.rs uses so SSR doesn't navigate on first paint.
    Effect::new(move |_| {
        if token.get().is_none() {
            navigate("/login", NavigateOptions::default());
        }
    });

    view! {
        <CashuTokenPasteView/>
    }
}
