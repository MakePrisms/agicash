//! Reusable view components.
//!
//! Phase 1 partial ships:
//! - [`LoginView`] — three-option login chooser (slice 2).
//!
//! Phase 1 UI primitives (lane L3):
//! - [`Button`] — Primary/Secondary/Destructive/Ghost variants, sizes,
//!   loading, disabled.
//! - [`Numpad`] — banking-app amount entry, mirrors iOS `AmountNumpad`.
//! - [`Sheet`] — bottom sheet modal with backdrop + ESC dismiss.
//! - [`ShareSheet`] — Web Share API trigger with clipboard fallback.
//! - [`ToastProvider`] / [`use_toast`] — transient feedback queue.
//! - [`CurrencyToggle`] — BTC ⇄ USD pill switcher.

mod button;
mod currency_toggle;
mod login_view;
mod numpad;
mod share_sheet;
mod sheet;
mod toast;

pub use button::{Button, ButtonSize, ButtonVariant};
pub use currency_toggle::{Currency, CurrencyToggle};
pub use login_view::LoginView;
pub use numpad::{Numpad, DEFAULT_MAX_DIGITS};
pub use share_sheet::{SharePayload, ShareSheet};
pub use sheet::Sheet;
pub use toast::{use_toast, ToastEntry, ToastHandle, ToastProvider, ToastVariant, DEFAULT_DURATION_MS};
