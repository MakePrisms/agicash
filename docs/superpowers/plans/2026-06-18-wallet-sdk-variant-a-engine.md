# Variant A (stateless) — Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Variant A's headless engine for `@agicash/wallet-sdk` — a stateless `createEngine` (in-memory KeyedQueue runner, DB-on-demand work-sets, a resident account map, and a row-event fanout on a widened event bus) plus a `createStatelessSdk` client entry — and fold in the deferred 4c leader-lifecycle hardening. All gate-verifiable headless (`bun run typecheck` + `bun run test`).

**Architecture:** Variant A supplies the frozen engine seam `createEngine(ctx) => { runner, workSets, wallets, fanout }` (`packages/wallet-sdk/src/engine.ts`). The runner is an in-memory KeyedQueue (FIFO-per-lane, concurrent across lanes, re-entrant). Work-sets read the protocol repos on demand and online-filter via a resident account map. The resident map (kept warm by the fanout's `account` events + `onCatchUp` reload) backs the synchronous `WalletAccess` getters. The fanout maps the 11-kind `ChangeFeedChange` union to Variant-A-only row events (`<entity>:created|updated`, `contact:deleted`, `connection:resync`) on a widened `EventBus<SdkEventMapA>`. A `createStatelessSdk` entry wires `createStatelessEngine` into `Sdk.create` and re-types `sdk.on` to `SdkEventMapA`. The 4c hardening adds a leader-epoch guard (registry + processors) and per-subscription NUT-17 WebSocket teardown on `deactivate`.

**Tech Stack:** TypeScript, `@agicash/wallet-sdk`, `@cashu/cashu-ts`, `bun:test`. New code lives under `packages/wallet-sdk/src/stateless/`; the 4c hardening touches `packages/wallet-sdk/src/internal/background/**` and `internal/cashu/*-subscription-manager.ts` + the trackers.

## Global Constraints

- **Gate = `bun run typecheck` + `bun run test`. NEVER `bun run fix:all`** (biome lint/format only — reorders imports repo-wide, pollutes the tree). Applies to implementers AND reviewers. Discard any pollution with `git checkout -- .` (committed work is safe).
- **Branch: `sdkx/stateless`** (worktree `.claude/worktrees/sdkx-stateless`), off the extended base `a210e9db`. Run all commands from that worktree. Do NOT touch `sdkx/base` or the original repo root.
- **Base seam is FROZEN — do not change `engine.ts`, `sdk.ts`'s createEngine consumption block, the `EventBus` class, the `ChangeFeedChange` union, or the repos.** Variant A only *implements* the seam + adds the `stateless/` dir + the `createStatelessSdk` entry. (Exception: the 4c hardening deliberately modifies `internal/background/**` + the subscription managers/trackers — Tasks 8–9 — per the resolved fork.)
- **This is the ENGINE plan only (headless).** The app web cut-over (replace bootstrap/db/session/auth glue, rewire the 13 cache classes onto `sdk.on`, delete the app's leader-election/TaskProcessor, swap the transactions queryFn) is a SEPARATE plan (Variant A — web) that can't be validated headless. Do NOT touch `apps/web-wallet/**` here.
- **Resolved forks (verbatim):** (1) split A-engine [this plan] then A-web; (2) the SDK package gains a `createStatelessSdk` client entry exposing `sdk.on` typed to `SdkEventMapA` (widened bus via a cast at the engine boundary); (3) `transaction:updated` parity → always refetch the unack count on any transaction event (handled in A-web, not here — noted for the fanout to emit both created/updated uniformly); (4) NUT-17 teardown → per-subscription `disposeAll()` on the managers, forwarded from `tracker.dispose()` ← `processor.dispose()` ← `registry.deactivate()`.
- **Frozen seam contracts (verbatim from `engine.ts`):**
  - `type TaskRunner = { runTask<T>(lane: string, fn: () => Promise<T>, policy?: RetryPolicy): Promise<T> }`
  - `type RetryPolicy = { shouldRetry: (failureCount: number, error: unknown) => boolean; retryDelay: (failureCount: number) => number }` (count is prior-failures, 0 on first; check then increment).
  - `type WorkSetSource = { getUnresolvedCashuSendQuotes(userId): Promise<CashuSendQuote[]>; getUnresolvedCashuSendSwaps(userId): Promise<CashuSendSwap[]>; getUnresolvedSparkSendQuotes(userId): Promise<SparkSendQuote[]>; getPendingCashuReceiveQuotes(userId): Promise<CashuReceiveQuote[]>; getPendingCashuReceiveSwaps(userId): Promise<CashuReceiveSwap[]>; getPendingSparkReceiveQuotes(userId): Promise<SparkReceiveQuote[]> }`
  - `type WalletAccess = { getCashuAccount(accountId: string): CashuAccount; getSparkAccount(accountId: string): SparkAccount; getCashuWalletByMint(mintUrl: string, currency: Currency): ExtendedCashuWallet; getSourceCashuWallet(mintUrl: string, currency: Currency): Promise<ExtendedCashuWallet> }` (the 3 sync getters THROW on a missing resident account; `getSourceCashuWallet` REJECTS `NetworkError` when the mint is offline).
  - `type EntityFanout = { emit(change: ChangeFeedChange): void; onCatchUp(): void }`
  - `type EngineContext = { events: EventBus<SdkCoreEventMap>; runtime: WalletRuntime; config: SdkConfig }`
  - `type SdkEngine = { runner: TaskRunner; workSets: WorkSetSource; wallets: WalletAccess; fanout: EntityFanout }`
  - `type CreateEngine = (ctx: EngineContext) => SdkEngine` (SYNCHRONOUS).
- **`ChangeFeedChange` (11 kinds, `internal/realtime/change-feed-router.ts`):** `{kind:'user';operation:'updated';entity:User}` | `{kind:'account';operation:'created'|'updated';entity:Account}` | `{kind:'transaction';operation:'created'|'updated';entity:Transaction}` | `{kind:'contact';operation:'created';entity:Contact}` | `{kind:'contact-deleted';id:string}` | `{kind:'cashu-send-quote'|'cashu-send-swap'|'cashu-receive-quote'|'cashu-receive-swap'|'spark-send-quote'|'spark-receive-quote';operation:'created'|'updated';entity:T}`. Entities are ALREADY DECRYPTED (the router ran `repo.toX`). Only `contact-deleted` is a delete; quote/swap "removals" are state-gated app-side.
- **Reachability:** `ctx.runtime.protocols.{cashuSendQuoteRepository,cashuSendSwapRepository,sparkSendQuoteRepository,cashuReceiveQuoteRepository,cashuReceiveSwapRepository,sparkReceiveQuoteRepository}` (send repos → `getUnresolved(userId, options?)`, receive repos → `getPending(userId, options?)`, each `Promise<Entity[]>`, already decrypted). `ctx.runtime.accountRepository.getAllActive(userId, options?): Promise<Account[]>`. `ctx.runtime.mintCache: MintDataCache`. `ctx.runtime.mintAuth`. `Account` carries `id`, `type`, `currency`, `isOnline`, and for cashu `mintUrl`/`wallet`/`proofs`; `CashuAccount`/`SparkAccount` = `Extract<Account,{type:...}>`.
- Model: OPUS implementer+reviewer on Tasks 1 (KeyedQueue), 2 (ResidentAccounts), 4 (Fanout+event map), 5 (entry), 7 (epoch guard); sonnet on Tasks 3 (workSets), 6 (accounts surface), 8 (WS disposeAll). OPUS final holistic (Task 9).
- Commit prefix: `feat(wallet-sdk): A-engine ...`. Base for the whole-branch diff = `a210e9db`.

---

## File Structure

New (Variant A engine, all `packages/wallet-sdk/src/stateless/`):
- `keyed-queue.ts` — `KeyedQueue implements TaskRunner` (Task 1)
- `resident-accounts.ts` — `ResidentAccounts` (resident map + `WalletAccess` + `isOnline`/`ensureLoaded`) (Task 2)
- `work-sets.ts` — `createWorkSets(runtime, accounts): WorkSetSource` (Task 3)
- `event-map.ts` — `SdkEventMapA` type (Task 4)
- `fanout.ts` — `createFanout(bus, accounts): EntityFanout` (Task 4)
- `engine.ts` — `createStatelessEngine(ctx): SdkEngine` (Task 5)
- `accounts-surface.ts` — `createStatelessAccounts(base, accounts, readUser): StatelessAccounts` (Task 6)
- `index.ts` — `createStatelessSdk`, `createStatelessEngine`, `StatelessSdk`, `SdkEventMapA` re-exports (Tasks 5–6)
- co-located `*.test.ts` per file.

Modified (4c hardening, base background — Tasks 7–8):
- `internal/background/processor-registry.ts` — leader-epoch counter
- `internal/background/processors/processor.ts` — `Processor.reload(userId, isCurrent?)` signature
- `internal/background/processors/*-processor.ts` (all 6) — stale-result guard after `await fetchWorkSet`
- `internal/cashu/{mint-quote,melt-quote,proof-state}-subscription-manager.ts` — add `disposeAll()`
- `internal/cashu/{mint-quote-tracker,melt-quote-tracker,proof-state-tracker}.ts` — `dispose()` forwards to `manager.disposeAll()`

Modified (exports): `packages/wallet-sdk/package.json` — add the `./stateless` subpath export (Task 5).

No `apps/web-wallet/**` changes anywhere in this plan.

---

### Task 1: KeyedQueue (the `TaskRunner`)

In-memory per-lane FIFO, concurrent across lanes, re-entrant (a running task may enqueue on its own lane without the queue inline-awaiting it), retry loop honoring `RetryPolicy`, and lane GC when a lane drains to idle.

**Files:**
- Create: `packages/wallet-sdk/src/stateless/keyed-queue.ts`
- Test: `packages/wallet-sdk/src/stateless/keyed-queue.test.ts`

**Interfaces:**
- Consumes: `TaskRunner`, `RetryPolicy` from the engine seam (`packages/wallet-sdk/src/engine.ts` re-exports `TaskRunner`, `RetryPolicy`; import from there or from `../internal/tasks/task-runner` + `../internal/tasks/retry-policy`).
- Produces: `class KeyedQueue implements TaskRunner` with `runTask<T>(lane, fn, policy?): Promise<T>`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, mock } from 'bun:test';
import { KeyedQueue } from './keyed-queue';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('KeyedQueue', () => {
  it('runs same-lane tasks FIFO (sequential)', async () => {
    const q = new KeyedQueue();
    const order: number[] = [];
    const p1 = q.runTask('L', async () => { await tick(); order.push(1); });
    const p2 = q.runTask('L', async () => { order.push(2); });
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  it('runs different lanes concurrently', async () => {
    const q = new KeyedQueue();
    let aRunning = false;
    let overlapped = false;
    const a = q.runTask('A', async () => { aRunning = true; await tick(); aRunning = false; });
    const b = q.runTask('B', async () => { if (aRunning) overlapped = true; });
    await Promise.all([a, b]);
    expect(overlapped).toBe(true);
  });

  it('is re-entrant: a task may enqueue on its OWN lane without deadlock', async () => {
    const q = new KeyedQueue();
    const order: string[] = [];
    let nested: Promise<unknown> | undefined;
    await q.runTask('L', async () => {
      order.push('outer-start');
      // fire-and-forget enqueue on the same lane (the contract: caller does NOT await it)
      nested = q.runTask('L', async () => { order.push('nested'); });
      order.push('outer-end');
    });
    await nested; // resolves after the outer task settled — no deadlock
    expect(order).toEqual(['outer-start', 'outer-end', 'nested']);
  });

  it('retries per policy: shouldRetry sees 0,1,2 then gives up', async () => {
    const q = new KeyedQueue();
    const seen: number[] = [];
    const policy = {
      shouldRetry: (n: number) => { seen.push(n); return n < 2; },
      retryDelay: () => 0,
    };
    let attempts = 0;
    await expect(
      q.runTask('L', async () => { attempts += 1; throw new Error('boom'); }, policy),
    ).rejects.toThrow('boom');
    expect(attempts).toBe(3); // initial + 2 retries
    expect(seen).toEqual([0, 1, 2]);
  });

  it('runs once with no retry when no policy is given', async () => {
    const q = new KeyedQueue();
    let attempts = 0;
    await expect(
      q.runTask('L', async () => { attempts += 1; throw new Error('x'); }),
    ).rejects.toThrow('x');
    expect(attempts).toBe(1);
  });

  it('garbage-collects a lane once it drains to idle', async () => {
    const q = new KeyedQueue();
    await q.runTask('L', async () => {});
    await tick();
    expect(q.laneCount).toBe(0);
  });

  it('a failing task does not break the lane for the next task', async () => {
    const q = new KeyedQueue();
    const done: string[] = [];
    const p1 = q.runTask('L', async () => { throw new Error('fail'); }).catch(() => done.push('p1-rejected'));
    const p2 = q.runTask('L', async () => { done.push('p2-ran'); });
    await Promise.all([p1, p2]);
    expect(done).toEqual(['p1-rejected', 'p2-ran']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/wallet-sdk/src/stateless/keyed-queue.test.ts`
Expected: FAIL — `KeyedQueue` not defined.

- [ ] **Step 3: Implement the KeyedQueue**

```ts
import type { RetryPolicy, TaskRunner } from '../engine';

type Lane = {
  /** Promise chain tail; the next enqueue waits on this then runs. */
  tail: Promise<unknown>;
  /** Queued-or-running tasks; the lane is removed when this reaches 0. */
  size: number;
};

/**
 * In-memory FIFO-per-lane task runner. Same lane => sequential; different lanes
 * => concurrent. Re-entrant: a running task may call `runTask` on its own lane;
 * the new task chains onto the lane tail and `runTask` returns immediately, so
 * the running task is never blocked on its own nested enqueue (no deadlock).
 * The CALLER must not `await` a nested same-lane enqueue (the processors
 * fire-and-forget via `void runner.runTask(...)`).
 */
export class KeyedQueue implements TaskRunner {
  private readonly lanes = new Map<string, Lane>();

  /** Test/observability hook: number of live lanes. */
  get laneCount(): number {
    return this.lanes.size;
  }

  runTask<T>(lane: string, fn: () => Promise<T>, policy?: RetryPolicy): Promise<T> {
    let entry = this.lanes.get(lane);
    if (!entry) {
      entry = { tail: Promise.resolve(), size: 0 };
      this.lanes.set(lane, entry);
    }
    entry.size += 1;

    const prevTail = entry.tail;
    const run = () => this.execute(fn, policy);
    // Continue the chain whether the previous task fulfilled or rejected.
    const result = prevTail.then(run, run);
    // Advance the tail to a settled marker so a rejection never breaks the chain,
    // and decrement/GC the lane once this task settles.
    entry.tail = result.then(
      () => this.onSettle(lane),
      () => this.onSettle(lane),
    );
    return result;
  }

  private onSettle(lane: string): void {
    const entry = this.lanes.get(lane);
    if (!entry) return;
    entry.size -= 1;
    if (entry.size <= 0) this.lanes.delete(lane);
  }

  private async execute<T>(fn: () => Promise<T>, policy?: RetryPolicy): Promise<T> {
    let failureCount = 0;
    for (;;) {
      try {
        return await fn();
      } catch (error) {
        if (!policy || !policy.shouldRetry(failureCount, error)) throw error;
        const delay = policy.retryDelay(failureCount);
        failureCount += 1;
        if (delay > 0) await new Promise<void>((r) => setTimeout(r, delay));
      }
    }
  }
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test packages/wallet-sdk/src/stateless/keyed-queue.test.ts` → PASS.
Run: `bun run typecheck` → 8 packages exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/wallet-sdk/src/stateless/keyed-queue.ts packages/wallet-sdk/src/stateless/keyed-queue.test.ts
git commit -m "feat(wallet-sdk): A-engine KeyedQueue runner (re-entrant FIFO-per-lane)"
```

---

### Task 2: ResidentAccounts (the `WalletAccess` + resident map)

A resident `Map<accountId, Account>` kept warm by the fanout (Task 4) and `ensureLoaded`. Backs the synchronous `WalletAccess` getters (throw on miss) and the tolerant `isOnline` lookup the work-sets use (Task 3). `getCashuWalletByMint` falls back to a bare wallet; `getSourceCashuWallet` falls back to `getInitializedCashuWallet` and rejects `NetworkError` when offline.

**Files:**
- Create: `packages/wallet-sdk/src/stateless/resident-accounts.ts`
- Test: `packages/wallet-sdk/src/stateless/resident-accounts.test.ts`

**Interfaces:**
- Consumes: `WalletAccess`, `WalletRuntime` from `../engine`; `Account`, `CashuAccount`, `SparkAccount` from `../domains/account-types`; `Currency` from `@agicash/money`; `ExtendedCashuWallet` + `getCashuWallet` from `../internal/cashu/wallet`; `getInitializedCashuWallet` from `../internal/cashu/init-wallet`; `getCashuUnit` from `@agicash/cashu`; `NetworkError` from `@cashu/cashu-ts`; `AccountRepository` via `runtime.accountRepository`; `MintDataCache` via `runtime.mintCache`.
- Produces: `class ResidentAccounts implements WalletAccess` with additionally `ensureLoaded(userId: string): Promise<void>`, `reload(userId: string): Promise<void>`, `upsert(account: Account): void`, `isOnline(accountId: string): boolean` (tolerant — false on miss).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, mock } from 'bun:test';
import { NetworkError } from '@cashu/cashu-ts';
import { ResidentAccounts } from './resident-accounts';

const cashu = (over: Record<string, unknown> = {}) =>
  ({ id: 'c1', type: 'cashu', currency: 'BTC', mintUrl: 'https://m/', isOnline: true, wallet: { tag: 'warm' }, proofs: [] }) as any;
const spark = (over: Record<string, unknown> = {}) =>
  ({ id: 's1', type: 'spark', currency: 'BTC', isOnline: true, wallet: { tag: 'spark' }, ...over }) as any;

const makeRuntime = (accounts: any[] = []) =>
  ({
    accountRepository: { getAllActive: mock(async () => accounts) },
    mintCache: { tag: 'mintCache' },
    mintAuth: { tag: 'mintAuth' },
  }) as any;

describe('ResidentAccounts', () => {
  it('ensureLoaded fills the map; getCashuAccount/getSparkAccount return residents', async () => {
    const c = cashu(); const s = spark();
    const ra = new ResidentAccounts(makeRuntime([c, s]));
    await ra.ensureLoaded('u1');
    expect(ra.getCashuAccount('c1')).toBe(c);
    expect(ra.getSparkAccount('s1')).toBe(s);
  });

  it('getCashuAccount throws on a missing/non-resident account', async () => {
    const ra = new ResidentAccounts(makeRuntime([]));
    await ra.ensureLoaded('u1');
    expect(() => ra.getCashuAccount('nope')).toThrow();
  });

  it('isOnline is tolerant: false for a missing account, reflects the resident flag', async () => {
    const ra = new ResidentAccounts(makeRuntime([cashu({ id: 'c1', isOnline: false })]));
    await ra.ensureLoaded('u1');
    expect(ra.isOnline('c1')).toBe(false);
    expect(ra.isOnline('missing')).toBe(false);
  });

  it('upsert refreshes a resident entry', async () => {
    const ra = new ResidentAccounts(makeRuntime([cashu()]));
    await ra.ensureLoaded('u1');
    const next = cashu({ wallet: { tag: 'fresh' } });
    ra.upsert(next);
    expect(ra.getCashuAccount('c1')).toBe(next);
  });

  it('getCashuWalletByMint returns the resident wallet for a matching mint+currency', async () => {
    const c = cashu();
    const ra = new ResidentAccounts(makeRuntime([c]));
    await ra.ensureLoaded('u1');
    expect(ra.getCashuWalletByMint('https://m/', 'BTC')).toBe(c.wallet);
  });

  it('getSourceCashuWallet rejects NetworkError when the mint is offline', async () => {
    const ra = new ResidentAccounts(makeRuntime([]));
    await ra.ensureLoaded('u1');
    // No resident account at this mint -> falls back to getInitializedCashuWallet.
    // Use the module mock pattern (see implementation note) to force isOnline:false.
    await expect(ra.getSourceCashuWallet('https://offline/', 'BTC')).rejects.toBeInstanceOf(NetworkError);
  });
});
```

> Implementation note for the last test: `getSourceCashuWallet`'s offline path calls `getInitializedCashuWallet` which returns `{ wallet, isOnline:false }` (it does NOT throw). Mock it via `mock.module('../internal/cashu/init-wallet', () => ({ getInitializedCashuWallet: mock(async () => ({ wallet: {}, isOnline: false })) }))` at the top of the test file (spread the real module if it has other exports). The bare-wallet fallback (`getCashuWalletByMint` non-resident) uses `getCashuWallet` — mock similarly if asserting it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/wallet-sdk/src/stateless/resident-accounts.test.ts`
Expected: FAIL — `ResidentAccounts` not defined.

- [ ] **Step 3: Implement ResidentAccounts**

```ts
import { getCashuUnit } from '@agicash/cashu';
import type { Currency } from '@agicash/money';
import { NetworkError } from '@cashu/cashu-ts';
import type { WalletAccess, WalletRuntime } from '../engine';
import type { Account, CashuAccount, SparkAccount } from '../domains/account-types';
import { getInitializedCashuWallet } from '../internal/cashu/init-wallet';
import { type ExtendedCashuWallet, getCashuWallet } from '../internal/cashu/wallet';

/**
 * The resident account map backing Variant A's synchronous WalletAccess. Loaded
 * via `ensureLoaded`/`reload` (accountRepository.getAllActive, which returns warm
 * wallets + decrypted proofs) and kept fresh by the fanout's `account` events
 * (`upsert`). The sync getters throw on a non-resident account; `isOnline` is the
 * tolerant lookup the work-set online-filter uses (false on miss).
 */
export class ResidentAccounts implements WalletAccess {
  private readonly map = new Map<string, Account>();

  constructor(private readonly runtime: WalletRuntime) {}

  async ensureLoaded(userId: string): Promise<void> {
    if (this.map.size === 0) await this.reload(userId);
  }

  async reload(userId: string): Promise<void> {
    const accounts = await this.runtime.accountRepository.getAllActive(userId);
    this.map.clear();
    for (const account of accounts) this.map.set(account.id, account);
  }

  upsert(account: Account): void {
    this.map.set(account.id, account);
  }

  isOnline(accountId: string): boolean {
    return this.map.get(accountId)?.isOnline === true;
  }

  getCashuAccount(accountId: string): CashuAccount {
    const account = this.map.get(accountId);
    if (!account || account.type !== 'cashu') {
      throw new Error(`No resident cashu account ${accountId}`);
    }
    return account;
  }

  getSparkAccount(accountId: string): SparkAccount {
    const account = this.map.get(accountId);
    if (!account || account.type !== 'spark') {
      throw new Error(`No resident spark account ${accountId}`);
    }
    return account;
  }

  getCashuWalletByMint(mintUrl: string, currency: Currency): ExtendedCashuWallet {
    const resident = this.findCashuByMint(mintUrl, currency);
    if (resident) return resident.wallet;
    return getCashuWallet(mintUrl, { unit: getCashuUnit(currency) });
  }

  async getSourceCashuWallet(
    mintUrl: string,
    currency: Currency,
  ): Promise<ExtendedCashuWallet> {
    const resident = this.findCashuByMint(mintUrl, currency);
    if (resident) {
      if (!resident.isOnline) {
        throw new NetworkError(`Mint ${mintUrl} is offline`);
      }
      return resident.wallet;
    }
    const { wallet, isOnline } = await getInitializedCashuWallet({
      mintCache: this.runtime.mintCache,
      mintUrl,
      currency,
    });
    if (!isOnline) throw new NetworkError(`Mint ${mintUrl} is offline`);
    return wallet;
  }

  private findCashuByMint(
    mintUrl: string,
    currency: Currency,
  ): CashuAccount | undefined {
    for (const account of this.map.values()) {
      if (
        account.type === 'cashu' &&
        account.currency === currency &&
        account.mintUrl === mintUrl
      ) {
        return account;
      }
    }
    return undefined;
  }
}
```

> Verify during exec: the exact `getInitializedCashuWallet` arg names (`{ mintCache, mintUrl, currency, bip39seed?, authProvider? }`) and that `getCashuWallet`'s options take `{ unit }` — confirmed in the gather, but read `internal/cashu/init-wallet.ts` + `internal/cashu/wallet.ts` to match. If mint-URL equality needs normalization, reuse `areMintUrlsEqual` from `@agicash/cashu` (the source/destination selection uses it) instead of `===`.

- [ ] **Step 4: Run tests + typecheck**

Run the test file → PASS. Run `bun run typecheck` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/wallet-sdk/src/stateless/resident-accounts.ts packages/wallet-sdk/src/stateless/resident-accounts.test.ts
git commit -m "feat(wallet-sdk): A-engine ResidentAccounts (WalletAccess + resident map)"
```

---

### Task 3: createWorkSets (the `WorkSetSource`)

DB-on-demand reads over the protocol repos, online-filtered via `ResidentAccounts.isOnline`. Each method ensures the resident map is loaded first (so the online filter — and the subsequent synchronous `WalletAccess` reads in `processor.reload`, which awaits the work-set read — operate on a warm map).

**Files:**
- Create: `packages/wallet-sdk/src/stateless/work-sets.ts`
- Test: `packages/wallet-sdk/src/stateless/work-sets.test.ts`

**Interfaces:**
- Consumes: `WorkSetSource`, `WalletRuntime` from `../engine`; `ResidentAccounts` (Task 2).
- Produces: `createWorkSets(runtime: WalletRuntime, accounts: ResidentAccounts): WorkSetSource`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, mock } from 'bun:test';
import { createWorkSets } from './work-sets';

const makeAccounts = (online: Record<string, boolean>) =>
  ({ ensureLoaded: mock(async () => {}), isOnline: (id: string) => online[id] === true }) as any;

const makeRuntime = (sendQuotes: any[]) =>
  ({
    protocols: {
      cashuSendQuoteRepository: { getUnresolved: mock(async () => sendQuotes) },
      cashuSendSwapRepository: { getUnresolved: mock(async () => []) },
      sparkSendQuoteRepository: { getUnresolved: mock(async () => []) },
      cashuReceiveQuoteRepository: { getPending: mock(async () => []) },
      cashuReceiveSwapRepository: { getPending: mock(async () => []) },
      sparkReceiveQuoteRepository: { getPending: mock(async () => []) },
    },
  }) as any;

describe('createWorkSets', () => {
  it('reads the repo then keeps only items whose account is online', async () => {
    const accounts = makeAccounts({ on: true, off: false });
    const runtime = makeRuntime([
      { id: 'q1', accountId: 'on' },
      { id: 'q2', accountId: 'off' },
      { id: 'q3', accountId: 'missing' },
    ]);
    const ws = createWorkSets(runtime, accounts);
    const result = await ws.getUnresolvedCashuSendQuotes('u1');
    expect(result.map((q: any) => q.id)).toEqual(['q1']);
    expect(accounts.ensureLoaded).toHaveBeenCalledWith('u1');
  });

  it('exposes all 6 WorkSetSource methods returning arrays', async () => {
    const ws = createWorkSets(makeRuntime([]), makeAccounts({}));
    for (const m of [
      'getUnresolvedCashuSendQuotes', 'getUnresolvedCashuSendSwaps', 'getUnresolvedSparkSendQuotes',
      'getPendingCashuReceiveQuotes', 'getPendingCashuReceiveSwaps', 'getPendingSparkReceiveQuotes',
    ] as const) {
      expect(Array.isArray(await (ws as any)[m]('u1'))).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/wallet-sdk/src/stateless/work-sets.test.ts` → FAIL (`createWorkSets` not defined).

- [ ] **Step 3: Implement createWorkSets**

```ts
import type { WalletRuntime, WorkSetSource } from '../engine';
import type { ResidentAccounts } from './resident-accounts';

/**
 * Variant A's DB-on-demand work-sets: read the protocol repo, then drop items
 * whose account is not online (tolerant — a missing account drops the item).
 * `ensureLoaded` warms the resident map before the filter, which also guarantees
 * the synchronous WalletAccess reads in `processor.reload` (which awaits this
 * read) hit a populated map.
 */
export function createWorkSets(
  runtime: WalletRuntime,
  accounts: ResidentAccounts,
): WorkSetSource {
  const onlineOnly = <T extends { accountId: string }>(items: T[]): T[] =>
    items.filter((item) => accounts.isOnline(item.accountId));

  const read = async <T extends { accountId: string }>(
    userId: string,
    fetch: (userId: string) => Promise<T[]>,
  ): Promise<T[]> => {
    await accounts.ensureLoaded(userId);
    return onlineOnly(await fetch(userId));
  };

  const p = runtime.protocols;
  return {
    getUnresolvedCashuSendQuotes: (userId) =>
      read(userId, (u) => p.cashuSendQuoteRepository.getUnresolved(u)),
    getUnresolvedCashuSendSwaps: (userId) =>
      read(userId, (u) => p.cashuSendSwapRepository.getUnresolved(u)),
    getUnresolvedSparkSendQuotes: (userId) =>
      read(userId, (u) => p.sparkSendQuoteRepository.getUnresolved(u)),
    getPendingCashuReceiveQuotes: (userId) =>
      read(userId, (u) => p.cashuReceiveQuoteRepository.getPending(u)),
    getPendingCashuReceiveSwaps: (userId) =>
      read(userId, (u) => p.cashuReceiveSwapRepository.getPending(u)),
    getPendingSparkReceiveQuotes: (userId) =>
      read(userId, (u) => p.sparkReceiveQuoteRepository.getPending(u)),
  };
}
```

> Verify during exec: every work-set entity carries `accountId: string` (confirmed for all 6 in the gather: cashu-send-quote/swap, spark-send-quote, cashu-receive-quote, cashu-receive-swap, spark-receive-quote). The repo method names are `getUnresolved` (send ×3) / `getPending` (receive ×3) — confirmed.

- [ ] **Step 4: Run tests + typecheck** → PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/wallet-sdk/src/stateless/work-sets.ts packages/wallet-sdk/src/stateless/work-sets.test.ts
git commit -m "feat(wallet-sdk): A-engine DB-on-demand work-sets (online-filtered)"
```

---

### Task 4: SdkEventMapA + the fanout

The widened A-only event map, and the `EntityFanout` that maps each `ChangeFeedChange` kind to a row event on the widened bus — and, for `account` changes, upserts the resident map BEFORE emitting (so `WalletAccess` stays fresh). `onCatchUp` reloads the resident map then emits `connection:resync`.

**Files:**
- Create: `packages/wallet-sdk/src/stateless/event-map.ts`, `packages/wallet-sdk/src/stateless/fanout.ts`
- Test: `packages/wallet-sdk/src/stateless/fanout.test.ts`

**Interfaces:**
- Consumes: `EntityFanout`, `ChangeFeedChange` from `../engine`/`../internal/realtime/*`; `EventBus` from `../internal/event-bus`; `SdkCoreEventMap` from `../events`; the entity types (`User`, `Account`, `Transaction`, `Contact`, `CashuSendQuote`, `CashuSendSwap`, `CashuReceiveQuote`, `CashuReceiveSwap`, `SparkSendQuote`, `SparkReceiveQuote`); `ResidentAccounts` (Task 2).
- Produces: `type SdkEventMapA`; `createFanout(bus: EventBus<SdkEventMapA>, accounts: ResidentAccounts): EntityFanout`.

- [ ] **Step 1: Write `event-map.ts`**

```ts
import type {
  Account, CashuReceiveQuote, CashuReceiveSwap, CashuSendQuote, CashuSendSwap,
  Contact, SparkReceiveQuote, SparkSendQuote, Transaction, User,
} from '../engine'; // re-exported entity types; if not, import from their domain modules
import type { SdkCoreEventMap } from '../events';

/** Variant A widens the core event map with decrypted-entity row events +
 * the A-only `connection:resync` catch-up signal. Removals are state-gated
 * app-side on `:updated`, so only `contact:deleted` carries an explicit delete. */
export type SdkEventMapA = SdkCoreEventMap & {
  'user:updated': { entity: User };
  'account:created': { entity: Account };
  'account:updated': { entity: Account };
  'transaction:created': { entity: Transaction };
  'transaction:updated': { entity: Transaction };
  'contact:created': { entity: Contact };
  'contact:deleted': { id: string };
  'cashu-send-quote:created': { entity: CashuSendQuote };
  'cashu-send-quote:updated': { entity: CashuSendQuote };
  'cashu-send-swap:created': { entity: CashuSendSwap };
  'cashu-send-swap:updated': { entity: CashuSendSwap };
  'cashu-receive-quote:created': { entity: CashuReceiveQuote };
  'cashu-receive-quote:updated': { entity: CashuReceiveQuote };
  'cashu-receive-swap:created': { entity: CashuReceiveSwap };
  'cashu-receive-swap:updated': { entity: CashuReceiveSwap };
  'spark-send-quote:created': { entity: SparkSendQuote };
  'spark-send-quote:updated': { entity: SparkSendQuote };
  'spark-receive-quote:created': { entity: SparkReceiveQuote };
  'spark-receive-quote:updated': { entity: SparkReceiveQuote };
  'connection:resync': Record<string, never>;
};
```

> Verify during exec: which module each entity type is exported from (the gather lists `change-feed-router.ts` importing them at its top — match those import paths; some may need importing from `../domains/*` rather than `../engine`). The uniform `{ entity: T }` payload wrapper is the resolved shape (mirrors the B store consumers and keeps cache handlers reading `payload.entity`).

- [ ] **Step 2: Write the failing fanout test**

```ts
import { describe, expect, it, mock } from 'bun:test';
import { EventBus } from '../internal/event-bus';
import { createFanout } from './fanout';

const bus = () => new EventBus<any>();

describe('createFanout', () => {
  it('maps `${kind}:${operation}` and carries { entity }', () => {
    const b = bus();
    const accounts = { upsert: mock(() => {}), reload: mock(async () => {}) } as any;
    const f = createFanout(b, accounts);
    const seen: any[] = [];
    b.on('cashu-send-quote:updated', (p) => seen.push(p));
    const entity = { id: 'q1' };
    f.emit({ kind: 'cashu-send-quote', operation: 'updated', entity } as any);
    expect(seen).toEqual([{ entity }]);
  });

  it('on account changes, upserts the resident map BEFORE emitting', () => {
    const b = bus();
    const calls: string[] = [];
    const accounts = { upsert: mock(() => calls.push('upsert')), reload: mock(async () => {}) } as any;
    const f = createFanout(b, accounts);
    b.on('account:updated', () => calls.push('emit'));
    f.emit({ kind: 'account', operation: 'updated', entity: { id: 'a1' } } as any);
    expect(calls).toEqual(['upsert', 'emit']);
  });

  it('remaps contact-deleted -> contact:deleted with { id }', () => {
    const b = bus();
    const f = createFanout(b, { upsert: mock(() => {}), reload: mock(async () => {}) } as any);
    const seen: any[] = [];
    b.on('contact:deleted', (p) => seen.push(p));
    f.emit({ kind: 'contact-deleted', id: 'c9' } as any);
    expect(seen).toEqual([{ id: 'c9' }]);
  });

  it('onCatchUp does NOT emit connection:resync until the resident reload resolves, then emits it', async () => {
    const b = bus();
    let resolved = false;
    const accounts = { upsert: mock(() => {}), reload: mock(async () => { resolved = true; }) } as any;
    const f = createFanout(b, accounts);
    const seen: string[] = [];
    b.on('connection:resync', () => seen.push('resync'));
    f.onCatchUp();
    expect(seen).toEqual([]); // not yet — reload is async
    await new Promise((r) => setTimeout(r, 0));
    expect(resolved).toBe(true);
    expect(seen).toEqual(['resync']);
  });
});
```

> Note: `onCatchUp()` is declared `void` by the port but must rebuild the resident map (`accounts.reload`) before signalling `connection:resync` (so the app's invalidate-all re-reads against a fresh map). It cannot know the userId from the port — capture it from the most recent work-set/`ensureLoaded` call, or have the engine pass the current userId in. Resolve: `ResidentAccounts` remembers the last `userId` it loaded (set in `ensureLoaded`/`reload`); `onCatchUp` calls `accounts.reloadLast()` (a no-op if never loaded). Add `reloadLast(): Promise<void>` to `ResidentAccounts` in Task 2 if not present — adjust Task 2 accordingly (it is small; fold it in there or here, but keep the test green).

- [ ] **Step 3: Implement `fanout.ts`**

```ts
import type { ChangeFeedChange } from '../engine';
import type { EntityFanout } from '../internal/realtime/change-feed-ports';
import type { EventBus } from '../internal/event-bus';
import type { ResidentAccounts } from './resident-accounts';
import type { SdkEventMapA } from './event-map';

/** Variant A's fanout: ChangeFeedChange -> A-only row events on the widened bus.
 * Keeps the resident account map fresh (account upsert) before emitting, and
 * rebuilds it on catch-up before signalling `connection:resync`. */
export function createFanout(
  bus: EventBus<SdkEventMapA>,
  accounts: ResidentAccounts,
): EntityFanout {
  return {
    emit(change: ChangeFeedChange): void {
      if (change.kind === 'contact-deleted') {
        bus.emit('contact:deleted', { id: change.id });
        return;
      }
      if (change.kind === 'account') {
        // Refresh the resident map BEFORE emitting so WalletAccess sees the
        // new/updated account on the next synchronous read.
        accounts.upsert(change.entity);
      }
      const event = `${change.kind}:${change.operation}` as keyof SdkEventMapA;
      bus.emit(event, { entity: change.entity } as never);
    },
    onCatchUp(): void {
      // Rebuild the resident snapshot (it may have changed while disconnected),
      // then signal the host to invalidate. Fire-and-forget with a catch — the
      // port is synchronous.
      void accounts
        .reloadLast()
        .catch((error) => console.error('resident reload on catch-up failed', { cause: error }))
        .finally(() => bus.emit('connection:resync', {}));
    },
  };
}
```

> The lifecycle events (`send:*`/`receive:*`) are emitted separately by the base `ChangeFeed.handle` via `deriveLifecycleEvent` — the fanout must NOT duplicate them (they are an orthogonal channel on the same bus). `cashu-receive-swap` carries `tokenHash` (no `id`) — harmless here (the payload is the whole entity).

- [ ] **Step 4: Run tests + typecheck** → PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/wallet-sdk/src/stateless/event-map.ts packages/wallet-sdk/src/stateless/fanout.ts packages/wallet-sdk/src/stateless/fanout.test.ts
git commit -m "feat(wallet-sdk): A-engine SdkEventMapA + row-event fanout"
```

---

### Task 5: createStatelessEngine + createStatelessSdk entry + `./stateless` export

Assemble the four pieces into `createStatelessEngine(ctx)`, and add the `createStatelessSdk` client entry that wires it into `Sdk.create` and re-types `sdk.on` to `SdkEventMapA`.

**Files:**
- Create: `packages/wallet-sdk/src/stateless/engine.ts`, `packages/wallet-sdk/src/stateless/index.ts`
- Test: `packages/wallet-sdk/src/stateless/engine.test.ts`
- Modify: `packages/wallet-sdk/package.json` (add `./stateless` subpath export)

**Interfaces:**
- Consumes: `CreateEngine`, `EngineContext`, `SdkEngine` from `../engine`; `Sdk`, `SdkConfig` from `../sdk`/`../config`; `EventBus` from `../internal/event-bus`; Tasks 1–4.
- Produces: `createStatelessEngine: CreateEngine`; `createStatelessSdk(config, deps?): Promise<StatelessSdk>`; `type StatelessSdk`; re-export `SdkEventMapA`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'bun:test';
import { EventBus } from '../internal/event-bus';
import { createStatelessEngine } from './engine';

describe('createStatelessEngine', () => {
  it('builds the four engine pieces from ctx', () => {
    const ctx = {
      events: new EventBus<any>(),
      runtime: {
        accountRepository: { getAllActive: async () => [] },
        mintCache: {}, mintAuth: {},
        protocols: {
          cashuSendQuoteRepository: { getUnresolved: async () => [] },
          cashuSendSwapRepository: { getUnresolved: async () => [] },
          sparkSendQuoteRepository: { getUnresolved: async () => [] },
          cashuReceiveQuoteRepository: { getPending: async () => [] },
          cashuReceiveSwapRepository: { getPending: async () => [] },
          sparkReceiveQuoteRepository: { getPending: async () => [] },
        },
      },
      config: {},
    } as any;
    const engine = createStatelessEngine(ctx);
    expect(typeof engine.runner.runTask).toBe('function');
    expect(typeof engine.workSets.getUnresolvedCashuSendQuotes).toBe('function');
    expect(typeof engine.wallets.getCashuAccount).toBe('function');
    expect(typeof engine.fanout.emit).toBe('function');
    expect(typeof engine.fanout.onCatchUp).toBe('function');
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement `engine.ts`**

```ts
import type { CreateEngine, EngineContext, SdkEngine } from '../engine';
import type { EventBus } from '../internal/event-bus';
import { createFanout } from './fanout';
import type { SdkEventMapA } from './event-map';
import { KeyedQueue } from './keyed-queue';
import { ResidentAccounts } from './resident-accounts';
import { createWorkSets } from './work-sets';

/** Variant A's engine: in-memory KeyedQueue, DB-on-demand work-sets, a resident
 * account map, and a row-event fanout on the (widened) shared bus. */
export const createStatelessEngine: CreateEngine = (ctx: EngineContext): SdkEngine => {
  const accounts = new ResidentAccounts(ctx.runtime);
  // The bus instance is shared with sdk.on; widen the type to emit row events.
  const bus = ctx.events as unknown as EventBus<SdkEventMapA>;
  return {
    runner: new KeyedQueue(),
    workSets: createWorkSets(ctx.runtime, accounts),
    wallets: accounts,
    fanout: createFanout(bus, accounts),
  };
};
```

- [ ] **Step 4: Implement `index.ts` (the client entry)**

```ts
import { Sdk } from '../sdk';
import type { SdkConfig } from '../config';
import { createStatelessEngine } from './engine';
import type { SdkEventMapA } from './event-map';

export { createStatelessEngine } from './engine';
export type { SdkEventMapA } from './event-map';

/** An Sdk whose `on` is typed to the widened Variant-A event map. */
export type StatelessSdk = Omit<Sdk, 'on'> & {
  on<E extends keyof SdkEventMapA>(
    event: E,
    cb: (payload: SdkEventMapA[E]) => void,
  ): () => void;
};

/** Variant A client entry: constructs the Sdk with the stateless engine and
 * re-types `sdk.on` to SdkEventMapA. The runtime bus is the same instance the
 * engine's fanout emits row events on. */
export async function createStatelessSdk(
  config: SdkConfig,
  deps?: { openSecret?: ConstructorParameters<typeof Sdk>[0] extends never ? never : unknown },
): Promise<StatelessSdk> {
  const sdk = await Sdk.create(config, { ...deps, createEngine: createStatelessEngine });
  return sdk as unknown as StatelessSdk;
}
```

> Verify during exec: the exact `Sdk.create` deps shape (`{ openSecret?; createEngine? }`) — match it precisely (drop the placeholder `deps` typing above and use the real `Parameters<typeof Sdk.create>[1]` minus `createEngine`). Read `sdk.ts` for the signature.

- [ ] **Step 5: Add the `./stateless` package export**

Read `packages/wallet-sdk/package.json`'s `exports` (match the `./engine` entry's format) and add:

```jsonc
"./stateless": { "types": "./src/stateless/index.ts", "default": "./src/stateless/index.ts" }
```

(Use the exact key/value shape the existing `./engine` and `./internal/cashu/init-wallet` entries use.)

- [ ] **Step 6: Run tests + typecheck**

Run: `bun test packages/wallet-sdk/src/stateless/engine.test.ts` → PASS.
Run: `bun run typecheck` → exit 0 (confirms the `createStatelessEngine` is assignable to `CreateEngine`, the `WalletAccess`/`WorkSetSource`/`EntityFanout` impls satisfy the seam, and the widened-bus cast typechecks).

- [ ] **Step 7: Commit**

```bash
git add packages/wallet-sdk/src/stateless/engine.ts packages/wallet-sdk/src/stateless/index.ts packages/wallet-sdk/src/stateless/engine.test.ts packages/wallet-sdk/package.json
git commit -m "feat(wallet-sdk): A-engine createStatelessEngine + createStatelessSdk entry"
```

---

### Task 6: Variant A accounts read-surface (6b carry)

Expose `accounts.list()` (Promise over the resident map) and re-layer `getDefault`'s first-account-of-currency fallback + `suggestFor` (currency required), folding in the 6b forward-carry so Variant A matches the app's `useDefaultAccount`/`useAccountOrDefault` behavior.

**Files:**
- Create: `packages/wallet-sdk/src/stateless/accounts-surface.ts`
- Test: `packages/wallet-sdk/src/stateless/accounts-surface.test.ts`
- Modify: `packages/wallet-sdk/src/stateless/index.ts` (expose the augmented accounts on `StatelessSdk`)

**Interfaces:**
- Consumes: `AccountsDomain` (base, `../domains/accounts`), `ResidentAccounts` (Task 2), `ReadUserRepository`/`getUser` for `defaultCurrency`, `Account`/`Currency`.
- Produces: `createStatelessAccounts(deps): StatelessAccounts` where `StatelessAccounts = AccountsDomain & { list(): Promise<Account[]>; getDefault(currency?): Promise<Account> }` (getDefault overridden with fallback).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, mock } from 'bun:test';
import { createStatelessAccounts } from './accounts-surface';

const acct = (id: string, currency = 'BTC', createdAt = '2024-01-01') =>
  ({ id, currency, createdAt, isOnline: true, type: 'cashu' }) as any;

describe('createStatelessAccounts', () => {
  it('list() returns the resident accounts', async () => {
    const accounts = { all: () => [acct('a'), acct('b')] } as any;
    const a = createStatelessAccounts({ base: {} as any, accounts, getUser: async () => ({ defaultCurrency: 'BTC' }) as any });
    expect((await a.list()).map((x: any) => x.id)).toEqual(['a', 'b']);
  });

  it('getDefault falls back to the first account of the currency when the base throws', async () => {
    const base = { getDefault: mock(async () => { throw new Error('No default account found for currency BTC'); }) } as any;
    const accounts = { all: () => [acct('z', 'USD'), acct('a', 'BTC', '2023-01-01'), acct('b', 'BTC', '2024-06-01')] } as any;
    const a = createStatelessAccounts({ base, accounts, getUser: async () => ({ defaultCurrency: 'BTC' }) as any });
    const result = await a.getDefault('BTC');
    expect(result.id).toBe('a'); // earliest-created BTC account
  });

  it('getDefault returns the base result when present (no fallback)', async () => {
    const base = { getDefault: mock(async () => acct('def', 'BTC')) } as any;
    const a = createStatelessAccounts({ base, accounts: { all: () => [] } as any, getUser: async () => ({ defaultCurrency: 'BTC' }) as any });
    expect((await a.getDefault('BTC')).id).toBe('def');
  });

  it('getDefault uses user.defaultCurrency when no currency is given', async () => {
    const base = { getDefault: mock(async () => { throw new Error('none'); }) } as any;
    const accounts = { all: () => [acct('u', 'USD')] } as any;
    const a = createStatelessAccounts({ base, accounts, getUser: async () => ({ defaultCurrency: 'USD' }) as any });
    expect((await a.getDefault()).id).toBe('u');
  });
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement `accounts-surface.ts`**

```ts
import type { Currency } from '@agicash/money';
import type { Account } from '../domains/account-types';
import type { AccountsDomain } from '../domains/accounts';
import type { User } from '../domains/user-types';
import type { ResidentAccounts } from './resident-accounts';

type Deps = {
  base: AccountsDomain;
  accounts: ResidentAccounts;
  getUser: () => Promise<User | null>;
};

export type StatelessAccounts = AccountsDomain & {
  list(): Promise<Account[]>;
  getDefault(currency?: Currency): Promise<Account>;
};

/** Wraps the base AccountsDomain with Variant A's resident `list()` and the
 * 6b carry: getDefault falls back to the first (earliest-created) account of the
 * target currency before throwing, matching the app's useDefaultAccount. */
export function createStatelessAccounts(deps: Deps): StatelessAccounts {
  const list = async (): Promise<Account[]> => deps.accounts.all();

  const getDefault = async (currency?: Currency): Promise<Account> => {
    try {
      return await deps.base.getDefault(currency);
    } catch (error) {
      const user = await deps.getUser();
      const target = currency ?? user?.defaultCurrency;
      const candidates = deps.accounts
        .all()
        .filter((a) => a.currency === target)
        .sort((x, y) => (x.createdAt < y.createdAt ? -1 : 1));
      const fallback = candidates[0];
      if (!fallback) throw error;
      return fallback;
    }
  };

  // Preserve every other AccountsDomain method (get/suggestFor/add) by delegation.
  return new Proxy(deps.base, {
    get(targetBase, prop, receiver) {
      if (prop === 'list') return list;
      if (prop === 'getDefault') return getDefault;
      return Reflect.get(targetBase, prop, receiver);
    },
  }) as unknown as StatelessAccounts;
}
```

> `ResidentAccounts` needs an `all(): Account[]` accessor — add it in Task 2 (return `[...this.map.values()]`) and a test there, or fold it in here and adjust Task 2's tests. `suggestFor` already requires `currency` (base behavior) — the web cut-over (A-web) passes `user.defaultCurrency`; nothing to change here. Wire `createStatelessAccounts` into `createStatelessSdk` so `sdk.accounts` is the augmented surface (verify the base `sdk.accounts` is reachable to wrap — read `sdk.ts`; if `AccountsDomain` isn't exposed for wrapping, expose the augmented accounts as a distinct property and document it for A-web).

- [ ] **Step 4: Run tests + typecheck** → PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/wallet-sdk/src/stateless/accounts-surface.ts packages/wallet-sdk/src/stateless/accounts-surface.test.ts packages/wallet-sdk/src/stateless/index.ts
git commit -m "feat(wallet-sdk): A-engine accounts read-surface (list + getDefault fallback)"
```

---

### Task 7: 4c hardening — leader-epoch guard

A leader epoch on `ProcessorRegistry`, bumped on `activate` AND `deactivate`, passed into each `processor.reload` so a stale fire-and-forget reload (whose `await fetchWorkSet` resolves after a leadership flip) drops its result instead of re-arming trackers on a deactivated instance.

**Files:**
- Modify: `packages/wallet-sdk/src/internal/background/processor-registry.ts`
- Modify: `packages/wallet-sdk/src/internal/background/processors/processor.ts` (the `Processor` type)
- Modify: all 6 `packages/wallet-sdk/src/internal/background/processors/*-processor.ts`
- Test: extend `packages/wallet-sdk/src/internal/background/processor-registry.test.ts` (or co-located) + a processor reload-guard test.

**Interfaces:**
- `Processor.reload(userId: string, isCurrent?: () => boolean): Promise<void>` (additive optional param — base callers without it still compile).
- `ProcessorRegistry.activate(userId)`/`deactivate()` bump a private `epoch`; `reloadAll` captures `const epoch = this.epoch` and passes `isCurrent = () => epoch === this.epoch` to each `reload`.

- [ ] **Step 1: Write the failing tests**

```ts
// In the processor-registry test:
it('bumps the leader epoch on activate and deactivate', () => {
  const procs = makeStubProcessors(); // 6 stub Processors recording reload(userId, isCurrent)
  const registry = new ProcessorRegistry(procs);
  registry.activate('u1');
  const isCurrentAtActivate = procs.cashuSendQuote.lastIsCurrent!;
  expect(isCurrentAtActivate()).toBe(true);
  registry.deactivate();
  expect(isCurrentAtActivate()).toBe(false); // epoch moved -> the captured predicate is now stale
});

it('a reload whose work-set resolves after deactivate drops its result', async () => {
  // Stub a processor whose reload awaits a deferred fetchWorkSet, then checks isCurrent()
  // before touching trackers; assert the tracker.update is NOT called when deactivated mid-flight.
  // (Concrete stub per the processor under test — e.g. CashuReceiveQuoteProcessor with a
  // controllable fetchWorkSet and a spy mintTracker.)
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL (no epoch / signature mismatch).

- [ ] **Step 3: Implement the registry epoch**

In `processor-registry.ts`, add `private epoch = 0;`. In `activate(userId)`: `this.epoch += 1;` before `reloadAll()`. In `deactivate()`: `this.epoch += 1;` (before disposing). In `reloadAll()`:

```ts
private reloadAll(): void {
  if (!this.userId) return;
  const epoch = this.epoch;
  const isCurrent = () => epoch === this.epoch;
  for (const processor of this.allProcessors()) {
    void processor.reload(this.userId, isCurrent).catch((error) =>
      console.error('processor reload failed', { cause: error }),
    );
  }
}
```

(Match the existing `reloadAll`/processor-iteration shape — read the file first.)

- [ ] **Step 4: Widen `Processor` + guard each reload**

In `processor.ts`: `reload(userId: string, isCurrent?: () => boolean): Promise<void>`.

In EACH of the 6 `*-processor.ts`, immediately after the `await this.deps.fetchWorkSet(userId)` line, insert the guard before any tracker `.update(...)`:

```ts
this.workSet = await this.deps.fetchWorkSet(userId);
if (isCurrent && !isCurrent()) return;
```

(Update each `reload` signature to accept `isCurrent?`. Read each processor to place the guard right after its work-set fetch and before tracker wiring.)

- [ ] **Step 5: Run tests + typecheck**

Run the registry/processor tests → PASS. `bun run typecheck` → exit 0. `bun run test` (full) → green (the existing 4c processor/registry tests must still pass).

- [ ] **Step 6: Commit**

```bash
git add packages/wallet-sdk/src/internal/background/
git commit -m "feat(wallet-sdk): A-engine 4c leader-epoch guard (drop stale reloads)"
```

---

### Task 8: 4c hardening — per-subscription NUT-17 WebSocket teardown

Give each NUT-17 subscription manager a `disposeAll()` that runs its existing unsubscribe fns + clears its map; forward it from each tracker's `dispose()` so `registry.deactivate() → processor.dispose() → tracker.dispose() → manager.disposeAll()` closes the subscriptions on lost leadership. Per-subscription unsubscribe (not a hard per-mint socket close).

**Files:**
- Modify: `packages/wallet-sdk/src/internal/cashu/mint-quote-subscription-manager.ts`, `melt-quote-subscription-manager.ts`, `proof-state-subscription-manager.ts`
- Modify: `packages/wallet-sdk/src/internal/cashu/mint-quote-tracker.ts`, `melt-quote-tracker.ts`, `proof-state-tracker.ts`
- Test: co-located manager/tracker tests.

**Interfaces:**
- Each manager gains `disposeAll(): Promise<void>` (await each subscription's unsubscribe; clear the map).
- Each tracker's `dispose()` additionally calls `this.manager.disposeAll()` (fire-and-forget with a `.catch`, or `void`).

- [ ] **Step 1: Write the failing tests**

```ts
// Manager: disposeAll runs the registered unsubscribe fns and clears subscriptions.
it('disposeAll unsubscribes every active subscription and clears the map', async () => {
  const unsub = mock(async () => {});
  const mgr = new MintQuoteSubscriptionManager(/* deps */);
  // seed one subscription (use the manager's subscribe with a fake wallet whose
  // .on.mintQuoteUpdates returns `unsub`), then:
  await mgr.disposeAll();
  expect(unsub).toHaveBeenCalledTimes(1);
  expect(mgr.activeMintCount).toBe(0); // expose for the test
});

// Tracker: dispose forwards to manager.disposeAll.
it('tracker.dispose tears down the manager subscriptions', () => {
  const disposeAll = mock(async () => {});
  const tracker = new ProofStateTracker(/* deps with injected manager */);
  (tracker as any).manager = { disposeAll };
  tracker.dispose();
  expect(disposeAll).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement `disposeAll` on the 3 managers**

Each manager holds `subscriptions: Map<mintUrl, { ...; unsubscribe }>` (read each to match the exact shape). Add:

```ts
async disposeAll(): Promise<void> {
  const entries = [...this.subscriptions.values()];
  this.subscriptions.clear();
  await Promise.allSettled(entries.map((s) => s.unsubscribe()));
}
```

(Match how the existing per-subscription unsubscribe is stored/awaited — the gather notes each subscribe resolves an unsubscribe fn; use the stored one. Add a small `activeMintCount` getter for the test.)

- [ ] **Step 4: Forward from each tracker's `dispose()`**

In each tracker's `dispose()`, after the existing timer cleanup, add:

```ts
void this.manager.disposeAll().catch((error) =>
  console.error('subscription teardown failed', { cause: error }),
);
```

For `ProofStateTracker.dispose()` (currently an explicit no-op deferring to "4c"), replace the no-op body with the manager teardown.

- [ ] **Step 5: Run tests + typecheck + full suite**

Run the manager/tracker tests → PASS. `bun run typecheck` → exit 0. `bun run test` → green (existing 4a tracker tests still pass — the generation-guard behavior is unchanged; only teardown is added).

- [ ] **Step 6: Commit**

```bash
git add packages/wallet-sdk/src/internal/cashu/
git commit -m "feat(wallet-sdk): A-engine 4c NUT-17 subscription teardown on deactivate"
```

---

### Task 9: Whole-branch holistic review (OPUS)

Dispatch an OPUS reviewer over the full A-engine diff (`git diff a210e9db..HEAD -- packages/wallet-sdk`). Verify:
- **Seam conformance:** `createStatelessEngine` is assignable to `CreateEngine`; `KeyedQueue`/`createWorkSets`/`ResidentAccounts`/`createFanout` satisfy `TaskRunner`/`WorkSetSource`/`WalletAccess`/`EntityFanout` exactly; base `engine.ts`/`sdk.ts` consumption block/`EventBus`/`ChangeFeedChange`/repos are UNCHANGED.
- **KeyedQueue correctness:** FIFO-per-lane, concurrency across lanes, re-entrant same-lane enqueue does not deadlock and is not inline-awaited, retry loop matches the `failureCount` 0-based check-then-increment contract, ConcurrencyError retries are unbounded (no queue-imposed cap), lanes GC on idle without dropping a re-entrant enqueue mid-drain.
- **Resident map freshness:** `account` events upsert before emit; `onCatchUp` rebuilds before `connection:resync`; sync getters throw on miss; `getSourceCashuWallet` throws `NetworkError` when offline; the work-set online filter is tolerant.
- **Event map:** all 11 kinds mapped; `contact-deleted → contact:deleted`; uniform `{ entity }` payload; the fanout does NOT duplicate the base lifecycle events.
- **4c hardening:** epoch bumped on activate AND deactivate; the guard sits after `await fetchWorkSet` in all 6 processors; `disposeAll` forwarded from all 3 trackers; no hard per-mint socket close.
- **Boundary:** zero `apps/web-wallet/**` changes; `./stateless` is the only new export; no TanStack/Sentry/env reads.
- Gate: `bun run typecheck` 8/8 + `bun run test` full suite green (controller re-verifies).
- Reviewer must NOT run `fix:all`.

Triage the per-task Minors (rolled up in the ledger) — decide which, if any, must be fixed before this branch is eval-ready.

---

## Self-Review

**1. Spec coverage (resolved forks + grounding):**
- Split engine/web → this plan is engine-only; web cut-over explicitly deferred. ✓
- `createStatelessSdk` + widened bus (`SdkEventMapA`) → Tasks 4–5. ✓
- transaction unack parity (always-refetch) → an A-web concern; the fanout emits `transaction:created|updated` uniformly so A-web can refetch on either. ✓ (noted)
- NUT-17 per-subscription teardown → Task 8. ✓
- 4c epoch guard → Task 7; 6b carries (getDefault fallback, suggestFor currency) → Task 6. ✓
- The 4 engine pieces (runner/workSets/wallets/fanout) → Tasks 1–4; assembly + entry → Task 5. ✓

**2. Placeholder scan:** code is complete per task; the few "verify during exec" notes point at exact files to confirm signatures (not deferred work). The 2nd reload-guard test in Task 7 and the manager-seed in Task 8 reference the concrete stub the implementer must build from the file under test — flagged explicitly, not hand-waved.

**3. Type consistency:** `SdkEventMapA`, `StatelessSdk`, `createStatelessEngine`, `createStatelessSdk`, `ResidentAccounts` (with `all`/`reloadLast`/`isOnline`/`upsert`/`ensureLoaded`/`getCashuAccount`…), `createWorkSets`, `createFanout`, `createStatelessAccounts` names are consistent across tasks. `ResidentAccounts.all()`/`reloadLast()` are introduced in Tasks 4/6 and must be added back into Task 2's implementation+tests (called out in those tasks).

## Owed to later (NOT this plan)

- **Variant A — web** (separate plan): build `SdkConfig` from app env (LAN-rewrite app-side), construct the `createStatelessSdk` singleton, rewire the 13 cache classes + 10 change-handlers onto `sdk.on`, map `connection:resync` → invalidate-all, swap the transactions `queryFn` → `sdk.transactions.list` (always-refetch unack count), delete the app's leader-election/TaskProcessor/`useHandleSessionExpiry`, wire `<Wallet>` mount → `background.start/stop` + online/offline/visibility → `setOnlineStatus`/`setActiveStatus` + `resync` on focus/online, source `config.domain`. **Owes browser/live-app verification** (Chrome DevTools MCP + verify/run skills).
- Push of `sdkx/base`/variant branches remains gated on the Breez smoke + live realtime + `/lnurl-test` + user nod.
