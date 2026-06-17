# Wallet SDK Base — Plan 4a: runTask seam + retry policy + subscription feeds

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the framework-free *feeds and seams* the six background processors will consume — the `runTask` lane-dispatch **port** (no concrete impl), the unified `RetryPolicy`, the three Cashu mint NUT-17 subscription managers + their framework-free trackers (WS + polling fallback + expiry), and the Breez payment-event bridge (with listener-before-lookup race handling) — inside `@agicash/wallet-sdk`.

**Architecture:** This is the first of three base-Plan-4 sub-plans (4a feeds/seams → 4b change-feed → 4c processors+leader+background). Per the confirmed design, the concrete lane dispatcher and the processor work-set source are **injected ports with no base default** (variant A = `KeyedQueue` + DB-on-demand; variant B = patched query-core scopes + stores). So 4a ships the `TaskRunner` **port type** only — not a runner. Everything else in 4a is concrete framework-free code: the subscription managers are near-verbatim copies of the app's already-React-free classes; the trackers and the Breez bridge are de-React'd ports of the app's `useOnMintQuoteStateChange` / `useOnMeltQuoteStateChange` / `useOnProofStateChange` / `useOnSparkSendStateChange` / `useOnSparkReceiveStateChange` hooks (the `useEffect` subscribe/teardown + `useLatest` refs become `update(...)` / `dispose()` on a class instance). The app keeps its own hook copies fully intact; they are deleted later in the variant web-migration.

**Tech stack:** TypeScript, bun, `@cashu/cashu-ts` (NUT-17 WS API `wallet.on.*Updates`), `@agicash/breez-sdk-spark` (Node build, `addEventListener`/`getPayment`/`getPaymentByInvoice`), `@agicash/money` (`Currency`), `@agicash/wallet-sdk` internal modules landed in 3a/3b (`internal/cashu/wallet`, `domains/cashu-proof`, `domains/cashu-send-swap`, `domains/spark-*-quote`, `internal/timeout`, `src/errors`).

**Gate (every task, NEVER `fix:all`):** `cd packages/wallet-sdk && bun run typecheck` then from repo root `bun run test` (or the wallet-sdk test script). `fix:all` is `biome check --write` and reorders imports across the whole repo — do not run it; reviewers must not run it; if pollution appears, `git checkout -- .` (all task work is committed). The real type gate is `typecheck` (`tsc`), which catches dangling imports in every form (alias/relative/value/type-only); a production build erases `import type`, so build alone misses type-only dangling imports.

**Testing posture (confirmed: minimal, like 3a/3b):** No new unit tests in 4a. Acceptance = code typechecks + the existing wallet-sdk + web-wallet suites stay green (8 packages). The subscription managers are byte-ports of untested app code; the trackers/bridge are de-React'd ports of untested app hooks — nothing to port. Live validations are out of scope for this worktree (no live stack / no `VITE_BREEZ_API_KEY`): the headless Breez-connect smoke (`packages/wallet-sdk/examples/spark-connect-smoke.ts`, written in 3a, still UNRUN) and any WS-against-a-real-mint check remain documented carry-overs to run before the variant PRs merge.

**Reach into landed foundation:** 3b exposes the protocol services/repos via `sdk[walletRuntimeKey].protocols`. 4a adds NO wiring into `WalletRuntime` or `Sdk` — it only lands standalone modules + `package.json` export entries. The processors (4c) are what instantiate the trackers/bridge and inject the runner; 4a just makes the building blocks importable and typecheck-clean.

---

## File structure (created in 4a)

```
packages/wallet-sdk/src/internal/
├── set-utils.ts                              # NEW — isSubset (copied; app lib/utils.ts is app-only)
├── with-retry.ts                             # NEW — withRetry helper (copied from app; used by mint-quote-tracker expiry)
├── tasks/
│   ├── task-runner.ts                        # NEW — TaskRunner port type + RetryPolicy type (NO impl)
│   └── retry-policy.ts                       # NEW — unified classification + backoff + named policies
├── cashu/
│   ├── mint-quote-subscription-manager.ts    # COPY of app lib/cashu/mint-quote-subscription-manager.ts
│   ├── melt-quote-subscription-manager.ts    # COPY of app lib/cashu/melt-quote-subscription-manager.ts
│   ├── proof-state-subscription-manager.ts   # COPY of app features/send/proof-state-subscription-manager.ts
│   ├── mint-quote-tracker.ts                 # NEW — de-React'd useOnMintQuoteStateChange (WS+poll+expiry)
│   ├── melt-quote-tracker.ts                 # NEW — de-React'd useOnMeltQuoteStateChange (shared by 3 processors)
│   └── proof-state-tracker.ts                # NEW — de-React'd useOnProofStateChange
└── spark/
    └── spark-event-bridge.ts                 # NEW — de-React'd useOnSparkSend/ReceiveStateChange (race + dedup)
```

