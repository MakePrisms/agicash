#!/usr/bin/env bash
# Build the Agicash iOS XCFramework from the Rust FFI sources.
#
# Phase 1 scope: aarch64-apple-ios (device) + aarch64-apple-ios-sim
# (Apple-Silicon simulator). x86_64 simulator and macOS slices are out of
# scope per the iOS-only brief; add them when Phase 2+ needs them.
#
# Pre-reqs:
#   - Rust toolchain with `aarch64-apple-ios` + `aarch64-apple-ios-sim`
#     targets installed (`rustup target add ...`).
#   - Xcode with the iOS SDK. `/usr/bin/xcode-select -p` must point at a
#     real Xcode.app (the Nix-shipped `xcrun` shim only knows macOS).
#
# Output:
#   bindings/swift/build/xcframework/agicash_ffiFFI.xcframework
#   bindings/swift/Sources/AgicashSDK/*.swift  (generated Swift sources)
#
# Pattern mirrors sapling's working iOS build (~/sapling/build-ios.sh):
# the XCFramework wraps the static archive + headers directly (no per-slice
# .framework bundle, no per-slice Info.plist), and a Nix-env detection
# block clears variables that break iOS cross-compilation when this is
# invoked from inside a `nix develop` shell.

set -euo pipefail

SWIFT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUST_DIR="$SWIFT_DIR/rust"
BUILD_DIR="$SWIFT_DIR/build"
TARGET_DIR="$RUST_DIR/target"
XCFRAMEWORK_DIR="$BUILD_DIR/xcframework"
HEADERS_STAGING="$BUILD_DIR/headers"
SOURCES_DIR="$SWIFT_DIR/Sources/AgicashSDK"
FRAMEWORK_NAME="agicash_ffiFFI"
MODULE_NAME="agicash_ffiFFI"
STATICLIB_NAME="libagicash_ffi_swift.a"
HOST_DYLIB_NAME="libagicash_ffi_swift.dylib"

echo "=== Agicash iOS build ==="
echo "  Rust dir:       $RUST_DIR"
echo "  Build dir:      $BUILD_DIR"
echo "  XCFramework:    $XCFRAMEWORK_DIR/$FRAMEWORK_NAME.xcframework"
echo "  Swift sources:  $SOURCES_DIR"

# ----- Nix dev shell compatibility -----
# Inside a Nix dev shell on macOS, SDKROOT/DEVELOPER_DIR/NIX_CFLAGS_COMPILE/
# NIX_LDFLAGS/LIBRARY_PATH all point at Nix's macOS-only toolchain. That
# silently breaks iOS cross-compilation: the linker either can't find the
# iOS sysroot or injects -mmacosx-version-min that conflicts with the iOS
# target. The fix is to detect Nix, unset the polluting vars, and pin
# CC/linker at /usr/bin/clang which respects DEVELOPER_DIR.
if [ -n "${NIX_CC:-}" ] && [ "$(uname -s)" = "Darwin" ]; then
    echo "Nix dev shell detected — fixing env for iOS cross-compilation"
    unset SDKROOT
    unset DEVELOPER_DIR
    unset NIX_CFLAGS_COMPILE
    unset NIX_LDFLAGS
    unset LIBRARY_PATH
    unset NIX_CC
    unset NIX_CC_WRAPPER_TARGET_HOST_x86_64_apple_darwin
    unset NIX_CC_WRAPPER_TARGET_HOST_aarch64_apple_darwin
fi

# Point DEVELOPER_DIR at the real Xcode. We always re-resolve via
# /usr/bin/xcode-select so the Nix shim never wins on PATH.
XCODE_DEV_DIR="$(/usr/bin/xcode-select -p 2>/dev/null || true)"
if [ -z "$XCODE_DEV_DIR" ] || [ ! -d "$XCODE_DEV_DIR" ]; then
    echo "error: Xcode not found. Install Xcode and run xcode-select --install." >&2
    exit 1
fi
export DEVELOPER_DIR="$XCODE_DEV_DIR"

# Prepend /usr/bin so the system xcrun takes precedence over any Nix shim,
# and ~/.cargo/bin so `cargo` resolves regardless of caller env.
export PATH="$HOME/.cargo/bin:/usr/bin:$PATH"

# Use system clang for both iOS targets and the host. The Nix-wrapped cc
# would inject macOS-only flags and break the iOS link step.
export CC="/usr/bin/clang"
export CXX="/usr/bin/clang++"
export AR="/usr/bin/ar"
export CC_aarch64_apple_ios=/usr/bin/clang
export CC_aarch64_apple_ios_sim=/usr/bin/clang
export CARGO_TARGET_AARCH64_APPLE_IOS_LINKER=/usr/bin/clang
export CARGO_TARGET_AARCH64_APPLE_IOS_SIM_LINKER=/usr/bin/clang
export CC_aarch64_apple_darwin=/usr/bin/clang
export CC_x86_64_apple_darwin=/usr/bin/clang
export CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER=/usr/bin/clang
export CARGO_TARGET_X86_64_APPLE_DARWIN_LINKER=/usr/bin/clang

