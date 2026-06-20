# Variant B (store-based) — Web Cut-over Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut `apps/web-wallet` over from its in-app wallet stack (Supabase realtime broadcast channel + leader-election/TaskProcessor + the 13 TanStack cache classes + the duplicated repositories/services) onto the `@agicash/wallet-sdk` Variant-B store engine — the app **deletes** its cache classes and reads hot state from the SDK's `Store<T>` views via `useStore`/`useStoreSuspense`/`useStoreSelect`, keeps transactions/feature-flags/rates on its own QueryClient, and routes every mutation through `sdk.*`.

**Architecture:** A module-singleton `~/lib/sdk.ts` constructs one `createStoreSdk(config)` (config from app env, LAN-rewrite app-side). `<Wallet>` (the auth-gated shell) becomes the `sdk.background.start()/stop()` boundary, forwards `online`/`offline`/`visibilitychange` → `setOnlineStatus`/`setActiveStatus` + focus/online → `sdk.resync()`, wires `auth:session-expired`, and mounts a small **transaction-lifecycle bridge** that invalidates the kept transaction queries on the SDK's core lifecycle events (B has no row events). Each hot read becomes a `useStore`-family call over `sdk.{user.current, accounts.all, contacts.all, cashu.send.unresolved, …}`; the 13 cache classes + 10 change-handlers + the broadcast channel + leader/TaskProcessor are deleted. The 4 "active per-id tracker" reads (`useTrack*`) stay app-side `useQuery(sdk.*.get(id))` refreshed by core lifecycle events (terminal quotes are evicted from the stores). The transactions infinite list / single-tx / unack-count stay app-side `useQuery` with `queryFn → sdk.transactions.*`. Two SDK-side prelude changes (Part 0) re-add the base-domain methods B needs. The documented Supabase residual (`database.client.ts`/`supabase-session.ts`) is carried, identical to Variant A, to keep the B-vs-A web-integration diff comparable.

**Tech Stack:** React Router v7, TanStack Query v5, Zustand, `@agicash/wallet-sdk` (+ the `/store` entry), `@agicash/opensecret`, Supabase, `bun:test`. App code under `apps/web-wallet/app/` (the `~/*` alias). SDK code under `packages/wallet-sdk/src/`.

## Global Constraints

- **Gate = `bun run typecheck` + `bun run test`. NEVER `bun run fix:all`** ⛔ (biome `check --write` reorders imports repo-wide and pollutes the working tree — applies to implementers AND reviewers). Discard any such pollution with `git checkout -- .` (committed work is safe). Every subagent prompt MUST carry this prohibition verbatim.
- **Branch: `sdkx/store`** (worktree `.claude/worktrees/sdkx-store`), off the frozen base `a210e9db`, B-engine tip (the tip after the Variant-B engine plan). Run all commands from that worktree. Do NOT touch `sdkx/base`, `sdkx/stateless`, the original repo root, or the independent `sdk-nocache/full-migration` track.
- **Do NOT push** `sdkx/base` or `sdkx/store` — push is gated on the Breez connect smoke (`VITE_BREEZ_API_KEY` + regtest) + live realtime validation + `/lnurl-test` + the user's nod.
- **Testing posture (matches the whole extraction):** Part 0 (SDK, headless) tasks are full TDD (failing test → impl → green). Part 1–3 (app integration) tasks are **gate-green only** — typecheck + the existing test suite stay green; NO new app unit tests for mechanical rewiring (the integration cannot be meaningfully unit-tested headless). Each such task ends with a `git grep` orphan-import sweep. Browser/live verification is **owed** and collected in Task 15's checklist (run via Chrome DevTools MCP + the `verify`/`run` skills against a live stack — NOT in-loop here).
- **Model:** OPUS implementer + reviewer on Tasks 1, 3, 5, 6, 10, 11, 15 (new logic / lynchpin / hardest); sonnet on Tasks 2, 4, 7, 8, 9, 12, 13, 14 (mechanical). Two-stage review per task (spec review + quality review); OPUS quality-reviewer on the OPUS tasks + final holistic.
- **Commit prefix:** `feat(wallet-web): B-web …` (app), `feat(wallet-sdk): B-web …` (SDK prelude). Base for the whole-branch diff = the B-engine tip.
- **The frozen base seam is NOT touched.** Part 0 modifies only `domains/user.ts` and `domains/cashu-send-ops.ts` (variant-local; both cherry-pickable to base later). `sdk.ts`, `engine.ts`, the `EventBus`, the `ChangeFeedChange` union, and the repos stay byte-identical.

**Resolved design forks (AskUserQuestion 2026-06-21, verbatim — do not re-litigate):**
1. **Base strategy** = re-add the base-domain methods B needs in B itself, off the frozen base `a210e9db` (NOT land-on-base + rebase A). B needs only TWO of A's three additions: `user.setDefaultCurrency` (a write) and `cashu.send.getSwap` (a per-id read). **`contacts.list` is NOT needed** — B reads contacts via the `sdk.contacts.all` store, not a Promise list. (Task 1.)
2. **Liveness** = the tx-detail page + the 4 `useTrack*` reads refresh via the CORE lifecycle events both variants emit (`send/receive:completed|failed|expired`), not row events. Coarser intermediate liveness is the intended A-vs-B contrast. (Tasks 5, 9, 10.)

**Adopted defaults (resolved by the planner, not re-asked — noted at point of use):**
- **No `WalletSdkProvider`** — the `getSdk()` module singleton (same pattern A uses) is the access path; the adapter hooks take a `Store<T>` arg. The spec's "WalletSdkProvider" wrapper is unnecessary with a module singleton; documented in Task 3. (If DI/testing later wants a context, it is a trivial add.)
- **Residual carried, identical to A** — `database.client.ts` + `supabase-session.ts` survive for the 4 `getByTransactionId` reads (`transaction-additional-details.tsx`), `useReverseTransaction`, `useAccountOrNull`'s lazy expired-account fetch, and the feature-flags RPC. Carry (don't finish-delete) to keep the B-vs-A web-integration diff comparable. (Task 14.)
- **App realtime stays alive (shrinking) during the transition** — the SDK owns *processing* from Task 5 (single leader; app leader/TaskProcessor deleted), but the app's broadcast channel + entity/active change-handlers keep feeding the OLD caches for un-switched reads until each feature is converted; the central tracker shrinks per feature and is deleted in Task 13. Transient dual realtime *fan-out* (app caches + SDK stores) is harmless (read-only). (Tasks 5–13.)

---

## File Structure

**Part 0 — SDK prelude (`packages/wallet-sdk/src/`):**
- Modify `domains/user.ts` — add standalone `setDefaultCurrency(currency)` (Task 1).
- Modify `domains/cashu-send-ops.ts` — add `getSwap(swapId)` (Task 1).
- Co-located `*.test.ts`.

