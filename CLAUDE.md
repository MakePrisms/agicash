# CLAUDE.md

## Project

Agicash is a multi-platform self-custody wallet SDK. A pure-Rust core
(`crates/`) is consumed by four shells: `agicash-cli`, a SwiftUI iOS app
(`ios/`), a Kotlin Android app (`android/`), and a Leptos browser PWA
(`crates/agicash-web-leptos`). Primary protocol is Cashu; Lightning and
LN-Address are secondary. Identity + seeds + per-user encryption keys live in
the OpenSecret enclave. Wallet rows live in Supabase Postgres (`wallet`
schema), with sensitive columns encrypted client-side using a key derived
from the OpenSecret session.

See `README.md` for operator-facing setup. See `docs/architecture.md` for the
layered architecture. This file is the working notes for future Claude
sessions in this repo.

## Working approach

- **Spec-based.** If a requirement is unclear, ask. Don't assume.
- **Verify before using.** Before calling any function — internal or
  third-party — read its source or type definitions. Don't infer behavior
  from the name. For crates outside the workspace, check the `Cargo.lock`
  version and read the source under `$CARGO_HOME/registry/src/...` or the
  crate's GitHub.
- **Verify by running.** When unsure how something behaves at runtime, run
  it. Write a small test, or call the binary, or hit the sim. Prefer
  evidence over assumptions.
- **Bug fixing.** Reproduce first, then fix. Write a failing test, apply the
  fix, verify the test passes.
- **Self-review.** Before reporting a task complete, re-read your own diff.
  Run `aclippy` and `atest`.
- **Money handling (CRITICAL).** Use the `agicash-money::Money` type for any
  amount that crosses a crate boundary. Raw integer arithmetic on amounts is
  a bug. Floating point is never acceptable.

## Autonomy

**Ask first:**
- Installing new dependencies (cargo add, SDK adds).
- Running migrations or anything that mutates a database you didn't create.
- Destructive git ops (force push, hard reset on a shared branch).

**Do autonomously:**
- Read + edit code.
- Run `atest`, `aclippy`, `afmt`.
- Build platform artifacts (`bindings/swift/generate-bindings.sh`, etc.).
- Run the CLI against the local stack.

## Build + dev loop

The flake's default shell (in `nix/shells/default.nix`) provides shell
functions, not aliases — they survive `nix develop -c <cmd>` and
`bash -c`:

| Function       | Purpose                                                  |
|----------------|----------------------------------------------------------|
| `acli`         | `cargo run -p agicash-cli --`                            |
| `acli_keyring` | same with `--features keyring-storage`                   |
| `aweb`         | leptos PWA dev loop                                      |
| `acodegen`     | regenerate `agicash-storage-supabase/src/generated.rs`   |
| `atest`        | `cargo test --workspace`                                 |
| `abuild`       | `cargo build --workspace`                                |
| `aclippy`      | `cargo clippy --workspace --all-targets -- -D warnings`  |
| `afmt`         | `cargo fmt --all`                                        |
| `awasm`        | `cargo build --target wasm32-unknown-unknown -p agicash-wasm` |

Cross-compile shells: `nix develop .#ios`, `.#android`, `.#wasm`.

## Local stack

- OpenSecret enclave on `:3999` — run from `~/opensecret` (`cargo run`).
  Backed by a postgres on `:5432` (nix-native service, set up once).
- Supabase on `:54321` (HTTPS, mkcert cert) — `bunx supabase start`.
- The flake hook fills `OPENSECRET_BASE_URL`, `SUPABASE_URL`, etc. with
  local defaults if unset. `.env` (gitignored) holds the regenerated
  `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` after each
  `bunx supabase start`.

Full setup details: `docs/local-stack.md`.

## Branch conventions

- `agicash-rs/master` is the canonical main branch (remote
  `git@github.com:gudnuf/agicash-rs.git`).
- `master-merger` is the integration branch. Feature branches merge into
  `master-merger`; the operator promotes `master-merger` → `master` once
  the slice is green.
- No PR-required workflow. Merges are direct.
- Default branch name is `master`, not `main`.
- Keep feature branches short-lived. Branch off the latest
  `agicash-rs/master`.

## Architecture (shape)

```
View → ViewModel → WalletClient (agicash-wallet)
                ↓
            agicash-services (async orchestrators)
                ↓
            agicash-cashu / agicash-spark (sans-IO state machines)
                ↓
            agicash-traits (Storage*, KeyProvider, TokenProvider, Clock)
                ↓
   agicash-storage-supabase · agicash-auth-opensecret · cdk providers
```

