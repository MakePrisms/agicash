# MCP Server v2 Plan

**Date:** 2026-04-03
**Status:** Approved
**Depends on:** daemon.md (v1 daemon + MCP server, merged to agicash-cli at 9ebd5af)
**Brainstorm:** `docs/brainstorms/mcp-server.md`

## Context

v1 shipped: daemon process, JSONL protocol, MCP server with 10 tools. This plan addresses the 7 gaps identified in the MCP server brainstorm.

## Gaps to Address

1. No `claude/channel` capability — events logged to stderr, not forwarded to Claude
2. No `agicash_await_payment` tool
3. No `wait` param on `agicash_pay`
4. No `agicash_transactions` tool
5. No Lightning address support on pay
6. No MCP `instructions` field
7. No adaptive blocking based on client capabilities

## Reference: Channel Pattern

Both mercury and NWC MCP servers use the same pattern. Agicash should follow it exactly.

**Capability declaration:**
```ts
const mcp = new Server(
  { name: 'agicash', version: '0.1.0' },
  {
    capabilities: { tools: {}, experimental: { 'claude/channel': {} } },
    instructions: '...', // see Phase C
  }
);
```

**Event push (notification format):**
```ts
mcp.notification({
  method: 'notifications/claude/channel',
  params: {
    content: 'Paid 1000 sats via cashu-default. Fee: 2 sats. Quote: abc123',
    meta: {
      source: 'agicash',
      event: 'payment_completed',  // or payment_failed, receive_completed, receive_failed
      chat_id: 'agicash',
      message_id: quoteId,
      ts: new Date().toISOString(),
    },
  },
}).catch(err => {
  process.stderr.write(`agicash-mcp: notification failed: ${err}\n`);
});
```