**Part 1 — App foundation (`apps/web-wallet/app/`):**
- Create `lib/sdk.ts` (createStoreSdk singleton) + `lib/storage-adapter.ts` (Task 2).
- Create `lib/store-hooks.ts` — `useStore`/`useStoreSuspense`/`useStoreSelect` (Task 3).
- Rewire `features/user/auth.ts`, `routes/_auth.oauth.$provider.tsx`, `features/signup/verify-email.ts`, `features/user/user-hooks.tsx` (auth bits) (Task 4).
- Rewire `routes/_protected.tsx`, `features/wallet/wallet.tsx`; create `features/wallet/use-sdk-activity-tracking.ts` + `features/wallet/use-transaction-lifecycle-sync.ts`; delete `features/wallet/task-processing.ts` + `task-processing-lock-repository.ts` (Task 5).

**Part 2 — Per-feature read replacement + mutation rewire + cache deletion (`apps/web-wallet/app/features/`):** accounts (Task 6), user (Task 7), contacts (Task 8), transactions (Task 9), send (Task 10), receive + token claim (Task 11), transfer (Task 12).

**Part 3 — Teardown + holistic:** delete app realtime + central tracker + remaining caches/processors + `root.tsx`/feature-flags (Task 13); residual carry + final glue (Task 14); holistic review + biome pass + verification checklist (Task 15).

---

## Part 0 — SDK prelude (headless, TDD)

### Task 1: Re-add the 2 base-domain methods B needs

`user.setDefaultCurrency(currency)` (the default-currency switcher write) and `cashu.send.getSwap(swapId)` (the share-route per-id read). Both are on `sdkx/stateless` only (NOT base `a210e9db`); reproduce the EXACT code A used.

**Files:**
- Modify: `packages/wallet-sdk/src/domains/user.ts`
- Modify: `packages/wallet-sdk/src/domains/cashu-send-ops.ts`
- Test: `packages/wallet-sdk/src/domains/user.test.ts` (extend/create), `packages/wallet-sdk/src/domains/cashu-send-ops.test.ts` (extend/create)

**Interfaces:**
- Consumes: `WriteUserRepository.update(id, patch)`, `requireUserId()` (user domain); `swapRepository.get(id)` (cashu-send-ops); `Currency` from `@agicash/money`; `CashuSendSwap` from `../domains/cashu-send-swap`.
- Produces: `UserDomain.setDefaultCurrency(currency: Currency): Promise<User>`; `CashuSendOps.getSwap(swapId: string): Promise<CashuSendSwap | null>`.

- [ ] **Step 1: Write the failing tests** — assert `await user.setDefaultCurrency('USD')` calls `writeUserRepo.update(id, { defaultCurrency: 'USD' })` and returns the updated user (+ throws `No authenticated user` when signed out); assert `await cashuSend.getSwap('s1')` returns `swapRepository.get('s1')` pass-through (inject fakes; mirror A's `ContactsDomain.list` test style).

- [ ] **Step 2: Run → FAIL** (`setDefaultCurrency`/`getSwap` undefined). Run: `bun --cwd packages/wallet-sdk test domains/user.test.ts domains/cashu-send-ops.test.ts`.

- [ ] **Step 3: Implement.** In `domains/user.ts` (add the `Currency` import from `@agicash/money` if absent), reproduce A's `user.ts:53-56`:
```ts
async setDefaultCurrency(currency: Currency): Promise<User> {
  const id = await this.requireUserId();
  return this.deps.writeUserRepo.update(id, { defaultCurrency: currency });
}
```
In `domains/cashu-send-ops.ts`, reproduce A's `cashu-send-ops.ts:167-171`:
```ts
/** Reads a token send-swap by its id (distinct from {@link get}, which reads
 * the lightning send-quote). Used by the share route to render the token. */
getSwap(swapId: string): Promise<CashuSendSwap | null> {
  return this.deps.swapRepository.get(swapId);
}
```
> Verify during exec: the exact dep field names (`this.deps.writeUserRepo` / `this.deps.swapRepository`) + `requireUserId` against the base `domains/user.ts` / `domains/cashu-send-ops.ts`. Confirm `WriteUserRepository.update` signature (`update(id, patch): Promise<User>`).

- [ ] **Step 4: Run tests + full SDK suite + typecheck** → PASS, exit 0.

- [ ] **Step 5: Commit.** `git commit -m "feat(wallet-sdk): B-web user.setDefaultCurrency + cashu.send.getSwap"`.

---

## Part 1 — App foundation (gate-green)

### Task 2: SDK init module — `~/lib/sdk.ts` + storage adapters

A module-singleton SDK over `createStoreSdk`, config from app env, LAN-rewrite inlined app-side, lazy on `domain`. **Copy Variant A's `lib/sdk.ts` + `lib/storage-adapter.ts` verbatim, swapping only the SDK entry.** Reference: `sdkx-stateless/apps/web-wallet/app/lib/sdk.ts` + `lib/storage-adapter.ts`.

**Files:**
- Create: `apps/web-wallet/app/lib/sdk.ts`
- Create: `apps/web-wallet/app/lib/storage-adapter.ts`
- Modify: `apps/web-wallet/app/routes/_protected.tsx` (kick off `initSdk(location.host)` in the client middleware, after the auth gate — do NOT remove the bootstrap yet)

**Interfaces:**
- Consumes: `createStoreSdk` + `StoreSdk` from `@agicash/wallet-sdk/store`, `SdkConfig`/`StorageAdapter` from `@agicash/wallet-sdk`, `import.meta.env.VITE_*`, `location.host`.
- Produces: `getSdk(): StoreSdk`, `initSdk(domain: string): Promise<StoreSdk>` (idempotent), `disposeSdk(): Promise<void>`.

- [ ] **Step 1: Copy A's `lib/storage-adapter.ts` verbatim** (byte-identical; it imports `StorageAdapter` from the base barrel `@agicash/wallet-sdk`, wraps `localStorage`/`sessionStorage` lazily for SSR safety). Read `sdkx-stateless/apps/web-wallet/app/lib/storage-adapter.ts` and reproduce.

- [ ] **Step 2: Copy A's `lib/sdk.ts`, applying the THREE swaps:** `import { type StatelessSdk, createStatelessSdk } from '@agicash/wallet-sdk/stateless'` → `import { type StoreSdk, createStoreSdk } from '@agicash/wallet-sdk/store'`; every `StatelessSdk` → `StoreSdk`; `createStatelessSdk(` → `createStoreSdk(`. Keep EVERYTHING else identical — the config object shape, the env guards (`VITE_OPEN_SECRET_API_URL`, `VITE_OPEN_SECRET_CLIENT_ID`, `VITE_SUPABASE_ANON_KEY`, `VITE_BREEZ_API_KEY`, `VITE_SUPABASE_URL`), the inlined `getSupabaseUrl()` LAN-rewrite (called ONLY inside `initSdk`, so `window` never runs during SSR — preserve this), the `getSdk()/initSdk(domain)/disposeSdk()` singleton bodies (idempotent `if (!sdkPromise)`, `getSdk` throws pre-init, `disposeSdk` nulls both then awaits). Read `sdkx-stateless/apps/web-wallet/app/lib/sdk.ts` and reproduce with the swaps.

- [ ] **Step 3: Kick off `initSdk(location.host)`** in `_protected.tsx`'s client middleware (fire-and-forget `.catch`, after the auth gate, where A does it) — do NOT remove the existing bootstrap (strangler). Read `sdkx-stateless/apps/web-wallet/app/routes/_protected.tsx` for the exact placement (A's middleware `Promise.all([initSdk(location.host), ensureBreezWasm()])` at the post-gate point — but in B-Task-2 just add the `initSdk` kickoff; the full middleware rewrite is Task 4/5).

