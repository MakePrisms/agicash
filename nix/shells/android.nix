# Android dev shell.
#
# Provides Android NDK r29, cargo-ndk, and JDK 17 for cross-compiling
# Rust crates to Android targets via `cargo ndk -t <triple> build`.
#
# AVD/user state lives outside /nix/store (mutable runtime data) so it
# can be shared across worktrees. ANDROID_AVD_HOME and ANDROID_USER_HOME
# are set to XDG paths.
{ pkgs, lib, system, common, android-nixpkgs }:

let
  # The android-nixpkgs flake exposes `sdk.<system>` only on systems it
  # supports (aarch64-darwin, x86_64-darwin, x86_64-linux). On unsupported
  # systems (e.g. aarch64-linux) we provide a stub shell with a clear msg.
  hasAndroidSdk = builtins.hasAttr system android-nixpkgs.sdk;

  androidSdk =
    if hasAndroidSdk then
      android-nixpkgs.sdk.${system} (
        sdkPkgs: with sdkPkgs; [
          cmdline-tools-latest
          platform-tools
          build-tools-35-0-0
          platforms-android-35
          # NDK r28 — matches the operator's working sapling/flake.nix
          # setup. The brief asked for r29 "ideally"; r29 is available
          # in android-nixpkgs stable as ndk-29-0-13846066 but is
          # untested here. Bump in a follow-up PR after a real cross-
          # compile in the android-spike worktree.
          ndk-28-2-13676358
        ]
      )
    else
      null;
in

if !hasAndroidSdk then
  pkgs.mkShell {
    name = "agicash-android-stub";
    packages = common.basePackages;
    shellHook = ''
      export AGICASH_DEV_SHELL="android"
      echo "agicash android shell: android-nixpkgs does not support ${system}"
      echo "  falling back to a Rust-only shell"
    '';
  }
else
  pkgs.mkShell {
    name = "agicash-android";

    packages = common.basePackages ++ [
      androidSdk
      pkgs.jdk17_headless
      pkgs.cargo-ndk
      pkgs.gradle
    ];

    shellHook = ''
      export AGICASH_DEV_SHELL="android"
      export RUST_BACKTRACE=1

      export ANDROID_HOME="${androidSdk}/share/android-sdk"
      export ANDROID_SDK_ROOT="$ANDROID_HOME"
      export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/28.2.13676358"
      export JAVA_HOME="${pkgs.jdk17_headless}"

      # AVD/user state is mutable runtime data; keep it in XDG paths so
      # all git worktrees share the same emulator inventory.
      export ANDROID_AVD_HOME="''${ANDROID_AVD_HOME:-''${XDG_DATA_HOME:-$HOME/.local/share}/android/avd}"
      export ANDROID_USER_HOME="''${ANDROID_USER_HOME:-''${XDG_STATE_HOME:-$HOME/.local/state}/android}"
      mkdir -p "$ANDROID_AVD_HOME" "$ANDROID_USER_HOME"

      export PATH="$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

      if [ "''${AGICASH_SHELL_QUIET:-0}" != "1" ]; then
        echo "agicash android shell"
        echo "  rustc:        $(rustc --version 2>/dev/null || echo 'not found')"
        echo "  cargo-ndk:    $(cargo ndk --version 2>/dev/null || echo 'not found')"
        echo "  ANDROID_HOME: $ANDROID_HOME"
        echo "  NDK:          $ANDROID_NDK_HOME"
        echo "  JAVA_HOME:    $JAVA_HOME"
      fi
    '';
  }
