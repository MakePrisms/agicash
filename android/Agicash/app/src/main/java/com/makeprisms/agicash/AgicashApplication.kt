package com.makeprisms.agicash

import android.app.Application
import android.content.Context

/**
 * Application entry. UniFFI's generated Kotlin bindings (from
 * bindings/kotlin/build/sources/) lazy-load the bundled .so on first access,
 * but we eagerly load it here to install `rustls-platform-verifier` BEFORE
 * any code path constructs a `reqwest` client. The supabase storage layer
 * builds its `reqwest::Client` with `rustls::ClientConfig::with_platform_verifier()`;
 * on Android that verifier needs a JVM + Application Context handle or it
 * panics at TLS handshake time with
 * "Expect rustls-platform-verifier to be initialized". iOS has no
 * equivalent init because Security.framework is process-global.
 *
 * The JNI symbol is defined in `crates/agicash-ffi/src/android_tls.rs`
 * and re-exported by the kotlin bindings wrapper crate so it lives in
 * the same `.so` that UniFFI loads.
 */
class AgicashApplication : Application() {
    companion object {
        init {
            // Force-load the cdylib up-front so the JNI symbol below resolves
            // even though UniFFI would normally lazy-load it on first FFI call.
            System.loadLibrary("agicash_ffi_kotlin")
        }

        @JvmStatic
        external fun nativeInitRustlsPlatformVerifier(context: Context)
    }

    override fun onCreate() {
        super.onCreate()
        // Install the Android platform certificate verifier. Idempotent
        // (a OnceCell inside the verifier latches the first call), so it's
        // safe even if some future code path also calls into Rust before us.
        nativeInitRustlsPlatformVerifier(applicationContext)
    }
}
