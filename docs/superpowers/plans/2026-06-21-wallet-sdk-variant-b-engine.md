# Variant B (store-based) — Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Variant B's headless engine for `@agicash/wallet-sdk` — a store-based `createEngine` (hidden patched `@tanstack/query-core`: a `MutationObserver`-scope task runner, nine resident `Store<T>` views, store-read work-sets, store-snapshot `WalletAccess`, and a version-gated store-write fanout) plus a `createStoreSdk` client entry exposing the spec's `Store<T>` hot reads — and fold in the deferred 4c leader-lifecycle hardening. All gate-verifiable headless (`bun run typecheck` + `bun run test`).

**Architecture:** Variant B supplies the frozen engine seam `createEngine(ctx) => { runner, workSets, wallets, fanout }` (`packages/wallet-sdk/src/engine.ts`). The runner is a patched-query-core `MutationObserver` whose per-`mutate()` `scope` carries the lane id, giving FIFO-per-lane + cross-lane concurrency + re-entrancy free from `MutationCache`. Hot state lives in nine resident `Store<T>` views (each a long-lived `QueryObserver`): user, accounts, contacts, and the six quote/swap work sets. Work-sets read the stores (load-before-serve via `toPromise`) and online-filter via the accounts store. `WalletAccess` reads the accounts-store snapshot synchronously. The fanout maps each of the 11 `ChangeFeedChange` kinds to a synchronous, version-gated `setQueryData` store write (transaction kind = no-op), evicting items that leave the unresolved/pending keep-set; `onCatchUp` refetches all stores. **All `@tanstack/*` imports are confined to `packages/wallet-sdk/src/internal/engine/`** (lint- and test-enforced); the variant glue in `packages/wallet-sdk/src/store/` only touches the engine-neutral `Store<T>` handle. A `createStoreSdk` entry wires `createStoreEngine` into `Sdk.create` (injecting `getUser` for the user-store seed via closure — zero seam change) and exposes the `Store<T>` hot reads on the domains. The 4c hardening adds a leader-epoch guard and per-subscription NUT-17 WebSocket teardown on `deactivate` (identical to Variant A).

**Tech Stack:** TypeScript, `@agicash/wallet-sdk`, **patched `@tanstack/query-core@5.90.20`** (the dynamic-mutation-scope patch already in-repo: `patches/@tanstack%2Fquery-core@5.90.20.patch`, pinned in root `package.json` `patchedDependencies`), `@cashu/cashu-ts`, `bun:test`. New engine code lives under `packages/wallet-sdk/src/internal/engine/` (the ONLY place `@tanstack/*` may be imported) and `packages/wallet-sdk/src/store/` (the variant surface); the 4c hardening touches `packages/wallet-sdk/src/internal/background/**` and `internal/cashu/*-subscription-manager.ts` + trackers.

## Global Constraints

- **Gate = `bun run typecheck` + `bun run test`. NEVER `bun run fix:all`** ⛔ (biome `check --write` reorders imports repo-wide and pollutes the working tree — applies to implementers AND reviewers). Discard any such pollution with `git checkout -- .` (committed work is safe). Every subagent prompt MUST carry this prohibition verbatim.
- **Branch: `sdkx/store`** (worktree `.claude/worktrees/sdkx-store`), off the frozen base `a210e9db`. Run all commands from that worktree. Do NOT touch `sdkx/base`, `sdkx/stateless`, the original repo root, or the independent `sdk-nocache/full-migration` track.
- **Do NOT push** `sdkx/base` or `sdkx/store` — push is gated on the Breez connect smoke (`VITE_BREEZ_API_KEY` + regtest) + live realtime validation + `/lnurl-test` + the user's nod.
- **Base seam is FROZEN — do not change `engine.ts`, `sdk.ts`'s `createEngine` consumption block (`sdk.ts:250-327`), the `EventBus` class, the `ChangeFeedChange` union, the `EngineContext`/`SdkEngine`/`WorkSetSource`/`WalletAccess`/`EntityFanout` types, or the repos.** Variant B only *implements* the seam + adds the `internal/engine/` + `store/` dirs + the `createStoreSdk` entry + the `./store` export. The user-store seed gap is resolved by **closure injection in `createStoreSdk`** (NOT by widening `EngineContext`). (Exception: the 4c hardening deliberately modifies `internal/background/**` + the subscription managers/trackers — Tasks 10–11 — per the resolved fork, identical to Variant A.)
- **Frozen seam contracts (verbatim from `engine.ts`):**
  - `type TaskRunner = { runTask<T>(lane: string, fn: () => Promise<T>, policy?: RetryPolicy): Promise<T> }` (`internal/tasks/task-runner.ts`).
  - `type RetryPolicy = { shouldRetry: (failureCount: number, error: unknown) => boolean; retryDelay: (failureCount: number) => number }` (`internal/tasks/retry-policy.ts`; `failureCount` is prior-failures, 0 on first; check then increment).
  - `type WorkSetSource` = the 6 `getUnresolved*`/`getPending*(userId): Promise<…[]>` methods (`engine.ts:28-35`).
  - `type WalletAccess = { getCashuAccount(accountId): CashuAccount; getSparkAccount(accountId): SparkAccount; getCashuWalletByMint(mintUrl, currency): ExtendedCashuWallet; getSourceCashuWallet(mintUrl, currency): Promise<ExtendedCashuWallet> }` (`engine.ts:44-57`; the 3 sync getters THROW on a missing resident account; `getSourceCashuWallet` REJECTS `NetworkError` when the mint is offline).
  - `type EntityFanout = { emit(change: ChangeFeedChange): void; onCatchUp(): void }` (`internal/realtime/change-feed-ports.ts:10-18`).
  - `type EngineContext = { events: EventBus<SdkCoreEventMap>; runtime: WalletRuntime; config: SdkConfig }` (`engine.ts:73-78`).
  - `type SdkEngine = { runner: TaskRunner; workSets: WorkSetSource; wallets: WalletAccess; fanout: EntityFanout }` (`engine.ts:66-71`).
  - `type CreateEngine = (ctx: EngineContext) => SdkEngine` (SYNCHRONOUS).
- **`ChangeFeedChange` (11 kinds, `internal/realtime/change-feed-router.ts:35-46`):** `{kind:'user';operation:'updated';entity:User}` | `{kind:'account';operation:'created'|'updated';entity:Account}` | `{kind:'transaction';operation:'created'|'updated';entity:Transaction}` | `{kind:'contact';operation:'created';entity:Contact}` | `{kind:'contact-deleted';id:string}` | `{kind:'cashu-send-quote'|'cashu-send-swap'|'cashu-receive-quote'|'cashu-receive-swap'|'spark-send-quote'|'spark-receive-quote';operation:'created'|'updated';entity:T}`. Entities are ALREADY DECRYPTED (the router ran `repo.toX`). Only `contact-deleted` is a delete.
- **`fanout.emit` is called SYNCHRONOUSLY before `trigger.onEntityChange`** (`internal/realtime/change-feed.ts:158-169`, with the inline comment "variant B's processors read the stores the fanout just wrote") → B's `fanout.emit` MUST be a synchronous `setQueryData` write. The accounts upsert MUST complete before `emit` returns so the immediately-following `processor.reload → wallets.getCashuAccount` reads a fresh snapshot.
- **Reachability:** `ctx.runtime.protocols.{cashuSendQuoteRepository,cashuSendSwapRepository,sparkSendQuoteRepository,cashuReceiveQuoteRepository,cashuReceiveSwapRepository,sparkReceiveQuoteRepository,contactRepository}` (`internal/protocol-services.ts:23-40`); `ctx.runtime.accountRepository` (NOT under `protocols`; `wallet-runtime.ts:27`); `ctx.runtime.mintCache`. Send repos → `getUnresolved(userId)`, receive repos → `getPending(userId)`, contact repo → `getAll(ownerId)`, account repo → `getAllActive(userId)`, each `Promise<…[]>`, already decrypted. There is **NO user read repo on the runtime** → the user-store seed uses an injected `getUser: () => Promise<User | null>` (Task 5/9).
- **Two retry policies only:** `defaultRetryPolicy` (bounded-3) and `subscriptionRetryPolicy` (bounded-5) — `internal/tasks/retry-policy.ts:33-42`. query-core's `retry(failureCount,error)` is called with `failureCount` = prior failures (0 on first), checked BEFORE increment (`retryer.ts:175-186`) — matches `RetryPolicy` 1:1.
- **Patch API:** the dynamic-mutation-scope patch adds `scope?: { id: string }` to `MutateOptions`; pass it per call as `observer.mutate(variables, { scope: { id: lane } })`. FIFO-per-scope + cross-scope concurrency + re-entrant drain (`MutationCache.canRun`/`runNext` + `#scopes`) is stock query-core.
- **Model:** OPUS implementer + reviewer on Tasks 3 (createStore), 4 (MutationRunner), 8 (fanout), 9 (entry + public reads), 10 (epoch guard), 12 (holistic); sonnet on Tasks 1 (infra), 2 (query-client), 5 (store registry), 6 (work-sets), 7 (WalletAccess), 11 (NUT-17 disposeAll).
- **Commit prefix:** `feat(wallet-sdk): B-engine …`. Base for the whole-branch diff = `a210e9db`.

---

## File Structure

New — engine internals (the ONLY place `@tanstack/*` is imported):
- `packages/wallet-sdk/src/internal/engine/query-client.ts` — `createEngineQueryClient(): QueryClient` (explicit headless defaultOptions) (Task 2)
- `packages/wallet-sdk/src/internal/engine/store.ts` — `Store<T>` type + `createStore<T>(client, queryKey, queryFn): Store<T>` (QueryObserver wrapper) (Task 3)
- `packages/wallet-sdk/src/internal/engine/mutation-runner.ts` — `createMutationRunner(client): TaskRunner` (Task 4)
- `packages/wallet-sdk/src/internal/engine/index.ts` — re-exports the three above (Task 3/4)
- `packages/wallet-sdk/src/internal/engine/seam.test.ts` — gate-enforced confinement + single-copy assertions (Task 1)
- co-located `*.test.ts` per engine file.

New — the variant surface (NO direct `@tanstack/*`; only the `Store<T>` handle):
- `packages/wallet-sdk/src/store/stores.ts` — `createStoreRegistry(runtime, client, getUser): StoreRegistry` (the 9 stores + queryFns) (Task 5)
- `packages/wallet-sdk/src/store/work-sets.ts` — `createWorkSets(stores): WorkSetSource` (Task 6)
- `packages/wallet-sdk/src/store/wallets.ts` — `StoreWalletAccess implements WalletAccess` (Task 7)
- `packages/wallet-sdk/src/store/fanout.ts` — `createFanout(stores): EntityFanout` (Task 8)
- `packages/wallet-sdk/src/store/engine.ts` — `createStoreEngine(ctx, getUser): SdkEngine & { stores }` (Task 9)
- `packages/wallet-sdk/src/store/accounts-surface.ts` — `createStoreAccounts({ base, accountsStore, getUser }): StoreAccounts` (Task 9)
- `packages/wallet-sdk/src/store/index.ts` — `createStoreSdk`, `StoreSdk`, `Store<T>` re-export, `createStoreEngine` (Task 9)
- co-located `*.test.ts` per file.

