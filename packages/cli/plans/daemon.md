# CLI Daemon Plan

**Date:** 2026-04-03
**Status:** Approved (v2 — MCP-owned lifecycle)
**Branch:** `plans/cli-daemon`
**Brainstorm:** `docs/brainstorms/cli-daemon-mcp.md`

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Package structure | Keep in `packages/cli` | Daemon IS the CLI, just long-lived. No new package boundary. |
| Daemon lifecycle | MCP-owned — spawned as child process | Wallet handles offline gracefully (quotes expire, proofs durable, pending txns resume). No need to outlive Claude sessions. |
| Auth | Use persisted session, error if not authed | CLI persists auth in SQLite. Daemon calls same init path. Never auto-login. |
| IPC protocol | JSONL over stdio (daemon↔MCP) | Follows pikachat pattern. MCP server spawns daemon, communicates via stdin/stdout. |
| Multi-daemon | Safe — leader election handles it | Multiple Claude sessions can each spawn their own daemon. `TaskProcessingLockRepository` ensures only one runs task processors (same as multiple browser tabs). |
| CLI direct mode | Unchanged for v1 | CLI commands still work standalone (cold start). `--remote` mode is a v2 optimization. |

## Architecture

```
Claude  ←MCP/stdio→  agicash-mcp (TS)  ←JSONL/stdio→  daemon process (TS)
                                                              |
                                                      WalletClient
                                                      6 task processors
                                                      Supabase Realtime
                                                      leader election
```

**Pikachat's exact pattern.** MCP server is the parent, daemon is the child. Daemon dies when MCP server exits. No Unix socket, no PID file, no lifecycle management.

The daemon holds a warm `WalletClient` (8 repos, 7 services, 11 caches, 6 task processors, Supabase Realtime, leader election). The MCP server translates tool calls to JSONL commands over stdio.

**Handler categories:**
- **Wallet commands** (balance, send, pay, receive, mint, account) — pure, take `SdkContext`, return serializable results. Direct daemon routing.
- **Context-free commands** (decode) — no `SdkContext` needed. MCP server can handle directly or pass through to daemon.
- **Auth commands** (login, logout, status) — not exposed via MCP. User manages auth via CLI directly.
- **Watch/events** — daemon emits task processor events on stdout. MCP server can surface these as tool results when using `--wait` semantics.

## Phase 0: IPC Protocol

**Goal:** Define the JSONL contract between MCP server and daemon.

**Build:**
- `src/daemon/protocol.ts` — shared types for requests, responses, events
- JSONL over stdio (one JSON object per `\n`)
- Request (MCP→daemon): `{id: string, method: string, params?: object}`
- Success response (daemon→MCP): `{id: string, result: object}`
- Error response (daemon→MCP): `{id: string, error: {code: string, message: string}}`
- Event (daemon→MCP, unsolicited): `{event: string, data: object, ts: string}` — same events `watch.ts` emits today
- Methods map 1:1 to CLI commands: `balance`, `send`, `pay`, `receive`, `decode`, `account.list`, `account.default`, `account.info`, `mint.add`, `mint.list`, `events.subscribe`, `events.unsubscribe`

**Verify:** Types compile. No runtime code yet.

**Risk:** Low — types only.

## Phase 1: Daemon Process

**Goal:** Long-lived process that holds warm SDK context and accepts JSONL commands on stdin.

**Build:**
- `src/daemon/daemon.ts` — entry point
  - Calls `getSdkContext()` (same init path as every CLI command)
  - Starts all 6 task processors + Supabase Realtime + leader election (extract from `watch.ts`)
  - Reads JSONL requests from stdin, writes responses/events to stdout
  - Stderr for logging (keeps stdout clean for protocol)
  - Graceful shutdown on SIGINT/SIGTERM/stdin close
- `src/daemon/router.ts` — maps IPC method names to command handlers
  - `balance` → `handleBalanceCommand(ctx)`
  - `send` → `handleSendCommand(parsed, ctx)`
  - etc.
- Add `daemon` case to `main.ts` switch (or standalone entry point)

