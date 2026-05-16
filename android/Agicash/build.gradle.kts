// Top-level build file. Plugins applied here are not auto-applied to
// submodules — the :app module declares its own `plugins { ... }` block.
plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
}
