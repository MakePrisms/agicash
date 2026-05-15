//! Storage trait impls over postgrest. Mirrors the Supabase REST surface.

pub mod client;
pub mod config;
pub mod error;
pub mod user_storage;

pub use client::*;
pub use config::*;
pub use error::*;