Trait composition is the spine. The same `WalletClient` runs on iOS,
Android, the Leptos PWA, and the CLI. Sans-IO state machines own protocol
logic; orchestrators glue them to providers; the facade aggregates them.

**Auth flow:** OpenSecret session → third-party JWT → Supabase RLS
session. Private keys never leave the device (or browser) — sensitive
columns are encrypted client-side.

## Platform gotchas

- **iOS rebuild-first.** When iOS UI ≠ Rust behaviour, rebuild the
  xcframework + reinstall the .app before debugging. Half of "the Swift
  fix doesn't work" reports are stale builds. `strings` on the .app only
  sees the Rust side; it lies about Swift fixes.
- **iOS sim Keychain trap.** The simulator's Keychain survives app
  uninstall. A stale session can produce a 36-min silent hang on next
  launch. Run `xcrun simctl erase <udid>` between runs when chasing auth
  issues.
- **Android emulator localhost.** The emulator's `127.0.0.1` is the
  emulator, not the host. Reach host services at `10.0.2.2`
  (`OPENSECRET_BASE_URL=http://10.0.2.2:3999`,
  `SUPABASE_URL=https://10.0.2.2:54321`).
- **Android TLS.** rustls-platform-verifier must be initialized in
  `MainActivity.onCreate` via JNI; without it every network call fails
  silently. See `project_agicash_android_tls.md` if a worker is fixing
  this.
- **Swift bindings split.** `bindings/swift/Sources/AgicashSDK/*.swift`
  is gitignored (regenerated per build); the XCFramework is also
  gitignored. The `generate-bindings.sh` script + `bindings/swift/rust/`
  manifest are tracked. Don't commit generated files.
- **WASM build flag.** When building wasm crates inside `nix develop`,
  set `NIX_HARDENING_ENABLE=""` if cross-compilation fails with
  hardening-flag errors. The wasm shell handles this; the default shell
  may not.
- **CDK + wasm.** CDK supports wasm out of the box with
  `default-features = false, features = ["wallet"]`. Do not fork CDK to
  add wasm support.
- **DLEQ verification missing.** NUT-12 DLEQ verification isn't yet in
  the hot paths. P0 before mainnet. See
  `project_agicash_dleq_gap.md` for patch sites.

## Prek hook escape

The prek hook is installed without a working config in some worktrees;
`git commit` may hang. Two options:

```sh
# 1. one-shot bypass (allowed):
PREK_ALLOW_NO_CONFIG=1 git commit -m "..."

# 2. disable the stale hook locally:
mv .git/hooks/pre-commit .git/hooks/pre-commit.disabled-stale-devenv
```

Don't `--no-verify` blindly; the bypass above keeps real hooks intact.

## iOS rust logs

The Rust FFI installs a `tracing-subscriber` → `os_log` bridge on first FFI
call (see `crates/agicash-ffi/src/observability.rs`). Every `tracing::info!`
/ `debug!` / `warn!` / `error!` in any rust crate shows up under subsystem
`app.agicash.rust`.

Stream live from the booted sim:

```sh
xcrun simctl spawn booted log stream \
  --predicate 'subsystem == "app.agicash.rust"' \
  --info --debug
```

After-the-fact (last 5 min):

```sh
xcrun simctl spawn booted log show \
  --predicate 'subsystem == "app.agicash.rust"' \
  --info --debug \
  --last 5m
```

Filter level defaults to `info`; override via `AGICASH_LOG` (EnvFilter
syntax) read once at first FFI call.

**Never log:** JWTs, secret keys, refresh tokens, full proof secrets, full
token strings. The OpenSecret `sub` claim and account UUIDs are safe.

## Database safety

- Never run `bunx supabase db reset` against a local DB you care about.
- Never run `bunx supabase db push` or any remote DB operation without
  explicit approval. Hosted migrations go through the Supabase dashboard
  branching workflow.
- Don't drop tables or columns without explicit approval.
- After schema changes: `acodegen` (or `bash scripts/gen-rust-types.sh`)
  to regenerate `crates/agicash-storage-supabase/src/generated.rs`. Don't
  run codegen against unapplied migrations — silently stale types.

## Skills

Load a skill before making changes in its domain, not after. Skill
descriptions in the system prompt explain when each applies.
