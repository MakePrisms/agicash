//! `/send` — send hub (placeholder).
//!
//! Phase 1 partial: stub. Worker B is adding the iOS send UI in the
//! sibling Slice 6/8 FFI thread; once Slice 12 `WalletClient::send_*`
//! lands the real `<SendForm/>` slots in here. Sub-routes `/send/confirm`,
//! `/send/scan`, `/send/share/:swapId` will land in Phase 1 complete.
//!
//! TODO: replace placeholder body with the L3 page primitive once that
//! ships.

use leptos::prelude::*;

use crate::tokens;

#[component]
pub fn SendPage() -> impl IntoView {
    view! {
        <div style=page_style()>
            <h1 style=heading_style()>"Send"</h1>
            <p style=subtle_style()>
                "Cashu token + Lightning send flows land here when Slice 12 "
                "WalletClient lands on master-merger."
            </p>
        </div>
    }
}

fn page_style() -> String {
    format!(
        "display:flex; flex-direction:column; gap:{}; padding:{};",
        tokens::SPACE_L,
        tokens::SPACE_XL,
    )
}

fn heading_style() -> String {
    format!(
        "font-size:{}; font-weight:600; margin:0; color:{};",
        tokens::TEXT_2XL,
        tokens::COLOR_FOREGROUND,
    )
}

fn subtle_style() -> String {
    format!(
        "font-size:{}; color:{}; margin:0;",
        tokens::TEXT_SM,
        tokens::COLOR_MUTED_FOREGROUND,
    )
}
