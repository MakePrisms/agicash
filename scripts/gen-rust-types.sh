#!/usr/bin/env bash
# Regenerates the typesafe-supabase Rust bindings from supabase/migrations.
#
# Mirrors the TypeScript one-liner `bun db:generate-types`. The Rust path
# starts its own ephemeral Postgres container, applies every migration,
# introspects, and writes `crates/agicash-storage-supabase/src/generated.rs`.
#
# Usage:
#   bun db:generate-types-rust       # preferred — matches the TS workflow
#   bash scripts/gen-rust-types.sh   # raw form
#
# Conventions (see `crates/agicash-storage-supabase-codegen/README.md`):
#   - Nullable RPC arg => add `DEFAULT NULL` to the migration; codegen emits
#     `Option<T>`.
#   - Trigger-set NOT NULL column => add `COMMENT ON COLUMN <table>.<col>
#     IS '@codegen optional'`; codegen emits `Option<T>` in `New<Table>`.

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

export PATH="$HOME/.cargo/bin:$PATH"

cargo run --quiet \
  --manifest-path crates/Cargo.toml \
  -p agicash-storage-supabase-codegen \
  -- \
  --migrations-dir supabase/migrations \
  --schema wallet \
  --out crates/agicash-storage-supabase/src/generated.rs \
  "$@"
