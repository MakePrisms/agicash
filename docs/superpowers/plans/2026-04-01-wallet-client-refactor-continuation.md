# WalletClient SDK Refactor — Continuation Notes

Related docs:

- Plan: `docs/superpowers/plans/2026-04-01-wallet-client-refactor.md`
- Design: `docs/superpowers/specs/2026-04-01-wallet-client-design.md`

## Goal clarification

The real target is not just "move some hooks into the SDK." The target is:

- `@agicash/sdk` owns the wallet application core
- web app becomes React lifecycle + UI
- CLI becomes command parsing + output
- MCP comes later as a transport on top of `WalletClient`

The safest path has been slice-by-slice migration with compatibility shims left in place until the next slices land.

## Completed slices

### 1. Foundation + Cashu receive runtime entrypoint

Completed:

- added `@tanstack/query-core` to the SDK
- added `packages/sdk/src/core/query-keys.ts`
- added `packages/sdk/src/core/wallet-client.ts`
- added `packages/sdk/src/features/accounts/account-queries.ts`
- added `packages/sdk/src/features/receive/cashu-receive-queries.ts`
- added `packages/sdk/src/features/receive/cashu-receive-task-processor.ts`
- added `app/features/wallet/wallet-client.ts`
- updated `app/features/receive/cashu-receive-quote-hooks.ts` to delegate to `WalletClient`
- updated `packages/cli/src/sdk-context.ts` to build from `createWalletClient()`

What this proved:

- the `WalletClient` boundary is viable
- the web app can inject the existing React Query client
- the CLI can bootstrap from the same runtime instead of hand-wiring the graph

### 2. Accounts + Transactions consolidation

Completed:

- moved `AccountsCache` to SDK query helpers and kept `AccountsCache.Key` for compatibility
- moved transaction query helpers and `TransactionsCache` to SDK
- added `transactionQuery`, `transactionsListQuery`, `unacknowledgedTransactionsCountQuery`
- updated `app/features/accounts/account-hooks.ts` to use `WalletClient`
- updated `app/features/transactions/transaction-hooks.ts` and `transaction-repository.ts` to use `WalletClient`
- added SDK tests for wallet client and transaction query helpers

What this proved:

- app hooks can stay thin while keeping React-only options local
- centralized query keys work as long as compatibility key shapes are preserved
- some app-level helper names need to survive during migration because other files still reference them

### 3. Cashu receive swap

Completed:

- moved `PendingCashuReceiveSwapsCache` to SDK (`cashu-receive-swap-queries.ts`)
- added `pendingCashuReceiveSwapsQuery` with inline online-account filtering
- created `CashuReceiveSwapTaskProcessor` using `QueryObserver` + scope chains
- thinned `cashu-receive-swap-hooks.ts` — change handlers use `wallet.repos`, task processor is thin lifecycle wrapper

### 4. Cashu send quote

Completed:

- moved `UnresolvedCashuSendQuotesCache` to SDK (`cashu-send-quote-queries.ts`)
- added `unresolvedCashuSendQuotesQuery` with online-account filtering
- created `CashuSendQuoteTaskProcessor` with melt quote subscriptions, state machine (initiate/pending/expire/complete/fail), scope chains
- thinned `cashu-send-quote-hooks.ts` from ~500 to ~160 lines

### 6. Spark receive

Completed:

- moved `SparkReceiveQuoteCache` and `PendingSparkReceiveQuotesCache` to SDK (`spark-receive-queries.ts`)
- added `sparkReceiveQuoteQuery` and `pendingSparkReceiveQuotesQuery`
- created `SparkReceiveQuoteTaskProcessor` with dual mechanisms: Spark API polling (age-based intervals) + melt quote subscriptions for CASHU_TOKEN quotes
- thinned `spark-receive-quote-hooks.ts` from 702 to ~210 lines

### 7. Spark send

Completed:

