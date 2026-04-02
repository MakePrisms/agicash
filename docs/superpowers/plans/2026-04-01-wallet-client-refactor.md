# WalletClient SDK Refactor — Proof of Concept Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the SDK boundary from "portable pure logic" to "application core (logic + orchestration + queries)." The SDK owns all query definitions, cache management, task processing, and realtime handlers. Consumers (web app, CLI) own only initialization + rendering/output. Includes a CLI `watch` command as a daemon proof-of-concept.

**Architecture:** SDK gains `@tanstack/query-core` and exposes a `createWalletClient()` factory that returns pre-bound query factories, task processors, and a `QueryClient`. Web app hooks become thin wrappers. CLI commands use the same queries directly. A `watch` command runs task processors as a foreground daemon.

**Branch:** `agicash-cli` (proof of concept — will be ported to clean worktree later)

**Spec:** `docs/superpowers/specs/2026-04-01-wallet-client-design.md`

---

## Scope

### What moves to SDK

| Category | Count | Examples |
|----------|-------|---------|
| Named queryOptions | ~15 | `accountsQueryOptions`, `userQueryOptions`, `seedQueryOptions` |
| Inline query configs | ~35 | `useQuery({ queryKey: [...], queryFn: ... })` patterns |
| Cache classes | ~10 | `AccountsCache`, `TransactionsCache`, `CashuReceiveQuoteCache` |
| Task processors | 6 | `useProcessCashuReceiveQuoteTasks`, `useProcessCashuSendQuoteTasks`, etc. |
| Realtime handlers | ~5 | `useContactChangeHandlers`, `useCashuReceiveQuoteChangeHandlers` |
| KeyProvider-dependent queries | ~6 | `seedQueryOptions`, `sparkMnemonicQueryOptions`, encryption keys |

### What stays consumer-specific

- **Web app:** React hooks (thin wrappers), Zustand stores for UI flow, browser APIs, Sentry, theme
- **CLI:** Command parsing, terminal output, .env loading, `watch` daemon loop
- **Both:** Initialization (KeyProvider implementation, Supabase client creation)

---

## Constraints

- **No behavior changes.** Same query keys, staleTime, gcTime, retry counts.
- **Independently deployable.** Each phase produces a working codebase.
- **Coexistence.** During migration, web app hooks can use SDK queries alongside existing code.
- **No React in SDK.** SDK uses `@tanstack/query-core` only. Query factories return plain `{ queryKey, queryFn, staleTime }` objects (the `queryOptions()` type helper is React-specific).

---

## Phase 1: Foundation

### Task 1: Add `@tanstack/query-core` to SDK, create query keys + WalletClient type

**Files:**
- Modify: `packages/sdk/package.json`
- Create: `packages/sdk/src/core/query-keys.ts`
- Create: `packages/sdk/src/core/wallet-client.ts` (type + factory)
- Modify: `packages/sdk/src/index.ts`

**Steps:**

- [ ] Add `@tanstack/query-core` as explicit SDK dependency (already in node_modules as transitive dep)
- [ ] Create `query-keys.ts` — centralized key factories matching ALL existing web app keys. Read every hook file to extract exact key values. Include: accounts, user, transactions, cashu (seed, xpub, mintInfo, keysets), spark (mnemonic, wallet, balance, identity), receive quotes/swaps, send quotes/swaps.
- [ ] Create `wallet-client.ts` — `WalletClientConfig` type (db, keyProvider, userId, optional queryClient) and `createWalletClient()` factory. Initially wires up: QueryClient, encryption, repos, services, and returns pre-bound query factories for accounts only.
- [ ] Export from index.ts
- [ ] Verify: `bun run fix:all` passes

---

### Task 2: Move account queries to SDK

**Files:**
- Create: `packages/sdk/src/features/accounts/account-queries.ts`
- Modify: `app/features/accounts/account-hooks.ts` (thin wrapper)

**Steps:**