Plus added `exports` entries in `packages/wallet-sdk/package.json` for every app-facing path (the app's tsc, moduleResolution Bundler, does NOT honor the `"./*"` catch-all for deep imports — every deep import needs an explicit entry, per the 3a/3b lesson). 4a's modules are SDK-internal (consumed by 4c, also in-SDK), so export entries are needed ONLY if a test or example imports them directly; add them defensively for `internal/tasks/*` and `internal/cashu/*-tracker` only if a consumer outside `src/` references them (it won't in 4a — so likely zero new exports in 4a; the relative-path imports inside `src/` resolve without exports). Confirm with typecheck.

---

## Task 1: `TaskRunner` port + unified `RetryPolicy`

**Files:**
- Create: `packages/wallet-sdk/src/internal/tasks/task-runner.ts`
- Create: `packages/wallet-sdk/src/internal/tasks/retry-policy.ts`

Context: today serialization is TanStack mutation **scopes** (same `scope.id` ⇒ FIFO sequential; different ⇒ parallel — proven in `@tanstack/query-core/src/mutationCache.ts` `canRun`/`runNext`). The retry config is scattered across the six processor hooks: mostly `retry: 3`, with `(failureCount, error) => error instanceof MintOperationError ? false : failureCount < 3` on the melt/initiate operations, and `retry: 5` on subscription setup; the default `retryDelay` is query-core's `min(1000 * 2 ** failureCount, 30000)`. 4a unifies the *classification* into one policy; the *concrete runner* that applies it is variant work (no base impl).

- [ ] **Step 1: Write `task-runner.ts` — the port type (no implementation)**

```ts
import type { RetryPolicy } from './retry-policy';

/**
 * Serialization-lane dispatcher seam. Processor code calls `runTask(lane, fn, policy)`
 * and never sees the concrete engine. Tasks sharing a `lane` run sequentially (FIFO);
 * tasks on different lanes run concurrently — replicating TanStack query-core mutation
 * `scope` semantics (see @tanstack/query-core MutationCache.canRun/runNext).
 *
 * The base ships NO concrete runner: variant A injects an in-memory `KeyedQueue`,
 * variant B injects a patched query-core `MutationObserver`-scope runner. Both must
 * honor `policy` (retry classification + backoff) and query-core's failureCount
 * semantics (incremented per failure, predicate checked after increment).
 */
export type TaskRunner = {
  runTask<T>(lane: string, fn: () => Promise<T>, policy?: RetryPolicy): Promise<T>;
};

export type { RetryPolicy } from './retry-policy';
```

- [ ] **Step 2: Write `retry-policy.ts` — unified classification + backoff + named policies**

`MintOperationError` is imported from `@cashu/cashu-ts`; `DomainError` / `ConcurrencyError` from the SDK error module (`src/errors.ts` — verify the relative depth from `internal/tasks/` is `../../errors`; the SDK already exports these, app re-exports via `~/features/shared/error`).

```ts
import { MintOperationError } from '@cashu/cashu-ts';
import { ConcurrencyError, DomainError } from '../../errors';

/**
 * Retry classification + backoff applied by the concrete `TaskRunner`.
 * - `shouldRetry(failureCount, error)` → true = retry, false = give up.
 * - `retryDelay(failureCount)` → ms before the next attempt.
 */
export type RetryPolicy = {
  shouldRetry: (failureCount: number, error: unknown) => boolean;
  retryDelay: (failureCount: number) => number;
};

/** query-core's default mutation backoff: 1s, 2s, 4s, … capped at 30s. */
export const exponentialBackoff = (failureCount: number): number =>
  Math.min(1000 * 2 ** failureCount, 30000);

/**
 * Unified classification (spec §Serialization lanes & retry policy):
 * ConcurrencyError → always retry; DomainError / MintOperationError → never;
 * everything else (transient) → bounded by `maxAttempts`.
 * `maxAttempts` mirrors the app's `failureCount < N` predicates.
 */
export const classifyRetry =
  (maxAttempts: number) =>
  (failureCount: number, error: unknown): boolean => {
    if (error instanceof ConcurrencyError) return true;
    if (error instanceof DomainError) return false;
    if (error instanceof MintOperationError) return false;
    return failureCount < maxAttempts;
  };

/** Bounded-3 policy for processor state transitions. */
export const defaultRetryPolicy: RetryPolicy = {
  shouldRetry: classifyRetry(3),
  retryDelay: exponentialBackoff,
};

/** Bounded-5 policy for subscription setup (matches the app's `retry: 5`). */
export const subscriptionRetryPolicy: RetryPolicy = {
  shouldRetry: classifyRetry(5),
  retryDelay: exponentialBackoff,
};
```

- [ ] **Step 3: Verify gate**

Run: `cd packages/wallet-sdk && bun run typecheck`
Expected: exit 0. If `../../errors` is wrong, locate the SDK error module (it is the source of the `ConcurrencyError`/`DomainError` the app re-exports from `@agicash/wallet-sdk`) and fix the relative path; confirm `MintOperationError` is a value export (not type-only) from `@cashu/cashu-ts` (it is — used with `instanceof` in the app).

- [ ] **Step 4: Commit**

```bash
git add packages/wallet-sdk/src/internal/tasks/
git commit -m "feat(wallet-sdk): runTask port + unified retry policy (base 4a)"
```

---

## Task 2: Copy the three NUT-17 subscription managers + `isSubset` helper

**Files:**
- Create: `packages/wallet-sdk/src/internal/set-utils.ts`
- Create: `packages/wallet-sdk/src/internal/cashu/mint-quote-subscription-manager.ts`
- Create: `packages/wallet-sdk/src/internal/cashu/melt-quote-subscription-manager.ts`
- Create: `packages/wallet-sdk/src/internal/cashu/proof-state-subscription-manager.ts`
- Source (copy from, leave untouched): `apps/web-wallet/app/lib/cashu/mint-quote-subscription-manager.ts`, `apps/web-wallet/app/lib/cashu/melt-quote-subscription-manager.ts`, `apps/web-wallet/app/features/send/proof-state-subscription-manager.ts`

These three app classes are already 100% framework-free. COPY (do not git-mv) — the app's processor hooks still use them until the variant web-migration; the SDK copies will later be wrapped by trackers that add polling/expiry, so they must diverge independently. This matches the 3a/3b "COPY + keep the app's copy intact" pattern.

- [ ] **Step 1: Create `internal/set-utils.ts` (copy `isSubset` from app `lib/utils.ts:12`)**

`isSubset` is defined only in `apps/web-wallet/app/lib/utils.ts` (app-only; `@agicash/utils` holds json/zod/type-utils, not this). Copy it verbatim:

```ts
/** True if every member of `subset` is in `superset`. Uses native Set.isSubsetOf when available. */
export function isSubset<T>(subset: Set<T>, superset: Set<T>): boolean {
  const isSubsetOf = (
    subset as Set<T> & {
      isSubsetOf?: (other: ReadonlySet<T>) => boolean;
    }
  ).isSubsetOf;

  if (typeof isSubsetOf === 'function') {
    return isSubsetOf.call(subset, superset);
  }

  for (const member of subset) {
    if (!superset.has(member)) return false;
  }
  return true;
}
```

(Read the app source first and reproduce its exact body, including the fallback loop, rather than relying on this paraphrase.)

- [ ] **Step 2: Copy the three managers verbatim, then repoint imports only**

For each copied file, the ONLY edits are the import lines. Body is byte-identical.

`mint-quote-subscription-manager.ts` and `melt-quote-subscription-manager.ts` — change:
```ts
import { getCashuWallet } from '~/lib/cashu';      // OLD
import { isSubset } from '~/lib/utils';            // OLD
```
to:
```ts
import { getCashuWallet } from './wallet';         // SDK internal/cashu/wallet
import { isSubset } from '../set-utils';
```
(`MintQuoteBolt11Response` / `MeltQuoteBolt11Response` stay imported from `@cashu/cashu-ts`.)

`proof-state-subscription-manager.ts` — change:
```ts
import { getCashuWallet } from '~/lib/cashu';                      // OLD
import { isSubset } from '~/lib/utils';                            // OLD
import { toProof } from '../accounts/cashu-account';               // OLD
import type { CashuSendSwap, PendingCashuSendSwap } from './cashu-send-swap';  // OLD
```
to:
```ts
import { getCashuWallet } from './wallet';
import { isSubset } from '../set-utils';
import { toProof } from '../../domains/cashu-proof';
import type { CashuSendSwap, PendingCashuSendSwap } from '../../domains/cashu-send-swap';
```
(`Proof`, `ProofState` stay from `@cashu/cashu-ts`.) Verify these four SDK paths resolve: `internal/cashu/wallet` exists (3a), `domains/cashu-proof` exists (3a, exports `toProof`), `domains/cashu-send-swap` exists (3b, exports `CashuSendSwap`/`PendingCashuSendSwap`). Read each to confirm the symbol is exported before finalizing.

- [ ] **Step 3: Verify gate**

Run: `cd packages/wallet-sdk && bun run typecheck` → exit 0.
Then `bun run test` (from the location your repo uses for the wallet-sdk suite) → wallet-sdk 44 / web-wallet 57 / 0 fail unchanged.

- [ ] **Step 4: Commit**

```bash
git add packages/wallet-sdk/src/internal/set-utils.ts packages/wallet-sdk/src/internal/cashu/*-subscription-manager.ts
git commit -m "feat(wallet-sdk): copy NUT-17 mint/melt/proof subscription managers into SDK (base 4a)"
```

---

## Task 3: `MeltQuoteTracker` (de-React'd `useOnMeltQuoteStateChange`)

**Files:**
- Create: `packages/wallet-sdk/src/internal/cashu/melt-quote-tracker.ts`
- Source (port from): `apps/web-wallet/app/lib/cashu/melt-quote-subscription.ts` (the `useOnMeltQuoteStateChange` hook, lines 26–148)

This tracker is shared by THREE processors (cashu-send-quote, cashu-receive-quote token path, spark-receive-quote token path), so it must be a reusable class. It owns one `MeltQuoteSubscriptionManager` and a set of expiry timers; the React `useEffect`s become `update()` (re-subscribe + reschedule expiry) and `dispose()` (clear timers). The `useLatest` callback refs become plain fields set on each `update()`.

Preserve verbatim: the `handleMeltQuoteUpdate` state logic — UNPAID → `onUnpaid` if `expiryInMs > now` else (only when `handleExpiry`) `onExpired`; PENDING → `onPending`; PAID → the **nutshell change-refetch quirk** (if `inputAmount > meltQuote.amount` and the update carries no `change`, refetch via `getWallet(mintUrl,currency).checkMeltQuoteBolt11(id)` and pass the refetched quote to `onPaid`, else pass the original) — and the per-quote `setLongTimeout` expiry that calls `checkMeltQuoteBolt11` then `handleMeltQuoteUpdate(quote, true)`.

- [ ] **Step 1: Write `melt-quote-tracker.ts`**

```ts
import type { Currency } from '@agicash/money';
import { type MeltQuoteBolt11Response, MeltQuoteState } from '@cashu/cashu-ts';
import { type LongTimeout, clearLongTimeout, setLongTimeout } from '../timeout';
import type { ExtendedCashuWallet } from './wallet';
import { MeltQuoteSubscriptionManager } from './melt-quote-subscription-manager';

export type MeltQuoteTrackerQuote = {
  id: string;
  mintUrl: string;
  currency: Currency;
  expiryInMs: number;
  inputAmount: number;
};

export type MeltQuoteTrackerCallbacks = {
  getWallet: (mintUrl: string, currency: Currency) => ExtendedCashuWallet;
  onUnpaid?: (meltQuote: MeltQuoteBolt11Response) => void;
  onPending?: (meltQuote: MeltQuoteBolt11Response) => void;
  onPaid?: (meltQuote: MeltQuoteBolt11Response) => void;
  onExpired?: (meltQuote: MeltQuoteBolt11Response) => void;
};

/**
 * Framework-free port of `useOnMeltQuoteStateChange`. Subscribes the given melt quotes
 * over NUT-17 (per mint), schedules expiry checks (sockets do not emit on expiry), and
 * classifies each update into onUnpaid/onPending/onPaid/onExpired. Reusable across
 * processors; the caller owns one instance and calls `update()` whenever its melt-quote
 * work set changes, then `dispose()` on teardown.
 */
export class MeltQuoteTracker {
  private readonly manager = new MeltQuoteSubscriptionManager();
  private timeouts: LongTimeout[] = [];
  private quotes: MeltQuoteTrackerQuote[] = [];
  private callbacks: MeltQuoteTrackerCallbacks | null = null;

  /** Forwarded so the cashu-send-quote processor can drop a quote's melt sub without unsubscribing the mint. */
  removeQuoteFromSubscription(args: { mintUrl: string; quoteId: string }): void {
    this.manager.removeQuoteFromSubscription(args);
  }

  update(quotes: MeltQuoteTrackerQuote[], callbacks: MeltQuoteTrackerCallbacks): void {
    this.callbacks = callbacks;
    this.quotes = quotes;

    this.clearTimers();
    if (quotes.length === 0) return;

    // Subscribe per mint (manager dedups by isSubset).
    const quotesByMint = quotes.reduce<Record<string, string[]>>((acc, q) => {
      (acc[q.mintUrl] ??= []).push(q.id);
      return acc;
    }, {});
    for (const [mintUrl, quoteIds] of Object.entries(quotesByMint)) {
      // Subscription setup retries up to 5× in the app; the variant runner applies
      // subscriptionRetryPolicy when 4c wraps this. Here, attempt once and log on error
      // (matches a single mount; re-`update()` re-attempts).
      void this.manager
        .subscribe({ mintUrl, quoteIds, onUpdate: (mq) => this.handle(mq) })
        .catch((cause) =>
          console.error('Error subscribing to melt quote updates', { mintUrl, cause }),
        );
    }

    for (const quote of quotes) {
      const msUntilExpiration = quote.expiryInMs - Date.now();
      const t = setLongTimeout(async () => {
        try {
          const wallet = this.callbacks?.getWallet(quote.mintUrl, quote.currency);
          if (!wallet) return;
          const meltQuote = await wallet.checkMeltQuoteBolt11(quote.id);
          await this.handle(meltQuote, true);
        } catch (cause) {
          console.error('Error checking melt quote upon expiration', { cause });
        }
      }, msUntilExpiration);
      this.timeouts.push(t);
    }
  }

  dispose(): void {
    this.clearTimers();
    this.callbacks = null;
    this.quotes = [];
  }

  private clearTimers(): void {
    for (const t of this.timeouts) clearLongTimeout(t);
    this.timeouts = [];
  }

  private async handle(meltQuote: MeltQuoteBolt11Response, handleExpiry = false): Promise<void> {
    const cb = this.callbacks;
    if (!cb) return;
    const quoteData = this.quotes.find((q) => q.id === meltQuote.quote);
    if (!quoteData) return;

    if (meltQuote.state === MeltQuoteState.UNPAID) {
      if (new Date(quoteData.expiryInMs) > new Date()) {
        cb.onUnpaid?.(meltQuote);
      } else if (handleExpiry) {
        cb.onExpired?.(meltQuote);
      }
    } else if (meltQuote.state === MeltQuoteState.PENDING) {
      cb.onPending?.(meltQuote);
    } else if (meltQuote.state === MeltQuoteState.PAID) {
      // nutshell omits change on PAID updates — refetch to get change proofs.
      // https://github.com/cashubtc/nutshell/pull/788
      const expectChange = quoteData.inputAmount > meltQuote.amount;
      if (expectChange && !(meltQuote.change && meltQuote.change.length > 0)) {
        const wallet = cb.getWallet(quoteData.mintUrl, quoteData.currency);
        const meltQuoteWithChange = await wallet.checkMeltQuoteBolt11(quoteData.id);
        cb.onPaid?.(meltQuoteWithChange);
      } else {
        cb.onPaid?.(meltQuote);
      }
    }
  }
}
```

Verify against source: read `melt-quote-subscription.ts:49–147` and confirm the classification branches, the expiry-timer body, and the nutshell quirk are preserved exactly. Confirm `ExtendedCashuWallet` exposes `checkMeltQuoteBolt11(id)` (it does — app `getWallet(...).checkMeltQuoteBolt11`). Note the one intentional behavioral simplification to flag in review: the app's subscribe retry (`retry: 5`) is not applied here because there is no runner in base — 4c supplies the runner and re-`update()` re-attempts; document this in the task report.

- [ ] **Step 2: Verify gate** — `cd packages/wallet-sdk && bun run typecheck` → 0; `bun run test` green.

- [ ] **Step 3: Commit**

```bash
git add packages/wallet-sdk/src/internal/cashu/melt-quote-tracker.ts
git commit -m "feat(wallet-sdk): framework-free melt-quote tracker (base 4a)"
```

---

## Task 4: `MintQuoteTracker` (de-React'd `useOnMintQuoteStateChange`)

**Files:**
- Create: `packages/wallet-sdk/src/internal/cashu/mint-quote-tracker.ts`
- Create: `packages/wallet-sdk/src/internal/with-retry.ts` (copy `withRetry` from the app — used by the WS expiry recheck)
- Source (port from): `apps/web-wallet/app/features/receive/cashu-receive-quote-hooks.ts` — `checkIfMintSupportsWebSocketsForMintQuotes` (328–344), `useTrackMintQuotesWithPolling` (354–398), `useTrackMintQuotesWithWebSocket` (408–480), `usePartitionQuotesByStateCheckType` (482+).

The tracker partitions the quote set by NUT-17 mint-quote WS support: supported mints → `MintQuoteSubscriptionManager` + per-quote expiry timers (with `withRetry` recheck on expiry); unsupported mints → framework-free polling (replacing the app's `useQueries` `refetchInterval`): `setInterval` every 10s, backing off to 60s on a `429` (`HttpResponseError.status === 429`), calling `checkMintQuoteBolt11` then the update callback. `update()` re-partitions/re-subscribes/reschedules; `dispose()` clears all intervals + timers.

- [ ] **Step 1: Copy `withRetry` into `internal/with-retry.ts`**

Find the app's `withRetry` (imported in `cashu-receive-quote-hooks.ts`; grep `export.*withRetry` / `function withRetry`). Copy it verbatim into the SDK (framework-free). If it lives in app `lib/`, reproduce its exact signature (`withRetry({ fn, retry })`).

- [ ] **Step 2: Write `mint-quote-tracker.ts`**

Interface (port the partition + WS + polling + expiry; bodies from the source above):

```ts
import { type MintQuoteBolt11Response, HttpResponseError } from '@cashu/cashu-ts';
import { type LongTimeout, clearLongTimeout, setLongTimeout } from '../timeout';
import { withRetry } from '../with-retry';
import { MintQuoteSubscriptionManager } from './mint-quote-subscription-manager';
import type { ExtendedCashuWallet } from './wallet';

export type MintQuoteTrackerQuote = {
  quoteId: string;
  accountId: string;
  mintUrl: string;
  currency: string;
  state: string;        // 'UNPAID' | 'PAID' | 'ISSUED' | ...
  expiresAt: string;
};

export type MintQuoteTrackerDeps = {
  // mint-quote WS support per the quote's account wallet (NUT-17 isSupported(17), bolt11_mint_quote command)
  getWallet: (accountId: string) => ExtendedCashuWallet;
  onUpdate: (mintQuote: MintQuoteBolt11Response) => void;
};

export class MintQuoteTracker {
  private readonly manager = new MintQuoteSubscriptionManager();
  private timeouts: LongTimeout[] = [];
  private intervals: ReturnType<typeof setInterval>[] = [];
  // ... update(quotes, deps) { partition → WS subscribe supported mints + expiry timers;
  //     setInterval(10s/60s-on-429) poll unsupported; } dispose() { clear all }
}
```

Port faithfully:
- `checkIfMintSupportsWebSocketsForMintQuotes`: `wallet.getMintInfo().isSupported(17)`, `params.some(p => p.method==='bolt11' && account.currency===currency && p.commands.includes('bolt11_mint_quote'))`.
- WS path: group supported quotes by mintUrl → `manager.subscribe({mintUrl, quoteIds, onUpdate})`; for `state==='UNPAID'` quotes, `setLongTimeout(expiresAt - now)` → `withRetry({ fn: () => wallet.checkMintQuoteBolt11(quoteId), retry: 5 })` → `onUpdate`.
- Polling path: per unsupported quote, `setInterval` calling `wallet.checkMintQuoteBolt11(quoteId)` → `onUpdate`; on `HttpResponseError` `status===429` widen interval to 60s, else 10s. (The app uses `staleTime:0/gcTime:0/retry:false` query semantics; the framework-free equivalent is a bare interval that swallows errors and logs — match the app's `console.warn` on error and `return null`.)

Read the source ranges and reproduce the exact predicates/intervals. Confirm `HttpResponseError` is exported by `@cashu/cashu-ts` (the app imports it).

- [ ] **Step 3: Verify gate** — typecheck 0; test green.

- [ ] **Step 4: Commit**

```bash
git add packages/wallet-sdk/src/internal/with-retry.ts packages/wallet-sdk/src/internal/cashu/mint-quote-tracker.ts
git commit -m "feat(wallet-sdk): framework-free mint-quote tracker (WS + polling fallback) (base 4a)"
```

---

## Task 5: `ProofStateTracker` (de-React'd `useOnProofStateChange`)

**Files:**
- Create: `packages/wallet-sdk/src/internal/cashu/proof-state-tracker.ts`
- Source (port from): `apps/web-wallet/app/features/send/cashu-send-swap-hooks.ts` — `useOnProofStateChange` (312–350)

Wraps `ProofStateSubscriptionManager`. The hook groups pending swaps by mint (`getCashuAccount(swap.accountId).mintUrl`) and subscribes; the manager fires `onSpent(swap)` only when ALL of a swap's proofs are SPENT (logic already inside the manager). De-React: `update(swaps, deps)` groups + subscribes (one manager instance, dedups), `dispose()` unsubscribes.

- [ ] **Step 1: Write `proof-state-tracker.ts`**

```ts
import type { CashuSendSwap, PendingCashuSendSwap } from '../../domains/cashu-send-swap';
import { ProofStateSubscriptionManager } from './proof-state-subscription-manager';

export type ProofStateTrackerDeps = {
  getMintUrl: (accountId: string) => string;        // was getCashuAccount(accountId).mintUrl
  onSpent: (swap: CashuSendSwap) => void;
};

export class ProofStateTracker {
  private readonly manager = new ProofStateSubscriptionManager();
  update(swaps: PendingCashuSendSwap[], deps: ProofStateTrackerDeps): void {
    const swapsByMint = swaps.reduce<Record<string, PendingCashuSendSwap[]>>((acc, swap) => {
      (acc[deps.getMintUrl(swap.accountId)] ??= []).push(swap);
      return acc;
    }, {});
    for (const [mintUrl, mintSwaps] of Object.entries(swapsByMint)) {
      void this.manager
        .subscribe({ mintUrl, swaps: mintSwaps, onSpent: deps.onSpent })
        .catch((cause) =>
          console.error('Failed to subscribe to proof state updates', { mintUrl, cause }),
        );
    }
  }
  // dispose(): unsubscribe — the manager returns an unsubscribe per subscribe(); track and call them.
}
```

Note: the app's `ProofStateSubscriptionManager.subscribe` returns an unsubscribe fn and self-cleans on socket close. Track the returned unsubscribers in `update()` and invoke them in `dispose()` (the app relied on effect-cleanup; the SDK must do it explicitly). Read the manager's return contract (Task 2 copy) and wire `dispose()` accordingly.

- [ ] **Step 2: Verify gate** — typecheck 0; test green.

- [ ] **Step 3: Commit**

```bash
git add packages/wallet-sdk/src/internal/cashu/proof-state-tracker.ts
git commit -m "feat(wallet-sdk): framework-free proof-state tracker (base 4a)"
```

---

## Task 6: `SparkEventBridge` (de-React'd `useOnSparkSendStateChange` + `useOnSparkReceiveStateChange`)

**Files:**
- Create: `packages/wallet-sdk/src/internal/spark/spark-event-bridge.ts`
- Source (port from): `apps/web-wallet/app/features/send/spark-send-quote-hooks.ts` `useOnSparkSendStateChange` (148–287); `apps/web-wallet/app/features/receive/spark-receive-quote-hooks.ts` `useOnSparkReceiveStateChange` (343–450)

Preserve the **listener-before-lookup race handling** exactly: register the Breez `addEventListener` FIRST, then do the initial local lookup (`getPayment({paymentId})` for send; `getPaymentByInvoice({invoice})` for receive) — events that fired before the listener are caught by the local lookup (no network call), events after by the listener; the per-quote `lastTriggeredStateRef` dedup (a `Map<quoteId, state>`) prevents double-firing. Preserve: send fires `onUnpaid` immediately for UNPAID quotes, then listens `paymentSucceeded`→`onCompleted({paymentPreimage})` (preimage from `payment.details.htlcDetails.preimage` when `details.type==='lightning'`; error+skip if missing) / `paymentFailed`→`onFailed(message)` (message = expired vs failed by `expiresAt`). Receive: `paymentSucceeded`→match by `details.htlcDetails.paymentHash`→`onCompleted({sparkTransferId, paymentPreimage})`; `synced`→expire quotes past `expiresAt`.

- [ ] **Step 1: Write `spark-event-bridge.ts`**

De-React the two hooks into two classes (or one module with two classes). The `useLatest` refs + `useRef` dedup map → instance fields; `useEffect` body → `update(quotes, deps)`; effect cleanup → `dispose()` (the stored `removeEventListener(listenerId)` calls). Inject account access as `getWallet: (accountId) => SparkWallet` (was `getSparkAccount(accountId).wallet`); the wallet type is `@agicash/breez-sdk-spark`'s SDK type exposing `addEventListener`/`removeEventListener`/`getPayment`/`getPaymentByInvoice`.

```ts
import type { Payment } from '@agicash/breez-sdk-spark';
import type { SparkSendQuote } from '../../domains/spark-send-quote';
import type { SparkReceiveQuote } from '../../domains/spark-receive-quote';
// sparkDebugLog: VERIFY-DURING-EXEC — 3a moved pure shared/spark into the SDK; import from its
// landed SDK location (grep the SDK for sparkDebugLog). If it did not move, copy the one-liner in.

type SparkWallet = /* the @agicash/breez-sdk-spark instance type used by SparkAccount['wallet'] */;

export class SparkSendStateTracker {
  private readonly lastTriggeredState = new Map<string, SparkSendQuote['state']>();
  private cleanups: (() => void)[] = [];
  update(sendQuotes: SparkSendQuote[], deps: {
    getWallet: (accountId: string) => SparkWallet;
    onUnpaid: (q: SparkSendQuote) => void;
    onCompleted: (q: SparkSendQuote, p: { paymentPreimage: string }) => void;
    onFailed: (q: SparkSendQuote, reason: string) => void;
  }): void { /* port of useOnSparkSendStateChange:165–286 (drop quotes no longer present, register listener+initial lookup, dedup) */ }
  dispose(): void { for (const c of this.cleanups) c(); this.cleanups = []; }
}

export class SparkReceiveStateTracker {
  private cleanups: (() => void)[] = [];
  update(pendingQuotes: SparkReceiveQuote[], deps: {
    getWallet: (accountId: string) => SparkWallet;
    onCompleted: (quoteId: string, p: { sparkTransferId: string; paymentPreimage: string }) => void;
    onExpired: (quoteId: string) => void;
  }): void { /* port of useOnSparkReceiveStateChange:353–449 */ }
  dispose(): void { for (const c of this.cleanups) c(); this.cleanups = []; }
}
```

Verify-during-exec flags: (a) exact `SparkWallet` type name in `@agicash/breez-sdk-spark` (read its `.d.ts`; it is the value `SparkAccount['wallet']` holds — the connected `BreezSdk`); (b) `sparkDebugLog` import location in the SDK (or inline copy); (c) the `Payment.details` discriminated-union access (`details.type === 'lightning'` → `details.htlcDetails.{preimage,paymentHash}`) typechecks against the installed breez types. The dedup map for send is keyed by `quote.id`; do NOT preserve the receive path's missing-hyphen lane typo (that is a lane-key concern handled in 4c, not here).

- [ ] **Step 2: Verify gate** — `cd packages/wallet-sdk && bun run typecheck` → 0 (this is the task most likely to surface a breez type mismatch — resolve by reading `node_modules/@agicash/breez-sdk-spark` types, never by casting blindly). `bun run test` green.

- [ ] **Step 3: Commit**

```bash
git add packages/wallet-sdk/src/internal/spark/spark-event-bridge.ts
git commit -m "feat(wallet-sdk): Breez payment-event bridge with listener-before-lookup race handling (base 4a)"
```

---

## Task 7: Holistic gate + export sanity

**Files:**
- Modify (only if a consumer outside `src/` needs them): `packages/wallet-sdk/package.json` (`exports`)

- [ ] **Step 1: Full typecheck across all packages**

Run: `bun run typecheck` (repo root — `react-router typegen && tsc` across the workspace).
Expected: exit 0 for all 8 packages.

- [ ] **Step 2: Full test run**

Run: `bun run test`.
Expected: wallet-sdk 44 / web-wallet 57 / 0 fail (unchanged — 4a adds no tests and touches no app code).

- [ ] **Step 3: Barrel/headless sanity**

Confirm nothing in 4a imports React, TanStack, `window`, `document`, `navigator`, or `localStorage` (grep the new files). The trackers use `setInterval`/`setLongTimeout` (global in bun/node) only. No `package.json` export entry is needed unless a test/example imports a 4a module directly — 4a modules are consumed only by 4c (in-SDK relative imports), so expect zero export changes; if typecheck demanded one, it was added in the relevant task.

- [ ] **Step 4: Final commit (if any export/touch-ups)**

```bash
git add -A packages/wallet-sdk
git commit -m "chore(wallet-sdk): base 4a export + headless sanity"
```

---

## Self-review (against spec §Serialization lanes & retry policy, §Background processing)

- **`runTask` seam present, no base impl** — Task 1 ships the `TaskRunner` port type only; concrete runner is variant work. ✓ (matches confirmed "inject ports, no default".)
- **Retry classification unified** — Task 1 `classifyRetry`: ConcurrencyError→retry, DomainError+MintOperationError→never, transient→bounded; `defaultRetryPolicy` (3) + `subscriptionRetryPolicy` (5); `exponentialBackoff` = query-core default. ✓
- **NUT-17 subscription managers** — Task 2 copies all three (mint/melt/proof) framework-free. ✓
- **Polling fallback** — Task 4 `MintQuoteTracker` ports the 10s/`429`→60s polling that was app `useQueries`. ✓
- **Expiry timers** — Tasks 3 & 4 schedule `setLongTimeout` expiry rechecks (sockets don't emit on expiry). `internal/timeout.ts` already in SDK. ✓
- **Breez race handling** — Task 6 preserves listener-before-initial-lookup + per-quote dedup. ✓
- **Two-lane topology / processor state machines / leader election / change-feed** — NOT in 4a (4b/4c). Lane *keys* are emitted by the processors (4c); 4a only ships the dispatcher port + policy. ✓ (no spec gap introduced.)
- **Carry-overs** — Breez-connect smoke + live WS/realtime validation remain documented, non-gated (worktree lacks key/stack). ✓

## Forward to 4b / 4c

- 4b (change-feed): `SupabaseRealtimeManager` + channel-builder copy + ingestion module (decrypt→`repo.toX()`→version-stamp→core lifecycle events→trigger-processor seam→fan-out **port**); `resync()` catch-up. Recommended narrow test carve-out (your call at 4b): version-gate ordering + once-only terminal-event derivation.
- 4c (processors+leader+background): six processor classes consuming the 4a trackers + the `TaskRunner` port + a `WorkSetSource` **port**; `TaskProcessingLockRepository` copy + `BackgroundDomain` (5s poll / 6s lease; state ∈ stopped|starting|follower|leader|stopping; on-leader load work sets + resume); the lane keys live here (`initiate-cashu-send-quote-${id}` vs `cashu-send-quote-${id}`, `send-swap-${id}`, `spark-send-quote-${id}`, `cashu-receive-quote-${id}`, `receive-swap-${tokenHash}`, `spark-receive-quote-${id}` — collapse the app's missing-hyphen typo to the consistent key); `Sdk` engine-injection seam so a variant supplies the runner + work-set source + fan-out. Recommended carve-out: `BackgroundDomain` transitions via fake clock + fake lock repo.
