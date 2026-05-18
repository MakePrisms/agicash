//! Android JNI shim that initializes `rustls-platform-verifier` with the
//! current JVM + Application Context.
//!
//! Must be called once from `MainActivity.onCreate` (or `Application.onCreate`)
//! before any code path constructs a `reqwest::Client` that uses
//! `rustls::ClientConfig::with_platform_verifier()` — without it, every TLS
//! handshake panics with
//! `"Expect rustls-platform-verifier to be initialized"`.
//!
//! The Kotlin side calls this via:
//!
//! ```kotlin
//! external fun nativeInitRustlsPlatformVerifier(context: android.content.Context)
//! ```
//!
//! declared on `com.makeprisms.agicash.AgicashApplication`. The JVM resolves
//! the mangled symbol name `Java_com_makeprisms_agicash_AgicashApplication_nativeInitRustlsPlatformVerifier`
//! out of the bundled `libagicash_ffi_kotlin.so`. iOS does not need an
//! equivalent: `Security.framework` is process-global so the supabase storage
//! client picks up the trust store with no init dance.

#![cfg(target_os = "android")]
// JNI shims declare `extern "system"` callbacks that take FFI-safe types
// (`EnvUnowned`, `JClass`, `JObject`). No raw-pointer dereferences happen in
// this file — `jni` and `rustls-platform-verifier` own all the unsafety —
// but the workspace's `unsafe_code = "forbid"` lint still flags the
// `#[no_mangle]` attribute, so we relax it for this module only.
#![allow(unsafe_code)]

use jni::objects::{JClass, JObject};
use jni::EnvUnowned;

/// JNI entry point invoked by Kotlin to install the Android platform
/// certificate verifier. Idempotent: `rustls-platform-verifier`'s `OnceCell`
/// guarantees only the first call latches; subsequent calls are no-ops.
///
/// Errors from `init_with_env` (e.g. failing to obtain the class loader) are
/// surfaced as a `RuntimeException` on the Java side via
/// `ThrowRuntimeExAndDefault`.
#[no_mangle]
pub extern "system" fn Java_com_makeprisms_agicash_AgicashApplication_nativeInitRustlsPlatformVerifier<
    'local,
>(
    mut unowned_env: EnvUnowned<'local>,
    _class: JClass<'local>,
    context: JObject<'local>,
) {
    let outcome = unowned_env.with_env(|env| -> Result<(), jni::errors::Error> {
        rustls_platform_verifier::android::init_with_env(env, context)
    });
    outcome.resolve::<jni::errors::ThrowRuntimeExAndDefault>();
}
