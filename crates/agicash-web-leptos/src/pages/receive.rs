//! `/receive` — receive carousel index (placeholder).
//!
//! Mirrors iOS `ReceiveCarouselView` (banknote / lightning / dollar tabs
//! plus amount numpad). Phase 1 partial ships the route as a stub so the
//! bottom nav can navigate to it; lane L4 will fill the paste-token
//! sub-route (`/receive/cashu/token`) and lane Slice-12 wires the
//! real mint-quote / lightning-receive flows.
//!
//! TODO: replace placeholder body with the L3 page primitive (header,
//! safe-area-aware scroll body) once that ships.

use leptos::prelude::*;

use crate::tokens;

#[component]
pub fn ReceivePage() -> impl IntoView {
    let style = page_style();
    view! {
        <div style=style>
            <h1 style=heading_style()>"Receive"</h1>
            <p style=subtle_style()>
                "Banknote, Lightning, and Dollar tabs land here. "
                "Sibling lane wires the cashu-token paste flow at "
                <code>"/receive/cashu/token"</code>"."
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
