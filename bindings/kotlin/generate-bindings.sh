#!/usr/bin/env bash
# Build the Agicash Android Kotlin bindings + JNI .so files.
#
# Phase 1 scope: 3 Android ABIs
#   - aarch64-linux-android       -> jniLibs/arm64-v8a
#   - armv7-linux-androideabi     -> jniLibs/armeabi-v7a
#   - x86_64-linux-android        -> jniLibs/x86_64  (emulator)
#
# Pre-reqs:
#   - Rust toolchain with the three Android targets installed.
#   - Android NDK at $ANDROID_NDK_HOME (default brew cask path is
#     /opt/homebrew/share/android-ndk).
#   - cargo-ndk on PATH (`cargo install cargo-ndk`).
#
# Output:
#   bindings/kotlin/build/jniLibs/<abi>/libagicash_ffi_kotlin.so
#   bindings/kotlin/build/sources/com/makeprisms/agicash/sdk/*.kt
#
# Pattern mirrors bindings/swift/generate-bindings.sh: build a host cdylib so
# uniffi-bindgen can extract metadata in library mode, then cross-compile the
# three Android slices via cargo-ndk.

set -euo pipefail

KOTLIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUST_DIR="$KOTLIN_DIR/rust"
BUILD_DIR="$KOTLIN_DIR/build"
TARGET_DIR="$RUST_DIR/target"
JNILIBS_DIR="$BUILD_DIR/jniLibs"
SOURCES_DIR="$BUILD_DIR/sources"
CDYLIB_NAME="libagicash_ffi_kotlin"
HOST_CDYLIB_EXT="dylib"  # macOS host
HOST_CDYLIB_NAME="${CDYLIB_NAME}.${HOST_CDYLIB_EXT}"

echo "=== Agicash Android Kotlin build ==="
echo "  Rust dir:       $RUST_DIR"
echo "  Build dir:      $BUILD_DIR"
echo "  jniLibs:        $JNILIBS_DIR"
echo "  Kotlin sources: $SOURCES_DIR"

# ----- NDK / toolchain checks -----
if [ -z "${ANDROID_NDK_HOME:-}" ]; then
    # brew cask installs to this canonical path
    if [ -d "/opt/homebrew/share/android-ndk" ]; then
        export ANDROID_NDK_HOME="/opt/homebrew/share/android-ndk"
    elif [ -d "$HOME/Library/Android/sdk/ndk" ]; then
        # Pick the highest-numbered NDK side-by-side install.
        ANDROID_NDK_HOME="$(ls -d "$HOME"/Library/Android/sdk/ndk/* 2>/dev/null | sort -V | tail -1)"
        export ANDROID_NDK_HOME
    fi
fi

if [ -z "${ANDROID_NDK_HOME:-}" ] || [ ! -d "$ANDROID_NDK_HOME" ]; then
    echo "error: ANDROID_NDK_HOME is unset or points at a missing directory." >&2
    echo "       brew install --cask android-ndk  (canonical path: /opt/homebrew/share/android-ndk)" >&2
    echo "       or install via Android Studio SDK Manager -> SDK Tools -> NDK (Side by side)." >&2
    exit 1
fi
echo "  NDK:            $ANDROID_NDK_HOME"

export PATH="$HOME/.cargo/bin:$PATH"

if ! command -v cargo-ndk >/dev/null 2>&1; then
    echo "error: cargo-ndk not on PATH. Run: cargo install cargo-ndk" >&2
    exit 1
fi

# ----- Clean previous outputs (keep target/ for incremental rebuilds) -----
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR" "$JNILIBS_DIR" "$SOURCES_DIR"

# ----- Host build first (metadata extraction) -----
HOST_TRIPLE="$(/usr/bin/uname -m | sed 's/arm64/aarch64/')-apple-darwin"
echo
echo "Compiling host cdylib for UniFFI bindgen ($HOST_TRIPLE)"
(
    cd "$RUST_DIR"
    cargo build --release --target "$HOST_TRIPLE"
)

# ----- Build the three Android ABIs via cargo-ndk -----
# `cargo ndk` injects $CARGO_TARGET_<TRIPLE>_LINKER + $CC_<triple> from the
# NDK toolchain so the build doesn't need any manual env wiring.
echo
echo "Cross-compiling Android ABIs"
(
    cd "$RUST_DIR"
    cargo ndk \
        --target aarch64-linux-android \
        --target armv7-linux-androideabi \
        --target x86_64-linux-android \
        --platform 26 \
        -o "$JNILIBS_DIR" \
        build --release
)

echo
echo "jniLibs payload:"
find "$JNILIBS_DIR" -name "*.so" | sort

# ----- Generate Kotlin bindings via uniffi-bindgen -----
echo
echo "Generating Kotlin bindings"
BINDGEN_BIN="$TARGET_DIR/$HOST_TRIPLE/release/uniffi-bindgen"
if [ ! -x "$BINDGEN_BIN" ]; then
    echo "error: uniffi-bindgen binary missing at $BINDGEN_BIN" >&2
    exit 1
fi

HOST_CDYLIB="$TARGET_DIR/$HOST_TRIPLE/release/$HOST_CDYLIB_NAME"
if [ ! -f "$HOST_CDYLIB" ]; then
    echo "error: host cdylib missing at $HOST_CDYLIB" >&2
    exit 1
fi

(
    # uniffi-bindgen invokes `cargo metadata` to resolve external types; it
    # needs `cargo` on PATH (cargo-ndk earlier was wrapping for us).
    cd "$RUST_DIR"
    "$BINDGEN_BIN" generate \
        --language kotlin \
        --library "$HOST_CDYLIB" \
        --out-dir "$SOURCES_DIR" \
        --no-format
)

echo
echo "Generated Kotlin sources:"
find "$SOURCES_DIR" -name "*.kt" | sort

echo
echo "=== Done ==="
echo "  jniLibs:        $JNILIBS_DIR"
echo "  Kotlin sources: $SOURCES_DIR"
