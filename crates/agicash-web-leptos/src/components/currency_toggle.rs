//! `CurrencyToggle` — BTC ⇄ USD switcher pill.
//!
//! Two-segment pill control used inside the numpad header (and any
//! amount-entry surface). Visual matches the iOS amount entry view:
//! a rounded container with two equal-width segments, the active one
//! filled with `colour-primary` and the inactive ghosted.
//!
//! Dataless — the parent owns the `RwSignal<Currency>`. Default variant
//! is BTC.
//!
//! # Example
//!
//! ```rust,ignore
//! use leptos::prelude::*;
//! use agicash_web_leptos::components::{Currency, CurrencyToggle};
//!
//! #[component]
//! fn AmountHeader() -> impl IntoView {
//!     let currency = RwSignal::new(Currency::Btc);
//!     view! {
//!         <CurrencyToggle value=currency />
//!     }
//! }
//! ```

use leptos::prelude::*;

use crate::tokens;

/// Currency the toggle exposes. Add more variants by extending this
/// enum and the [`CurrencyToggle`] view simultaneously.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Currency {
    /// Bitcoin (sats under the hood).
    #[default]
    Btc,
    /// United States dollar.
    Usd,
}

impl Currency {
    /// Short label rendered inside the segment.
    #[must_use]
    pub fn label(self) -> &'static str {
        match self {
            Currency::Btc => "BTC",
            Currency::Usd => "USD",
        }
    }
}

/// Reusable BTC/USD toggle. See module docs for an example.
#[component]
pub fn CurrencyToggle(
    /// Two-way binding. The toggle reads and writes this signal directly.
    value: RwSignal<Currency>,
) -> impl IntoView {
    let on_btc = move |_| value.set(Currency::Btc);
    let on_usd = move |_| value.set(Currency::Usd);

    view! {
        <div
            role="group"
            aria-label="Currency"
            style=container_style()
        >
            <button
                type="button"
                aria-pressed=move || (value.get() == Currency::Btc).to_string()
                style=move || segment_style(value.get() == Currency::Btc)
                on:click=on_btc
            >
                {Currency::Btc.label()}
            </button>
            <button
                type="button"
                aria-pressed=move || (value.get() == Currency::Usd).to_string()
                style=move || segment_style(value.get() == Currency::Usd)
                on:click=on_usd
            >
                {Currency::Usd.label()}
            </button>
        </div>
    }
}

fn container_style() -> String {
    format!(
        "display:inline-flex; padding:2px; gap:2px; \
         background:{muted}; border-radius:{radius}; \
         font-family:{font};",
        muted = tokens::COLOR_MUTED,
        radius = tokens::RADIUS_LG,
        font = tokens::FONT_PRIMARY,
    )
}

fn segment_style(active: bool) -> String {
    let (bg, fg) = if active {
        (tokens::COLOR_PRIMARY, tokens::COLOR_PRIMARY_FOREGROUND)
    } else {
        ("transparent", tokens::COLOR_MUTED_FOREGROUND)
    };
    format!(
        "min-width:56px; height:28px; padding:0 {pad}; \
         display:inline-flex; align-items:center; justify-content:center; \
         border:none; border-radius:{radius}; cursor:pointer; \
         background:{bg}; color:{fg}; \
         font-size:{text}; font-weight:600; letter-spacing:0.04em; \
         transition:background 150ms ease, color 150ms ease; \
         -webkit-tap-highlight-color:transparent;",
        pad = tokens::SPACE_M,
        radius = tokens::RADIUS_MD,
        text = tokens::TEXT_SM,
    )
}
