//! Reusable view components.
//!
//! Lane split (sibling worktrees collide here):
//!   - L1 (auth, future): `login_view` — three-option login chooser.
//!   - L2 (this lane, app shell): `bottom_nav`, `protected_layout`.
//!   - L3 (primitives): `button`, `numpad`, `sheet`, `share`, `toast`, `currency_toggle`.
//!   - L4 (receive-token): `cashu_token_paste_view`.
//!   - L5 (send-token): `send_cashu_view` — Cashu send state machine.
//!
//! Phase 1 partial ships:
//! - [`LoginView`] — three-option login chooser (slice 2).
//! - [`CashuTokenPasteView`] — paste-token receive flow (lane L4). The
//!   receive-token component is intentionally self-contained so it doesn't
//!   conflict with the L3 component-library branch when those land — see the
//!   `// TODO: replace with L3 <Card> / <Button>` markers in
//!   `cashu_token_paste_view.rs`.
//! - [`SendCashuView`] — Cashu send state machine (lane L5). Lives behind
//!   `/send`'s Cashu tab; SDK boundary mocked behind `// TODO[slice-13]`
//!   markers pending the storage-supabase wasm port.
//!
//! Phase 1 UI primitives (lane L3):
//! - [`Button`] — Primary/Secondary/Destructive/Ghost variants, sizes,
//!   loading, disabled.
//! - [`Numpad`] — banking-app amount entry, mirrors iOS `AmountNumpad`.
//! - [`Sheet`] — bottom sheet modal with backdrop + ESC dismiss.
//! - [`ShareSheet`] — Web Share API trigger with clipboard fallback.
//! - [`ToastProvider`] / [`use_toast`] — transient feedback queue.
//! - [`CurrencyToggle`] — BTC ⇄ USD pill switcher.

mod bottom_nav;
mod button;
mod cashu_token_paste_view;
mod currency_toggle;
mod login_view;
mod numpad;
mod protected_layout;
mod send_cashu_view;
mod share_sheet;
mod sheet;
mod toast;
mod wallet_context;

pub use bottom_nav::BottomNav;
pub use button::{Button, ButtonSize, ButtonVariant};
pub use cashu_token_paste_view::CashuTokenPasteView;
pub use currency_toggle::{Currency, CurrencyToggle};
pub use login_view::LoginView;
pub use numpad::{Numpad, DEFAULT_MAX_DIGITS};
pub use protected_layout::ProtectedLayout;
pub use send_cashu_view::SendCashuView;
pub use share_sheet::{SharePayload, ShareSheet};
pub use sheet::Sheet;
pub use toast::{
    use_toast, ToastEntry, ToastHandle, ToastProvider, ToastVariant, DEFAULT_DURATION_MS,
};
pub use wallet_context::{AccountSummary, LoadState, WalletData};
