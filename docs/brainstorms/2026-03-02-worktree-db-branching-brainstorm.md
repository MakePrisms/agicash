---
date: 2026-03-02
topic: worktree-db-branching
---

# Worktree & Database Branching System

## What We're Building

Two complementary CLI tools (`wt` and `db`) that make working with multiple git worktrees seamless by providing:

1. **Worktree lifecycle management** — one command to create a worktree with dependencies installed, env configured, and a unique dev server port assigned
2. **Local database branching** — fork, switch, and delete isolated database branches so migration work on one branch can't break another
3. **Branch-aware tooling** — type generation, dev server startup checks, and pre-commit hooks that work correctly regardless of which DB branch is active

## Why This Approach

### The Hard Constraint

Supabase services (Auth, Realtime, PostgREST, Storage) are all hardwired to a single Postgres database named `postgres`. You cannot share Auth/Realtime across worktrees while only isolating the database. This means:

- Creating additional databases in Postgres doesn't help — Supabase services won't connect to them
- Postgres schemas don't work — Auth/Realtime use hardcoded schemas
- Sharing a Supabase stack while isolating just Postgres is not possible

True simultaneous isolation requires running full Supabase stacks (~13 containers each), which is resource-heavy.

### The Key Discovery

The Supabase CLI had a deprecated local branching system (`supabase db branch`) that solved this with a clever trick:

1. **Fork**: `pg_dump postgres | psql wt_<branch>` — copies the entire database (all schemas: auth, wallet, realtime)
2. **Switch**: `ALTER DATABASE postgres RENAME TO wt_<old>; ALTER DATABASE wt_<new> RENAME TO postgres;` — since services hardcode `postgres`, renaming transparently switches which branch they see
3. **Restart**: Bounce services to reconnect (~5 seconds)

This gives full isolation with a single Supabase stack. The only trade-off: one DB branch is "active" at a time.

### Approaches Considered

| Approach | Isolation | Cost | Chosen? |
|----------|-----------|------|---------|
| Multiple full Supabase stacks | Complete, simultaneous | ~13 containers per worktree | Available as "promote" escape hatch |
| Single stack + `db reset` on switch | Sequential, destructive | 1 stack | No — destroys data |
| Single stack + database rename trick | Sequential, non-destructive | 1 stack | **Yes — primary approach** |
| Postgres schemas as isolation | Partial (no auth/realtime) | 1 stack | No — breaks auth |

## Key Decisions

### DB branches are decoupled from git worktrees

DB branches are an independent concept. A worktree links to a DB branch, but:
- Multiple worktrees can share the same DB branch
- Worktrees without migration changes default to `master`
- You only fork a DB branch when you need schema isolation (explicit, not automatic)

```
Git Worktrees                    DB Branches
─────────────                    ───────────
main (master)      ──────────→   master (always exists)
feature-ui-only    ──────────→   master (no DB changes)
migration-v1       ──────────→   experiment-a (forked from master)
migration-v2       ──────────→   experiment-b (forked from experiment-a)
```

### Master participates in the rename system

When switching away from master, it gets renamed to `wt_master` like any other branch. This keeps the model uniform — every branch follows the same rules.

### Auto-restart on switch

`db switch` automatically restarts Supabase services after the rename. No manual intervention needed.

### Auto-link on fork

`db fork <name>` creates the DB branch AND links the current worktree to it. This covers the common case (fork because you need isolation for this worktree). Use `db link <branch>` separately if needed.

### Dev server: warn, don't auto-switch

When `bun run dev` starts, it checks if the active DB branch matches the worktree's linked branch. If mismatch, it warns but doesn't auto-switch — auto-switching could break another running dev server.

### Branch-aware type generation

The pre-commit hook generates types from the correct DB branch using `--db-url` to bypass the Supabase API gateway when the linked branch isn't active:

```bash
# If linked branch == active branch → use --local (normal path)
# If linked branch != active branch → use --db-url to read from correct DB
supabase gen types typescript \
  --db-url "postgresql://postgres:postgres@127.0.0.1:54322/wt_<branch>" \
  --schema wallet
```

No switching, no disruption to running dev servers.

### Two separate CLIs, not one

- `wt` — worktree lifecycle (setup, init, teardown, list)
- `db` — database branching (fork, switch, list, delete, link, status)

Shared infrastructure in `tools/shared/`. Registered as devenv shell commands.

### Simple TypeScript scripts, not a workspace

Files in `tools/` with relative imports. Commander.js as a devDependency in root `package.json`. No bun workspace complexity.

### Tiered isolation model

