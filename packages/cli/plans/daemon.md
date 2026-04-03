# CLI Daemon Plan

**Date:** 2026-04-03
**Status:** Approved (with review notes addressed)
**Branch:** `plans/cli-daemon`
**Brainstorm:** `docs/brainstorms/cli-daemon-mcp.md`

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Package structure | Keep in `packages/cli` | Daemon IS the CLI, just long-lived. No new package boundary. |
| Daemon lifecycle | Explicit — user starts manually or via systemd | Simplest, most predictable. `--remote` fails if daemon not running. |
| Auth on restart | Use persisted session, error if not authed | CLI already persists auth in SQLite. Daemon calls same init path. Never auto-login. |
| IPC protocol | JSONL over Unix socket, JSON-RPC 2.0 style | Natural for TypeScript/Bun. Shared types, no serialization boundary. |
| MCP server | TBD — subcommand vs separate binary | Defer decision to Phase 3. |

## Architecture

```
agicash daemon          — long-lived, owns SDK context + task processors + realtime + cache
agicash <cmd> --remote  — thin client, connects to daemon via Unix socket
agicash-mcp             — thin MCP bridge, connects to daemon, exposes tools to Claude
```

The daemon holds a warm `WalletClient` (8 repos, 7 services, 11 caches, 6 task processors, Supabase Realtime, leader election). Every `--remote` call skips the full init tax and gets instant responses from warm cache.

Most command handlers (`handleBalanceCommand`, `handleSendCommand`, etc.) are pure functions: they take `SdkContext` and return serializable results. The daemon routes IPC calls to these same handlers — minimal new code.

**Handler categories (not all are pure):**
- **Wallet commands** (balance, send, pay, receive, mint, account) — pure, take `SdkContext`, return serializable results. Direct daemon routing.
- **Context-free commands** (decode) — no `SdkContext` needed. Daemon can handle directly or client can run locally.
- **Auth commands** (login, logout, status) — manage auth state, not wallet state. Run locally on the client, not through daemon. Daemon assumes auth is already done.
- **Watch** — long-lived event stream, not request/response. Becomes `watch.subscribe`/`watch.unsubscribe` in the IPC protocol.

## Phase 0: IPC Protocol

**Goal:** Define the contract between daemon and all clients.

**Build:**
- `src/daemon/protocol.ts` — shared types for requests, responses, events
- JSONL over Unix socket (one JSON object per `\n`)
- Request: `{id: string, method: string, params?: object}`
- Success response: `{id: string, result: object}`
- Error response: `{id: string, error: {code: string, message: string}}`
- Event (fire-and-forget): `{event: string, data: object, ts: string}` — same events `watch.ts` emits today
- Methods map 1:1 to CLI commands: `balance`, `send`, `pay`, `receive`, `decode`, `account.list`, `account.default`, `account.info`, `mint.add`, `mint.list`, `watch.subscribe`, `watch.unsubscribe`

**Verify:** Types compile. No runtime code yet.

**Risk:** Low — types only.

## Phase 1: Daemon Core

**Goal:** Evolve `watch.ts` into a daemon that accepts IPC commands.

**Build:**
- `src/daemon/daemon.ts` — main daemon loop
  - Calls `getSdkContext()` (same init path as every command)
  - Starts all 6 task processors + Supabase Realtime + leader election (extract from `watch.ts`)
  - Listens on `~/.agicash/daemon.sock`
  - No PID file — use socket probe for liveness detection
  - On startup: try connecting to existing socket. If connection succeeds → daemon already running, fail. If ECONNREFUSED or ENOENT → stale socket, clean up and start.
  - Graceful shutdown on SIGINT/SIGTERM: stop task processors, close all client connections, remove socket file (same pattern as `watch.ts`)
- `src/daemon/router.ts` — maps IPC method names to command handlers
  - `balance` → `handleBalanceCommand(ctx)`
  - `send` → `handleSendCommand(parsed, ctx)`
  - etc.
- `src/daemon/connection.ts` — per-client connection handler
  - Parses incoming JSONL lines
  - Routes to handler via router
  - Sends response
  - Manages event subscriptions per client
  - On socket close: clean up all subscriptions for that client (prevents leaked event listeners)
- Add `daemon` case to `main.ts` switch

**Files changed:**
- `src/main.ts` — add daemon command
- `src/commands/watch.ts` — extract shared logic (task processor setup, realtime, leader election) into daemon module
- New: `src/daemon/daemon.ts`, `src/daemon/router.ts`, `src/daemon/connection.ts`, `src/daemon/protocol.ts`

**Verify:**
```bash
# Terminal 1
agicash daemon

# Terminal 2
echo '{"id":"1","method":"balance","params":{}}' | nc -U ~/.agicash/daemon.sock
# Returns JSON balance response
```

**Prerequisite spike:** Verify Bun's `Bun.listen()` supports Unix domain sockets. Write a 10-line test: server listens on a socket path, client connects and exchanges a JSONL message. If Bun doesn't support it, fallback is `node:net` createServer with `{path: ...}`. Do this before starting Phase 1 implementation.

