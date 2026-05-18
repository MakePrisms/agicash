//! Top-level routed pages.
//!
//! Lane split (sibling worktrees collide here):
//!   - L1 (auth): `login` — public login page.
//!   - L2 (this lane, app shell): `home`, `receive`, `send`, `accounts`,
//!     `settings` — placeholder bodies awaiting Slice 12 `WalletClient`.
//!   - L4 (paste-token receive): will land `receive/cashu/token` as a
//!     sub-module under `receive::*` later.

mod accounts;
mod home;
mod login;
mod receive;
mod send;
mod settings;

pub use accounts::{AccountsAddPage, AccountsIndexPage};
pub use home::HomePage;
pub use login::LoginPage;
pub use receive::ReceivePage;
pub use send::SendPage;
pub use settings::{
    SettingsAppearancePage, SettingsContactsPage, SettingsIndexPage, SettingsProfilePage,
};
