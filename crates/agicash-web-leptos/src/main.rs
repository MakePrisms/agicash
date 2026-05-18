//! No-op binary entry.
//!
//! The leptos PWA is now pure CSR (client-side render): the wasm bundle
//! is built via `wasm-pack build --target web --out-dir pkg` and served
//! as static files alongside `index.html`. There is no longer an axum
//! server or SSR shell — see the commit that ripped `auth/mod.rs` and
//! dropped the `ssr` feature (2026-05-17).
//!
//! This `main()` exists only because cargo's `cdylib + rlib + bin`
//! layout for the `agicash-web-leptos` crate keeps a `src/main.rs`
//! around. The browser never calls it; `pub fn hydrate()` in `lib.rs`
//! is the wasm-bindgen-exported entry point that the browser invokes
//! after loading the wasm bundle.
fn main() {}