- moved `UnresolvedSparkSendQuotesCache` to SDK (`spark-send-quote-queries.ts`)
- added `unresolvedSparkSendQuotesQuery` with online-account filtering
- created `SparkSendQuoteTaskProcessor` with Spark API polling, state tracking (`lastTriggeredState` Map), initiate/complete/fail flow
- thinned `spark-send-quote-hooks.ts` from 511 to ~165 lines

## Current WalletClient surface (after slices 1-4, 6-7)

### Queries (11)

- `listAccountsQuery()`
- `cashuReceiveQuoteQuery(quoteId?)`
- `pendingCashuReceiveQuotesQuery()`
- `pendingCashuReceiveSwapsQuery()`
- `pendingSparkReceiveQuotesQuery()`
- `sparkReceiveQuoteQuery(quoteId?)`
- `unresolvedCashuSendQuotesQuery()`
- `unresolvedSparkSendQuotesQuery()`
- `transactionQuery(transactionId)`
- `transactionsListQuery(accountId?)`
- `unacknowledgedTransactionsCountQuery()`

### Caches (9)

- `wallet.caches.accounts`
- `wallet.caches.cashuReceiveQuote`
- `wallet.caches.pendingCashuReceiveQuotes`
- `wallet.caches.pendingCashuReceiveSwaps`
- `wallet.caches.pendingSparkReceiveQuotes`
- `wallet.caches.sparkReceiveQuote`
- `wallet.caches.transactions`
- `wallet.caches.unresolvedCashuSendQuotes`
- `wallet.caches.unresolvedSparkSendQuotes`

### Task processors (5)

- `wallet.taskProcessors.cashuReceiveQuote` — websocket + polling + melt subscriptions
- `wallet.taskProcessors.cashuReceiveSwap` — QueryObserver + scope chains
- `wallet.taskProcessors.cashuSendQuote` — melt subscriptions + state machine
- `wallet.taskProcessors.sparkReceiveQuote` — Spark API polling + melt subscriptions
- `wallet.taskProcessors.sparkSendQuote` — Spark API polling + state tracking

### Repos (8)

- `accountRepo`, `cashuReceiveQuoteRepo`, `cashuReceiveSwapRepo`
- `cashuSendQuoteRepo`, `cashuSendSwapRepo`
- `sparkReceiveQuoteRepo`, `sparkSendQuoteRepo`
- `transactionRepo`

### Services (7)

- `accountService`, `cashuReceiveQuoteService`, `cashuReceiveSwapService`
- `cashuSendQuoteService`, `cashuSendSwapService`
- `sparkReceiveQuoteService`, `sparkSendQuoteService`

### Escape hatches still in use

- `wallet.repos.*` — change handlers use `repo.toQuote(payload)` / `repo.toReceiveSwap(payload)`
- `wallet.services.*` — UI mutation hooks use services directly (create quote, create swap, etc.)
- `wallet.queryClient` — some hooks still use it for cache instantiation

## Files that now act as the migration anchors

These are the main files to read before continuing:

- `packages/sdk/src/core/wallet-client.ts`
- `packages/sdk/src/core/query-keys.ts`
- `packages/sdk/src/features/accounts/account-queries.ts`
- `packages/sdk/src/features/transactions/transaction-queries.ts`
- `packages/sdk/src/features/receive/cashu-receive-queries.ts`
- `packages/sdk/src/features/receive/cashu-receive-task-processor.ts`
- `app/features/wallet/wallet-client.ts`
- `packages/cli/src/sdk-context.ts`

## Important context learned along the way

### 1. Preserve behavior at the wrapper layer, not only in the SDK query factory

The original plan focused on query keys, `staleTime`, `gcTime`, and retry. In practice, the wrappers also matter:

- `refetchOnWindowFocus`
- `refetchOnReconnect`
- `enabled`
- `select`
- `initialData`
- `refetchInterval`

The SDK should own the base query definition. The React hook should keep any React-specific behavior that is still consumer-specific.

### 2. Compatibility shims are worth keeping during migration

Examples:

- `AccountsCache.Key` is still used outside `account-hooks.ts`
- `TransactionsCache.AllTransactionsKey` and related static keys are still useful for prefix invalidation

