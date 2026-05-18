# Supabase

App data lives in a Supabase Postgres database. Auth data (user id, email,
seed) is in OpenSecret, not Supabase. Sensitive columns are encrypted on the
client with a key derived from the OpenSecret session and decrypted on read by
the same client — the database operator cannot decrypt them.

## Local stack

```sh
bunx supabase start    # postgres, auth, storage, realtime, studio
bunx supabase stop
```

Config lives in `supabase/config.toml`. The CLI prints the Studio URL on
startup; the API listens on `https://127.0.0.1:54321` and uses the
mkcert-issued cert at `certs/localhost-cert.pem` (path resolved via the
`SELF_SIGNED_CERT_PATH` env var).

## Schema

App tables live under the `wallet` schema, not `public`. Users are in
`wallet.users`, not `auth.users`. Always query `wallet.*` when working with
app data.

## Migrations

SQL migrations live under `supabase/migrations/`.

```sh
bunx supabase migration new <name>            # author a migration
bunx supabase db push                          # apply locally
bunx supabase db reset                         # rerun every migration + seed.sql
```

Migration files: `YYYYMMDDHHmmss_short_description.sql`. SQL is lowercase.

Always enable RLS on new tables. Write separate policies per operation
(`select` / `insert` / `update` / `delete`) and per role (`anon` /
`authenticated`).

After changing a migration that touches the `wallet` schema, regenerate the
rust storage bindings (`crates/agicash-storage-supabase/src/generated.rs`):

```sh
acodegen --migrations-dir supabase/migrations --schema wallet \
         --out crates/agicash-storage-supabase/src/generated.rs
# or, equivalently:
bash scripts/gen-rust-types.sh
```

Hosted-env migrations are applied through the Supabase platform branching
workflow — see the Supabase dashboard.

## Event system

Any table can emit events by attaching a trigger that calls
`wallet.emit_event('event.type')`. The trigger signs the payload with
HMAC-SHA256 and posts it to the app's `/api/events` route; the route verifies
the signature and dispatches to handlers (e.g. sending a welcome email via
Resend).

The trigger function reads two values at runtime:

- `wallet.app_config.webhook_base_url` — a row in the `wallet.app_config`
  table holding the app's base URL.
- `webhook_secret` — a vault secret holding the shared HMAC secret. Must
  match the `WEBHOOK_SECRET` env var on the app side.

If either value is missing the function logs a warning and no-ops, so
triggers won't block inserts/updates — but events won't be delivered.

**Local dev:** both values are seeded automatically by `supabase/seed.sql`
when you run `bunx supabase start` or `bunx supabase db reset`. No manual
setup needed.

**Hosted envs (next, prod, preview branches):** both values must be set ONCE
per environment. Run the following in the Supabase SQL editor against the
target database, substituting the correct URL and a fresh secret:

```sql
-- 1. set the base URL for webhook delivery
insert into "wallet"."app_config" ("key", "value")
values ('webhook_base_url', 'https://agi.cash');

-- 2. create the HMAC secret
select vault.create_secret(
  '<paste-32-byte-random-hex-here>',
  'webhook_secret',
  'HMAC shared secret for webhook signatures'
);
```

The same secret must also be set as `WEBHOOK_SECRET` on the app side
(Vercel for hosted envs, `.env` for local dev).

## Safety rules

- Never run `bunx supabase db reset` against a local DB you care about — it
  destroys data.
- Never run `bunx supabase db push` or any remote DB operation without
  explicit approval; agicash uses the dashboard branching workflow for
  hosted-env migrations.
- Don't drop tables or columns without explicit approval.