echo "  DEVELOPER_DIR:  $DEVELOPER_DIR"

# Clean previous XCFramework output. `target/` stays so cargo can do
# incremental rebuilds across runs.
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR" "$XCFRAMEWORK_DIR" "$HEADERS_STAGING"

build_target() {
    local target="$1"
    local label="$2"
    echo
    echo "Compiling for $label ($target)"
    (
        cd "$RUST_DIR"
        env -u MACOSX_DEPLOYMENT_TARGET -u SDKROOT \
            cargo build --release --target "$target"
    )
}

# Host build first — produces the dylib uniffi-bindgen reads to extract
# metadata. We have to build for an explicit host triple so the resulting
# binary matches the running interpreter (the workspace can't infer a
# host triple from an iOS-cross context).
HOST_TRIPLE="$(/usr/bin/uname -m | sed 's/arm64/aarch64/')-apple-darwin"
echo
echo "Compiling host stub for UniFFI bindgen ($HOST_TRIPLE)"
(
    cd "$RUST_DIR"
    env -u MACOSX_DEPLOYMENT_TARGET -u SDKROOT \
        cargo build --release --target "$HOST_TRIPLE"
)

build_target aarch64-apple-ios       "iOS device"
build_target aarch64-apple-ios-sim   "iOS simulator (arm64)"

# ----- Generate Swift bindings -----
# Use the iOS-device staticlib as the metadata source; uniffi-bindgen
# reads ELF/Mach-O headers, not architecture-specific code paths, so any
# slice works. We emit a single header set into HEADERS_STAGING (identical
# across slices because uniffi headers describe the FFI ABI, not the lib).
echo
echo "Generating Swift bindings"

(
    cd "$RUST_DIR"
    BINDGEN_BIN="$TARGET_DIR/$HOST_TRIPLE/release/uniffi-bindgen-swift"
    if [ ! -x "$BINDGEN_BIN" ]; then
        echo "error: uniffi-bindgen-swift binary missing at $BINDGEN_BIN" >&2
        exit 1
    fi

    HOST_DYLIB="$TARGET_DIR/$HOST_TRIPLE/release/$HOST_DYLIB_NAME"
    if [ ! -f "$HOST_DYLIB" ]; then
        echo "error: host dylib missing at $HOST_DYLIB" >&2
        exit 1
    fi

    "$BINDGEN_BIN" "$HOST_DYLIB" "$HEADERS_STAGING" --headers
    # Plain `--modulemap` (no `--xcframework`) emits a non-framework
    # modulemap (`module agicash_ffiFFI { … }` instead of `framework module
    # … { … }`). The static-library xcframework slices we ship are bare
    # headers + .a archives, not .framework bundles, so a framework-style
    # modulemap makes the Swift compiler look for a Foo.framework that
    # doesn't exist and fails with "cannot find type 'RustBuffer' in scope".
    # Mirrors sapling's pattern (~/sapling/build-ios.sh).
    "$BINDGEN_BIN" "$HOST_DYLIB" "$HEADERS_STAGING" \
        --modulemap --module-name "$MODULE_NAME" \
        --modulemap-filename module.modulemap

    rm -rf "$SOURCES_DIR"
    mkdir -p "$SOURCES_DIR"
    "$BINDGEN_BIN" "$HOST_DYLIB" "$SOURCES_DIR" --swift-sources
)

# ----- Assemble the XCFramework -----
# Sapling-style: feed xcodebuild the raw .a + headers per slice. No
# per-slice .framework bundle (no Info.plist juggling, no FMWK packaging).
# xcodebuild generates a top-level Info.plist that lists the slices.
echo
echo "Creating $FRAMEWORK_NAME.xcframework"

/usr/bin/xcodebuild -create-xcframework \
    -library "$TARGET_DIR/aarch64-apple-ios/release/$STATICLIB_NAME" \
        -headers "$HEADERS_STAGING" \
    -library "$TARGET_DIR/aarch64-apple-ios-sim/release/$STATICLIB_NAME" \
        -headers "$HEADERS_STAGING" \
    -output "$XCFRAMEWORK_DIR/$FRAMEWORK_NAME.xcframework"

echo
echo "=== Done ==="
echo "  XCFramework:    $XCFRAMEWORK_DIR/$FRAMEWORK_NAME.xcframework"
echo "  Swift sources:  $SOURCES_DIR"
