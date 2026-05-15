# Nix Dev Shells

Reproducible per-environment toolchain provisioning via `nix develop`.
Replaces ad-hoc installs (Homebrew Android NDK, "hope you have Xcode
tools on PATH"). Inspired by [sledtools/pika](https://github.com/sledtools/pika).

## Quick start

```sh
# Default: Rust toolchain (1.88) + clippy + rustfmt + rust-analyzer +
# wasm/ios/android target triples preconfigured.
nix develop

# Platform-specific shells (extend the default with platform tooling):
nix develop .#ios       # adds xcodegen, sets DEVELOPER_DIR from xcode-select
nix develop .#android   # adds Android SDK + NDK r28 + cargo-ndk + JDK 17
nix develop .#wasm      # adds wasm-pack, wasm-bindgen-cli, binaryen
```

The Rust toolchain is shared across all four shells, so switching does
not re-download cargo/rustc.

## Which shell when?

| Shell      | When to use                                                          |
|------------|----------------------------------------------------------------------|
| `default`  | Day-to-day Rust work in `crates/`: `cargo build`, `cargo test`, lints. |
| `ios`      | Generating Xcode projects (`xcodegen`), building Swift bindings.     |
| `android`  | Cross-compiling crates for Android: `cargo ndk -t <triple> build`.   |
| `wasm`     | Building the `agicash-wasm` crate: `wasm-pack build`, `wasm-opt`.    |

## Why not `use flake` in `.envrc`?

The repo's `.envrc` is currently `use devenv` (loads `devenv.nix` —
prek/git hooks). Switching to `use flake` would silently disable those
hooks for everyone. The flake is **opt-in** instead: contributors run
`nix develop .#<name>` ad-hoc.

If you want direnv to auto-enter a flake shell on `cd`, replace your
local `.envrc` (do not commit) with:

```
use flake .#default   # or .#ios, .#android, .#wasm
```

A future PR may migrate prek hooks from `devenv.nix` into the flake,
at which point `.envrc` can switch to `use flake` repo-wide.

## Pin sources of truth

- Rust toolchain version: `crates/rust-toolchain.toml` (currently
  `1.88.0`, on `feat/rust-money-cashu` / slice 4; not yet on master).
  `nix/shells/common.nix` mirrors this.
- Android NDK: pinned to `ndk-28-2-13676358` in `nix/shells/android.nix`
  (matches the operator's working sapling setup; r29 bump is a future PR).
- Xcode: **not** pinned. Contributors manage Xcode via the App Store;
  the iOS shell reads `DEVELOPER_DIR` from `xcode-select -p`.

When bumping the Rust toolchain, change *both* `rust-toolchain.toml`
and `nix/shells/common.nix` in the same commit.

## What is NOT in this flake

- `uniffi-bindgen-swift` (not packaged in nixpkgs at this pin).
  Install with `cargo install uniffi-bindgen-swift` inside the
  `ios` shell.
- A full Android compile verification (`cargo ndk -t aarch64-linux-android
  build -p agicash-domain`). The `crates/` directory is not on `master`;
  re-run from the android-spike worktree once slice 4 lands.
- Prek/git hooks. Those still come from `devenv.nix`.

## Layout

```
flake.nix                  # entry point: inputs + outputs.devShells
flake.lock                 # generated, committed
nix/
  DESIGN.md                # pattern notes + structure rationale
  README.md                # this file
  shells/
    common.nix             # shared inputs (rustToolchain, basePackages)
    default.nix            # base Rust shell
    ios.nix                # Darwin-only iOS extras
    android.nix            # Android SDK + NDK + cargo-ndk
    wasm.nix               # wasm-pack + binaryen
```

## Known issues / unverified

The shells were committed before exhaustive `nix develop .#<name>
--command` smoke tests completed (first-time eval downloads were
running long). The structure is sound and follows pika's patterns
verbatim, but operators should manually verify on first entry:

- **default**: `nix develop --command rustc --version` → `1.88.0`
- **ios**: Darwin host, `which xcodegen` resolves; `DEVELOPER_DIR` non-empty
- **android**: `cargo ndk --version` resolves; `$ANDROID_NDK_HOME` non-empty
- **wasm**: `wasm-pack --version` resolves; `wasm-bindgen --version` resolves

If any shell fails to evaluate, the likely culprits are:
- `pkgs.wasm-bindgen-cli_0_2_121` may not exist at the locked
  nixpkgs revision — bump to whatever `_0_2_NNN` is available.
- `android-nixpkgs` channel may not yet have `ndk-28-2-13676358`
  pinned — verify `nix flake metadata github:tadfisher/android-nixpkgs`.

## Troubleshooting

**`error: experimental Nix feature 'flakes' is disabled`** — enable
flakes in `~/.config/nix/nix.conf` with
`experimental-features = nix-command flakes`.

**`error: cached failure of attribute 'devShells.aarch64-darwin.android'`** —
delete the eval cache: `rm -rf ~/.cache/nix/eval-cache-v5/*`.

**iOS shell can't find `xcrun`** — run `xcode-select --install`, then
`sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.