- [ ] **Step 4: Gate.** `bun run typecheck` (exit 0 — proves `@agicash/wallet-sdk/store` resolves + `StoreSdk` is exported) + `bun run test` (0 fail). New module compiles; no behavior change yet.

- [ ] **Step 5: Orphan sweep + commit.** `git commit -m "feat(wallet-web): B-web SDK init module + storage adapters"`.

> ⚠️ Verification owed (Task 15): `initSdk` non-blocking hydration; `domain` = canonical origin on Vercel previews (the same `location.host` caveat A flagged); `getSupabaseUrl` LAN-rewrite matches the old behavior with no double-rewrite.

---

### Task 3: Store adapter hooks — `~/lib/store-hooks.ts` [OPUS]

The three adapter hooks the app reads stores through: `useStore` (snapshot, may be undefined), `useStoreSuspense` (throws `store.toPromise()` until loaded → suspends on the root `<Suspense>`), `useStoreSelect` (memoized selection). Backed by `useSyncExternalStore`.

**Files:**
- Create: `apps/web-wallet/app/lib/store-hooks.ts`
- Test: none (React-hook integration; covered by the gate + Task 15 browser verification). Keep it tiny + obviously correct.

**Interfaces:**
- Consumes: `Store` from `@agicash/wallet-sdk/store` (the engine-neutral `{ get, subscribe, toPromise }` surface); `useSyncExternalStore` from `react`; `useSyncExternalStoreWithSelector` from `use-sync-external-store/with-selector` (verify availability; fallback below).
- Produces:
  - `useStore<T>(store: Store<T>): T | undefined`
  - `useStoreSuspense<T>(store: Store<T>): T`
  - `useStoreSelect<T, S>(store: Store<T>, selector: (value: T) => S, isEqual?: (a: S, b: S) => boolean): S` (suspense form — selector receives the loaded value)

- [ ] **Step 1: Implement `store-hooks.ts`:**
```ts
import { useSyncExternalStore } from 'react';
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/with-selector';
import type { Store } from '@agicash/wallet-sdk/store';

/** Snapshot of a store; `undefined` until first load. */
export function useStore<T>(store: Store<T>): T | undefined {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** Suspense read: throws `store.toPromise()` until the first load resolves, so the
 * first wallet render suspends on the root <Suspense> instead of seeing an empty
 * store (the Variant-B answer to A's ensureLoaded bug — load-before-serve). */
export function useStoreSuspense<T>(store: Store<T>): T {
  const value = useSyncExternalStore(store.subscribe, store.get, store.get);
  if (value === undefined) throw store.toPromise();
  return value;
}

/** Suspense read + memoized selection — re-renders only when the selected slice changes. */
export function useStoreSelect<T, S>(
  store: Store<T>,
  selector: (value: T) => S,
  isEqual?: (a: S, b: S) => boolean,
): S {
  // Suspend until loaded, then select with memoization.
  const snapshot = useSyncExternalStore(store.subscribe, store.get, store.get);
  if (snapshot === undefined) throw store.toPromise();
  return useSyncExternalStoreWithSelector(
    store.subscribe,
    store.get as () => T,
    store.get as () => T,
    selector as (s: T | undefined) => S,
    isEqual,
  );
}
```

> Verify during exec: (1) `use-sync-external-store/with-selector` resolves (it ships with React 18/19 and is a transitive dep of `@tanstack/react-query`; `bun pm ls | grep use-sync-external-store` or check `node_modules`). If absent, add it to `apps/web-wallet/package.json` (ask first) OR fall back to `useSyncExternalStore` + `useMemo(() => selector(snapshot), [snapshot])` (re-renders on any store change, acceptable for these small stores). (2) Calling a hook after a conditional `throw` is fine — the throw unwinds before the second hook, and on the resolved re-render the value is defined so both hooks always run. If the linter's `useHookAtTopLevel` flags the post-throw hook, restructure `useStoreSelect` to compute selection via `useMemo` over `useStore`'s value instead. (3) `store.get` is referentially stable + structurally shared (engine Task 3) so `useSyncExternalStore` won't infinite-loop.

- [ ] **Step 2: Gate.** `bun run typecheck` (exit 0) + `bun run test` (0 fail). No consumers yet.

- [ ] **Step 3: Commit.** `git commit -m "feat(wallet-web): B-web store adapter hooks (useStore/useStoreSuspense/useStoreSelect)"`.

> ⚠️ Verification owed (Task 15): first wallet render suspends correctly (no empty-store flash); `useStoreSelect` memoization (no excess re-renders); no hydration mismatch.

---

### Task 4: Auth cut-over → `sdk.auth` + hybrid auth-state

**Copy Variant A's auth cut-over verbatim** (it calls `sdk.auth.*` only — SDK-instance-agnostic). Rewire `useAuthActions` onto `sdk.auth`, keep the cheap `isLoggedIn()`/`authQueryOptions` gate (stays on `@agicash/opensecret`), delete `useHandleSessionExpiry` (the host effect moves to `<Wallet>` in Task 5). Reference: `sdkx-stateless/apps/web-wallet/app/features/user/auth.ts` + the A-web plan Task 4.

