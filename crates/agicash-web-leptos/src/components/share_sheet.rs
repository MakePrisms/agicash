//! `ShareSheet` — trigger the native Web Share API.
//!
//! Calls `navigator.share({title, text, url})`. When the browser doesn't
//! support `share()` (desktop Safari < 16, most desktop Firefox), falls
//! back to copying `url` to the clipboard and emitting a toast-able
//! success callback.
//!
//! This is a *trigger* component — it renders a [`crate::components::Button`]
//! that, on click, invokes the share intent. Visual is up to the caller
//! via the `children` slot (label / icon / both).
//!
//! Dataless — props/signals only.
//!
//! # Example
//!
//! ```rust,ignore
//! use leptos::prelude::*;
//! use agicash_web_leptos::components::{ShareSheet, SharePayload};
//!
//! #[component]
//! fn ShareInvoice(invoice: String) -> impl IntoView {
//!     view! {
//!         <ShareSheet
//!             payload=Signal::derive(move || SharePayload {
//!                 title: Some("Lightning invoice".into()),
//!                 text: None,
//!                 url: Some(invoice.clone()),
//!             })
//!             on_copied=Callback::new(|_| log::info!("copied to clipboard"))
//!         >
//!             "Share"
//!         </ShareSheet>
//!     }
//! }
//! ```

use leptos::prelude::*;

use crate::components::{Button, ButtonVariant};

/// Data passed to `navigator.share()`. All fields optional; pass at
/// least one (the platform rejects an empty share intent).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SharePayload {
    pub title: Option<String>,
    pub text: Option<String>,
    pub url: Option<String>,
}

/// Trigger button that opens the native share sheet, or copies to
/// clipboard as a fallback. See module docs for an example.
#[component]
pub fn ShareSheet(
    /// Payload, evaluated at click time so callers can derive it from
    /// reactive state.
    payload: Signal<SharePayload>,
    /// Fired when the clipboard fallback path runs. Useful for
    /// surfacing a toast.
    #[prop(into, optional)]
    on_copied: Option<Callback<()>>,
    /// Fired when an error path runs (no payload, share rejected,
    /// clipboard rejected). Receives a string message.
    #[prop(into, optional)]
    on_error: Option<Callback<String>>,
    /// Visual variant for the trigger button. Defaults to Secondary.
    #[prop(into, optional, default = ButtonVariant::Secondary)]
    variant: ButtonVariant,
    children: Children,
) -> impl IntoView {
    let on_click = move |_ev| {
        let payload = payload.get();
        share(payload, on_copied, on_error);
    };

    view! {
        <Button
            variant=variant
            on_click=Callback::new(on_click)
        >
            {children()}
        </Button>
    }
}

// ---- platform plumbing ----------------------------------------------------
//
// The actual `navigator.share` / `navigator.clipboard.writeText` calls only
// link against `wasm-bindgen` + `web-sys`, so they're gated behind
// `feature = "hydrate"`. The SSR build compiles the closure but never runs
// it (no browser).

#[cfg(feature = "hydrate")]
fn share(
    payload: SharePayload,
    on_copied: Option<Callback<()>>,
    on_error: Option<Callback<String>>,
) {
    use leptos::task::spawn_local;
    use wasm_bindgen::{JsCast, JsValue};
    use wasm_bindgen_futures::JsFuture;

    if payload.title.is_none() && payload.text.is_none() && payload.url.is_none() {
        if let Some(cb) = on_error {
            cb.run("empty share payload".to_string());
        }
        return;
    }

    let Some(window) = web_sys::window() else {
        if let Some(cb) = on_error {
            cb.run("no window".to_string());
        }
        return;
    };
    let navigator = window.navigator();

    // Detect `share()` via `Reflect::has` on the navigator object — typed
    // `web-sys` bindings would require a wider feature set than we want
    // to pull in.
    let nav_obj: &JsValue = navigator.as_ref();
    let has_share = js_sys::Reflect::has(nav_obj, &JsValue::from_str("share")).unwrap_or(false);

    if has_share {
        let data = web_sys::ShareData::new();
        if let Some(t) = payload.title.as_deref() {
            data.set_title(t);
        }
        if let Some(t) = payload.text.as_deref() {
            data.set_text(t);
        }
        if let Some(u) = payload.url.as_deref() {
            data.set_url(u);
        }

        let share_fn = js_sys::Reflect::get(nav_obj, &JsValue::from_str("share"))
            .ok()
            .and_then(|v| v.dyn_into::<js_sys::Function>().ok());

        if let Some(func) = share_fn {
            match func.call1(nav_obj, data.as_ref()) {
                Ok(val) => {
                    // `share()` returns a Promise; await it for error reporting.
                    if let Ok(promise) = val.dyn_into::<js_sys::Promise>() {
                        spawn_local(async move {
                            if let Err(err) = JsFuture::from(promise).await {
                                if let Some(cb) = on_error {
                                    cb.run(format!("share rejected: {err:?}"));
                                }
                            }
                        });
                    }
                    return;
                }
                Err(err) => {
                    if let Some(cb) = on_error {
                        cb.run(format!("share threw: {err:?}"));
                    }
                    return;
                }
            }
        }
    }

    // Fallback path — write `url` (or `text`) to the clipboard.
    let text_to_copy = payload.url.or(payload.text).or(payload.title);

    let Some(text) = text_to_copy else {
        if let Some(cb) = on_error {
            cb.run("nothing to copy".to_string());
        }
        return;
    };

    let clipboard = navigator.clipboard();
    let promise = clipboard.write_text(&text);
    spawn_local(async move {
        match JsFuture::from(promise).await {
            Ok(_) => {
                if let Some(cb) = on_copied {
                    cb.run(());
                }
            }
            Err(err) => {
                if let Some(cb) = on_error {
                    cb.run(format!("clipboard write failed: {err:?}"));
                }
            }
        }
    });
}

#[cfg(not(feature = "hydrate"))]
fn share(
    _payload: SharePayload,
    _on_copied: Option<Callback<()>>,
    _on_error: Option<Callback<String>>,
) {
    // SSR build never runs in a browser; the trigger button still renders.
}