Do not aggressively remove those compatibility surfaces until all related slices are migrated.

### 3. Share the React Query client in the web app

`useWalletClient()` should continue to receive the existing app query client so:

- cache is shared with existing hooks
- React Query DevTools still reflect real state
- invalidate/setQueryData behavior stays consistent during migration

### 4. Cleanup matters for long-lived consumers

`WalletClient.cleanup()` currently scans the query cache and best-effort calls `cleanupConnections()` on cached resources when available. This matters for Spark wallet instances and will matter again for daemon/MCP work later.

### 5. `fix:all` is not the best per-slice gate

Targeted validation has been more practical:

- `bunx --bun biome check --write <changed-files>`
- `bun run typecheck`
- targeted `bun test`
- full `bun test` at slice boundaries / risky runtime changes

`bun run fix:all` may be too broad or slow for iterative slice work in this repo.

### 6. `WalletClient` is still missing the real end-state surface

Not done yet:

- `wallet.actions.*`
- full task manager
- realtime runtime
- MCP transport

Right now `WalletClient` is a useful orchestration shell, but not the final public API.

### 7. CLI bootstrap still does one important thing outside WalletClient

`packages/cli/src/sdk-context.ts` still upserts the user through `WriteUserRepository` after wallet creation. That is currently part of bootstrap, not part of `createWalletClient()`. If this becomes shared bootstrap behavior later, it probably belongs in a higher-level initializer or explicit action, not hidden in the factory.

### 8. Parallel dispatch works for independent verticals

Slices 4, 6, and 7 were executed in parallel by 3 workers. The strategy:
- Workers create new SDK files + thin app hooks
- Workers do NOT touch wallet-client.ts or index.ts (shared files)
- Coordinator integrates: adds imports, wires type + factory, updates exports
- Conflicts are trivially additive (each adds different entries to the same locations)

This worked because:
- each slice touches a different feature directory (no file overlap)
- the pattern is well-established (workers follow existing SDK files as templates)
- the integration points (wallet-client.ts type + factory, index.ts exports) are mechanical

Biome pre-commit hook catches unused imports and formatting issues from workers.
Workers should use `catch { ... }` not `catch (error) { ... }` when error var is unused.

### 9. Watch/MCP should stay transport-only

The earlier idea of a daemon is still good, but the learned constraint is:

- build runtime in `WalletClient` first
- layer MCP on top later
- do not put business logic directly into the MCP server

## Known gaps after the completed slices

Still app-owned or only partially migrated:

- `app/features/receive/cashu-receive-swap-hooks.ts`
- `app/features/send/cashu-send-quote-hooks.ts`
- `app/features/send/cashu-send-swap-hooks.ts`
- `app/features/receive/spark-receive-quote-hooks.ts`
- `app/features/send/spark-send-quote-hooks.ts`
- `app/features/wallet/use-track-wallet-changes.ts`
- `app/features/wallet/task-processing.ts`
- `app/features/shared/spark.ts` balance tracking logic
- user/shared queries like cashu seed/xpub, spark mnemonic, encryption, etc.
- actions/mutations are still not centralized behind `wallet.actions`

## Recommended execution order from here

### 3. Finish Cashu receive vertical

Primary goal:

- finish receive-related migration before starting a new send vertical

Scope:

- move `cashu-receive-swap` queries/cache into SDK
- move `useProcessCashuReceiveSwapTasks` logic into SDK
- keep receive quote + receive swap runtime consistent
- move any remaining receive-specific change handler logic that naturally belongs with this vertical

Primary files:

- `packages/sdk/src/features/receive/cashu-receive-queries.ts`
- `packages/sdk/src/features/receive/cashu-receive-swap-task-processor.ts` (new)
- `packages/sdk/src/core/wallet-client.ts`
- `app/features/receive/cashu-receive-swap-hooks.ts`
- `app/features/wallet/use-track-wallet-changes.ts`

Done when:

- both receive quote and receive swap background flows are SDK-owned
- web receive hooks are thin wrappers/lifecycle only