- [ ] Read `app/features/accounts/account-hooks.ts` thoroughly — extract `accountsQueryOptions`, `AccountsCache`, and all inline query patterns
- [ ] Create `account-queries.ts` — export `listAccountsQuery(wallet)`, `getAccountQuery(wallet, id)`. These return plain queryOptions objects with exact same keys and staleTime.
- [ ] Move `AccountsCache` class to SDK (it's already a plain class, just needs to move)
- [ ] Update web app hooks to use SDK queries: `useSuspenseQuery(listAccountsQuery(wallet))`
- [ ] Verify web app still works: `bun run fix:all`

---

### Task 3: Move user, transaction, and shared queries to SDK

**Files:**
- Create: `packages/sdk/src/features/user/user-queries.ts`
- Create: `packages/sdk/src/features/transactions/transaction-queries.ts`
- Create: `packages/sdk/src/features/shared/cashu-queries.ts`
- Create: `packages/sdk/src/features/shared/spark-queries.ts`
- Modify: corresponding web app hook files

**Steps:**

- [ ] Read each web app hook file, extract all query definitions
- [ ] `user-queries.ts` — `userQuery(wallet)`
- [ ] `transaction-queries.ts` — `transactionQuery(wallet, id)`, `transactionsListQuery(wallet, opts)`, `unacknowledgedCountQuery(wallet)`. Move `TransactionsCache`.
- [ ] `cashu-queries.ts` — `cashuSeedQuery(keyProvider)`, `cashuXpubQuery(keyProvider, path)`, `mintInfoQuery(mintUrl)`, `mintKeysetsQuery(mintUrl)`, `isTestMintQuery(mintUrl)`. These take `KeyProvider` not the full wallet (they don't need repos).
- [ ] `spark-queries.ts` — `sparkMnemonicQuery(keyProvider)`, `sparkWalletQuery(mnemonic, network)`, `sparkBalanceQuery(wallet, accountId)`, `sparkIdentityPublicKeyQuery(keyProvider, network)`.
- [ ] Update web app hooks to thin wrappers
- [ ] Verify: `bun run fix:all`

---

## Phase 2: Receive + Send Queries

### Task 4: Move cashu receive queries to SDK

**Files:**
- Create: `packages/sdk/src/features/receive/cashu-receive-queries.ts`
- Modify: `app/features/receive/cashu-receive-quote-hooks.ts`
- Modify: `app/features/receive/cashu-receive-swap-hooks.ts`

**Steps:**

- [ ] Extract: `cashuReceiveQuoteQuery`, `pendingCashuReceiveQuotesQuery`, `pendingCashuReceiveSwapsQuery`
- [ ] Move: `CashuReceiveQuoteCache`, `PendingCashuReceiveQuotesCache`, `PendingCashuReceiveSwapsCache`
- [ ] Update web app hooks
- [ ] Verify: `bun run fix:all`

---

### Task 5: Move cashu send queries to SDK

**Files:**
- Create: `packages/sdk/src/features/send/cashu-send-queries.ts`
- Modify: `app/features/send/cashu-send-quote-hooks.ts`
- Modify: `app/features/send/cashu-send-swap-hooks.ts`

**Steps:**

- [ ] Extract: `unresolvedCashuSendQuotesQuery`, `cashuSendSwapQuery`, `unresolvedCashuSendSwapsQuery`
- [ ] Move: `UnresolvedCashuSendQuotesCache`, `CashuSendSwapCache`, `UnresolvedCashuSendSwapsCache`
- [ ] Update web app hooks
- [ ] Verify: `bun run fix:all`

---

### Task 6: Move spark receive + send queries to SDK

**Files:**
- Create: `packages/sdk/src/features/receive/spark-receive-queries.ts`
- Create: `packages/sdk/src/features/send/spark-send-queries.ts`
- Modify: `app/features/receive/spark-receive-quote-hooks.ts`
- Modify: `app/features/send/spark-send-quote-hooks.ts`

**Steps:**

- [ ] Extract all spark quote/swap queries
- [ ] Move cache classes
- [ ] Update web app hooks
- [ ] Verify: `bun run fix:all`

---

## Phase 3: Task Processors

### Task 7: Extract cashu receive task processor

**Files:**
- Create: `packages/sdk/src/features/receive/cashu-receive-task-processor.ts`
- Modify: `app/features/receive/cashu-receive-quote-hooks.ts`

This is the most complex processor (~250 lines of state machine logic in the hook).

**Steps:**

- [ ] Read `useProcessCashuReceiveQuoteTasks` thoroughly — understand the full state machine: find pending → subscribe (WebSocket + poll fallback) → on paid: completeReceive → on expired: expire → on issued: completeReceive
- [ ] Create `CashuReceiveTaskProcessor` class:
  - `constructor(queryClient, cashuReceiveQuoteService, cashuReceiveQuoteRepo, accountRepo, mintQuoteSubscriptionManager, meltQuoteSubscriptionManager)`
  - `start(userId)` — queries pending, sets up subscriptions and expiry timeouts
  - `stop()` — unsubscribes, clears timeouts
  - EventEmitter: `on('receive:minted')`, `on('receive:expired')`, `on('error')`
- [ ] Same retry logic: 3 retries, no retry on MintOperationError
- [ ] Same subscription reuse logic from MintQuoteSubscriptionManager
- [ ] Same expiry timeout logic
- [ ] Web app hook becomes: `useEffect(() => { processor.start(userId); return () => processor.stop(); }, [])`
- [ ] Verify: `bun run fix:all`

---

### Task 8: Extract cashu send quote task processor

**Files:**
- Create: `packages/sdk/src/features/send/cashu-send-quote-task-processor.ts`
- Modify: `app/features/send/cashu-send-quote-hooks.ts`

**Steps:**

- [ ] Read `useProcessCashuSendQuoteTasks` — state machine: find unresolved → subscribe melt quotes → on UNPAID+UNPAID: initiateSend → on PENDING: markPending → on PAID: completeSend → on EXPIRED: expire
- [ ] Create `CashuSendQuoteTaskProcessor` class with same pattern
- [ ] Web app hook wraps it
- [ ] Verify: `bun run fix:all`

---

### Task 9: Extract cashu send swap task processor

**Files:**
- Create: `packages/sdk/src/features/send/cashu-send-swap-task-processor.ts`
- Modify: `app/features/send/cashu-send-swap-hooks.ts`

**Steps:**

- [ ] Read `useProcessCashuSendSwapTasks` — two paths: DRAFT swaps (trigger swapForProofsToSend) and PENDING swaps (subscribe proof states, complete when all spent)
- [ ] Create `CashuSendSwapTaskProcessor` class using ProofStateSubscriptionManager
- [ ] Web app hook wraps it
- [ ] Verify: `bun run fix:all`

---

### Task 10: Extract cashu receive swap task processor

**Files:**
- Create: `packages/sdk/src/features/receive/cashu-receive-swap-task-processor.ts`
- Modify: `app/features/receive/cashu-receive-swap-hooks.ts`

**Steps:**

- [ ] Read `useProcessCashuReceiveSwapTasks` — find PENDING swaps → trigger completeSwap for each
- [ ] Create `CashuReceiveSwapTaskProcessor` class (simplest processor — just completes pending swaps)
- [ ] Web app hook wraps it
- [ ] Verify: `bun run fix:all`

---

### Task 11: Extract spark task processors

**Files:**
- Create: `packages/sdk/src/features/receive/spark-receive-task-processor.ts`
- Create: `packages/sdk/src/features/send/spark-send-task-processor.ts`
- Modify: corresponding web app hooks

**Steps:**

- [ ] Read spark receive/send hooks, extract processors
- [ ] Create classes following same pattern
- [ ] Verify: `bun run fix:all`

---

### Task 12: Create TaskManager

**Files:**
- Create: `packages/sdk/src/features/wallet/task-manager.ts`
- Modify: `packages/sdk/src/index.ts`
- Add to `WalletClient` type

**Steps:**

- [ ] Create `TaskManager` class that coordinates all 6 processors:
  - `start(userId)` — starts all processors
  - `stop()` — stops all processors
  - Forwards all events from individual processors
  - EventEmitter: `on('receive:minted')`, `on('send:completed')`, `on('swap:completed')`, `on('error')`
- [ ] Wire into `createWalletClient()` — `wallet.taskManager`
- [ ] Verify: `bun run fix:all`

---

## Phase 4: Realtime Handlers + CLI Watch

### Task 13: Extract realtime change handlers to SDK

**Files:**
- Create: `packages/sdk/src/features/wallet/realtime-handler.ts`
- Modify: web app hooks that use `useCashuReceiveQuoteChangeHandlers`, etc.

**Steps:**

- [ ] Read the realtime handler hooks — they subscribe to Supabase channel `wallet:{userId}` and invalidate specific caches on events
- [ ] Create `RealtimeHandler` class:
  - `constructor(queryClient, supabaseClient, userId)`
  - `start()` — subscribes to Supabase channel, wires event → cache invalidation
  - `stop()` — unsubscribes
- [ ] This is the same logic as the hooks, just without React lifecycle
- [ ] Web app: `useEffect(() => { handler.start(); return () => handler.stop(); }, [])`
- [ ] Verify: `bun run fix:all`

---

### Task 14: CLI `watch` command

**Files:**
- Create: `packages/cli/src/commands/watch.ts`
- Modify: `packages/cli/src/main.ts`

**Steps:**

- [ ] Create `watch` command that:
  1. Gets SDK context (auth required)
  2. Creates `WalletClient` (or uses existing sdk-context)
  3. Starts `wallet.taskManager`
  4. Optionally starts `RealtimeHandler`
  5. Logs events to stdout as JSON
  6. Runs until SIGINT (Ctrl+C), then calls `stop()`
- [ ] Add flags: `--receive`, `--send` to filter which processors run
- [ ] Add to HELP_TEXT: `'watch': 'Watch pending quotes and auto-complete (foreground daemon)'`
- [ ] Verify: `bun test` + manual smoke test

---

## Phase 5: Cleanup

### Task 15: Replace Cache interface with QueryClient

**Files:**
- Modify: `packages/sdk/src/interfaces/cache.ts` (deprecate or remove)
- Modify: 5 SDK files that use `Cache` interface
- Remove: `app/lib/cache-adapter.ts`

**Steps:**

- [ ] Update `AccountRepository`, `getInitializedCashuWallet`, `getInitializedSparkWallet`, `ReceiveCashuTokenService`, `ClaimCashuTokenService` to accept `QueryClient` instead of `Cache`
- [ ] Remove `cache-adapter.ts` from web app
- [ ] Remove `Cache` interface (or keep as deprecated alias)
- [ ] Update `createWalletClient` to pass QueryClient directly
- [ ] Verify: `bun run fix:all`

---

### Task 16: Final verification + update WalletClient factory

**Steps:**

- [ ] Verify all queries are in SDK (grep web app for `queryOptions(` and `queryKey:` — should only find thin wrappers)
- [ ] Verify all task processors are in SDK (grep for `useProcess` — should only find wrapper hooks)
- [ ] Verify cache classes are in SDK
- [ ] `bun run fix:all` clean
- [ ] `bun test` passes in all packages
- [ ] CLI smoke test: `auth guest → mint add → receive → send → balance → watch`
- [ ] Commit everything

---

## Critical rule

**Exact same behavior.** If a query has `staleTime: Infinity` today, it has `staleTime: Infinity` after migration. If a processor retries 3 times today, it retries 3 times after. This is a code organization refactor, not a behavior change.
