//! `agicash-web-leptos` — the Rust UI for Agicash, built on Leptos 0.7.
//!
//! This crate ships in two shapes from one source tree:
//!   - `feature = "ssr"`   — the axum server binary (Linux/macOS native).
//!   - `feature = "hydrate"` — the wasm32 bundle the browser downloads.
//!
//! `cargo-leptos` orchestrates both builds (see `[package.metadata.leptos]`
//! in `Cargo.toml`). The same Rust code defines the `App` component; the
//! server prerenders it and the browser hydrates it.
//!
//! See `~/agicash/docs/superpowers/specs/2026-05-16-agicash-leptos-pwa-design.md`
//! for the full design.

pub mod app;
pub mod components;
pub mod pages;
pub mod tokens;

// The auth-proxy handlers (calls into opensecret) live in `auth/` and are
// SSR-only — opensecret 3.1.1 does not currently compile to wasm32, and even
// when it does, we keep the browser away from it for XSS hygiene (spec §7).
#[cfg(feature = "ssr")]
pub mod auth;

pub use app::{shell, App};

/// Hydrate entry point — browsers call this to attach reactivity to the
/// SSR-prerendered HTML. cargo-leptos's generated `pkg/...wasm` calls this
/// automatically on load.
#[cfg(feature = "hydrate")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn hydrate() {
    // Surface Rust panics in the browser console as readable stack traces
    // rather than a generic "unreachable executed" message.
    console_error_panic_hook::set_once();
    leptos::mount::hydrate_body(App);
}
