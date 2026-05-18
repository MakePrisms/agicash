//! `/send` — send carousel page (Cashu / Lightning / LN-Address).
//!
//! Mirror of iOS `SendCarouselView` (`ios/Agicash/Agicash/SendCarouselView.swift`).
//! Three-tab carousel; tab bar at the bottom doubles as page indicator.
//! Visual treatment matches iOS 1:1 via the `tokens::*` design tokens.
//!
//! Tab content (per the iOS lane Worker B shipped):
//!   - **Cashu** — full state-machine send flow ([`SendCashuView`]). The
//!     SDK boundary is mocked behind `// TODO[slice-13]` markers because
//!     `agicash-cashu::send_swap::*` isn't wasm-clean yet (the storage
//!     trait pulls in rustls/tokio-net via `agicash-storage-supabase`).
//!     Once the storage-supabase wasm port lands the mock callers swap
//!     out for real `WalletClient` calls — see the marker sites in
//!     [`crate::components::SendCashuView`].
//!   - **Lightning** — "Coming soon" placeholder. NUT-05 melt-quote +
//!     LDK invoice pay live in `agicash-cashu` but aren't wasm-routed
//!     yet.
//!   - **Lightning Address** — "Coming soon" placeholder. LUD-16 +
//!     LNURL-pay resolution lives in `agicash-lightning-address` but
//!     ditto, no wasm route.
//!
//! Navigation: simple tab-bar + conditional rendering (no gesture-swipe
//! in v0). The `spike/leptos-view-transitions` spike is intentionally
//! NOT inherited per the lane brief — productionizing the spike is a
//! separate lane.

use leptos::either::Either;
use leptos::prelude::*;

use crate::components::SendCashuView;
use crate::tokens;

/// Tabs the Send carousel supports. Mirrors iOS `SendTab` 1:1.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SendTab {
    Cashu,
    Lightning,
    LightningAddress,
}

impl SendTab {
    const ALL: [Self; 3] = [Self::Cashu, Self::Lightning, Self::LightningAddress];

    const fn title(self) -> &'static str {
        match self {
            Self::Cashu => "Send Cashu",
            Self::Lightning => "Send Lightning",
            Self::LightningAddress => "Send to address",
        }
    }

    const fn accessibility_label(self) -> &'static str {
        match self {
            Self::Cashu => "Send Cashu token",
            Self::Lightning => "Send over Lightning",
            Self::LightningAddress => "Send to Lightning Address",
        }
    }
}

#[component]
pub fn SendPage() -> impl IntoView {
    let selected: RwSignal<SendTab> = RwSignal::new(SendTab::Cashu);

    view! {
        <div style=page_style()>
            <Header selected=selected/>

            <div style=body_style()>
                {move || match selected.get() {
                    SendTab::Cashu => {
                        Either::Left(view! { <SendCashuView/> })
                    }
                    SendTab::Lightning => Either::Right(Either::Left(
                        view! {
                            <PlaceholderPane label="Lightning send".to_string()>
                                <BoltIcon/>
                            </PlaceholderPane>
                        },
                    )),
                    SendTab::LightningAddress => Either::Right(Either::Right(
                        view! {
                            <PlaceholderPane label="Lightning Address".to_string()>
                                <AtIcon/>
                            </PlaceholderPane>
                        },
                    )),
                }}
            </div>

            <TabBar selected=selected/>
        </div>
    }
}

// ---- Header --------------------------------------------------------------

#[component]
fn Header(selected: RwSignal<SendTab>) -> impl IntoView {
    let bar_style = format!(
        "display:flex; align-items:center; justify-content:space-between; \
         padding:{pad_v} {pad_h}; border-bottom:1px solid {border}; \
         background:{bg};",
        pad_v = tokens::SPACE_M,
        pad_h = tokens::SPACE_L,
        border = tokens::COLOR_BORDER,
        bg = tokens::COLOR_BACKGROUND,
    );
    let back_style = format!(
        "font-size:{size}; color:{fg}; text-decoration:none; cursor:pointer;",
        size = tokens::TEXT_SM,
        fg = tokens::COLOR_MUTED_FOREGROUND,
    );
    let title_style = format!(
        "font-size:{size}; font-weight:600; margin:0; color:{fg};",
        size = tokens::TEXT_LG,
        fg = tokens::COLOR_FOREGROUND,
    );

    view! {
        <div style=bar_style>
            <a href="/" style=back_style aria-label="Close">"← Close"</a>
            <h1 style=title_style>{move || selected.get().title()}</h1>
            // Spacer for symmetry with the back link so the title sits centred.
            <span style="width:60px;"/>
        </div>
    }
}

// ---- Tab bar -------------------------------------------------------------

