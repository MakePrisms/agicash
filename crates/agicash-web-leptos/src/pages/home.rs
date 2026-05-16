//! `/` — protected home route.
//!
//! Phase 1 partial: blank placeholder. Real balance hero + account
//! carousel land once slice 12 `WalletClient::balance` is on master.
//!
//! Guard: when the in-memory access-token signal is `None` we navigate to
//! `/login`. The redirect runs in a client-only `Effect` so SSR doesn't
//! perform it on first paint (the cookie-backed refresh-token flow may
//! repopulate the access token before the user ever sees this page).

use leptos::prelude::*;
use leptos_router::hooks::use_navigate;

use crate::app::AccessToken;
use crate::tokens;

#[component]
pub fn HomePage() -> impl IntoView {
    let AccessToken(token) = expect_context::<AccessToken>();
    let navigate = use_navigate();

    // Redirect to /login when no access token. Runs only on the client
    // (Effect::new schedules to the next reactive tick, which is post-
    // hydration when running in the browser).
    Effect::new(move |_| {
        if token.get().is_none() {
            navigate("/login", Default::default());
        }
    });

    let container_style = format!(
        "display:flex; flex-direction:column; align-items:center; \
         justify-content:center; min-height:100dvh; padding:{}; \
         background:{}; color:{}; font-family:{};",
        tokens::SPACE_L,
        tokens::COLOR_BACKGROUND,
        tokens::COLOR_FOREGROUND,
        tokens::FONT_PRIMARY,
    );

    view! {
        <div style=container_style>
            <h1 style=format!("font-size:{}; margin-bottom:{};", tokens::TEXT_2XL, tokens::SPACE_L)>
                "Welcome"
            </h1>
            <p style=format!("color:{};", tokens::COLOR_MUTED_FOREGROUND)>
                "Wallet UI coming soon."
            </p>
        </div>
    }
}
