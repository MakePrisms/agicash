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

`useTrackWalletChanges()` subscribes to a single Supabase broadcast channel (`wallet:{userId}`) for all entity types. Nine handlers dispatch updates to TanStack Query caches:

Accounts, Transactions, Contacts, CashuReceiveQuotes, CashuReceiveSwaps, CashuSendQuotes, CashuSendSwaps, SparkReceiveQuotes, SparkSendQuotes.

**On reconnection:** All nine caches are invalidated to catch updates missed while disconnected.

**Tab visibility:** When a tab goes to background/offline, channel state adjusts. On return, channels resubscribe and `onConnected` fires cache invalidation.

## Files

```
app/features/wallet/
├── task-processing.ts                    # TaskProcessor component + useTakeTaskProcessingLead
├── task-processing-lock-repository.ts    # take_lead RPC wrapper
└── use-track-wallet-changes.ts           # Realtime broadcast subscription
```