Smoke:

- create lightning receive quote
- pay invoice
- quote auto-completes after reconnect/reopen
- receive cashu token to same account / compatible flow still completes

### 4. Cashu send quote vertical

Primary goal:

- move unresolved send quote query/cache + processor

Primary files:

- `app/features/send/cashu-send-quote-hooks.ts`
- SDK send query helper file (new)
- SDK send quote task processor file (new)
- `packages/sdk/src/core/wallet-client.ts`

Done when:

- unresolved quote state machine is SDK-owned
- web hook is mostly a wrapper

Smoke:

- create send quote
- pending transition
- paid transition
- expired / failed transition

### 5. Cashu send swap vertical

Primary goal:

- move swap query/cache + processor

Primary files:

- `app/features/send/cashu-send-swap-hooks.ts`
- SDK send swap query helper file (new)
- SDK send swap task processor file (new)

Done when:

- DRAFT and PENDING swap handling are SDK-owned

Smoke:

- token send completes
- retry/resume behavior still works
- reversal behavior still works

### 6. Spark receive vertical

Primary goal:

- move spark receive queries/cache/processor

Primary files:

- `app/features/receive/spark-receive-quote-hooks.ts`
- SDK spark receive query/processor files
- `app/features/shared/spark.ts` if balance invalidation hooks need updates

Smoke:

- spark receive quote lifecycle completes
- transaction invalidation still works
- spark balance refresh still behaves

### 7. Spark send vertical

Primary goal:

- move spark send queries/cache/processor

Primary files:

- `app/features/send/spark-send-quote-hooks.ts`
- SDK spark send query/processor files

Smoke:

- spark send lifecycle completes
- pending/complete/failure paths still behave

### 8. Shared and user query consolidation

Primary goal:

- move remaining shared query definitions and user query helpers into SDK

Includes:

- user query
- cashu seed/xpub queries
- mint info / keysets / test mint queries
- spark mnemonic / wallet / identity queries
- encryption key queries
- any other still-local query helper used broadly

Primary files:

- `app/features/user/user-hooks.tsx`
- `app/features/shared/cashu.ts`
- `app/features/shared/spark.ts`
- `app/features/shared/encryption.ts`
- SDK shared/user query files

Done when:

- app-side shared query helpers are mostly wrappers

### 9. Realtime/runtime consolidation

Primary goal:

- move change-handler aggregation and cache invalidation wiring toward SDK-owned runtime

Primary files:

- `app/features/wallet/use-track-wallet-changes.ts`
- `app/features/wallet/task-processing.ts`
- `packages/sdk/src/features/wallet/*`

Notes:

- lead election still matters
- web still owns browser-only lifecycle concerns
- do not break reconnect catch-up invalidation behavior

Done when:

- wallet runtime logic is mostly in SDK classes
- web keeps lifecycle + browser-specific concerns only

### 10. Extract `wallet.actions`

Primary goal:

- stop reaching through `wallet.services.*` and `wallet.repos.*` in app/CLI

This is the slice that really makes the consumers thin.

Examples to centralize:

- add cashu account
- create receive quote
- complete receive
- create send quote
- complete send
- reverse transaction
- receive token helpers

Done when:

- consumers mostly call `wallet.actions.*` and `wallet.queries.*`

### 11. MCP transport

Primary goal:

- expose `WalletClient` to agents through a long-lived transport

Important constraint:

- MCP is transport only
- `WalletClient` remains the application core

Likely prerequisite:

- finish enough runtime + action slices first so the MCP layer does not need to invent its own orchestration

## Per-slice execution playbook

For each slice:

1. define exact scope
2. list files to touch
3. move query/cache helpers into SDK
4. move processor/runtime for that slice if applicable
5. thin app wrappers
6. update CLI only if that slice already affects CLI behavior
7. add focused SDK tests
8. run the gate before moving on

Do not start two runtime slices at once.

## Validation gate to run between slices

Recommended commands:

1. targeted formatting/lint
   - `bunx --bun biome check --write <changed-files>`