**Files:**
- Modify: `features/user/auth.ts`, `routes/_auth.oauth.$provider.tsx`, `features/signup/verify-email.ts`, `features/user/user-hooks.tsx` (auth bits only), `routes/_protected.tsx` (delete `ensureUserData` key-derivation block — SDK's `auth.ensureUser` owns it).

- [ ] **Step 1: Reproduce A's `auth.ts`** — `getAuthSdk = () => initSdk(location.host)`; every action awaits it then calls one `sdk.auth.*` method (`signUp`/`signIn`/`signOut`[+`disposeSdk()` after]/`beginGoogle`/`signInGuest`/`requestPasswordReset`/`confirmPasswordReset`[positional→object]/`verifyEmail`/`upgradeGuest`). Delete `useHandleSessionExpiry` + its private helpers. Keep `authQueryOptions`/`isLoggedIn` (the auth canary, stays on OpenSecret) + `sessionHintCookie` + Sentry-user verbatim. Read A's file and reproduce (no store/cache coupling — identical to A).
- [ ] **Step 2: Reproduce A's OAuth callback + verify-email + request-new-code rewires** (one `sdk.auth.*` call each, keep host redirect/toast).
- [ ] **Step 3: Reproduce A's `useUser` identity re-source** — in B the user identity comes from the `sdk.user.current` store (Task 7 rewrites `useUser`), but the auth-state hybrid (`isLoggedIn` gate) is identical to A. For THIS task, keep `useUser` as-is (Task 7 converts it); only rewire the auth actions + delete `useHandleSessionExpiry`.
- [ ] **Step 4: Remove `_protected` `ensureUserData`** (the key-derivation + `WriteUserRepository.upsert` block) — SDK upserts user + default accounts at sign-in. Keep the route gate. (Reproduce A's deletion.)
- [ ] **Step 5: Gate + orphan sweep** (`git grep "useHandleSessionExpiry" apps/web-wallet/app` empty; auth OS imports only in `auth.ts` gate) + **commit** `feat(wallet-web): B-web auth → sdk.auth + hybrid auth-state`.

> ⚠️ Verification owed (Task 15): full-user session expiry toast+redirect; guest-silent expiry; Google OAuth; `confirmPasswordReset`; StorageAdapter/enclave survives reload; fresh + returning sign-in both populate user+accounts.

---

### Task 5: `<Wallet>` background lifecycle + activity + transaction-lifecycle bridge + delete leader [OPUS]

`<Wallet>` becomes the `sdk.background.start()/stop()` boundary (single SDK leader; app leader/TaskProcessor deleted), forwards activity, wires `auth:session-expired` + `resync`, and mounts the **transaction-lifecycle bridge** (B's only app-side event subscription, replacing A's row-event wiring for the kept transaction queries). The app's broadcast channel + entity/active change-handlers STAY (feeding the OLD caches for un-switched reads) until Task 13.

**Files:**
- Create: `features/wallet/use-sdk-activity-tracking.ts` (copy A's verbatim, type alias → `StoreSdk['background']`).
- Create: `features/wallet/use-transaction-lifecycle-sync.ts` (B-NEW).
- Modify: `features/wallet/wallet.tsx` (add `background.start/stop`, `useSDKActivityTracking`, `sdk.on('auth:session-expired')`, focus/online → `resync`, `useTransactionLifecycleSync`; remove `useHandleSessionExpiry`, `useTakeTaskProcessingLead`, `{isLead && <TaskProcessor/>}`, `useSupabaseRealtimeActivityTracking`; KEEP `useTrackWalletChanges` [shrinks over Tasks 6–12, deleted in Task 13], `Sentry.setUser`, `useSyncThemeWithDefaultCurrency`, `useTrackAndUpdateSparkAccountBalances`).
- Modify: `routes/_protected.tsx` (place `disposeSdk()` on the unmount/sign-out boundary, as A does — pick one place).
- Delete: `features/wallet/task-processing.ts`, `features/wallet/task-processing-lock-repository.ts`.

**Interfaces:** Consumes `getSdk().background.{start,stop,setOnlineStatus,setActiveStatus}`, `sdk.resync()`, `sdk.on('auth:session-expired'|'send:completed'|'send:failed'|'receive:completed'|'receive:failed'|'receive:expired')`, `disposeSdk()`, `getQueryClient()`.

- [ ] **Step 1: Copy A's `use-sdk-activity-tracking.ts` verbatim** (online/offline/visibility → `setOnlineStatus`/`setActiveStatus`, initial seed), swapping the `Background` type alias to `NonNullable<StoreSdk['background']>`. Read `sdkx-stateless/.../use-sdk-activity-tracking.ts`.

- [ ] **Step 2: Write `use-transaction-lifecycle-sync.ts`** — the bridge that keeps the KEPT transaction queries (Task 9) live off core lifecycle events (B has no row events):
```ts
import { useEffect } from 'react';
import { getSdk } from '~/lib/sdk';
import { useQueryClient } from '@tanstack/react-query';
import { TransactionsCache } from '~/features/transactions/transaction-hooks'; // see Task 9 note

/** B has no transaction row events. The SDK's core lifecycle events fire once on a
 * terminal transition (on every instance) and carry transactionId, so we invalidate
 * the kept transaction queries on them. This gives the detail page + list + unack
 * count terminal-transition liveness without a tx store or row events. */
export function useTransactionLifecycleSync(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const sdk = getSdk();
    const invalidate = (transactionId?: string) => {
      if (transactionId) queryClient.invalidateQueries({ queryKey: [TransactionsCache.Key, transactionId] });
      queryClient.invalidateQueries({ queryKey: [TransactionsCache.AllTransactionsKey] });
      queryClient.invalidateQueries({ queryKey: [TransactionsCache.UnacknowledgedCountKey] });
    };
    const offs = [
      sdk.on('send:completed', ({ transactionId }) => invalidate(transactionId)),
      sdk.on('send:failed', ({ transactionId }) => invalidate(transactionId)),
      sdk.on('receive:completed', ({ transactionId }) => invalidate(transactionId)),
      sdk.on('receive:failed', () => invalidate()),
      sdk.on('receive:expired', () => invalidate()),
    ];
    return () => { for (const off of offs) off(); };
  }, [queryClient]);
}
```
> Note: `TransactionsCache` is currently NOT exported (it's the cache class). In B it is mostly deleted (Task 9), but its three static `Key`/`AllTransactionsKey`/`UnacknowledgedCountKey` constants are still the query keys for the kept transaction queries. Task 9 keeps those key constants (export a small `TransactionKeys` object or keep `TransactionsCache` as a key-only holder). For Task 5, import whatever Task 9 exposes; if Task 9 isn't done yet, inline the literal keys (`['transactions', id]`, `['all-transactions']`, `['unacknowledged-transactions-count']`) and reconcile in Task 9. Verify the key shapes against `transaction-hooks.ts:27-82`.

- [ ] **Step 3: Rewire `<Wallet>`** — `useEffect` calling `sdk.background.start()` on mount / `stop()` on unmount; `useSDKActivityTracking(getSdk().background)`; `useEffect` subscribing `sdk.on('auth:session-expired', () => { toast('Session expired…'); signOut(); })`; focus/online listeners → `sdk.resync()`; `useTransactionLifecycleSync()`. Delete the leader/TaskProcessor lines + `useHandleSessionExpiry` + `useSupabaseRealtimeActivityTracking`. KEEP `useTrackWalletChanges()` (shrinks later), `Sentry.setUser`, `useSyncThemeWithDefaultCurrency`, `useTrackAndUpdateSparkAccountBalances`. Reproduce A's `wallet.tsx` structure + add `useTransactionLifecycleSync`.

- [ ] **Step 4: Delete `task-processing.ts` + `task-processing-lock-repository.ts`.** The six `useProcess*Tasks` become unused exports (compile fine; deleted with their feature in Tasks 10/11, OR in Task 13). `disposeSdk()` on the sign-out/unmount boundary (one place).

- [ ] **Step 5: Gate + orphan sweep** (`git grep "task-processing\|TaskProcessor\|useTakeTaskProcessingLead\|useHandleSessionExpiry\|useSupabaseRealtimeActivityTracking" apps/web-wallet/app` → only dead `useProcess*Tasks` exports + the still-present `useTrackWalletChanges` remain) + **commit** `feat(wallet-web): B-web <Wallet> background + activity + tx-lifecycle bridge (delete leader)`.

> ⚠️ Verification owed (Task 15): 2-tab leader + ≤10s failover; online/offline + visibility; session-expiry once; sign-out disposes cleanly; no double-start under StrictMode; tx detail/list/unack update on terminal transitions.

---

## Part 2 — Per-feature read replacement + mutation rewire + cache deletion (gate-green)

> **Per-feature pattern (every task in Part 2):** (a) rewrite the READ hooks to `useStore`-family over `sdk.<domain>.<store>` (or `useQuery(sdk.*.get(id))` + lifecycle refetch for active per-id trackers); (b) repoint the MUTATION hooks to `sdk.*` (drop the onSuccess cache writes — the fanout owns store freshness); (c) DELETE the feature's cache class(es) + its `use*ChangeHandlers` and REMOVE that handler from `use-track-wallet-changes.ts`'s handler list (shrinking it); (d) gate + `git grep` orphan sweep. The send/receive MUTATION functions are copied from Variant A verbatim (reads-independent) — reference `sdkx-stateless/apps/web-wallet/app/features/{send,receive,transfer}`.

### Task 6: Accounts read surface → `sdk.accounts.all` store [OPUS]

**Files:** Modify `features/accounts/account-hooks.ts`; modify `features/accounts/account-service.ts` (keep `getExtendedAccounts`+`isDefaultAccount`, delete `addCashuAccount`+`useAccountService`); `features/accounts/account-repository.ts` stays (pinned by residual repos — Task 14).

- [ ] **Step 1: Convert reads to store selections.** `useAccounts(select?)` → reads BOTH `sdk.accounts.all` (store) and `sdk.user.current` (for `getExtendedAccounts(user, data)`): `const accounts = useStoreSuspense(getSdk().accounts.all); const user = useStoreSuspense(getSdk().user.current); return useMemo(() => select ? select(extended) : extended, …)` where `extended = AccountService.getExtendedAccounts(user, accounts)` then the existing filter/sort. (Keep the overloads + filter/sort/`select` logic verbatim; only the data source changes from `useSuspenseQuery(accountsQueryOptions)` to the stores.) `useAccount(id)`/`useAccountOrDefault`/`useDefaultAccount`/`useBalance`/`useGetAccount`/`useGetCashuAccount`/`useGetSparkAccount`/`useGetCashuAccountByMintUrlAndCurrency` → derive off `useStoreSelect(getSdk().accounts.all, …)` or the store snapshot (keep the previous-default `useRef` fallback in `useDefaultAccount` as local UI state). Delete `accountsQueryOptions` + `useSelectItemsWithOnlineAccount` (the online filter now lives in the SDK work-sets; grep first — if a non-deleted consumer remains, keep a thin store-backed version).
- [ ] **Step 2: `useAccountOrNull(id)`** — the lazy expired-account fetch. Keep as a small app-side `useQuery(['fetch-account-by-id', id], () => accountRepository.get(id))` fallback when the store snapshot lacks the id (it reads the residual `account-repository`; see Task 14). Reproduce the base behavior (returns null, gcTime 0) but source the primary value from `sdk.accounts.all.get()`.
- [ ] **Step 3: Mutations.** `useAddCashuAccount.mutationFn` → `getSdk().accounts.add(input)` (`AddCashuAccountInput` from `@agicash/wallet-sdk`); DELETE the `onSuccess accountCache.upsert` (the fanout writes the store). Keep the Spark balance poll (`useTrackAndUpdateSparkAccountBalances`) app-side BUT its `accountsCache.updateSparkAccountBalance` write must move — in B there is no accounts cache; the live Spark balance has no SDK row event. **FLAG:** either (i) keep a tiny app-side `useQuery`/local-state for live Spark balance overlaid on the store accounts, or (ii) defer live-balance to the store's `account:updated` fanout (requires the SDK to emit balance changes — out of scope). Reproduce A's approach: A kept `updateSparkAccountBalance` writing the accounts CACHE; B has no cache. **Resolve in this task:** keep the Spark balance as app-side local state (a `useSparkBalances()` map keyed by accountId, updated by the Breez poll) and have `useBalance`/account displays overlay it onto the store account's `balance` field. Document the overlay; verify in Task 15.
- [ ] **Step 4: DELETE `AccountsCache` + `useWireAccountEvents`/`useAccountChangeHandlers`** (whichever the base has — base has `useAccountChangeHandlers`); remove it from `use-track-wallet-changes.ts`. Delete `account-service.ts` `addCashuAccount`+`useAccountService`; keep `getExtendedAccounts`+`isDefaultAccount`.
- [ ] **Step 5: Gate + sweep** (`git grep "AccountsCache\|useAccountsCache\|accountsQueryOptions\|useAccountChangeHandlers" apps/web-wallet/app` empty) + **commit** `feat(wallet-web): B-web accounts → sdk.accounts.all store`.

> ⚠️ Verification owed: accounts render warm wallet/proofs from the store (no empty-flash); live Spark balance overlay updates; default-account selection correct; `useAccountOrNull` expired fallback.

### Task 7: User read surface → `sdk.user.current` store [OPUS]

**Files:** Modify `features/user/user-hooks.tsx`; `routes/_protected.tsx` (the user seed line).

- [ ] **Step 1:** `useUser(select?)` → `useStoreSelect(getSdk().user.current, select ?? (u => u), …)` with a non-null assertion/guard (the store is `User | null`; under `<Wallet>` the user is always present — throw if null, matching the base `useUser` which throws without `authState.user`). The pervasive selector form (`useUser(u=>u.id)`, etc.) maps directly to `useStoreSelect`. Module readers `getUserFromCache()`/`getUserFromCacheOrThrow()` (consumed by `_protected.tsx`) → `getSdk().user.current.get()` (+ throw variant). Delete `userQueryOptions` + `UserCache` + `useUserChangeHandlers`/`useWireUserEvents`; remove from `use-track-wallet-changes.ts`.
- [ ] **Step 2:** User mutations → `sdk.user.*`: `useUpdateUser`/`useUpdateUsername` → `sdk.user.updateUsername`; `useSetDefaultAccount` → `sdk.user.setDefaultAccount({account, setDefaultCurrency?})`; `useSetDefaultCurrency` → `sdk.user.setDefaultCurrency(currency)` (the Task-1 method); `useAcceptTerms` → `sdk.user.acceptTerms({walletTerms?, giftCardTerms?})`. DROP the `onSuccess setQueryData([UserCache.Key], data)` pokes (the fanout writes `sdk.user.current`). Keep `useUserRef` + the auth hooks (`useUpgradeGuestToFullAccount`, etc.) untouched.
- [ ] **Step 3:** `routes/_protected.tsx` — the user seed (A's `setQueryData([UserCache.Key], user)`): in B the user read is the store, which self-seeds via `useStoreSuspense → toPromise`. Remove the cache seed line; the store + Suspense cover first paint. (Verify the first protected render suspends correctly rather than throwing on a null store — Task 15.)
- [ ] **Step 4: Gate + sweep** (`git grep "UserCache\|useUserCache\|userQueryOptions\|useUserChangeHandlers" apps/web-wallet/app` empty) + **commit** `feat(wallet-web): B-web user → sdk.user.current store`.

### Task 8: Contacts read surface → `sdk.contacts.all` store

**Files:** Modify `features/contacts/contact-hooks.ts`; `contact-repository.ts` deletes if grep-empty.

- [ ] **Step 1:** `useContacts(select?)` → `useStoreSelect(getSdk().contacts.all, select ?? (c => c))`; `useContact(contactId)` → derive `useStoreSelect(getSdk().contacts.all, cs => cs.find(c => c.id === contactId))`. Delete `ContactsCache` + `useContactChangeHandlers`/`useWireContactEvents`; remove from `use-track-wallet-changes.ts`.
- [ ] **Step 2:** Mutations → `sdk.contacts.*`: `useCreateContact` → `sdk.contacts.add({username})`; `useDeleteContact` → `sdk.contacts.remove(contactId)`; `useFindContactCandidates` stays app-side `useQuery` (queryFn → `sdk.contacts.search(query)` if the SDK exposes it, else the repo). DROP onSuccess cache writes.
- [ ] **Step 3:** Delete `contact-repository.ts` if `git grep "contact-repository\|useContactRepository" apps/web-wallet/app` is empty (it may be pinned by the change-feed/residual — verify; if pinned, keep).
- [ ] **Step 4: Gate + sweep + commit** `feat(wallet-web): B-web contacts → sdk.contacts.all store`.

### Task 9: Transactions → app QueryClient (queryFn → `sdk.transactions.*`) + key holder

**Files:** Modify `features/transactions/transaction-hooks.ts`; `transaction-repository.ts` stays (pinned by residual — Task 14).

- [ ] **Step 1:** Keep the transaction queries on the app QueryClient (NO store — fanout no-ops the transaction kind). `useTransactions(accountId?)` `queryFn` → `getSdk().transactions.list({cursor: pageParam ?? undefined, pageSize: PAGE_SIZE, accountId})` (drop `userId`; switch `Cursor` import to `@agicash/wallet-sdk`); keep the VERBATIM SWR config (no `staleTime`, `refetchOnWindowFocus/Reconnect:'always'`, `retry:1`); DROP the per-page `transactionsCache.upsert` side-effect (no tx store/cache). `useTransaction(id)` `queryFn` → `sdk.transactions.get(id)` (keep `NotFoundError` guard + `staleTime:Infinity` + refetch flags). `useHasTransactionsPendingAck` `queryFn` → `sdk.transactions.countPendingAck()`. `useAcknowledgeTransaction` `mutationFn` → `sdk.transactions.acknowledge(transaction.id)` (keep the optimistic `acknowledgeTransactionInHistoryCache` flip on the kept infinite list).
- [ ] **Step 2:** Reduce `TransactionsCache` to a **key-only holder** (keep the three static `Key`/`AllTransactionsKey`/`UnacknowledgedCountKey` constants — used by the kept queries AND by `useTransactionLifecycleSync` from Task 5) — delete the `upsert`/`invalidate*` instance methods + `useTransactionsCache` (the cache-as-store) + `useTransactionChangeHandlers`/`useWireTransactionEvents`; remove from `use-track-wallet-changes.ts`. Export the key holder so Task 5's bridge imports it (reconcile the Task-5 inline-keys note). `useReverseTransaction` stays (residual — Task 14). `isTransactionReversable` stays.
- [ ] **Step 3:** Confirm `useTransactionLifecycleSync` (Task 5) invalidates these exact keys on lifecycle events (the B liveness mechanism for tx detail/list/unack).
- [ ] **Step 4: Gate + sweep** (`git grep "useTransactionsCache\|useTransactionChangeHandlers" apps/web-wallet/app` empty; `TransactionsCache` referenced only as a key holder) + **commit** `feat(wallet-web): B-web transactions → sdk.transactions + lifecycle invalidation`.

### Task 10: Send flows (cashu + spark) [OPUS]

**Files:** Modify `features/send/{send-provider.tsx, cashu-send-quote-hooks.ts, cashu-send-swap-hooks.ts, spark-send-quote-hooks.ts, send-confirmation.tsx}`, `routes/_protected.send.share.$swapId.tsx`. Delete the send caches + `useWire*`/`useProcess*Tasks` + `proof-state-subscription-manager.ts` (the SDK owns it). The send SERVICE/REPO files stay (pinned by residual/transfer — Task 14, mirror A's deferral).

- [ ] **Step 1: Mutations (copy A verbatim).** `useCreateCashuLightningSendQuote` → `sdk.cashu.send.createLightningQuote(...)`; `useInitiateCashuSendQuote` → CREATE-ONLY `sdk.cashu.send.execute({account, quote, destinationDetails})`; `useCreateSparkLightningSendQuote` → `sdk.spark.send.createLightningQuote(...)`; `useInitiateSparkSendQuote` → `sdk.spark.send.execute({account, quote})`. `send-provider.tsx` store deps `getCashu/SparkLightningQuote` → the `createLightningQuote` estimates. Re-source `CashuLightningQuote`/`SparkLightningQuote`/`DestinationDetails` from `@agicash/wallet-sdk`. Reference `sdkx-stateless/.../features/send/*`.
- [ ] **Step 2: Token send + active tracker.** `useCreateCashuSendSwap` → `sdk.cashu.send.createTokenSend({account, amount})` (returns `{token, swap: PENDING}` synchronously); DROP the onSuccess `cashuSendSwapCache.add`. `useCashuSendSwap(id)` (suspense) + `useTrackCashuSendSwap({id, onPending, onCompleted, onFailed})` → app-side `useQuery(queryFn → getSdk().cashu.send.getSwap(id))` (the Task-1 method) + a `sdk.on('send:completed'|'send:failed')` subscription filtered by the swap's quote/tx id that refetches + fires the callbacks (the B liveness mechanism — terminal swaps are evicted from the unresolved store). The share route `_protected.send.share.$swapId.tsx` reads `getSdk().cashu.send.getSwap(swapId)` + renders the token immediately (PENDING sync). `reverse` → `sdk.cashu.send.reverse` (via `useReverseTransaction`, kept).
- [ ] **Step 3: DELETE** `UnresolvedCashuSendQuotesCache`, `CashuSendSwapCache`, `UnresolvedCashuSendSwapsCache`, `UnresolvedSparkSendQuotesCache` + their `use*ChangeHandlers` + the dead `useProcess{Cashu,Spark}Send*Tasks`/`useOnProofStateChange`/`useOnSparkSendStateChange`/`usePendingMeltQuotes`/`useUnresolved*` selectors + `proof-state-subscription-manager.ts`; remove the send change-handlers from `use-track-wallet-changes.ts`.
- [ ] **Step 4:** `send-confirmation.tsx` navigates to `/transactions/${transactionId}` on `execute()` success (preserved contract); `CreateCashuTokenConfirmation` adapts to `createTokenSend`'s `{token, swap}`.
- [ ] **Step 5: Gate + sweep** (`git grep "UnresolvedCashuSendQuotesCache\|CashuSendSwapCache\|UnresolvedCashuSendSwapsCache\|UnresolvedSparkSendQuotesCache\|useProcessCashuSendQuoteTasks\|useProcessCashuSendSwapTasks\|useProcessSparkSendQuoteTasks\|proof-state-subscription" apps/web-wallet/app` empty) + **commit** `feat(wallet-web): B-web send flows → sdk.{cashu,spark}.send`.

> ⚠️ Verification owed: token-send renders QR immediately; Lightning send advances on the leader; `/transactions/:id` updates on terminal transition (lifecycle bridge); intermediate PENDING liveness is coarser than A (expected).

### Task 11: Receive flows + token claim (cashu + spark) [OPUS]

**Files:** Modify `features/receive/{cashu-receive-quote-hooks.ts, cashu-receive-swap-hooks.ts, spark-receive-quote-hooks.ts, receive-cashu-token.tsx, receive-cashu-token-hooks.ts}`, `routes/_protected.receive.cashu_.token.tsx`. Delete the receive caches + `useWire*`/`useProcess*Tasks` + `lib/cashu/{mint-quote,melt-quote}-subscription*` (SDK owns them). Receive service/repo/core files stay (pinned by residual/transfer — Task 14).

- [ ] **Step 1: Mutations (copy A verbatim).** `useCreateCashuReceiveQuote` → two-step create-only `sdk.cashu.receive.createLightningQuote(...)` then `.execute(...)`; `useCreateSparkReceiveQuote` → same on `sdk.spark.receive.*`. DROP onSuccess cache adds. Reference `sdkx-stateless/.../features/receive/*`.
- [ ] **Step 2: Active trackers.** `useTrackCashuReceiveQuote({quoteId, onPaid, onExpired})` → app-side `useQuery(queryFn → getSdk().cashu.receive.get(quoteId))` + `sdk.on('receive:completed'|'receive:expired')` filtered by `quoteId` → refetch + fire `onPaid`/`onExpired` (B liveness; terminal quotes evicted from the pending store). `useTrackSparkReceiveQuote` → same on `sdk.spark.receive.get` + the spark lifecycle events. (These replace the base's row-event-fed active caches.)
- [ ] **Step 3: Deep-link claim + interactive claim (copy A verbatim).** `_protected.receive.cashu_.token.tsx` `?claimTo` → `sdk.cashu.receive.receiveToken({token, claimTo})` in try/catch (throws `DomainError`; redirect outside try; `purpose==='gift-card'` mapping). Interactive `receive-cashu-token.tsx` → `sdk.cashu.receive.createTokenClaim({token, sourceAccount, destinationAccount})` (add-unknown fold-in inside SDK, NO setDefault). `useCashuTokenWithClaimableProofs` → `sdk.cashu.receive.getClaimableToken(...)`; `useReceiveCashuTokenAccounts`/`useCashuTokenSourceAccountQuery` → `sdk.cashu.receive.getTokenAccounts(...)`. KEEP the signed-out `_public` placeholder helpers (SDK `getTokenAccounts` requires auth). Re-source token-receive types from `@agicash/wallet-sdk`.
- [ ] **Step 4: DELETE** the receive caches (`CashuReceiveQuoteCache`, `PendingCashuReceiveQuotesCache`, `PendingCashuReceiveSwapsCache`, `SparkReceiveQuoteCache`, `PendingSparkReceiveQuotesCache`) + their `use*ChangeHandlers` + dead `useProcess*ReceiveTasks`/`useOn*ReceiveStateChange`/`useOnMintQuoteStateChange`/`usePendingMeltQuotes`/`usePending*` selectors + the 3 `lib/cashu` subscription managers (`mint-quote-subscription-manager`, `melt-quote-subscription-manager`, `melt-quote-subscription`); keep `lib/cashu` `ExtendedCashuWallet`/`getCashuWallet`/`buildMintValidator`/`MintBlocklistSchema`. Remove the receive change-handlers from `use-track-wallet-changes.ts`.
- [ ] **Step 5: Gate + sweep** (`git grep "PendingCashuReceiveQuotesCache\|PendingCashuReceiveSwapsCache\|PendingSparkReceiveQuotesCache\|CashuReceiveQuoteCache\|SparkReceiveQuoteCache\|useProcessCashuReceiveQuoteTasks\|useProcessCashuReceiveSwapTasks\|useProcessSparkReceiveQuoteTasks\|mint-quote-subscription\|melt-quote-subscription" apps/web-wallet/app` empty) + **commit** `feat(wallet-web): B-web receive + token claim → sdk.{cashu,spark}.receive`.

> ⚠️ Verification owed: Lightning receive paid transition reaches `useTrack*` via lifecycle events; deep-link `?claimTo` (gift-card + normal) + DomainError toast; interactive claim same- + cross-account (add-unknown, no default set).

### Task 12: Transfers

**Files:** Modify `features/transfer/transfer-hooks.ts` (copy A verbatim — no caches); `transfer-service.ts` stays if pinned (verify; A deleted it, but A's deletion depended on send/receive services already removed — in B they're residual, so transfer-service may stay until Task 14).

- [ ] **Step 1:** `useGetTransferQuote.mutationFn` → `getSdk().transfers.createQuote({sourceAccount, destinationAccount, amount})`; `useInitiateTransfer.mutationFn` → `sdk.transfers.execute(quote)`. Keep the ConcurrencyError/DomainError retry policy. Re-source `TransferQuote` from `@agicash/wallet-sdk`. Copy A's `transfer-hooks.ts` verbatim.
- [ ] **Step 2:** Delete `transfer-service.ts` if `git grep "transfer-service\|useTransferService" apps/web-wallet/app` is empty (else keep — Task 14).
- [ ] **Step 3: Gate + sweep + commit** `feat(wallet-web): B-web transfers → sdk.transfers`.

---

## Part 3 — Teardown + holistic

### Task 13: Delete the app realtime + central tracker + final cache/processor sweep [sonnet, OPUS-reviewed]

By now every read is on a store/lifecycle-event and every feature's cache + change-handler is deleted, so `use-track-wallet-changes.ts` has an empty handler list. Delete it + the app realtime transport.

**Files:** Delete `features/wallet/use-track-wallet-changes.ts`, `lib/supabase/{supabase-realtime-hooks.ts, supabase-realtime-manager.ts, supabase-realtime-channel.ts, supabase-realtime-channel-builder.ts, index.ts}`; modify `features/wallet/wallet.tsx` (remove the `useTrackWalletChanges()` call), `features/agicash-db/database.client.ts` (remove the `agicashRealtimeClient` construction + `window.agicashRealtime`).

- [ ] **Step 1:** Confirm `use-track-wallet-changes.ts`'s handler list is empty (all `use*ChangeHandlers` deleted in Tasks 6–11). Delete the file + remove its call in `wallet.tsx`.
- [ ] **Step 2:** Delete the `lib/supabase/*` realtime files; remove `agicashRealtimeClient` (database.client.ts lines ~78-82) + `window.agicashRealtime`. Keep `agicashDbClient` (the Supabase DB client — residual, Task 14).
- [ ] **Step 3:** Delete any remaining dead `useProcess*Tasks` not removed in Tasks 10/11.
- [ ] **Step 4: Gate + sweep** (`git grep "use-track-wallet-changes\|useTrackWalletChanges\|supabase-realtime\|agicashRealtimeClient\|use.*ChangeHandlers\|useWire.*Events\|useProcess.*Tasks" apps/web-wallet/app` → only `root.tsx`'s `SupabaseRealtimeError` if present [handled Task 14] / nothing) + **commit** `feat(wallet-web): B-web delete app realtime + central tracker`.

> ⚠️ Verification owed: no double realtime subscription after this (SDK only); reconnect resync drives the stores via the SDK; no leaked listeners.

### Task 14: Residual carry + final glue [sonnet, OPUS-reviewed]

Carry the documented Supabase residual (identical to A) + final glue cleanup. Confirm what MUST survive.

**Files:** `entry.client.tsx`, `features/agicash-db/database.client.ts`, `features/agicash-db/supabase-session.ts`, `features/shared/feature-flags.ts`, `routes/_protected.tsx`, `root.tsx`.

- [ ] **Step 1:** KEEP `opensecret.configure()` in `entry.client.tsx` (the auth canary `authQueryOptions → fetchUser()` needs the configured OpenSecret client outside the SDK — identical to A's residual). Keep Breez WASM prefetch + Sentry init.
- [ ] **Step 2:** KEEP `database.client.ts` `agicashDbClient` + `supabase-session.ts` — pinned by: the 4 `getByTransactionId` reads in `transaction-additional-details.tsx`, `useReverseTransaction`, `useAccountOrNull`'s lazy expired-account fetch, and `feature-flags.ts`'s RPC. Confirm via `git grep "agicashDbClient" apps/web-wallet/app` matches exactly these consumers; document the residual in the commit body (mirror A's AW-T14 documentation).
- [ ] **Step 3:** `root.tsx` — remove the `SupabaseRealtimeError` import + error-boundary branch IF present (A found it already absent on base — verify; if absent, skip).
- [ ] **Step 4:** `_protected.tsx` — remove any now-dead `supabaseSessionTokenQuery` prefetch (SDK session token self-warms) IF present.
- [ ] **Step 5: Full orphan sweep** across `apps/web-wallet/app` for every deleted symbol/file; gate; **commit** `feat(wallet-web): B-web residual carry + final glue cleanup`.

### Task 15: Holistic review + biome pass + verification checklist [OPUS]

- [ ] **Step 1:** Whole-branch OPUS review (diff vs the B-engine tip): base seam untouched (`sdk.ts`/`engine.ts` byte-identical; only `domains/user.ts` + `domains/cashu-send-ops.ts` from Part 0); no app import of the deleted caches/change-handlers/`lib/supabase` realtime; all 13 cache classes gone (only the `TransactionsCache` key-holder remains); every hot read via `useStore`-family; the 4 active trackers via `useQuery + lifecycle`; transactions/feature-flags/rates on the app QueryClient; the residual (db client + session) exactly the 4 documented consumers; the engine seam (`@tanstack` confinement) intact.
- [ ] **Step 2:** Controller-verified gate: `bun run typecheck` (8/8 exit 0) + `bun run test` (all packages 0 fail). Run from the worktree, capture output.
- [ ] **Step 3: ONE biome pass** scoped to B's NEW/changed files only (NOT repo-wide — repo-wide `fix:all` reformats the frozen base seam + the un-normalized base, destroying the byte-identical-seam eval property and diverging B from A/base, exactly as A's AW-T15 found). Run `bunx biome check --write apps/web-wallet/app/lib/store-hooks.ts apps/web-wallet/app/lib/sdk.ts <other new B files>` (explicit file list), review the churn is cosmetic, commit separately `style(wallet-web): B-web biome pass (B files only)`. If biome insists on touching base files, DISCARD with `git checkout -- .` and leave B unformatted (match A's "biome is a shared-base concern" deferral).
- [ ] **Step 4: Assemble the browser/live verification checklist** (owed — run separately via Chrome DevTools MCP + `verify`/`run` against a live stack with `VITE_BREEZ_API_KEY`): boot + sign-in (fresh + returning) — **specifically verify the first wallet render does NOT show empty stores (the B analogue of A's ensureLoaded bug — `useStoreSuspense` must suspend on cold stores)**; live balance via the accounts store (pay→balance); 2-tab leader + ≤10s failover; kill-leader-mid-flow; reconnect → store refetch (onCatchUp); online/offline + visibility; session-expiry (full + guest-silent); Google OAuth; password-reset; Lightning send/receive (cashu + spark) terminal transitions via lifecycle events; token-send QR-immediate; deep-link + interactive token claim (same + cross account); accounts/contacts live; transactions list/detail/unack live (lifecycle invalidation); live Spark balance overlay; feature-flags anon RPC; LAN dev; `/lnurl-test`. Record in the SDD ledger; do NOT mark B-web "done" until these are run.

---

## Self-Review (writing-plans checklist)

**1. Spec coverage:** WalletSdkProvider + adapter hooks → T3 (provider omitted by documented decision; hooks present) ✓. Delete cache classes/queryOptions/change-handlers → T6–T13 ✓. `useStore`/`useStoreSuspense`/`useStoreSelect` → T3 ✓. App QueryClient keeps feature-flags/rates + transactions infinite list → T9/T14 ✓. SdkConfig from env + LAN app-side → T2 ✓. `<Wallet>` = background.start/stop + online/offline/visibility + resync + dispose → T5 ✓. Re-add base methods (B needs 2) → T1 ✓. The 4c fold-ins live in the B-engine plan (not re-done here) ✓. The transactions-no-store + lifecycle-liveness fork → T5/T9/T10/T11 ✓. Residual carry → T14 ✓.

**2. Placeholder scan:** Verbatim-reuse tasks point at the exact A files (`sdkx-stateless/...`) to reproduce — legitimate external references to real, committed code, not placeholders. The B-NEW code (store hooks, lifecycle bridge) carries full code. The Spark-balance-overlay (T6 Step 3) is resolved inline (app-side local state overlay), not deferred. The `TransactionsCache`-key-holder reconciliation between T5 and T9 is called out explicitly.

**3. Type consistency:** `getSdk()`/`StoreSdk`/`Store`/`useStore`/`useStoreSuspense`/`useStoreSelect`/`useTransactionLifecycleSync`/`useSDKActivityTracking`/`StoreAccounts`/`AddCashuAccountInput`/`Cursor`/`TransferQuote`/token-receive types are introduced in Tasks 1–5 and consumed consistently in Tasks 6–14. The store property names (`sdk.user.current`, `sdk.accounts.all`, `sdk.contacts.all`, `sdk.cashu.send.unresolved`, `sdk.cashu.receive.pending`, `sdk.spark.send.unresolved`, `sdk.spark.receive.pending`) match the B-engine plan's `StoreSdk` exactly.

**4. Ordering keeps the gate green:** T2 (new module) → T3 (hooks) → T4 (auth) → T5 (background + delete leader, KEEP shrinking app realtime) → T6–T12 (per-feature: switch reads to stores, delete that cache + change-handler, shrink the central tracker) → T13 (delete the now-empty central tracker + app realtime) → T14 (residual + final glue) → T15 (holistic + biome + verification). Every read is live throughout (store via SDK OR cache via the still-running app realtime); single processing (SDK) from T5.

## Owed to later (NOT this plan)

- Browser/live verification (Task 15 checklist) against a live stack — owed before B-web is "done."
- The **6-dim A-vs-B eval** (spec §497-516) after both variants are built + verified.
- Push of `sdkx/base`/variant branches remains gated on the Breez smoke + live realtime + `/lnurl-test` + user nod.
