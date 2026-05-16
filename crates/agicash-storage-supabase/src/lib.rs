//! Storage trait impls over postgrest. Mirrors the Supabase REST surface.
//!
//! The [`generated`] module is produced by `agicash-storage-supabase-codegen`
//! by introspecting `supabase/migrations/*.sql` against an ephemeral
//! `postgres:17`-class container. Regenerate via `bun db:generate-types-rust`
//! (or `cargo run -p agicash-storage-supabase-codegen`). CI's drift gate
//! re-runs it on every PR and fails if the file is stale.

pub mod cashu_melt_quote_storage;
pub mod cashu_mint_quote_storage;
pub mod cashu_receive_swap_storage;
pub mod cashu_send_swap_storage;
pub mod client;
pub mod config;
pub mod error;
pub mod generated;
pub mod user_storage;

pub use cashu_melt_quote_storage::*;
pub use cashu_mint_quote_storage::*;
pub use cashu_receive_swap_storage::*;
pub use cashu_send_swap_storage::*;
pub use client::*;
pub use config::*;
pub use error::*;