2. typecheck
   - `bun run typecheck`
3. targeted tests for the slice
4. full suite at slice boundaries
   - `bun test`

Manual smoke checklist:

- affected UI flow still renders
- background processing still resumes after reload/reconnect where applicable
- transaction/account invalidation still works
- CLI help still works after bootstrap changes

## Resume checklist

When coming back to this work:

1. read this file (especially "Current WalletClient surface" and "Remaining scope assessment")
2. inspect `packages/sdk/src/core/wallet-client.ts` (type definition + factory)
3. inspect current `git status` / `git log --oneline -5`
4. pick the next unchecked slice:
   - **Slice 5** (cashu send swap) — next, depends on slice 4 (done)
   - **Slice 8** (shared/user queries) — may be skippable if CLI doesn't need them
   - **Slice 9** (realtime/runtime) — thin after all processors are SDK-owned
   - **Slices 10-11** (actions + MCP) — design work
5. for slice 5: read `app/features/send/cashu-send-swap-hooks.ts` and follow the established pattern
6. preserve compatibility shims unless the next slice removes the final caller
7. run the validation gate before pausing

## Recommended next slice

If continuing immediately, do:

- **Slice 5: Cashu send swap**

Reason:

- it completes the cashu send vertical (slice 4 already landed)
- it is the last independent feature vertical before consolidation slices
- after this, all 6 feature verticals (cashu receive quote/swap, cashu send quote/swap, spark receive, spark send) will be SDK-owned

## Remaining scope assessment

### Slice 5 — Cashu send swap (~473 lines in app, medium complexity)

Move from `app/features/send/cashu-send-swap-hooks.ts`:
- `CashuSendSwapCache` — active swap cache
- `UnresolvedCashuSendSwapsCache` — unresolved swaps cache
- Task processor: `swapForProofsToSend` (DRAFT→PENDING) + `completeSwap` (PENDING→COMPLETED) + proof state subscriptions via `ProofStateSubscriptionManager`
- Keep in app: `useCreateCashuSendSwapQuote`, `useCreateCashuSendSwap`, `useCashuSendSwap`, `useTrackCashuSendSwap`, `useUnresolvedCashuSendSwaps`, change handlers

### Slice 8 — Shared/user query consolidation (low complexity, high breadth)

Mostly about moving query option factories into SDK. Most hooks stay in app.

- `user-hooks.tsx` (249 lines): All 9 user mutation hooks stay in app. Move `userQueryOptions` base query to SDK if useful for CLI.
- `cashu.ts` (215 lines): All query option factories (`seedQueryOptions`, `xpubQueryOptions`, `mintInfoQueryOptions`, etc.) stay in app — they use `keyProvider` hooks. Already re-exports SDK functions.
- `spark.ts` (264 lines): `useTrackAndUpdateSparkAccountBalances` stays (browser lifecycle). `sparkBalanceQueryKey` already in SDK query-keys.
- `encryption.ts` (73 lines): All hooks stay in app. Already re-exports SDK functions.

**Key insight**: Slice 8 may be smaller than originally planned. Most shared helpers are already SDK re-exports or app-layer query option factories that depend on React hooks (`useKeyProvider`). The migration value is low unless CLI needs these queries.

### Slice 9 — Realtime/runtime consolidation (medium complexity)

- `use-track-wallet-changes.ts` (142 lines): Aggregates all change handlers + reconnect invalidation. Could move the handler registry pattern to SDK if CLI/MCP needs realtime.
- `task-processing.ts` (83 lines): `TaskProcessor` component calls all 6 `useProcess*Tasks()` hooks. `useTakeTaskProcessingLead` is browser-only (leader election). These stay in app but become trivially thin once all task processors are on WalletClient.

### Slices 10-11 — Actions + MCP (future, not started)

- Slice 10: Extract `wallet.actions.*` to replace `wallet.services.*` / `wallet.repos.*` escape hatches
- Slice 11: MCP transport layer on top of WalletClient

These are design work, not mechanical migration.
