# Wallet SDK — S12: Reads-flip (`queryFn → sdk.*`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip every web READ `queryFn` from its repository to the corresponding `@agicash/wallet-sdk` domain method, keeping query keys byte-identical and all options/Suspense intact, so the web reads through the SDK while its existing realtime/change-handlers/task-processor still drive reactivity.

**Architecture:** Slice S12 of the no-cache full migration (spec §5 channel 1 "Reads", §9 Phase 2). The SDK is stateless per call and self-resolves the session from `config.storage`; TanStack Query stays the web's read cache. Each read hook obtains the browser SDK via a new `useSdk()` accessor (domain from the root loader) and `await`s it inside its `queryFn`. NOTHING else changes: no mutations flip, no `useSdkEventBridge`, no `sdk.background.start()`, no deletions — those are S13/S14/S15.

**Tech Stack:** React Router v7, TanStack Query v5, `@agicash/wallet-sdk` (`Sdk` read domains), Bun workspaces, `bun:test` (web suite, **no jsdom**), biome.

---

## Scope boundary (read first)

**In scope (S12 — flip read `queryFn`s only):**
- New shared accessor `features/shared/use-sdk.ts` (`useSdk(): Promise<Sdk>`).
- Flip these 11 reads (keys preserved; userId param dropped — SDK self-resolves): `useUser`, `useAccounts`, `useAccountOrNull`, `useTransaction`, `useTransactions`, `useHasTransactionsPendingAck`, `useContacts`, `useFindContactCandidates`, the exchange-rate shared queryFn (driving `useExchangeRate`/`useExchangeRates`/`getExchangeRate`), `useTrackCashuReceiveQuote`, `useTrackSparkReceiveQuote`.
- Minimal type re-points where `tsc` flags a web-local-vs-SDK mismatch (known: `Contact.createdAt` Date-vs-string + its `toContact` ripple; `UserProfile` lud16 superset). Re-point to the `@agicash/wallet-sdk` barrel — never adapter-cast.

**Out of scope (do NOT do here):**
- **`authQueryOptions`/`useAuthState` stays on OpenSecret `fetchUser()`** — `authState.user` is the OpenSecret RAW identity (`login_method`/`name`/`email`/`email_verified`), NOT the wallet `User`; flipping it would break the route guards, drop the `Sentry.setUser`/session-hint-cookie side-effects, and double-run the bootstrap. The auth-read flip is a later dedicated slice. (Decision locked 2026-06-18.)
- **feature-flags** — web-only forever; there is no `sdk.featureFlags`. Do not touch `featureFlagsQueryOptions`/`useFeatureFlag`/`invalidateAuthQueries`.
- **No mutations flip.** `useUpdateUser`, `useSetDefaultAccount`, `useCreateContact`, `useDeleteContact`, `useAcknowledgeTransaction`, etc. keep using repositories + `setQueryData`.
- **No `useSdkEventBridge`, no `sdk.background.start()`, no deletions.** All `{Entity}Cache` classes, all `*ChangeHandlers`, all `useProcess*Tasks`/WS/Breez, the realtime hooks, `entry.client.tsx` `configure()`, and the `_protected` pre-warm middleware STAY ALIVE and untouched (deleted at S13).
- **Send-side per-quote reads** — none exist (send screens read collection caches + Breez/melt subscriptions); do not invent a `sdk.cashu/spark.send.get` read.

---

## Decisions (locked — carry, do NOT re-litigate)

