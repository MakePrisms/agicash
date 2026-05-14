//! `KeyProvider` + `TokenProvider` impls over opensecret 0.2.9.

pub mod client;
pub mod config;
pub mod error;

pub use client::*;
pub use config::*;
pub use error::*;
