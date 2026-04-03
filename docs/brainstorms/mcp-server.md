# Agicash MCP Server Design

**Date:** 2026-04-03
**Participants:** gudnuf, keeper:brainstorm
**Status:** Brainstorm complete, ready for planning
**Supersedes:** Open questions 1-6 in cli-daemon-mcp.md

## Context

The daemon + MCP architecture was decided in the prior brainstorm (cli-daemon-mcp.md). This session resolved the open questions and designed the MCP server layer specifically.

## Decisions

### 1. Daemon Lifecycle: Tied to MCP

**Changed from prior brainstorm.** The daemon does NOT need to outlive Claude sessions.

The wallet handles being offline gracefully — quotes expire, proofs are durable, pending transactions resume on reconnect. So the daemon is spawned as a child process of the MCP server and dies when it dies. Pikachat's exact pattern.

```
Claude  ←stdio/MCP→  agicash-mcp (TS)
                         |
                     spawns child
                         |
                      agicash daemon (TS/Bun)
                         ↕ JSONL over stdio
```

No Unix socket. No `--remote` CLI mode. No PID file. No systemd. Independent daemon is a v2 upgrade path if needed.

### 2. Channel Source: `agicash`

Events appear in Claude as:
```xml
<channel source="agicash" event="payment_completed">
Paid 1000 sats via cashu-default. Fee: 2 sats. Quote: abc123
</channel>
```

### 3. Event Push via Claude Channels

Uses the `notifications/claude/channel` experimental capability — the same mechanism pikachat uses. Battle-tested on turtle.

```ts
// MCP server declares the capability
capabilities: {
  experimental: { "claude/channel": {} },
  tools: {},
}

// Forwards daemon events as channel notifications
mcp.notification({
  method: "notifications/claude/channel",
  params: {
    content: "Paid 1000 sats via cashu-default. Fee: 2 sats.",
    meta: { source: "agicash", event: "payment_completed", quoteId: "abc123" }
  }
});
```

### 4. Minimal Events (v1)

Only terminal payment states. No lifecycle noise.

| Event | When |
|-------|------|
| `payment_completed` | Lightning pay settled |
| `payment_failed` | Lightning pay failed |
| `receive_completed` | Invoice paid and minted, or token swap done |
| `receive_failed` | Quote expired or mint failed |

### 5. Payment Flow UX

**Pay (with wait):**
`agicash_pay({ invoice: "lnbc1...", wait: true })` — blocks until settled.

**Receive token (immediate):**
`agicash_receive({ token: "cashuA..." })` — swap is instant, returns completed.

**Receive via invoice (two-step):**
1. `agicash_receive({ amount: 1000 })` → returns `{ invoice: "lnbc1...", quoteId: "q1" }` immediately
2. Agent gives invoice to user
3. Channel notification arrives when payment lands

**For non-channel clients:**
`agicash_await_payment({ quoteId: "q1" })` — blocks indefinitely until settlement. Optional `timeout` param (seconds), no default. Agent decides its own tolerance.

### 6. Adaptive Client Behavior

MCP server detects whether the client declared `claude/channel` support:
- **Channel-capable:** fire-and-forget + channel notification
- **Any other client:** blocking tool response

One implementation, adapts to client capabilities.

### 7. Multi-Instance via Config

Each MCP instance points to its own config directory:

```jsonc
// Agent A's .mcp.json
{
  "agicash": {
    "command": "agicash-mcp",
    "env": {
      "AGICASH_DIR": "~/.agicash/agent-a",
      "AGICASH_ENV": "agent-a"
    }
  }
}
```

- Same or different Supabase users — config choice, not code concern
- Multiple daemons are safe — leader election via `TaskProcessingLockRepository`
- Only the leader runs task processors; others are read-only for processing but fully functional for commands

### 8. MCP Instructions

The MCP server should include an `instructions` string (like pikachat does) telling the agent what's available and how to use it. Query the daemon for accounts on startup and bake wallet state into instructions.

## MCP Tool Surface

### Wallet Operations
| Tool | Description |
|------|-------------|
| `agicash_balance` | Balances across all accounts |
| `agicash_pay` | Pay Lightning invoice or address. Optional `wait: true` to block. |
| `agicash_send` | Create ecash token |
| `agicash_receive` | Create Lightning invoice or claim ecash token |
| `agicash_decode` | Parse any input (invoice, token, lnurl, address) |
| `agicash_transactions` | Transaction history with pagination |
| `agicash_await_payment` | Block until a quote settles. Optional `timeout` (seconds). |

### Account Management
| Tool | Description |
|------|-------------|
| `agicash_accounts` | List all accounts with balances |
| `agicash_account_info` | Detailed info for a specific account |
| `agicash_account_default` | Set default account for a currency |
| `agicash_mint_add` | Add a Cashu mint and create account |
| `agicash_mint_list` | List configured mints |

## Current Implementation State

keeper:cli shipped a v1 (merged to agicash-cli, commit 9ebd5af):
- Daemon process with JSONL protocol, typed events, router
- MCP server with 10 tools, child process spawn, request/response
- Task processors extracted from watch.ts

**Gaps to address:**
1. No `claude/channel` capability — events logged to stderr, not forwarded to Claude
2. No `agicash_await_payment` tool
3. No `wait` param on `agicash_pay`
4. No `agicash_transactions` tool
5. No Lightning address support on pay
6. No MCP `instructions` field
7. No adaptive blocking based on client capabilities

## MCP Spec Notes

For reference, the MCP spec (2025-11-25) has several push mechanisms:

| Mechanism | Status | Our use |
|-----------|--------|---------|
| `claude/channel` | Claude Code extension | Primary — event push to Claude |
| Resource subscriptions | Stable | Not needed — channels are better fit |
| Tasks (long-running) | Experimental | Could use for `await_payment`, but blocking tool is simpler |
| SEP-2495 (event-driven invocation) | Draft proposal | Would be ideal but not implemented |

## Reference: Pikachat's Channel Implementation

```ts
// server.ts — capability declaration
const mcp = new Server(
  { name: config.channelSource, version: "0.1.0" },
  { capabilities: { experimental: { "claude/channel": {} }, tools: {} } }
);

// channel-runtime.ts — event forwarding
onNotification: async ({ content, meta }) => {
  await mcp.notification({
    method: "notifications/claude/channel",
    params: { content, meta }
  });
}
```

Daemon events → channel-runtime → MCP notification → Claude sees `<channel>` tag.
