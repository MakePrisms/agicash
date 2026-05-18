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
#
# CC / AR env vars (transferred from the old devenv.nix, fixed up in
# commit b172760f of the devshell-wasm worktree):
#   `clang_21.cc` is the UNWRAPPED clang binary. The nix cc-wrapper that
#   wraps `clang_21` auto-injects darwin-specific flags like
#   `-fzero-call-used-regs=used-gpr` that wasm32 rejects, breaking C
#   compiles of `ring`, `secp256k1-sys`, etc. The wrapper itself emits a
#   runtime warning admitting it is "not designed with multi-target
#   compilers in mind." Bypassing the wrapper fixes this for the wasm
#   target only — native cargo builds still use the wrapped clang.
{ pkgs, lib, common }:

pkgs.mkShell {
  name = "agicash-wasm";

  packages = common.basePackages ++ [
    pkgs.wasm-pack
    pkgs.wasm-bindgen-cli_0_2_121
    pkgs.binaryen
    pkgs.nodejs_22
    pkgs.clang_21
    pkgs.llvm_21
  ];

  CC_wasm32_unknown_unknown = "${pkgs.clang_21.cc}/bin/clang";
  AR_wasm32_unknown_unknown = "${pkgs.llvm_21}/bin/llvm-ar";

  shellHook = ''
    export AGICASH_DEV_SHELL="wasm"
    export RUST_BACKTRACE=1

    # secp256k1-sys (transitive from `cashu`) wraps a C library. Even with
    # `CC_wasm32_unknown_unknown` pointing at the UNWRAPPED clang, the nix
    # cc-wrapper for the host clang still leaks `NIX_HARDENING_ENABLE=...`
    # into the wasm child compile, injecting flags like
    # `-fzero-call-used-regs=used-gpr` that wasm32 rejects. Clearing the
    # var here (per Worker L4's notes, the previous devenv used the same
    # workaround) ensures wasm builds of secp256k1-sys / ring succeed
    # inside `nix develop .#wasm` without per-call env juggling. Native
    # builds use the default shell and remain unaffected.
    export NIX_HARDENING_ENABLE=""

    # sccache + shared CARGO_TARGET_DIR (same as default shell).
    export RUSTC_WRAPPER="${pkgs.sccache}/bin/sccache"
    export CARGO_TARGET_DIR="''${CARGO_TARGET_DIR:-$HOME/.cache/agicash-cargo-target}"
    export SCCACHE_DIR="''${SCCACHE_DIR:-$HOME/.cache/sccache}"
    mkdir -p "$CARGO_TARGET_DIR" "$SCCACHE_DIR"

    if [ "''${AGICASH_SHELL_QUIET:-0}" != "1" ]; then
      echo "agicash wasm shell"
      echo "  rustc:        $(rustc --version 2>/dev/null || echo 'not found')"
      echo "  wasm-pack:    $(wasm-pack --version 2>/dev/null || echo 'not found')"
      echo "  wasm-bindgen: $(wasm-bindgen --version 2>/dev/null || echo 'not found')"
      echo "  wasm-opt:     $(wasm-opt --version 2>/dev/null | head -1 || echo 'not found')"
      echo "  CC (wasm32):  $CC_wasm32_unknown_unknown"
    fi
  '';
}
