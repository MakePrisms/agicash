//! Top-level routed pages. Phase 1 partial ships only LoginPage + HomePage
//! (placeholder); wallet UI lands once slice 12 `WalletClient` is on master.

mod home;
mod login;

pub use home::HomePage;
pub use login::LoginPage;
