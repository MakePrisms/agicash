---
title: "feat: Worktree & Database Branching CLI Tools"
type: feat
status: active
date: 2026-03-02
brainstorm: docs/brainstorms/2026-03-02-worktree-db-branching-brainstorm.md
---

# Worktree & Database Branching CLI Tools

## Overview

Build two CLI tools (`wt` and `db`) that make working with multiple git worktrees seamless by providing worktree lifecycle management, local database branching via Supabase's database rename trick, and branch-aware type generation.

**Problem:** Developing features that require schema changes (migrations) on separate git branches is painful. Running `supabase db reset` destroys data. Manually switching schemas is error-prone. There's no isolation between branches that touch the database.

**Solution:** A single Supabase stack with database-level isolation via `ALTER DATABASE RENAME`. One DB branch is "active" at a time (named `postgres`), others are parked as `wt_<name>`. Combined with worktree lifecycle automation for port assignment, dependency installation, and env configuration.

## Technical Approach

### Architecture

```
tools/
├── shared/
│   ├── config.ts          # State file read/write (.worktree-state.json)
│   ├── postgres.ts        # pg_dump, psql, ALTER DATABASE, pg_terminate_backend
│   ├── supabase.ts        # Supabase CLI wrappers (status, stop, start)
│   ├── ports.ts           # Port allocation and validation
│   ├── lock.ts            # Lockfile acquisition with PID + staleness detection
│   ├── worktree.ts        # Git worktree operations + context detection
│   └── log.ts             # Output formatting (colors, spinners, tables)
├── wt.ts                  # Worktree CLI entry point (commander)
└── db.ts                  # Database branching CLI entry point (commander)
```

**Worktree location:** `.trees/` at project root (already in use for manual worktrees, gitignored via `.git/info/exclude` — move to `.gitignore`). `.claude/worktrees/` is a separate system managed by Claude Code and is not touched by `wt`.

**State registry** (`.worktree-state.json` at project root, git-ignored):

```json
{
  "version": 1,
  "activeDbBranch": "master",
  "dbBranches": {
    "master": { "parent": null, "created": "2026-03-02" },
    "experiment-a": { "parent": "master", "created": "2026-03-02" }
  },
  "worktrees": {
    "/Users/claude/agicash": {
      "dbBranch": "master",
      "devPort": 3000
    },
    "/Users/claude/agicash/.trees/migration-work": {
      "dbBranch": "experiment-a",
      "devPort": 3001
    }
  }
}
```

### Critical Design: Safe Database Switching

The `db switch` command is the most dangerous operation. `ALTER DATABASE RENAME` fails if there are active connections, and a partial rename leaves the system in a broken state.

**Safe rename sequence:**

```
1. Acquire lockfile
2. Stop Supabase services (supabase stop --no-backup)
   ↳ Services must be stopped because they cache the database connection.
     After rename, they need to reconnect to the new `postgres`.
3. Terminate any remaining connections to `postgres` AND `wt_<target>`
   ↳ ALTER DATABASE RENAME fails if any connections exist.
     Supabase stop handles most, but stray connections (dev servers, psql sessions) may linger.
4. RENAME postgres → wt_<temp_sentinel>          -- Step A
5. RENAME wt_<target> → postgres                  -- Step B
6. RENAME wt_<temp_sentinel> → wt_<old_active>   -- Step C
7. Start Supabase services (supabase start)
8. Update state file
9. Release lockfile
```

**Rollback on failure:**
- If Step A fails: nothing changed, abort cleanly
- If Step B fails: rename `wt_<temp_sentinel>` back to `postgres`, abort
- If Step C fails: `postgres` is correct (target is active), but old branch is named `wt_<temp_sentinel>`. Fix by renaming to `wt_<old_active>`. Log a warning.

The sentinel name (`wt___switching__`) is never a valid branch name, so it's always safe to detect and recover from.

**Connection termination before rename:**

```sql
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = $1 AND pid <> pg_backend_pid();
```

Run against both databases before stopping Supabase. This ensures no lingering connections block the rename.

### Forking Non-Active Branches

`db fork new-branch --from staging` when `staging` is not active connects directly to `wt_staging` via the Postgres container — no switching needed:

