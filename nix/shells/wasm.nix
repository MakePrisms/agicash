# WASM dev shell.
#
# Adds wasm-pack, wasm-bindgen-cli, and binaryen (wasm-opt) for building
# the agicash-wasm crate. The rust toolchain already includes the
# wasm32-unknown-unknown target (see common.nix).
#
# wasm-bindgen-cli is pinned by exact version because nixpkgs ships many
# versioned attrs (wasm-bindgen-cli_0_2_NNN). The workspace pins
# `wasm-bindgen = "0.2"`; wasm-pack itself enforces compatibility at
# build time, so pinning the CLI here is informational.
{ pkgs, lib, common }:

pkgs.mkShell {
  name = "agicash-wasm";

  packages = common.basePackages ++ [
    pkgs.wasm-pack
    pkgs.wasm-bindgen-cli_0_2_121
    pkgs.binaryen
    pkgs.nodejs_22
  ];

  shellHook = ''
    export AGICASH_DEV_SHELL="wasm"
    export RUST_BACKTRACE=1

    if [ "''${AGICASH_SHELL_QUIET:-0}" != "1" ]; then
      echo "agicash wasm shell"
      echo "  rustc:        $(rustc --version 2>/dev/null || echo 'not found')"
      echo "  wasm-pack:    $(wasm-pack --version 2>/dev/null || echo 'not found')"
      echo "  wasm-bindgen: $(wasm-bindgen --version 2>/dev/null || echo 'not found')"
      echo "  wasm-opt:     $(wasm-opt --version 2>/dev/null | head -1 || echo 'not found')"
    fi
  '';
}
