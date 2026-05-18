//! `/settings` — settings hub + sub-routes (placeholder).
//!
//! Mirrors iOS `SettingsView` (accounts shortcut, sign-out, navigation
//! to profile / appearance / contacts). Phase 1 partial ships the index
//! plus three sub-routes as stubs. iOS surfaces Accounts under Settings;
//! the web nav promotes Accounts to a top-level tab, but Settings keeps
//! a deep-link to `/accounts` for parity.
//!
//! Spec §8 enumerates `/settings/appearance`, `/settings/profile/edit`,
//! `/settings/contacts`, `/settings/contacts/:id`; first three are stubbed
//! here. Real wiring lands in Phase 2.

use leptos::prelude::*;
use leptos_router::components::A;

use crate::tokens;

#[component]
pub fn SettingsIndexPage() -> impl IntoView {
    view! {
        <div style=page_style()>
            <h1 style=heading_style()>"Settings"</h1>
            <ul style=list_style()>
                <SettingsLink href="/accounts" label="Accounts"/>
                <SettingsLink href="/settings/profile" label="Profile"/>
                <SettingsLink href="/settings/appearance" label="Appearance"/>
                <SettingsLink href="/settings/contacts" label="Contacts"/>
            </ul>
            <button style=signout_button_style() disabled=true>
                "Sign out (wires in Slice 12)"
            </button>
        </div>
    }
}

#[component]
pub fn SettingsProfilePage() -> impl IntoView {
    settings_stub("Profile", "Edit display name and email.")
}

#[component]
pub fn SettingsAppearancePage() -> impl IntoView {
    settings_stub(
        "Appearance",
        "Light / dark / system theme switcher lands here (Phase 2).",
    )
}

#[component]
pub fn SettingsContactsPage() -> impl IntoView {
    settings_stub(
        "Contacts",
        "Lightning-address contact list lands here (Phase 2).",
    )
}

#[component]
fn SettingsLink(href: &'static str, label: &'static str) -> impl IntoView {
    view! {
        <li style=item_style()>
            <A href=href>
                <span style=row_style()>
                    <span>{label}</span>
                    <span style=chevron_style()>"›"</span>
                </span>
            </A>
        </li>
    }
}

fn settings_stub(title: &'static str, body: &'static str) -> impl IntoView {
    view! {
        <div style=page_style()>
            <header style=header_style()>
                <A href="/settings">
                    <span style=link_style()>"← Settings"</span>
                </A>
                <h1 style=heading_style()>{title}</h1>
                <span/>
            </header>
            <p style=subtle_style()>{body}</p>
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

fn header_style() -> String {
    format!(
        "display:flex; justify-content:space-between; align-items:center; gap:{};",
        tokens::SPACE_M,
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

fn list_style() -> &'static str {
    "list-style:none; padding:0; margin:0; display:flex; flex-direction:column;"
}

fn item_style() -> String {
    format!("border-bottom:1px solid {};", tokens::COLOR_BORDER)
}

fn row_style() -> String {
    format!(
        "display:flex; justify-content:space-between; align-items:center; \
         padding:{} 0; color:{}; text-decoration:none; cursor:pointer;",
        tokens::SPACE_M,
        tokens::COLOR_FOREGROUND,
    )
}

fn chevron_style() -> String {
    format!("color:{};", tokens::COLOR_MUTED_FOREGROUND)
}

fn signout_button_style() -> String {
    format!(
        "margin-top:{}; padding:{} {}; border-radius:{}; \
         border:1px solid {}; background:transparent; color:{}; \
         font-family:inherit; font-size:{}; cursor:not-allowed; opacity:0.6;",
        tokens::SPACE_XL,
        tokens::SPACE_M,
        tokens::SPACE_L,
        tokens::RADIUS_MD,
        tokens::COLOR_BORDER,
        tokens::COLOR_DESTRUCTIVE,
        tokens::TEXT_SM,
    )
}
