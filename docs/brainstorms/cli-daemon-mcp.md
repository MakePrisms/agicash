# Agicash CLI: Daemon + MCP Architecture

**Date:** 2026-04-02
**Participants:** gudnuf, keeper:brainstorm
**Status:** Brainstorm complete, ready for planning

## Problem

The agicash CLI is stateless — every invocation starts a fresh OS process, re-authenticates with OpenSecret, re-queries Supabase, re-initializes Cashu wallets (HTTP), and re-initializes Spark (gRPC). Then it does one thing and destroys everything.

An agent using the wallet has no way to:
- Wait for a payment to complete (pay/receive return "pending")
- Get notified when funds arrive
- Avoid paying the full init tax on every call
- Access transaction history
- Send to Lightning addresses

The `watch` command is already a daemon in spirit — it holds a warm SDK context, runs task processors, and manages Supabase Realtime. But nothing can talk to it.

## Decision: Separate Daemon

Follow pikachat's proven pattern: daemon as a long-lived system process, MCP server as a thin bridge.

```
agicash daemon          — long-lived, owns SDK context, task processors, warm cache
agicash <cmd> --remote  — thin CLI client, talks to daemon via Unix socket
agicash-mcp             — thin MCP bridge, spawns/connects to daemon, exposes tools to Claude
```

### Why separate daemon (not daemon-as-MCP):
- Daemon outlives any single Claude session — payment processing never stops
- Multiple clients can connect (MCP, CLI --remote, future UIs)
- MCP server is stateless — fast startup, easy restart, no state loss
- Clean separation: daemon = wallet runtime, MCP = agent interface

### Why not daemon-as-MCP:
- MCP lifecycle is tied to Claude — if Claude exits, daemon dies, payments stop processing
- MCP is 1:1 — only one Claude session can connect
- Non-Claude tools can't use MCP tools

## Architecture

### Daemon (`agicash daemon`)

Evolve the current `watch` command into a full daemon:

- Holds warm `WalletClient` with `QueryClient` (accounts, proofs, keys, Spark connection all cached)
- Runs all 6 task processors (cashu/spark send/receive quote/swap)
- Manages Supabase Realtime for push-based cache invalidation
- Holds leader election lock (`TaskProcessingLockRepository`)
- Listens on Unix socket (`~/.agicash/daemon.sock`) for client commands
- Emits events (payment completed, funds received, errors)

### MCP Server (`agicash-mcp`)

Thin TypeScript bridge:

- Spawns `agicash daemon` as child process (or connects to existing)
- Translates MCP tool calls into daemon commands
- Adds agent-specific concerns (if any)
- Communicates via JSONL over stdio (like pikachat) or Unix socket

Candidate MCP tools:
- `agicash_balance` — account balances
- `agicash_send` — create ecash token
- `agicash_pay` — pay Lightning invoice (can block until settled)
- `agicash_receive` — create invoice (can block until minted)
- `agicash_transactions` — transaction history
- `agicash_decode` — decode bolt11/cashu/lnurl/lightning address
- `agicash_accounts` — list/manage accounts
- `agicash_pay_address` — resolve Lightning address and pay

### CLI (`agicash <cmd> --remote`)

Existing commands gain a `--remote` flag:
- Connects to daemon's Unix socket instead of initializing SDK
- Instant response from warm cache
- Commands without `--remote` still work standalone (direct mode)

## Current State (for reference)

### CLI Commands Available
auth (login/signup/guest/logout/status/whoami), mint (add/list), balance, send, pay, receive (amount/token/list/check), decode, watch, config

### SDK Surface (ready for daemon)
- `createWalletClient()` — zero UI dependencies, works in any JS runtime
- `KeyProvider` interface — abstract key derivation (OpenSecret or local BIP-85)
- All send/receive services with quote+confirm pattern
- Task processors with event emitters
- Realtime handler for Supabase push updates
- Transaction repository with pagination
- LNURL/LUD-16 resolution
- Exchange rate service

### What's Missing (to be added)
- Transaction history CLI command
- Lightning address pay command
- Spark send/receive commands
- Transfer (cross-account) command
- `--wait` flag for blocking payment completion
- Persistent caching (currently all in-memory, destroyed per process)

## Caching Strategy

Current: no persistence. Every CLI call starts cold.

With daemon:
- QueryClient lives for daemon lifetime
- Supabase Realtime keeps cache fresh
- Expensive inits cached: Spark gRPC (infinite staleTime), Cashu mint info (1h), derived keys (infinite)
- CLI `--remote` commands get instant responses from warm cache

Future consideration: SQLite-backed cache persistence for daemon restarts. Serializable data (accounts, transactions, mint info, keys) can be persisted. Non-serializable (Spark gRPC, Cashu wallet objects) lazily re-initialized.

## Reference: Pikachat's Pattern

Pikachat uses the same architecture in Rust:

```
Claude  <--MCP/stdio-->  pikachat-claude (TS)  <--JSONL/stdio-->  pikachat daemon (Rust)
                                                                        |
                                                                   Unix socket
                                                                        |
                                                        pikachat --remote (CLI)
```

- One binary, `daemon` is a subcommand
- JSONL over stdio between MCP server and daemon
- Unix socket for CLI → daemon communication
- MCP server does NOT wrap CLI — talks directly to daemon
- MCP server adds agent-specific concerns (access control, mentions)
- Daemon owns all long-lived state

Our advantage: all TypeScript/Bun, no language boundary. Daemon and MCP server can share types directly.

## Open Questions (Resolved)

All resolved in the follow-up brainstorm — see `mcp-server.md`.

1. **Daemon lifecycle** → Child of MCP server. Dies with Claude. Wallet handles offline gracefully.
2. **IPC protocol** → JSONL over stdio (not Unix socket). No `--remote` in v1.
3. **Multi-instance** → Config-level isolation via `AGICASH_DIR` env var. Same or different users.
4. **Auth** → Daemon holds OpenSecret session for its lifetime. Re-auths on restart.
5. **Transfer service** → Deferred.
6. **MCP notifications** → `notifications/claude/channel` (Claude Code extension, pikachat's proven pattern).