- **D12-1 — Canary = `useUser`, NOT auth.** Auth stays on OpenSecret (see scope boundary). `useUser` is the first flip: the wallet `User` shapes are identical web↔SDK, and it's the lynchpin other reads currently derive `user.id` from.
- **D12-2 — Drop the userId param; SDK self-resolves the session.** Every user-scoped LIST read (`accounts.list`, `transactions.list`/`countPendingAck`, `contacts.list`/`search`, `getCurrentUser`) resolves the userId internally from `config.storage` and **THROWS `SdkError('No active session','NOT_AUTHENTICATED')`** when absent (it does NOT return `[]`/null). By-id GETs and `exchangeRate.*` are sessionless. So flipped queryFns pass no userId.
- **D12-3 — Keep each hook's existing gate; add NO new `enabled` flags.** Gating is structural via `_protected` (the middleware awaits the session + bootstrap before any child renders) plus the existing `useUser()` subscription in each user-scoped read (it suspends until the session resolves). Preserve that subscription as the gate (it also feeds select-time derivations); drop only the userId *value* it fed to the SDK.
- **D12-4 — Suspense reads throw on null.** `getCurrentUser()`/`transactions.get()` return `T|null`; the suspense reads (`useUser`, `useTransaction`) keep their existing throw-on-missing so their non-null contract + Suspense semantics are unchanged (the null branch is unreachable under `_protected`).
- **D12-5 — `domain` threading via `useSdk()`, NOT in the queryKey.** `getSdk(lud16Domain)` reads the domain only on its first call (it caches the `Promise<Sdk>`); all callers must pass the SAME domain. `useSdk()` centralizes this (domain from `useLocationData().domain`, the root-loader canonical host). queryKeys exclude domain (session-stable) so they stay byte-identical — mandatory, because the still-alive change-handlers write `setQueryData` into these exact keys.
- **D12-6 — Per-quote receive trackers flip in S12.** Their live UNPAID→PAID/EXPIRED updates come from `setQueryData` written by the (alive) change-handlers + task-processor `onSuccess`, NOT the queryFn (staleTime Infinity). Flipping the read source can't break live updates; the S13 event bridge is not needed for them.
- **D12-7 — Minimal type re-point (user choice 2026-06-18).** Re-point a web-local entity type to the `@agicash/wallet-sdk` barrel ONLY where `tsc` flags a mismatch after the flip, fixing the few ripples (notably web `ContactRepository.toContact` → emit `createdAt: Date`). No adapter-casts in queryFns; no bulk re-point (that's S15).
- **D12-8 — Verification = typecheck + suite + biome; behaviour proof deferred.** The web suite is `bun:test` with **no jsdom** → these hooks have no unit harness. The per-task safety net is `bun --filter=web-wallet run typecheck` (shape compatibility is the real risk of a reads-flip) + `bun --filter=web-wallet run test` (regression) + `bun run fix:all` (biome stays clean). The behavioural "app works on SDK reads" checkpoint is the S13/S14 e2e + manual money-path gate (spec §10) — ask before running those.

---

## Global Constraints

- **Reads-only; keys byte-identical; nothing deleted.** The web must keep building and behaving identically; only read `queryFn` bodies (and the minimal type re-points) change.
- **`fix:all` ≠ typecheck.** `bun run fix:all` = `biome check --write` (lint+format only). Each task gate MUST also run `bun --filter=web-wallet run typecheck`.
- **Suites run on `bun test`, per workspace.** Web: `bun --filter=web-wallet run test` (`bunfig.toml` pins `[test] root = "./app"`). The SDK is NOT touched in S12 → no SDK suite needed.
- **Errors:** `SdkError`/`DomainError`/`NotFoundError` take `(message, code)`; `NotImplementedError(method)`.
- **One git commit per task** (`feat(web): …`). **Do not push.** The worktree is harness-owned (`.claude/worktrees/…`) — do NOT `git worktree remove` it. Ignore/`rm` the untracked `sdd/` scratch dir if present.
- bun/bunx only. `master` is the default branch. Branch: `sdk-nocache/full-migration` (SDK-biome-clean tip `015a8aaa`).

---

## Grounding facts (verified 2026-06-18 — authoritative; see memory `project-wallet-sdk-s12-grounding`)

**SDK read surface (all entity return types are the SAME shared contract types re-exported from the `@agicash/wallet-sdk` barrel + `Money` from `@agicash/money` → `instanceof Money` holds, no remapping):**
- `sdk.user.getCurrentUser(): Promise<User|null>` — self-resolves session; null off-session.
- `sdk.accounts.list(): Promise<Account[]>` (self-resolves userId; ACTIVE accounts only); `sdk.accounts.get(id): Promise<Account|null>` (no session).
- `sdk.transactions.list({accountId?,cursor?,pageSize?}): Promise<{transactions: Transaction[]; nextCursor: TransactionCursor|null}>` (self-resolves; pageSize default 25; cursor `{stateSortOrder,createdAt,id}` ≡ web `Cursor`; repo nulls `nextCursor` on a short page internally); `sdk.transactions.get(id): Promise<Transaction|null>` (no session, returns null); `sdk.transactions.countPendingAck(): Promise<number>` (self-resolves).
- `sdk.contacts.list(): Promise<Contact[]>`, `sdk.contacts.search({query}): Promise<UserProfile[]>` (self-resolve; search min-3 + excludes-existing parity confirmed).
- `sdk.exchangeRate.getRates({tickers}): Promise<Rates>` (sessionless; SDK service byte-identical to web lib; does NOT accept `signal`).
- `sdk.cashu.receive.get(quoteId): Promise<CashuReceiveQuote|null>`, `sdk.spark.receive.get(quoteId): Promise<SparkReceiveQuote|null>` (no session).

**Web plumbing (verified file:line):**
- `getSdk(lud16Domain: string): Promise<Sdk>` — `apps/web-wallet/app/features/shared/sdk.ts:114` (caches the Promise; reads domain on first call only).
- `useLocationData()` (default export) — `apps/web-wallet/app/hooks/use-location.ts` — returns `{ domain, origin }`, throws if absent (untyped `useRouteLoaderData('root')` + runtime guard).
- `_protected.tsx` `routeGuardMiddleware`→`ensureUserData` SEEDS `[UserCache.Key]`+`[AccountsCache.Key]` via `setQueryData` from a `WriteUserRepository.upsert` result (NOT the read queryFn). Seed shape = wallet `User`/`Account` = the same shared types the flipped reads return → compatible; **no middleware change in S12**.
- Web suite: `bun --filter=web-wallet run test`; web typecheck: `bun --filter=web-wallet run typecheck` (`react-router typegen && tsc`).

---

## File Structure

**Created:**
- `apps/web-wallet/app/features/shared/use-sdk.ts` — `useSdk(): Promise<Sdk>` (the shared accessor every flipped read uses).

**Modified (read `queryFn` flips):**
- `apps/web-wallet/app/features/user/user-hooks.tsx` — `userQueryOptions` + `useUser`.
- `apps/web-wallet/app/features/accounts/account-hooks.ts` — `accountsQueryOptions` + `useAccounts` + `useAccountOrNull`.
- `apps/web-wallet/app/features/transactions/transaction-hooks.ts` — `useTransaction` + `useTransactions` + `useHasTransactionsPendingAck`.
- `apps/web-wallet/app/features/contacts/contact-hooks.ts` — `useContacts` + `useFindContactCandidates`.
- `apps/web-wallet/app/hooks/use-exchange-rate.ts` — `exchangeRatesQueryOptions` + `getExchangeRate` + the 3 hooks.
- `apps/web-wallet/app/features/receive/cashu-receive-quote-hooks.ts` — `useTrackCashuReceiveQuote`.
- `apps/web-wallet/app/features/receive/spark-receive-quote-hooks.ts` — `useTrackSparkReceiveQuote`.

**Modified (minimal type re-points, only if `tsc` flags them):**
- `apps/web-wallet/app/features/contacts/contact.ts` — re-point `Contact` to the barrel.
- `apps/web-wallet/app/features/contacts/contact-repository.ts` — `toContact` emits `createdAt: Date` (ripple).
- `apps/web-wallet/app/features/user/user.ts` — re-point `UserProfile` to the barrel.

**Not touched:** `auth.ts`/`useAuthState`, feature-flags, all mutations, all `{Entity}Cache`/`*ChangeHandlers`/`useProcess*Tasks`, realtime hooks, `entry.client.tsx`, the `_protected` middleware, `features/shared/sdk.ts` (`getSdk` already exists).

---

## Task 1: Shared `useSdk()` accessor + flip the `useUser` canary

**Files:**
- Create: `apps/web-wallet/app/features/shared/use-sdk.ts`
- Modify: `apps/web-wallet/app/features/user/user-hooks.tsx`

**Interfaces:**
- Produces: `export function useSdk(): Promise<Sdk>` — every subsequent task calls this in its read hook and `await`s it inside the `queryFn`.

- [ ] **Step 1: Create the shared accessor** — `apps/web-wallet/app/features/shared/use-sdk.ts`:

```ts
import type { Sdk } from '@agicash/wallet-sdk';
import useLocationData from '~/hooks/use-location';
import { getSdk } from './sdk';

/**
 * The browser SDK promise for the current lud16 domain (derived from the root
 * loader's canonical origin). Read query hooks await this inside their queryFn:
 * `const sdk = useSdk(); ... return (await sdk).accounts.list();`. `getSdk`
 * memoizes the promise, so calling this every render is cheap.
 */
export function useSdk(): Promise<Sdk> {
  const { domain } = useLocationData();
  return getSdk(domain);
}
```

- [ ] **Step 2: Flip `userQueryOptions` + `useUser`** — in `apps/web-wallet/app/features/user/user-hooks.tsx`, replace the `userQueryOptions` factory (currently `:75-87`) and `useUser` (`:94-110`) with:

```ts
const userQueryOptions = <TData = User>({
  sdk,
  select,
}: {
  sdk: Promise<Sdk>;
  select?: (data: User) => TData;
}) => ({
  queryKey: [UserCache.Key],
  queryFn: async () => {
    const user = await (await sdk).user.getCurrentUser();
    if (!user) {
      throw new Error('Cannot use useUser hook in anonymous context');
    }
    return user;
  },
  select,
});

/**
 * This hook returns the logged in user data.
 * @param select - This option can be used to transform or select a part of the data returned by the query function. If not provided, the user data will be returned as is.
 * @returns The selected user data.
 */
export const useUser = <TData = User>(
  select?: (data: User) => TData,
): TData => {
  const authState = useAuthState();
  if (!authState.user) {
    throw new Error('Cannot use useUser hook in anonymous context');
  }

  const sdk = useSdk();

  const { data } = useSuspenseQuery(userQueryOptions({ sdk, select }));

  return data;
};
```

> The `useAuthState()` guard stays (the gate — preserves the anonymous-context throw + the auth→user ordering). `getCurrentUser()` self-resolves the session and returns `User | null`, so the queryFn throws on null to keep the non-null Suspense contract. The local `useReadUserRepository()` call is removed from `useUser` (it was only feeding the old queryFn; `useReadUserRepository` stays used by the change-handlers/mutations elsewhere in the file).

- [ ] **Step 3: Fix imports** — in `user-hooks.tsx`, add `import { useSdk } from '~/features/shared/use-sdk';` and `import type { Sdk } from '@agicash/wallet-sdk';`. Leave the existing `User` import as-is (web `User` is structurally identical to the SDK's; Step 4 confirms). Do NOT remove `useReadUserRepository`/`ReadUserRepository` imports if still referenced elsewhere in the file.

- [ ] **Step 4: Typecheck** — `bun --filter=web-wallet run typecheck`. Expected: PASS. If `tsc` reports that the SDK `User` (from `getCurrentUser`) is not assignable to the web `User` typed in `select`/consumers, re-point the web `User` type to the barrel per D12-7 (`export type { User } from '@agicash/wallet-sdk'` in `app/features/user/user.ts`, removing the local declaration) and re-run. (Expected: not needed — they're identical.)

- [ ] **Step 5: Biome + web suite** — `bun run fix:all && bun --filter=web-wallet run test`. Expected: biome clean; the existing web suite stays green (count unchanged — no new tests; these hooks have no unit harness, D12-8).

- [ ] **Step 6: Commit**

```bash
git add apps/web-wallet/app/features/shared/use-sdk.ts apps/web-wallet/app/features/user/user-hooks.tsx
git commit -m "$(cat <<'EOF'
feat(web): flip useUser read to the SDK + add useSdk() accessor (S12)

The S12 reads-flip canary. New useSdk() (domain from the root loader, getSdk)
is the shared accessor every flipped read uses. useUser's queryFn now calls
sdk.user.getCurrentUser() (self-resolves the session; throws on null to keep the
Suspense non-null contract) instead of userRepository.get(authUser.id); the
['user'] key and the useAuthState gate are unchanged. Auth stays on OpenSecret.
Web realtime/change-handlers still drive reactivity. Gate green.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Flip accounts reads — DEFERRED TO S13 (do not execute in S12)

> **DEFERRED (decision 2026-06-19).** `Account.wallet` is a LIVE wallet-class instance; the SDK's `ExtendedCashuWallet`/`BreezSdk` are nominally distinct from the web's own copies (private `_bip39Seed`) which coexist on this branch until S15. Flipping `accounts.list()` fails `tsc` (proven: even a minimal flip with no type re-point) and cascades into the web's still-alive cashu/spark orchestration, `getExtendedAccounts`/`getAccountBalance`, the wallet classes, AND a 2nd consumer `app/features/receive/claim-cashu-token-service.ts` — and would run the web money-paths on SDK-built wallets. Not a reads-only change. The accounts / `useBalance` / `useAccountOrNull` reads flip at **S13**, where the web wallet/connection classes are deleted and `Account` unifies on the SDK type. The step-by-step below is retained as S13 reference.

**Files (S13 reference):**
- Modify: `apps/web-wallet/app/features/accounts/account-hooks.ts`

**Interfaces:**
- Consumes: `useSdk` (Task 1).

- [ ] **Step 1: Flip `accountsQueryOptions`** — replace the factory (`:138-158`) so it takes the SDK promise instead of `{userId, accountRepository}` (KEEP `staleTime` + `structuralSharing` verbatim):

```ts
export const accountsQueryOptions = ({ sdk }: { sdk: Promise<Sdk> }) => {
  return queryOptions({
    queryKey: [AccountsCache.Key],
    queryFn: async () => (await sdk).accounts.list(),
    staleTime: Number.POSITIVE_INFINITY,
    // Refetches use `getAllActive`, so any expired account previously in the
    // cache (lazy-fetched via useAccountOrNull, or just expired before the
    // realtime ACCOUNT_UPDATED has arrived) would otherwise be wiped. Preserve
    // anything in oldData that the new fetch didn't return.
    structuralSharing: (oldData, newData) => {
      const oldAccounts = oldData as Account[] | undefined;
      const newAccounts = newData as Account[];
      if (!oldAccounts) return newAccounts;
      const newIds = new Set(newAccounts.map((a) => a.id));
      return [...newAccounts, ...oldAccounts.filter((a) => !newIds.has(a.id))];
    },
  });
};
```

- [ ] **Step 2: Update `useAccounts`** — in `useAccounts` (`:234-293`), change the queryOptions call and drop the now-unused `accountRepository`. Keep `const user = useUser();` (the `select` closure uses `user`), keep `refetchOnWindowFocus/Reconnect: 'always'` and the entire `select`:

```ts
  const user = useUser();
  const sdk = useSdk();

  const { currency, type, isOnline, purpose, state = 'active' } = select ?? {};

  return useSuspenseQuery({
    ...accountsQueryOptions({ sdk }),
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    select: useCallback(
      // ...unchanged select body...
```

> Remove `const accountRepository = useAccountRepository();` from `useAccounts` only (it was feeding the old factory). `useAccountRepository` stays imported and used by `useAccountOrNull` (until Step 3) and the mutations.

- [ ] **Step 3: Flip `useAccountOrNull`** — in `useAccountOrNull` (`:328-347`), change the lazy-fetch queryFn from the repo to `sdk.accounts.get(id)` while KEEPING the `accountsCache.upsert` side-effect:

```ts
export function useAccountOrNull(id: string | null): Account | null {
  const accountsCache = useAccountsCache();
  const sdk = useSdk();
  const { data: accounts } = useAccounts({ state: ALL_ACCOUNT_STATES });

  useSuspenseQuery({
    queryKey: ['fetch-account-by-id', id],
    queryFn: async () => {
      if (!id || accountsCache.get(id)) return null;
      const fetched = await (await sdk).accounts.get(id);
      if (fetched) accountsCache.upsert(fetched);
      return null;
    },
    // The query stores no useful data (always null); it's just a fetch + dedup
    // primitive. Don't keep the marker around once the route unmounts.
    gcTime: 0,
  });

  return id ? (accounts.find((x) => x.id === id) ?? null) : null;
}
```

> Replace `const accountRepository = useAccountRepository();` with `const sdk = useSdk();` in `useAccountOrNull`. If `useAccountRepository` is now unused anywhere in the file, biome `noUnusedImports` will flag it on the gate — remove the import then (but verify the mutations don't use it first).

- [ ] **Step 4: Fix imports** — add `import { useSdk } from '~/features/shared/use-sdk';` and `import type { Sdk } from '@agicash/wallet-sdk';` to `account-hooks.ts`.

- [ ] **Step 5: Typecheck** — `bun --filter=web-wallet run typecheck`. Expected: PASS (web `Account` is structurally identical to the SDK `Account` per grounding). If `tsc` flags the `Account` type, re-point it to the barrel per D12-7.

- [ ] **Step 6: Biome + web suite** — `bun run fix:all && bun --filter=web-wallet run test`. Expected: biome clean; suite green.

- [ ] **Step 7: Commit**

```bash
git add apps/web-wallet/app/features/accounts/account-hooks.ts
git commit -m "$(cat <<'EOF'
feat(web): flip accounts reads to the SDK (S12)

accountsQueryOptions.queryFn -> sdk.accounts.list() and useAccountOrNull's lazy
fetch -> sdk.accounts.get(id) (keeping the accountsCache.upsert side-effect).
['accounts']/['fetch-account-by-id', id] keys, structuralSharing, select, and
refetch flags unchanged; userId param dropped (SDK self-resolves). useBalance/
useAccount/etc derive from the same cache untouched. Gate green.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Flip transactions reads (`useTransaction` + `useTransactions` + `useHasTransactionsPendingAck`)

**Files:**
- Modify: `apps/web-wallet/app/features/transactions/transaction-hooks.ts`

**Interfaces:**
- Consumes: `useSdk` (Task 1).

- [ ] **Step 1: Flip `useTransaction`** (`:89-113`) — source the by-id read from the SDK; KEEP the `NotFoundError` throw + `retry` logic:

```ts
export function useTransaction(id: string) {
  const sdk = useSdk();

  return useSuspenseQuery({
    queryKey: [TransactionsCache.Key, id],
    queryFn: async () => {
      const transaction = await (await sdk).transactions.get(id);

      if (!transaction) {
        throw new NotFoundError(`Transaction not found for id: ${id}`);
      }

      return transaction;
    },
    retry: (failureCount, error) => {
      if (error instanceof NotFoundError) {
        return false;
      }
      return failureCount <= 3;
    },
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
}
```

> Replace `const transactionRepository = useTransactionRepository();` with `const sdk = useSdk();` in `useTransaction`.

- [ ] **Step 2: Flip `useTransactions`** (`:117-150`) — keep the `useUser()` gate, the `transactionsCache.upsert` loop, and the infinite-query options; change only the data source. Pass `cursor: pageParam ?? undefined` (SDK param is `cursor?: TransactionCursor`), and pass `result.nextCursor` straight through (the SDK repo already nulls it on a short page):

```ts
export function useTransactions(accountId?: string) {
  useUser(); // gate: suspend until the session resolves (SDK self-resolves the userId)
  const sdk = useSdk();
  const transactionsCache = useTransactionsCache();

  const result = useInfiniteQuery({
    queryKey: [TransactionsCache.AllTransactionsKey, accountId],
    initialPageParam: null,
    queryFn: async ({ pageParam }: { pageParam: Cursor | null }) => {
      const result = await (await sdk).transactions.list({
        accountId,
        cursor: pageParam ?? undefined,
        pageSize: PAGE_SIZE,
      });

      for (const transaction of result.transactions) {
        transactionsCache.upsert(transaction);
      }

      return {
        transactions: result.transactions,
        nextCursor: result.nextCursor,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    retry: 1,
  });

  return result;
}
```

> Replace `const userId = useUser((user) => user.id); const transactionRepository = useTransactionRepository();` with the `useUser()` gate + `const sdk = useSdk();`. If `tsc` complains that web `Cursor` ≠ SDK `TransactionCursor`, they are structurally identical — re-point `Cursor` to `import type { TransactionCursor as Cursor } from '@agicash/wallet-sdk'` per D12-7.

- [ ] **Step 3: Flip `useHasTransactionsPendingAck`** (`:152-168`) — keep the gate + `select` + `?? false`:

```ts
export function useHasTransactionsPendingAck() {
  useUser(); // gate: suspend until the session resolves (SDK self-resolves the userId)
  const sdk = useSdk();

  const result = useQuery({
    queryKey: [TransactionsCache.UnacknowledgedCountKey],
    queryFn: async () => (await sdk).transactions.countPendingAck(),
    select: (data) => data > 0,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    retry: 1,
  });

  return result.data ?? false;
}
```

- [ ] **Step 4: Fix imports** — add `import { useSdk } from '~/features/shared/use-sdk';`. `useTransactionRepository` stays imported (still used by the change-handlers + mutations); if biome flags it unused, only then remove it.

- [ ] **Step 5: Typecheck** — `bun --filter=web-wallet run typecheck`. Expected: PASS (Transaction + Cursor structurally identical). Re-point per D12-7 only if flagged.

- [ ] **Step 6: Biome + web suite** — `bun run fix:all && bun --filter=web-wallet run test`. Expected: clean + green.

- [ ] **Step 7: Commit**

```bash
git add apps/web-wallet/app/features/transactions/transaction-hooks.ts
git commit -m "$(cat <<'EOF'
feat(web): flip transactions reads to the SDK (S12)

useTransaction/useTransactions/useHasTransactionsPendingAck queryFns now call
sdk.transactions.get/list/countPendingAck. Keys ['transactions',id]/
['all-transactions',accountId]/['unacknowledged-transactions-count'] unchanged;
the per-page transactionsCache.upsert loop, the infinite-query params, the
NotFoundError throw, and the data>0 select all preserved. userId dropped (SDK
self-resolves); useUser() kept purely as the session gate. Gate green.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Flip contacts reads + minimal type re-point

**Files:**
- Modify: `apps/web-wallet/app/features/contacts/contact-hooks.ts`
- Modify (re-point): `apps/web-wallet/app/features/contacts/contact.ts`
- Modify (ripple): `apps/web-wallet/app/features/contacts/contact-repository.ts`
- Modify (re-point): `apps/web-wallet/app/features/user/user.ts`

**Interfaces:**
- Consumes: `useSdk` (Task 1).

- [ ] **Step 1: Flip `useContacts`** (`:77-91`) — keep the gate + `staleTime`/refetch/`select`:

```ts
export function useContacts(select?: (contacts: Contact[]) => Contact[]) {
  useUser(); // gate: suspend until the session resolves (SDK self-resolves the userId)
  const sdk = useSdk();

  const { data: contacts } = useSuspenseQuery({
    queryKey: [ContactsCache.Key],
    queryFn: async () => (await sdk).contacts.list(),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    select,
  });

  return contacts;
}
```

- [ ] **Step 2: Flip `useFindContactCandidates`** (`:133-144`) — keep the gate + `initialData`/`initialDataUpdatedAt`/`staleTime`:

```ts
export function useFindContactCandidates(query: string) {
  useUser(); // gate: suspend until the session resolves (SDK self-resolves the userId)
  const sdk = useSdk();

  return useQuery({
    queryKey: ['search-user-profiles', query],
    queryFn: async () => (await sdk).contacts.search({ query }),
    initialData: [],
    initialDataUpdatedAt: () => Date.now() - 1000 * 6,
    staleTime: 1000 * 5,
  });
}
```

> Replace each hook's `const userId = useUser((user) => user.id); const contactRepository = useContactRepository();` with the `useUser()` gate + `const sdk = useSdk();`. `useContactRepository` stays imported (used by `useCreateContact`/`useDeleteContact`/change-handlers).

- [ ] **Step 3: Add imports** — add `import { useSdk } from '~/features/shared/use-sdk';` to `contact-hooks.ts`.

- [ ] **Step 4: Typecheck (expect the Contact + UserProfile mismatches)** — `bun --filter=web-wallet run typecheck`. Expected: FAIL — `sdk.contacts.list()` returns the SDK `Contact` (`createdAt: Date`) vs web `Contact` (`createdAt: string`), and `sdk.contacts.search()` returns the SDK `UserProfile` (`{id,username,lud16}`) vs web `Pick<User,'id'|'username'>`. Resolve via re-point (Steps 5–7).

- [ ] **Step 5: Re-point web `Contact` to the barrel** — replace `apps/web-wallet/app/features/contacts/contact.ts` so `Contact` is the SDK type, keeping a serialized-shape schema for the type guard (the realtime payload / DB row uses a string `created_at`, so `isContact` validates the serialized form):

```ts
import { z } from 'zod/mini';

export type { Contact } from '@agicash/wallet-sdk';

/** The serialized (wire/DB) shape of a contact — `createdAt` is an ISO string. */
const SerializedContactSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  ownerId: z.string(),
  username: z.string(),
  lud16: z.string(),
});

/**
 * Type guard over the SERIALIZED contact shape (ISO-string `createdAt`), used to
 * validate realtime/DB payloads before mapping. The runtime `Contact` carries a
 * `Date` `createdAt` (see `@agicash/wallet-sdk`).
 */
export const isContact = (value: unknown): boolean => {
  return SerializedContactSchema.safeParse(value).success;
};
```

> First `git grep -n 'isContact' apps/web-wallet/app` to confirm callers only use the boolean (not `value is Contact` narrowing to a `Date`-typed `Contact`). If a caller relies on the narrowing, keep `(value): value is Contact` — it still compiles (the guard asserts the runtime type). Adjust only if `tsc` complains.

- [ ] **Step 6: Ripple — `ContactRepository.toContact` emits `createdAt: Date`** — `git grep -n 'toContact' apps/web-wallet/app/features/contacts/contact-repository.ts`, read the mapper, and change its `createdAt` field from the raw string (`row.created_at`) to `new Date(row.created_at)` so change-handler-added cache entries match the SDK `Contact` (`Date`) the flipped read returns. Show the exact one-line change in the mapper return object.

- [ ] **Step 7: Re-point web `UserProfile` to the barrel** — `git grep -n 'UserProfile' apps/web-wallet/app/features/user/user.ts`; replace the local `export type UserProfile = Pick<User, 'id' | 'username'>` with `export type { UserProfile } from '@agicash/wallet-sdk'`. The search UI reads only `username`, so the added `lud16` is a harmless superset.

- [ ] **Step 8: Typecheck again** — `bun --filter=web-wallet run typecheck`. Expected: PASS. If a residual mismatch remains, re-point the offending local type to the barrel (D12-7) — never cast.

- [ ] **Step 9: Biome + web suite** — `bun run fix:all && bun --filter=web-wallet run test`. Expected: clean + green. (If a contacts unit test asserted `createdAt` as a string literal, update it to a `Date` and ask the user before keeping the change — it's a behaviour-preserving test fixup, not new coverage.)

- [ ] **Step 10: Commit**

```bash
git add apps/web-wallet/app/features/contacts/contact-hooks.ts apps/web-wallet/app/features/contacts/contact.ts apps/web-wallet/app/features/contacts/contact-repository.ts apps/web-wallet/app/features/user/user.ts
git commit -m "$(cat <<'EOF'
feat(web): flip contacts reads to the SDK + re-point Contact/UserProfile (S12)

useContacts/useFindContactCandidates queryFns -> sdk.contacts.list()/search().
['contacts']/['search-user-profiles',query] keys + options unchanged; userId
dropped (SDK self-resolves), useUser() kept as the gate. Minimal type re-point
(D12-7): Contact + UserProfile now come from @agicash/wallet-sdk; web
ContactRepository.toContact emits a Date createdAt to match the SDK shape (the
isContact guard validates the serialized string form). Gate green.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Flip exchange-rate reads

**Files:**
- Modify: `apps/web-wallet/app/hooks/use-exchange-rate.ts`

**Interfaces:**
- Consumes: `useSdk` (Task 1).

- [ ] **Step 1: Thread the SDK promise through the factory + helper** — replace `apps/web-wallet/app/hooks/use-exchange-rate.ts` lines `33-89` so the shared `exchangeRatesQueryOptions` and the imperative `getExchangeRate` take `sdk: Promise<Sdk>`, and the three React entry points obtain it via `useSdk()`. Keep `getNormalizedTickers` and the `['exchangeRate', normalizedTickers]` key exactly:

```ts
export const exchangeRatesQueryOptions = (
  tickers: Ticker[],
  sdk: Promise<Sdk>,
) => {
  const normalizedTickers = getNormalizedTickers(tickers);
  return queryOptions({
    queryKey: ['exchangeRate', normalizedTickers],
    queryFn: async () => (await sdk).exchangeRate.getRates({ tickers: normalizedTickers }),
  });
};

const exchangeRateQueryOptions = (ticker: Ticker, sdk: Promise<Sdk>) => {
  return exchangeRatesQueryOptions([ticker], sdk);
};

/**
 * Gets the exchange rate for the ticker.
 * The function will check the cache and if not found, it will fetch the rate.
 */
export const getExchangeRate = async (
  queryClient: QueryClient,
  ticker: Ticker,
  sdk: Promise<Sdk>,
) => {
  const rates = await queryClient.fetchQuery(
    exchangeRateQueryOptions(ticker, sdk),
  );
  return rates[ticker];
};

export const useExchangeRate = (ticker: Ticker) => {
  const sdk = useSdk();
  return useQuery({
    ...exchangeRateQueryOptions(ticker, sdk),
    select: (data) => data[ticker],
    refetchInterval: 15_000,
  });
};

export const useExchangeRates = (tickers: Ticker[]) => {
  const sdk = useSdk();
  return useQuery({
    ...exchangeRatesQueryOptions(tickers, sdk),
    refetchInterval: 15_000,
  });
};

/**
 * Returns a function that can be used to get the exchange rate for a given ticker.
 * The function will check the cache and if not found, it will fetch the rate.
 */
export const useGetExchangeRate = () => {
  const queryClient = useQueryClient();
  const sdk = useSdk();
  return (ticker: Ticker) => getExchangeRate(queryClient, ticker, sdk);
};
```

> The `signal` param is intentionally dropped (the SDK `getRates({tickers})` doesn't accept it — a tiny, accepted regression for these 15s-interval fetches; D-grounding). `Ticker` stays imported from `~/lib/exchange-rate` (it's `${string}-${string}`, assignable to the SDK `Ticker`); if `tsc` flags it, import `Ticker` from `@agicash/wallet-sdk` instead.

- [ ] **Step 2: Add imports** — add `import { useSdk } from '~/features/shared/use-sdk';` and `import type { Sdk } from '@agicash/wallet-sdk';` to `use-exchange-rate.ts`.

- [ ] **Step 3: Find + fix external callers of the changed signatures** — `git grep -n 'getExchangeRate\|exchangeRatesQueryOptions' apps/web-wallet/app`. For every caller NOT inside this file: if it's `useGetExchangeRate()` (a hook returning a `(ticker) => ...` closure) its consumers are unchanged. If a non-React module calls `getExchangeRate(queryClient, ticker)` or `exchangeRatesQueryOptions(tickers)` directly, it now needs the `sdk` promise — thread `getSdk(domain)` (domain available where it's called) or, if the caller has no domain access, leave that one call on `~/lib/exchange-rate` for S12 and note it for S13. Report what you found.

- [ ] **Step 4: Typecheck** — `bun --filter=web-wallet run typecheck`. Expected: PASS (Rates + Ticker structurally identical). Re-point `Ticker`/`Rates` to the barrel per D12-7 only if flagged.

- [ ] **Step 5: Biome + web suite** — `bun run fix:all && bun --filter=web-wallet run test`. Expected: clean + green.

- [ ] **Step 6: Commit**

```bash
git add apps/web-wallet/app/hooks/use-exchange-rate.ts
git commit -m "$(cat <<'EOF'
feat(web): flip exchange-rate reads to the SDK (S12)

exchangeRatesQueryOptions + getExchangeRate now take the SDK promise; the queryFn
calls sdk.exchangeRate.getRates({tickers}). The ['exchangeRate', normalizedTickers]
key, the both-directions normalization, the 15s refetchInterval, and the single-
rate select are unchanged. AbortSignal is dropped (SDK getRates takes no signal;
harmless for the 15s-interval fetch). Gate green.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Flip the per-quote receive trackers

**Files:**
- Modify: `apps/web-wallet/app/features/receive/cashu-receive-quote-hooks.ts`
- Modify: `apps/web-wallet/app/features/receive/spark-receive-quote-hooks.ts`

**Interfaces:**
- Consumes: `useSdk` (Task 1).

- [ ] **Step 1: Flip `useTrackCashuReceiveQuote`** (`:215-253`) — change only the queryFn; keep `enabled`, `staleTime`, refetch flags, the `onPaid`/`onExpired` effect, and the return:

```ts
  const enabled = !!quoteId;
  const onPaidRef = useLatest(onPaid);
  const onExpiredRef = useLatest(onExpired);
  const sdk = useSdk();

  const { data } = useQuery({
    queryKey: [CashuReceiveQuoteCache.Key, quoteId],
    // biome-ignore lint/style/noNonNullAssertion: quoteId is guaranteed by enabled
    queryFn: async () => (await sdk).cashu.receive.get(quoteId!),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    enabled,
  });
```

> Replace `const cashuReceiveQuoteRepository = useCashuReceiveQuoteRepository();` with `const sdk = useSdk();`. The `biome-ignore` for `quoteId!` stays on the queryFn line. `useCashuReceiveQuoteRepository` stays imported if used elsewhere in the file (it is — by the task processor/change handlers); if biome flags it unused, only then remove it.

- [ ] **Step 2: Flip `useTrackSparkReceiveQuote`** (`:87-125`) — same shape:

```ts
  const enabled = !!quoteId;
  const onPaidRef = useLatest(onPaid);
  const onExpiredRef = useLatest(onExpired);
  const sdk = useSdk();

  const { data } = useQuery({
    queryKey: [SparkReceiveQuoteCache.Key, quoteId],
    // biome-ignore lint/style/noNonNullAssertion: quoteId is guaranteed by enabled
    queryFn: async () => (await sdk).spark.receive.get(quoteId!),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    enabled,
  });
```

> Replace `const sparkReceiveQuoteRepository = useSparkReceiveQuoteRepository();` with `const sdk = useSdk();`.

- [ ] **Step 3: Add imports** — add `import { useSdk } from '~/features/shared/use-sdk';` to both files.

- [ ] **Step 4: Typecheck** — `bun --filter=web-wallet run typecheck`. Expected: PASS. If the SDK `CashuReceiveQuote`/`SparkReceiveQuote` union isn't assignable to the web hooks' `UseTrack…Response` (`status: quote['state']` + `quote`), re-point the web quote type to the barrel per D12-7. (Verify whether `receive-cashu.tsx`/`receive-spark.tsx`/`buy-checkout.tsx` consumers compile — they read `status`/`quote.state`.)

- [ ] **Step 5: Biome + web suite** — `bun run fix:all && bun --filter=web-wallet run test`. Expected: clean + green.

- [ ] **Step 6: Commit**

```bash
git add apps/web-wallet/app/features/receive/cashu-receive-quote-hooks.ts apps/web-wallet/app/features/receive/spark-receive-quote-hooks.ts
git commit -m "$(cat <<'EOF'
feat(web): flip per-quote receive trackers to the SDK (S12)

useTrackCashuReceiveQuote/useTrackSparkReceiveQuote queryFns now call
sdk.cashu.receive.get / sdk.spark.receive.get. Live UNPAID->PAID/EXPIRED updates
still flow through the (alive) change-handlers' setQueryData into the SAME
['cashu-receive-quote',id]/['spark-receive-quote',id] keys, so the flip only
changes the initial/refocus fetch source — the S13 event bridge is not needed
for these. enabled/staleTime/onPaid/onExpired unchanged. Gate green.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Whole-slice gate + docs + memory + carryover

**Files:**
- Modify: `docs/superpowers/plans/2026-06-13-wallet-sdk-00-plan-of-plans.md`
- Docs/memory only otherwise.

- [ ] **Step 1: Whole-slice gate** — from the worktree root:

```bash
bun run fix:all                      # biome lint+format, whole repo (must stay clean — exit 0)
bun run typecheck                    # all workspaces
bun --filter=web-wallet run test     # web suite (count unchanged from S11 baseline unless a fixture was updated in Task 4)
```
Expected: all green; biome exit 0; no SDK changes so the SDK suite is unaffected.

- [ ] **Step 2: Confirm scope (reads-only, keys preserved, nothing deleted, no bridge/background)**

```bash
git grep -n "useSdkEventBridge\|sdk.background" apps/web-wallet/app || echo "OK: no event bridge / background start in S12"
git grep -n "authQueryOptions" apps/web-wallet/app/features/user/auth.ts   # still on fetchUser, untouched
git grep -nl "useSdk(" apps/web-wallet/app   # the flipped read hooks + use-sdk.ts only
git diff --stat master -- apps/web-wallet/app | tail -1
```
Expected: no `useSdkEventBridge`/`sdk.background`; auth untouched; only read hooks + `use-sdk.ts` (+ the Task-4 type files) changed.

- [ ] **Step 3: Update the plan-of-plans index** — in `docs/superpowers/plans/2026-06-13-wallet-sdk-00-plan-of-plans.md`, flip the Plan 12 row to ✅ done (link this plan) and append the carryover block below. Also flag the PART-1 SDK-biome-clean (`015a8aaa`) so the gate-debt note is resolved.

- [ ] **Step 4: Commit the docs**

```bash
git add docs/superpowers/plans/2026-06-13-wallet-sdk-00-plan-of-plans.md docs/superpowers/plans/2026-06-13-wallet-sdk-12-reads-flip.md
git commit -m "docs(wallet-sdk): record S12 (reads-flip) done + S13/S14/S15 carryover"
```

- [ ] **Step 5: Update the `project-wallet-sdk-nocache-track` memory** — S12 done (reads flipped to SDK; web realtime still drives reactivity; checkpoint = app works on SDK reads, provable via S13 e2e/manual); next = S13 (atomic orchestration flip).

**Carryover to record (S12 → S13 / S14 / S15):**
- **(S13 atomic flip)** Mount the one `useSdkEventBridge(queryClient)`, flip write mutations, AND in the SAME step `sdk.background.start()` on sign-in / `stop()` on sign-out while DELETING the web TaskProcessor + `useTakeTaskProcessingLead` + `use-track-wallet-changes` + all `*ChangeHandlers` + the web realtime wiring + every `{Entity}Cache` the change-handlers fed. Never run the web processor and `sdk.background` together (dual leaders / double melt-mint — spec §8). Also remove the now-redundant `entry.client.tsx` `configure()`. The bridge must drive the SAME keys S12 preserved (`['user']`, `['accounts']`, `['all-transactions',accountId]`, `['unacknowledged-transactions-count']`, `['transactions',id]`, `['contacts']`, `['cashu-receive-quote',id]`, `['spark-receive-quote',id]`).
- **(S13 auth-read flip — now a real work item)** Flipping `authQueryOptions` was deliberately deferred from S12 (OpenSecret-identity ≠ wallet `User`). S13 (or its own slice) must migrate the route guards (`_auth.tsx` login_method/email, `_protected.tsx` shouldUserVerifyEmail/hasUserChanged/bootstrap) off the OpenSecret identity fields before/with routing auth through `sdk.user.getCurrentUser()`, and re-home the `Sentry.setUser`/session-hint-cookie side-effects.
- **(S13 contacts)** The contacts cache is naive-append/no-version; the event bridge + background forwarder must replicate the op-type dedupe before the web `useContactChangeHandlers` is retired. Note the S12 `Contact.createdAt` is now `Date` (re-pointed) — the bridge's `toContact`-equivalent must emit `Date` too.
- **(S15 cleanup)** Delete the web's now-dead repos/lib copies (incl. `~/lib/exchange-rate` once its remaining direct importers are migrated, and any web entity-type local declarations fully superseded by the barrel re-points), drop unused deps, final `fix:all`.
- **(gate note)** Phase-2 gate is now honest after PART-1 (`015a8aaa`): `bun run fix:all` (biome, repo-clean) + `bun run typecheck` + the web suite (+ SDK suite if the SDK is touched).

---

## Self-Review

**1. Spec coverage (§5 channel 1 "Reads" / §7c thin consumer / §9 S12 / §10 gate):**
- Every web read `queryFn` → `sdk.*` with the SAME query keys → Tasks 1–6 (spec §5 #1). ✓
- Web realtime/change-handlers/task-processor STILL drive reactivity; no bridge, no background, nothing deleted → scope boundary + Task 7 Step 2 (spec §9 S12). ✓
- TanStack + Suspense + `_protected` pre-warm kept (pre-warm seeds via `setQueryData`, shape-compatible — no middleware change) → grounding facts + D-notes. ✓
- The auth canary correction (auth stays on OpenSecret) → D12-1 + scope boundary + S13 carryover. ✓
- Gate = `fix:all` + `typecheck` + web suite; e2e/manual deferred → Global Constraints + D12-8 + Task 7. ✓

**2. Placeholder scan:** every code step shows complete code; type-recon ripples (Task 4 Steps 6/7, Task 5 Step 3, Task 6 Step 4) are bounded by an explicit `git grep` + a defined resolution rule (re-point to the barrel; never cast), not "handle edge cases". The `>`-notes are verification reminders (confirm an import is still used; confirm a consumer compiles), not deferred work.

**3. Type consistency:** `useSdk(): Promise<Sdk>` (Task 1) is consumed identically in every later task via `const sdk = useSdk(); … (await sdk).<domain>.<method>()`. Factories that previously took a repo now take `sdk: Promise<Sdk>` (`userQueryOptions`, `accountsQueryOptions`, `exchangeRatesQueryOptions`/`exchangeRateQueryOptions`/`getExchangeRate`). Keys are byte-identical to the originals. The only deliberate type changes are the D12-7 re-points (Contact → barrel + `Date` ripple; UserProfile → barrel), gated behind a `tsc` failure.

**Risks / carryover:** the real-money guardrail is S13 (never two leaders). S12's only behavioural change is the read SOURCE (repo → SDK, same DB), proven shape-compatible by `tsc` and unchanged by the suite; live reactivity is untouched (still web-driven). The biggest latent item is the deferred auth-read flip (recorded for S13). The exchange-rate `signal` drop is an accepted micro-regression.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-13-wallet-sdk-12-reads-flip.md`.**

Per the task, execution proceeds with **superpowers:subagent-driven-development** — a fresh subagent per task, two-stage review between tasks. Per-task gate: `bun --filter=web-wallet run typecheck` + `bun run fix:all` + `bun --filter=web-wallet run test`. One commit per task, no push. Task 1 (the `useUser` canary + `useSdk` accessor) is the checkpoint that establishes the pattern; Tasks 2–6 are independent and may proceed in any order after it.
