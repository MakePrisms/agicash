# Default Rust dev shell.
#
# Matches workspace pin in crates/rust-toolchain.toml. Includes rustfmt,
# clippy, rust-analyzer, plus targets needed for cross-compiles (wasm,
# ios, android) so a contributor in this shell can `cargo build
# --target=...` without re-fetching the toolchain.
{ pkgs, lib, common }:

pkgs.mkShell {
  name = "agicash-default";

  packages = common.basePackages ++ pkgs.lib.optionals pkgs.stdenv.isDarwin [
    pkgs.libiconv
  ];

  shellHook = ''
    export AGICASH_DEV_SHELL="default"
    export RUST_BACKTRACE=1

    if [ "''${AGICASH_SHELL_QUIET:-0}" != "1" ]; then
      echo "agicash default shell"
      echo "  rustc:  $(rustc --version 2>/dev/null || echo 'not found')"
      echo "  cargo:  $(cargo --version 2>/dev/null || echo 'not found')"
      echo "  enter platform shells with: nix develop .#{ios,android,wasm}"
    fi
  '';
}
