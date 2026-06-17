# Wallet-SDK Base Plan 4c — Processors + Leader Election + Engine Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the six background task processors, leader election (`BackgroundDomain`), and the `Sdk` engine-injection seam to `@agicash/wallet-sdk`, wiring the 4b `ChangeFeed` into the background lifecycle so a leader instance drives all wallet state transitions.

**Architecture:** The 4b `ChangeFeed` (realtime) runs on **every** instance (follower + leader) for cache/store freshness + lifecycle events. The six processors + their NUT-17/Breez subscriptions (the 4a trackers) run on the **leader only**, selected by the `take_lead` 6s DB lease polled every 5s. Base ships the orchestration (processors, registry, `BackgroundDomain`, lock repo) behind three injected ports — `TaskRunner` (4a), `WorkSetSource` + `WalletAccess` (4c), `EntityFanout` (4b) — supplied by a variant via `Sdk.create(config, { createEngine })`. Without an engine the SDK has no background processing (the accepted "inject ports, no base default" decision).

**Tech Stack:** TypeScript (NodeNext/Bundler), `bun:test`, `@agicash/breez-sdk-spark` (Node build, headless), `@cashu/cashu-ts`, `@supabase/realtime-js` (transitive).

---

## ⛔ Gate discipline (read before every task)

- **The gate is `bun run typecheck` + `bun run test`. NEVER run `bun run fix:all`.** `fix:all` is `biome check --write` — it reorders imports across the *entire* repo (80+ files) and pollutes the working tree. A reviewer did this in 4a and corrupted 91 files. **Every subagent prompt must carry this prohibition.** If pollution appears, recover with `git checkout -- .` (all task work is committed, so this is safe).
- Per-task fast gate (run from repo root): `cd packages/wallet-sdk && bun run typecheck && bun run test` then `cd -`. `typecheck` = `tsc`; `test` = `bun test --pass-with-no-tests`.
- The **final task** runs the full-repo gate: `bun run typecheck && bun run test` (8 packages; expect wallet-sdk + new 4c tests + web-wallet 57, 0 fail).
- New-logic tasks (3, 13) and the holistic review get a **dedicated OPUS quality-reviewer** subagent. Copy/port tasks get a sonnet spec-reviewer.

---

## Context: landed APIs this plan builds on (verified 2026-06-17)

**4a — `internal/tasks/` + trackers** (all `internal/`, headless, no React):
- `task-runner.ts`: `export type TaskRunner = { runTask<T>(lane: string, fn: () => Promise<T>, policy?: RetryPolicy): Promise<T> }` — **port only, no impl** (variant injects).
- `retry-policy.ts`: `export type RetryPolicy = { shouldRetry: (failureCount: number, error: unknown) => boolean; retryDelay: (failureCount: number) => number }`. `classifyRetry(maxAttempts)` → `ConcurrencyError`=retry / `DomainError`+`MintOperationError`=never / else `failureCount<maxAttempts`. `defaultRetryPolicy` = `classifyRetry(3)` + `exponentialBackoff`. `subscriptionRetryPolicy` = `classifyRetry(5)`. `exponentialBackoff(n)` = `min(1000·2ⁿ, 30000)`.
- `internal/cashu/mint-quote-tracker.ts`: `MintQuoteTracker` — `update(quotes: MintQuoteTrackerQuote[], deps: MintQuoteTrackerDeps): void` + `dispose()`. `MintQuoteTrackerQuote = { quoteId; accountId; mintUrl; currency: Currency; state: string; expiresAt: string }`. `MintQuoteTrackerDeps = { getWallet: (accountId) => ExtendedCashuWallet; onUpdate: (mintQuote: MintQuoteBolt11Response) => void }`. **Classification is the caller's job** (raw `onUpdate`).
- `internal/cashu/melt-quote-tracker.ts`: `MeltQuoteTracker` — `update(quotes: MeltQuoteTrackerQuote[], deps): void` + `removeQuoteFromSubscription({ mintUrl, quoteId })` + `dispose()`. `MeltQuoteTrackerQuote = { id; mintUrl; currency: Currency; expiryInMs: number; inputAmount: number }`. Deps (renamed in Task 4): `{ getWallet: (mintUrl, currency) => ExtendedCashuWallet; onUnpaid?; onPending?; onPaid?; onExpired? }` (each `(meltQuote: MeltQuoteBolt11Response) => void`). Classifies internally.
- `internal/cashu/proof-state-tracker.ts`: `ProofStateTracker` — `update(swaps: PendingCashuSendSwap[], deps: { getMintUrl: (accountId) => string; onSpent: (swap: CashuSendSwap) => void }): void` + `dispose()` (no-op).
- `internal/spark/spark-event-bridge.ts`: `SparkSendStateTracker` — `update(sendQuotes: SparkSendQuote[], deps: { getWallet: (accountId) => BreezSdk; onUnpaid: (q) => void; onCompleted: (q, { paymentPreimage }) => void; onFailed: (q, reason: string) => void }): void` + `dispose()`. `SparkReceiveStateTracker` — `update(pendingQuotes: SparkReceiveQuote[], deps: { getWallet: (accountId) => BreezSdk; onCompleted: (quoteId, { sparkTransferId; paymentPreimage }) => void; onExpired: (quoteId) => void }): void` + `dispose()`. Both per-quote-dedup internally.

**4b — `internal/realtime/`:**
- `change-feed.ts`: `ChangeFeed` ctor `{ manager; events; routerDeps: ChangeFeedRouterDeps; fanout: EntityFanout; trigger: ProcessorTrigger }`; `start(userId): Promise<void>` (idempotent); `resync(): void`; `stop(): Promise<void>`; `dispose = stop.bind(this)`.
- `change-feed-ports.ts`: `EntityFanout = { emit(change: ChangeFeedChange): void; onCatchUp(): void }`; `ProcessorTrigger = { onEntityChange(change: ChangeFeedChange): void; onCatchUp(): void }`.
- `change-feed-router.ts`: `ChangeFeedChange` discriminated union with `kind` ∈ `user | account | transaction | contact | contact-deleted | cashu-send-quote | cashu-send-swap | cashu-receive-quote | cashu-receive-swap | spark-send-quote | spark-receive-quote`; the six quote/swap kinds carry `{ operation: 'created'|'updated'; entity }`. `ChangeFeedRouterDeps` = `Pick<...>` of the 8 repo converters + `domain: string`.
- `supabase-realtime-manager.ts`: `SupabaseRealtimeManager` — `setOnlineStatus(isOnline): void`, `setActiveStatus(isActive): void`, `subscribe`, `removeChannel`, etc. (initial state online=true, active=true).
- `realtime-client.ts`: `createRealtimeManager(db: AgicashDb): SupabaseRealtimeManager`.

**3a/3b — `internal/`:**
- `wallet-runtime.ts`: `WalletRuntime = { encryption; cashuCryptography; mintCache: MintDataCache; mintAuth; sparkWallets: SparkWalletManager; accountRepository: AccountRepository; defaultAccountRepository; accountService; protocols: ProtocolServices; dispose(): Promise<void> }`. `createWalletRuntime(deps): WalletRuntime`.
- `protocol-services.ts`: `ProtocolServices` carries the 8 repos + 7 services (names: `cashuSendQuoteService`, `cashuSendSwapService`, `sparkSendQuoteService`, `cashuReceiveQuoteService`, `cashuReceiveSwapService`, `sparkReceiveQuoteService`, `transferService`; repos `cashuSendQuoteRepository`…`contactRepository`).
- Service signatures (the state-transition methods processors call):
  - `CashuSendQuoteService`: `markSendQuoteAsPending(quote)`, `completeSendQuote(account, sendQuote, meltQuote)`, `failSendQuote(account, quote, reason) → CashuSendQuote`, `expireSendQuote(quote)`, `initiateSend(account, sendQuote, meltQuote: Pick<MeltQuoteBolt11Response,'quote'|'amount'>) → MeltProofsResponse`.
  - `CashuSendSwapService`: `swapForProofsToSend({ account, swap })`, `complete(swap)`.
  - `SparkSendQuoteService`: `initiateSend({ account, sendQuote }) → SparkSendQuote`, `complete(quote, paymentPreimage)`, `fail(quote, reason)`.
  - `CashuReceiveQuoteService`: `completeReceive(account, quote) → { quote; account; addedProofs }`, `expire(quote)`, `fail(quote, reason)`, `markMeltInitiated(quote & { type: 'CASHU_TOKEN' })`. **No service wrapper for the token melt** — call `wallet.meltProofsIdempotent(...)` directly.
  - `CashuReceiveSwapService`: `completeSwap(account, receiveSwap) → { swap; account; addedProofs }`.
  - `SparkReceiveQuoteService`: `complete(quote, paymentPreimage, sparkTransferId)`, `expire(quote)`, `fail(quote, reason)`, `markMeltInitiated(quote & { type: 'CASHU_TOKEN' })`.
- Wallet resolution helpers: `getInitializedCashuWallet({ mintCache, mintUrl, currency, bip39seed?, authProvider? }) → Promise<{ wallet: ExtendedCashuWallet; isOnline: boolean }>` (`internal/cashu/init-wallet.ts`). `getCashuWallet(mintUrl, options?) → ExtendedCashuWallet` (`internal/cashu/wallet.ts`, already public). `SparkWalletManager.getWallet(network) → Promise<{ wallet: BreezSdk; balance; isOnline }>`.
- `domains/account-types.ts`: `Account` discriminated by `type`. `CashuAccount` carries `wallet: ExtendedCashuWallet`, `mintUrl`, `currency`, `isOnline`, `proofs`. `SparkAccount` carries `wallet: BreezSdk`, `network`, `currency`, `isOnline`.

