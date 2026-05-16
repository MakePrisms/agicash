plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.makeprisms.agicash"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.makeprisms.agicash"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"

        ndk {
            // The four ABIs UniFFI's Kotlin runtime + our jniLibs ship.
            abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
        debug {
            // Pure-Kotlin app; nothing extra needed.
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }

    // The kotlin bindings + .so files live outside src/main and are wired in via
    // sourceSets below so the cargo-ndk output dir stays the source of truth.
    sourceSets {
        getByName("main") {
            // Generated Kotlin bindings live under bindings/kotlin/build/sources.
            // The path is repo-relative; the wrapper points at the worktree root.
            java.srcDirs(
                "src/main/java",
                "${rootDir}/../../bindings/kotlin/build/sources",
            )
            // Pre-built .so files staged by generate-bindings.sh.
            jniLibs.srcDirs(
                "${rootDir}/../../bindings/kotlin/build/jniLibs",
            )
        }
    }

    packaging {
        // UniFFI's Kotlin runtime uses JNA, which ships .so files in its jar.
        // Keep them; cargo-ndk's .so output is named differently and wins.
        jniLibs {
            useLegacyPackaging = false
        }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.jna) { artifact { type = "aar" } }

    debugImplementation(libs.androidx.ui.tooling)
}
