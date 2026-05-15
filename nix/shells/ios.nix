# iOS dev shell.
#
# Darwin-only. Adds xcodegen and configures cargo to find Xcode tooling.
# Xcode itself is NOT installed by Nix (closed-source GUI app); operators
# must have it under /Applications. We surface DEVELOPER_DIR from
# xcode-select if available.
#
# Why no uniffi-bindgen-swift here: it isn't packaged in nixpkgs at this
# pin. Contributors install it ad-hoc via `cargo install
# uniffi-bindgen-swift`; documented in nix/README.md. Packaging it as a
# rustPlatform.buildRustPackage derivation is a future follow-up.
{ pkgs, lib, common }:

if !pkgs.stdenv.isDarwin then
  pkgs.mkShell {
    name = "agicash-ios-stub";
    packages = common.basePackages;
    shellHook = ''
      export AGICASH_DEV_SHELL="ios"
      echo "agicash ios shell: not supported on Linux (Xcode is macOS-only)"
      echo "  falling back to a Rust-only shell"
    '';
  }
else
  pkgs.mkShell {
    name = "agicash-ios";

    packages = common.basePackages ++ [
      pkgs.libiconv
      pkgs.xcodegen
    ];

    shellHook = ''
      export AGICASH_DEV_SHELL="ios"
      export RUST_BACKTRACE=1

      # Use the host's xcode-select choice for DEVELOPER_DIR. We don't pin
      # an Xcode version (would require team-wide agreement via
      # xcodeenv.composeXcodeWrapper). Contributors manage Xcode via the
      # App Store. If xcode-select isn't configured, warn but don't fail.
      if command -v xcode-select >/dev/null 2>&1; then
        if dev_dir="$(xcode-select -p 2>/dev/null)" && [ -n "$dev_dir" ]; then
          export DEVELOPER_DIR="$dev_dir"
        fi
      fi

      # Nix-provided cargo links against a Nix Apple SDK that lacks
      # libiconv in default search paths; add it explicitly.
      if [ -n "''${LIBRARY_PATH:-}" ]; then
        export LIBRARY_PATH="${pkgs.libiconv}/lib:$LIBRARY_PATH"
      else
        export LIBRARY_PATH="${pkgs.libiconv}/lib"
      fi

      if [ "''${AGICASH_SHELL_QUIET:-0}" != "1" ]; then
        echo "agicash ios shell"
        echo "  rustc:    $(rustc --version 2>/dev/null || echo 'not found')"
        echo "  xcodegen: $(xcodegen --version 2>/dev/null || echo 'not found')"
        if [ -n "''${DEVELOPER_DIR:-}" ] && [ -d "$DEVELOPER_DIR" ]; then
          echo "  Xcode:    $DEVELOPER_DIR"
        else
          echo "  Xcode:    not found (run 'xcode-select --install' or open Xcode once)"
        fi
        if ! command -v uniffi-bindgen-swift >/dev/null 2>&1; then
          echo "  uniffi:   uniffi-bindgen-swift not on PATH"
          echo "            install with: cargo install uniffi-bindgen-swift"
        fi
      fi
    '';
  }