#[component]
fn TabBar(selected: RwSignal<SendTab>) -> impl IntoView {
    let bar_style = format!(
        "display:flex; align-items:stretch; \
         padding:{pad_v} {pad_h}; border-top:1px solid {border}; \
         background:{bg};",
        pad_v = tokens::SPACE_S,
        pad_h = tokens::SPACE_L,
        border = tokens::COLOR_BORDER,
        bg = tokens::COLOR_BACKGROUND,
    );

    view! {
        <div style=bar_style role="tablist">
            {SendTab::ALL.iter().copied().map(|tab| view! {
                <TabButton tab=tab selected=selected/>
            }).collect_view()}
        </div>
    }
}

#[component]
fn TabButton(tab: SendTab, selected: RwSignal<SendTab>) -> impl IntoView {
    let is_selected = move || selected.get() == tab;
    let style = move || {
        let color = if is_selected() {
            tokens::COLOR_FOREGROUND
        } else {
            tokens::COLOR_MUTED_FOREGROUND
        };
        format!(
            "flex:1; display:inline-flex; align-items:center; \
             justify-content:center; height:40px; border:none; \
             background:transparent; color:{color}; cursor:pointer; \
             -webkit-tap-highlight-color:transparent; \
             opacity:{opacity};",
            opacity = if is_selected() { "1" } else { "0.4" },
        )
    };

    view! {
        <button
            type="button"
            role="tab"
            aria-selected=move || is_selected().to_string()
            aria-label=tab.accessibility_label()
            style=style
            on:click=move |_| selected.set(tab)
        >
            {match tab {
                SendTab::Cashu => view! { <BanknoteIcon size=22/> }.into_any(),
                SendTab::Lightning => view! { <BoltIcon size=22/> }.into_any(),
                SendTab::LightningAddress => view! { <AtIcon size=22/> }.into_any(),
            }}
        </button>
    }
}

// ---- Placeholder pane ----------------------------------------------------

/// Body for the Lightning / Lightning-Address tabs. Mirrors iOS
/// `LightningSendPlaceholderView` + `LightningAddressSendPlaceholderView`.
/// Icon passed as `children` (the SVG glyph element) so callers can swap
/// in any of the local icon components without an extra prop type.
#[component]
fn PlaceholderPane(label: String, children: Children) -> impl IntoView {
    let pane_style = format!(
        "display:flex; flex-direction:column; align-items:center; \
         justify-content:center; gap:{gap}; flex:1; padding:{pad};",
        gap = tokens::SPACE_L,
        pad = tokens::SPACE_L,
    );
    let title_style = format!(
        "font-size:{size}; font-weight:600; margin:0; color:{fg};",
        size = tokens::TEXT_LG,
        fg = tokens::COLOR_CARD_FOREGROUND,
    );
    let caption_style = format!(
        "font-size:{size}; color:{fg}; margin:0;",
        size = tokens::TEXT_SM,
        fg = tokens::COLOR_MUTED_FOREGROUND,
    );
    let icon_wrap_style = format!("color:{fg};", fg = tokens::COLOR_MUTED_FOREGROUND,);

    view! {
        <div style=pane_style>
            <span style=icon_wrap_style>{children()}</span>
            <h2 style=title_style>{label}</h2>
            <p style=caption_style>"Coming soon"</p>
        </div>
    }
}

// ---- Page chrome helpers --------------------------------------------------

fn page_style() -> String {
    format!(
        "display:flex; flex-direction:column; min-height:100dvh; \
         background:{bg}; color:{fg}; font-family:{font};",
        bg = tokens::COLOR_BACKGROUND,
        fg = tokens::COLOR_FOREGROUND,
        font = tokens::FONT_PRIMARY,
    )
}

fn body_style() -> String {
    "display:flex; flex-direction:column; flex:1; min-height:0;".to_string()
}

// ---- Inline SVG icons -----------------------------------------------------
// Lightweight hand-rolled 24×24 icons. iOS uses SF Symbols (`banknote`,
// `bolt.fill`, `at`); the web doesn't have SF Symbols, and pulling in an
// icon font for three glyphs would bloat the wasm bundle.

/// `banknote`-equivalent icon — Cashu tab.
#[component]
fn BanknoteIcon(#[prop(optional, default = 48)] size: u32) -> impl IntoView {
    view! {
        <svg
            width=size
            height=size
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
        >
            <rect x="2" y="6" width="20" height="12" rx="2"/>
            <circle cx="12" cy="12" r="3"/>
            <line x1="6" y1="12" x2="6" y2="12.01"/>
            <line x1="18" y1="12" x2="18" y2="12.01"/>
        </svg>
    }
}

/// `bolt.fill`-equivalent icon — Lightning tab.
#[component]
fn BoltIcon(#[prop(optional, default = 48)] size: u32) -> impl IntoView {
    view! {
        <svg
            width=size
            height=size
            viewBox="0 0 24 24"
            fill="currentColor"
            stroke="none"
            aria-hidden="true"
        >
            <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/>
        </svg>
    }
}

/// `at`-equivalent icon — Lightning Address tab.
#[component]
fn AtIcon(#[prop(optional, default = 48)] size: u32) -> impl IntoView {
    view! {
        <svg
            width=size
            height=size
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
        >
            <circle cx="12" cy="12" r="4"/>
            <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.9 7.9"/>
        </svg>
    }
}
