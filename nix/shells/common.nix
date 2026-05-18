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

  # generate-ssl-cert script (preserves the behaviour of the old devenv
  # `scripts.generate-ssl-cert.exec` hook). Wrapped as a Nix derivation so
  # it lands on PATH and so `mkcert` resolves to the flake-pinned version.
  generate-ssl-cert = pkgs.writeShellApplication {
    name = "generate-ssl-cert";
    runtimeInputs = [ pkgs.mkcert pkgs.nss.tools pkgs.openssl ];
    text = builtins.readFile ../../tools/dev/generate-ssl-cert.sh;
  };

  basePackages = [
    rustToolchain

    # General dev tools (survivors from devenv.nix).
    pkgs.git
    pkgs.gh
    pkgs.jq
    pkgs.curl
    pkgs.openssl
    pkgs.pkg-config
    pkgs.just

    # Local Supabase HTTPS + JWT chain.
    # mkcert + nss.tools install the local CA into Firefox/Chrome trust
    # stores (see memory project_opensecret_local_stack.md).
    pkgs.mkcert
    pkgs.nss.tools

    # Supabase CLI — `supabase start` runs the local postgres/auth/storage
    # stack used by the rust storage crate + opensecret JWT chain.
    pkgs.supabase-cli

    # Build acceleration — shared cargo target + sccache wrapper (per memory
    # feedback_dev_loop_cache.md: 10-30× warm-cache speedup across worktrees).
    pkgs.sccache

    # generate-ssl-cert script (defined above).
    generate-ssl-cert
  ];
in
{
  inherit rustToolchain basePackages;
}
