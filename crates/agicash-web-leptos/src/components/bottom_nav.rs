//! `BottomNav` — fixed-position 5-tab nav bar at the bottom of the
//! protected app shell.
//!
//! iOS uses a two-tab pattern (Home / Settings) with Receive, Send, and
//! Accounts surfaced as sheets / drill-downs. The web has stable URLs
//! for `/receive`, `/send`, `/accounts`, `/settings` already (spec §8),
//! so we lift the discoverable surface up into a flat 5-tab bar — the
//! mobile-PWA convention. Order matches a primary-action arc:
//! Home → Receive → Send → Accounts → Settings.
//!
//! Active tab is computed from the URL prefix so that nested routes
//! (e.g. `/accounts/add`) keep their parent tab highlighted.
//!
//! TODO: replace with L3 component (this is a minimal inline stub; lane
//! L3 is building shared button / nav primitives in parallel).

use leptos::prelude::*;
use leptos_router::components::A;
use leptos_router::hooks::use_location;

use crate::tokens;

/// One tab entry. `href` is the destination; `prefix` is the path
/// prefix that, when matched, lights this tab up. `prefix == "/"`
/// (Home) is an exact-match special case — every other path also
/// starts with `/`.
struct Tab {
    href: &'static str,
    prefix: &'static str,
    label: &'static str,
    /// Plain text glyph rather than an icon font — Phase 1 placeholder.
    /// L3 will swap for proper SVG icons once the primitive ships.
    glyph: &'static str,
}

const TABS: &[Tab] = &[
    Tab {
        href: "/",
        prefix: "/",
        label: "Home",
        glyph: "·",
    },
    Tab {
        href: "/receive",
        prefix: "/receive",
        label: "Receive",
        glyph: "↓",
    },
    Tab {
        href: "/send",
        prefix: "/send",
        label: "Send",
        glyph: "↑",
    },
    Tab {
        href: "/accounts",
        prefix: "/accounts",
        label: "Accounts",
        glyph: "◇",
    },
    Tab {
        href: "/settings",
        prefix: "/settings",
        label: "Settings",
        glyph: "⚙",
    },
];

fn is_active(pathname: &str, prefix: &str) -> bool {
    if prefix == "/" {
        pathname == "/"
    } else {
        pathname == prefix || pathname.starts_with(&format!("{prefix}/"))
    }
}

#[component]
pub fn BottomNav() -> impl IntoView {
    let location = use_location();

    let nav_style = format!(
        "position:fixed; bottom:0; left:0; right:0; height:64px; \
         display:flex; align-items:stretch; justify-content:space-around; \
         background:{}; border-top:1px solid {}; \
         font-family:{}; z-index:50; \
         padding-bottom:env(safe-area-inset-bottom);",
        tokens::COLOR_BACKGROUND,
        tokens::COLOR_BORDER,
        tokens::FONT_PRIMARY,
    );

    view! {
        <nav style=nav_style aria-label="Primary">
            {TABS.iter().map(|tab| {
                let href = tab.href;
                let prefix = tab.prefix;
                let label = tab.label;
                let glyph = tab.glyph;
                let active = Memo::new(move |_| is_active(&location.pathname.get(), prefix));
                view! {
                    <A href=href>
                        <span
                            style=move || tab_item_style(active.get())
                            aria-current=move || if active.get() { "page" } else { "" }
                        >
                            <span style=glyph_style()>{glyph}</span>
                            <span style=label_style()>{label}</span>
                        </span>
                    </A>
                }
            }).collect_view()}
        </nav>
    }
}

fn tab_item_style(active: bool) -> String {
    let color = if active {
        tokens::COLOR_PRIMARY
    } else {
        tokens::COLOR_MUTED_FOREGROUND
    };
    format!(
        "display:flex; flex-direction:column; align-items:center; \
         justify-content:center; gap:2px; padding:{} {}; height:100%; \
         flex:1 1 0; min-width:0; color:{}; text-decoration:none;",
        tokens::SPACE_XS,
        tokens::SPACE_S,
        color,
    )
}

fn glyph_style() -> &'static str {
    "font-size:18px; line-height:1;"
}

fn label_style() -> &'static str {
    "font-size:11px; line-height:1; letter-spacing:0.02em;"
}

// Style + active state for the wrapping `<A/>` link. leptos_router's
// `<A/>` renders an `<a>` directly; the inner `<span>` carries the
// flex layout so the entire tab is clickable as one unit.

#[cfg(test)]
mod tests {
    use super::is_active;

    #[test]
    fn home_active_only_on_root() {
        assert!(is_active("/", "/"));
        assert!(!is_active("/receive", "/"));
        assert!(!is_active("/accounts", "/"));
    }

    #[test]
    fn parent_active_on_nested() {
        assert!(is_active("/accounts", "/accounts"));
        assert!(is_active("/accounts/add", "/accounts"));
        assert!(is_active("/settings/appearance", "/settings"));
    }

    #[test]
    fn parent_inactive_on_sibling() {
        assert!(!is_active("/receive", "/send"));
        assert!(!is_active("/account", "/accounts")); // no false-substring match
    }
}