**Plan 2:**
- `sdk.ts`: `Sdk.create(config, deps?)`; `walletRuntimeKey` symbol; `readonly auth/user`; `on`/`resync` (no-op)/`dispose`. `getCurrentUserId` already built in `create` (async, via `os.fetchUser()`).
- `events.ts`: `SdkCoreEventMap` already has `'background:state': { state: BackgroundState }`; `BackgroundState = 'stopped'|'starting'|'follower'|'leader'|'stopping'`.
- `domains/auth.ts`: `AuthDomain` emits `auth:signed-in`/`auth:signed-out`/`auth:session-expired`.

**App sources to port (logic-of-truth — the implementer reads these):**
- `apps/web-wallet/app/features/send/cashu-send-quote-hooks.ts` → `useProcessCashuSendQuoteTasks` (lines 256-508)
- `apps/web-wallet/app/features/send/cashu-send-swap-hooks.ts` → `useProcessCashuSendSwapTasks` (lines 393-466)
- `apps/web-wallet/app/features/send/spark-send-quote-hooks.ts` → `useProcessSparkSendQuoteTasks` (lines 386-531)
- `apps/web-wallet/app/features/receive/cashu-receive-quote-hooks.ts` → `useProcessCashuReceiveQuoteTasks` (lines 576-822) + `useOnMintQuoteStateChange` classification (lines 521-574)
- `apps/web-wallet/app/features/receive/cashu-receive-swap-hooks.ts` → `useProcessCashuReceiveSwapTasks` (lines 148-190)
- `apps/web-wallet/app/features/receive/spark-receive-quote-hooks.ts` → `useProcessSparkReceiveQuoteTasks` (lines 456-711)
- `apps/web-wallet/app/features/wallet/task-processing-lock-repository.ts` + `task-processing.ts` + `wallet.tsx` (lines 55-65) — leader election + mounting.

## Decisions locked at confirmation (2026-06-17)

