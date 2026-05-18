//! Top-level routed pages.
//!
//! Lane split (sibling worktrees collide here):
//!   - L1 (auth): `login` — public login page.
//!   - L2 (app shell): `home`, `receive`, `send`, `accounts`, `settings`
//!     — placeholder bodies awaiting Slice 12 `WalletClient`.
//!   - L4 (paste-token receive): `receive_cashu` (paste-and-claim, mocked
//!     redeem). Will fold into `receive::*` once Slice 12 lands.

mod accounts;
mod home;
mod login;
mod receive;
mod receive_cashu;
mod send;
mod settings;

pub use accounts::{AccountsAddPage, AccountsIndexPage};
pub use home::HomePage;
pub use login::LoginPage;
pub use receive::ReceivePage;
pub use receive_cashu::ReceiveCashuPage;
pub use send::SendPage;
pub use settings::{
    SettingsAppearancePage, SettingsContactsPage, SettingsIndexPage, SettingsProfilePage,
};
