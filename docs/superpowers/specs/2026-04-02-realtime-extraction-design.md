# Realtime Handler Extraction — Design Spec

## Problem

Realtime change handling (Supabase broadcast → cache updates) is locked inside React hooks in the web app. The SDK owns queries, caches, and task processors, but has no way to react to server-side data changes. CLI, daemon, and future MCP consumers can't receive realtime updates.

## Decisions

1. **Minimal SDK handler** — SDK owns change handler logic and a `RealtimeHandler` class that uses the SDK's existing `SupabaseRealtimeManager` (`packages/sdk/src/lib/supabase/supabase-realtime-manager.ts`) for reliable channel subscriptions. Web app continues using its own `SupabaseRealtimeManager` instance (with browser lifecycle layered on top via `useSupabaseRealtime`). CLI creates a simpler manager without tab/online tracking.

2. **Individual deps, not full WalletClient** — each change handler factory takes only the repos and caches it needs, matching the existing task processor pattern. `WalletClient` wires them together as a convenience.

3. **Skip contacts** — extract 8 of 9 handler sets. Contacts have a side dependency (`useLocationData` for domain) and aren't relevant to CLI. Easy to add later.

## Current state

### Already in SDK

| Category | Count | Status |
|----------|-------|--------|
| Cache classes | 9 of 11 | Missing: `CashuSendSwapCache`, `UnresolvedCashuSendSwapsCache` |
| Query factories | 11 | Missing: cashu send swap |
| Task processors | 5 of 6 | Missing: cashu send swap |
| Repos | 8 | All done |
| Services | 7 | All done |

### Prerequisite: cashu send swap extraction

Before change handlers can be fully wired, the cashu send swap slice must be extracted:

- `packages/sdk/src/features/send/cashu-send-swap-queries.ts` — `CashuSendSwapCache`, `UnresolvedCashuSendSwapsCache`, query factories
- `packages/sdk/src/features/send/cashu-send-swap-task-processor.ts` — send swap processing (DRAFT → PENDING → COMPLETED via ProofStateSubscriptionManager)
- Wire both into `WalletClient` type and `createWalletClient()` factory

After this prerequisite, `WalletClient.caches` expands to 11 entries:

```
accounts, cashuReceiveQuote, pendingCashuReceiveQuotes, pendingCashuReceiveSwaps,
cashuSendSwap, unresolvedCashuSendSwaps,                    ← NEW
pendingSparkReceiveQuotes, sparkReceiveQuote,
transactions, unresolvedCashuSendQuotes, unresolvedSparkSendQuotes
```

All 11 must be invalidated in the `onConnected` callback (plus contacts cache on the web app side).

## Design

### 1. Change handler factories

Each feature gets a plain factory function (no React) that returns `DatabaseChangeHandler[]`.

```typescript
// packages/sdk/src/features/wallet/realtime-handler.ts (shared type, exported from SDK index)
type DatabaseChangeHandler = {
  event: string;
  handleEvent: (payload: unknown) => void | Promise<void>;
};
```

The `payload` parameter is typed as `unknown` at the dispatch boundary because broadcast messages arrive untyped. Each factory function internally type-narrows the payload before passing it to repos (e.g., `repo.toAccount(payload as AgicashDbAccountWithProofs)`).

**Files and signatures:**

