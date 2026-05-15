#!/bin/bash
# Build the Agicash iOS XCFramework from the Rust FFI sources.
#
# Phase 1 scope: aarch64-apple-ios (device) + aarch64-apple-ios-sim
# (Apple-Silicon simulator). x86_64 simulator and macOS slices are out of
# scope per the iOS-only brief; add them when Phase 2+ needs them.
#
# Pre-reqs:
#   - Rust toolchain with `aarch64-apple-ios` + `aarch64-apple-ios-sim`
#     targets installed (`rustup target add ...`).
#   - Xcode 26.x with iOS 26.2 SDK at /Applications/Xcode-26.2.0.app.
#     The host's `xcrun` is a Nix shim that only knows the macOS SDK, so
#     we explicitly use /usr/bin/xcrun and set DEVELOPER_DIR to the real
#     Xcode install (matches the spike report workaround).
#
# Output:
#   bindings/swift/build/xcframework/AgicashSDKFFI.xcframework
#   bindings/swift/Sources/AgicashSDK/*.swift  (generated Swift sources)

set -euo pipefail

SWIFT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUST_DIR="$SWIFT_DIR/rust"
BUILD_DIR="$SWIFT_DIR/build"
TARGET_DIR="$RUST_DIR/target"
XCFRAMEWORK_DIR="$BUILD_DIR/xcframework"
SOURCES_DIR="$SWIFT_DIR/Sources/AgicashSDK"
FRAMEWORK_NAME="AgicashSDKFFI"
MODULE_NAME="AgicashSDKFFI"
STATICLIB_NAME="libagicash_ffi_swift.a"

echo "Building Agicash Swift bindings"
echo "  Rust dir:       $RUST_DIR"
echo "  Build dir:      $BUILD_DIR"
echo "  XCFramework:    $XCFRAMEWORK_DIR/$FRAMEWORK_NAME.xcframework"
echo "  Swift sources:  $SOURCES_DIR"

# Clean previous output (target/ stays — incremental compile is the whole point)
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR" "$XCFRAMEWORK_DIR" "$SOURCES_DIR"

# Point xcrun at the real Xcode (Nix shim doesn't know the iOS SDK).
if [[ -d "/Applications/Xcode-26.2.0.app" ]]; then
    export DEVELOPER_DIR="/Applications/Xcode-26.2.0.app/Contents/Developer"
elif command -v xcode-select >/dev/null 2>&1; then
    DEV_DIR="$(/usr/bin/xcode-select -p 2>/dev/null || true)"
    if [[ -n "$DEV_DIR" && -d "$DEV_DIR" ]]; then
        export DEVELOPER_DIR="$DEV_DIR"
    fi
fi

# Prepend /usr/bin so the system xcrun takes precedence over the Nix shim,
# and /Users/claude/.cargo/bin so `cargo` is found regardless of caller env.
export PATH="/Users/claude/.cargo/bin:/usr/bin:$PATH"

echo "  DEVELOPER_DIR:  ${DEVELOPER_DIR:-<unset>}"

# Use system clang for iOS targets; Nix-wrapped cc would inject macOS
# version-min flags and break the iOS link step.
export CC_aarch64_apple_ios=/usr/bin/clang
export CC_aarch64_apple_ios_sim=/usr/bin/clang
export CARGO_TARGET_AARCH64_APPLE_IOS_LINKER=/usr/bin/clang
export CARGO_TARGET_AARCH64_APPLE_IOS_SIM_LINKER=/usr/bin/clang

# Also pin the host-target linker. The Nix-wrapped cc can't locate
# libiconv / libSystem from the macOS SDK, which breaks `cargo run` for
# the bindgen binary. /usr/bin/clang + DEVELOPER_DIR finds them.
export CC_aarch64_apple_darwin=/usr/bin/clang
export CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER=/usr/bin/clang

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

build_target aarch64-apple-ios       "iOS device"
build_target aarch64-apple-ios-sim   "iOS simulator (arm64)"

# Per-target framework bundles, then assemble into the XCFramework.
echo
echo "Assembling per-target frameworks"

IOS_DEVICE_FW="$BUILD_DIR/ios-device/$FRAMEWORK_NAME.framework"
IOS_SIM_FW="$BUILD_DIR/ios-simulator/$FRAMEWORK_NAME.framework"

mkdir -p "$IOS_DEVICE_FW/Headers" "$IOS_DEVICE_FW/Modules"
mkdir -p "$IOS_SIM_FW/Headers"    "$IOS_SIM_FW/Modules"

cp "$TARGET_DIR/aarch64-apple-ios/release/$STATICLIB_NAME"     "$IOS_DEVICE_FW/$FRAMEWORK_NAME"
cp "$TARGET_DIR/aarch64-apple-ios-sim/release/$STATICLIB_NAME" "$IOS_SIM_FW/$FRAMEWORK_NAME"

cp "$SWIFT_DIR/resources/Info-iOS.plist"          "$IOS_DEVICE_FW/Info.plist"
cp "$SWIFT_DIR/resources/Info-iOSSimulator.plist" "$IOS_SIM_FW/Info.plist"

# Generate Swift bindings (headers + modulemaps per framework, then Swift
# sources once). The bindgen binary is a host-target build; the Nix-wrapped
# clang doesn't ship libiconv, so point it at the macOS SDK explicitly.
echo
echo "Generating Swift bindings"

MACOS_SDK="$(/usr/bin/xcrun --sdk macosx --show-sdk-path)"
export SDKROOT="$MACOS_SDK"

(
    cd "$RUST_DIR"
    cargo run --release --bin uniffi-bindgen-swift -- \
        "$TARGET_DIR/aarch64-apple-ios/release/$STATICLIB_NAME" \
        "$IOS_DEVICE_FW/Headers" --headers

    cargo run --release --bin uniffi-bindgen-swift -- \
        "$TARGET_DIR/aarch64-apple-ios/release/$STATICLIB_NAME" \
        "$IOS_DEVICE_FW/Modules" \
        --xcframework --modulemap --module-name "$MODULE_NAME" \
        --modulemap-filename module.modulemap

    cargo run --release --bin uniffi-bindgen-swift -- \
        "$TARGET_DIR/aarch64-apple-ios-sim/release/$STATICLIB_NAME" \
        "$IOS_SIM_FW/Headers" --headers

    cargo run --release --bin uniffi-bindgen-swift -- \
        "$TARGET_DIR/aarch64-apple-ios-sim/release/$STATICLIB_NAME" \
        "$IOS_SIM_FW/Modules" \
        --xcframework --modulemap --module-name "$MODULE_NAME" \
        --modulemap-filename module.modulemap

    rm -rf "$SOURCES_DIR"
    mkdir -p "$SOURCES_DIR"
    cargo run --release --bin uniffi-bindgen-swift -- \
        "$TARGET_DIR/aarch64-apple-ios/release/$STATICLIB_NAME" \
        "$SOURCES_DIR" --swift-sources
)

# Assemble the XCFramework.
echo
echo "Creating $FRAMEWORK_NAME.xcframework"

/usr/bin/xcodebuild -create-xcframework \
    -framework "$IOS_DEVICE_FW" \
    -framework "$IOS_SIM_FW" \
    -output    "$XCFRAMEWORK_DIR/$FRAMEWORK_NAME.xcframework"

echo
echo "Done."
echo "  XCFramework:    $XCFRAMEWORK_DIR/$FRAMEWORK_NAME.xcframework"
echo "  Swift sources:  $SOURCES_DIR"
