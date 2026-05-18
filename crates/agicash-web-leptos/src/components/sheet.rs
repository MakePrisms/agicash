//! `Sheet` — bottom sheet modal.
//!
//! Visual analogue of iOS `.sheet(isPresented:)` (`HomeView.swift` L48,
//! `AccountsView.swift` L79). Backdrop + slide-up panel + tap-backdrop
//! to dismiss + ESC to dismiss. Drag-to-dismiss is intentionally out of
//! MVP (filed as a follow-up — needs touch event plumbing).
//!
//! Dataless — controlled by an `RwSignal<bool>` the parent owns.
//!
//! # Example
//!
//! ```rust,ignore
//! use leptos::prelude::*;
//! use agicash_web_leptos::components::Sheet;
//!
//! #[component]
//! fn ReceiveTrigger() -> impl IntoView {
//!     let open = RwSignal::new(false);
//!     view! {
//!         <button on:click=move |_| open.set(true)>"Receive"</button>
//!         <Sheet open=open title="Receive".to_string()>
//!             <p>"Sheet body goes here"</p>
//!         </Sheet>
//!     }
//! }
//! ```

use leptos::ev::{KeyboardEvent, MouseEvent};
use leptos::prelude::*;

use crate::tokens;

/// Bottom-sheet modal. See module docs for an example.
#[component]
pub fn Sheet(
    /// Open/closed state. Two-way: parent sets to open; the sheet sets
    /// to `false` when the user dismisses.
    open: RwSignal<bool>,
    /// Optional title rendered in the sheet header. When `None` the
    /// header strip still shows the drag-affordance pill.
    #[prop(into, optional)]
    title: Option<String>,
    /// When `true` (default), tapping the backdrop dismisses. Set to
    /// `false` for required flows that must complete first.
    #[prop(into, optional, default = Signal::derive(|| true))]
    dismiss_on_backdrop: Signal<bool>,
    children: ChildrenFn,
) -> impl IntoView {
    let close = move || open.set(false);

    let on_backdrop = move |ev: MouseEvent| {
        // Ignore clicks bubbling from the panel itself — only the actual
        // backdrop element dismisses.
        if ev.target() == ev.current_target() && dismiss_on_backdrop.get() {
            close();
        }
    };

    let on_keydown = move |ev: KeyboardEvent| {
        if ev.key() == "Escape" {
            close();
        }
    };

    // `Show` toggles the subtree without rebuilding it every tick.
    view! {
        <Show when=move || open.get() fallback=|| ()>
            <div
                role="dialog"
                aria-modal="true"
                style=backdrop_style()
                on:click=on_backdrop
                on:keydown=on_keydown
                tabindex="-1"
            >
                <div style=panel_style()>
                    <div style=handle_style() aria-hidden="true"></div>
                    {title.clone().map(|t| view! {
                        <div style=title_style()>{t}</div>
                    })}
                    <div style=body_style()>
                        {children()}
                    </div>
                </div>
            </div>
        </Show>
    }
}

fn backdrop_style() -> String {
    "position:fixed; inset:0; z-index:50; \
     display:flex; align-items:flex-end; justify-content:center; \
     background:rgba(0,0,0,0.4); \
     animation:agicash-fade-in 180ms ease;"
        .to_string()
}

fn panel_style() -> String {
    format!(
        "width:100%; max-width:560px; \
         background:{bg}; color:{fg}; \
         border-top-left-radius:16px; border-top-right-radius:16px; \
         padding:{pad_top} {pad_x} {pad_bottom}; \
         box-shadow:0 -8px 32px rgba(0,0,0,0.15); \
         animation:agicash-slide-up 220ms cubic-bezier(0.2, 0.8, 0.2, 1); \
         max-height:90vh; overflow-y:auto;",
        bg = tokens::COLOR_CARD,
        fg = tokens::COLOR_CARD_FOREGROUND,
        pad_top = tokens::SPACE_S,
        pad_x = tokens::SPACE_XXL,
        pad_bottom = tokens::SPACE_XXL,
    )
}

fn handle_style() -> String {
    format!(
        "width:36px; height:4px; border-radius:2px; \
         background:{border}; \
         margin:0 auto {space} auto;",
        border = tokens::COLOR_BORDER,
        space = tokens::SPACE_L,
    )
}

fn title_style() -> String {
    format!(
        "font-size:{size}; font-weight:600; margin:0 0 {space} 0; color:{fg};",
        size = tokens::TEXT_LG,
        space = tokens::SPACE_L,
        fg = tokens::COLOR_CARD_FOREGROUND,
    )
}

fn body_style() -> String {
    format!(
        "display:flex; flex-direction:column; gap:{};",
        tokens::SPACE_L,
    )
}