Modified (exports): `packages/wallet-sdk/package.json` — add `@tanstack/query-core` dep (Task 1) + the `./store` subpath export (Task 9).
Modified (infra): root `biome.jsonc` — the `@tanstack/*` seams rule + `internal/engine/**` override (Task 1).
Modified (4c hardening, identical to Variant A — Tasks 10–11): `internal/background/processor-registry.ts`, `internal/background/processors/processor.ts`, all 6 `internal/background/processors/*-processor.ts`, `internal/cashu/{mint-quote,melt-quote,proof-state}-subscription-manager.ts`, `internal/cashu/{mint-quote-tracker,melt-quote-tracker,proof-state-tracker}.ts`.

No `apps/web-wallet/**` changes anywhere in this plan (that is the Variant B — web plan).

---

### Task 1: Engine dependency + seams enforcement infrastructure

Add `@tanstack/query-core` to the SDK package, add the lint rule confining it to `internal/engine/`, and add a **gate-runnable** test (`bun run test`) that asserts (a) no `@tanstack/*` import outside `internal/engine/` and (b) a single resolved `query-core` copy. The biome rule documents/CI-enforces the seam; the bun test is what the gate actually catches.

**Files:**
- Modify: `packages/wallet-sdk/package.json` (add the dep)
- Modify: `biome.jsonc` (the seams rule + override)
- Create: `packages/wallet-sdk/src/internal/engine/seam.test.ts`

**Interfaces:**
- Produces: a green gate proving the dependency resolves to one copy and no source file outside `internal/engine/` imports `@tanstack/*`.

- [ ] **Step 1: Add the dependency.** In `packages/wallet-sdk/package.json` `dependencies`, add `"@tanstack/query-core": "5.90.20"` (exact, matching the root `patchedDependencies` pin `@tanstack/query-core@5.90.20` and the existing `@tanstack/react-query@5.90.20` in `apps/web-wallet/package.json`). **This is a new dependency — installation is gated on user approval (see the execution kickoff). After approval, run `bun install` from the worktree root.** Verify the pin took: `bun pm ls 2>/dev/null | grep query-core` (or inspect `bun.lock`) → exactly one `@tanstack/query-core@5.90.20`.

- [ ] **Step 2: Write the seam-confinement + single-copy test** — `packages/wallet-sdk/src/internal/engine/seam.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dir, '..', '..'); // packages/wallet-sdk/src
const ENGINE = join(SRC, 'internal', 'engine');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('engine seam', () => {
  it('confines all @tanstack/* imports to internal/engine/', () => {
    const offenders = walk(SRC)
      .filter((f) => /\.tsx?$/.test(f) && !f.startsWith(ENGINE))
      .filter((f) => /from ['"]@tanstack\//.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('resolves a single @tanstack/query-core copy', () => {
    // Bun dedupes the patched, pinned version; assert there is exactly one resolved dir.
    const root = join(SRC, '..', '..', '..'); // repo root
    const lock = readFileSync(join(root, 'bun.lock'), 'utf8');
    const matches = lock.match(/"@tanstack\/query-core@5\.90\.20"/g) ?? [];
    // one pin line + one resolution line is the single-copy signature; >2 means a dupe crept in.
    expect(matches.length).toBeLessThanOrEqual(2);
  });
});
```

> The `<=2` bound matches the base lockfile shape (one `patchedDependencies` pin reference + one resolution entry for the single copy). If `bun install` introduced a second resolved copy (e.g. `@tanstack/query-core@5.90.20` under a nested path), the count rises and the test fails — exactly the CI single-copy guard the spec requires. Verify the exact count against `grep -c '"@tanstack/query-core@5.90.20"' bun.lock` during exec and pin the bound to that.

- [ ] **Step 3: Add the biome seams rule.** In `biome.jsonc`, under `linter.rules.nursery`, add `noRestrictedImports` (a nursery rule in biome 1.9.4) forbidding `@tanstack/*`, then add an `overrides` entry re-enabling it for `internal/engine/`:

```jsonc
// linter.rules.nursery — ADD alongside the existing useSortedClasses:
"noRestrictedImports": {
  "level": "error",
  "options": {
    "paths": {
      "@tanstack/query-core": "TanStack is the hidden Variant-B engine; import it only inside packages/wallet-sdk/src/internal/engine/."
    }
  }
}
```
```jsonc
// overrides[] — ADD an entry allowing it inside the engine dir:
{
  "include": ["packages/wallet-sdk/src/internal/engine/**"],
  "linter": { "rules": { "nursery": { "noRestrictedImports": "off" } } }
}
```

> Verify during exec: biome 1.9.4 `noRestrictedImports` is under `nursery` and uses `options.paths` (a map of module → message). The base `biome.jsonc` already has a `nursery` block (`useSortedClasses`) and an `overrides` array (`app/components/markdown.tsx`) — match those shapes exactly. This rule is NOT run by the gate (gate = typecheck+test, not biome); the `seam.test.ts` is the gate enforcement. The biome rule is for editor/CI. Do NOT run `fix:all` to validate it; eyeball the JSON.

- [ ] **Step 4: Run the gate.** `bun run typecheck` (8 packages exit 0 — the new dep changes nothing typed yet) + `bun run test` (the new `seam.test.ts` PASSES: zero `@tanstack` offenders since no engine code exists yet, single copy resolved).

- [ ] **Step 5: Commit.**
```bash
git add packages/wallet-sdk/package.json biome.jsonc bun.lock packages/wallet-sdk/src/internal/engine/seam.test.ts
git commit -m "feat(wallet-sdk): B-engine @tanstack/query-core dep + seams rule + single-copy guard"
```

---

### Task 2: `createEngineQueryClient` — the hidden client with headless defaults

