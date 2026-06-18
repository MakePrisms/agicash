# Wallet SDK Variant Phase — Grounding & Roadmap

> Companion to the `wallet-sdk-extraction` memory note (read that first for full history). Captures the resolved strategic forks + the frozen seam + the per-plan surfaces so the variant-phase plans can be written without re-deriving. Written 2026-06-18 on `sdkx/base` tip `e456257b` (base + Plans 2..6c all DONE/merge-ready). **Verify the file:line refs against current code during exec — this note is point-in-time.**

## Resolved strategic forks (AskUserQuestion 2026-06-18)

1. **Build BOTH variants A and B** — the spec's empirical-comparison premise stands (the parallel `sdk-nocache/full-migration` track is independent and does NOT substitute for A; do not conflate).
2. **The deferred interactive token-receive surface = a small SHARED base plan `6d`, landed on `sdkx/base` FIRST** (before the variants), because it's variant-independent (the selection helpers already exist internally from 6c).
3. **Variants run in PARALLEL worktrees** `sdkx/stateless` (A) + `sdkx/store` (B), both off the extended base (incl. 6d). Base defect → fix in base lineage, propagate to both.

## Execution roadmap (order)

1. **Plan 6d** (shared, on `sdkx/base`): expose the interactive token-receive surface (selection + create-only claim) on `sdk.cashu.receive`. Small. OPUS for any new logic, sonnet for wrappers.
2. **Set up worktrees** off the extended base: `sdkx/stateless`, `sdkx/store` (use `git worktree add` / the EnterWorktree tool per project convention).
3. **Plan A** (`sdkx/stateless`) + **Plan B** (`sdkx/store`) in parallel. Each = `createEngine` impl + web-migration cut-over + folded 4c hardening + 6b forward-carries + tests.
4. **The eval** (6-dim rubric, spec §497-516) → empirical A-vs-B decision (spec allows a Variant C fallback).
5. **ScanDomain** — still its own later plan (deferred; messiest/most app-coupled; not on the eval path).

## The FROZEN engine seam (`packages/wallet-sdk/src/engine.ts`) — what BOTH variants implement

Each variant supplies a sync `createEngine(ctx: EngineContext) => SdkEngine`. Base owns everything downstream (ProcessorRegistry / ChangeFeed / BackgroundDomain / lock-repo / RetryPolicy concretes); `sdk.ts` wires the 4 engine fields into the 6 processors + ChangeFeed. Verbatim contract:

```ts
type SdkEngine = { runner: TaskRunner; workSets: WorkSetSource; wallets: WalletAccess; fanout: EntityFanout };
type EngineContext = { events: EventBus<SdkCoreEventMap>; runtime: WalletRuntime; config: SdkConfig };
type CreateEngine = (ctx: EngineContext) => SdkEngine;

type WorkSetSource = {  // 6 reads, online-filtered (app's useSelectItemsWithOnlineAccount)
  getUnresolvedCashuSendQuotes(userId): Promise<CashuSendQuote[]>;
  getUnresolvedCashuSendSwaps(userId): Promise<CashuSendSwap[]>;
  getUnresolvedSparkSendQuotes(userId): Promise<SparkSendQuote[]>;
  getPendingCashuReceiveQuotes(userId): Promise<CashuReceiveQuote[]>;
  getPendingCashuReceiveSwaps(userId): Promise<CashuReceiveSwap[]>;
  getPendingSparkReceiveQuotes(userId): Promise<SparkReceiveQuote[]>;
};
type WalletAccess = {  // 3 SYNC (throw if absent) + 1 async
  getCashuAccount(accountId): CashuAccount;       // resident, carries .wallet/.mintUrl/.currency/.proofs
  getSparkAccount(accountId): SparkAccount;        // resident, carries .wallet
  getCashuWalletByMint(mintUrl, currency): ExtendedCashuWallet;  // resident wallet or bare getCashuWallet(mintUrl) — for CHECKING a melt quote
  getSourceCashuWallet(mintUrl, currency): Promise<ExtendedCashuWallet>;  // resident or getInitializedCashuWallet(...); rejects NetworkError if mint offline
};
// EntityFanout = { emit(ChangeFeedChange): void; onCatchUp(): void }  (internal/realtime/change-feed-ports.ts)
// ChangeFeedChange = 11-kind tagged union (user/account/transaction/contact/contact-deleted/+6 quote-swap), each carrying the decrypted entity + version (internal/realtime/change-feed-router.ts)
```
`engine.ts` re-exports `TaskRunner, RetryPolicy, EntityFanout, ChangeFeedChange, WalletRuntime` for variant packages. `package.json` exports `./engine` + `./internal/cashu/init-wallet`. Base ships NO `createEngine` (inject-ports-no-default); without it, `sdk.background.start()` throws.