```bash
docker exec -i supabase_db_agicash createdb -U postgres "wt_new_branch"
docker exec -i supabase_db_agicash pg_dump -U postgres "wt_staging" | \
  docker exec -i supabase_db_agicash psql -U postgres "wt_new_branch"
```

For the active branch, replace `wt_staging` with `postgres`.

### Worktree Context Detection

Commands like `db link`, `db status` need two things: which worktree they're in, and where the shared state file lives.

**Current worktree root** (for matching against registered worktrees):
```typescript
function getCurrentWorktreeRoot(): string {
  return execSync('git rev-parse --show-toplevel').toString().trim();
}
```

**Main project root** (where `.worktree-state.json` lives):
```typescript
function getProjectRoot(): string {
  // --git-common-dir returns the shared .git dir (e.g., /Users/claude/agicash/.git)
  // regardless of which worktree we're in
  const gitCommon = execSync('git rev-parse --git-common-dir').toString().trim();
  return path.resolve(gitCommon, '..');
}
```

All worktrees share a single `.worktree-state.json` at the main project root. A tool running in `.trees/feature-x` resolves the state file at `/Users/claude/agicash/.worktree-state.json`, not in the worktree itself.

If `getCurrentWorktreeRoot()` doesn't match any registered path, prompt to run `wt init`.

### Lockfile Design

`.worktree-state.lock` contains:

```json
{ "pid": 12345, "command": "db switch staging", "acquired": "2026-03-02T10:00:00Z" }
```

**Acquisition logic:**
1. Try to create lockfile exclusively (O_EXCL)
2. If exists, read PID. Check if process is alive (`kill(pid, 0)`)
3. If dead: remove stale lock, retry
4. If alive: wait up to 30 seconds with polling, then fail with message
5. `--force` flag overrides and removes the lock regardless

All state-mutating commands (`wt setup`, `wt teardown`, `wt init`, `db fork`, `db switch`, `db delete`, `db link`) acquire the lock. Read-only commands (`wt list`, `db list`, `db status`) do not.

### Port Allocation

- Port 3000: hardcoded for main worktree (path matches project root)
- Ports 3001+: assigned from a pool
- On `wt setup`: find lowest unused port by scanning state file entries
- On `wt teardown`: port returned to pool (implicit — next setup finds it available)
- If an external process holds the assigned port, the dev server will fail with EADDRINUSE — the developer increments manually or re-runs `wt init` to reassign

### Dev Server Port Configuration

`app/server.ts` currently hardcodes port 3000. Modify to read from `PORT` env var:

```typescript
const PORT = parseInt(process.env.PORT || '3000', 10);
```

Each worktree's `.env.local` sets `PORT=<assigned_port>`.

### Branch-Aware Type Generation

Modify the pre-commit hook to check the worktree's linked branch vs active branch:

```bash
#!/usr/bin/env bash
# Read worktree root
WT_ROOT=$(git rev-parse --show-toplevel)
# Read state file from project root (may differ from worktree root)
STATE_FILE="$DEVENV_ROOT/.worktree-state.json"

if [ -f "$STATE_FILE" ]; then
  ACTIVE=$(jq -r '.activeDbBranch' "$STATE_FILE")
  LINKED=$(jq -r ".worktrees[\"$WT_ROOT\"].dbBranch // \"master\"" "$STATE_FILE")

  if [ "$ACTIVE" = "$LINKED" ]; then
    # Normal path — active branch matches
    supabase gen types typescript --local --schema wallet > supabase/database.types.ts
  else
    # Branch-aware path — read from non-active database directly
    DB_NAME="wt_${LINKED//-/_}"
    supabase gen types typescript \
      --db-url "postgresql://postgres:postgres@127.0.0.1:54322/$DB_NAME" \
      --schema wallet > supabase/database.types.ts
  fi
else
  # No state file — default behavior
  supabase gen types typescript --local --schema wallet > supabase/database.types.ts
fi
```

This replaces the current `bun run db:generate-types` hook entry with a script that handles branching.

## Implementation Phases

### Phase 1: Foundation — Shared Infrastructure

