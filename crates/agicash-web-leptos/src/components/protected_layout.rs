//! `ProtectedLayout` — the app shell rendered inside every
//! `_protected/*` route (mirror of the React `_protected.tsx` parent).
//!
//! Two jobs:
//!   1. Auth guard. Mirrors `HomePage`'s `AccessToken` check — when the
//!      in-memory access-token signal is `None` we navigate to `/login`.
//!      The redirect runs in a client-only `Effect` so SSR doesn't perform
//!      it on first paint (the cookie-backed refresh-token flow may
//!      repopulate the access token before the user ever sees this page).
//!   2. App chrome. Renders `<Outlet/>` for the child page and a fixed
//!      bottom nav (Home / Receive / Send / Accounts / Settings) — the
//!      iOS 2-tab pattern lifted into a 5-tab mobile-PWA nav, matching
//!      spec §8's route surface.
//!
//! This is a placeholder shell — real data wires in once Slice 12's
//! `WalletClient` lands.

use leptos::prelude::*;
use leptos_router::components::Outlet;
use leptos_router::hooks::use_navigate;
use leptos_router::NavigateOptions;

use crate::app::AccessToken;
use crate::components::BottomNav;
use crate::tokens;

#[component]
pub fn ProtectedLayout() -> impl IntoView {
    let AccessToken(token) = expect_context::<AccessToken>();
    let navigate = use_navigate();

    // Client-only redirect. `Effect::new` runs post-hydration; SSR's first
    // paint of the protected shell is harmless — the browser will swap in
    // the login screen on the next tick if no token is present.
    Effect::new(move |_| {
        if token.get().is_none() {
            navigate("/login", NavigateOptions::default());
        }
    });

    let shell_style = format!(
        "display:flex; flex-direction:column; min-height:100dvh; \
         background:{}; color:{}; font-family:{};",
        tokens::COLOR_BACKGROUND,
        tokens::COLOR_FOREGROUND,
        tokens::FONT_PRIMARY,
    );

    // Content area pads the bottom by the nav height so fixed nav doesn't
    // occlude scrolled content. Nav height = 64px (8 + 40 button + 16).
    let content_style = "flex:1 1 auto; padding-bottom:64px; \
        display:flex; flex-direction:column;"
        .to_string();

    view! {
        <div style=shell_style>
            <div style=content_style>
                <Outlet/>
            </div>
            <BottomNav/>
        </div>
    }
}
