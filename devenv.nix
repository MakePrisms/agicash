{ pkgs, lib, config, inputs, ... }:

{
  # https://devenv.sh/basics/
  env.GREET = "devenv";

  # WASM cross-compile prereqs.
  #
  # `secp256k1-sys` and `ring` (transitive deps of cdk + opensecret) compile
  # C sources for the wasm32-unknown-unknown target. Apple's system clang
  # does NOT support wasm32, so without a wasm-capable clang on the
  # appropriate CC env var, `cargo check --target wasm32-unknown-unknown`
  # fails with "unknown target triple: wasm32-unknown-unknown".
  #
  # We point cc-rs at nix's clang_21 + llvm-ar via the well-known per-target
  # env vars. The rust target itself is declared in `crates/rust-toolchain.toml`
  # (rustup auto-installs `wasm32-unknown-unknown` when first invoked).
  #
  # IMPORTANT: use `clang_21.cc` (unwrapped) rather than `clang_21` (wrapped).
  # The nix cc-wrapper auto-injects darwin-specific flags like
  # `-fzero-call-used-regs=used-gpr` that wasm32 rejects, and emits a runtime
  # warning ("cc-wrapper is currently not designed with multi-target compilers
  # in mind. You may want to use an un-wrapped compiler instead.").
  #
  # See: /Users/claude/opensecret-sdk-fork wasm-compat work + the CDK wasm
  # audit doc (2026-05-15) for the full backstory.
  env.CC_wasm32_unknown_unknown = "${pkgs.clang_21.cc}/bin/clang";
  env.AR_wasm32_unknown_unknown = "${pkgs.llvm_21}/bin/llvm-ar";

  # Rust compile cache. `sccache` wraps `rustc` and reuses object files across
  # builds, giving a 10–30× speedup on warm rebuilds. The cache lives under
  # the workspace (gitignored) so it survives `cargo clean` and doesn't
  # collide across worktrees.
  #
  # `CARGO_INCREMENTAL=0` is REQUIRED: cargo's incremental compilation and
  # sccache are mutually exclusive — with incremental on, cargo skips rustc
  # invocations and sccache sees nothing to cache. Disabling incremental
  # gives sccache the full rustc invocations it needs to memoize, and
  # cross-worktree reuse more than compensates for the loss of in-workspace
  # incremental rebuilds.
  env.RUSTC_WRAPPER = "sccache";
  env.SCCACHE_DIR = "${config.devenv.root}/.sccache";
  env.SCCACHE_CACHE_SIZE = "20G";
  env.CARGO_INCREMENTAL = "0";

  # https://devenv.sh/packages/
  packages = [
    pkgs.git
    pkgs.jq
    pkgs.bun
    pkgs.fnm
    pkgs.mkcert
    pkgs.nss.tools
    pkgs.gh
    # wasm cross-compile toolchain (see CC_wasm32_unknown_unknown above).
    pkgs.clang_21
    pkgs.llvm_21
    # rust compile cache (see RUSTC_WRAPPER above).
    pkgs.sccache
    (pkgs.callPackage ./tools/convert-to-webp {})
  ];

  # https://devenv.sh/languages/
  # languages.rust.enable = true;

  # https://devenv.sh/processes/
  # processes.cargo-watch.exec = "cargo-watch";

  # https://devenv.sh/services/
  # services.postgres.enable = true;

  # https://devenv.sh/scripts/
  scripts.hello.exec = ''
    echo Hello from $GREET
  '';
  scripts.webstorm.exec = "$DEVENV_ROOT/tools/devenv/webstorm.sh $@";
  scripts.generate-ssl-cert.exec = "$DEVENV_ROOT/tools/devenv/generate-ssl-cert.sh";
  scripts.convert-gift-card-images.exec = ''
    shopt -s nullglob
    pngs=("$DEVENV_ROOT/app/assets/gift-cards/"*.png)
    if [ ''${#pngs[@]} -eq 0 ]; then
      echo "No PNG files found in app/assets/gift-cards/"
      exit 0
    fi
    convert-to-webp "''${pngs[@]}"
  '';
  scripts.convert-og-images.exec = ''
    shopt -s nullglob
    pngs=("$DEVENV_ROOT/public/og/"*.png)
    if [ ''${#pngs[@]} -eq 0 ]; then
      echo "No PNG files found in public/og/"
      exit 0
    fi
    convert-to-webp "''${pngs[@]}"
  '';

  enterShell = ''
    hello
    git --version
    echo Bun version: $(bun --version)
    generate-ssl-cert

    # Trust mkcert CA in Node.js (Makes node trust local cert and solves the issue with Supabase local MCP failing because of untrusted cert.)
    export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
  '';

  # https://devenv.sh/tasks/
  # tasks = {
  #   "myproj:setup".exec = "mytool build";
  #   "devenv:enterShell".after = [ "myproj:setup" ];
  # };

  # https://devenv.sh/tests/
  enterTest = ''
    echo "Running tests"
    git --version | grep --color=auto "${pkgs.git.version}"
  '';

  # https://devenv.sh/pre-commit-hooks/
  # Hooks are scoped to relevant file types so that commits touching only
  # non-JS/TS files (e.g. Rust crates, docs) skip the JS/TS pipeline.
 git-hooks.hooks.generate-db-types = {
    enable = true;
    name = "Generate database types from local db";
    entry = "bun run db:generate-types";
    files = "^supabase/migrations/.*\\.sql$";
    pass_filenames = false;
  };

 git-hooks.hooks.typecheck = {
    enable = true;
    entry = "bun run typecheck";
    pass_filenames = false;
    files = "\\.(ts|tsx|js|jsx|mjs|cjs)$";
  };

 git-hooks.hooks.biome = {
    enable = true;
    entry = "bun run fix:staged";
    # biome's built-in types_or already scopes to js/jsx/ts/tsx/json.
  };

  # See full reference at https://devenv.sh/reference/options/
}