**Goal:** Build the shared modules that both CLIs depend on.

**Files to create:**

| File | Purpose |
|------|---------|
| `tools/shared/config.ts` | State file CRUD with schema version, auto-init, atomic writes (write to `.tmp`, rename) |
| `tools/shared/lock.ts` | Lockfile acquire/release with PID tracking and staleness detection |
| `tools/shared/postgres.ts` | `docker exec` wrappers for `pg_dump`, `createdb`, `psql`, `dropdb`, `ALTER DATABASE RENAME`, `pg_terminate_backend` |
| `tools/shared/supabase.ts` | `supabase status`, `supabase stop --no-backup`, `supabase start` wrappers with running-state checks |
| `tools/shared/ports.ts` | Port allocation, validation (actual availability check), and recycling |
| `tools/shared/worktree.ts` | `getCurrentWorktreeRoot()`, `git worktree add/remove/list` wrappers |
| `tools/shared/log.ts` | Colored output, tables, spinners, confirmation prompts |

**Files to modify:**

| File | Change |
|------|--------|
| `package.json` | Add `commander` devDependency |
| `.gitignore` | Add `.worktree-state.json`, `.worktree-state.lock`, `.trees/` (move from `.git/info/exclude`) |

**Key design decisions:**
- All shell commands via `Bun.spawn()` (not `child_process`) for bun runtime consistency
- State file writes are atomic: write to `.worktree-state.json.tmp`, then `rename()`
- Config auto-initializes on first read if file doesn't exist (registers main worktree with port 3000, master as only DB branch)
- All postgres commands run via `docker exec -i supabase_db_agicash` (container name derived from `supabase/config.toml` project_id)

**Success criteria:**
- [ ] State file can be created, read, updated atomically
- [ ] Lockfile prevents concurrent mutations, detects stale locks
- [ ] Postgres wrappers execute against local Supabase DB
- [ ] Port allocation finds available ports and validates them

### Phase 2: Database Branching CLI (`db`)

**Goal:** Implement the `db` CLI with all subcommands.

**Files to create:**

| File | Purpose |
|------|---------|
| `tools/db.ts` | Commander program with subcommands: fork, switch, list, delete, link, status |

**Subcommand details:**

**`db fork <name> [--from <branch>]`:**
1. Acquire lock
2. Validate name (lowercase alphanumeric, hyphens, underscores; reject reserved names like `postgres`, `template0`, `template1`)
3. Resolve source: `--from <branch>` or active branch. Map to database name (`postgres` if active, `wt_<name>` otherwise)
4. `createdb wt_<sanitized_name>` (replace `-` with `_` in DB name)
5. `pg_dump <source> | psql wt_<sanitized_name>`
6. Register in state: `dbBranches[name] = { parent, created }`
7. Auto-link current worktree: `worktrees[cwd].dbBranch = name`
8. Release lock
9. Print summary

**On failure:** If `createdb` succeeded but `pg_dump | psql` fails, drop the partially created database and remove from state.

**`db switch <name>`:**
1. Acquire lock
2. Validate: branch exists, is not already active
3. Terminate connections to `postgres` and `wt_<name>`
4. `supabase stop --no-backup`
5. Three-step rename with sentinel (see Critical Design section above)
6. `supabase start`
7. Update `activeDbBranch` in state
8. Release lock
9. Print summary with restart time

**`db delete <name>`:**
1. Acquire lock
2. Validate: not `master`, no worktrees linked to this branch
3. If active: switch to master first (reuses switch logic)
4. `dropdb wt_<sanitized_name>` (or `DROP DATABASE` if active was just switched away)
5. Remove from state
6. Release lock
7. Print summary

**`db link <branch>`:**
1. Acquire lock
2. Validate: branch exists in state
3. Update `worktrees[cwd].dbBranch = branch`
4. Release lock
5. Print confirmation with warning if linked branch != active branch

**`db list`:**
- Read state (no lock needed)
- Table: Name | Active | Parent | Linked Worktrees | Created

**`db status`:**
- Read state (no lock needed)
- Show: active branch, this worktree's linked branch
- If different: warn and suggest `db switch`
- Show migration diff: compare `supabase/migrations/` filenames against `schema_migrations` table in linked DB

