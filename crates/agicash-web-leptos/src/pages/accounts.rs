//! `/accounts` — accounts list + add-mint sub-route (placeholder).
//!
//! Mirrors iOS `AccountsView` + `AddMintView`. Phase 1 partial ships
//! stubs so the bottom nav can navigate here; lane Slice-12 wires the
//! real `WalletClient::list_accounts` + `add_mint` calls.
//!
//! Spec §8 nests further (`/accounts/:id`, `/accounts/:id/proofs`,
//! `/accounts/create/cashu`); those land in Phase 1 complete.

use leptos::prelude::*;
use leptos_router::components::A;

use crate::tokens;

#[component]
pub fn AccountsIndexPage() -> impl IntoView {
    view! {
        <div style=page_style()>
            <header style=header_style()>
                <h1 style=heading_style()>"Accounts"</h1>
                <A href="/accounts/add">
                    <span style=link_style()>"+ Add mint"</span>
                </A>
            </header>
            <p style=subtle_style()>
                "Account list lands here when Slice 12 WalletClient::list_accounts "
                "lands on master-merger."
            </p>
            <div style=empty_card_style()>"No accounts yet."</div>
        </div>
    }
}

#[component]
pub fn AccountsAddPage() -> impl IntoView {
    view! {
        <div style=page_style()>
            <header style=header_style()>
                <A href="/accounts">
                    <span style=link_style()>"← Back"</span>
                </A>
                <h1 style=heading_style()>"Add mint"</h1>
                <span/>
            </header>
            <p style=subtle_style()>
                "Mint URL form lands here when Slice 12 WalletClient::add_mint "
                "lands on master-merger."
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

fn header_style() -> String {
    format!(
        "display:flex; justify-content:space-between; align-items:center; gap:{};",
        tokens::SPACE_M,
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

fn link_style() -> String {
    format!(
        "color:{}; font-size:{}; text-decoration:underline; cursor:pointer;",
        tokens::COLOR_PRIMARY,
        tokens::TEXT_SM,
    )
}

fn empty_card_style() -> String {
    format!(
        "border:1px dashed {}; border-radius:{}; padding:{}; \
         color:{}; font-size:{}; text-align:center;",
        tokens::COLOR_BORDER,
        tokens::RADIUS_LG,
        tokens::SPACE_XXL,
        tokens::COLOR_MUTED_FOREGROUND,
        tokens::TEXT_SM,
    )
}
