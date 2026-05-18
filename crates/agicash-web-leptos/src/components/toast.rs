//! `Toast` — transient feedback messages.
//!
//! Pattern modelled on shadcn `useToast` (the web app's
//! `app/components/ui/toaster.tsx`). A [`ToastProvider`] near the root
//! of the tree owns the queue; descendants pull `use_toast()` from
//! context and push new toasts. The provider renders the stack itself
//! (top-right by default, single column).
//!
//! Auto-dismiss after N seconds (default 4). Queue is FIFO with no
//! cap — callers are expected not to spam (the UI naturally caps the
//! visible count by viewport height).
//!
//! Dataless — the queue lives in a `RwSignal<Vec<ToastEntry>>` inside
//! the provider's context. Each entry has a stable `id` so the view
//! can `<For/>` cleanly without flicker.
//!
//! # Example
//!
//! ```rust,ignore
//! use leptos::prelude::*;
//! use agicash_web_leptos::components::{ToastProvider, ToastVariant, use_toast};
//!
//! #[component]
//! fn App() -> impl IntoView {
//!     view! {
//!         <ToastProvider>
//!             <SomeChild/>
//!         </ToastProvider>
//!     }
//! }
//!
//! #[component]
//! fn SomeChild() -> impl IntoView {
//!     let toast = use_toast();
//!     view! {
//!         <button on:click=move |_| toast.push("Saved!", ToastVariant::Success)>
//!             "Save"
//!         </button>
//!     }
//! }
//! ```

use leptos::prelude::*;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::tokens;

/// Default auto-dismiss duration. Matches the iOS HUD timing the design
/// uses for "Copied" confirmations.
pub const DEFAULT_DURATION_MS: u32 = 4_000;

/// Toast visual variant.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ToastVariant {
    /// Neutral info.
    #[default]
    Info,
    /// Green check — copy succeeded, send succeeded.
    Success,
    /// Red border — send failed.
    Error,
}

/// One toast in the queue.
#[derive(Clone, Debug)]
pub struct ToastEntry {
    pub id: u64,
    pub message: String,
    pub variant: ToastVariant,
}

/// Context handle returned by [`use_toast`]. Cheap to clone — wraps a
/// `RwSignal`.
#[derive(Clone, Copy, Debug)]
pub struct ToastHandle {
    queue: RwSignal<Vec<ToastEntry>>,
    duration_ms: u32,
}

impl ToastHandle {
    /// Enqueue a toast. Returns its assigned id (useful if callers want
    /// to dismiss it early).
    pub fn push(&self, message: impl Into<String>, variant: ToastVariant) -> u64 {
        let id = next_id();
        let entry = ToastEntry {
            id,
            message: message.into(),
            variant,
        };
        let queue = self.queue;
        queue.update(|q| q.push(entry));

        // Schedule auto-dismiss. `set_timeout_with_handle` returns a
        // handle we'd need to keep alive only if we wanted to cancel;
        // for fire-and-forget the discard is fine.
        let duration = self.duration_ms;
        schedule_dismiss(queue, id, duration);
        id
    }

    /// Dismiss a toast by id. No-op if it's already gone.
    pub fn dismiss(&self, id: u64) {
        self.queue.update(|q| q.retain(|t| t.id != id));
    }
}

static NEXT_ID: AtomicU64 = AtomicU64::new(1);
fn next_id() -> u64 {
    NEXT_ID.fetch_add(1, Ordering::Relaxed)
}

#[cfg(feature = "hydrate")]
fn schedule_dismiss(queue: RwSignal<Vec<ToastEntry>>, id: u64, duration_ms: u32) {
    use std::time::Duration;
    set_timeout(
        move || {
            queue.update(|q| q.retain(|t| t.id != id));
        },
        Duration::from_millis(u64::from(duration_ms)),
    );
}

#[cfg(not(feature = "hydrate"))]
#[allow(clippy::needless_pass_by_value)]
fn schedule_dismiss(_queue: RwSignal<Vec<ToastEntry>>, _id: u64, _duration_ms: u32) {
    // SSR side never gets to dismiss anyway; the page renders once and
    // ships. Hydrate takes over the queue post-mount.
}

/// Provider — mount this near the root of your app. Renders the queue
/// itself (top-right stack, single column).
#[component]
pub fn ToastProvider(
    /// Override the default auto-dismiss timeout.
    #[prop(optional)]
    duration_ms: Option<u32>,
    children: Children,
) -> impl IntoView {
    let duration_ms = duration_ms.unwrap_or(DEFAULT_DURATION_MS);
    let queue: RwSignal<Vec<ToastEntry>> = RwSignal::new(Vec::new());
    let handle = ToastHandle { queue, duration_ms };
    provide_context(handle);

    view! {
        {children()}
        <div
            aria-live="polite"
            aria-atomic="false"
            style=stack_style()
        >
            <For
                each=move || queue.get()
                key=|entry| entry.id
                let:entry
            >
                <ToastItem
                    entry=entry.clone()
                    on_dismiss=Callback::new(move |()| handle.dismiss(entry.id))
                />
            </For>
        </div>
    }
}

/// Pull the toast handle from context. Panics if no [`ToastProvider`]
/// is in the ancestor chain — same contract as `expect_context`.
pub fn use_toast() -> ToastHandle {
    expect_context::<ToastHandle>()
}

#[component]
fn ToastItem(entry: ToastEntry, on_dismiss: Callback<()>) -> impl IntoView {
    view! {
        <div
            role="status"
            style=item_style(entry.variant)
            on:click=move |_| on_dismiss.run(())
        >
            {entry.message}
        </div>
    }
}

// ---- styles ---------------------------------------------------------------

fn stack_style() -> String {
    format!(
        "position:fixed; top:{top}; right:{right}; z-index:60; \
         display:flex; flex-direction:column; gap:{gap}; \
         pointer-events:none; max-width:360px;",
        top = tokens::SPACE_L,
        right = tokens::SPACE_L,
        gap = tokens::SPACE_S,
    )
}

fn item_style(variant: ToastVariant) -> String {
    let (bg, fg, border) = match variant {
        ToastVariant::Info => (
            tokens::COLOR_CARD,
            tokens::COLOR_CARD_FOREGROUND,
            tokens::COLOR_BORDER,
        ),
        ToastVariant::Success => (
            // Tailwind emerald-500 surface to mirror the React success toast.
            "hsl(160 84% 39%)",
            tokens::COLOR_PRIMARY_FOREGROUND,
            "hsl(160 84% 39%)",
        ),
        ToastVariant::Error => (
            tokens::COLOR_DESTRUCTIVE,
            tokens::COLOR_PRIMARY_FOREGROUND,
            tokens::COLOR_DESTRUCTIVE,
        ),
    };
    format!(
        "pointer-events:auto; cursor:pointer; \
         padding:{pad_y} {pad_x}; \
         background:{bg}; color:{fg}; border:1px solid {border}; \
         border-radius:{radius}; box-shadow:{shadow}; \
         font-family:{font}; font-size:{size}; line-height:1.4; \
         animation:agicash-slide-in 200ms cubic-bezier(0.2, 0.8, 0.2, 1);",
        pad_y = tokens::SPACE_M,
        pad_x = tokens::SPACE_L,
        radius = tokens::RADIUS_MD,
        shadow = tokens::SHADOW_XS,
        font = tokens::FONT_PRIMARY,
        size = tokens::TEXT_SM,
    )
}