**Channel detection (agicash-specific — mercury/NWC don't do this):**

The MCP SDK stores client capabilities after the `initialize` handshake:
```ts
// After mcp.connect():
const clientCaps = mcp.getClientCapabilities();
const hasChannels = !!clientCaps?.experimental?.['claude/channel'];
```

This flag drives adaptive behavior in payment tools.

## Phase A: Channel Events + Detection

**Goal:** Daemon events appear as Claude channel notifications. MCP server detects whether client supports channels.

**Build:**

1. **Declare capability** — add `experimental: { 'claude/channel': {} }` to MCP server constructor (same as mercury)

2. **Detect client support** — after `mcp.connect()`, check `mcp.getClientCapabilities()?.experimental?.['claude/channel']`. Store as `hasChannels` boolean.

3. **Forward daemon events** — daemon already emits events on stdout (task processor events from `watch.ts`). MCP server's JSONL reader already sees these. Add a handler:
   - Filter for terminal events only: `receive:minted`, `receive:expired`, `send:completed`, `send:failed`, `spark:receive:completed`, `spark:receive:expired`, `spark:send:completed`, `spark:send:failed`
   - Map to 4 normalized event types: `payment_completed`, `payment_failed`, `receive_completed`, `receive_failed`
   - Push as `notifications/claude/channel` with content string and meta (source, event, quoteId, ts)
   - `.catch()` on notification send (fire-and-forget — don't let notification failures break the server)

4. **Event content format** — human-readable string with key details:
   - `payment_completed`: "Paid {amount} sats via {accountName}. Fee: {fee} sats. Quote: {quoteId}"
   - `payment_failed`: "Payment failed for quote {quoteId}: {reason}"
   - `receive_completed`: "Received {amount} sats on {accountName}. Quote: {quoteId}"
   - `receive_failed`: "Receive expired for quote {quoteId}"

**Files changed:**
- `src/mcp/server.ts` — capability declaration, client detection, event forwarding

**Verify:** Start MCP server in Claude Code. Trigger a receive (create invoice, pay it externally). Claude should see a `<channel source="agicash">` notification.

## Phase B: Payment Flow Tools

**Goal:** Payment tools support blocking until settlement. Adaptive behavior based on channel support.

**Build:**

1. **`wait` param on `agicash_pay`** — when `wait: true`:
   - Send pay request to daemon
   - Subscribe to daemon events, wait for terminal event matching the quote ID
   - Return final result (completed with fee, or failed with reason)
   - Timeout after 60s with clear error
   - When `wait` is omitted: return immediately with quote ID. If `hasChannels`, agent gets notified via channel. If not, agent can use `agicash_await_payment`.

2. **`agicash_await_payment` tool** — new tool:
   - Input: `{ quoteId: string, timeout?: number }` (timeout in seconds, no default — agent decides tolerance)
   - Subscribes to daemon events, blocks until terminal event matching quoteId
   - Returns the terminal event data (completed/failed/expired)
   - This is the non-channel client's way to wait for settlement
   - Also useful for receive flows: create invoice → give to user → `await_payment` for minting

3. **Adaptive behavior in tool descriptions:**
   - If `hasChannels`: tool descriptions mention "you'll receive a channel notification when payment settles"
   - If not: tool descriptions mention "use agicash_await_payment to wait for settlement"
   - Bake this into tool descriptions at registration time (after channel detection)

**Files changed:**
- `src/mcp/server.ts` — update pay tool, add await_payment tool, adaptive descriptions
- `src/daemon/protocol.ts` — add `await_payment` method if needed (or handle entirely in MCP layer)

**Verify:**
- `agicash_pay({ invoice: "lnbc...", wait: true })` — blocks, returns completed
- `agicash_receive({ amount: 1000 })` → get invoice → pay externally → channel notification or `agicash_await_payment`

## Phase C: Tool Surface + Instructions

**Goal:** Fill remaining gaps.

**Build:**

1. **`agicash_transactions` tool:**
   - Add `transactions` method to daemon router → `handleTransactionsCommand`
   - Command reads from `TransactionRepository` with pagination
   - MCP tool: `agicash_transactions({ accountId?: string, limit?: number })`
   - Returns list: amount, type (send/receive), status, timestamp, account name

2. **Lightning address on `agicash_pay`:**
   - Detect Lightning address input (contains `@`)
   - Resolve via `getInvoiceFromLud16()` (SDK already has this)
   - Then proceed with normal pay flow
   - Update tool description: "Pay a Lightning invoice, Lightning address, or LNURL"

3. **MCP `instructions` field:**
   - Query daemon for accounts on startup (send `account.list` request)
   - Build instructions string with:
     - Available accounts (name, type, currency, balance)
     - Default accounts per currency
     - Supported operations
     - Channel notification behavior (if `hasChannels`)
     - Amount units (sats for BTC, cents for USD)
   - Follow mercury's pattern: array of instruction lines joined with `\n`

**Files changed:**
- `src/daemon/router.ts` — add transactions route
- `src/mcp/server.ts` — transactions tool, LN address detection, instructions field
- `src/daemon/protocol.ts` — add `transactions` method type

**Verify:**
- `agicash_transactions()` returns transaction list
- `agicash_pay({ invoice: "user@getalby.com", amount: 1000 })` resolves and pays
- MCP server startup shows instructions with account state

## Sequencing

```
Phase A ──→ Phase B ──→ Phase C
```

Linear — Phase B needs A's event infrastructure and channel detection. Phase C's instructions need channel detection from A.

Phase C items (transactions, LN address) could technically be done in parallel with B since they don't depend on channel events, but keeping it linear for simplicity.

## Terminal Event Mapping

For implementation reference — daemon events to normalized MCP events:

| Daemon Event | MCP Event | Type |
|-------------|-----------|------|
| `send:completed` | `payment_completed` | cashu lightning pay |
| `send:failed` | `payment_failed` | cashu lightning pay |
| `spark:send:completed` | `payment_completed` | spark lightning pay |
| `spark:send:failed` | `payment_failed` | spark lightning pay |
| `receive:minted` | `receive_completed` | cashu lightning receive |
| `receive:expired` | `receive_failed` | cashu lightning receive |
| `receive:swap:completed` | `receive_completed` | cashu token receive |
| `spark:receive:completed` | `receive_completed` | spark lightning receive |
| `spark:receive:expired` | `receive_failed` | spark lightning receive |
| `send:swap:completed` | `payment_completed` | cashu token send |