```
packages/sdk/src/features/accounts/account-change-handlers.ts
  createAccountChangeHandlers(accountRepo, accountsCache)
    → ACCOUNT_CREATED → repo.toAccount(payload) → cache.upsert
    → ACCOUNT_UPDATED → repo.toAccount(payload) → cache.update

packages/sdk/src/features/transactions/transaction-change-handlers.ts
  createTransactionChangeHandlers(transactionRepo, transactionsCache)
    → TRANSACTION_CREATED → convert → cache.upsert + conditional count invalidation
    → TRANSACTION_UPDATED → convert → cache.upsert + conditional count invalidation

packages/sdk/src/features/receive/cashu-receive-change-handlers.ts
  createCashuReceiveQuoteChangeHandlers(receiveQuoteRepo, receiveQuoteCache, pendingQuotesCache)
    → CASHU_RECEIVE_QUOTE_CREATED → convert → pendingCache.add
    → CASHU_RECEIVE_QUOTE_UPDATED → convert → cache.updateIfExists + pending add/remove by state

  createCashuReceiveSwapChangeHandlers(receiveSwapRepo, pendingSwapsCache)
    → CASHU_RECEIVE_SWAP_CREATED → convert → cache.add
    → CASHU_RECEIVE_SWAP_UPDATED → convert → update/remove by state (PENDING stays)

packages/sdk/src/features/send/cashu-send-change-handlers.ts
  createCashuSendQuoteChangeHandlers(sendQuoteRepo, unresolvedQuotesCache)
    → CASHU_SEND_QUOTE_CREATED → convert → cache.add
    → CASHU_SEND_QUOTE_UPDATED → convert → update/remove by state (UNPAID/PENDING stay)

  createCashuSendSwapChangeHandlers(sendSwapRepo, sendSwapCache, unresolvedSwapsCache)
    → CASHU_SEND_SWAP_CREATED → convert → unresolvedCache.add
    → CASHU_SEND_SWAP_UPDATED → convert → cache.updateIfExists + unresolved update/remove by state (DRAFT/PENDING stay)

packages/sdk/src/features/receive/spark-receive-change-handlers.ts
  createSparkReceiveQuoteChangeHandlers(receiveQuoteRepo, receiveQuoteCache, pendingQuotesCache)
    → SPARK_RECEIVE_QUOTE_CREATED → convert → pendingCache.add
    → SPARK_RECEIVE_QUOTE_UPDATED → convert → cache.updateIfExists + pending update/remove by state (UNPAID stays)

packages/sdk/src/features/send/spark-send-change-handlers.ts
  createSparkSendQuoteChangeHandlers(sendQuoteRepo, unresolvedQuotesCache)
    → SPARK_SEND_QUOTE_CREATED → convert → cache.add
    → SPARK_SEND_QUOTE_UPDATED → convert → update/remove by state (UNPAID/PENDING stay)
```

8 factory functions, 16 events. Each returns a plain array. No React, no Supabase — repos + caches in, handlers out.

### 2. RealtimeHandler class

Subscribes to the Supabase broadcast channel and dispatches events to change handlers. Uses the SDK's existing `SupabaseRealtimeManager` for reliable reconnection.

```typescript
// packages/sdk/src/features/wallet/realtime-handler.ts

type RealtimeHandlerConfig = {
  realtimeManager: SupabaseRealtimeManager;
  handlers: DatabaseChangeHandler[];
  userId: string;
  onConnected?: () => void;
  onError?: (error: unknown) => void;
};

class RealtimeHandler {
  constructor(private config: RealtimeHandlerConfig) {}

  start(): void
  // Build channel via realtimeManager: wallet:{userId}, { private: true }
  // On broadcast event *: find matching handler, wrap handleEvent in try/catch
  //   - Errors routed to onError callback (prevents unhandled rejections in daemon)
  // On channel connected/reconnected: call onConnected
  // Subscribe through realtimeManager (gets exponential backoff, sequential resubscribe)

  stop(): void
  // Remove channel from realtimeManager, clean up
}
```

**Scope:**
- Subscribes to `wallet:${userId}` private broadcast channel (requires valid Supabase JWT)
- Dispatches `{ event, payload }` to matching handler
- Wraps `handleEvent` calls in try/catch — errors from async decryption or network failures are routed to `onError`, not thrown as unhandled rejections
- Calls `onConnected` on subscribe + reconnect (consumer uses this for cache invalidation)
- Reliable reconnection via `SupabaseRealtimeManager` (already in SDK: exponential backoff, sequential resubscribe queue)