**TaskRunner contract** (`internal/tasks/task-runner.ts`): `runTask(lane, fn, policy?)` — FIFO-per-lane, concurrent across lanes, **re-entrant** (a task may enqueue another task on the SAME lane; a runner that awaits nested same-lane inline DEADLOCKS — initiate's DomainError/MintOperationError→fail path relies on this). query-core `failureCount` semantics. Lane keys (verbatim from app, the spark-receive typo already collapsed in 4c): `initiate-cashu-send-quote-${id}` (separate lane so markPending doesn't block behind in-flight initiate) ∥ `cashu-send-quote-${id}`, `send-swap-${id}`, `spark-send-quote-${id}`, `cashu-receive-quote-${id}`, `receive-swap-${tokenHash}`, `spark-receive-quote-${id}`.

## Plan 6d surface (shared, lands on base first)

The selection helpers already exist INTERNAL (from 6c, `internal/services/receive-cashu-token-service.ts`): instance `getSourceAndDestinationAccounts(token, accounts)`, static `getDefaultReceiveAccount(source, possibleDest, preferredId?)`; models `CashuAccountWithTokenFlags`/`ReceiveCashuTokenAccount`/`TokenFlags` in `internal/services/receive-cashu-token-models.ts`. The create-only path = the app's inline mutation in `receive-cashu-token.tsx` (same-account → `cashuReceiveSwapService.create` → `{swap.transactionId}`; cross-account → `receiveCashuTokenQuoteService.createCrossAccountReceiveQuotes` → `{lightningReceiveQuote.transactionId}`; returns `{transactionId, account}`; **NO melt, NO complete** — background finalizes). Contrast: 6c's `receiveToken` is the deep-link FULL-INLINE path (melts+completes).

**Proposed 6d surface on `sdk.cashu.receive` (confirm the forks below at exec):**
- `getTokenAccounts({ token, preferredReceiveAccountId? }) → { sourceAccount, possibleDestinationAccounts, defaultReceiveAccount }` — reads accounts internally (getAllActive + AccountService.getExtendedAccounts), wraps the internal selection service. Barrel-export the returned `*WithTokenFlags` types.
- A create-only claim method (name TBD) `({ token, sourceAccount, destinationAccount }) → { transactionId, account }` — same-account `swap.create` / cross-account `createCrossAccountReceiveQuotes`, no melt/complete, throw on failure.