A `QueryClient` with explicit headless `defaultOptions` (node's `isServer` flips query `retry`→0 and `gcTime`→Infinity; the runner needs `networkMode:'always'`). One client per engine; never placed in a React Provider; cleared on `dispose`.

**Files:**
- Create: `packages/wallet-sdk/src/internal/engine/query-client.ts`
- Test: `packages/wallet-sdk/src/internal/engine/query-client.test.ts`

**Interfaces:**
- Consumes: `QueryClient` from `@tanstack/query-core`.
- Produces: `createEngineQueryClient(): QueryClient`.

- [ ] **Step 1: Write the failing test:**
```ts
import { describe, expect, it } from 'bun:test';
import { createEngineQueryClient } from './query-client';

describe('createEngineQueryClient', () => {
  it('sets explicit headless query defaults (finite-by-policy retry, Infinity staleTime/gcTime)', () => {
    const client = createEngineQueryClient();
    const q = client.getDefaultOptions().queries ?? {};
    expect(q.staleTime).toBe(Number.POSITIVE_INFINITY);
    expect(q.gcTime).toBe(Number.POSITIVE_INFINITY);
    expect(q.retry).toBe(3); // explicit, NOT the server default of 0
  });

  it('sets runner mutation defaults to always-network (decoupled from onlineManager)', () => {
    const client = createEngineQueryClient();
    const m = client.getDefaultOptions().mutations ?? {};
    expect(m.networkMode).toBe('always');
  });
});
```

- [ ] **Step 2: Run → FAIL** (`createEngineQueryClient` not defined). Run: `bun --cwd packages/wallet-sdk test internal/engine/query-client.test.ts`.

- [ ] **Step 3: Implement:**
```ts
import { QueryClient } from '@tanstack/query-core';

/**
 * The hidden Variant-B engine client. Explicit headless defaults because node's
 * `isServer` otherwise flips query retry→0 and gcTime→Infinity silently
 * (query-core utils.ts/removable.ts/retryer.ts). Reads are `staleTime: Infinity`
 * because the change-feed fanout is the authoritative freshness mechanism — a
 * background refetch must never race the fanout's version-gated write. `gcTime:
 * Infinity` keeps the resident stores' cache entries alive for the SDK's lifetime.
 * Mutations use `networkMode: 'always'` so the lane runner never strands a paused
 * lane on an onlineManager flip (the SDK owns its own connectivity).
 */
export function createEngineQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: Number.POSITIVE_INFINITY, gcTime: Number.POSITIVE_INFINITY, retry: 3 },
      mutations: { networkMode: 'always' },
    },
  });
}
```

- [ ] **Step 4: Run tests + typecheck** → PASS, `bun run typecheck` exit 0.

- [ ] **Step 5: Commit.**
```bash
git add packages/wallet-sdk/src/internal/engine/query-client.ts packages/wallet-sdk/src/internal/engine/query-client.test.ts
git commit -m "feat(wallet-sdk): B-engine query-client with explicit headless defaults"
```

---

### Task 3: `Store<T>` + `createStore` (the reactive primitive) [OPUS]

The spec's `Store<T> = { get(): T | undefined; subscribe(cb): () => void; toPromise(): Promise<T> }` over a long-lived `QueryObserver`, plus an internal `set(updater)` the fanout uses to write. `get()` is the observer's structurally-shared snapshot (referentially stable for `useSyncExternalStore`); `undefined` strictly means not-loaded; `toPromise()` is `fetchOptimistic` (unconditional first fetch → load-before-serve); `set` is `client.setQueryData` (synchronous).

**Files:**
- Create: `packages/wallet-sdk/src/internal/engine/store.ts`
- Create: `packages/wallet-sdk/src/internal/engine/index.ts`
- Test: `packages/wallet-sdk/src/internal/engine/store.test.ts`

**Interfaces:**
- Consumes: `QueryClient`, `QueryObserver`, `QueryKey` from `@tanstack/query-core`.
- Produces:
  - `type Store<T> = { get(): T | undefined; subscribe(cb: () => void): () => void; toPromise(): Promise<T>; set(updater: T | ((prev: T | undefined) => T)): void }`
  - `createStore<T>(client: QueryClient, queryKey: QueryKey, queryFn: () => Promise<T>): Store<T>`

- [ ] **Step 1: Write the failing tests:**
```ts
import { describe, expect, it } from 'bun:test';
import { createEngineQueryClient } from './query-client';
import { createStore } from './store';

describe('createStore', () => {
  it('get() is undefined before load, the value after toPromise()', async () => {
    const client = createEngineQueryClient();
    const store = createStore<number[]>(client, ['k1'], async () => [1, 2, 3]);
    expect(store.get()).toBeUndefined();
    const loaded = await store.toPromise();
    expect(loaded).toEqual([1, 2, 3]);
    expect(store.get()).toEqual([1, 2, 3]);
  });

  it('set() writes synchronously and get() reflects it immediately', async () => {
    const client = createEngineQueryClient();
    const store = createStore<number[]>(client, ['k2'], async () => [1]);
    await store.toPromise();
    store.set((prev = []) => [...prev, 9]);
    expect(store.get()).toEqual([1, 9]); // synchronous
  });

  it('subscribe() fires on set() and the unsubscribe stops it', async () => {
    const client = createEngineQueryClient();
    const store = createStore<number[]>(client, ['k3'], async () => [1]);
    await store.toPromise();
    let hits = 0;
    const off = store.subscribe(() => { hits += 1; });
    store.set(() => [2]);
    expect(hits).toBeGreaterThanOrEqual(1);
    const at = hits;
    off();
    store.set(() => [3]);
    expect(hits).toBe(at); // no more notifications after unsubscribe
  });

  it('get() is referentially stable when content is unchanged (useSyncExternalStore safety)', async () => {
    const client = createEngineQueryClient();
    const store = createStore<{ a: number }>(client, ['k4'], async () => ({ a: 1 }));
    await store.toPromise();
    const first = store.get();
    store.set(() => ({ a: 1 })); // same content
    expect(store.get()).toBe(first); // structural sharing preserves identity
  });
});
```

- [ ] **Step 2: Run → FAIL.** Run: `bun --cwd packages/wallet-sdk test internal/engine/store.test.ts`.

- [ ] **Step 3: Implement `store.ts`:**
```ts
import { QueryClient, QueryObserver, type QueryKey } from '@tanstack/query-core';

/** The Variant-B reactive primitive (engine-neutral surface — no @tanstack types leak). */
export type Store<T> = {
  /** Sync snapshot; `undefined` = not yet loaded ([]/null = legitimately empty). Referentially stable between changes. */
  get(): T | undefined;
  /** Fires on every change; returns an unsubscribe. */
  subscribe(cb: () => void): () => void;
  /** Resolves on first successful load (unconditional fetch). The load-before-serve seam. */
  toPromise(): Promise<T>;
  /** Synchronous version-gated write used by the fanout. */
  set(updater: T | ((prev: T | undefined) => T)): void;
};

/**
 * A resident store backed by a long-lived QueryObserver. A permanent no-op
 * subscription keeps the observer mounted so its cached result stays current on
 * `setQueryData` and is never GC'd while the SDK lives. `staleTime: Infinity`
 * (from the client defaults) means subscribe/fetch won't auto-refetch over a
 * fanout write; `toPromise()` (`fetchOptimistic`) forces the cold first load.
 */
export function createStore<T>(
  client: QueryClient,
  queryKey: QueryKey,
  queryFn: () => Promise<T>,
): Store<T> {
  const observer = new QueryObserver<T, Error, T, T, QueryKey>(client, {
    queryKey,
    queryFn,
  });
  // Keep mounted for the SDK's lifetime: structural sharing + change notifications.
  observer.subscribe(() => {});
  return {
    get: () => observer.getCurrentResult().data,
    subscribe: (cb) => observer.subscribe(() => cb()),
    toPromise: async () => {
      const result = await observer.fetchOptimistic(observer.options);
      return result.data as T;
    },
    set: (updater) => {
      client.setQueryData<T>(queryKey, updater as never);
    },
  };
}
```

> Verify during exec against `node_modules/@tanstack/query-core/src/queryObserver.ts`: `getCurrentResult()` (sync snapshot, structural-shared `.data`), `subscribe()` (first subscriber triggers a fetch only when data is `undefined`), `fetchOptimistic(options)` (unconditional fetch, resolves a result carrying `.data`). The `QueryObserver` generic arity is `<TQueryFnData, TError, TData, TQueryData, TQueryKey>`; align the type args with the installed `.d.ts` (the gather confirmed the 5-arg shape — adjust if the patched build differs). `setQueryData` is synchronous (`queryClient.ts:176-209`).

- [ ] **Step 4: Write `internal/engine/index.ts`:**
```ts
export { createEngineQueryClient } from './query-client';
export { type Store, createStore } from './store';
export { createMutationRunner } from './mutation-runner'; // added in Task 4
```
> If Task 4 is not yet done, omit its export line and add it in Task 4. Keep the file compiling.

- [ ] **Step 5: Run tests + typecheck** → PASS, exit 0. **Also run the seam test** (`bun --cwd packages/wallet-sdk test internal/engine/seam.test.ts`) → PASS (the new `@tanstack` import is inside `internal/engine/`, so zero offenders).

- [ ] **Step 6: Commit.**
```bash
git add packages/wallet-sdk/src/internal/engine/store.ts packages/wallet-sdk/src/internal/engine/store.test.ts packages/wallet-sdk/src/internal/engine/index.ts
git commit -m "feat(wallet-sdk): B-engine Store<T> + createStore (QueryObserver, load-before-serve)"
```

---

### Task 4: `createMutationRunner` — the `TaskRunner` via patched MutationObserver scopes [OPUS]

The runner uses TWO `MutationObserver`s (one per retry policy: bounded-3 default, bounded-5 subscription) whose `mutationFn` runs the task; the lane is supplied per call as the patched `mutate(fn, { scope: { id: lane } })`. `MutationCache` gives FIFO-per-scope + cross-scope concurrency + re-entrant drain for free.

**Files:**
- Create: `packages/wallet-sdk/src/internal/engine/mutation-runner.ts`
- Test: `packages/wallet-sdk/src/internal/engine/mutation-runner.test.ts`

**Interfaces:**
- Consumes: `QueryClient`, `MutationObserver` from `@tanstack/query-core`; `TaskRunner`, `RetryPolicy` from `../tasks/task-runner` + `../tasks/retry-policy`; `defaultRetryPolicy`, `subscriptionRetryPolicy` from `../tasks/retry-policy`.
- Produces: `createMutationRunner(client: QueryClient): TaskRunner`.

- [ ] **Step 1: Write the failing tests** (mirror Variant A's `keyed-queue.test.ts` contract so the two runners are behaviorally identical):
```ts
import { describe, expect, it } from 'bun:test';
import { createEngineQueryClient } from './query-client';
import { createMutationRunner } from './mutation-runner';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('createMutationRunner', () => {
  it('runs same-lane tasks FIFO (sequential)', async () => {
    const runner = createMutationRunner(createEngineQueryClient());
    const order: number[] = [];
    const p1 = runner.runTask('L', async () => { await tick(); order.push(1); });
    const p2 = runner.runTask('L', async () => { order.push(2); });
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  it('runs different lanes concurrently', async () => {
    const runner = createMutationRunner(createEngineQueryClient());
    let aRunning = false;
    let overlapped = false;
    const a = runner.runTask('A', async () => { aRunning = true; await tick(); aRunning = false; });
    const b = runner.runTask('B', async () => { if (aRunning) overlapped = true; });
    await Promise.all([a, b]);
    expect(overlapped).toBe(true);
  });

  it('is re-entrant: a task may enqueue on its OWN lane without deadlock', async () => {
    const runner = createMutationRunner(createEngineQueryClient());
    const order: string[] = [];
    let nested: Promise<unknown> | undefined;
    await runner.runTask('L', async () => {
      order.push('outer-start');
      nested = runner.runTask('L', async () => { order.push('nested'); });
      order.push('outer-end');
    });
    await nested;
    expect(order).toEqual(['outer-start', 'outer-end', 'nested']);
  });

  it('returns the task result and propagates rejection', async () => {
    const runner = createMutationRunner(createEngineQueryClient());
    await expect(runner.runTask('L', async () => 42)).resolves.toBe(42);
    await expect(runner.runTask('L', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });

  it('a failing task does not break the lane for the next task', async () => {
    const runner = createMutationRunner(createEngineQueryClient());
    const done: string[] = [];
    const p1 = runner.runTask('L', async () => { throw new Error('fail'); }).catch(() => done.push('p1-rejected'));
    const p2 = runner.runTask('L', async () => { done.push('p2-ran'); });
    await Promise.all([p1, p2]);
    expect(done).toEqual(['p1-rejected', 'p2-ran']);
  });

  it('honors the retry policy (default bounded-3): retries a transient failure then succeeds', async () => {
    const runner = createMutationRunner(createEngineQueryClient());
    let attempts = 0;
    const result = await runner.runTask('L', async () => {
      attempts += 1;
      if (attempts < 3) throw new ConcurrencyError('retry me'); // a retryable error per defaultRetryPolicy
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });
});
```
> Import `ConcurrencyError` from the SDK error module (`../errors` or `../../errors` — confirm the path; `defaultRetryPolicy.shouldRetry` retries `ConcurrencyError`, never `DomainError`/`MintOperationError`). If wiring the real policies into the test is awkward, instead pass an explicit `policy` arg to `runTask` whose `shouldRetry` returns `count < 2` and assert 3 attempts — but prefer exercising the real `defaultRetryPolicy` so the runner's policy-mapping is genuinely tested. Confirm `retryDelay` values are 0/fast in tests (no long sleeps).

- [ ] **Step 2: Run → FAIL.** Run: `bun --cwd packages/wallet-sdk test internal/engine/mutation-runner.test.ts`.

- [ ] **Step 3: Implement `mutation-runner.ts`:**
```ts
import { MutationObserver, type QueryClient } from '@tanstack/query-core';
import {
  type RetryPolicy,
  defaultRetryPolicy,
  subscriptionRetryPolicy,
} from '../tasks/retry-policy';
import type { TaskRunner } from '../tasks/task-runner';

type Task = () => Promise<unknown>;

/**
 * Variant-B's TaskRunner: lanes are query-core mutation `scope` ids (the
 * dynamic-scope patch), so FIFO-per-lane + cross-lane concurrency + re-entrant
 * drain come free from `MutationCache.canRun`/`runNext`. `retry`/`retryDelay`
 * live on the MutationObserver (NOT on the per-call `mutate` options, which only
 * carry `scope`), so we keep ONE observer per distinct RetryPolicy (the SDK has
 * exactly two) and pick by the policy arg; the lane rides per call.
 */
export function createMutationRunner(client: QueryClient): TaskRunner {
  const observerFor = (policy: RetryPolicy): MutationObserver<unknown, Error, Task> =>
    new MutationObserver<unknown, Error, Task>(client, {
      mutationFn: (task) => task(),
      networkMode: 'always',
      retry: (failureCount, error) => policy.shouldRetry(failureCount, error),
      retryDelay: (failureCount) => policy.retryDelay(failureCount),
    });

  // One observer per policy (re-used across mutate() calls; each call builds its
  // own Mutation in the scope array, so re-entrancy is safe).
  const defaultObserver = observerFor(defaultRetryPolicy);
  const subscriptionObserver = observerFor(subscriptionRetryPolicy);
  const noRetryObserver = new MutationObserver<unknown, Error, Task>(client, {
    mutationFn: (task) => task(),
    networkMode: 'always',
    retry: false,
  });

  const pick = (policy?: RetryPolicy): MutationObserver<unknown, Error, Task> => {
    if (!policy) return noRetryObserver;
    if (policy === subscriptionRetryPolicy) return subscriptionObserver;
    return defaultObserver; // defaultRetryPolicy or any other supplied policy
  };

  return {
    runTask<T>(lane: string, fn: () => Promise<T>, policy?: RetryPolicy): Promise<T> {
      const observer = pick(policy);
      return observer.mutate(fn as Task, { scope: { id: lane } }) as Promise<T>;
    },
  };
}
```

> CRITICAL verifications during exec (read `node_modules/@tanstack/query-core/src/{mutationObserver,mutationCache,mutation,retryer}.ts`):
> - The patch adds `scope` to `MutateOptions`; `observer.mutate(vars, { scope: { id: lane } })` builds the mutation with that scope (`mutationObserver.ts:140-164`). Confirm the second-arg `scope` shape `{ id: string }`.
> - `retry`/`retryDelay` are `MutationObserverOptions` fields, NOT `MutateOptions` — hence one observer per policy. Confirm `retry: false` disables retry (no-policy path).
> - `retry(failureCount, error)` receives prior-failure count (0 first), checked before increment (`retryer.ts:175-186`) → maps to `RetryPolicy.shouldRetry` 1:1.
> - `mutate()` returns `execute()`'s promise → resolves/rejects with the task's result/error.
> - Read `internal/tasks/retry-policy.ts` to confirm the exported names `defaultRetryPolicy`, `subscriptionRetryPolicy` and whether the `policy === subscriptionRetryPolicy` identity check holds (the SDK passes these singletons; if it constructs fresh policy objects per call, switch `pick` to compare by a discriminant or default-vs-subscription bound — read how the processors/services call `runTask` with a policy). If processors pass a `policy` that is neither singleton, the `defaultObserver` is the safe fallback (bounded retry) — but verify no caller relies on a third distinct policy.

- [ ] **Step 4: Run tests + typecheck + seam test** → PASS, exit 0, seam green (import inside `internal/engine/`).

- [ ] **Step 5: Add the export** in `internal/engine/index.ts` (the `createMutationRunner` line from Task 3 Step 4 if deferred).

- [ ] **Step 6: Commit.**
```bash
git add packages/wallet-sdk/src/internal/engine/mutation-runner.ts packages/wallet-sdk/src/internal/engine/mutation-runner.test.ts packages/wallet-sdk/src/internal/engine/index.ts
git commit -m "feat(wallet-sdk): B-engine MutationObserver-scope TaskRunner (FIFO-per-lane, re-entrant)"
```

---

### Task 5: The store registry (9 resident stores + seed queryFns)

Build the nine resident stores (user, accounts, contacts + the 6 quote/swap work sets) over `createStore`, each with a parameterless seed `queryFn` that resolves the current `userId` from the injected `getUser` and reads the matching repo. Empty (`[]`/`null`) when signed out.

**Files:**
- Create: `packages/wallet-sdk/src/store/stores.ts`
- Test: `packages/wallet-sdk/src/store/stores.test.ts`

**Interfaces:**
- Consumes: `createStore`, `Store`, `createEngineQueryClient` from `../internal/engine`; `WalletRuntime` from `../engine`; `User` from `../domains/user-types`; `Account` from `../domains/account-types`; `Contact` from `../domains/contact`; the 6 quote/swap entity types; the repos via `runtime.accountRepository` / `runtime.protocols.*`.
- Produces:
  - `type StoreRegistry = { user: Store<User | null>; accounts: Store<Account[]>; contacts: Store<Contact[]>; cashuSendQuotes: Store<CashuSendQuote[]>; cashuSendSwaps: Store<CashuSendSwap[]>; sparkSendQuotes: Store<SparkSendQuote[]>; cashuReceiveQuotes: Store<CashuReceiveQuote[]>; cashuReceiveSwaps: Store<CashuReceiveSwap[]>; sparkReceiveQuotes: Store<SparkReceiveQuote[]> }`
  - `createStoreRegistry(runtime: WalletRuntime, client: QueryClient, getUser: () => Promise<User | null>): StoreRegistry`
  - `STORE_KEYS` (the stable QueryKeys) + an `allStores(registry): Store<unknown>[]` helper (for `onCatchUp`).

- [ ] **Step 1: Write the failing tests:**
```ts
import { describe, expect, it, mock } from 'bun:test';
import { createEngineQueryClient } from '../internal/engine';
import { allStores, createStoreRegistry } from './stores';

const user = { id: 'u1', defaultCurrency: 'BTC' } as any;

const makeRuntime = (over: Record<string, unknown> = {}) =>
  ({
    accountRepository: { getAllActive: mock(async () => [{ id: 'a1' }]) },
    protocols: {
      contactRepository: { getAll: mock(async () => [{ id: 'c1' }]) },
      cashuSendQuoteRepository: { getUnresolved: mock(async () => [{ id: 'q1' }]) },
      cashuSendSwapRepository: { getUnresolved: mock(async () => []) },
      sparkSendQuoteRepository: { getUnresolved: mock(async () => []) },
      cashuReceiveQuoteRepository: { getPending: mock(async () => []) },
      cashuReceiveSwapRepository: { getPending: mock(async () => []) },
      sparkReceiveQuoteRepository: { getPending: mock(async () => []) },
    },
    ...over,
  }) as any;

describe('createStoreRegistry', () => {
  it('user store seeds from getUser', async () => {
    const reg = createStoreRegistry(makeRuntime(), createEngineQueryClient(), async () => user);
    expect(await reg.user.toPromise()).toEqual(user);
  });

  it('accounts store seeds via accountRepository.getAllActive(userId)', async () => {
    const runtime = makeRuntime();
    const reg = createStoreRegistry(runtime, createEngineQueryClient(), async () => user);
    expect((await reg.accounts.toPromise()).map((a: any) => a.id)).toEqual(['a1']);
    expect(runtime.accountRepository.getAllActive).toHaveBeenCalledWith('u1');
  });

  it('quote stores seed via the matching repo method (send=getUnresolved, receive=getPending)', async () => {
    const runtime = makeRuntime();
    const reg = createStoreRegistry(runtime, createEngineQueryClient(), async () => user);
    expect((await reg.cashuSendQuotes.toPromise()).map((q: any) => q.id)).toEqual(['q1']);
    expect(runtime.protocols.cashuSendQuoteRepository.getUnresolved).toHaveBeenCalledWith('u1');
  });

  it('returns empty (no repo call) when signed out (getUser -> null)', async () => {
    const runtime = makeRuntime();
    const reg = createStoreRegistry(runtime, createEngineQueryClient(), async () => null);
    expect(await reg.accounts.toPromise()).toEqual([]);
    expect(await reg.user.toPromise()).toBeNull();
    expect(runtime.accountRepository.getAllActive).not.toHaveBeenCalled();
  });

  it('allStores returns all nine', () => {
    const reg = createStoreRegistry(makeRuntime(), createEngineQueryClient(), async () => null);
    expect(allStores(reg)).toHaveLength(9);
  });
});
```

- [ ] **Step 2: Run → FAIL.** Run: `bun --cwd packages/wallet-sdk test store/stores.test.ts`.

- [ ] **Step 3: Implement `stores.ts`:**
```ts
import type { QueryClient } from '@tanstack/query-core';
import type { Account } from '../domains/account-types';
import type { CashuReceiveQuote } from '../domains/cashu-receive-quote';
import type { CashuReceiveSwap } from '../domains/cashu-receive-swap';
import type { CashuSendQuote } from '../domains/cashu-send-quote';
import type { CashuSendSwap } from '../domains/cashu-send-swap';
import type { Contact } from '../domains/contact';
import type { SparkReceiveQuote } from '../domains/spark-receive-quote';
import type { SparkSendQuote } from '../domains/spark-send-quote';
import type { User } from '../domains/user-types';
import type { WalletRuntime } from '../engine';
import { type Store, createStore } from '../internal/engine';

export type StoreRegistry = {
  user: Store<User | null>;
  accounts: Store<Account[]>;
  contacts: Store<Contact[]>;
  cashuSendQuotes: Store<CashuSendQuote[]>;
  cashuSendSwaps: Store<CashuSendSwap[]>;
  sparkSendQuotes: Store<SparkSendQuote[]>;
  cashuReceiveQuotes: Store<CashuReceiveQuote[]>;
  cashuReceiveSwaps: Store<CashuReceiveSwap[]>;
  sparkReceiveQuotes: Store<SparkReceiveQuote[]>;
};

export const STORE_KEYS = {
  user: ['store', 'user'] as const,
  accounts: ['store', 'accounts'] as const,
  contacts: ['store', 'contacts'] as const,
  cashuSendQuotes: ['store', 'cashu-send-quotes'] as const,
  cashuSendSwaps: ['store', 'cashu-send-swaps'] as const,
  sparkSendQuotes: ['store', 'spark-send-quotes'] as const,
  cashuReceiveQuotes: ['store', 'cashu-receive-quotes'] as const,
  cashuReceiveSwaps: ['store', 'cashu-receive-swaps'] as const,
  sparkReceiveQuotes: ['store', 'spark-receive-quotes'] as const,
};

/**
 * The nine resident Variant-B stores. Each list store's parameterless seed
 * resolves the current userId from `getUser` (the injected `() => sdk.user.get()`)
 * and reads its repo; signed-out → empty without a repo call. `staleTime: Infinity`
 * (client default) means the fanout's version-gated writes own freshness after seed.
 */
export function createStoreRegistry(
  runtime: WalletRuntime,
  client: QueryClient,
  getUser: () => Promise<User | null>,
): StoreRegistry {
  const p = runtime.protocols;
  const listFor = <T>(key: readonly unknown[], read: (userId: string) => Promise<T[]>) =>
    createStore<T[]>(client, [...key], async () => {
      const id = (await getUser())?.id;
      return id ? read(id) : [];
    });

  return {
    user: createStore<User | null>(client, [...STORE_KEYS.user], () => getUser()),
    accounts: listFor(STORE_KEYS.accounts, (id) => runtime.accountRepository.getAllActive(id)),
    contacts: listFor(STORE_KEYS.contacts, (id) => p.contactRepository.getAll(id)),
    cashuSendQuotes: listFor(STORE_KEYS.cashuSendQuotes, (id) => p.cashuSendQuoteRepository.getUnresolved(id)),
    cashuSendSwaps: listFor(STORE_KEYS.cashuSendSwaps, (id) => p.cashuSendSwapRepository.getUnresolved(id)),
    sparkSendQuotes: listFor(STORE_KEYS.sparkSendQuotes, (id) => p.sparkSendQuoteRepository.getUnresolved(id)),
    cashuReceiveQuotes: listFor(STORE_KEYS.cashuReceiveQuotes, (id) => p.cashuReceiveQuoteRepository.getPending(id)),
    cashuReceiveSwaps: listFor(STORE_KEYS.cashuReceiveSwaps, (id) => p.cashuReceiveSwapRepository.getPending(id)),
    sparkReceiveQuotes: listFor(STORE_KEYS.sparkReceiveQuotes, (id) => p.sparkReceiveQuoteRepository.getPending(id)),
  };
}

export function allStores(reg: StoreRegistry): Store<unknown>[] {
  return Object.values(reg) as Store<unknown>[];
}
```

> Verify during exec: the exact repo method names + that `getAllActive`/`getUnresolved`/`getPending`/`getAll` take `(userId)` (the gather confirmed all). `contactRepository.getAll(ownerId)` (single arg, options optional). Confirm `runtime.accountRepository` (not `runtime.protocols.accountRepository`). The `QueryClient` import here is `import type` only (no value use) — but `import type` from `@tanstack/query-core` STILL trips the seam rule/test (the test greps `from '@tanstack/`). **Resolve: do NOT import `QueryClient` from `@tanstack` in `store/` — type the `client` param via the engine.** Add `export type { QueryClient } from '@tanstack/query-core'` to `internal/engine/index.ts` and import it from `../internal/engine` here, OR type `createStoreRegistry`'s client param as `Parameters<typeof createStore>[0]`. Use the engine re-export so `store/` never names `@tanstack`.

- [ ] **Step 4: Run tests + typecheck + seam test** → PASS, exit 0, **seam green** (no `@tanstack` import in `store/`).

- [ ] **Step 5: Commit.**
```bash
git add packages/wallet-sdk/src/store/stores.ts packages/wallet-sdk/src/store/stores.test.ts packages/wallet-sdk/src/internal/engine/index.ts
git commit -m "feat(wallet-sdk): B-engine store registry (9 resident stores + seed queryFns)"
```

---

### Task 6: `createWorkSets` — the `WorkSetSource` over stores (load-before-serve + online filter)

The 6 work-set reads come off the 6 quote/swap stores, online-filtered via the accounts store. **CRITICAL (the A `ensureLoaded` lesson):** each read first `await`s the accounts store AND its quote store via `toPromise()` so the immediately-following synchronous `wallets.getCashuAccount` in `processor.reload` never hits a cold store.

**Files:**
- Create: `packages/wallet-sdk/src/store/work-sets.ts`
- Test: `packages/wallet-sdk/src/store/work-sets.test.ts`

**Interfaces:**
- Consumes: `WorkSetSource` from `../engine`; `StoreRegistry` from `./stores`.
- Produces: `createWorkSets(stores: StoreRegistry): WorkSetSource`.

- [ ] **Step 1: Write the failing tests:**
```ts
import { describe, expect, it, mock } from 'bun:test';
import { createWorkSets } from './work-sets';

const fakeStore = (data: any[]) => ({
  get: () => data,
  toPromise: mock(async () => data),
  subscribe: () => () => {},
  set: () => {},
});

const accountsStore = (online: Record<string, boolean>) =>
  ({
    get: () => Object.entries(online).map(([id, isOnline]) => ({ id, isOnline })),
    toPromise: mock(async () => Object.entries(online).map(([id, isOnline]) => ({ id, isOnline }))),
    subscribe: () => () => {},
    set: () => {},
  }) as any;

describe('createWorkSets', () => {
  it('keeps only items whose account is online, after awaiting both stores', async () => {
    const stores = {
      accounts: accountsStore({ on: true, off: false }),
      cashuSendQuotes: fakeStore([
        { id: 'q1', accountId: 'on' },
        { id: 'q2', accountId: 'off' },
        { id: 'q3', accountId: 'missing' },
      ]),
      cashuSendSwaps: fakeStore([]),
      sparkSendQuotes: fakeStore([]),
      cashuReceiveQuotes: fakeStore([]),
      cashuReceiveSwaps: fakeStore([]),
      sparkReceiveQuotes: fakeStore([]),
    } as any;
    const ws = createWorkSets(stores);
    const result = await ws.getUnresolvedCashuSendQuotes('u1');
    expect(result.map((q: any) => q.id)).toEqual(['q1']);
    expect(stores.accounts.toPromise).toHaveBeenCalled(); // load-before-serve
    expect(stores.cashuSendQuotes.toPromise).toHaveBeenCalled();
  });

  it('exposes all 6 WorkSetSource methods returning arrays', async () => {
    const empty = () => fakeStore([]);
    const stores = {
      accounts: accountsStore({}),
      cashuSendQuotes: empty(), cashuSendSwaps: empty(), sparkSendQuotes: empty(),
      cashuReceiveQuotes: empty(), cashuReceiveSwaps: empty(), sparkReceiveQuotes: empty(),
    } as any;
    const ws = createWorkSets(stores);
    for (const m of [
      'getUnresolvedCashuSendQuotes', 'getUnresolvedCashuSendSwaps', 'getUnresolvedSparkSendQuotes',
      'getPendingCashuReceiveQuotes', 'getPendingCashuReceiveSwaps', 'getPendingSparkReceiveQuotes',
    ] as const) {
      expect(Array.isArray(await (ws as any)[m]('u1'))).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run → FAIL.** Run: `bun --cwd packages/wallet-sdk test store/work-sets.test.ts`.

- [ ] **Step 3: Implement `work-sets.ts`:**
```ts
import type { WorkSetSource } from '../engine';
import type { Store } from '../internal/engine';
import type { StoreRegistry } from './stores';

/**
 * Variant-B work sets: read each quote/swap STORE (kept fresh by the fanout), then
 * drop items whose account is not online. Each read awaits the accounts store AND
 * the quote store via toPromise() FIRST — load-before-serve — so the synchronous
 * WalletAccess read that fires next inside `processor.reload` (the only await
 * before `wallets.getCashuAccount`) hits a populated accounts snapshot. Mirrors
 * Variant A's `work-sets.ts` ensureLoaded + tolerant online filter.
 */
export function createWorkSets(stores: StoreRegistry): WorkSetSource {
  const isOnline = (accountId: string): boolean =>
    (stores.accounts.get() ?? []).some((a) => a.id === accountId && a.isOnline === true);

  const read = async <T extends { accountId: string }>(
    store: Store<T[]>,
  ): Promise<T[]> => {
    await stores.accounts.toPromise(); // online-filter source must be warm
    const items = await store.toPromise(); // the work set itself
    return items.filter((item) => isOnline(item.accountId));
  };

  return {
    getUnresolvedCashuSendQuotes: () => read(stores.cashuSendQuotes),
    getUnresolvedCashuSendSwaps: () => read(stores.cashuSendSwaps),
    getUnresolvedSparkSendQuotes: () => read(stores.sparkSendQuotes),
    getPendingCashuReceiveQuotes: () => read(stores.cashuReceiveQuotes),
    getPendingCashuReceiveSwaps: () => read(stores.cashuReceiveSwaps),
    getPendingSparkReceiveQuotes: () => read(stores.sparkReceiveQuotes),
  };
}
```

> Note: the `userId` param of each `WorkSetSource` method is unused in B (the store's seed queryFn already resolved the user). Keep the signature (`(userId) => …`) to satisfy the seam type; the leading `_userId` can be omitted since the arrow ignores it. After the first `toPromise()`, subsequent reads return the cached store value instantly (staleTime Infinity) — the fanout is what keeps it fresh, NOT a refetch. `Store` is imported from `../internal/engine` (the re-export), never `@tanstack`.

- [ ] **Step 4: Run tests + typecheck + seam test** → PASS, exit 0, seam green.

- [ ] **Step 5: Commit.**
```bash
git add packages/wallet-sdk/src/store/work-sets.ts packages/wallet-sdk/src/store/work-sets.test.ts
git commit -m "feat(wallet-sdk): B-engine store-read work-sets (load-before-serve + online filter)"
```

---

### Task 7: `StoreWalletAccess` — `WalletAccess` off the accounts-store snapshot

The synchronous `WalletAccess` getters read `stores.accounts.get()` (the resident snapshot) and reuse Variant A's resolution logic verbatim (throw on miss; `getSourceCashuWallet` rejects `NetworkError` when offline). Reference: `sdkx-stateless/packages/wallet-sdk/src/stateless/resident-accounts.ts` (the proven logic).

**Files:**
- Create: `packages/wallet-sdk/src/store/wallets.ts`
- Test: `packages/wallet-sdk/src/store/wallets.test.ts`

**Interfaces:**
- Consumes: `WalletAccess`, `WalletRuntime` from `../engine`; `Account`, `CashuAccount`, `SparkAccount` from `../domains/account-types`; `Currency` from `@agicash/money`; `ExtendedCashuWallet` + `getCashuWallet` from `../internal/cashu/wallet`; `getInitializedCashuWallet` from `../internal/cashu/init-wallet`; `getCashuUnit`, `areMintUrlsEqual` from `@agicash/cashu`; `NetworkError` from `@cashu/cashu-ts`; `Store` from `../internal/engine`.
- Produces: `class StoreWalletAccess implements WalletAccess` with additional `isOnline(accountId): boolean` (tolerant; used nowhere external but symmetric with A) — actually the online filter lives in work-sets; `isOnline` is optional here. Keep the class minimal: the 4 `WalletAccess` methods.

- [ ] **Step 1: Write the failing tests** (port `sdkx-stateless/packages/wallet-sdk/src/stateless/resident-accounts.test.ts`, swapping the resident map for an accounts `Store`):
```ts
import { describe, expect, it, mock } from 'bun:test';
import { NetworkError } from '@cashu/cashu-ts';
import { StoreWalletAccess } from './wallets';

const cashu = (over: Record<string, unknown> = {}) =>
  ({ id: 'c1', type: 'cashu', currency: 'BTC', mintUrl: 'https://m/', isOnline: true, wallet: { tag: 'warm' }, proofs: [], ...over }) as any;
const spark = (over: Record<string, unknown> = {}) =>
  ({ id: 's1', type: 'spark', currency: 'BTC', isOnline: true, wallet: { tag: 'spark' }, ...over }) as any;

const accountsStore = (accounts: any[]) => ({ get: () => accounts, toPromise: async () => accounts, subscribe: () => () => {}, set: () => {} }) as any;
const runtime = () => ({ mintCache: { tag: 'mintCache' } }) as any;

describe('StoreWalletAccess', () => {
  it('getCashuAccount / getSparkAccount return residents from the store snapshot', () => {
    const c = cashu(); const s = spark();
    const wa = new StoreWalletAccess(accountsStore([c, s]), runtime());
    expect(wa.getCashuAccount('c1')).toBe(c);
    expect(wa.getSparkAccount('s1')).toBe(s);
  });
  it('getCashuAccount throws on miss / wrong type', () => {
    const wa = new StoreWalletAccess(accountsStore([]), runtime());
    expect(() => wa.getCashuAccount('nope')).toThrow();
  });
  it('getCashuWalletByMint returns the resident wallet for matching mint+currency', () => {
    const c = cashu();
    const wa = new StoreWalletAccess(accountsStore([c]), runtime());
    expect(wa.getCashuWalletByMint('https://m/', 'BTC')).toBe(c.wallet);
  });
  it('getSourceCashuWallet rejects NetworkError when a resident mint is offline', async () => {
    const wa = new StoreWalletAccess(accountsStore([cashu({ isOnline: false })]), runtime());
    await expect(wa.getSourceCashuWallet('https://m/', 'BTC')).rejects.toBeInstanceOf(NetworkError);
  });
});
```
> For the non-resident offline path, `mock.module('../internal/cashu/init-wallet', () => ({ getInitializedCashuWallet: mock(async () => ({ wallet: {}, isOnline: false })) }))` and assert `getSourceCashuWallet('https://other/','BTC')` rejects `NetworkError` — exactly as A's test does.

- [ ] **Step 2: Run → FAIL.** Run: `bun --cwd packages/wallet-sdk test store/wallets.test.ts`.

- [ ] **Step 3: Implement `wallets.ts`** — read `sdkx-stateless/packages/wallet-sdk/src/stateless/resident-accounts.ts` and reproduce its `getCashuAccount`/`getSparkAccount`/`getCashuWalletByMint`/`getSourceCashuWallet`/`findCashuByMint` bodies verbatim, replacing every `this.map.get(...)`/`this.map.values()` with `(this.accountsStore.get() ?? [])` lookups:
```ts
import { areMintUrlsEqual, getCashuUnit } from '@agicash/cashu';
import type { Currency } from '@agicash/money';
import { NetworkError } from '@cashu/cashu-ts';
import type { Account, CashuAccount, SparkAccount } from '../domains/account-types';
import type { WalletAccess, WalletRuntime } from '../engine';
import { getInitializedCashuWallet } from '../internal/cashu/init-wallet';
import { type ExtendedCashuWallet, getCashuWallet } from '../internal/cashu/wallet';
import type { Store } from '../internal/engine';

/** Variant-B WalletAccess: the synchronous getters read the accounts STORE
 * snapshot (kept fresh by the fanout). Same resolution + fallbacks + offline
 * NetworkError behavior as Variant A's ResidentAccounts. */
export class StoreWalletAccess implements WalletAccess {
  constructor(
    private readonly accountsStore: Store<Account[]>,
    private readonly runtime: WalletRuntime,
  ) {}

  private all(): Account[] {
    return this.accountsStore.get() ?? [];
  }

  getCashuAccount(accountId: string): CashuAccount {
    const account = this.all().find((a) => a.id === accountId);
    if (!account || account.type !== 'cashu') throw new Error(`No resident cashu account ${accountId}`);
    return account;
  }

  getSparkAccount(accountId: string): SparkAccount {
    const account = this.all().find((a) => a.id === accountId);
    if (!account || account.type !== 'spark') throw new Error(`No resident spark account ${accountId}`);
    return account;
  }

  getCashuWalletByMint(mintUrl: string, currency: Currency): ExtendedCashuWallet {
    const resident = this.findCashuByMint(mintUrl, currency);
    return resident ? resident.wallet : getCashuWallet(mintUrl, { unit: getCashuUnit(currency) });
  }

  async getSourceCashuWallet(mintUrl: string, currency: Currency): Promise<ExtendedCashuWallet> {
    const resident = this.findCashuByMint(mintUrl, currency);
    if (resident) {
      if (!resident.isOnline) throw new NetworkError(`Mint ${mintUrl} is offline`);
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

  private findCashuByMint(mintUrl: string, currency: Currency): CashuAccount | undefined {
    return this.all().find(
      (a): a is CashuAccount =>
        a.type === 'cashu' && a.currency === currency && areMintUrlsEqual(a.mintUrl, mintUrl),
    );
  }
}
```
> Verify during exec: the exact `getInitializedCashuWallet` arg names + `getCashuWallet` options shape against A's `resident-accounts.ts` (which compiled green). Confirm `areMintUrlsEqual` is the equality A used.

- [ ] **Step 4: Run tests + typecheck + seam test** → PASS, exit 0, seam green.

- [ ] **Step 5: Commit.**
```bash
git add packages/wallet-sdk/src/store/wallets.ts packages/wallet-sdk/src/store/wallets.test.ts
git commit -m "feat(wallet-sdk): B-engine StoreWalletAccess (WalletAccess off accounts store)"
```

---

### Task 8: `createFanout` — version-gated store writes + catch-up refetch [OPUS]

Map each of the 11 `ChangeFeedChange` kinds to a synchronous, version-gated store write: list stores add/replace by id (skip stale `version`) and EVICT items that leave their keep-set; accounts upsert (keep `state==='active'`) BEFORE returning; user overwrite; contacts add/remove; transaction = no-op. `onCatchUp` refetches all stores.

**Files:**
- Create: `packages/wallet-sdk/src/store/fanout.ts`
- Test: `packages/wallet-sdk/src/store/fanout.test.ts`

**Interfaces:**
- Consumes: `ChangeFeedChange` from `../engine`; `EntityFanout` from `../internal/realtime/change-feed-ports`; `StoreRegistry`, `allStores` from `./stores`.
- Produces: `createFanout(stores: StoreRegistry): EntityFanout`.

- [ ] **Step 1: Write the failing tests:**
```ts
import { describe, expect, it, mock } from 'bun:test';
import { createFanout } from './fanout';

const listStore = (initial: any[] = []) => {
  let data = initial;
  return {
    get: () => data,
    set: (u: any) => { data = typeof u === 'function' ? u(data) : u; },
    toPromise: mock(async () => data),
    subscribe: () => () => {},
    _data: () => data,
  };
};
const singleStore = (initial: any = null) => {
  let data = initial;
  return { get: () => data, set: (u: any) => { data = typeof u === 'function' ? u(data) : u; }, toPromise: mock(async () => data), subscribe: () => () => {}, _data: () => data };
};

const makeStores = () => ({
  user: singleStore(),
  accounts: listStore(),
  contacts: listStore(),
  cashuSendQuotes: listStore(),
  cashuSendSwaps: listStore(),
  sparkSendQuotes: listStore(),
  cashuReceiveQuotes: listStore(),
  cashuReceiveSwaps: listStore(),
  sparkReceiveQuotes: listStore(),
}) as any;

describe('createFanout', () => {
  it('account upsert writes the store (keep active)', () => {
    const s = makeStores();
    createFanout(s).emit({ kind: 'account', operation: 'created', entity: { id: 'a1', state: 'active', version: 1 } } as any);
    expect(s.accounts._data()).toEqual([{ id: 'a1', state: 'active', version: 1 }]);
  });

  it('account update is version-gated (stale skipped)', () => {
    const s = makeStores();
    const f = createFanout(s);
    f.emit({ kind: 'account', operation: 'created', entity: { id: 'a1', state: 'active', version: 5 } } as any);
    f.emit({ kind: 'account', operation: 'updated', entity: { id: 'a1', state: 'active', version: 3 } } as any); // stale
    expect(s.accounts._data()[0].version).toBe(5);
  });

  it('account flipping to expired is REMOVED from the store', () => {
    const s = makeStores();
    const f = createFanout(s);
    f.emit({ kind: 'account', operation: 'created', entity: { id: 'a1', state: 'active', version: 1 } } as any);
    f.emit({ kind: 'account', operation: 'updated', entity: { id: 'a1', state: 'expired', version: 2 } } as any);
    expect(s.accounts._data()).toEqual([]);
  });

  it('cashu-send-quote leaving the keep-set (UNPAID/PENDING) is removed', () => {
    const s = makeStores();
    const f = createFanout(s);
    f.emit({ kind: 'cashu-send-quote', operation: 'created', entity: { id: 'q1', state: 'PENDING', accountId: 'a', version: 1 } } as any);
    expect(s.cashuSendQuotes._data()).toHaveLength(1);
    f.emit({ kind: 'cashu-send-quote', operation: 'updated', entity: { id: 'q1', state: 'PAID', accountId: 'a', version: 2 } } as any);
    expect(s.cashuSendQuotes._data()).toEqual([]); // PAID not in {UNPAID,PENDING}
  });

  it('cashu-receive-swap keeps only PENDING', () => {
    const s = makeStores();
    const f = createFanout(s);
    f.emit({ kind: 'cashu-receive-swap', operation: 'created', entity: { tokenHash: 't1', id: 't1', state: 'PENDING', accountId: 'a', version: 1 } } as any);
    expect(s.cashuReceiveSwaps._data()).toHaveLength(1);
    f.emit({ kind: 'cashu-receive-swap', operation: 'updated', entity: { tokenHash: 't1', id: 't1', state: 'COMPLETED', accountId: 'a', version: 2 } } as any);
    expect(s.cashuReceiveSwaps._data()).toEqual([]);
  });

  it('user overwrites; contacts add/remove; transaction is a no-op', () => {
    const s = makeStores();
    const f = createFanout(s);
    f.emit({ kind: 'user', operation: 'updated', entity: { id: 'u1' } } as any);
    expect(s.user._data()).toEqual({ id: 'u1' });
    f.emit({ kind: 'contact', operation: 'created', entity: { id: 'c1' } } as any);
    expect(s.contacts._data()).toEqual([{ id: 'c1' }]);
    f.emit({ kind: 'contact-deleted', id: 'c1' } as any);
    expect(s.contacts._data()).toEqual([]);
    f.emit({ kind: 'transaction', operation: 'updated', entity: { id: 'tx1' } } as any); // no throw, no store
  });

  it('onCatchUp refetches all stores', async () => {
    const s = makeStores();
    createFanout(s).onCatchUp();
    await new Promise((r) => setTimeout(r, 0));
    expect(s.accounts.toPromise).toHaveBeenCalled();
    expect(s.user.toPromise).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run → FAIL.** Run: `bun --cwd packages/wallet-sdk test store/fanout.test.ts`.

- [ ] **Step 3: Implement `fanout.ts`:**
```ts
import type { ChangeFeedChange } from '../engine';
import type { EntityFanout } from '../internal/realtime/change-feed-ports';
import { type StoreRegistry, allStores } from './stores';
import type { Store } from '../internal/engine';

/** Keep-set predicates = the exact repo getUnresolved/getPending state filters. */
const KEEP: Record<string, (state: string) => boolean> = {
  'cashu-send-quote': (s) => s === 'UNPAID' || s === 'PENDING',
  'cashu-send-swap': (s) => s === 'DRAFT' || s === 'PENDING',
  'spark-send-quote': (s) => s === 'UNPAID' || s === 'PENDING',
  'cashu-receive-quote': (s) => s === 'UNPAID' || s === 'PAID',
  'cashu-receive-swap': (s) => s === 'PENDING',
  'spark-receive-quote': (s) => s === 'UNPAID',
};

function upsertVersioned<T extends { id: string; version: number }>(
  store: Store<T[]>,
  entity: T,
  keep: boolean,
): void {
  store.set((prev = []) => {
    const without = prev.filter((x) => x.id !== entity.id);
    if (!keep) return without; // left the set -> evict
    const existing = prev.find((x) => x.id === entity.id);
    if (existing && existing.version >= entity.version) return prev; // stale -> skip
    return [...without, entity];
  });
}

/**
 * Variant-B fanout: each ChangeFeedChange kind → a SYNCHRONOUS version-gated
 * store write (the change-feed calls emit() before the processor trigger, and
 * `setQueryData` is sync). Accounts upsert keeps `state==='active'` and runs
 * before emit returns so the trigger's sync WalletAccess read is fresh. The
 * `transaction` kind is a no-op (no tx store). `onCatchUp` refetches all stores.
 */
export function createFanout(stores: StoreRegistry): EntityFanout {
  return {
    emit(change: ChangeFeedChange): void {
      switch (change.kind) {
        case 'user':
          stores.user.set(() => change.entity);
          return;
        case 'account':
          upsertVersioned(stores.accounts, change.entity, change.entity.state === 'active');
          return;
        case 'transaction':
          return; // no tx store
        case 'contact':
          stores.contacts.set((prev = []) =>
            prev.some((c) => c.id === change.entity.id) ? prev : [...prev, change.entity],
          );
          return;
        case 'contact-deleted':
          stores.contacts.set((prev = []) => prev.filter((c) => c.id !== change.id));
          return;
        case 'cashu-send-quote':
          upsertVersioned(stores.cashuSendQuotes, change.entity, KEEP[change.kind](change.entity.state));
          return;
        case 'cashu-send-swap':
          upsertVersioned(stores.cashuSendSwaps, change.entity, KEEP[change.kind](change.entity.state));
          return;
        case 'spark-send-quote':
          upsertVersioned(stores.sparkSendQuotes, change.entity, KEEP[change.kind](change.entity.state));
          return;
        case 'cashu-receive-quote':
          upsertVersioned(stores.cashuReceiveQuotes, change.entity, KEEP[change.kind](change.entity.state));
          return;
        case 'cashu-receive-swap':
          upsertVersioned(stores.cashuReceiveSwaps, change.entity, KEEP[change.kind](change.entity.state));
          return;
        case 'spark-receive-quote':
          upsertVersioned(stores.sparkReceiveQuotes, change.entity, KEEP[change.kind](change.entity.state));
          return;
      }
    },
    onCatchUp(): void {
      void Promise.all(allStores(stores).map((s) => s.toPromise())).catch((error) =>
        console.error('store catch-up refetch failed', { cause: error }),
      );
    },
  };
}
```

> Verify during exec: (1) the EXACT keep-state literals against each repo's `getUnresolved`/`getPending` `.in('state', [...])`/`.eq('state', ...)` — gather confirmed cashu-send-quote `[UNPAID,PENDING]`, cashu-send-swap `[DRAFT,PENDING]`, spark-send-quote `[UNPAID,PENDING]`, cashu-receive-quote `[UNPAID,PAID]`, cashu-receive-swap `PENDING`, spark-receive-quote `UNPAID`; re-read the 6 repo files to be certain. (2) `cashu-receive-swap` entities key on `tokenHash` not `id` — `upsertVersioned` uses `.id`; confirm `CashuReceiveSwap` carries an `id` field (gather: it carries `.version`; check `.id` vs `.tokenHash` and if it lacks `id`, key the swap store on `tokenHash` via a small variant of `upsertVersioned` keyed by a passed `keyOf`). (3) `Account.state` is `'active'|'expired'` (account-types.ts:13,27). (4) the `change.entity` types in each case narrow correctly off the discriminated union — the switch on `change.kind` gives TS the right `entity` type. The `KEEP[change.kind]` index is safe inside each case (kind is the literal).

- [ ] **Step 4: Run tests + typecheck + seam test** → PASS, exit 0, seam green.

- [ ] **Step 5: Commit.**
```bash
git add packages/wallet-sdk/src/store/fanout.ts packages/wallet-sdk/src/store/fanout.test.ts
git commit -m "feat(wallet-sdk): B-engine version-gated store fanout + catch-up refetch"
```

---

### Task 9: `createStoreEngine` + `createStoreSdk` entry + public `Store` reads + `./store` export [OPUS]

Assemble the engine (`{ runner, workSets, wallets, fanout }` + the captured `stores`), then the `createStoreSdk` client entry that wires `createStoreEngine` into `Sdk.create` (injecting `getUser` via closure — zero seam change), augments `sdk.accounts` with the `StoreAccounts` surface (`list()`/`get`/`getDefault` fallback — the 6b carry), and exposes the spec's `Store<T>` hot reads on the domains.

**Files:**
- Create: `packages/wallet-sdk/src/store/engine.ts`
- Create: `packages/wallet-sdk/src/store/accounts-surface.ts`
- Create: `packages/wallet-sdk/src/store/index.ts`
- Test: `packages/wallet-sdk/src/store/engine.test.ts`, `packages/wallet-sdk/src/store/accounts-surface.test.ts`, `packages/wallet-sdk/src/store/index.test.ts`
- Modify: `packages/wallet-sdk/package.json` (add the `./store` subpath export)

**Interfaces:**
- Consumes: `CreateEngine`, `EngineContext`, `SdkEngine` from `../engine`; `Sdk`, `SdkConfig` from `../sdk`/`../config`; `createEngineQueryClient`, `createMutationRunner`, `Store` from `../internal/engine`; `createStoreRegistry`, `StoreRegistry` (Task 5); `createWorkSets` (Task 6); `StoreWalletAccess` (Task 7); `createFanout` (Task 8); `AccountsDomain` (`../domains/accounts`); `User`/`Account`/`Currency`.
- Produces:
  - `createStoreEngine(ctx: EngineContext, getUser: () => Promise<User | null>): SdkEngine & { stores: StoreRegistry }`
  - `type StoreAccounts = AccountsDomain & { all: Store<Account[]>; list(): Promise<Account[]>; getDefault(currency?: Currency): Promise<Account> }`
  - `createStoreAccounts({ base, accountsStore, getUser }): StoreAccounts`
  - `createStoreSdk(config, deps?): Promise<StoreSdk>`; `type StoreSdk`; re-export `Store`, `createStoreEngine`.

- [ ] **Step 1: Implement `engine.ts`:**
```ts
import type { CreateEngine, EngineContext, SdkEngine } from '../engine';
import type { User } from '../domains/user-types';
import { createEngineQueryClient, createMutationRunner } from '../internal/engine';
import { createFanout } from './fanout';
import { type StoreRegistry, createStoreRegistry } from './stores';
import { StoreWalletAccess } from './wallets';
import { createWorkSets } from './work-sets';

/** Variant-B engine: hidden query-core client, nine resident stores, a
 * MutationObserver-scope runner, store-read work sets, accounts-snapshot
 * WalletAccess, and a version-gated store-write fanout. Returns the SdkEngine
 * plus the captured `stores` (the entry needs them for the public Store reads
 * + the accounts surface). The base `sdk.ts` consumes only the 4 SdkEngine
 * fields and ignores the extra `stores` field. */
export function createStoreEngine(
  ctx: EngineContext,
  getUser: () => Promise<User | null>,
): SdkEngine & { stores: StoreRegistry } {
  const client = createEngineQueryClient();
  const stores = createStoreRegistry(ctx.runtime, client, getUser);
  return {
    runner: createMutationRunner(client),
    workSets: createWorkSets(stores),
    wallets: new StoreWalletAccess(stores.accounts, ctx.runtime),
    fanout: createFanout(stores),
    stores,
  };
}
```
> Test (`engine.test.ts`): build a fake `ctx` (events/runtime/config) like A's `engine.test.ts`, call `createStoreEngine(ctx, async () => null)`, assert the 4 seam fields are functions/objects and `stores` has 9 entries.

- [ ] **Step 2: Implement `accounts-surface.ts`** — port `sdkx-stateless/packages/wallet-sdk/src/stateless/accounts-surface.ts` (the `getDefault` first-of-currency fallback = the 6b carry), but source `list()`/the fallback from the accounts **store** + add the `all` Store property:
```ts
import type { Currency } from '@agicash/money';
import type { Account } from '../domains/account-types';
import type { AccountsDomain } from '../domains/accounts';
import type { User } from '../domains/user-types';
import type { Store } from '../internal/engine';

type Deps = {
  base: AccountsDomain;
  accountsStore: Store<Account[]>;
  getUser: () => Promise<User | null>;
};

export type StoreAccounts = AccountsDomain & {
  all: Store<Account[]>;
  list(): Promise<Account[]>;
  getDefault(currency?: Currency): Promise<Account>;
};

/** Variant-B accounts surface: the `all` Store (the hot read), a Promise `list()`
 * (load-before-serve via the store), and getDefault with the 6b first-of-currency
 * fallback (matches the app's useDefaultAccount). */
export function createStoreAccounts(deps: Deps): StoreAccounts {
  const list = async (): Promise<Account[]> => deps.accountsStore.toPromise();

  const getDefault = async (currency?: Currency): Promise<Account> => {
    try {
      return await deps.base.getDefault(currency ? { currency } : undefined);
    } catch (error) {
      const user = await deps.getUser();
      const target = currency ?? user?.defaultCurrency;
      const candidates = (await deps.accountsStore.toPromise())
        .filter((a) => a.currency === target)
        .sort((x, y) => (x.createdAt < y.createdAt ? -1 : 1));
      const fallback = candidates[0];
      if (!fallback) throw error;
      return fallback;
    }
  };

  return new Proxy(deps.base, {
    get(targetBase, prop, receiver) {
      if (prop === 'all') return deps.accountsStore;
      if (prop === 'list') return list;
      if (prop === 'getDefault') return getDefault;
      return Reflect.get(targetBase, prop, receiver);
    },
  }) as unknown as StoreAccounts;
}
```
> Verify during exec: the base `AccountsDomain.getDefault` signature (A used `getDefault(currency?)` then `getDefault({currency})` in A-web — confirm whether base takes `(currency?: Currency)` or `({currency}?)`; the gather's spec shows `getDefault(p?: { currency?: Currency })`). Match the base exactly (read `domains/accounts.ts`). Reuse A's `accounts-surface.test.ts` cases for the fallback (earliest-createdAt, base-success short-circuit, user.defaultCurrency default), adapting `accounts.all()` → `accountsStore`.

- [ ] **Step 3: Implement `index.ts` (the entry + public Store reads):**
```ts
import type { Account } from '../domains/account-types';
import type { CashuReceiveQuote } from '../domains/cashu-receive-quote';
import type { CashuSendQuote } from '../domains/cashu-send-quote';
import type { Contact } from '../domains/contact';
import type { SparkReceiveQuote } from '../domains/spark-receive-quote';
import type { SparkSendQuote } from '../domains/spark-send-quote';
import type { User } from '../domains/user-types';
import type { CreateEngine } from '../engine';
import { Sdk } from '../sdk';
import { type Store } from '../internal/engine';
import { type StoreAccounts, createStoreAccounts } from './accounts-surface';
import { createStoreEngine } from './engine';
import type { StoreRegistry } from './stores';

export { type Store } from '../internal/engine';
export { createStoreEngine } from './engine';

/** Variant-B SDK: the hot reads are `Store<T>` views; everything else is base. */
export type StoreSdk = Omit<Sdk, 'accounts' | 'user' | 'contacts' | 'cashu' | 'spark'> & {
  accounts: StoreAccounts;
  user: Sdk['user'] & { current: Store<User | null> };
  contacts: Sdk['contacts'] & { all: Store<Contact[]> };
  cashu: {
    send: Sdk['cashu']['send'] & { unresolved: Store<CashuSendQuote[]> };
    receive: Sdk['cashu']['receive'] & { pending: Store<CashuReceiveQuote[]> };
  };
  spark: {
    send: Sdk['spark']['send'] & { unresolved: Store<SparkSendQuote[]> };
    receive: Sdk['spark']['receive'] & { pending: Store<SparkReceiveQuote[]> };
  };
};

export async function createStoreSdk(
  config: Parameters<typeof Sdk.create>[0],
  deps?: Omit<NonNullable<Parameters<typeof Sdk.create>[1]>, 'createEngine'>,
): Promise<StoreSdk> {
  // getUser is injected into the engine via this closure. createEngine runs
  // synchronously inside Sdk.create (before `sdk` exists); the placeholder is
  // replaced before any store is fetched (seeding/first read happen after create).
  let getUser: () => Promise<User | null> = async () => null;
  let stores: StoreRegistry | undefined;
  const createEngine: CreateEngine = (ctx) => {
    const engine = createStoreEngine(ctx, () => getUser());
    stores = engine.stores;
    return engine;
  };
  const sdk = await Sdk.create(config, { ...deps, createEngine });
  if (!stores) throw new Error('store engine did not initialise stores');
  getUser = () => sdk.user.get();

  // Augment the domains with the public Store hot reads + the accounts surface.
  const accounts = createStoreAccounts({ base: sdk.accounts, accountsStore: stores.accounts, getUser });
  Object.defineProperty(sdk, 'accounts', { value: accounts, writable: false, configurable: true });
  Object.defineProperty(sdk.user, 'current', { value: stores.user, configurable: true });
  Object.defineProperty(sdk.contacts, 'all', { value: stores.contacts, configurable: true });
  Object.defineProperty(sdk.cashu.send, 'unresolved', { value: stores.cashuSendQuotes, configurable: true });
  Object.defineProperty(sdk.cashu.receive, 'pending', { value: stores.cashuReceiveQuotes, configurable: true });
  Object.defineProperty(sdk.spark.send, 'unresolved', { value: stores.sparkSendQuotes, configurable: true });
  Object.defineProperty(sdk.spark.receive, 'pending', { value: stores.sparkReceiveQuotes, configurable: true });

  return sdk as unknown as StoreSdk;
}
```
> Notes: (1) `sdk.cashu`/`sdk.spark` are plain `{ send, receive }` objects (sdk.ts:65-66) so `defineProperty` on the nested ops is fine. (2) The 2 swap stores (cashuSendSwaps, cashuReceiveSwaps) stay internal (work-set sources only) — not exposed publicly, matching A's `listUnresolved` returning the QUOTE type. (3) `sdk.user` is readonly on the class but `defineProperty` adds a NEW property `current`; that's allowed. (4) the `getUser` placeholder→`sdk.user.get` swap happens before `Object.defineProperty` and before any render/`background.start`, so no store is fetched against the placeholder. (5) Verify `Sdk.create`'s deps shape (`{ openSecret?; createEngine? }`) — `createStoreSdk` drops `createEngine` from the public deps (it supplies its own).

- [ ] **Step 4: Add the `./store` package export** in `packages/wallet-sdk/package.json` (match the `./engine` entry's compact format):
```jsonc
"./store": "./src/store/index.ts",
```

- [ ] **Step 5: Write tests** — `index.test.ts`: drive `createStoreSdk(fakeConfig, { openSecret: fakeOs })` (mirror the fakes in the base `sdk.test.ts`), assert `typeof (sdk.accounts as StoreAccounts).list === 'function'`, `sdk.user.current` is a Store (`typeof sdk.user.current.toPromise === 'function'`), and `sdk.cashu.send.unresolved`/`sdk.spark.receive.pending` are Stores. `accounts-surface.test.ts` + `engine.test.ts` per Steps 1–2.

- [ ] **Step 6: Run tests + typecheck + seam test + FULL suite** → PASS, `bun run typecheck` exit 0 (proves `createStoreEngine` is assignable to `CreateEngine` via the closure wrapper, the seam impls satisfy the engine types, the `StoreSdk` augmentation typechecks), seam green, `bun run test` full suite green.

- [ ] **Step 7: Commit.**
```bash
git add packages/wallet-sdk/src/store/engine.ts packages/wallet-sdk/src/store/accounts-surface.ts packages/wallet-sdk/src/store/index.ts packages/wallet-sdk/src/store/*.test.ts packages/wallet-sdk/package.json
git commit -m "feat(wallet-sdk): B-engine createStoreEngine + createStoreSdk entry + Store hot reads"
```

---

### Task 10: 4c hardening — leader-epoch guard [OPUS]

Identical to Variant A's Task 7. A leader epoch on `ProcessorRegistry`, bumped on `activate` AND `deactivate`, passed into each `processor.reload` so a stale fire-and-forget reload (whose `await fetchWorkSet` resolves after a leadership flip) drops its result. **Reference implementation:** `sdkx-stateless` commit `d083ed7e` (`git show d083ed7e` in that worktree) — reproduce it on `sdkx/store`.

**Files:**
- Modify: `packages/wallet-sdk/src/internal/background/processor-registry.ts`, `internal/background/processors/processor.ts`, all 6 `internal/background/processors/*-processor.ts`
- Test: extend `internal/background/processor-registry.test.ts` + a processor reload-guard test.

**Interfaces:**
- `Processor.reload(userId: string, isCurrent?: () => boolean): Promise<void>` (additive optional param).
- `ProcessorRegistry.activate(userId)`/`deactivate()` bump a private `epoch`; `reloadAll` captures `const epoch = this.epoch` and passes `isCurrent = () => epoch === this.epoch`.

- [ ] **Step 1: Write the failing tests** — port A's registry epoch test + a reload-drop test (registry bumps epoch on activate AND deactivate; a reload whose work-set resolves after deactivate does not touch trackers). See A's Task 7 Step 1 for the exact shape.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — `private epoch = 0`; `activate`: `this.epoch += 1` before `reloadAll()`; `deactivate`: `this.epoch += 1` before disposing; `reloadAll`: capture `const epoch = this.epoch; const isCurrent = () => epoch === this.epoch;` and pass to each `processor.reload`. (Match the existing `reloadAll`/iteration shape — read the file; reproduce A's `d083ed7e` exactly.)
- [ ] **Step 4: Widen `Processor.reload`** to `(userId, isCurrent?)` and in EACH of the 6 processors insert `if (isCurrent && !isCurrent()) return;` immediately after `this.workSet = await this.deps.fetchWorkSet(userId);` and before any tracker `.update(...)`. (Reproduce A's per-processor placement.)
- [ ] **Step 5: Run tests + typecheck + full suite** → PASS, exit 0, existing 4c/leader tests still green.
- [ ] **Step 6: Commit.**
```bash
git add packages/wallet-sdk/src/internal/background/
git commit -m "feat(wallet-sdk): B-engine 4c leader-epoch guard (drop stale reloads)"
```

---

### Task 11: 4c hardening — per-subscription NUT-17 WebSocket teardown

Identical to Variant A's Task 8. Each NUT-17 subscription manager gains `disposeAll()` (runs its unsubscribe fns + clears its map); each tracker's `dispose()` forwards to `manager.disposeAll()` so `registry.deactivate() → processor.dispose() → tracker.dispose() → manager.disposeAll()` closes subscriptions on lost leadership. **Reference:** `sdkx-stateless` commit `5f3a58f1`.

**Files:**
- Modify: `internal/cashu/{mint-quote,melt-quote,proof-state}-subscription-manager.ts`, `internal/cashu/{mint-quote-tracker,melt-quote-tracker,proof-state-tracker}.ts`
- Test: co-located manager/tracker tests.

- [ ] **Step 1: Write the failing tests** (manager `disposeAll` unsubscribes every active subscription + clears; tracker `dispose` forwards) — see A's Task 8 Step 1.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `disposeAll()` on the 3 managers** (snapshot the subscriptions, clear the map, `await Promise.allSettled(entries.map(s => s.unsubscribe()))`; add an `activeMintCount` getter for the test). Reproduce A's `5f3a58f1` shapes.
- [ ] **Step 4: Forward from each tracker's `dispose()`** (`void this.manager.disposeAll().catch(...)`; replace `ProofStateTracker.dispose()`'s no-op body).
- [ ] **Step 5: Run tests + typecheck + full suite** → PASS, exit 0, existing 4a tracker generation/timer tests still green.
- [ ] **Step 6: Commit.**
```bash
git add packages/wallet-sdk/src/internal/cashu/
git commit -m "feat(wallet-sdk): B-engine 4c NUT-17 subscription teardown on deactivate"
```

---

### Task 12: Whole-branch holistic review (OPUS)

Dispatch an OPUS reviewer over the full B-engine diff (`git diff a210e9db..HEAD -- packages/wallet-sdk biome.jsonc`). Verify:
- **Seam conformance:** `createStoreEngine` (via the `createStoreSdk` closure) produces a `CreateEngine`; the four pieces satisfy `TaskRunner`/`WorkSetSource`/`WalletAccess`/`EntityFanout` exactly; base `engine.ts`/`sdk.ts` consumption block/`EventBus`/`ChangeFeedChange`/repos/`EngineContext` are UNCHANGED (no seam widening — `getUser` injected via closure).
- **Engine confinement:** the `seam.test.ts` passes — zero `@tanstack/*` imports outside `internal/engine/`; the biome `noRestrictedImports` rule + `internal/engine/**` override are present; single resolved query-core copy.
- **Runner correctness:** FIFO-per-lane, cross-lane concurrency, re-entrant same-lane enqueue without deadlock, two policies mapped to two observers, `retry(failureCount,error)` 0-based semantics, `networkMode:'always'`.
- **Store correctness:** `get()` referentially stable + undefined-before-load; `toPromise()` = fetchOptimistic (load-before-serve); `set()` synchronous; the permanent no-op subscription keeps the observer mounted.
- **Store freshness + load-before-serve:** work-set reads await accounts + quote `toPromise()` before the sync WalletAccess read; the fanout's account upsert precedes emit-return; `onCatchUp` refetches all 9.
- **Fanout map:** all 11 kinds mapped; version-gate; keep-state eviction matches the repo filters EXACTLY; transaction = no-op; contact-deleted by id.
- **Entry:** `getUser` placeholder swapped before any fetch; the 7 public Store reads exposed (3 entity + 4 quote; 2 swap stores internal); `StoreAccounts` `list`/`getDefault` fallback (6b carry); `./store` sole new export.
- **4c hardening:** epoch bumped on activate AND deactivate; guard after `fetchWorkSet` in all 6; `disposeAll` forwarded from all 3 trackers.
- **Boundary:** zero `apps/web-wallet/**` changes; no Sentry/env reads in the SDK.
- **Gate:** `bun run typecheck` 8/8 exit 0 + `bun run test` full suite green (controller re-verifies). Reviewer must NOT run `fix:all`.

Triage the per-task Minors (rolled up in the ledger) — decide which, if any, must be fixed before this branch is eval-ready.

---

## Self-Review (writing-plans checklist)

**1. Spec coverage:** Engine rules (seams lint + override → T1; explicit headless defaultOptions → T2; seed-on-start lifecycle → stores self-seed via toPromise, T5/T6; resync on reconnect → fanout.onCatchUp, T8; patch+pin+single-copy → T1) ✓. `Store<T>` first-load/referential-stability/seeding-under-isServer tests → T2/T3/T5 ✓. Runner via patched MutationObserver scopes → T4 ✓. 9 stores + workSets + WalletAccess + fanout → T5–T8 ✓. `createStoreSdk` + Store hot reads → T9 ✓. 4c fold-ins → T10–T11 ✓. No `connection:resync` event (B exposes core only) — onCatchUp just refetches, no event ✓.

**2. Placeholder scan:** All code steps carry full code; the "verify during exec" notes point at exact files to confirm signatures (not deferred work). The 4c tasks reference A's exact commits (`d083ed7e`, `5f3a58f1`) as the proven implementation to reproduce — legitimate external references to real code, not placeholders.

**3. Type consistency:** `Store<T>`, `StoreRegistry`, `STORE_KEYS`, `allStores`, `createStore`, `createMutationRunner`, `createEngineQueryClient`, `createStoreRegistry`, `createWorkSets`, `StoreWalletAccess`, `createFanout`, `createStoreEngine`, `createStoreAccounts`/`StoreAccounts`, `createStoreSdk`/`StoreSdk` are consistent across tasks. The user-store seed `getUser` threads from T9's closure → T5's registry. The `Store` type is imported from `../internal/engine` everywhere in `store/` (never `@tanstack`) to satisfy the seam test.

## Owed to later (NOT this plan)

- **Variant B — web** (separate plan): build `SdkConfig` from app env (LAN-rewrite app-side), construct the `createStoreSdk` singleton, add `WalletSdkProvider` + `useStore`/`useStoreSuspense`/`useStoreSelect`, DELETE the 13 cache classes + change-handlers + leader/TaskProcessor, replace read-hook bodies with store reads, keep transactions/feature-flags/rates on the app QueryClient, wire `<Wallet>` → `background.start/stop` + activity + the transaction-lifecycle event bridge + `resync`. Re-add the 2 base-domain methods B needs (`user.setDefaultCurrency`, `cashu.send.getSwap`). **Owes browser/live-app verification.**
- Push of `sdkx/base`/variant branches remains gated on the Breez smoke + live realtime + `/lnurl-test` + user nod.
