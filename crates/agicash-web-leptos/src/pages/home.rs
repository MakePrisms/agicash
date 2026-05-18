//! `/` — protected home route.
//!
//! Phase 1 partial: stub balance hero. Real balance + account carousel
//! land once Slice 12 `WalletClient::balance` is on master-merger.
//!
//! Auth guard moved up to `ProtectedLayout` so every protected child
//! shares one redirect path. This view only renders its own content
//! (the shell + bottom nav are provided by the parent layout).

use leptos::prelude::*;

use crate::tokens;

#[component]
pub fn HomePage() -> impl IntoView {
    let container_style = format!(
        "display:flex; flex-direction:column; align-items:center; \
         justify-content:center; flex:1; padding:{}; gap:{};",
        tokens::SPACE_L,
        tokens::SPACE_M,
    );

    let balance_style = format!(
        "font-family:{}; font-size:64px; font-weight:600; color:{}; \
         letter-spacing:0.02em; line-height:1;",
        tokens::FONT_NUMERIC,
        tokens::COLOR_FOREGROUND,
    );

    let label_style = format!(
        "font-size:{}; color:{};",
        tokens::TEXT_SM,
        tokens::COLOR_MUTED_FOREGROUND,
    );

    view! {
        <div style=container_style>
            <span style=label_style.clone()>"Total balance"</span>
            <span style=balance_style aria-label="placeholder balance">"— sats"</span>
            <span style=label_style>"Wallet UI coming soon."</span>
        </div>
    }
}
