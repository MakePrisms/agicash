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

pkgs.mkShell {
  name = "agicash-default";

  packages = common.basePackages ++ pkgs.lib.optionals pkgs.stdenv.isDarwin [
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

    # ---- workspace shell functions ----------------------------------------
    # `acli` etc. are convenience wrappers around `cargo run -p ...`.
    # Defined as shell functions (not aliases) so they survive `bash -c`,
    # `nix develop -c <cmd>`, and direnv-exported environments. Each
    # resolves the workspace via `git rev-parse --show-toplevel` so it
    # works no matter where the operator's cwd is under the repo.
    _agicash_manifest() {
      local root
      root="$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")"
      echo "$root/crates/Cargo.toml"
    }
    acli()        { cargo run --manifest-path "$(_agicash_manifest)" -p agicash-cli -- "$@"; }
    acli_keyring() { cargo run --manifest-path "$(_agicash_manifest)" -p agicash-cli --features keyring-storage -- "$@"; }
    # `aweb` builds the leptos PWA wasm bundle via wasm-pack and
    # (optionally) serves the crate dir as static files. The old SSR
    # path (cargo-leptos + axum) was ripped on 2026-05-17 in favour of
    # a pure CSR cdylib + browser-side opensecret calls. Run `aweb` to
    # one-shot build; pass `--serve` to also start a
    # `python3 -m http.server 3000` from the crate dir. The crate dir
    # is the static-files root: index.html, style/, public/, and
    # wasm-pack's pkg/ all live there. Note this function needs the
    # wasm dev shell — run `nix develop .#wasm` first.
    aweb() {
      local root crate
      root="$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")"
      crate="$root/crates/agicash-web-leptos"
      (cd "$crate" && wasm-pack build --target web --out-dir pkg --dev) || return $?
      if [ "$1" = "--serve" ]; then
        (cd "$crate" && python3 -m http.server 3000)
      fi
    }
    acodegen()    { cargo run --manifest-path "$(_agicash_manifest)" -p agicash-storage-supabase-codegen -- "$@"; }
    atest()       { cargo test  --manifest-path "$(_agicash_manifest)" --workspace "$@"; }
    abuild()      { cargo build --manifest-path "$(_agicash_manifest)" --workspace "$@"; }
    aclippy()     { cargo clippy --manifest-path "$(_agicash_manifest)" --workspace --all-targets "$@" -- -D warnings; }
    afmt()        { cargo fmt   --manifest-path "$(_agicash_manifest)" --all "$@"; }
    awasm()       { cargo build --manifest-path "$(_agicash_manifest)" --target wasm32-unknown-unknown -p agicash-wasm "$@"; }
    export -f _agicash_manifest acli acli_keyring aweb acodegen atest abuild aclippy afmt awasm 2>/dev/null || true

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
      echo "  functions: acli, acli_keyring, aweb, acodegen, atest, abuild, aclippy, afmt, awasm"
      echo "  platform shells: nix develop .#{ios,android,wasm}"
    fi
  '';
}