- **Default (Tier 1)**: Single Supabase stack, DB branches via rename trick. One active branch at a time.
- **Promoted (Tier 2)**: Full Supabase stack per worktree with `--exclude` for unnecessary containers. For when you need simultaneous DB access across worktrees. (v2 feature)

## Architecture

### File Structure

```
tools/
├── shared/
│   ├── config.ts          # Registry read/write (.worktree-state.json)
│   ├── postgres.ts        # pg_dump, psql, ALTER DATABASE wrappers
│   ├── supabase.ts        # supabase CLI wrappers (status, restart)
│   ├── ports.ts           # Port allocation (3001, 3002, ...)
│   └── log.ts             # Output formatting
├── wt.ts                  # Worktree CLI (commander)
└── db.ts                  # Database branching CLI (commander)
```

### State Registry

`.worktree-state.json` at project root (git-ignored):

```json
{
  "activeDbBranch": "master",
  "dbBranches": {
    "master": { "parent": null, "created": "2026-03-02" },
    "experiment-a": { "parent": "master", "created": "2026-03-02" },
    "experiment-b": { "parent": "experiment-a", "created": "2026-03-02" }
  },
  "worktrees": {
    "/Users/claude/agicash": {
      "dbBranch": "master",
      "devPort": 3000
    },
    "/Users/claude/agicash/.claude/worktrees/migration-work": {
      "dbBranch": "experiment-a",
      "devPort": 3001
    }
  }
}
```

### CLI Commands

**Worktree CLI (`wt`):**

| Command | Description |
|---------|-------------|
| `wt setup <name> [--base branch]` | Create git worktree + bun install + generate .env.local + assign port |
| `wt init` | Setup env in existing worktree (bun install + .env.local + register) |
| `wt teardown <name>` | Remove worktree + unlink DB branch + free port |
| `wt list` | Show all worktrees with DB branch links, ports, and status |

**Database CLI (`db`):**

| Command | Description |
|---------|-------------|
| `db fork <name> [--from branch]` | Create DB branch via pg_dump, auto-link current worktree |
| `db switch <name>` | Activate a DB branch (rename + restart services, ~5s) |
| `db list` | Show all DB branches with active marker and linked worktrees |
| `db delete <name>` | Drop a DB branch (fails if worktrees still linked) |
| `db link <branch>` | Link current worktree to an existing DB branch |
| `db status` | Show current active branch, this worktree's linked branch, migration diff |

### Database Naming Convention

| Branch | Database Name (when not active) | Database Name (when active) |
|--------|--------------------------------|----------------------------|
| master | `wt_master` | `postgres` |
| experiment-a | `wt_experiment_a` | `postgres` |

Branch names are sanitized: `/` and special chars replaced with `_`.

### Port Allocation

- Port 3000: reserved for the main worktree (always)
- Port 3001+: assigned sequentially to new worktrees
- Freed ports are reused

### Container Optimization

Services that can be excluded from the primary Supabase stack:

| Service | Status | Reason |
|---------|--------|--------|
| imgproxy | Exclude | Storage is disabled |
| vector | Exclude | Log pipeline not needed locally |
| supavisor | Already disabled | Connection pooler not needed |
| inbucket | Optional | Email testing — not used with Open Secret auth |
| analytics/logflare | Keep | Other services depend on it in container health checks |

For promoted worktree stacks (Tier 2), additionally exclude: studio, postgres-meta, edge-runtime, inbucket.

### Integration Points

**devenv.nix** — registers shell commands:
```nix
scripts.wt.exec = ''bun run "$DEVENV_ROOT/tools/wt.ts" "$@"'';
scripts.db.exec = ''bun run "$DEVENV_ROOT/tools/db.ts" "$@"'';
```

**Dev server startup** — check + warn if active DB branch doesn't match worktree's linked branch.

**Pre-commit hook** — branch-aware type generation via `--db-url` (no switching needed).

**.gitignore** — add `.worktree-state.json` and `.worktree-state.lock`.

### Safety

- **Lockfile** (`.worktree-state.lock`): `db switch` acquires before rename to prevent concurrent switches
- **Supabase check**: All commands verify Supabase is running before executing
- **Delete protection**: `db delete` fails if any worktrees are still linked to the branch
- **Master protection**: `db delete master` is always rejected

## Open Questions

- **Tier 2 (promoted full stacks)**: Deferred to v2. Design the port offset scheme and `--exclude` flags when needed.
- **`db merge`/`db diff`**: Useful for comparing schemas between branches. Deferred — escape hatch is manual `pg_dump --schema-only` diff.
- **Auto-switch on `bun run dev`**: Currently warn-only. Could revisit if the single-active-branch model proves annoying.

## Next Steps

→ `/workflows:plan` for implementation details (file-by-file changes, build sequence, testing strategy)