1. **Testing: narrow carve-out.** Unit tests only for the 3 pure, variant-independent primitives that ship review-only otherwise: `OncePerKey` (Task 3), `classifyMintQuoteUpdate` (Task 9), `BackgroundDomain` transitions via fake clock + fake lock (Task 13). Everything else is minimal (build + gate-green, like 4a/4b).
2. **Background lifecycle: explicit host-driven.** Base exposes `sdk.background.start()/stop()/state` + `setOnlineStatus`/`setActiveStatus` only. The host calls them (the web variant-migration wires `auth:signed-in`→start + online/visibility→setActive/Online; MCP starts after sign-in). No auto-wiring to auth in base.
3. **Engine seam = factory injected at create:** `Sdk.create(config, { createEngine?: (ctx: EngineContext) => SdkEngine })`. No engine → `sdk.background.start()` throws a `DomainError`. `WalletAccess` lives in the engine because the 4a trackers need **sync** `getWallet`.
4. **Retry: all processor ops use `defaultRetryPolicy`** (the 4a `classifyRetry(3)`). This unifies the app's ad-hoc per-mutation `retry:3` / inline-`MintOperationError` fns into the spec taxonomy — an **intentional, spec-driven** deviation (`DomainError` now never-retries vs the app's 3×; `ConcurrencyError` now unbounded). Flag it in the final summary.
5. **Lane keys** exactly as the app, **collapsing the spark-receive typo** `spark-receive-quote${id}` → `spark-receive-quote-${id}`; `cashu-send-quote` keeps its two-lane split.
6. **Leader/follower split:** `ChangeFeed` runs follower+leader; processors+trackers only on leader. On follower→leader: `registry.activate(userId)` reloads all (trackers subscribe). On leader→follower / stop: `registry.deactivate()` disposes trackers (clean WS teardown — closes the 4a/4b carry-forward).
7. **`onEntityChange` reloads the matching processor's full work set** via the port (the A-DB-cost vs B-store-cost difference is what the variants measure — base stays neutral).
8. **`setActiveStatus(false)` pauses leader polling** (background tabs yield — matches the app's `refetchIntervalInBackground:false`); no explicit lease release on stop (relies on 6s expiry, matching the app).

---

## File structure

```
packages/wallet-sdk/src/
├── engine.ts                                    # NEW (public): SdkEngine, EngineContext, WalletAccess, WorkSetSource, CreateEngine + seam re-exports
├── index.ts                                     # MODIFY: export the engine seam types
├── sdk.ts                                        # MODIFY: createEngine injection, build background, sdk.background, resync, dispose
├── events.ts                                     # (unchanged — background:state already present)
├── domains/
│   └── background.ts                             # NEW: BackgroundDomain (leader election + lifecycle)  [+ background.test.ts]
└── internal/
    ├── cashu/melt-quote-tracker.ts               # MODIFY: rename Callbacks→Deps (4a cosmetic carry-forward)
    └── background/                               # NEW dir
        ├── task-processing-lock-repository.ts    # NEW: copy of the app repo
        ├── once-per-key.ts                       # NEW: query-polling "run-once-per-item" dispatcher  [+ once-per-key.test.ts]
        ├── processor-registry.ts                 # NEW: ProcessorTrigger impl + activate/deactivate + kind→processor routing
        └── processors/
            ├── processor.ts                      # NEW: shared Processor type
            ├── mint-quote-classification.ts      # NEW: pure classifyMintQuoteUpdate  [+ mint-quote-classification.test.ts]
            ├── cashu-send-quote-processor.ts     # NEW
            ├── cashu-send-swap-processor.ts      # NEW
            ├── spark-send-quote-processor.ts     # NEW
            ├── cashu-receive-quote-processor.ts  # NEW
            ├── cashu-receive-swap-processor.ts   # NEW
            └── spark-receive-quote-processor.ts  # NEW
```

`package.json` exports gain `./engine` and `./internal/cashu/init-wallet` (the latter lets the variant build `WalletAccess.getSourceCashuWallet`).

---

### Task 1: Engine seam types + public exports

**Files:**
- Create: `packages/wallet-sdk/src/engine.ts`
- Modify: `packages/wallet-sdk/src/index.ts`
- Modify: `packages/wallet-sdk/package.json` (exports)

- [ ] **Step 1: Write `engine.ts`**

```typescript
import type { BreezSdk } from '@agicash/breez-sdk-spark';
import type { Currency } from '@agicash/money';
import type { SdkConfig } from './config';
import type { CashuReceiveQuote } from './domains/cashu-receive-quote';
import type { CashuReceiveSwap } from './domains/cashu-receive-swap';
import type { CashuSendQuote } from './domains/cashu-send-quote';
import type { CashuSendSwap } from './domains/cashu-send-swap';
import type { SparkReceiveQuote } from './domains/spark-receive-quote';
import type { SparkSendQuote } from './domains/spark-send-quote';
import type { ExtendedCashuWallet } from './internal/cashu/wallet';
import type { EventBus } from './internal/event-bus';
import type { EntityFanout } from './internal/realtime/change-feed-ports';
import type { ChangeFeedChange } from './internal/realtime/change-feed-router';
import type { RetryPolicy } from './internal/tasks/retry-policy';
import type { TaskRunner } from './internal/tasks/task-runner';
import type { WalletRuntime } from './internal/wallet-runtime';
import type { SdkCoreEventMap } from './events';

// Seam surface the variant implements / references. Re-exported for variant packages only.
export type { TaskRunner, RetryPolicy, EntityFanout, ChangeFeedChange, WalletRuntime };

/**
 * The six background work sets, already filtered to processable items (online
 * accounts only — see the app's `useSelectItemsWithOnlineAccount`). Variant A
 * reads the DB on demand via `runtime.protocols.*Repository.getUnresolved/getPending(userId)`;
 * variant B reads its resident stores (kept fresh by the change-feed fan-out).
 */
export type WorkSetSource = {
  getUnresolvedCashuSendQuotes(userId: string): Promise<CashuSendQuote[]>;
  getUnresolvedCashuSendSwaps(userId: string): Promise<CashuSendSwap[]>;
  getUnresolvedSparkSendQuotes(userId: string): Promise<SparkSendQuote[]>;
  getPendingCashuReceiveQuotes(userId: string): Promise<CashuReceiveQuote[]>;
  getPendingCashuReceiveSwaps(userId: string): Promise<CashuReceiveSwap[]>;
  getPendingSparkReceiveQuotes(userId: string): Promise<SparkReceiveQuote[]>;
};

/**
 * Sync wallet resolution the 4a trackers need (they call `getWallet` synchronously).
 * The variant builds these from its resident accounts (which carry warm `.wallet`
 * handles). Mirrors the app's `getCashuAccount(id).wallet`,
 * `getCashuAccountByMintUrlAndCurrency(...)?.wallet ?? getCashuWallet(mintUrl)`,
 * `getSparkAccount(id).wallet`, and the `getInitializedCashuWallet` source fallback.
 */
export type WalletAccess = {
  /** accountId → the account's initialized cashu wallet (mint-quote + send/receive paths). */
  getCashuWallet(accountId: string): ExtendedCashuWallet;
  /** mintUrl+currency → a cashu wallet for checking melt quotes: a resident account's wallet if present, else a bare `getCashuWallet(mintUrl)`. */
  getCashuWalletByMint(mintUrl: string, currency: Currency): ExtendedCashuWallet;
  /** accountId → the account's mint URL (proof-state tracker). */
  getMintUrl(accountId: string): string;
  /** accountId → the account's Breez/Spark wallet (spark trackers). */
  getSparkWallet(accountId: string): BreezSdk;
  /**
   * Token-receive melt path: resolve a fully-initialized source wallet for an
   * arbitrary mint+currency — a resident account at that mint if present, else
   * `getInitializedCashuWallet(...)`. Rejects (NetworkError) if the mint is offline.
   */
  getSourceCashuWallet(mintUrl: string, currency: Currency): Promise<ExtendedCashuWallet>;
};

/**
 * The variant-supplied engine. Base ships NO implementation (the accepted
 * "inject ports, no base default" decision): without a `createEngine`, the SDK
 * has no background processing and `sdk.background.start()` throws. Variant A
 * (KeyedQueue + DB-on-demand + row-event fan-out) and variant B (patched
 * query-core + resident stores + store-write fan-out) each provide one.
 */
export type SdkEngine = {
  runner: TaskRunner;
  workSets: WorkSetSource;
  wallets: WalletAccess;
  fanout: EntityFanout;
};

/** What the variant's `createEngine` receives to build the engine pieces. */
export type EngineContext = {
  events: EventBus<SdkCoreEventMap>;
  runtime: WalletRuntime;
  config: SdkConfig;
};

export type CreateEngine = (ctx: EngineContext) => SdkEngine;
```

- [ ] **Step 2: Export the seam from `index.ts`** — append:

```typescript
export type {
  SdkEngine,
  EngineContext,
  CreateEngine,
  WalletAccess,
  WorkSetSource,
  TaskRunner,
  RetryPolicy,
  EntityFanout,
  ChangeFeedChange,
  WalletRuntime,
} from './engine';
```

- [ ] **Step 3: Add `package.json` exports** — inside `"exports"`, before the `"./*"` catch-all, add:

```json
    "./engine": "./src/engine.ts",
    "./internal/cashu/init-wallet": "./src/internal/cashu/init-wallet.ts",
```

- [ ] **Step 4: Gate** — `cd packages/wallet-sdk && bun run typecheck && bun run test` (expect exit 0; no new tests yet). Then `cd -`.

- [ ] **Step 5: Commit**

```bash
git add packages/wallet-sdk/src/engine.ts packages/wallet-sdk/src/index.ts packages/wallet-sdk/package.json
git commit -m "feat(wallet-sdk): engine-injection seam types (SdkEngine/WorkSetSource/WalletAccess) (base 4c)"
```

---

### Task 2: TaskProcessingLockRepository (copy)

**Files:**
- Create: `packages/wallet-sdk/src/internal/background/task-processing-lock-repository.ts`

Verbatim copy of `apps/web-wallet/app/features/wallet/task-processing-lock-repository.ts`, repointing the `AgicashDb` import. Not variant-specific (a plain DB RPC); base ships it concretely.

- [ ] **Step 1: Write the file**

```typescript
import type { AgicashDb } from '../db/database';

type Options = {
  abortSignal?: AbortSignal;
};

/**
 * Wraps the `take_lead` RPC (a 6s lease in `wallet.task_processing_locks`): the
 * caller becomes/stays leader if no lock exists, the lock is theirs, or it expired;
 * otherwise another client holds it. Polled every 5s by {@link BackgroundDomain}.
 */
export class TaskProcessingLockRepository {
  constructor(private readonly db: AgicashDb) {}

  /**
   * @param userId - The user to take the lead for.
   * @param clientId - The id of the client attempting to take the lead.
   * @returns True if the lead was taken/held, false otherwise.
   */
  async takeLead(
    userId: string,
    clientId: string,
    options?: Options,
  ): Promise<boolean> {
    const query = this.db.rpc('take_lead', {
      p_user_id: userId,
      p_client_id: clientId,
    });

    if (options?.abortSignal) {
      query.abortSignal(options.abortSignal);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Take lead request failed', { cause: error });
    }

    return data;
  }
}
```

- [ ] **Step 2: Verify the import path** — confirm `AgicashDb` is exported from `../db/database` (it backs `change-feed-router.ts`'s repo deps; if the type lives elsewhere, match the path used by `internal/db/*-repository.ts`).

- [ ] **Step 3: Gate** — `cd packages/wallet-sdk && bun run typecheck && bun run test` (exit 0). `cd -`.

- [ ] **Step 4: Commit**

```bash
git add packages/wallet-sdk/src/internal/background/task-processing-lock-repository.ts
git commit -m "feat(wallet-sdk): TaskProcessingLockRepository (take_lead 6s lease) (base 4c)"
```

---

### Task 3: `OncePerKey` dispatcher + unit test (carve-out)

**Files:**
- Create: `packages/wallet-sdk/src/internal/background/once-per-key.ts`
- Test: `packages/wallet-sdk/src/internal/background/once-per-key.test.ts`

Reproduces the app's `useQueries` + `staleTime: Infinity` + `gcTime: 0` "run each work-set item once while present" pattern (the draft cashu-send-swap and pending cashu-receive-swap query-polling paths): run `fn(key)` once when a key appears; prune keys that leave (so a re-appearing key runs again — matching `gcTime: 0`).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, test } from 'bun:test';
import { OncePerKey } from './once-per-key';

describe('OncePerKey', () => {
  test('runs fn once per newly-appeared key', () => {
    const dispatcher = new OncePerKey();
    const calls: string[] = [];
    dispatcher.run(['a', 'b'], (k) => calls.push(k));
    expect(calls).toEqual(['a', 'b']);

    dispatcher.run(['a', 'b', 'c'], (k) => calls.push(k));
    expect(calls).toEqual(['a', 'b', 'c']); // only the new key 'c' fires
  });

  test('prunes absent keys so they re-run if they return', () => {
    const dispatcher = new OncePerKey();
    const calls: string[] = [];
    dispatcher.run(['a', 'b'], (k) => calls.push(k));
    dispatcher.run(['a'], (k) => calls.push(k)); // 'b' leaves → pruned
    dispatcher.run(['a', 'b'], (k) => calls.push(k)); // 'b' returns → re-fires
    expect(calls).toEqual(['a', 'b', 'b']);
  });

  test('reset clears all tracked keys', () => {
    const dispatcher = new OncePerKey();
    const calls: string[] = [];
    dispatcher.run(['a'], (k) => calls.push(k));
    dispatcher.reset();
    dispatcher.run(['a'], (k) => calls.push(k));
    expect(calls).toEqual(['a', 'a']);
  });
});
```

- [ ] **Step 2: Run, verify it fails** — `cd packages/wallet-sdk && bun test src/internal/background/once-per-key.test.ts` → FAIL (`Cannot find module './once-per-key'`).

- [ ] **Step 3: Implement**

```typescript
/**
 * Runs a side effect exactly once per item while that item is present in the
 * work set, re-running if the item leaves and later returns. Framework-free port
 * of the app's `useQueries({ staleTime: Infinity, gcTime: 0 })` one-shot trigger
 * for the draft cashu-send-swap and pending cashu-receive-swap processing paths.
 */
export class OncePerKey {
  private readonly active = new Set<string>();

  /** For each key not seen since it last left, run `fn(key)` once. Prune absent keys. */
  run(keys: string[], fn: (key: string) => void): void {
    const current = new Set(keys);
    for (const key of this.active) {
      if (!current.has(key)) this.active.delete(key);
    }
    for (const key of keys) {
      if (!this.active.has(key)) {
        this.active.add(key);
        fn(key);
      }
    }
  }

  reset(): void {
    this.active.clear();
  }
}
```

- [ ] **Step 4: Run, verify it passes** — `bun test src/internal/background/once-per-key.test.ts` → 3 pass. `cd -`.

- [ ] **Step 5: Commit**

```bash
git add packages/wallet-sdk/src/internal/background/once-per-key.ts packages/wallet-sdk/src/internal/background/once-per-key.test.ts
git commit -m "feat(wallet-sdk): OncePerKey work-set dispatcher + tests (base 4c)"
```

---

### Task 4: Rename `MeltQuoteTracker` `Callbacks`→`Deps` (4a carry-forward)

**Files:**
- Modify: `packages/wallet-sdk/src/internal/cashu/melt-quote-tracker.ts`

Cosmetic uniformity with the other 4 trackers (which use `Deps`). Pure rename — no behavior change.

- [ ] **Step 1: Rename the type** — `export type MeltQuoteTrackerCallbacks` → `export type MeltQuoteTrackerDeps`.

- [ ] **Step 2: Update internal references** — `private callbacks: MeltQuoteTrackerCallbacks | null` → `private deps: MeltQuoteTrackerDeps | null`; `update(quotes, callbacks: MeltQuoteTrackerCallbacks)` → `update(quotes, deps: MeltQuoteTrackerDeps)`; replace `this.callbacks`/`callbacks` body references with `this.deps`/`deps` (the local `const cb = this.callbacks` in `handle` → `const cb = this.deps`).

- [ ] **Step 3: Grep for external references** — `grep -rn "MeltQuoteTrackerCallbacks" packages/wallet-sdk/src` → expect zero hits after the edit (nothing consumes it yet; processors are added later in this plan referencing `MeltQuoteTrackerDeps`).

- [ ] **Step 4: Gate** — `cd packages/wallet-sdk && bun run typecheck && bun run test` (exit 0; the 4a melt-tracker has no dedicated test, so this is a typecheck-only confirmation). `cd -`.

- [ ] **Step 5: Commit**

```bash
git add packages/wallet-sdk/src/internal/cashu/melt-quote-tracker.ts
git commit -m "refactor(wallet-sdk): MeltQuoteTracker callbacks→deps for tracker uniformity (base 4c)"
```

---

### Task 5: Shared `Processor` type

**Files:**
- Create: `packages/wallet-sdk/src/internal/background/processors/processor.ts`

- [ ] **Step 1: Write the file**

```typescript
/**
 * A leader-only background processor. The {@link ProcessorRegistry} calls `reload`
 * when the processor's entity kind changes (or on catch-up), and `dispose` when
 * leadership is lost / background stops. Each processor owns its work-set fetch
 * (a bound {@link WorkSetSource} method) and narrows its own entity type.
 */
export type Processor = {
  /** Fetch the latest work set for this processor and (re)drive its trackers/one-shot ops. */
  reload(userId: string): Promise<void>;
  /** Tear down trackers (unsubscribe NUT-17 WS / remove Breez listeners). */
  dispose(): void;
};
```

- [ ] **Step 2: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test && cd -
git add packages/wallet-sdk/src/internal/background/processors/processor.ts
git commit -m "feat(wallet-sdk): shared Processor type (base 4c)"
```

---

### Task 6: CashuSendQuoteProcessor (reference template — full code)

**Files:**
- Create: `packages/wallet-sdk/src/internal/background/processors/cashu-send-quote-processor.ts`

**Source:** `useProcessCashuSendQuoteTasks` (`cashu-send-quote-hooks.ts:256-508`). Driven by a `MeltQuoteTracker` over each unresolved send quote's **destination** melt quote. **De-TanStack recipe (applies to Tasks 6-11):** drop the `useMutation`/cache classes/`onSuccess` cache pokes; keep each `mutationFn`'s service-call body and `console.error` logging; resolve entities from `this.workSet` (held from the last `reload`); run every transition via `runner.runTask(lane, fn, defaultRetryPolicy).catch(log)`.

This task is the **reference**: it shows the full class shape, the `MeltQuoteTracker` wiring, the separate `initiate-` lane, the `MintOperationError`→fail path, and `removeQuoteFromSubscription` on fail-success.

- [ ] **Step 1: Write the class**

```typescript
import { MintOperationError, type MeltQuoteBolt11Response } from '@cashu/cashu-ts';
import { sumProofs } from '@agicash/cashu';
import type { CashuSendQuote } from '../../../domains/cashu-send-quote';
import type { WalletAccess } from '../../../engine';
import type { TaskRunner } from '../../tasks/task-runner';
import { defaultRetryPolicy } from '../../tasks/retry-policy';
import { MeltQuoteTracker } from '../../cashu/melt-quote-tracker';
import type { CashuSendQuoteService } from '../../services/cashu-send-quote-service';
import type { Processor } from './processor';

export type CashuSendQuoteProcessorDeps = {
  service: CashuSendQuoteService;
  runner: TaskRunner;
  wallets: WalletAccess;
  fetchWorkSet: (userId: string) => Promise<CashuSendQuote[]>;
};

/**
 * Drives unresolved cashu send quotes off their destination melt quote (NUT-17):
 * UNPAID→initiateSend (separate lane so markPending need not wait behind it),
 * PENDING→markSendQuoteAsPending, PAID→completeSendQuote, EXPIRED→expireSendQuote.
 * A `MintOperationError` on initiate is terminal → failSendQuote. Port of
 * `useProcessCashuSendQuoteTasks`.
 */
export class CashuSendQuoteProcessor implements Processor {
  private readonly tracker = new MeltQuoteTracker();
  private workSet: CashuSendQuote[] = [];

  constructor(private readonly deps: CashuSendQuoteProcessorDeps) {}

  async reload(userId: string): Promise<void> {
    this.workSet = await this.deps.fetchWorkSet(userId);
    this.tracker.update(
      this.workSet.map((q) => ({
        // Each send quote pays its destination melt quote (see the app's usePendingMeltQuotes).
        id: q.paymentRequest.meltQuoteId,
        mintUrl: q.mintUrl,
        currency: q.amountRequested.currency,
        expiryInMs: new Date(q.expiresAt).getTime(),
        inputAmount: sumProofs(q.proofs),
      })),
      {
        getWallet: (mintUrl, currency) =>
          this.deps.wallets.getCashuWalletByMint(mintUrl, currency),
        onUnpaid: (meltQuote) => this.onUnpaid(meltQuote),
        onPending: (meltQuote) => this.run(meltQuote, 'cashu-send-quote', (q) =>
          this.deps.service.markSendQuoteAsPending(q),
        ),
        onPaid: (meltQuote) => this.run(meltQuote, 'cashu-send-quote', (q) =>
          this.deps.service.completeSendQuote(
            this.account(q),
            q,
            meltQuote,
          ),
        ),
        onExpired: (meltQuote) => this.run(meltQuote, 'cashu-send-quote', (q) =>
          this.deps.service.expireSendQuote(q),
        ),
      },
    );
  }

  dispose(): void {
    this.tracker.dispose();
    this.workSet = [];
  }

  // NOTE: confirm the actual CashuSendQuote field names for the destination melt
  // quote id / proofs / amount while porting (read cashu-send-quote.ts + the app's
  // usePendingMeltQuotes). The shapes above mirror the app's mapping.
  private resolve(meltQuote: MeltQuoteBolt11Response): CashuSendQuote | undefined {
    return this.workSet.find((q) => q.paymentRequest.meltQuoteId === meltQuote.quote);
  }

  private account(quote: CashuSendQuote) {
    return this.deps.wallets.getCashuWallet(quote.accountId);
  }

  private onUnpaid(meltQuote: MeltQuoteBolt11Response): void {
    const quote = this.resolve(meltQuote);
    if (!quote || quote.state !== 'UNPAID') return; // mint flips back to UNPAID on failed pay — don't re-initiate
    void this.deps.runner
      .runTask(
        `initiate-cashu-send-quote-${quote.id}`,
        () => this.deps.service.initiateSend(this.account(quote), quote, meltQuote),
        defaultRetryPolicy,
      )
      .catch((error) => {
        if (error instanceof MintOperationError) {
          this.fail(quote, error.message);
        } else {
          console.error('Initiate send error', { cause: error, sendQuoteId: quote.id });
        }
      });
  }

  private fail(quote: CashuSendQuote, reason: string): void {
    void this.deps.runner
      .runTask(
        `cashu-send-quote-${quote.id}`,
        async () => {
          const failed = await this.deps.service.failSendQuote(
            this.account(quote),
            quote,
            reason,
          );
          // Drop the melt sub so a re-initiated send (new quote, same melt) resubscribes.
          this.tracker.removeQuoteFromSubscription({
            mintUrl: quote.mintUrl,
            quoteId: failed.quoteId,
          });
        },
        defaultRetryPolicy,
      )
      .catch((error) =>
        console.error('Failed to mark payment as failed', { cause: error, sendQuoteId: quote.id }),
      );
  }

  private run(
    meltQuote: MeltQuoteBolt11Response,
    lanePrefix: 'cashu-send-quote',
    op: (quote: CashuSendQuote) => Promise<unknown>,
  ): void {
    const quote = this.resolve(meltQuote);
    if (!quote) return;
    void this.deps.runner
      .runTask(`${lanePrefix}-${quote.id}`, () => op(quote), defaultRetryPolicy)
      .catch((error) =>
        console.error('Cashu send quote transition failed', { cause: error, sendQuoteId: quote.id }),
      );
  }
}
```

- [ ] **Step 2: Reconcile field names** — while porting, open `packages/wallet-sdk/src/domains/cashu-send-quote.ts` and the app's `usePendingMeltQuotes` (in `cashu-send-quote-hooks.ts`) and confirm the real field names for: the destination melt-quote id, the account's `mintUrl`, the principal `amount`/`proofs`, and the `currency`. Fix the `reload` mapping + `resolve`/`account` accessors accordingly. Use `this.deps.wallets.getCashuWallet(quote.accountId)` for the account wallet (the `completeSendQuote`/`initiateSend`/`failSendQuote` `account` arg is the account's `CashuAccount` — confirm the service wants the account object vs the wallet; the app passed `getCashuAccount(accountId)` which is the full `CashuAccount`. If the service needs the full account, the engine must expose it — see note below).

> **Account-object vs wallet caveat (resolve while porting, applies to Tasks 6, 9):** the cashu send-quote / receive-quote services take a `CashuAccount` (not just its `ExtendedCashuWallet`). `WalletAccess` currently returns wallets. If the services need the full account, **add `getCashuAccount(accountId): CashuAccount` to `WalletAccess`** in `engine.ts` (the variant has resident accounts, so this is free) and use it for the service `account` args, keeping `getCashuWallet` for the trackers. Make this `engine.ts` addition in Task 6 and note it for Task 9. Verify the exact service param types in `internal/services/cashu-send-quote-service.ts` before deciding.

- [ ] **Step 3: Gate** — `cd packages/wallet-sdk && bun run typecheck && bun run test` (exit 0). `cd -`.

- [ ] **Step 4: Commit**

```bash
git add packages/wallet-sdk/src/internal/background/processors/cashu-send-quote-processor.ts packages/wallet-sdk/src/engine.ts
git commit -m "feat(wallet-sdk): CashuSendQuoteProcessor + WalletAccess.getCashuAccount (base 4c)"
```

---

### Task 7: CashuSendSwapProcessor

**Files:**
- Create: `packages/wallet-sdk/src/internal/background/processors/cashu-send-swap-processor.ts`

**Source:** `useProcessCashuSendSwapTasks` (`cashu-send-swap-hooks.ts:393-466`). **Dual trigger:** DRAFT swaps via `OncePerKey` (one-shot `swapForProofsToSend`); PENDING swaps via `ProofStateTracker` (`onSpent`→`complete`). Partition the work set into `draft`/`pending` exactly as `useUnresolvedCashuSendSwaps` (lines 193-206).

- [ ] **Step 1: Write the class** with this interface + wiring:

```typescript
export type CashuSendSwapProcessorDeps = {
  service: CashuSendSwapService;
  runner: TaskRunner;
  wallets: WalletAccess;
  fetchWorkSet: (userId: string) => Promise<CashuSendSwap[]>;
};

export class CashuSendSwapProcessor implements Processor {
  private readonly proofTracker = new ProofStateTracker();
  private readonly draftDispatcher = new OncePerKey();
  private draft: CashuSendSwap[] = [];
  private pending: PendingCashuSendSwap[] = [];
  // reload(userId): fetch → partition by state (DRAFT / PENDING) → store →
  //   proofTracker.update(this.pending, { getMintUrl: (id) => wallets.getMintUrl(id), onSpent }) ;
  //   draftDispatcher.run(this.draft.map(s => s.id), (id) => this.swap(id))
  // dispose(): proofTracker.dispose(); draftDispatcher.reset(); clear arrays
}
```

| Trigger | Condition | Service call | Lane | Policy |
|---|---|---|---|---|
| `draftDispatcher.run` (one-shot per draft id) | swap still in `this.draft` | `service.swapForProofsToSend({ account: wallets.getCashuWallet(s.accountId), swap: s })` | `send-swap-${id}` | `defaultRetryPolicy` |
| `proofTracker.onSpent(swap)` | swap still in `this.pending` (re-resolve by `swap.id`) | `service.complete(resolved)` | `send-swap-${id}` | `defaultRetryPolicy` |

Each op wrapped in `runner.runTask(lane, fn, defaultRetryPolicy).catch(log)`. Re-resolve from `this.draft`/`this.pending` by id; no-op if absent (faithful to the app's cache re-read guard). Confirm `swapForProofsToSend`'s `account` arg type (CashuAccount vs wallet) per the Task-6 caveat — the app passed the full `CashuAccount`; use `wallets.getCashuAccount` if so.

- [ ] **Step 2: Gate** — `cd packages/wallet-sdk && bun run typecheck && bun run test`. `cd -`.

- [ ] **Step 3: Commit**

```bash
git add packages/wallet-sdk/src/internal/background/processors/cashu-send-swap-processor.ts packages/wallet-sdk/src/engine.ts
git commit -m "feat(wallet-sdk): CashuSendSwapProcessor (proof-state + draft one-shot) (base 4c)"
```

---

### Task 8: SparkSendQuoteProcessor

**Files:**
- Create: `packages/wallet-sdk/src/internal/background/processors/spark-send-quote-processor.ts`

**Source:** `useProcessSparkSendQuoteTasks` (`spark-send-quote-hooks.ts:386-531`). Driven by `SparkSendStateTracker` (Breez events) over unresolved spark send quotes. The app's `isPending` re-entrancy flags are **dropped** — the tracker's per-quote dedup + lane FIFO + work-set re-resolve subsume them.

- [ ] **Step 1: Write the class** — `tracker = new SparkSendStateTracker()`; `reload`: fetch → store `this.workSet` → `tracker.update(this.workSet, deps)`; `dispose`: `tracker.dispose()`.

| Tracker callback | Service call | Lane | Policy | Terminal-error→fail |
|---|---|---|---|---|
| `onUnpaid(quote)` | `service.initiateSend({ account: wallets.getSparkAccount?…, sendQuote: quote })` | `spark-send-quote-${id}` | `defaultRetryPolicy` | on `DomainError` → `fail` (the app's `.catch` in `initiateSend`) |
| `onCompleted(quote, { paymentPreimage })` | `service.complete(quote, paymentPreimage)` | `spark-send-quote-${id}` | `defaultRetryPolicy` | — |
| `onFailed(quote, reason)` | `service.fail(quote, reason)` | `spark-send-quote-${id}` | `defaultRetryPolicy` | — |

The spark `initiateSend` `account` arg is the `SparkAccount`. **Add `getSparkAccount(accountId): SparkAccount` to `WalletAccess`** (mirror the Task-6 account caveat; the spark trackers already get the `BreezSdk` via `getSparkWallet`, but the service wants the account). Confirm in `spark-send-quote-service.ts`. `initiateSend`'s `DomainError`→`fail` is done inside the runTask fn (await the service, catch `DomainError`, run `fail` on the same lane) — mirror the app's `.catch` at lines 438-450.

- [ ] **Step 2: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test && cd -
git add packages/wallet-sdk/src/internal/background/processors/spark-send-quote-processor.ts packages/wallet-sdk/src/engine.ts
git commit -m "feat(wallet-sdk): SparkSendQuoteProcessor (Breez send events) (base 4c)"
```

---

### Task 9: `classifyMintQuoteUpdate` + CashuReceiveQuoteProcessor

**Files:**
- Create: `packages/wallet-sdk/src/internal/background/processors/mint-quote-classification.ts`
- Test: `packages/wallet-sdk/src/internal/background/processors/mint-quote-classification.test.ts`
- Create: `packages/wallet-sdk/src/internal/background/processors/cashu-receive-quote-processor.ts`

**Source:** `useProcessCashuReceiveQuoteTasks` (`cashu-receive-quote-hooks.ts:576-822`) + `useOnMintQuoteStateChange` classification (lines 532-558). **Dual trigger:** `MintQuoteTracker` (the receive quote's mint quote — the `MintQuoteTracker.onUpdate` is RAW, so we classify) + `MeltQuoteTracker` (the CASHU_TOKEN melt path).

The mint-quote classification ports cleanly into a pure, testable function (the carve-out target).

- [ ] **Step 1: Write the classifier failing test**

```typescript
import { describe, expect, test } from 'bun:test';
import { classifyMintQuoteUpdate } from './mint-quote-classification';

const future = new Date(Date.now() + 60_000).toISOString();
const past = new Date(Date.now() - 60_000).toISOString();

describe('classifyMintQuoteUpdate', () => {
  test('UNPAID + expired → expired', () => {
    expect(classifyMintQuoteUpdate('UNPAID', past)).toBe('expired');
  });
  test('UNPAID + not expired → none', () => {
    expect(classifyMintQuoteUpdate('UNPAID', future)).toBeUndefined();
  });
  test('PAID → paid (recovery path also completes)', () => {
    expect(classifyMintQuoteUpdate('PAID', future)).toBe('paid');
  });
  test('ISSUED → issued (re-complete after a crash post-mint)', () => {
    expect(classifyMintQuoteUpdate('ISSUED', future)).toBe('issued');
  });
  test('other states → none', () => {
    expect(classifyMintQuoteUpdate('PENDING', future)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, verify it fails** — `cd packages/wallet-sdk && bun test src/internal/background/processors/mint-quote-classification.test.ts` → FAIL.

- [ ] **Step 3: Implement the classifier**

```typescript
export type MintQuoteOutcome = 'paid' | 'issued' | 'expired';

/**
 * Pure port of the app's `processMintQuote` classification
 * (`cashu-receive-quote-hooks.ts:551-557`): an UNPAID quote past its expiry is
 * expired (the socket emits no expiry event); PAID completes the receive; ISSUED
 * re-completes (recovery if the app died after minting but before marking COMPLETED).
 * @param state - the mint quote's `state` (e.g. from `MintQuoteBolt11Response`).
 * @param receiveQuoteExpiresAt - the related receive quote's ISO `expiresAt`.
 */
export function classifyMintQuoteUpdate(
  state: string,
  receiveQuoteExpiresAt: string,
): MintQuoteOutcome | undefined {
  if (state === 'UNPAID') {
    return new Date(receiveQuoteExpiresAt) < new Date() ? 'expired' : undefined;
  }
  if (state === 'PAID') return 'paid';
  if (state === 'ISSUED') return 'issued';
  return undefined;
}
```

- [ ] **Step 4: Run, verify it passes** — 5 pass.

- [ ] **Step 5: Write the processor.** Owns `MintQuoteTracker` + `MeltQuoteTracker`. `reload`: fetch pending receive quotes → store → drive both trackers:
  - `mintTracker.update(quotes.map(q => ({ quoteId: q.quoteId, accountId: q.accountId, mintUrl, currency, state: q.state, expiresAt: q.expiresAt })), { getWallet: (id) => wallets.getCashuWallet(id), onUpdate: (mq) => this.onMintUpdate(mq) })`.
  - `meltTracker.update(<CASHU_TOKEN melt-quote derivation, see usePendingMeltQuotes lines 307-326>, { getWallet: (mintUrl, currency) => wallets.getCashuWalletByMint(mintUrl, currency), onUnpaid, onPending, onExpired })`.

  `onMintUpdate(mq)`: resolve the receive quote by `q.quoteId === mq.quote`; if none, return; `switch (classifyMintQuoteUpdate(mq.state, quote.expiresAt))`:

| Outcome | Service call | Lane | Policy |
|---|---|---|---|
| `paid` / `issued` | `service.completeReceive(wallets.getCashuAccount(q.accountId), q)` | `cashu-receive-quote-${id}` | `defaultRetryPolicy` |
| `expired` | `service.expire(q)` | `cashu-receive-quote-${id}` | `defaultRetryPolicy` |

  Melt-tracker callbacks (resolve receive quote by `q.tokenReceiveData.meltQuoteId === meltQuote.quote`):

| Callback | Condition | Action | Lane |
|---|---|---|---|
| `onUnpaid` | `tokenReceiveData.meltInitiated` true | `service.fail(q, 'Cashu token melt failed.')` | `cashu-receive-quote-${id}` |
| `onUnpaid` | else | `initiateMelt` (below) | `cashu-receive-quote-${id}` |
| `onPending` | — | `service.markMeltInitiated(q)` | `cashu-receive-quote-${id}` |
| `onExpired` | — | `service.expire(q)` | `cashu-receive-quote-${id}` |

  `initiateMelt(q)`: `const wallet = await wallets.getSourceCashuWallet(q.tokenReceiveData.sourceMintUrl, q.tokenReceiveData.tokenAmount.currency); await wallet.meltProofsIdempotent({ quote: q.tokenReceiveData.meltQuoteId, amount: q.amount.toNumber(getCashuUnit(q.amount.currency)) }, q.tokenReceiveData.tokenProofs, undefined, { type: 'random' })` — wrapped in `runTask('cashu-receive-quote-${id}', fn, defaultRetryPolicy).catch(e => e instanceof MintOperationError ? this.fail(q, e.message) : log)`. This replaces the app's inline `getCashuAccountByMintUrlAndCurrency ?? getInitializedCashuWallet` source-wallet resolution with `wallets.getSourceCashuWallet` (the engine handles account-vs-init + offline check). Confirm `getCashuUnit` import from `@agicash/cashu`. **Drop** all `onSuccess` cache pokes (`transactionsCache.invalidateTransaction`, `pendingQuotesCache.update/remove`, `cashuReceiveQuoteCache.updateIfExists`) — variant/change-feed concern.

- [ ] **Step 6: Gate** — `cd packages/wallet-sdk && bun run typecheck && bun run test` (mint-classification 5 pass). `cd -`.

- [ ] **Step 7: Commit**

```bash
git add packages/wallet-sdk/src/internal/background/processors/mint-quote-classification.ts packages/wallet-sdk/src/internal/background/processors/mint-quote-classification.test.ts packages/wallet-sdk/src/internal/background/processors/cashu-receive-quote-processor.ts
git commit -m "feat(wallet-sdk): CashuReceiveQuoteProcessor + mint-quote classification + tests (base 4c)"
```

---

### Task 10: CashuReceiveSwapProcessor

**Files:**
- Create: `packages/wallet-sdk/src/internal/background/processors/cashu-receive-swap-processor.ts`

**Source:** `useProcessCashuReceiveSwapTasks` (`cashu-receive-swap-hooks.ts:148-190`). Pure `OncePerKey` over PENDING swaps keyed by **`tokenHash`** (the only processor without a subscription tracker).

- [ ] **Step 1: Write the class** — `dispatcher = new OncePerKey()`; `reload`: fetch pending swaps → store `this.pending` → `dispatcher.run(this.pending.map(s => s.tokenHash), (h) => this.complete(h))`; `dispose`: `dispatcher.reset(); this.pending = []`.

| Trigger | Condition | Service call | Lane | Policy |
|---|---|---|---|---|
| `dispatcher.run` (one-shot per tokenHash) | swap still in `this.pending` (re-resolve by `tokenHash`) | `service.completeSwap(wallets.getCashuAccount(s.accountId), s)` | `receive-swap-${tokenHash}` | `defaultRetryPolicy` |

Wrap in `runner.runTask(lane, fn, defaultRetryPolicy).catch(log)`. Confirm `completeSwap`'s `account` arg type per the Task-6 caveat (app passed full `CashuAccount`).

- [ ] **Step 2: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test && cd -
git add packages/wallet-sdk/src/internal/background/processors/cashu-receive-swap-processor.ts
git commit -m "feat(wallet-sdk): CashuReceiveSwapProcessor (pending one-shot) (base 4c)"
```

---

### Task 11: SparkReceiveQuoteProcessor

**Files:**
- Create: `packages/wallet-sdk/src/internal/background/processors/spark-receive-quote-processor.ts`

**Source:** `useProcessSparkReceiveQuoteTasks` (`spark-receive-quote-hooks.ts:456-711`). **Dual trigger:** `SparkReceiveStateTracker` (Breez events: complete/expire) + `MeltQuoteTracker` (the CASHU_TOKEN melt path — same shape as Task 9's melt path). **Collapse the lane typo** `spark-receive-quote${id}` → `spark-receive-quote-${id}` on all melt-path lanes (app lines 682/686/697/707).

- [ ] **Step 1: Write the class** — owns `SparkReceiveStateTracker` + `MeltQuoteTracker`. `reload`: fetch pending spark receive quotes → store → drive both. `dispose`: dispose both trackers.

  Spark tracker callbacks:

| Callback | Service call | Lane | Policy |
|---|---|---|---|
| `onCompleted(quoteId, { paymentPreimage, sparkTransferId })` | resolve by id; `service.complete(q, paymentPreimage, sparkTransferId)` | `spark-receive-quote-${id}` | `defaultRetryPolicy` |
| `onExpired(quoteId)` | resolve by id; `service.expire(q)` | `spark-receive-quote-${id}` | `defaultRetryPolicy` |

  Melt tracker callbacks (CASHU_TOKEN quotes; resolve by `tokenReceiveData.meltQuoteId`) — identical structure to Task 9, lanes `spark-receive-quote-${id}`: `onUnpaid`→(meltInitiated ? `service.fail(q,'Cashu token melt failed.')` : `initiateMelt`), `onPending`→`service.markMeltInitiated(q)`, `onExpired`→`service.expire(q)`. `initiateMelt` = `wallets.getSourceCashuWallet(...)` + `wallet.meltProofsIdempotent(...)`, `MintOperationError`→`service.fail`. Reuse the melt-quote derivation + the `initiateMelt` body from Task 9 (the app duplicates it; keep the duplication minimal but faithful — both processors melt a source cashu token).

- [ ] **Step 2: Gate** — `cd packages/wallet-sdk && bun run typecheck && bun run test`. `cd -`.

- [ ] **Step 3: Commit**

```bash
git add packages/wallet-sdk/src/internal/background/processors/spark-receive-quote-processor.ts
git commit -m "feat(wallet-sdk): SparkReceiveQuoteProcessor (Breez + token-melt; lane typo collapsed) (base 4c)"
```

---

### Task 12: ProcessorRegistry (ProcessorTrigger impl)

**Files:**
- Create: `packages/wallet-sdk/src/internal/background/processor-registry.ts`

Implements the 4b `ProcessorTrigger`. Holds the six processors keyed by name + leadership/userId; routes `onEntityChange` by `change.kind`; `activate`/`deactivate` gate processing on leadership.

- [ ] **Step 1: Write the class**

```typescript
import type { ProcessorTrigger } from '../realtime/change-feed-ports';
import type { ChangeFeedChange } from '../realtime/change-feed-router';
import type { Processor } from './processors/processor';

export type Processors = {
  cashuSendQuote: Processor;
  cashuSendSwap: Processor;
  sparkSendQuote: Processor;
  cashuReceiveQuote: Processor;
  cashuReceiveSwap: Processor;
  sparkReceiveQuote: Processor;
};

/**
 * Routes change-feed events to the six background processors, but only while this
 * instance is the leader. `activate` (on becoming leader) loads every work set so
 * trackers subscribe + one-shot ops fire; `deactivate` (on losing leadership /
 * stop) disposes them so NUT-17/Breez subscriptions tear down.
 */
export class ProcessorRegistry implements ProcessorTrigger {
  private leader = false;
  private userId: string | null = null;

  constructor(private readonly processors: Processors) {}

  activate(userId: string): void {
    this.leader = true;
    this.userId = userId;
    this.reloadAll();
  }

  deactivate(): void {
    this.leader = false;
    for (const processor of Object.values(this.processors)) {
      processor.dispose();
    }
  }

  onEntityChange(change: ChangeFeedChange): void {
    if (!this.leader || !this.userId) return;
    const processor = this.processorFor(change.kind);
    if (processor) this.reload(processor);
  }

  onCatchUp(): void {
    if (!this.leader || !this.userId) return;
    this.reloadAll();
  }

  private reloadAll(): void {
    for (const processor of Object.values(this.processors)) {
      this.reload(processor);
    }
  }

  private reload(processor: Processor): void {
    if (!this.userId) return;
    void processor.reload(this.userId).catch((cause) =>
      console.error('Processor reload failed', { cause }),
    );
  }

  private processorFor(kind: ChangeFeedChange['kind']): Processor | undefined {
    switch (kind) {
      case 'cashu-send-quote': return this.processors.cashuSendQuote;
      case 'cashu-send-swap': return this.processors.cashuSendSwap;
      case 'spark-send-quote': return this.processors.sparkSendQuote;
      case 'cashu-receive-quote': return this.processors.cashuReceiveQuote;
      case 'cashu-receive-swap': return this.processors.cashuReceiveSwap;
      case 'spark-receive-quote': return this.processors.sparkReceiveQuote;
      default: return undefined; // user / account / transaction / contact* — no processor
    }
  }
}
```

- [ ] **Step 2: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test && cd -
git add packages/wallet-sdk/src/internal/background/processor-registry.ts
git commit -m "feat(wallet-sdk): ProcessorRegistry (leader-gated change routing) (base 4c)"
```

---

### Task 13: BackgroundDomain + unit test (carve-out)

**Files:**
- Create: `packages/wallet-sdk/src/domains/background.ts`
- Test: `packages/wallet-sdk/src/domains/background.test.ts`

Leader election + lifecycle state machine. **New logic, no app equivalent to diff against → dedicated OPUS quality-reviewer + the carve-out test.**

- [ ] **Step 1: Write the failing test** (fake scheduler + fake lock + fake feed/registry/manager; deterministic — `start()` awaits the first poll, the interval callback is captured and invoked manually):

```typescript
import { describe, expect, test } from 'bun:test';
import { EventBus } from '../internal/event-bus';
import type { SdkCoreEventMap } from '../events';
import { BackgroundDomain, type IntervalScheduler } from './background';

const settle = () => new Promise<void>((r) => setTimeout(r, 0));

function harness(initialLead: boolean) {
  let lead = initialLead;
  let tick: (() => void) | null = null;
  const calls: string[] = [];
  const states: string[] = [];

  const scheduler: IntervalScheduler = {
    setInterval: (fn) => {
      tick = fn;
      return 1 as unknown as ReturnType<typeof setInterval>;
    },
    clearInterval: () => {
      tick = null;
    },
  };
  const events = new EventBus<SdkCoreEventMap>();
  events.on('background:state', ({ state }) => states.push(state));

  const bg = new BackgroundDomain({
    lockRepo: { takeLead: async () => lead } as never,
    changeFeed: {
      start: async () => { calls.push('feed.start'); },
      stop: async () => { calls.push('feed.stop'); },
      resync: () => { calls.push('feed.resync'); },
    } as never,
    registry: {
      activate: () => { calls.push('activate'); },
      deactivate: () => { calls.push('deactivate'); },
    } as never,
    manager: {
      setOnlineStatus: () => {},
      setActiveStatus: () => {},
    } as never,
    events,
    getUserId: async () => 'user-1',
    clientId: 'client-1',
    scheduler,
  });

  return {
    bg,
    states,
    calls,
    setLead: (v: boolean) => { lead = v; },
    tick: async () => { tick?.(); await settle(); },
  };
}

describe('BackgroundDomain', () => {
  test('start → follower; ChangeFeed starts but processors stay off until leader', async () => {
    const h = harness(false);
    await h.bg.start();
    expect(h.bg.state).toBe('follower');
    expect(h.calls).toEqual(['feed.start']); // no activate
    expect(h.states).toEqual(['starting', 'follower']);
  });

  test('becomes leader on a winning poll, activates processors', async () => {
    const h = harness(false);
    await h.bg.start();
    h.setLead(true);
    await h.tick();
    expect(h.bg.state).toBe('leader');
    expect(h.calls).toContain('activate');
  });

  test('demotes to follower + deactivates when the lease is lost', async () => {
    const h = harness(true);
    await h.bg.start(); // immediate poll wins → leader
    expect(h.bg.state).toBe('leader');
    h.setLead(false);
    await h.tick();
    expect(h.bg.state).toBe('follower');
    expect(h.calls).toContain('deactivate');
  });

  test('stop → stopping → stopped; deactivates + stops the feed', async () => {
    const h = harness(true);
    await h.bg.start();
    await h.bg.stop();
    expect(h.bg.state).toBe('stopped');
    expect(h.calls).toContain('deactivate');
    expect(h.calls).toContain('feed.stop');
    expect(h.states.slice(-2)).toEqual(['stopping', 'stopped']);
  });

  test('start throws when not signed in', async () => {
    const h = harness(false);
    (h.bg as unknown as { deps: { getUserId: () => Promise<string | null> } }).deps.getUserId =
      async () => null;
    await expect(h.bg.start()).rejects.toThrow();
    expect(h.bg.state).toBe('stopped');
  });
});
```

- [ ] **Step 2: Run, verify it fails** — `cd packages/wallet-sdk && bun test src/domains/background.test.ts` → FAIL.

- [ ] **Step 3: Implement `background.ts`**

```typescript
import { DomainError } from '../errors';
import type { BackgroundState, SdkCoreEventMap } from '../events';
import type { ProcessorRegistry } from '../internal/background/processor-registry';
import type { TaskProcessingLockRepository } from '../internal/background/task-processing-lock-repository';
import type { EventBus } from '../internal/event-bus';
import type { ChangeFeed } from '../internal/realtime/change-feed';
import type { SupabaseRealtimeManager } from '../internal/realtime/supabase-realtime-manager';

const LEASE_POLL_INTERVAL_MS = 5_000;

export type IntervalScheduler = {
  setInterval(fn: () => void, ms: number): ReturnType<typeof setInterval>;
  clearInterval(handle: ReturnType<typeof setInterval>): void;
};

const defaultScheduler: IntervalScheduler = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle),
};

export type BackgroundDeps = {
  lockRepo: TaskProcessingLockRepository;
  changeFeed: ChangeFeed;
  registry: ProcessorRegistry;
  manager: SupabaseRealtimeManager;
  events: EventBus<SdkCoreEventMap>;
  /** Resolve the signed-in user id; null if not signed in. */
  getUserId: () => Promise<string | null>;
  /** Leader-election instance id (config.clientId ?? crypto.randomUUID()). */
  clientId: string;
  /** Test seam. */
  scheduler?: IntervalScheduler;
  pollIntervalMs?: number;
};

/**
 * Leader election + background lifecycle. The ChangeFeed (realtime) runs for EVERY
 * instance (follower + leader); the six processors run on the LEADER only.
 * Leadership = the `take_lead` 6s DB lease polled every 5s; a lost lease relies on
 * expiry (no explicit release — matches the app). `setActiveStatus(false)` pauses
 * polling so a backgrounded instance yields leadership.
 */
export class BackgroundDomain {
  private _state: BackgroundState = 'stopped';
  private userId: string | null = null;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private active = true;
  private readonly scheduler: IntervalScheduler;
  private readonly pollIntervalMs: number;

  constructor(private readonly deps: BackgroundDeps) {
    this.scheduler = deps.scheduler ?? defaultScheduler;
    this.pollIntervalMs = deps.pollIntervalMs ?? LEASE_POLL_INTERVAL_MS;
  }

  get state(): BackgroundState {
    return this._state;
  }

  async start(): Promise<void> {
    if (this._state !== 'stopped') return;
    this.setState('starting');
    const userId = await this.deps.getUserId();
    if (!userId) {
      this.setState('stopped');
      throw new DomainError('Cannot start background processing: not signed in.');
    }
    this.userId = userId;
    await this.deps.changeFeed.start(userId);
    this.setState('follower');
    await this.poll(); // immediate first leadership attempt (deterministic; matches the app's on-mount poll)
    this.startPolling();
  }

  async stop(): Promise<void> {
    if (this._state === 'stopped' || this._state === 'stopping') return;
    this.setState('stopping');
    this.stopPolling();
    this.deps.registry.deactivate();
    await this.deps.changeFeed.stop();
    this.userId = null;
    this.setState('stopped');
  }

  resync(): void {
    this.deps.changeFeed.resync();
  }

  setOnlineStatus(isOnline: boolean): void {
    this.deps.manager.setOnlineStatus(isOnline);
  }

  setActiveStatus(isActive: boolean): void {
    this.active = isActive;
    this.deps.manager.setActiveStatus(isActive);
    if (this._state === 'stopped' || this._state === 'stopping') return;
    if (isActive) {
      void this.poll();
      this.startPolling();
    } else {
      this.stopPolling();
      if (this._state === 'leader') {
        this.setState('follower');
        this.deps.registry.deactivate();
      }
    }
  }

  dispose(): Promise<void> {
    return this.stop();
  }

  private startPolling(): void {
    if (this.pollHandle !== null || !this.active) return;
    this.pollHandle = this.scheduler.setInterval(
      () => void this.poll(),
      this.pollIntervalMs,
    );
  }

  private stopPolling(): void {
    if (this.pollHandle !== null) {
      this.scheduler.clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  private async poll(): Promise<void> {
    if (this.polling || !this.userId) return;
    if (this._state !== 'follower' && this._state !== 'leader') return;
    this.polling = true;
    try {
      const isLead = await this.deps.lockRepo.takeLead(this.userId, this.deps.clientId);
      if (isLead && this._state === 'follower') {
        this.setState('leader');
        this.deps.registry.activate(this.userId);
      } else if (!isLead && this._state === 'leader') {
        this.setState('follower');
        this.deps.registry.deactivate();
      }
    } catch (cause) {
      console.warn('Take lead request failed. Will retry.', { cause });
    } finally {
      this.polling = false;
    }
  }

  private setState(state: BackgroundState): void {
    this._state = state;
    this.deps.events.emit('background:state', { state });
  }
}
```

- [ ] **Step 4: Run, verify it passes** — `bun test src/domains/background.test.ts` → all pass. `cd -`.

- [ ] **Step 5: Commit**

```bash
git add packages/wallet-sdk/src/domains/background.ts packages/wallet-sdk/src/domains/background.test.ts
git commit -m "feat(wallet-sdk): BackgroundDomain (5s poll/6s lease leader election) + tests (base 4c)"
```

---

### Task 14: Sdk engine seam wiring + resync + dispose + final gate

**Files:**
- Modify: `packages/wallet-sdk/src/sdk.ts`

Wire the engine into `Sdk.create`, build the background stack when a `createEngine` is supplied, expose `sdk.background`, and route `resync`/`dispose`.

- [ ] **Step 1: Add imports** to `sdk.ts`:

```typescript
import type { CreateEngine } from './engine';
import { BackgroundDomain } from './domains/background';
import { ProcessorRegistry } from './internal/background/processor-registry';
import { TaskProcessingLockRepository } from './internal/background/task-processing-lock-repository';
import { ChangeFeed } from './internal/realtime/change-feed';
import { createRealtimeManager } from './internal/realtime/realtime-client';
import { CashuSendQuoteProcessor } from './internal/background/processors/cashu-send-quote-processor';
import { CashuSendSwapProcessor } from './internal/background/processors/cashu-send-swap-processor';
import { SparkSendQuoteProcessor } from './internal/background/processors/spark-send-quote-processor';
import { CashuReceiveQuoteProcessor } from './internal/background/processors/cashu-receive-quote-processor';
import { CashuReceiveSwapProcessor } from './internal/background/processors/cashu-receive-swap-processor';
import { SparkReceiveQuoteProcessor } from './internal/background/processors/spark-receive-quote-processor';
```

- [ ] **Step 2: Add a `background` field + constructor param.** Add `readonly background?: BackgroundDomain` to the class and to the private constructor `parts` (optional — absent when no engine was injected).

- [ ] **Step 3: Extend `create`'s deps + build the stack.** Change the signature to `deps: { openSecret?: OpenSecret; createEngine?: CreateEngine } = {}`. After `walletRuntime` is built and before constructing `Sdk`, add:

```typescript
let background: BackgroundDomain | undefined;
if (deps.createEngine) {
  const engine = deps.createEngine({ events, runtime: walletRuntime, config });
  const p = walletRuntime.protocols;
  const w = engine.wallets;
  const processors = {
    cashuSendQuote: new CashuSendQuoteProcessor({
      service: p.cashuSendQuoteService,
      runner: engine.runner,
      wallets: w,
      fetchWorkSet: (userId) => engine.workSets.getUnresolvedCashuSendQuotes(userId),
    }),
    cashuSendSwap: new CashuSendSwapProcessor({
      service: p.cashuSendSwapService,
      runner: engine.runner,
      wallets: w,
      fetchWorkSet: (userId) => engine.workSets.getUnresolvedCashuSendSwaps(userId),
    }),
    sparkSendQuote: new SparkSendQuoteProcessor({
      service: p.sparkSendQuoteService,
      runner: engine.runner,
      wallets: w,
      fetchWorkSet: (userId) => engine.workSets.getUnresolvedSparkSendQuotes(userId),
    }),
    cashuReceiveQuote: new CashuReceiveQuoteProcessor({
      service: p.cashuReceiveQuoteService,
      runner: engine.runner,
      wallets: w,
      fetchWorkSet: (userId) => engine.workSets.getPendingCashuReceiveQuotes(userId),
    }),
    cashuReceiveSwap: new CashuReceiveSwapProcessor({
      service: p.cashuReceiveSwapService,
      runner: engine.runner,
      wallets: w,
      fetchWorkSet: (userId) => engine.workSets.getPendingCashuReceiveSwaps(userId),
    }),
    sparkReceiveQuote: new SparkReceiveQuoteProcessor({
      service: p.sparkReceiveQuoteService,
      runner: engine.runner,
      wallets: w,
      fetchWorkSet: (userId) => engine.workSets.getPendingSparkReceiveQuotes(userId),
    }),
  };
  const registry = new ProcessorRegistry(processors);
  const manager = createRealtimeManager(db);
  const changeFeed = new ChangeFeed({
    manager,
    events,
    routerDeps: {
      accountRepository: walletRuntime.accountRepository,
      transactionRepository: p.transactionRepository,
      cashuSendQuoteRepository: p.cashuSendQuoteRepository,
      cashuSendSwapRepository: p.cashuSendSwapRepository,
      cashuReceiveQuoteRepository: p.cashuReceiveQuoteRepository,
      cashuReceiveSwapRepository: p.cashuReceiveSwapRepository,
      sparkSendQuoteRepository: p.sparkSendQuoteRepository,
      sparkReceiveQuoteRepository: p.sparkReceiveQuoteRepository,
      domain: config.domain ?? '',
    },
    fanout: engine.fanout,
    trigger: registry,
  });
  background = new BackgroundDomain({
    lockRepo: new TaskProcessingLockRepository(db),
    changeFeed,
    registry,
    manager,
    events,
    getUserId: getCurrentUserId,
    clientId: config.clientId ?? crypto.randomUUID(),
  });
}
```

Pass `background` into the `new Sdk({ ..., background })`. (Confirm the exact `ChangeFeedRouterDeps` shape against `change-feed-router.ts` — the converter `Pick`s — and that `getCurrentUserId` returns `Promise<string | null>` as `BackgroundDeps.getUserId` requires; it does.)

- [ ] **Step 4: Wire `resync`** — replace the no-op body:

```typescript
async resync(): Promise<void> {
  this.background?.resync();
}
```

- [ ] **Step 5: Extend `dispose`** — stop background **first** (so processors/feed tear down before the runtime's wallets/keys go away):

```typescript
async dispose(): Promise<void> {
  await this.background?.stop();
  this.auth.cancelSessionExpiry();
  await this[walletRuntimeKey].dispose();
  this.keys.clear();
  this.sessionToken.clear();
  this.events.clear();
}
```

- [ ] **Step 6: Full-repo gate** — from repo root:

```bash
bun run typecheck && bun run test
```

Expect: 8 packages typecheck exit 0; wallet-sdk tests (44 prior + OncePerKey 3 + mint-classification 5 + BackgroundDomain 6) pass; web-wallet 57 pass; 0 fail. **Do NOT run `fix:all`.** If the working tree shows unrelated churn, `git checkout -- .` and re-run the gate.

- [ ] **Step 7: Commit**

```bash
git add packages/wallet-sdk/src/sdk.ts
git commit -m "feat(wallet-sdk): wire engine seam + BackgroundDomain into Sdk (start/stop/resync/dispose) (base 4c)"
```

---

## Self-review (run after the plan is complete, before reporting)

- **Spec coverage:** six processors (Tasks 6-11) ✓; `WorkSetSource` port (Task 1) ✓; `TaskProcessingLockRepository` (Task 2) ✓; `BackgroundDomain` leader election w/ states stopped|starting|follower|leader|stopping + 5s/6s (Task 13) ✓; `Sdk` engine-injection seam (Tasks 1, 14) ✓; `ChangeFeed` wired into `BackgroundDomain` (Task 14) ✓; lane-key typo collapse (Task 11) ✓; melt-tracker rename (Task 4) ✓; online/active forwarding (Task 13) ✓; `.catch` hardening at every tracker-callback service op (Tasks 6-11) ✓; WS teardown on leader→follower/stop via `registry.deactivate`→`processor.dispose` (Tasks 12, 13) ✓.
- **Carry-forwards addressed:** 4b #1 (host online/offline → `setOnlineStatus`/`setActiveStatus`) is exposed on `sdk.background` (Task 13) for the host to call; 4a/4b WS-teardown-on-stop ✓; melt rename ✓.
- **Type consistency:** `Processor.reload(userId)`/`dispose()` used uniformly (Tasks 5-12); `defaultRetryPolicy` everywhere; lane prefixes match the app verbatim except the collapsed spark-receive hyphen.
- **Open verify-during-exec flags** (each task re-confirms against landed source): exact `CashuSendQuote`/melt-quote field names + `usePendingMeltQuotes` derivations (Tasks 6, 9, 11); whether services take a `CashuAccount`/`SparkAccount` object vs a wallet → add `getCashuAccount`/`getSparkAccount` to `WalletAccess` if so (Tasks 6, 8); `ChangeFeedRouterDeps` converter `Pick` shape (Task 14); `AgicashDb` import path (Task 2).

## Execution notes

- **Subagent-driven, gate = `typecheck` + `test`, NEVER `fix:all`** (loud prohibition in every prompt). Fresh sonnet implementer + sonnet spec-review per task; **dedicated OPUS quality-reviewer on Tasks 3, 9, 13** (new pure logic) **+ a final holistic OPUS review**.
- Push of `sdkx/base` (3b+4a+4b+4c) stays gated on the Breez-connect smoke (needs `VITE_BREEZ_API_KEY`) + user nod — **do NOT push autonomously.**
- After 4c: write+execute Plan 5 (server-mode SDK + LN-address routes), then the two variant plans (A stateless / B store), each supplying a concrete `createEngine` (runner + workSets + wallets + fanout) and deleting the app's duplicated TanStack copies in its web-migration.
