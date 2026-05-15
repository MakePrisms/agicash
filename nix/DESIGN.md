# Nix Dev Shells — Design

Reproducible per-environment dev shells for the agicash Rust SDK rewrite.
Replaces ad-hoc toolchain installs (Android NDK via Homebrew, "hope you
have Xcode tools on PATH"). Operators enter via `nix develop .#<name>`.

## Patterns extracted from pika (`sledtools/pika`)

Studied: `master` flake.nix (1182 lines), `.envrc` (`use flake`), repo
layout. Top patterns we adopt:

1.  **Single flake.nix, multiple named devShells via a factory.** Pika
    builds one `mkPikaDevShell { includeAndroid ? ..., shellName ? ... }`
    closure and instantiates it twice (`devShells.default`,
    `devShells.apple-host`), plus separate one-off `mkShell` blocks for
    `rmp` and `infra`. Lesson: the factory pattern is for the *base*
    shells that share most inputs; one-off shells stay flat. We use the
    same split: a shared `commonInputs` list + four named shells.

2.  **Rust toolchain via `rust-overlay` on `nixpkgs.rust-bin`.** Pika
    pulls `pkgs.rust-bin.stable.latest.default.override { extensions =
    [...]; targets = [...]; }`. We pin the *exact* version
    (`pkgs.rust-bin.stable."1.88.0".default`) to match the workspace's
    `rust-toolchain.toml` (slice 4). Same `rust-overlay` input.

3.  **Xcode is host-installed; the flake only wraps it.** Pika never
    installs Xcode (it's a closed-source GUI install). It uses
    `pkgs.xcodeenv.composeXcodeWrapper { versions = [...]; xcodeBaseDir
    = "/Applications/Xcode-${ver}.0.app"; }`, sets `DEVELOPER_DIR`
    in `shellHook`, and prints a banner with `xcodes install <ver>` if
    Xcode is missing. The Nix-provided cargo also has to be told to use
    `$DEVELOPER_DIR/Toolchains/.../clang` so `-liconv` works. We adopt
    this pattern verbatim for `.#ios`, but skip the "auto-install via
    `xcodes`" prompt — the team probably doesn't want flake-level
    package management on a closed-source IDE.

4.  **Android SDK via `tadfisher/android-nixpkgs` flake input.** Pika
    pins `ndk-28-2-13676358`, `cmdline-tools-latest`, `platform-tools`,
    `build-tools-35-0-0`, `platforms-android-35`. Sets `ANDROID_HOME`,
    `ANDROID_SDK_ROOT`, `ANDROID_NDK_HOME`, `JAVA_HOME` (jdk17_headless)
    in `shellHook`. **AVD/user state lives outside `/nix/store`** —
    pika exports `ANDROID_AVD_HOME` and `ANDROID_USER_HOME` to
    `$XDG_DATA_HOME`/`$XDG_STATE_HOME` so worktrees share emulator
    state. We adopt the SDK pin and env wiring, but pin NDK r29 as the
    brief requested (the `android-nixpkgs` attribute set names this
    `ndk-29-x-yyyyyyyy`; we'll pick the latest r29 available).

5.  **`.envrc` is one line: `use flake`.** Pika does not parameterise
    which shell direnv loads — `use flake` always selects
    `devShells.default`. For per-shell selection, contributors run
    `nix develop .#android` ad-hoc. We do the same: a single-line
    `.envrc` that loads `devShells.default` (the Rust shell), and
    document `nix develop .#<name>` for the platform-specific shells.
    This avoids a per-worktree config file and matches pika exactly.

Patterns we **don't** copy from pika: their use of `crane`,
`fileset.toSource`, in-flake CI lane definitions, NixOS host
modules, and the `xcodes install ${xcodeVersion}` interactive
prompt. Those serve pika's CI infra; our flake is dev-shell-only.

## File structure

```
flake.nix                  # entry point: inputs + outputs.devShells
flake.lock                 # generated, committed
nix/
  DESIGN.md                # this file
  shells/
    common.nix             # commonInputs (rust toolchain, base utils)
    default.nix            # base Rust shell (1.88, fmt, clippy, rust-analyzer)
    ios.nix                # adds xcodegen, uniffi-bindgen-swift, xcrun
    android.nix            # adds android NDK r29, cargo-ndk, JDK 17
    wasm.nix               # adds wasm-pack, wasm-bindgen-cli, binaryen
nix/README.md              # contributor docs: which shell when
```

`nix/shells/*.nix` are functions taking
`{ pkgs, rustToolchain, lib, system }` and returning a `pkgs.mkShell`
attrset. `flake.nix` imports them and wires inputs.

This split mirrors pika's *intent* (factory + named shells) but uses
file-per-shell instead of nesting in one giant flake.nix, since we're
starting from scratch and 4 separate files (~50 lines each) read
cleaner than one 200-line factory.

## devenv.nix interaction (critical)

`.envrc` currently contains `use devenv` — devenv owns the prek/git
hook setup (`devenv.nix` declares `git-hooks.hooks.{generate-db-types,
typecheck, biome}`). The slice-4-era `chore/rust-aware-hooks` branch
(commit `c8c699f8`) scopes those hooks to `files: ^...$` regexes; that
work is **orthogonal** to the flake — it modifies the same
`git-hooks.hooks.*` attrs without touching anything flake-related.

**Decision: keep devenv and flake side-by-side.** Two stacks, one repo:
- `.envrc` continues `use devenv` (auto-loaded by direnv on `cd`)
- `nix develop .#<name>` is opt-in for Rust/iOS/Android/WASM work
- Operators who want flake on `cd` can locally edit `.envrc` to add
  `use flake` (documented in `nix/README.md`)

This has the smallest blast radius: existing JS/TS contributors see no
behavioural change; Rust contributors get a new opt-in toolchain
without breaking the hook setup that prek depends on. Pika doesn't
have this layering problem because it's a pure Rust repo with no
devenv.

A future PR could migrate prek hooks from devenv into the flake (using
e.g. `pre-commit-hooks.nix` as a flake input), but that's invasive and
not justified by current need.

## Rust toolchain pin

Source of truth: `crates/rust-toolchain.toml` on `feat/rust-money-cashu`
(slice 4) pins `1.88.0` with `rustfmt`, `clippy`, target
`wasm32-unknown-unknown`. The flake mirrors this:

```nix
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
```

All shells share this `rustToolchain` so a contributor switching
between `.#default` and `.#ios` doesn't recompile their toolchain.
`rust-src` + `rust-analyzer` are dev-time conveniences for IDEs.

## Per-shell contracts

| Shell      | Provides                                                      | Sets                                          |
|------------|---------------------------------------------------------------|-----------------------------------------------|
| `default`  | rustToolchain, just, git, jq, openssl, pkg-config             | `RUST_BACKTRACE=1`                            |
| `ios`      | + xcodegen, uniffi-bindgen-swift, libiconv (Darwin only)      | `DEVELOPER_DIR` (if Xcode found)              |
| `android`  | + cargo-ndk, jdk17_headless, androidSdk (NDK r29)             | `ANDROID_HOME`, `ANDROID_NDK_HOME`, `JAVA_HOME` |
| `wasm`     | + wasm-pack, wasm-bindgen-cli, binaryen, nodejs_22            | —                                             |

iOS shell is **Darwin-only**: on Linux it falls back to the default
shell with a banner explaining iOS work requires macOS.

## Verification plan

After implementation, each shell must pass:
- `nix develop .#default --command rustc --version` → contains `1.88.0`
- `nix develop .#default --command cargo --version` → resolves
- `nix develop .#ios --command which xcodegen` → resolves (Darwin)
- `nix develop .#ios --command which uniffi-bindgen-swift` → resolves
- `nix develop .#android --command which cargo-ndk` → resolves; `cargo ndk --version` works
- `nix develop .#android --command bash -c 'echo $ANDROID_NDK_HOME'` → non-empty
- `nix develop .#wasm --command wasm-pack --version` → resolves

A full Android cross-compile (`cargo ndk -t aarch64-linux-android
build -p agicash-domain`) is **out of scope** for this PR: `crates/`
doesn't exist on `master`. The android-spike worktree (which has slice 4
landed) can re-run this check after `chore/nix-devshells` is merged.

## Known follow-ups (not in this PR)

- NDK r29 attribute exists in `android-nixpkgs` only if their channel
  has it (we'll discover the exact name at impl time; fall back to
  newest r28 if r29 not yet packaged for `aarch64-darwin`).
- CI workflow `.github/workflows/rust.yml` still pins
  `dtolnay/rust-toolchain@1.86.0` — should be bumped to `1.88.0` to
  match. Cross-cutting with slice 4 / hooks fix; out of scope here.
- Potential future: migrate prek/git hooks from devenv into the flake
  via `pre-commit-hooks.nix`, retire `devenv.nix`. Larger blast radius;
  defer until devenv friction outweighs migration cost.
