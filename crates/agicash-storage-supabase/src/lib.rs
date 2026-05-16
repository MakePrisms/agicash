//! Storage trait impls over postgrest. Mirrors the Supabase REST surface.

pub mod cashu_mint_quote_storage;
pub mod cashu_receive_swap_storage;
pub mod cashu_send_swap_storage;
pub mod client;
pub mod config;
pub mod error;
pub mod user_storage;

pub use cashu_mint_quote_storage::*;
pub use cashu_receive_swap_storage::*;
pub use cashu_send_swap_storage::*;
pub use client::*;
pub use config::*;
pub use error::*;
