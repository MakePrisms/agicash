//! Re-export everything from `agicash-ffi` so UniFFI's binding generator
//! resolves a single cdylib that carries the full FFI surface for Kotlin.

pub use agicash_ffi::*;