**Confirmation prompts:**
- `db delete`: "Delete database branch '<name>'? This cannot be undone. [y/N]"
- `db switch`: if running dev servers detected, "Switching will break N running dev server(s). Continue? [y/N]"
- All destructive commands accept `--yes` to skip confirmation

**Success criteria:**
- [ ] `db fork` creates an isolated database copy
- [ ] `db switch` safely renames databases with rollback on failure
- [ ] `db delete` refuses if worktrees are linked
- [ ] `db link` updates worktree→branch mapping
- [ ] `db list` shows accurate table of branches
- [ ] `db status` shows active vs linked with migration diff
- [ ] All mutating commands acquire and release the lockfile

### Phase 3: Worktree Lifecycle CLI (`wt`)

**Goal:** Implement the `wt` CLI with all subcommands.

**Files to create:**

| File | Purpose |
|------|---------|
| `tools/wt.ts` | Commander program with subcommands: setup, init, teardown, list |

**Subcommand details:**

**`wt setup <name> [--base <branch>]`:**
1. Acquire lock
2. Validate name, check `.trees/<name>` doesn't exist
3. `git worktree add .trees/<name>` (from `--base` branch or current HEAD)
4. Allocate port (find lowest available >= 3001)
5. Run `bun install` in `.trees/<name>`
6. Generate `.trees/<name>/.env.local`:
   ```
   PORT=<assigned_port>
   ```
7. Register in state: `worktrees[path] = { dbBranch: "master", devPort }`
8. Release lock
9. Print summary: path, port, linked DB branch, `cd .trees/<name>` hint

**On failure:** Clean up in reverse order — deregister from state, free port, `git worktree remove` if created.

**`wt init`:**
1. Acquire lock
2. Detect current worktree root (`git rev-parse --show-toplevel`)
3. If already registered: update (re-run bun install, regenerate .env.local)
4. If not registered: allocate port, generate .env.local, register
5. Release lock
6. Print summary

**`wt teardown <name> [--force]`:**
1. Acquire lock
2. Resolve path: `.trees/<name>`
3. Check for uncommitted changes (`git -C <path> status --porcelain`)
   - If dirty and no `--force`: refuse with list of changes
4. Unlink DB branch from state
5. Free port
6. `git worktree remove .trees/<name>` (add `--force` if `--force` was passed)
7. Deregister from state
8. Release lock
9. Print summary. If DB branch has no remaining links, hint: "DB branch '<branch>' has no linked worktrees. Run `db delete <branch>` to clean up."

**`wt list`:**
- Read state (no lock needed)
- Cross-reference with `git worktree list` for validity
- Table: Name | Path | Port | DB Branch | Git Branch | Status

**Success criteria:**
- [ ] `wt setup` creates a ready-to-dev worktree in one command
- [ ] `wt teardown` cleans up worktree, state, and port
- [ ] `wt init` can bootstrap an existing worktree
- [ ] `wt list` shows accurate worktree table
- [ ] Failed setups clean up after themselves

### Phase 4: Integration — Dev Server, Hooks, devenv

**Goal:** Wire the CLIs into the existing development workflow.

**Files to modify:**

| File | Change |
|------|--------|
| `app/server.ts` | Read `PORT` from env var (default 3000) |
| `devenv.nix` | Register `wt` and `db` shell commands; update `generate-db-types` hook |
| `.gitignore` | Add `.worktree-state.json`, `.worktree-state.lock`, `.trees/` |

**Dev server port (`app/server.ts`):**

```typescript
// Before:
httpsApp.listen(3000, () => { ... });
app.listen(3000, () => { ... });

// After:
const PORT = parseInt(process.env.PORT || '3000', 10);
httpsApp.listen(PORT, () => { ... });
app.listen(PORT, () => { ... });
```

**devenv.nix additions:**

```nix
scripts.wt.exec = ''bun run "$DEVENV_ROOT/tools/wt.ts" "$@"'';
scripts.db.exec = ''bun run "$DEVENV_ROOT/tools/db.ts" "$@"'';
```

**Pre-commit hook update (`devenv.nix`):**

