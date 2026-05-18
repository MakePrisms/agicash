//! Reusable view components.
//!
//! Lane split (sibling worktrees collide here):
//!   - L1 (auth, future): `login_view` — three-option login chooser.
//!   - L2 (this lane, app shell): `bottom_nav`, `protected_layout`.
//!   - L3 (primitives, future): button, sheet, card, etc. The L2
//!     components inline minimal stubs marked `// TODO: replace with
//!     L3 component` until L3 graduates.

mod bottom_nav;
mod login_view;
mod protected_layout;

pub use bottom_nav::BottomNav;
pub use login_view::LoginView;
pub use protected_layout::ProtectedLayout;