**Out of scope (stays in web app):**
- Tab visibility tracking (`document.visibilityState`)
- `navigator.onLine` tracking
- `useSyncExternalStore` integration
- The web app's `SupabaseRealtimeManager` instance (with browser lifecycle hooks)

**Consumer responsibility:** The web app creates its own `SupabaseRealtimeManager` with browser-aware online/visibility callbacks. The CLI creates a simpler instance without those callbacks. Both pass their manager to `RealtimeHandler`.

### 3. WalletClient integration

`createWalletClient()` gains two new members:

```typescript
export type WalletClient = {
  // ... existing: caches, queries, repos, services, taskProcessors

  changeHandlers: DatabaseChangeHandler[];
  // All 16 handlers, flat array, pre-wired with wallet's repos and caches

  createRealtimeHandler(realtimeManager: SupabaseRealtimeManager): RealtimeHandler;
  // Convenience factory — pre-wires handlers + onConnected cache invalidation
  // Takes realtimeManager as param because web app uses its own instance with browser lifecycle
};
```

**`createRealtimeHandler` auto-wires:**
- All `changeHandlers` from the wallet
- `userId` from the wallet closure (not repeated in params)
- `onConnected` callback that invalidates all 11 wallet caches

### 4. Web app migration path

The web app does NOT use `RealtimeHandler` — it continues using its own `SupabaseRealtimeManager` instance with browser lifecycle hooks (tab visibility, online/offline) via `useSupabaseRealtime`. Only the handler arrays are extracted.

```typescript
// Before (use-track-wallet-changes.ts):
const accountHandlers = useAccountChangeHandlers();     // React hook
const transactionHandlers = useTransactionChangeHandlers(); // React hook
// ... 7 more hooks, each creating handlers with local repo/cache refs

// After:
const wallet = useWalletClient();
const contactHandlers = useContactChangeHandlers(); // stays web-only
// wallet.changeHandlers replaces 8 hook calls
```

The web app's `useTrackWalletChanges` shrinks to:
1. Get `wallet.changeHandlers` from `useWalletClient()` (replaces 8 `useXxxChangeHandlers` hooks)
2. Get contact change handlers (still web-app-only)
3. Combine `[...wallet.changeHandlers, ...contactHandlers]` and pass to `useTrackDatabaseChanges`
4. `onConnected` invalidates all wallet caches (via `wallet.caches.*`) + contacts cache

### 5. CLI/daemon usage

```typescript
const wallet = createWalletClient({ db, keyProvider, userId });
const realtimeManager = new SupabaseRealtimeManager(supabaseClient.realtime);
const handler = wallet.createRealtimeHandler(realtimeManager);
handler.start();
// Runs until shutdown — cache stays fresh via broadcast events
// Task processors react to cache changes automatically
handler.stop();
```

## Constraints

- **Exact same behavior.** Same event names, same state-based filtering logic, same cache operations. This is code organization, not behavior change.
- **Independently deployable.** Each step produces a working codebase.
- **Coexistence.** During migration, web app can use SDK change handlers alongside existing hooks.
- **No React in SDK.** Handler factories are plain functions. `RealtimeHandler` uses the SDK's `SupabaseRealtimeManager`.

## Execution order

1. Extract cashu send swap queries + cache classes to SDK
2. Extract cashu send swap task processor to SDK
3. Wire cashu send swap into WalletClient
4. Create 8 change handler factory files
5. Create `RealtimeHandler` class
6. Add `changeHandlers` + `createRealtimeHandler` to WalletClient
7. Thin out web app `use-track-wallet-changes.ts` to use SDK handlers
8. Export from `packages/sdk/src/index.ts`: `DatabaseChangeHandler` type, `RealtimeHandler` class, `RealtimeHandlerConfig` type, and the 8 `create*ChangeHandlers` factory functions
9. Verify: typecheck + tests
