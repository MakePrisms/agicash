#!/usr/bin/env bash
# Branch-aware database type generation for worktree/db branching.
# If the active DB branch matches this worktree's linked branch, uses --local.
# Otherwise, connects directly to the worktree's database via --db-url.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
STATE_FILE="$ROOT/.worktree-state.json"

if [ ! -f "$STATE_FILE" ]; then
  # No worktree state — fall back to default behavior
  exec bun run db:generate-types
fi

ACTIVE_BRANCH="$(jq -r '.activeDbBranch' "$STATE_FILE")"
LINKED_BRANCH="$(jq -r --arg path "$ROOT" '.worktrees[$path].dbBranch // empty' "$STATE_FILE")"

if [ -z "$LINKED_BRANCH" ]; then
  # This worktree isn't registered — fall back to default
  exec bun run db:generate-types
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

if [ "$ACTIVE_BRANCH" = "$LINKED_BRANCH" ]; then
  # Branches match — the active "postgres" database is what we want
  bunx supabase gen types typescript --local --schema wallet > "$TMP"
else
  # Branches differ — connect directly to the worktree's database
  DB_NAME="wt_${LINKED_BRANCH}"
  DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/${DB_NAME}"
  bunx supabase gen types typescript --db-url "$DB_URL" --schema wallet > "$TMP"
fi

mv "$TMP" app/lib/database.types.ts
