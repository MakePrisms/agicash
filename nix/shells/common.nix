# Shared inputs for all agicash dev shells.
#
# Returns an attrset of packages and toolchain handles every shell can use.
# Each shell extends this with its platform-specific bits.
{ pkgs, lib }:

let
  # Pin to match crates/rust-toolchain.toml (slice 4: 1.88.0).
  # rust-overlay exposes versioned attrs under pkgs.rust-bin.stable."<ver>".
  rustToolchain = pkgs.rust-bin.stable."1.88.0".default.override {
    extensions = [ "rustfmt" "clippy" "rust-src" "rust-analyzer" ];
    targets = [
      "wasm32-unknown-unknown"
      "aarch64-apple-ios"
      "aarch64-apple-ios-sim"
      "aarch64-linux-android"
      "armv7-linux-androideabi"
      "x86_64-linux-android"
    ];
  };

  basePackages = [
    rustToolchain
    pkgs.just
    pkgs.git
    pkgs.jq
    pkgs.curl
    pkgs.openssl
    pkgs.pkg-config
  ];
in
{
  inherit rustToolchain basePackages;
}
