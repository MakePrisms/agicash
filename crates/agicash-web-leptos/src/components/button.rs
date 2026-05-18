//! `Button` — reusable button primitive.
//!
//! Visual analogue of `ios/Agicash/Agicash/DesignSystem/BrandButton.swift`
//! and the React `app/components/ui/button.tsx`. Four variants and two
//! sizes cover every CTA / inline action / "back" in the iOS app. Loading
//! state preserves the rendered height (label hidden, spinner overlaid)
//! so the button never jumps mid-press.
//!
//! Dataless primitive — takes props/signals only; no fetch, no context.
//!
//! # Example
//!
//! ```rust,ignore
//! use leptos::prelude::*;
//! use agicash_web_leptos::components::{Button, ButtonVariant, ButtonSize};
//!
//! #[component]
//! fn Demo() -> impl IntoView {
//!     let loading = RwSignal::new(false);
//!     view! {
//!         <Button
//!             variant=ButtonVariant::Primary
//!             size=ButtonSize::Large
//!             loading=loading.into()
//!             on_click=move |_| loading.set(true)
//!         >
//!             "Continue"
//!         </Button>
//!     }
//! }
//! ```

use leptos::ev::MouseEvent;
use leptos::prelude::*;

use crate::tokens;

/// Visual variant for [`Button`]. Maps 1:1 to `BrandButton.Variant` on iOS.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ButtonVariant {
    /// `bg-primary text-primary-foreground` — solid CTA. Default.
    #[default]
    Primary,
    /// Outlined card — used for secondary actions like Receive / Buy on home.
    Secondary,
    /// `bg-destructive` — sign-out, delete, destructive confirmations.
    Destructive,
    /// Borderless — back buttons, inline actions.
    Ghost,
}

/// Tappable size for [`Button`].
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ButtonSize {
    /// `h-10 px-4` — default. Matches iOS `.medium`.
    #[default]
    Medium,
    /// `h-13 px-8` — chunky CTA used on the home screen. Matches iOS `.large`.
    Large,
}

/// Reusable button primitive. See module docs for an example.
///
/// `loading` and `disabled` are `Signal<bool>` so callers can drive them
/// from a `RwSignal` or a derived `Memo`. Both short-circuit the click
/// handler. `loading` hides the label and overlays a spinner; `disabled`
/// fades the button to 50 % opacity.
#[component]
pub fn Button(
    /// Visual variant.
    #[prop(into, optional)]
    variant: ButtonVariant,
    /// Tappable size.
    #[prop(into, optional)]
    size: ButtonSize,
    /// When `true`, hides the label and overlays a spinner. Click handler
    /// becomes a no-op.
    #[prop(into, optional)]
    loading: Signal<bool>,
    /// When `true`, fades to 50 % opacity and disables the click handler.
    #[prop(into, optional)]
    disabled: Signal<bool>,
    /// Optional `aria-label` for icon-only or otherwise opaque buttons.
    #[prop(into, optional)]
    aria_label: Option<String>,
    /// Click handler. Suppressed when `loading` or `disabled` is `true`.
    #[prop(into, optional)]
    on_click: Option<Callback<MouseEvent>>,
    /// Button label (text, icon, or any view).
    children: Children,
) -> impl IntoView {
    let style = move || button_style(variant, size, loading.get(), disabled.get());

    let handle_click = move |ev: MouseEvent| {
        if loading.get() || disabled.get() {
            return;
        }
        if let Some(cb) = on_click {
            cb.run(ev);
        }
    };

    view! {
        <button
            style=style
            disabled=move || loading.get() || disabled.get()
            aria-label=aria_label
            on:click=handle_click
        >
            // Hidden label preserves rendered height while spinner shows.
            <span style=move || {
                format!(
                    "visibility:{};",
                    if loading.get() { "hidden" } else { "visible" },
                )
            }>
                {children()}
            </span>
            {move || loading.get().then(|| view! {
                <span
                    aria-hidden="true"
                    style=spinner_style(variant)
                />
            })}
        </button>
    }
}

fn button_style(variant: ButtonVariant, size: ButtonSize, loading: bool, disabled: bool) -> String {
    let (bg, fg, border) = colors(variant);
    let (height, padding, text) = match size {
        ButtonSize::Medium => ("40px", tokens::SPACE_L, tokens::TEXT_SM),
        ButtonSize::Large => ("52px", tokens::SPACE_XXL, tokens::TEXT_LG),
    };
    let opacity = if disabled { "0.5" } else { "1" };
    let cursor = if disabled || loading {
        "not-allowed"
    } else {
        "pointer"
    };
    format!(
        "position:relative; display:inline-flex; align-items:center; \
         justify-content:center; width:100%; height:{height}; \
         padding:0 {padding}; border-radius:{radius}; \
         font-size:{text}; font-weight:500; font-family:inherit; \
         background:{bg}; color:{fg}; border:1px solid {border}; \
         cursor:{cursor}; opacity:{opacity}; \
         transition:opacity 150ms ease, transform 80ms ease; \
         -webkit-tap-highlight-color:transparent;",
        radius = tokens::RADIUS_MD,
    )
}

fn colors(variant: ButtonVariant) -> (&'static str, &'static str, &'static str) {
    match variant {
        ButtonVariant::Primary => (
            tokens::COLOR_PRIMARY,
            tokens::COLOR_PRIMARY_FOREGROUND,
            tokens::COLOR_PRIMARY,
        ),
        ButtonVariant::Secondary => (
            tokens::COLOR_CARD,
            tokens::COLOR_CARD_FOREGROUND,
            tokens::COLOR_BORDER,
        ),
        ButtonVariant::Destructive => (
            tokens::COLOR_DESTRUCTIVE,
            tokens::COLOR_PRIMARY_FOREGROUND,
            tokens::COLOR_DESTRUCTIVE,
        ),
        ButtonVariant::Ghost => ("transparent", tokens::COLOR_FOREGROUND, "transparent"),
    }
}

/// CSS for the centred spinner overlay. Uses a CSS `@keyframes` defined
/// in `style/main.css` (`agicash-spin`).
fn spinner_style(variant: ButtonVariant) -> String {
    let (_, fg, _) = colors(variant);
    format!(
        "position:absolute; top:50%; left:50%; width:16px; height:16px; \
         margin:-8px 0 0 -8px; border:2px solid {fg}; \
         border-top-color:transparent; border-radius:50%; \
         animation:agicash-spin 0.7s linear infinite;",
    )
}
