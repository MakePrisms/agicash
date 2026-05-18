# Agicash

Rust-first wallet workspace. Pure-Rust core crates (`crates/`) feed:

- **`agicash-cli`** — terminal wallet (`agicash` binary). Daily-driver tool.
- **`agicash-ffi`** — UniFFI bindings consumed by:
  - **`ios/`** — native SwiftUI app (`bindings/swift/`).
  - **`android/`** — native Kotlin app (`bindings/kotlin/`).
- **`agicash-web-leptos`** — Leptos PWA (axum SSR + wasm hydrate). Replacement for the old React Router app; under active scaffolding.
- **`agicash-wasm`** — thin wasm shim used by future browser consumers.

Identity/auth + key management runs through the [Open Secret](https://opensecret.cloud) platform. Mutable data lives in a Postgres database hosted on Supabase; sensitive columns are encrypted using keys from Open Secret.

For deeper architecture notes see [`docs/architecture.md`](docs/architecture.md). The pre-Rust React Router app is preserved on the `archive/react-web-app` branch + `react-web-app-final` tag for reference.

## Getting started

We use [Nix flakes](https://nixos.wiki/wiki/Flakes) + [direnv](https://direnv.net/) for the dev environment. One-time setup:

1. Install Nix (macOS):
   `curl -L https://github.com/NixOS/experimental-nix-installer/releases/download/0.27.0/nix-installer.sh | sh -s -- install`
2. Install direnv:
   * macOS: `brew install direnv`
   * Hook it into your shell ([docs](https://direnv.net/docs/hook.html)).
3. `cd ~/agicash && direnv allow`. direnv loads `flake.nix` automatically — first entry takes a few minutes to populate the store, subsequent entries are instant.

The default shell ships Rust 1.88 (workspace pin) with rustfmt, clippy, rust-analyzer, and the wasm32 / iOS / Android targets. Cross-compile shells: `nix develop .#ios`, `.#android`, `.#wasm` — see [`nix/README.md`](nix/README.md).

## Development

1. Copy `.env.example` to `.env` (gitignored). The flake exports sane defaults for everything pointing at the local stack; the only values you usually need to override in `.env` are the supabase anon / service-role keys after a `supabase start` regenerates them.

   ```sh
   cp .env.example .env
   ```

2. Start the local Supabase stack:

   ```sh
   supabase start
   ```

3. Run the CLI:

   ```sh
   acli auth guest           # create a guest session against local opensecret
   acli --help
   ```

   The `acli` alias is wired in `nix/shells/default.nix`; the full form is `cargo run -p agicash-cli --`.

### Shell functions provided by the dev shell

Defined in `nix/shells/default.nix` as shell functions (not aliases) so they survive `bash -c`, `nix develop -c <cmd>`, and exported environments.

| Function | Expands to |
|---|---|
| `acli` | `cargo run -p agicash-cli --` |
| `acli_keyring` | same with `--features keyring-storage` (OS-keyring session storage) |
| `aweb` | `cargo leptos serve` (Leptos PWA dev loop — requires `cargo install cargo-leptos`) |
| `acodegen` | `cargo run -p agicash-storage-supabase-codegen --` |
| `atest` | `cargo test --workspace` |
| `abuild` | `cargo build --workspace` |
| `aclippy` | `cargo clippy --workspace --all-targets -- -D warnings` |
| `afmt` | `cargo fmt --all` |
| `awasm` | `cargo build --target wasm32-unknown-unknown -p agicash-wasm` |

### HTTPS for local Supabase

Supabase serves `https://127.0.0.1:54321` using a mkcert-issued self-signed certificate. The dev shell auto-runs `generate-ssl-cert` on first entry; rerun manually after your local IP / hostname changes.

**Mobile devices on the same Wi-Fi:** install the mkcert root CA so iOS/Android trust the local cert. Find it via `mkcert -CAROOT` (typically `~/Library/Application Support/mkcert/rootCA.pem`), AirDrop / email it to the device, then install via **Settings → General → VPN & Device Management** and enable trust in **Settings → General → About → Certificate Trust Settings**.

### Branching

`master` is the main branch. Feature branches branch off `master` and are merged directly back into `master` (no PR-required workflow per the agicash-rs convention). Keep feature branches short-lived.

## Database

Auth data (user ID, email, etc.) lives in Open Secret. Wallet data lives in a Postgres database hosted on Supabase; sensitive columns are encrypted with a key derived from the Open Secret session.

Start the local Supabase stack:
```sh
supabase start    # postgres, auth, storage, realtime, studio
supabase stop
```
Supabase is configured in `supabase/config.toml`. Visit Supabase Studio at the URL printed by `supabase start`.

### Database migrations

Schema changes go through SQL migrations under `supabase/migrations/`.

- Author a migration: `supabase migration new <name>` (or `supabase db diff --file <name>` after editing in Studio).
- Apply locally: `supabase db push`.
- Reset local DB to a clean state: `supabase db reset` (re-runs every migration + `seed.sql`).

To regenerate the rust storage bindings (`crates/agicash-storage-supabase/src/generated.rs`) after changing migrations:
```sh
acodegen --migrations-dir supabase/migrations --schema wallet --out crates/agicash-storage-supabase/src/generated.rs
```
or just `bash scripts/gen-rust-types.sh` (same thing).

Migrations to hosted envs are applied via the Supabase platform branching workflow; see the Supabase dashboard.

### Event system

The app uses a generic DB-driven event system: any table can emit events by attaching a trigger that calls
`wallet.emit_event('event.type')`. The trigger signs the payload with HMAC-SHA256 and posts it to the app's
`/api/events` route, which verifies the signature and dispatches to handlers (e.g. sending a welcome email via Resend).

The trigger function reads two values at runtime:
- `wallet.app_config.webhook_base_url` — a row in the `wallet.app_config` table holding the base URL of the app
- `webhook_secret` — a vault secret holding the shared HMAC secret (must match the `WEBHOOK_SECRET` env var on the app side)

If either value is missing the function logs a warning and no-ops, so triggers won't block inserts/updates
but events will not be delivered.

**Local dev:** both values are seeded automatically by `supabase/seed.sql` when you run `supabase start`
or `supabase db reset`. No manual setup needed.

**Hosted envs (next, prod, preview branches):** both values must be set ONCE per environment. Run the
following in the Supabase SQL editor against the target environment's database, substituting the correct URL
and a fresh secret:

```sql
-- 1. set the base URL for webhook delivery
insert into "wallet"."app_config" ("key", "value") values ('webhook_base_url', 'https://agi.cash');

-- 2. create the HMAC secret
select vault.create_secret(
  '<paste-32-byte-random-hex-here>',
  'webhook_secret',
  'HMAC shared secret for webhook signatures'
);
```

The same secret value must also be set as the `WEBHOOK_SECRET` env var on the app side (in Vercel for hosted
envs, in `.env` for local dev).


## Code style & formatting

Rust workspace is formatted with `cargo fmt` and linted with `cargo clippy`. Use the aliases:

- `afmt` — `cargo fmt --all`
- `aclippy` — `cargo clippy --workspace --all-targets -- -D warnings`

Run both before committing. CI rejects any non-conforming code on `master`.

## Testing

Rust unit + integration tests live next to the code they test. Run the full suite via `atest` (`cargo test --workspace`).

Integration tests that hit real services (opensecret, supabase, public mints) are gated behind cargo features:

- `agicash-cli` — `real-opensecret-tests`, `real-supabase-tests`, `real-mint-tests`
- `agicash-storage-supabase` — similar feature flags

iOS/Android tests run via Xcode (`xcodebuild test ...`) and Gradle (`./gradlew test`) respectively; the FFI bindings under `bindings/swift/` and `bindings/kotlin/` are regenerated via the scripts there.

## CI

GitHub Actions runs the rust workspace checks on every push. See `.github/workflows/`. The pipeline runs `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, and `cargo test --workspace` in parallel. Failures block merge to `master`.

## Archive: pre-rust React app

Everything that lived under `app/`, `e2e/`, `public/`, plus the React/Vercel/devenv configs, is preserved at:

- Tag: `react-web-app-final`
- Branch: `archive/react-web-app`

To browse it on demand:
```sh
git worktree add /tmp/react-ref archive/react-web-app
cd /tmp/react-ref
# read app/, e2e/, devenv.nix, package.json, ...
```