//! WASM bindings for the agicash Rust SDK. Real surface fills in slice 13.

use wasm_bindgen::prelude::*;

/// Placeholder until the real Wallet binding lands in slice 13.
/// Lets us verify the WASM build pipeline works during scaffold.
#[wasm_bindgen]
#[must_use]
pub fn agicash_wasm_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
