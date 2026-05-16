package com.makeprisms.agicash

import android.app.Application

/**
 * Application entry. UniFFI's generated Kotlin bindings (from
 * bindings/kotlin/build/sources/) load the bundled .so via System.loadLibrary
 * on first access; nothing to wire here at the Application level for Phase 1.
 */
class AgicashApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // Future: telemetry init, network-security pinning override hook.
    }
}