**Context staleness:** Daemon runs indefinitely — cache data can go stale. Mitigations already in place:
- Supabase Realtime keeps DB-backed data (accounts, quotes, transactions) fresh
- Supabase client auto-refreshes auth tokens
- QueryClient respects staleTime/gcTime for mint info (1h), exchange rates (polling)
- OpenSecret session expiry: daemon catches auth errors from Supabase and returns IPC error `{code: "AUTH_EXPIRED", message: "Session expired. Run: agicash auth login"}`. Does not auto-re-auth.

**Risk:**
- `watch.ts` extraction — need to keep `agicash watch` (direct mode) working while sharing code with daemon. Extract shared setup into a helper both consume.

## Phase 2: `--remote` Mode

**Goal:** Existing CLI commands work through the daemon.

**Build:**
- `src/daemon/client.ts` — daemon client
  - Connects to `~/.agicash/daemon.sock`
  - Sends request, waits for response with matching `id`
  - If socket doesn't exist: `"Daemon not running. Start with: agicash daemon"`
- Add `--remote` flag to arg parser (`src/args.ts`)
- `main.ts`: when `--remote` is set, skip `withSdkContext()` entirely. Create daemon client, send method + params, print response.
- `agicash watch --remote` — subscribes to event stream from daemon, prints events as they arrive (same output format as direct watch)
- Same `--pretty` / JSON formatting for all output

**Files changed:**
- `src/args.ts` — add `--remote` flag
- `src/main.ts` — remote dispatch branch
- New: `src/daemon/client.ts`

**Verify:**
```bash
# With daemon running:
agicash balance --remote          # instant
agicash receive 1000 --remote     # creates invoice via daemon
agicash watch --remote            # streams events from daemon
```

**Risk:**
- Response matching — multiple concurrent `--remote` calls share the socket? No — each CLI invocation opens its own connection, gets its own response. Simple.
- Timeout — if daemon handler hangs, `--remote` client needs a timeout.

## Phase 3: MCP Bridge

**Goal:** Claude can use the wallet through MCP tools.

**Build:**
- MCP server (either `agicash mcp-server` subcommand or standalone `agicash-mcp`)
- Connects to daemon socket on startup, fails if not running
- Maps MCP tools to IPC methods 1:1:
  - `agicash_balance` → `{method: "balance"}`
  - `agicash_send` → `{method: "send", params: {amount, accountId?}}`
  - `agicash_pay` → `{method: "pay", params: {bolt11, accountId?}}`
  - `agicash_receive` → `{method: "receive", params: {amount, accountId?}}`
  - `agicash_decode` → `{method: "decode", params: {input}}`
  - `agicash_accounts` → `{method: "account.list"}`
  - `agicash_transactions` → `{method: "transactions", params: {accountId?}}`
  - `agicash_pay_address` → `{method: "pay_address", params: {address, amount}}`

**Open question:** Subcommand pulls MCP SDK deps into CLI package. Separate binary (`packages/mcp` or standalone script) keeps deps isolated. Decide at implementation time based on dep size.

**Verify:** Add MCP server to Claude Code config, run `agicash_balance` tool.

**Risk:**
- MCP doesn't support server→client push in base spec. Payment completion events need polling or long-poll from the MCP tool (`--wait` semantics).

## Phase 4: New Commands

**Goal:** Fill out the missing CLI surface.

**Build (all work in both direct and daemon/remote mode):**

1. **`agicash transactions [--account <id>]`**
   - SDK has `TransactionRepository` with pagination
   - Returns list of transactions with amount, type, status, timestamp

2. **`agicash pay-address <ln-address> <amount>`**
   - SDK has `getInvoiceFromLud16()` for LN address resolution
   - Resolve → get invoice → pay (reuse `handlePayCommand` logic)

3. **`--wait` flag on `pay` / `receive`**
   - Direct mode: start task processors, wait for terminal event, then exit (like a focused `watch`)
   - Remote mode: subscribe to events from daemon, wait for terminal event matching the quote ID

4. **Transfer command** (may defer)
   - `agicash transfer <amount> --from <id> --to <id>`
   - Transfer service currently in `app/features/transfer/` — needs SDK extraction first
   - Lower priority — defer if extraction is non-trivial

**Risk:**
- Transfer service extraction could be significant scope. Only attempt after Phases 0-3 ship.

## Sequencing

```
Phase 0 ──→ Phase 1 ──→ Phase 2 ──→ Phase 3
                                  ╲
                                   ──→ Phase 4
```

Phases 0-2 are the critical path — they deliver the daemon + `--remote` CLI. Phase 3 (MCP) and Phase 4 (new commands) can run in parallel after Phase 2.

Phase 4 items (transactions, pay-address) can also be built as direct-mode commands before the daemon exists and wired into daemon/remote mode later. They don't depend on Phases 0-2.
