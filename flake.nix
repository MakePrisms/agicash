{
  description = "agicash — per-environment Rust dev shells (default / ios / android / wasm)";

  # Pinned inputs. Bump deliberately via `nix flake update <input>`.
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    flake-utils.url = "github:numtide/flake-utils";

    # Rust toolchain via rust-overlay (matches the version pinned in
    # crates/rust-toolchain.toml). Pika uses the same overlay.
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    # Android SDK/NDK provisioning. Pika uses this; tracks an upstream
    # channels.json so we get e.g. ndk-29-* without writing our own.
    android-nixpkgs = {
      url = "github:tadfisher/android-nixpkgs";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, flake-utils, rust-overlay, android-nixpkgs }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ (import rust-overlay) ];
          config = {
            allowUnfree = true;
            android_sdk.accept_license = true;
          };
        };

        lib = pkgs.lib;

        common = import ./nix/shells/common.nix { inherit pkgs lib; };
      in {
        devShells = {
          default = import ./nix/shells/default.nix { inherit pkgs lib common; };
          ios = import ./nix/shells/ios.nix { inherit pkgs lib common; };
          android = import ./nix/shells/android.nix { inherit pkgs lib system common android-nixpkgs; };
          wasm = import ./nix/shells/wasm.nix { inherit pkgs lib common; };
        };
      });
}
