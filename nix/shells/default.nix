# Default Rust dev shell.
#
# Matches workspace pin in crates/rust-toolchain.toml. Includes rustfmt,
# clippy, rust-analyzer, plus targets needed for cross-compiles (wasm,
# ios, android) so a contributor in this shell can `cargo build
# --target=...` without re-fetching the toolchain.
#
# Owns the env-var defaults required by the rust workspace. The defaults
# point at the LOCAL opensecret + Supabase stack (per memory
# project_opensecret_local_stack.md). Operator-supplied `.env` values
# loaded by direnv override the defaults; that's why the shellHook only
# fills a var when it is currently unset.
{ pkgs, lib, common }:

let
  # ---- workspace shell command wrappers ----------------------------------
  # `acli` etc. are convenience wrappers around `cargo run -p ...`.
  # Built as real script-bin derivations on PATH so they work in any shell
  # (bash, zsh, fish), any subprocess, any `nix develop -c <cmd>`, and any
  # direnv-exported environment. Each resolves the workspace root via
  # `git rev-parse --show-toplevel` so it works no matter where the
  # operator's cwd is under the repo. The bash function form used to break
  # for zsh users because `export -f` only propagates through bash.
  mkAgicashBin = name: body: pkgs.writeShellScriptBin name ''
    set -euo pipefail
    root="$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")"
    manifest="$root/crates/Cargo.toml"
    ${body}
  '';

  agicashBins = [
    (mkAgicashBin "acli"         ''exec cargo run --manifest-path "$manifest" -p agicash-cli -- "$@"'')
    (mkAgicashBin "acli_keyring" ''exec cargo run --manifest-path "$manifest" -p agicash-cli --features keyring-storage -- "$@"'')
    (mkAgicashBin "aweb"         ''exec cargo leptos serve --manifest-path "$root/crates/agicash-web-leptos/Cargo.toml" "$@"'')
    (mkAgicashBin "acodegen"     ''exec cargo run --manifest-path "$manifest" -p agicash-storage-supabase-codegen -- "$@"'')
    (mkAgicashBin "atest"        ''exec cargo test  --manifest-path "$manifest" --workspace "$@"'')
    (mkAgicashBin "abuild"       ''exec cargo build --manifest-path "$manifest" --workspace "$@"'')
    (mkAgicashBin "aclippy"      ''exec cargo clippy --manifest-path "$manifest" --workspace --all-targets "$@" -- -D warnings'')
    (mkAgicashBin "afmt"         ''exec cargo fmt   --manifest-path "$manifest" --all "$@"'')
    (mkAgicashBin "awasm"        ''exec cargo build --manifest-path "$manifest" --target wasm32-unknown-unknown -p agicash-wasm "$@"'')
  ];
in
pkgs.mkShell {
  name = "agicash-default";

  packages = common.basePackages ++ agicashBins ++ pkgs.lib.optionals pkgs.stdenv.isDarwin [
    pkgs.libiconv
  ];

  shellHook = ''
    export AGICASH_DEV_SHELL="default"
    export RUST_BACKTRACE=1

    # ---- sccache + shared CARGO_TARGET_DIR ---------------------------------
    # Cross-worktree build cache (per memory feedback_dev_loop_cache.md).
    # Use a HOME-rooted path so it survives container restarts and is
    # safe to share across every clone/worktree on this machine.
    export RUSTC_WRAPPER="${pkgs.sccache}/bin/sccache"
    export CARGO_TARGET_DIR="''${CARGO_TARGET_DIR:-$HOME/.cache/agicash-cargo-target}"
    export SCCACHE_DIR="''${SCCACHE_DIR:-$HOME/.cache/sccache}"
    mkdir -p "$CARGO_TARGET_DIR" "$SCCACHE_DIR"

    # ---- rust-workspace env defaults --------------------------------------
    # Point at the local opensecret enclave + Supabase. Only set if the
    # operator hasn't overridden via .env / direnv.
    : "''${OPENSECRET_BASE_URL:=http://127.0.0.1:3999}"
    : "''${OPENSECRET_CLIENT_ID:=ba5a14b5-d915-47b1-b7b1-afda52bc5fc6}"
    : "''${SUPABASE_URL:=https://127.0.0.1:54321}"
    : "''${SUPABASE_JWT_SECRET:=super-secret-jwt-token-with-at-least-32-characters-long}"
    # SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are JWTs signed by
    # the JWT secret above; supabase regenerates them locally on
    # `supabase start`. We don't pin them in the flake — operator's .env
    # is the source of truth.
    export OPENSECRET_BASE_URL OPENSECRET_CLIENT_ID SUPABASE_URL SUPABASE_JWT_SECRET

    # Cert paths used by supabase/config.toml when api.tls.enabled = true.
    # Supabase CLI resolves these relative to the supabase/ directory,
    # so use ../certs/... not absolute paths.
    export SELF_SIGNED_CERT_PATH="''${SELF_SIGNED_CERT_PATH:-../certs/localhost-cert.pem}"
    export SELF_SIGNED_CERT_KEY_PATH="''${SELF_SIGNED_CERT_KEY_PATH:-../certs/localhost-key.pem}"

    # Trust the mkcert CA inside the shell so any tool that respects
    # NODE_EXTRA_CA_CERTS / SSL_CERT_FILE picks it up.
    if command -v mkcert >/dev/null 2>&1; then
      caroot="$(mkcert -CAROOT 2>/dev/null || true)"
      if [ -n "$caroot" ] && [ -f "$caroot/rootCA.pem" ]; then
        export NODE_EXTRA_CA_CERTS="$caroot/rootCA.pem"
        : "''${SSL_CERT_FILE:=$caroot/rootCA.pem}"
        export SSL_CERT_FILE
      fi
    fi

    # Workspace command wrappers (acli, aweb, atest, …) are real bin
    # derivations defined in this file's `let` block and added to the
    # devshell's `packages` list — they appear on PATH automatically and
    # work in any shell (bash, zsh, fish), unlike the old `export -f`
    # bash functions which were invisible to zsh.

    # Generate the local-dev SSL cert if missing, so `supabase start`
    # comes up clean. Idempotent — script no-ops when the cert is good.
    if [ ! -f certs/localhost-cert.pem ] || [ ! -f certs/localhost-key.pem ]; then
      generate-ssl-cert || true
    fi

    if [ "''${AGICASH_SHELL_QUIET:-0}" != "1" ]; then
      echo "agicash default shell"
      echo "  rustc:           $(rustc --version 2>/dev/null || echo 'not found')"
      echo "  cargo:           $(cargo --version 2>/dev/null || echo 'not found')"
      echo "  sccache:         $RUSTC_WRAPPER"
      echo "  CARGO_TARGET_DIR: $CARGO_TARGET_DIR"
      echo "  OPENSECRET:      $OPENSECRET_BASE_URL"
      echo "  SUPABASE:        $SUPABASE_URL"
      echo ""
      echo "  binaries: acli, acli_keyring, aweb, acodegen, atest, abuild, aclippy, afmt, awasm"
      echo "  platform shells: nix develop .#{ios,android,wasm}"
    fi
  '';
}
