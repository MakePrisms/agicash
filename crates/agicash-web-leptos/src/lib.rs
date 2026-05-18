//! `agicash-web-leptos` — the Rust UI for Agicash, built on Leptos 0.7.
//!
//! This crate ships a single wasm `cdylib` loaded by a static
//! `index.html`. There is no SSR server; the previous axum auth-proxy
//! and `cargo-leptos` SSR pipeline have been replaced by direct
//! browser-side calls into `OpenSecretClient`, with refresh tokens
//! persisted via `BrowserSessionStorage` (`window.localStorage`). The
//! threat model on the refresh token matches the legacy React app.
//!
//! Build:
//!
//! ```sh
//! wasm-pack build --target web --out-dir pkg crates/agicash-web-leptos
//! ```
//!
//! Then serve `crates/agicash-web-leptos/` as static files (e.g.
//! `python3 -m http.server 3000` from that directory).

pub mod app;
pub mod components;
pub mod pages;
pub mod tokens;

pub use app::App;

/// Browser entry point — wasm-pack's generated JS glue calls this once
/// the wasm module is loaded. With pure CSR (no SSR prerender), this
/// performs the initial render onto `<body>`.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn hydrate() {
    // Surface Rust panics in the browser console as readable stack
    // traces rather than a generic "unreachable executed" message.
    console_error_panic_hook::set_once();
    leptos::mount::mount_to_body(App);
}
