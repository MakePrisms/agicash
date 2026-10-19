# Background Task Processing

Only one client (browser tab / device) per user runs background tasks at any time.

## Leader Election

Each browser tab generates a random UUID on mount. A TanStack Query polls `take_lead(userId, clientId)` every **5 seconds**.

The `take_lead` SQL function uses `SELECT ... FOR UPDATE` on `wallet.task_processing_locks`:

| Condition | Result |
|-----------|--------|
| No row for user | Insert this client as leader, lock expires in 6s. Returns `true`. |
| Same client | Extend expiry to now + 6s (heartbeat). Returns `true`. |
| Different client, lock expired | Overwrite leader. Returns `true`. |
| Different client, lock active | Returns `false`. |

**Timing:** 5s poll + 6s lock = 1s grace window. If leader stops polling (tab backgrounded, closed, crashed), another client takes over within ~6 seconds.

Leader polling pauses when tab is backgrounded (`refetchIntervalInBackground: false`).

## Task Processor

`TaskProcessor` is a renderless React component rendered **only by the leader**. It activates six processing hooks:

| Hook | Entity |
|------|--------|
| `useProcessCashuReceiveQuoteTasks` | Mint proofs when Lightning invoice is paid |
| `useProcessCashuReceiveSwapTasks` | Complete token swaps |
| `useProcessCashuSendQuoteTasks` | Initiate melts, handle settlement |
| `useProcessCashuSendSwapTasks` | Execute swaps, monitor proof spending |
| `useProcessSparkReceiveQuoteTasks` | Poll for incoming Spark payments |
| `useProcessSparkSendQuoteTasks` | Initiate sends, poll for completion |

Non-leader clients skip `TaskProcessor` entirely but still receive realtime updates for UI freshness.

## Realtime Change Tracking

The SDK owns the `wallet:<userId>` broadcast channel (`packages/wallet-sdk/domain/wallet/realtime-feed.ts`) and opens it when a session starts. `useTrackWalletChanges()` subscribes to the contract events from the ten handler hooks — accounts, transactions, contacts, cashu receive quotes, cashu receive swaps, cashu send quotes, cashu send swaps, spark receive quotes, spark send quotes, and the user — plus `connection.changed`.

**On every `connected`:** thirteen caches are invalidated (each entity cache plus the pending and unresolved lists) to catch updates missed while disconnected.

**Hidden or offline:** a subscribed channel stays up. A failure while inactive, with no retry cycle already in progress, leaves the channel (public state `reconnecting`) and a later return to active rejoins from that closed state. A retry cycle that has already started keeps counting while the tab is inactive and can reach a terminal `error`. Becoming active again does not restart `error`.

## Files

```
app/features/wallet/
├── task-processing.ts                    # TaskProcessor component + useTakeTaskProcessingLead
├── task-processing-lock-repository.ts    # take_lead RPC wrapper
└── use-track-wallet-changes.ts           # Subscribes to SDK events and refreshes caches
```
