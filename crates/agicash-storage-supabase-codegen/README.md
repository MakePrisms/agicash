# agicash-storage-supabase-codegen

Generates `crates/agicash-storage-supabase/src/generated.rs` from
`supabase/migrations/*.sql`. Mirrors the TypeScript `bun db:generate-types`
ergonomic for Rust.

## The one-liner

```bash
bun db:generate-types-rust
# (or, equivalently: bash scripts/gen-rust-types.sh)
# (or, raw: cargo run -p agicash-storage-supabase-codegen)
```

This:

1. Starts an ephemeral Postgres 17 Docker container on a random port.
2. Applies every `supabase/migrations/*.sql` in lexical order.
3. Introspects the `wallet` schema and emits `generated.rs`.
4. Tears the container down.

Target wall time: ~5 s (warm cache; first pull adds image download).

The default image is `public.ecr.aws/supabase/postgres:17.6.1.080` rather than
vanilla `postgres:17`. We need the Supabase-flavored image because our
migrations declare `create extension pg_cron / pg_net / supabase_vault` —
those aren't in the vanilla image. Override with `--image postgres:17` if you
ever want to run against a stricter base (and either preprocess the
migrations or remove the extension dependencies first).

## What the codegen produces

Inside `agicash_storage_supabase::generated`:

- `tables::<table>::NAME` — postgrest table identifier as `&'static str`.
- `tables::<table>::columns::<COL>` — column-name constants for use with
  `postgrest::Builder::eq` etc.
- `tables::<table>::Marker` — zero-sized marker implementing `Table`; lets
  `TypedBuilder<Marker>` reject unknown columns at compile time.
- `tables::<table>::<Table>Row` — deserialization shape for `SELECT *`.
- `tables::<table>::New<Table>` — serialization shape for INSERT;
  defaulted/nullable/`@codegen optional` columns are `Option<T>`.
- `rpcs::<fn>::{NAME, Args, Returns}` — typed input/output for each
  Postgres function in the schema.
- `enums::*` — one Rust enum per Postgres enum, with `#[serde(rename)]`
  matching the SQL label exactly.
- `composites::*` — standalone composite types (used as RPC arg shapes).
- `TypedBuilder<T: Table>` — wrapper over `postgrest::Builder` that
  debug-asserts column names belong to `T::columns`.

Per operator decision, generated code uses **bare `uuid::Uuid`**, not the
agicash-domain newtypes (`UserId`, `AccountId`, etc.). The conversion to
domain newtypes happens in `agicash-storage-supabase` adapter code (e.g.
`upsert_args_from_input` in `user_storage.rs`).

## Two conventions you need to know

The codegen leans on two schema conventions that are not visible to vanilla
Postgres introspection. Both are documented here so future migrations don't
break the generated bindings silently.

### 1. Nullable RPC args → `DEFAULT NULL`

`pg_get_function_arguments()` exposes parameter type and DEFAULT clause but
**not whether NULL is a legal value**. A `text` argument is wire-nullable in
Postgres regardless. To opt a parameter into `Option<T>` in the generated
`Args` struct, **add `DEFAULT NULL`** (or `DEFAULT <something>`) in the
migration that defines the function.

```sql
-- p_email is nullable: callers may pass NULL.
create or replace function wallet.upsert_user_with_accounts(
  p_user_id uuid,
  p_email text default null,             -- ← Option<String> in Rust
  p_email_verified boolean default false, -- ← Option<bool>
  ...
)
```

Without `DEFAULT NULL`, the codegen emits the argument as `String`/`bool`/etc.
That's correct for `p_user_id` (required) but wrong for anything the caller
sometimes omits or passes as `null`.

### 2. Trigger-set columns → `COMMENT ON COLUMN ... IS '@codegen optional'`

Postgres marks a column as `NOT NULL` with no `DEFAULT` even when a
`BEFORE INSERT` trigger always fills it in. The classic example is
`wallet.users.username`, populated by `set_default_username` from the
auto-generated `id`. Pure introspection would mark the column as required,
forcing every Rust caller to supply a username they don't actually have.

To tell the codegen "the trigger handles this, callers don't supply it":

```sql
comment on column wallet.users.username is
  'Auto-populated by the set_default_username trigger on INSERT; callers never supply it. @codegen optional';
```

