//! Top-level routed pages. Phase 1 partial ships `LoginPage`, `HomePage`
//! (placeholder), and `ReceiveCashuPage` (paste-and-claim, mocked redeem).
//! Wallet UI lands once slice 12 `WalletClient` is on master.

mod home;
mod login;
mod receive_cashu;

pub use home::HomePage;
pub use login::LoginPage;
pub use receive_cashu::ReceiveCashuPage;