**Files changed:**
- `src/main.ts` — add daemon command
- `src/commands/watch.ts` — extract shared logic (task processor setup, realtime, leader election) into reusable module
- New: `src/daemon/daemon.ts`, `src/daemon/router.ts`, `src/daemon/protocol.ts`

**Verify:**
```bash
echo '{"id":"1","method":"balance","params":{}}' | agicash daemon
# Returns JSONL balance response on stdout
```

**Context staleness:** Daemon lives for the MCP session (shorter than independent daemon). Mitigations:
- Supabase Realtime keeps DB-backed data fresh
- Supabase client auto-refreshes auth tokens
- QueryClient respects staleTime/gcTime for mint info, exchange rates
- OpenSecret session expiry: return error `{code: "AUTH_EXPIRED", message: "Session expired. Run: agicash auth login"}`

**Risk:**
- `watch.ts` extraction — keep `agicash watch` (direct mode) working while sharing code. Extract shared setup into a helper both consume.

## Phase 2: MCP Server

**Goal:** Claude can use the wallet through MCP tools.

**Build:**
- `src/mcp/server.ts` — MCP server entry point
  - Spawns `agicash daemon` as child process on startup
  - Translates MCP tool calls → JSONL requests over child's stdin
  - Reads JSONL responses from child's stdout → MCP tool results
  - Forwards daemon events as needed
- MCP tools:
  - `agicash_balance` → `{method: "balance"}`
  - `agicash_send` → `{method: "send", params: {amount, accountId?}}`
  - `agicash_pay` → `{method: "pay", params: {bolt11, accountId?}}`
  - `agicash_receive` → `{method: "receive", params: {amount, accountId?}}`
  - `agicash_decode` → `{method: "decode", params: {input}}`
  - `agicash_accounts` → `{method: "account.list"}`
  - `agicash_pay_address` → `{method: "pay_address", params: {address, amount}}`
- Tool descriptions should give Claude enough context to use the wallet effectively (account selection, amount units, workflow tips)

**Files changed:**
- New: `src/mcp/server.ts`
- Package deps: `@modelcontextprotocol/sdk`

**Verify:** Add MCP server to Claude Code config (`~/.claude/settings.json`), run `agicash_balance` tool from a Claude session.

**Risk:**
- MCP SDK dependency size — if heavy, consider separate `packages/mcp` package. Check at implementation time.
- Payment completion: MCP tools that trigger payments (`pay`, `receive`) should support blocking until completion. Daemon streams events, MCP tool waits for terminal event matching the quote ID before returning.

## Phase 3: New Commands + MCP Tools

**Goal:** Fill out the wallet surface.

**Build (added to daemon + exposed as MCP tools):**

1. **`transactions`** — transaction history
   - SDK has `TransactionRepository` with pagination
   - MCP tool: `agicash_transactions` with optional `accountId` param

2. **`pay_address`** — Lightning address pay
   - SDK has `getInvoiceFromLud16()` for LN address resolution
   - Resolve → get invoice → pay (reuse pay handler logic)
   - MCP tool: `agicash_pay_address` with `address` and `amount` params

3. **`--wait` semantics for pay/receive**
   - MCP tools block until terminal event (completed/failed/expired)
   - Daemon streams events, MCP server waits for matching quote ID
   - Timeout with clear error if payment doesn't complete

4. **Transfer** (may defer)
   - Cross-account transfer
   - Transfer service currently in `app/features/transfer/` — needs SDK extraction
   - Lower priority — defer if extraction is non-trivial

**Risk:**
- Transfer service extraction could be significant scope. Only attempt after Phases 0-2 ship.

## Sequencing

```
Phase 0 ──→ Phase 1 ──→ Phase 2 ──→ Phase 3
```

Linear — each phase depends on the previous. Phase 3 items can be added incrementally after Phase 2 ships.

Phase 3 items (transactions, pay-address) can also be built as direct-mode CLI commands independently and wired into daemon later.

## Future: v2 Independent Daemon

If CLI cold-start tax becomes a pain point, upgrade to independent daemon:
- Add Unix socket listener to daemon (alongside stdio)
- Add `--remote` flag to CLI commands
- MCP server connects to existing daemon instead of spawning child
- Same protocol, just a different transport

This is additive — everything from v1 still works. The protocol types and handler routing don't change.
