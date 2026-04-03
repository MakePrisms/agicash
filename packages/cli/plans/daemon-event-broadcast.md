# Daemon Event Broadcast Plan

**Date:** 2026-04-03
**Status:** Draft — awaiting approval
**Branch:** `agicash-cli`
**Source:** keeper:cli request from gudnuf

## Problem

Each MCP server spawns its own daemon. Only one daemon wins leader election and runs task processors. Events (`receive:minted`, `send:completed`, etc.) only flow from the leader daemon → its parent MCP server. Non-leader daemons never get events, so their Claude sessions never get push notifications.

## Decision

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Broadcast mechanism | Supabase Realtime broadcast | Already connected, zero infra, pure client-side pub/sub, ~20 lines |
| Channel topic | `daemon-events:${userId}` | Scoped to user, matches `wallet:${userId}` pattern |
| Dedup strategy | None needed | Supabase broadcast `self: false` (default) — sender doesn't receive own messages |
| Which events to broadcast | Terminal events only | Same set as `DAEMON_EVENT_MAP` in server.ts — the ones MCP server forwards as channel notifications |
| Error events | Don't broadcast | Errors are local to the leader's task processors, not actionable by other sessions |
| Manager vs raw channel | Raw `RealtimeClient` | Broadcast channel doesn't need the manager's reconnection/retry logic. If we miss a notification during brief disconnect, the user can poll via tools. |

## Alternatives Considered

| Option | Verdict | Why |
|--------|---------|-----|
| **A. Supabase Realtime broadcast** | **Chosen** | ~20 lines, no infra, already connected |
| B. Shared Unix socket | Rejected | More code, lifecycle management, doesn't scale across machines |
| C. Postgres LISTEN/NOTIFY | Rejected | DB schema changes, heavier than needed for ephemeral notifications |
| D. Non-leaders poll for events | Rejected | High latency, wasted resources |

## Architecture

```
Leader daemon:
  task processor event → onEvent (direct stdout) → broadcast on Supabase channel

Non-leader daemons:
  Supabase broadcast received → onEvent (stdout) → MCP server → channel notification

Dedup:
  Supabase broadcast self:false — leader never receives its own broadcast
```

## Implementation

### File: `packages/cli/src/daemon/task-processors.ts`

**1. Define terminal event set** (after imports, ~line 8):

```typescript
/** Events that should be broadcast to non-leader daemons */
const BROADCAST_EVENTS = new Set<DaemonEventName>([
  'receive:minted',
  'receive:expired',
  'receive:swap:completed',
  'send:completed',
  'send:failed',
  'send:swap:completed',
  'spark:receive:completed',
  'spark:receive:expired',
  'spark:send:completed',
  'spark:send:failed',
]);
```

**2. Create broadcast channel** (in `startTaskProcessors`, after `realtimeHandler.start()`, ~line 241):

```typescript
// Broadcast channel for cross-daemon event delivery.
// Leader broadcasts terminal events; non-leaders subscribe and forward.
// self:false (default) means the sender doesn't receive its own messages.
const broadcastTopic = `daemon-events:${ctx.userId}`;
const broadcastChannel = supabaseClient.channel(broadcastTopic);

// Non-leader daemons forward broadcast events to their MCP server
broadcastChannel.on('broadcast', { event: 'daemon-event' }, (msg) => {
  if (!isLead) {
    onEvent(msg.payload as DaemonEvent);
  }
});

await new Promise<void>((resolve) => {
  broadcastChannel.subscribe((status) => {
    if (status === 'SUBSCRIBED') resolve();
  });
});
```

**3. Wrap onEvent to broadcast from leader** (before `wireEventListeners` call, ~line 231):

```typescript
const broadcastOnEvent: OnEventCallback = (event) => {
  onEvent(event);  // existing: emit to stdout
  // Leader broadcasts terminal events for non-leader daemons
  if (isLead && BROADCAST_EVENTS.has(event.event)) {
    broadcastChannel.send({
      type: 'broadcast',
      event: 'daemon-event',
      payload: event,
    });
  }
};
```

Then pass `broadcastOnEvent` to `wireEventListeners` instead of `onEvent`.

**4. Cleanup on shutdown** (add to `shutdown()` function, ~line 306):

```typescript
supabaseClient.removeChannel(broadcastChannel);
```

### No changes needed

- `daemon.ts` — already forwards all events from `onEvent` to stdout
- `server.ts` — already maps daemon events to MCP channel notifications
- `protocol.ts` — no new event types needed

## Scope

~25 lines changed in `task-processors.ts`. No other files modified.

## Edge Cases

| Case | Behavior | Acceptable? |
|------|----------|-------------|
| Non-leader subscribes after leader broadcasts | Misses the event | Yes — notifications are best-effort. User can check via `agicash_balance`/`agicash_transactions` |
| Leader loses Supabase connection | Broadcasts fail silently | Yes — leader's own MCP server still gets direct events. Only non-leaders lose notifications temporarily |
| Stale leader (lock held but not processing) | No events produced or broadcast | Not fixed by this plan — requires separate stale leader detection |
| Leader changes mid-session | New leader starts broadcasting, old stops | Yes — `isLead` flag tracks this via polling |
| Broadcast channel disconnects | Non-leader stops receiving until reconnect | Acceptable for ephemeral notifications |

## Stale Daemon Note

keeper:cli's request mentioned this "fixes the stale daemon problem." Clarification: this fixes the case where a **healthy** leader produces events but only its own MCP server receives them. It does NOT fix a truly stale daemon that holds the lock but isn't processing — that requires separate stale leader detection (lock TTL expiry or heartbeat).
