//! Foundational domain types for agicash. Zero deps beyond `serde`/`uuid`/`thiserror`.

pub mod account;
pub mod account_purpose;
pub mod currency;
pub mod ids;
pub mod transaction;

pub use account::*;
pub use account_purpose::*;
pub use currency::*;
pub use ids::*;
pub use transaction::*;