**6d OPEN FORKS to confirm (warm or at exec):** (a) method NAMES (avoid clashing with `receiveToken`; e.g. `getTokenAccounts` + `prepareTokenClaim`/`createTokenClaim`); (b) does create-only add the unknown destination account (app's `addAndSetReceiveAccount`) + setDefault, or does the host pass a resolved/added account? (the app UI adds-on-select but does NOT setDefault on this path — only the headless claimToken setDefaults); (c) account-list read internal-Promise vs accept `accounts` param (internal keeps it variant-independent); (d) whether to also expose the token-claimable-proofs check (`useCashuTokenWithClaimableProofs` → `getUnspentProofsFromToken`/`getClaimableProofs` from `@agicash/cashu`) or leave it app-side. The interactive UI consumers to satisfy: `useReceiveCashuTokenAccounts`, `useCreateCrossAccountReceiveQuotes`, `useCreateCashuReceiveSwap`, `useCashuTokenSourceAccountQuery`, `useCashuTokenWithClaimableProofs`.

## Variant A (`sdkx/stateless`) specifics

- **runner** = in-memory KeyedQueue: `Map<lane, tail-promise>` chained via `.then(run, run)`, lane GC, a retry loop calling `policy.shouldRetry(count, err)` pre-increment, the two-lane send-quote split preserved, re-entrant (no inline await of nested same-lane task).
- **workSets** = DB-on-demand over `runtime.protocols.*Repository.getUnresolved*/getPending*(userId)` + online filter via the resident accounts.
- **fanout.emit** = map the 11-kind `ChangeFeedChange` → A-only ROW events (`<entity>:created|updated|deleted`) on a WIDER `EventBus<SdkEventMapA>` (A-only entity events with explicit created/updated — user rejected "upserted"); `fanout.onCatchUp` = emit A-only `connection:resync` (NOT on `SdkCoreEventMap`).
- **wallets** = resident account map (fed by `accountRepository.getAllActive` on leader-activate + `account:*` events — needed because `getCashuAccount`/`getSparkAccount` are SYNC) + `getCashuWalletByMint`/`getSourceCashuWallet` fallbacks over `runtime.mintCache`/`getInitializedCashuWallet`.
- **read surface** = Promise (consumes the shared facade as-is).
- **web-migration** = KEEP the app's ~13 TanStack Cache classes + change handlers, but rewire them to `sdk.on('<entity>:updated', …)` (the decrypt/`repo.toX` step is gone — SDK emits decrypted entities); replace `use-track-wallet-changes` channel with `sdk.on`; `connection:resync` → invalidate-all; thin `useMutation` wrappers call `sdk.*`.

## Variant B (`sdkx/store`) specifics

- The dynamic-mutation-scope query-core patch **ALREADY EXISTS in-repo**: `@tanstack/query-core@5.90.20` + `patches/@tanstack%2Fquery-core@5.90.20.patch` (19KB; per-`mutate()` `scope` override), `package.json` pin, `bun.lock` single resolved copy (app's `react-query@5.90.20`).
- **runner** = ONE MutationObserver + patched dynamic scope (lane → `scope.id`) → query-core `MutationCache.canRun/runNext` gives FIFO-per-scope + concurrency + re-entrancy FREE.
- **Store<T>** = `{ get(): T|undefined (undefined=not-loaded; []/null=empty; referentially stable for useSyncExternalStore), subscribe, toPromise()=fetchOptimistic }` wrapping a QueryObserver; 7 resident stores seeded on `background.start` (nothing mounts observers headless), refetched on `onCatchUp`.
- **workSets** = store reads + online filter. **fanout.emit** = version-gated store upsert (write SYNC — base calls `fanout.emit` BEFORE the processor trigger); `transaction` kind = no-op (no tx store). **fanout.onCatchUp** = refetch stores.
- All TanStack confined to NEW `packages/wallet-sdk/src/internal/engine/` dir; **seams-rule biome lint** `noRestrictedImports` on `@tanstack/*` with an `internal/engine/**` override (biome `noRestrictedImports` is in `nursery`); move the patch decl + version pin + a **CI single-copy assertion** into/with the SDK; explicit headless `defaultOptions` (node `isServer` flips retry→0/gcTime→Infinity — set finite).
- **web-migration** = `WalletSdkProvider` + `useStore`/`useStoreSuspense` (throw `store.toPromise()` → preserves root Suspense)/`useStoreSelect`; DELETE the Cache classes/queryOptions/change handlers; app keeps its own QueryClient for UI-only (feature-flags, rates polling) + the transactions infinite list.

## Shared web-glue (identical modulo the `createEngine` import) — the cut-over surface (verify file:line at exec)

- Build `SdkConfig` from app env (LAN-rewrite `getSupabaseUrl()` done APP-side before passing `supabase.url` — SDK never touches window). `Sdk.create({createEngine})` replaces `entry.client.tsx` configure + `database.client.ts` + `supabase-session.ts`.
- `auth.ts` → `sdk.auth` 1:1 (session-expiry `useHandleSessionExpiry` DELETED → SDK handles + emits `auth:session-expired`; host keeps redirect/Sentry/`queryClient.clear` off events).
- `<Wallet>` mount (auth-gated, `_protected.tsx:254-266`) = `background.start/stop` boundary.
- **Host MUST forward online/offline/visibilitychange → `sdk.background.setOnlineStatus/setActiveStatus`** (the #1 4b/4c carry-forward; port `supabase-realtime-hooks.ts:126-144` verbatim) + wire `sdk.resync()` to focus/online; `dispose` on signout/unmount.
- BOTH variants: transactions stay an app `useInfiniteQuery` (queryFn → `sdk.transactions.list`), NOT a store (verbatim SWR config preserved).
- DELETE the app's now-duplicated TanStack copies of the services/repos extracted in 3a/3b/6a/6b/6b-ops/6c (incl. the 3 token-claim orchestrators + their hooks + the create-only UI mutation, rewired onto 6d + `sdk.cashu.receive.receiveToken`).

## Fold into BOTH variants (deferred from 4c / 6b)

- **4c leader-lifecycle hardening:** (i) leader-epoch guard in `processor.reload` (registry bumps epoch on activate/deactivate; reload drops its result if epoch changed); (ii) explicit NUT-17 WS close on `deactivate` (the cashu mint/melt managers' `dispose` clears timers only, not the socket).
- **6b forward-carries:** the variant accounts adapter must (i) re-add `getDefault`'s first-account-of-currency fallback (the app's `useDefaultAccount`; load-bearing for the multi-tab new-default race, app `account-hooks.ts:431-433`); (ii) pass `user.defaultCurrency` to `suggestFor` (the app's `useAccountOrDefault`).

## Eval rubric (spec §497-516) + test contract (spec §488-495)

6 dims: web-integration diff, headless ergonomics, SDK readability, behavior parity (pay→live balance; 2-tab leader; kill-leader-mid-flow; reconnect resync; out-of-order events don't regress), runtime (A's DB read amplification, startup, memory, bundle), debuggability. Tests: ported state-machine + lane-serialization + version-gate + reconnect-resync + leader-election multi-instance + headless smoke; B adds store-first-load/referential-stability/seeding-under-isServer; A adds cache/event-wiring.

## Standing constraints (carry to every variant-phase session)

- Gate = `bun run typecheck` + `bun run test`, **NEVER `fix:all`** (reviewers too; discard pollution `git checkout -- .`; every subagent prompt carries a loud ⛔ fix:all prohibition).
- OPUS implementer/reviewer on new-logic (the runner impls, the web cut-overs, the holistic); sonnet on mechanical wrappers. Subagent-driven; resume ledger at `.git/worktrees/sdk-extraction-fable/sdd/progress.md`.
- The web-migration is app-integration work that can't be fully validated headless — flag where browser/live-app verification is owed (use the `verify`/`run` skills + Chrome DevTools MCP).
- Do NOT push `sdkx/base` (3b..6c, +6d) autonomously — gated on the Breez connect smoke (`VITE_BREEZ_API_KEY` + regtest), live realtime validation, `/lnurl-test`, + user nod. The two variant PRs derive from the extended base.
- Spec: `docs/superpowers/specs/2026-06-11-wallet-sdk-two-variant-design.md`. Engine seam: `packages/wallet-sdk/src/engine.ts`. Do NOT conflate with the independent `sdk-nocache/full-migration` track.