Replace the current `generate-db-types` hook entry:

```nix
git-hooks.hooks.generate-db-types = {
  enable = true;
  name = "Generate database types (branch-aware)";
  entry = "${pkgs.bash}/bin/bash tools/hooks/generate-db-types.sh";
  pass_filenames = false;
};
```

**New file: `tools/hooks/generate-db-types.sh`:**

A shell script that checks the worktree's linked DB branch vs active branch and uses `--db-url` when they differ (see "Branch-Aware Type Generation" section above).

**Dev server startup warning:**

Add a check at the top of `app/server.ts` (or in a separate module it imports):

```typescript
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

function checkDbBranchAlignment() {
  const stateFile = path.resolve(__dirname, '../.worktree-state.json');
  if (!existsSync(stateFile)) return;

  const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
  const wtRoot = execSync('git rev-parse --show-toplevel').toString().trim();
  const linked = state.worktrees?.[wtRoot]?.dbBranch ?? 'master';
  const active = state.activeDbBranch;

  if (linked !== active) {
    console.warn(`\n⚠️  DB branch mismatch: this worktree is linked to "${linked}" but "${active}" is active.`);
    console.warn(`   Run: db switch ${linked}\n`);
  }
}
```

One-time check at startup, non-blocking.

**Success criteria:**
- [ ] Dev server respects `PORT` env var
- [ ] `wt` and `db` available as devenv shell commands
- [ ] Pre-commit hook generates types from correct DB branch
- [ ] Dev server warns on branch mismatch at startup
- [ ] `.worktree-state.json`, `.worktree-state.lock`, and `.trees/` are gitignored

### Phase 5: Doctor Command

**Goal:** Add a reconciliation tool for when state and reality drift apart.

**New subcommand: `db doctor` (covers both worktree and DB state):**
- Compare state file against `git worktree list` output
- Compare state file against actual databases (`docker exec supabase_db_agicash psql -U postgres -l`)
- Report discrepancies: orphaned state entries, unregistered worktrees, missing databases
- Offer to fix: remove stale entries, register discovered worktrees/databases

This is lower priority than Phases 1-4 but important for long-lived environments where manual operations cause drift.

**Success criteria:**
- [ ] `db doctor` detects and reports state/reality drift
- [ ] Offers actionable fixes for each discrepancy

## Alternative Approaches Considered

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| Multiple full Supabase stacks | True simultaneous isolation | ~13 containers each, resource heavy | Deferred to Tier 2 (v2) |
| `supabase db reset` on switch | Simple, no custom tooling | Destroys data, slow (re-applies all migrations) | Rejected |
| Postgres schemas for isolation | Lightweight, no rename | Auth/Realtime hardcode schemas, breaks auth | Rejected |
| Single CLI (`wt-db`) | One tool to learn | Conflates concerns, harder to use independently | Rejected — separate is cleaner |
| Bun workspace for tools/ | Proper package isolation | Overkill for internal scripts | Rejected — simple TS with relative imports |
| deno for tools/ (no bundler needed) | Built-in TS, no deps | Mixed runtime in project, different ecosystem | Rejected — stay with bun |

## Acceptance Criteria

### Functional Requirements

- [ ] `wt setup <name>` creates a worktree with dependencies installed, env configured, and port assigned
- [ ] `wt teardown <name>` cleans up worktree, state, and port; refuses if dirty (unless `--force`)
- [ ] `wt init` bootstraps an existing worktree into the system
- [ ] `wt list` shows all worktrees with DB branch, port, and git branch
- [ ] `db fork <name>` creates an isolated database copy and auto-links the worktree
- [ ] `db fork <name> --from <branch>` works for both active and non-active source branches
- [ ] `db switch <name>` safely renames databases with rollback on failure
- [ ] `db delete <name>` refuses if worktrees are linked or if name is `master`
- [ ] `db link <branch>` updates the worktree→branch mapping
- [ ] `db list` shows all DB branches with active marker and linked worktrees
- [ ] `db status` shows active vs linked branch and migration diff
- [ ] Dev server reads port from `PORT` env var
- [ ] Pre-commit hook generates types from the correct DB branch
- [ ] Dev server warns on startup if DB branch doesn't match