The codegen scans `pg_description` for `@codegen optional` and emits
`Option<T>` in `New<Table>` for matching columns. The `Row` struct (read
shape) is unaffected — those columns are always present on read.

## Drift gate

The `Schema drift (Rust)` job in `.github/workflows/rust.yml` runs the codegen
on every PR and asserts `git diff --exit-status` returns 0 for
`crates/agicash-storage-supabase/src/generated.rs`. If a developer edits
`supabase/migrations/` without regenerating, CI fails with a clear message:

> Schema drift detected. Regenerate via `bun db:generate-types-rust`
> (or `cargo run -p agicash-storage-supabase-codegen`).

The second drift line of defense is at compile time: the canary call sites in
`crates/agicash-storage-supabase/src/user_storage.rs` (`new_users_literal_for_drift`,
`upsert_args_literal_for_drift`) construct generated structs literally. A new
required column or RPC arg breaks `cargo build --all-targets` at the literal,
pointing at the exact call site that needs updating.

## CLI reference

```text
agicash-storage-supabase-codegen

Codegen: typed-Supabase bindings for agicash.

Options:
  --migrations-dir <DIR>   Path to supabase migration files (default: supabase/migrations)
  --schema <NAME>          Postgres schema to introspect (default: wallet)
  --out <PATH>             Output path (default: crates/agicash-storage-supabase/src/generated.rs)
  --database-url <URL>     Skip the ephemeral container and use this URL instead
                           (CI uses this with the GHA services.postgres block)
  --keep-db                Keep the ephemeral container running after codegen (debug only)
  --image <REF>            Docker image (default: public.ecr.aws/supabase/postgres:17.6.1.080)
  -h, --help               Print help
  -V, --version            Print version
```

## Gotchas worth knowing

These are documented in the spike report
(`docs/superpowers/specs/2026-05-16-typesafe-supabase-spike.md`); summarized
here so the next person to touch the codegen has them under their nose.

- **Composite return types** of the form `wallet.<thing>_result` (e.g.
  `upsert_user_with_accounts_result`) are still emitted as
  `serde_json::Value`. The hand-written `UpsertUserResult` in `agicash-traits`
  remains the source of truth for the wire-format shape. Replacing this with
  a concrete struct is a follow-up — non-blocking for the migrated
  `user_storage.rs` path.
- **`TABLE(col text, ...)` return types** (e.g. `find_contact_candidates`) are
  also `serde_json::Value` — same trade-off, same follow-up.
- **`jsonb` columns** become `serde_json::Value` always. If a column has a
  canonical shape, the storage-layer adapter is the right place to parse it.
- **`numeric(p,s)`** maps to `String` to avoid pulling `rust_decimal` into the
  generated module. Callers that need a real Decimal parse on the boundary.
- **The Supabase managed runtime** (`auth.uid()`, `realtime.send()`,
  `realtime.topic()`, `realtime.messages`, `cron.schedule()`) is stubbed out
  at codegen time so the migrations apply cleanly against vanilla-ish
  Postgres. The stubs are no-ops; runtime behavior is whatever the production
  managed runtime provides.

## Lane plan for migrating remaining storage modules

`user_storage.rs` is the proof-of-concept. The same pattern applies to the
other modules in `crates/agicash-storage-supabase/src/`:

| Module                         | Tables touched                          | Effort   |
|--------------------------------|------------------------------------------|----------|
| `cashu_send_swap_storage.rs`   | `cashu_send_swaps`                       | ~2 hours |
| `cashu_receive_swap_storage.rs`| `cashu_receive_swaps`, `cashu_proofs`    | ~3 hours |
| `cashu_mint_quote_storage.rs`  | `cashu_receive_quotes`                   | ~2 hours |
| `cashu_melt_quote_storage.rs`  | `cashu_send_quotes`                      | ~2 hours |

Each migration is independent. Recipe per module:

1. Swap raw table-name strings for `tables::<table>::NAME`.
2. Swap raw column strings for `tables::<table>::columns::<COL>`.
3. Add a `tests::<table>_drift_sentinel()` that constructs `New<Table>` or
   `<Table>Row` literally.
4. Keep response deserialization on the domain type until the generated
   `Row` types feel worth adopting end-to-end.

Don't try to swap the trait inputs in one go — adapter functions
(`*_args_from_*`) are the cheap insurance against trait-signature churn.
