# Shared Cargo Build Cache

Operator guide for the workspace-level cargo cache config that ships in
`crates/.cargo/config.toml`. Read this before you wonder why your build
output landed somewhere unexpected, or before you try to "fix" a slow
build by blowing the cache away.

## What it does

`crates/.cargo/config.toml` sets two things for every `cargo …` invocation
made inside the `crates/` workspace:

```toml
[build]
target-dir    = "/Users/claude/.cache/agicash-cargo-target"
rustc-wrapper = "/opt/homebrew/bin/sccache"
```

- **`target-dir`** — every worktree writes its compiled artifacts to the
  same on-disk directory, so cargo's incremental cache and fingerprints
  survive worktree boundaries. The first worktree to compile pays the
  bill; every subsequent worktree at the same revision gets a near-noop
  build (`cargo build … --target aarch64-apple-ios-sim --release` in
  ~1s instead of ~6m).
- **`rustc-wrapper = sccache`** — sccache transparently caches rustc
  outputs by content-hash of the inputs. When a `cargo clean`, branch
  switch, or `rm -rf target/<triple>/<profile>` destroys cargo's
  fingerprint cache, sccache can still serve the same `.o` / `.rlib`
  from its own store. Measured: a wiped sim-release build that would
  cost 6m25s cold completed in 34s with a 100 % sccache hit rate.

## Why it exists

The agicash repo has ~30 git worktrees under `.claude/worktrees/*`.
Each one used to keep its own `crates/target/` (often 1 GB+). Cross-
compiling `agicash-ffi` for iOS (sim + device) or Android (3 ABIs)
from a fresh worktree took 5-15 min cold even when only a handful of
files had actually changed since the last build elsewhere. Sharing
the target dir + layering sccache reclaims most of that cost.

## sccache

- Version: `0.15.0` (Homebrew bottle, `arm64_tahoe`).
- Binary: `/opt/homebrew/bin/sccache`.
- Default on-disk cache: `~/Library/Caches/Mozilla.sccache`.
- Default cache cap: 10 GiB. Override with `SCCACHE_CACHE_SIZE=…`.
- Inspect: `sccache --show-stats`. Reset counters: `sccache --zero-stats`.
- The `rustc-wrapper` path is absolute. If you install sccache elsewhere
  (e.g. via Nix), update `config.toml` to match.

## Cargo discovery, in plain English

Cargo walks **up from the invocation cwd**, plus checks `$CARGO_HOME/config.toml`.
That means:

- `cd crates && cargo …` — finds `crates/.cargo/config.toml`. **Shared cache active.**
- `cd crates/agicash-ffi && cargo …` — same, walks up one level.
- `cd bindings/swift/rust && cargo …` — does NOT find `crates/.cargo/config.toml`
  because the walk stops at the repo root. The two `bindings/{swift,kotlin}/rust/`
  sub-workspaces still keep their own local `target/` until their own
  `.cargo/config.toml` is added (see "Known limitations").

## Bypass for an isolated build

If you need a build that does NOT share the cache (debugging a poisoned
fingerprint, building against a divergent rustc, etc):

```bash
# Per-invocation override (preferred):
CARGO_TARGET_DIR="$PWD/target" RUSTC_WRAPPER="" \
    cargo build -p agicash-ffi --target aarch64-apple-ios-sim --release
```

`CARGO_TARGET_DIR` env var beats `[build].target-dir` in the config.
`RUSTC_WRAPPER=""` (empty) disables sccache for that one invocation.

## Clearing the cache when things misbehave

Symptoms of a poisoned cache: link errors that don't match the source,
`metadata mismatch` errors after a rust-toolchain change, "expected
struct X, found struct X" errors that bisect to "everything is fine".

```bash
# Nuke the shared target dir (forces full recompile from sccache):
rm -rf /Users/claude/.cache/agicash-cargo-target

# Nuke sccache too (full from-source recompile):
sccache --stop-server
rm -rf ~/Library/Caches/Mozilla.sccache
```

After a rust-toolchain.toml channel bump, blow the target dir but keep
sccache — different toolchains produce different cache keys, so the
sccache hits land elsewhere, no collision.

## Caveats

1. **Concurrency:** cargo handles parallel invocations against the
   same target dir via a per-target file lock, but two concurrent
   builds with different `--target`s or different `--release`/`--debug`
   profiles will serialise on the same lock. Plan tmux lanes accordingly:
   if two workers race the same `cargo build -p agicash-ffi --target X
   --release` they'll just wait, no data corruption.
2. **ABI mismatches across worktrees:** if two worktrees diverge on a
   common dep (e.g. one bumps `tokio` in `Cargo.lock`, the other hasn't),
   cargo will fingerprint them differently and recompile — no breakage,
   just less sharing.
3. **NDK / SDK pinning:** the cache key includes the rustc version,
   target triple, and `RUSTFLAGS`. Switching Xcode versions or NDK
   versions across worktrees will partition the cache (sccache stores
   the alternates side-by-side, cargo recompiles, no breakage). Pin
   `DEVELOPER_DIR` + `ANDROID_NDK_HOME` consistently if you want to
   actually hit the cache across worktrees.
4. **rust-toolchain.toml drift:** worktrees on different rust channels
   share the target dir but each channel pays its own cold-build cost
   once. Worth knowing if you're rebasing across a channel bump.
5. **iOS cross-compile env:** `bindings/swift/generate-bindings.sh`
   already unsets nix-shell env vars that break iOS compilation; the
   shared target dir doesn't change that — just inherits whatever you
   set going in.

## Known limitations

- `bindings/swift/rust/` and `bindings/kotlin/rust/` are standalone
  cargo projects (not workspace members). Cargo's config discovery
  doesn't reach `crates/.cargo/config.toml` from those paths. To
  share the cache there too, add a matching `.cargo/config.toml` next
  to each binding's `Cargo.toml`. (Deferred to the next person to
  touch the scaffold branches — would have meant cross-branch edits
  here.)
- Migration cost: any worktree currently using its own `target/` keeps
  using it until `target/` is removed manually OR cargo decides to
  rebuild. The shared dir will fill up the first time each rust crate
  is built fresh; after that, near-noop.