### Non-Functional Requirements

- [ ] `db switch` completes in <10s (stop + rename + start)
- [ ] `db fork` of a typical local database completes in <30s
- [ ] All commands fail gracefully with actionable error messages
- [ ] No data loss possible from normal CLI usage (rollback on partial failures)
- [ ] State file writes are atomic (no corruption from crashes)

### Quality Gates

- [ ] All shared modules have unit tests (config, lock, ports, postgres wrappers)
- [ ] `db switch` rollback logic is tested (mock partial rename failures)
- [ ] Commands work from main repo and from worktrees
- [ ] `bun run fix:all` passes with tools/ included

## Dependencies & Prerequisites

| Dependency | Status | Action |
|------------|--------|--------|
| `commander` npm package | Not installed | `bun add -d commander` |
| Local Supabase running | Required for db commands | `supabase start` |
| PostgreSQL CLI tools | Inside Supabase container | Access via `docker exec -i supabase_db_agicash` |
| `jq` | In devenv packages | Already available |
| Docker | Required (runs Supabase) | Already present |

**PostgreSQL CLI access strategy:** Use `docker exec -i supabase_db_agicash` to run `pg_dump`, `psql`, `createdb`, `dropdb` inside the Supabase Postgres container. This guarantees version-matched tools (Postgres 17), requires no host-side installation, and works whenever Supabase is running. The container name `supabase_db_agicash` is derived from `supabase/config.toml` project_id — the tools should read this from config rather than hardcoding it.

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `db switch` rename fails mid-sequence | Low | Critical | Three-step rename with sentinel + rollback at each step |
| State file corruption from crash | Low | Medium | Atomic writes (tmp + rename) |
| Port conflict with external process | Medium | Low | Validate actual availability, auto-increment to next |
| Stale lockfile blocks operations | Medium | Low | PID tracking + staleness detection + `--force` |
| `pg_dump` captures inconsistent state | Low | Medium | Stop Supabase before fork (optional safety mode) |
| Deprecated Supabase branching artifacts conflict | Low | Low | Ignore `supabase/.branches/` — different system |
| tools/ TypeScript included in main tsc | Certain | Low | Acceptable — tools use standard TS, no path aliases |

## Future Considerations

- **Tier 2 (Promoted stacks):** Full Supabase stack per worktree for simultaneous DB access. Port offset scheme (+100 per stack). `--exclude` flags for unnecessary containers. Triggered via `wt promote <name>`.
- **`db merge` / `db diff`:** Schema comparison between branches. Could use `pg_dump --schema-only` diff or Supabase's migration diffing.
- **Auto-switch on dev start:** Currently warn-only. Could add `--auto-switch` flag to dev server that runs `db switch` before starting.
- **`db reset <name>`:** Re-fork from parent branch in one command (currently requires delete + fork).
- **`wt cd <name>`:** Shell function to `cd .trees/<name>` (requires shell integration, can't be a simple script).

## Documentation Plan

- [ ] Add `## Worktree & DB Branching` section to `CLAUDE.md` with quick reference
- [ ] Add `wt` and `db` to the Commands table in `CLAUDE.md`
- [ ] Create `docs/solutions/worktree-db-branching.md` for institutional knowledge after implementation

## References & Research

### Internal References

- Brainstorm: `docs/brainstorms/2026-03-02-worktree-db-branching-brainstorm.md`
- Dev server: `app/server.ts` (port hardcoded at listen calls)
- Pre-commit hooks: `devenv.nix:git-hooks.hooks` section
- Type generation: `package.json` script `db:generate-types`
- Supabase config: `supabase/config.toml` (ports, project ID)
- Existing tools: `tools/devenv/` (shell scripts for IDE/SSL)
- tsconfig: `tsconfig.json` (includes `**/*.ts`, excludes `.claude/worktrees`)
- Deprecated branching: `supabase/.branches/_current_branch`

### External References

- PostgreSQL ALTER DATABASE RENAME: requires no active connections, not transactional per se but individual DDL statements are atomic
- Supabase local dev architecture: services hardcoded to `postgres` database name
- Commander.js: CLI framework for Node.js/Bun
