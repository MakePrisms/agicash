# Wallet SDK — S15 Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the now-dead web code the SDK migration orphaned, land the deferred correctness/hardening fixes, and leave the monorepo green — the final coding slice of the no-cache wallet-SDK full migration.

**Architecture:** Two kinds of work. (A) **Deletions** — files/exports proven dead by a re-grep on today's tree (`project-wallet-sdk-s15-grounding` memory). Their "test" is `typecheck` + the unit suites: deleting something still imported fails the gate immediately. (B) **Deferred fixes** — real behaviour/type changes carried over from S13/auth/S14, done test-first (TDD).

**Tech Stack:** React Router v7, TanStack Query v5, `@agicash/wallet-sdk` (workspace), `@agicash/money`, bun, biome, zod, vitest/bun:test.

## Global Constraints

- **Branch:** `sdk-nocache/full-migration`. **DO NOT push / open the PR** — the whole migration is ONE PR gated on the still-UNRUN live money-path test (`VITE_BREEZ_API_KEY` + live stack + `/lnurl-test` vs PROD `agi.cash`).
- **Package manager:** bun/bunx only. Never npm/npx/yarn/pnpm.
- **Per-task gate (web-only tasks):** `bun run fix:all` (biome lint+format, exit 0) + `bun run typecheck` (4 packages, all exit 0) + `bun --filter=web-wallet run test`.
- **Per-task gate (tasks touching `packages/wallet-sdk`):** the above **plus** `bun --filter=@agicash/wallet-sdk run test`.
- **Baselines at S14 tip `6c245ae8`:** web suite 134 pass, SDK suite 651 pass, `fix:all` exit 0, `typecheck` 4/4.
- **One commit per task.** Commit message footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- `noUnusedLocals` is OFF in tsconfig — `tsc` will NOT flag an unused import/local; rely on biome (`fix:all`) for unused-import detection and on grep for unused *exports* (biome does not flag unused exports).
- **Re-grep before every delete.** The grounding memory's set was verified on 2026-06-22; if the tree moved, re-run the cited `rg` before deleting. A `_protected.receive.cashu_.token.tsx` token-claim route, the `transaction-additional-details.tsx`/`useReverseTransaction` chain, and `feature-flags.ts` are STILL on web services — do not delete anything they import.
- **SCOPE GUARD:** This slice deletes only genuinely-orphaned code. It does **NOT** migrate the token-claim route, transaction-detail components, or feature-flags off web services onto `sdk.*` — that is feature work for a later slice. The large spec-§7 "web deletes" substrate (`account-repository`, `user-repository`/`user-service` classes, the 4 receive repos/services, `claim-cashu-token-service`, `shared/{cashu,spark,encryption,cryptography,auth}`, `agicash-db/*`, `lib/{ecies,bolt11,lnurl,spark,sha256,xchacha20poly1305}`, most of `lib/cashu/*`, `mint-validation.ts`) is **ALIVE and STAYS**.

---

## File-touch map

**SDK (`packages/wallet-sdk/src`):** `types/transaction-details.ts` (T1), `domains/user/session-resolver.ts`+`.test.ts` (T2), `config.ts`+`domains/auth/auth-domain.ts`+`auth-domain.test.ts` (T3), `internal/auth/session-expiry-scheduler.test.ts`+`domains/auth/auth-domain.test.ts` (T13).

**Web (`apps/web-wallet/app`):** transaction unify (T1); `receive/lnurl-verify-token.server.ts`+`.test.ts` (T4); `shared/sdk.server.ts`+`shared/sdk.ts` (T5); `user/auth.ts`+`user/user-hooks.tsx`+`wallet/use-sdk-event-bridge.ts` (T6); send/transfer deletions (T7); `lib/cashu/*`+`lib/cashu/index.ts`+`lib/timeout.ts` (T8); `lib/exchange-rate/`+3 Ticker importers (T9); standalone dead files (T10); named-export strips (T11); `package.json` (T12); comment/JSDoc/test polish (T13).

---

## Phase 1 — SDK correctness / hardening (TDD)

### Task 1: Fix `CompletedSparkLightningSendTransactionDetails` over-require + unify web `Transaction` on the barrel

**Files:**
- Modify: `packages/wallet-sdk/src/types/transaction-details.ts:246-253`
- Test: `packages/wallet-sdk/src/types/transaction-details.type-test.ts` (create) — a type-level assertion
- Modify: `apps/web-wallet/app/features/transactions/transaction-additional-details.tsx:19`
- Modify: `apps/web-wallet/app/features/transactions/transaction-hooks.ts:1,19` (collapse dual import)

**Interfaces:**
- Produces: a public `CompletedSparkLightningSendTransactionDetails` whose `transferId` is **optional** (matching the internal zod schema), so the barrel `Transaction` is structurally assignable everywhere the web local `Transaction` was, and the web can import `Transaction` from `@agicash/wallet-sdk`.

- [ ] **Step 1: Write the failing type-level test**

Create `packages/wallet-sdk/src/types/transaction-details.type-test.ts`:

```ts
import { expectTypeOf } from 'expect-type';
import type { CompletedSparkLightningSendTransactionDetails } from './transaction-details';

// A completed SPARK_LIGHTNING send WITHOUT transferId must be assignable
// (transferId is only present for TRANSFER transactions).
type WithoutTransferId = Omit<
  CompletedSparkLightningSendTransactionDetails,
  'transferId'
>;

expectTypeOf<WithoutTransferId>().toMatchTypeOf<
  Partial<Pick<CompletedSparkLightningSendTransactionDetails, 'transferId'>>
>();

// transferId must be optional, not required:
expectTypeOf<
  CompletedSparkLightningSendTransactionDetails['transferId']
>().toEqualTypeOf<string | undefined>();
```

If `expect-type` is not already a dev dependency, instead use a `@ts-expect-error` assertion in a `*.test.ts` that bun runs as a no-op at runtime but tsc checks:

```ts
import { test } from 'bun:test';
import type { CompletedSparkLightningSendTransactionDetails as D } from '../../types/transaction-details';
test('transferId optional on completed spark ln send', () => {
  // On the BUGGY type this errors (transferId required); on the FIXED type it compiles.
  const d = {} as Omit<D, 'transferId'>;
  const ok: D = { ...d } as D; // structural sanity
  void ok;
});
```

- [ ] **Step 2: Run typecheck to confirm it fails on the current (buggy) type**

Run: `bun --filter=@agicash/wallet-sdk run typecheck`
Expected: FAIL — `Property 'transferId' is missing ... but required in type 'Required<IncompleteSparkLightningSendTransactionDetails>'` (TS2322/2741).

- [ ] **Step 3: Fix the SDK type**

In `packages/wallet-sdk/src/types/transaction-details.ts:246-253`, change:

```ts
export type CompletedSparkLightningSendTransactionDetails =
  Required<IncompleteSparkLightningSendTransactionDetails> & {
    paymentPreimage: string;
    transferId?: string;
  };
```

to:

```ts
export type CompletedSparkLightningSendTransactionDetails = Omit<
  Required<IncompleteSparkLightningSendTransactionDetails>,
  'transferId'
> & {
  /** The preimage of the lightning payment. */
  paymentPreimage: string;
  /** Present only for TRANSFER transactions. */
  transferId?: string;
};
```

- [ ] **Step 4: Run the SDK typecheck + suite to confirm green**

Run: `bun --filter=@agicash/wallet-sdk run typecheck && bun --filter=@agicash/wallet-sdk run test`
Expected: PASS (the runtime is untouched — internal zod schema already correct; type relaxation only).

- [ ] **Step 5: Unify the two web `Transaction` consumers on the barrel**

In `apps/web-wallet/app/features/transactions/transaction-additional-details.tsx`, change line 19:

```ts
import type { Transaction } from './transaction';
```
to:
```ts
import type { Transaction } from '@agicash/wallet-sdk';
```

In `apps/web-wallet/app/features/transactions/transaction-hooks.ts`, collapse the dual import (line 1 `import type { Transaction as SdkTransaction } from '@agicash/wallet-sdk'` + line 19 `import type { Transaction } from './transaction'`) into a single barrel import `import type { Transaction } from '@agicash/wallet-sdk'`, and replace every `SdkTransaction` usage (the `acknowledge` path) with `Transaction`. Read the file first to enumerate the exact use-sites (`TransactionsCache.upsert`, `acknowledgeTransactionInHistoryCache`, `isTransactionReversable`, `useReverseTransaction`, `useAcknowledgeTransaction`).

- [ ] **Step 6: Run the full web + SDK gate**

Run: `bun run typecheck && bun run fix:all && bun --filter=web-wallet run test && bun --filter=@agicash/wallet-sdk run test`
Expected: PASS. (Do NOT yet delete `transaction.ts`/`transaction-repository.ts` — `transaction.ts` stays alive via the transaction-details parsers; `transaction-repository.ts` is handled in Task 11.)

- [ ] **Step 7: Commit**

```bash
git add packages/wallet-sdk/src/types/transaction-details.ts packages/wallet-sdk/src/types/transaction-details.type-test.ts apps/web-wallet/app/features/transactions/transaction-additional-details.tsx apps/web-wallet/app/features/transactions/transaction-hooks.ts
git commit -m "fix(wallet-sdk): make CompletedSparkLightningSendTransactionDetails.transferId optional; unify web Transaction on barrel (S15 B1)"
```

---

### Task 2: Add a thin retry to `bootstrapUser` (SDK)

**Files:**
- Modify: `packages/wallet-sdk/src/domains/user/session-resolver.ts:41-69`
- Test: `packages/wallet-sdk/src/domains/user/session-resolver.test.ts`

**Interfaces:**
- Produces: `bootstrapUser` retries the `repo.upsert` call (1 try + up to 2 retries; backoff `min(500 * 2 ** attempt, 30_000)` ms) on transient failures, but **never** on `DomainError` (the SDK never-retry class — covers `classify('23505')` → `DomainError`). `sleep` is DI'd (defaults to real timers) so tests are deterministic.

- [ ] **Step 1: Write the failing tests**

Add to `packages/wallet-sdk/src/domains/user/session-resolver.test.ts` (uses the existing `makeFakeDb` + `ctx()` helpers; thread a recording `sleep`):

```ts
test('bootstrap retries the upsert on a transient failure then succeeds', async () => {
  const sleeps: number[] = [];
  let calls = 0;
  // rpc throws a transient (non-23505/non-hint) error once, then returns the row
  const db = makeFakeDb({
    selectResult: { data: null }, // forces bootstrap
    rpc: () => {
      calls += 1;
      if (calls === 1) throw new SdkError('boom', 'UNKNOWN');
      return { data: { user: guestRow, accounts: [] }, error: null };
    },
  });
  const user = await resolveSession(ctx({ db, sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); } }), identity, {});
  expect(user.id).toBe('u1');
  expect(calls).toBe(2);
  expect(sleeps).toEqual([500]);
});

test('bootstrap does NOT retry on a DomainError (e.g. 23505)', async () => {
  let calls = 0;
  const db = makeFakeDb({
    selectResult: { data: null },
    rpc: () => { calls += 1; throw { code: '23505', message: 'dup' }; },
  });
  await expect(resolveSession(ctx({ db }), identity, {})).rejects.toBeInstanceOf(DomainError);
  expect(calls).toBe(1);
});
```

(Adapt `ctx()`/`makeFakeDb` to accept a per-call `rpc` function and an optional `sleep` — extend the existing helpers; do NOT use a bare `mock.module`.)

- [ ] **Step 2: Run to confirm the retry test fails**

Run: `bun test packages/wallet-sdk/src/domains/user/session-resolver.test.ts`
Expected: FAIL — `calls` is 1 (no retry) on the transient-then-succeed case.

- [ ] **Step 3: Implement `upsertWithRetry`**

In `packages/wallet-sdk/src/domains/user/session-resolver.ts`, add `DomainError` to the existing `import { SdkError } from '../../errors'`, import `UpsertUserParams` from `'../../internal/repositories/user-repository'`, and add:

```ts
type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function upsertWithRetry(
  repo: UserRepository,
  params: UpsertUserParams,
  sleep: Sleep = realSleep,
): Promise<User> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await repo.upsert(params);
    } catch (error) {
      lastError = error;
      if (error instanceof DomainError) throw error; // never retry permanent failures
      if (attempt === 2) break;
      await sleep(Math.min(500 * 2 ** attempt, 30_000));
    }
  }
  throw lastError;
}
```

Replace the bare `return repo.upsert({ ... })` at line ~58 with `return upsertWithRetry(repo, { ... }, ctx.config.bootstrapSleep ?? realSleep)` — OR, to avoid touching `SdkConfig`, thread the test `sleep` only via an internal seam: export `upsertWithRetry` for the test and default its `sleep` to `realSleep` (production passes nothing). Prefer the test-only export (lighter; the test imports `upsertWithRetry` directly rather than going through `resolveSession`). If the tests drive `resolveSession` (as written in Step 1), add an internal-only `sleep` to the `ctx`/`DomainContext` test seam, NOT to the public `SdkConfig`.

- [ ] **Step 4: Run to confirm green**

Run: `bun test packages/wallet-sdk/src/domains/user/session-resolver.test.ts`
Expected: PASS (all retry cases + the existing happy-path test unchanged).

- [ ] **Step 5: Full SDK gate + commit**

```bash
bun --filter=@agicash/wallet-sdk run typecheck && bun --filter=@agicash/wallet-sdk run test
git add packages/wallet-sdk/src/domains/user/session-resolver.ts packages/wallet-sdk/src/domains/user/session-resolver.test.ts
git commit -m "feat(wallet-sdk): retry bootstrapUser upsert on transient failures (S15 B2)"
```

---

### Task 3: Internalize the `sessionExpiry` config seam (SDK)

**Files:**
- Modify: `packages/wallet-sdk/src/config.ts:110-122` (remove the public field)
- Modify: `packages/wallet-sdk/src/domains/auth/auth-domain.ts:66,75-89` (add internal 2nd param)
- Modify: `packages/wallet-sdk/src/domains/auth/auth-domain.test.ts:353-393`
- (No change to `packages/wallet-sdk/src/sdk.ts:81`.)

**Interfaces:**
- Produces: `createAuthDomain(ctx: DomainContext, seam?: AuthDomainTestSeam): AuthDomain` where `AuthDomainTestSeam = { sessionExpiry?: Pick<SessionExpirySchedulerDeps, 'now' | 'setTimer' | 'clearTimer'> }`. The public `SdkConfig` no longer carries `sessionExpiry`.

- [ ] **Step 1: Move the test injection to the new 2nd arg (failing first)**

In `auth-domain.test.ts`, change `makeWiringCtx` to stop putting `sessionExpiry` in the `as unknown as SdkConfig` object and instead return a `seam` object; change the three wiring-test construction sites (lines ~375/384/393) from `createAuthDomain(ctx)` to `createAuthDomain(ctx, seam)`.

- [ ] **Step 2: Run to confirm it fails to typecheck (seam param doesn't exist yet)**

Run: `bun --filter=@agicash/wallet-sdk run typecheck`
Expected: FAIL — `createAuthDomain` takes 1 arg.

- [ ] **Step 3: Implement the internal seam**

In `auth-domain.ts`, add `import type { SessionExpirySchedulerDeps } from '../../internal/auth/session-expiry-scheduler';`, then:

```ts
/** Internal test seam: deterministic timers for the session-expiry scheduler. Not part of the public SdkConfig. */
type AuthDomainTestSeam = {
  sessionExpiry?: Pick<SessionExpirySchedulerDeps, 'now' | 'setTimer' | 'clearTimer'>;
};

export function createAuthDomain(ctx: DomainContext, seam: AuthDomainTestSeam = {}): AuthDomain {
  // ...
  const scheduler = new SessionExpiryScheduler({
    storage: ctx.config.storage,
    onExpiry: () => { /* unchanged handleSessionExpiry(...) */ },
    now: seam.sessionExpiry?.now,
    setTimer: seam.sessionExpiry?.setTimer,
    clearTimer: seam.sessionExpiry?.clearTimer,
  });
```

In `config.ts`, delete the entire `sessionExpiry?: { now?; setTimer?; clearTimer? }` block (lines 110-122). Leave `sdk.ts:81` `this.auth = createAuthDomain(ctx);` unchanged (defaults to `{}`).

- [ ] **Step 4: Run the SDK gate to confirm green**

Run: `bun --filter=@agicash/wallet-sdk run typecheck && bun --filter=@agicash/wallet-sdk run test`
Expected: PASS (the 3 wiring tests still inject deterministic timers via the 2nd arg; `session-expiry-scheduler.test.ts` unchanged).

- [ ] **Step 5: Confirm the web assemblers don't reference the removed field, then full gate + commit**

Run: `rg -n "sessionExpiry" apps/web-wallet` → expect ZERO hits. Then `bun run typecheck && bun --filter=web-wallet run test`.

```bash
git add packages/wallet-sdk/src/config.ts packages/wallet-sdk/src/domains/auth/auth-domain.ts packages/wallet-sdk/src/domains/auth/auth-domain.test.ts
git commit -m "refactor(wallet-sdk): move sessionExpiry timer seam off public SdkConfig to an internal createAuthDomain param (S15 B3)"
```

---

## Phase 2 — Web hardening fixes

### Task 4: Add a 64-hex key guard to the lnurl verify-token codec (B5)

**Files:**
- Modify: `apps/web-wallet/app/features/receive/lnurl-verify-token.server.ts:35-38`
- Test: `apps/web-wallet/app/features/receive/lnurl-verify-token.server.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `lnurl-verify-token.server.test.ts`:

```ts
describe('createLnurlVerifyTokenCodec key validation', () => {
  test('throws on a wrong-but-even-length hex key', () => {
    expect(() => createLnurlVerifyTokenCodec('abcd')).toThrow(/64 hex characters/);
  });
  test('throws on non-hex characters', () => {
    expect(() => createLnurlVerifyTokenCodec('z'.repeat(64))).toThrow(/64 hex characters/);
  });
  test('throws on 63/65 hex chars', () => {
    expect(() => createLnurlVerifyTokenCodec('a'.repeat(63))).toThrow(/64 hex characters/);
    expect(() => createLnurlVerifyTokenCodec('a'.repeat(65))).toThrow(/64 hex characters/);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `bun test apps/web-wallet/app/features/receive/lnurl-verify-token.server.test.ts`
Expected: FAIL — `createLnurlVerifyTokenCodec('abcd')` currently constructs fine (only blows up later inside the cipher).

- [ ] **Step 3: Implement the guard in the factory**

In `lnurl-verify-token.server.ts`, at the top of `createLnurlVerifyTokenCodec` (before `const key = hexToBytes(keyHex);`):

```ts
if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
  throw new Error(
    'LNURL_SERVER_ENCRYPTION_KEY must be 64 hex characters (a 32-byte key)',
  );
}
```

(The empty-string check in `getLnurlVerifyTokenCodec` stays; the factory guard covers the set-but-malformed case and is inherited by the accessor.)

- [ ] **Step 4: Run to confirm green (incl. existing 5 round-trip tests)**

Run: `bun test apps/web-wallet/app/features/receive/lnurl-verify-token.server.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Gate + commit**

```bash
bun run fix:all && bun run typecheck && bun --filter=web-wallet run test
git add apps/web-wallet/app/features/receive/lnurl-verify-token.server.ts apps/web-wallet/app/features/receive/lnurl-verify-token.server.test.ts
git commit -m "fix(web): validate LNURL_SERVER_ENCRYPTION_KEY is 64 hex chars in the codec factory (S15 B5)"
```

---

### Task 5 (OPTIONAL): Eager `VITE_SUPABASE_URL`/`ANON_KEY` guard in the server assembler (B6)

> **Optional / marginal** — an empty URL already throws `supabaseUrl is required` at first request inside `createServerClient`. This only improves the message + fails earlier in the chain. Drop this task if scope is tight.

**Files:**
- Modify: `apps/web-wallet/app/features/shared/sdk.server.ts:55-80` (and mirror in `sdk.ts` `buildClientSdkConfig` for parity)
- Test: `apps/web-wallet/app/features/shared/sdk.server.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
test('buildServerSdkConfig throws without VITE_SUPABASE_URL', () => {
  expect(() => buildServerSdkConfig({ lud16Domain: 'agi.cash', env: { ...baseEnv, VITE_SUPABASE_URL: '' } }))
    .toThrow('VITE_SUPABASE_URL is not set');
});
test('buildServerSdkConfig throws without VITE_SUPABASE_ANON_KEY', () => {
  expect(() => buildServerSdkConfig({ lud16Domain: 'agi.cash', env: { ...baseEnv, VITE_SUPABASE_ANON_KEY: '' } }))
    .toThrow('VITE_SUPABASE_ANON_KEY is not set');
});
```

- [ ] **Step 2: Run to confirm fail.** `bun test apps/web-wallet/app/features/shared/sdk.server.test.ts` → FAIL (silently coalesces to `''`).

- [ ] **Step 3: Implement** — before the `return` in `buildServerSdkConfig`:

```ts
if (!env.VITE_SUPABASE_URL) throw new Error('VITE_SUPABASE_URL is not set');
if (!env.VITE_SUPABASE_ANON_KEY) throw new Error('VITE_SUPABASE_ANON_KEY is not set');
```

and drop the `?? ''` on those two fields. Mirror the two guards in `sdk.ts` `buildClientSdkConfig` (which has the identical gap) for parity.

- [ ] **Step 4: Run to confirm green.** `bun test apps/web-wallet/app/features/shared/sdk.server.test.ts` → PASS (existing tests supply both vars).

- [ ] **Step 5: Gate + commit**

```bash
bun run fix:all && bun run typecheck && bun --filter=web-wallet run test
git add apps/web-wallet/app/features/shared/sdk.server.ts apps/web-wallet/app/features/shared/sdk.ts apps/web-wallet/app/features/shared/sdk.server.test.ts
git commit -m "feat(web): fail fast on missing VITE_SUPABASE_URL/ANON_KEY in SDK config assemblers (S15 B6)"
```

---

### Task 6: Collapse `authState.user` onto the `['user']` query (B4 — Option A)

> **MEDIUM risk** (auth, on a branch whose live money-path gate is UNRUN). Uses Option A (de-duplicate the fetch; keep both keys). If preferred, this task can be deferred to a follow-up.

**Files:**
- Modify: `apps/web-wallet/app/features/user/auth.ts:31-71`
- Modify: `apps/web-wallet/app/features/user/user-hooks.tsx:55-91` (export `userQueryOptions`)
- Modify: `apps/web-wallet/app/features/wallet/use-sdk-event-bridge.ts:110-119` (invalidate `['user']` too)

**Interfaces:**
- Produces: a single `getCurrentUser` network call per logged-in render — `authQueryOptions.queryFn` reads the User via `queryClient.ensureQueryData(userQueryOptions({ sdk }))` instead of calling `sdk.user.getCurrentUser()` itself.

- [ ] **Step 1: Write the failing regression test**

In a web test (e.g. `apps/web-wallet/app/features/user/auth.test.tsx`, create if absent), render a component that calls `useUser()` inside a `QueryClientProvider` with a cold cache and a spied `sdk.user.getCurrentUser`; assert it is called **exactly once** (today: twice).

- [ ] **Step 2: Run to confirm fail.** Expected: getCurrentUser called twice.

- [ ] **Step 3: Implement Option A**

Export `userQueryOptions` from `user-hooks.tsx` (currently module-private). In `auth.ts`, rewrite `authQueryOptions.queryFn` to:

```ts
queryFn: async () => {
  const sdk = getSdk(new URL(window.location.origin).host);
  const queryClient = getQueryClient();
  let user: User | null;
  try {
    user = await queryClient.ensureQueryData(userQueryOptions({ sdk }));
  } catch {
    user = null; // userQueryOptions throws in anonymous context
  }
  if (!user) {
    sessionHintCookie.clear();
    Sentry.setUser(null);
    return { isLoggedIn: false } as const;
  }
  Sentry.setUser({ id: user.id, isGuest: user.isGuest });
  const refreshToken = window.localStorage.getItem('refresh_token');
  if (refreshToken) {
    const { exp } = jwtDecode<OpenSecretJwt>(refreshToken);
    sessionHintCookie.set(exp - Math.floor(Date.now() / 1000));
  }
  return { isLoggedIn: true, user } as const;
},
```

Update `invalidateAuthQueries` to also invalidate `[UserCache.Key]` (`['user']`), and add `['user']` invalidation to the bridge `auth:signed-in` handler (`use-sdk-event-bridge.ts:110-119`) so the single source refreshes on login.

- [ ] **Step 4: Run to confirm green.** Expected: getCurrentUser called once; logged-out path returns `{ isLoggedIn: false }` with cookie/Sentry cleared.

- [ ] **Step 5: Gate + commit**

```bash
bun run fix:all && bun run typecheck && bun --filter=web-wallet run test
git add apps/web-wallet/app/features/user/auth.ts apps/web-wallet/app/features/user/user-hooks.tsx apps/web-wallet/app/features/wallet/use-sdk-event-bridge.ts apps/web-wallet/app/features/user/auth.test.tsx
git commit -m "refactor(web): collapse auth-state user onto the ['user'] query (single getCurrentUser) (S15 B4)"
```

---

## Phase 3 — Dead-code deletion (ordered)

### Task 7: Delete `transfer-service.ts` (keystone) + strip dead send-service exports + delete `spark-send-quote-repository.ts`

**Files:**
- Delete: `apps/web-wallet/app/features/transfer/transfer-service.ts`
- Modify: `apps/web-wallet/app/features/send/cashu-send-quote-service.ts` (drop class `CashuSendQuoteService` + `useCashuSendQuoteService`; KEEP type `CashuLightningQuote`)
- Modify: `apps/web-wallet/app/features/send/spark-send-quote-service.ts` (drop class `SparkSendQuoteService` + `useSparkSendQuoteService`; KEEP type `SparkLightningQuote`)
- Delete: `apps/web-wallet/app/features/send/spark-send-quote-repository.ts`

- [ ] **Step 1: Re-grep to confirm still dead**

Run:
```bash
rg -n "transfer/transfer-service|\bTransferService\b|\buseTransferService\b" apps/web-wallet/app
rg -n "\bCashuSendQuoteService\b|\buseCashuSendQuoteService\b|\bSparkSendQuoteService\b|\buseSparkSendQuoteService\b|spark-send-quote-repository|\bSparkSendQuoteRepository\b" apps/web-wallet/app
```
Expected: the only hits are inside `transfer-service.ts` (being deleted), the two send-service files (the exports being stripped), and `spark-send-quote-repository.ts` (being deleted). NO route/component/hook importer. If anything else appears, STOP and reassess.

- [ ] **Step 2: Delete `transfer-service.ts`**

```bash
git rm apps/web-wallet/app/features/transfer/transfer-service.ts
```

- [ ] **Step 3: Strip the dead send-service exports**

In `cashu-send-quote-service.ts` remove the `CashuSendQuoteService` class and the `useCashuSendQuoteService` factory hook (and any now-unused imports they pulled, e.g. `useCashuSendQuoteRepository` if unused after removal — biome will flag). Keep the `CashuLightningQuote` type export. Do the same in `spark-send-quote-service.ts` for `SparkSendQuoteService` + `useSparkSendQuoteService`, keeping `SparkLightningQuote`.

- [ ] **Step 4: Delete the now-orphaned spark repo**

```bash
git rm apps/web-wallet/app/features/send/spark-send-quote-repository.ts
```

- [ ] **Step 5: Gate (typecheck catches any dangling import)**

Run: `bun run typecheck && bun run fix:all && bun --filter=web-wallet run test`
Expected: PASS. (`cashu-send-quote-hooks.ts` uses `sdk.cashu.send.*` and only the `CashuLightningQuote` type — unaffected.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(web): delete dead transfer-service + send-quote service classes + spark-send-quote-repository (S15)"
```

---

### Task 8: Delete the dead cashu subscription cluster + prune the barrel + delete orphaned `lib/timeout.ts`

**Files:**
- Delete: `apps/web-wallet/app/lib/cashu/melt-quote-subscription.ts`
- Delete: `apps/web-wallet/app/lib/cashu/melt-quote-subscription-manager.ts`
- Delete: `apps/web-wallet/app/lib/cashu/mint-quote-subscription-manager.ts`
- Delete: `apps/web-wallet/app/features/send/proof-state-subscription-manager.ts`
- Modify: `apps/web-wallet/app/lib/cashu/index.ts` (remove lines 9-11)
- Delete: `apps/web-wallet/app/lib/timeout.ts` (transitive orphan)

- [ ] **Step 1: Re-grep to confirm still dead**

```bash
rg -n "useOnMeltQuoteStateChange|MeltQuoteSubscriptionManager|MintQuoteSubscriptionManager|proof-state-subscription|ProofStateSubscription" apps/web-wallet/app
rg -n "lib/timeout|setLongTimeout|clearLongTimeout|\bLongTimeout\b" apps/web-wallet/app
```
Expected: subscription symbols appear ONLY in the 4 files being deleted + the barrel lines 9-11. `lib/timeout` appears ONLY in `lib/timeout.ts` itself, `use-long-timeout.ts` (deleted in Task 10), and `melt-quote-subscription.ts` (deleted here). If `use-long-timeout.ts` is not yet deleted, do Task 10's `use-long-timeout.ts` deletion as part of this task OR run Task 10 first — `lib/timeout.ts` can only be removed once BOTH its importers are gone.

- [ ] **Step 2: Delete the 4 subscription files**

```bash
git rm apps/web-wallet/app/lib/cashu/melt-quote-subscription.ts apps/web-wallet/app/lib/cashu/melt-quote-subscription-manager.ts apps/web-wallet/app/lib/cashu/mint-quote-subscription-manager.ts apps/web-wallet/app/features/send/proof-state-subscription-manager.ts
```

- [ ] **Step 3: Prune the barrel**

In `apps/web-wallet/app/lib/cashu/index.ts` delete lines 9-11 (`export * from './melt-quote-subscription';`, `./melt-quote-subscription-manager';`, `./mint-quote-subscription-manager';`). Keep lines 1-8.

- [ ] **Step 4: Delete `lib/timeout.ts` (only after `use-long-timeout.ts` is also gone — see Task 10)**

```bash
git rm apps/web-wallet/app/lib/timeout.ts
```

- [ ] **Step 5: Gate**

Run: `bun run typecheck && bun run fix:all && bun --filter=web-wallet run test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(web): delete dead cashu subscription managers + orphaned lib/timeout; prune cashu barrel (S15)"
```

> **Dependency note:** Step 4 requires `app/hooks/use-long-timeout.ts` already deleted (Task 10). If executing in this order, fold the `use-long-timeout.ts` delete into Step 4 here, or run Task 10 before Task 8's Step 4.

---

### Task 9: Re-point `Ticker` type-imports to the SDK + delete `lib/exchange-rate/`

**Files:**
- Modify: `apps/web-wallet/app/hooks/use-exchange-rate.ts:9`
- Modify: `apps/web-wallet/app/hooks/use-money-input.ts:6`
- Modify: `apps/web-wallet/app/features/receive/claim-cashu-token-service.ts:6`
- Delete: `apps/web-wallet/app/lib/exchange-rate/` (whole dir: `index.ts`, `exchange-rate-service.ts`, `exchange-rate-service.test.ts`, `providers/{coinbase,coingecko,mempool-space,types}.ts`)

- [ ] **Step 1: Confirm the SDK re-exports `Ticker` + re-grep importers**

```bash
rg -n "export type \{ Ticker" packages/wallet-sdk/src/index.ts   # expect a hit (Ticker, Rates)
rg -n "from '~/lib/exchange-rate'" apps/web-wallet/app           # expect exactly the 3 type-only lines
rg -n "ExchangeRateService|exchangeRateService\b" apps/web-wallet/app | rg -v "app/lib/exchange-rate/"  # expect EMPTY (runtime side is dead)
```

- [ ] **Step 2: Re-point the 3 `import type { Ticker }` lines**

Change each `import type { Ticker } from '~/lib/exchange-rate';` to `import type { Ticker } from '@agicash/wallet-sdk';` in the 3 files above.

- [ ] **Step 3: Delete the dir**

```bash
git rm -r apps/web-wallet/app/lib/exchange-rate
```

- [ ] **Step 4: Gate**

Run: `bun run typecheck && bun run fix:all && bun --filter=web-wallet run test`
Expected: PASS. (The rate fetch already runs on `sdk.exchangeRate.getRates`; `big.js`/`ky` stay used elsewhere so no dep change here.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(web): move Ticker type to @agicash/wallet-sdk; delete the web exchange-rate copy (S15)"
```

---

### Task 10: Delete standalone dead files + rmdir `lib/supabase`

**Files (all confirmed dead, no test siblings):**
- Delete: `apps/web-wallet/app/lib/password-generator.ts`
- Delete: `apps/web-wallet/app/lib/with-retry.ts`
- Delete: `apps/web-wallet/app/hooks/use-long-timeout.ts`
- Delete: `apps/web-wallet/app/features/contacts/contact-repository.ts`
- Delete: `apps/web-wallet/app/features/receive/cashu-receive-swap-hooks.ts`
- Remove: `apps/web-wallet/app/lib/supabase/` (empty dir)

- [ ] **Step 1: Re-grep each to confirm dead**

```bash
rg -n "password-generator|generateRandomPassword" apps/web-wallet/app
rg -n "with-retry|withRetry" apps/web-wallet/app
rg -n "use-long-timeout|useLongTimeout" apps/web-wallet/app
rg -n "contacts/contact-repository|\bContactRepository\b|useContactRepository" apps/web-wallet/app
rg -n "cashu-receive-swap-hooks|useCreateCashuReceiveSwap" apps/web-wallet/app
find apps/web-wallet/app/lib/supabase -type f   # expect EMPTY
```
Expected: each symbol appears ONLY in its own file (self-reference). The `password-generator` e2e fixture uses `window.getMockPassword` at runtime but does NOT import this app file — confirm no `import` of it in the e2e dir: `rg -n "password-generator" e2e 2>/dev/null` → none importing the app module.

- [ ] **Step 2: Delete**

```bash
git rm apps/web-wallet/app/lib/password-generator.ts apps/web-wallet/app/lib/with-retry.ts apps/web-wallet/app/hooks/use-long-timeout.ts apps/web-wallet/app/features/contacts/contact-repository.ts apps/web-wallet/app/features/receive/cashu-receive-swap-hooks.ts
rmdir apps/web-wallet/app/lib/supabase 2>/dev/null || true
```

- [ ] **Step 3: Gate.** `bun run typecheck && bun run fix:all && bun --filter=web-wallet run test` → PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(web): delete orphaned files (password-generator, with-retry, use-long-timeout, contact-repository, cashu-receive-swap-hooks) (S15)"
```

---

### Task 11: Strip remaining dead named exports

**Files / exports to remove (KEEP each file):**
- `apps/web-wallet/app/features/shared/cryptography.ts` — drop `useCryptography` (keep `derivePublicKey`)
- `apps/web-wallet/app/features/user/user-hooks.tsx` — drop `defaultAccounts` const
- `apps/web-wallet/app/features/user/user-repository.ts` — drop `ReadUserDefaultAccountRepository`, `ReadUserRepository`, `useReadUserRepository`, `useWriteUserRepository` (keep `WriteUserRepository`)
- `apps/web-wallet/app/features/user/user-service.ts` — drop `useUserService` (keep `UserService`)
- `apps/web-wallet/app/features/shared/spark.ts` — un-`export` `sparkWalletQueryOptions` (still used internally at :150)
- `apps/web-wallet/app/features/receive/receive-cashu-token-hooks.ts` — drop `useCreateCrossAccountReceiveQuotes` (+ `CreateCrossAccountReceiveQuotesProps` if it becomes unused)
- `apps/web-wallet/app/features/transactions/transaction-repository.ts` — drop class `TransactionRepository` + `useTransactionRepository`; KEEP the `Cursor` type export (imported by `transaction-hooks.ts:20`)

- [ ] **Step 1: Re-grep to confirm each export is dead**

```bash
rg -n "useCryptography" apps/web-wallet/app
rg -n "\bdefaultAccounts\b" apps/web-wallet/app | rg -v "shared/sdk|buildDefaultAccounts|cfg.defaultAccounts"
rg -n "ReadUserDefaultAccountRepository|\bReadUserRepository\b|useReadUserRepository|useWriteUserRepository|useUserService" apps/web-wallet/app | rg -v "user-(repository|service)\.ts"
rg -n "sparkWalletQueryOptions" apps/web-wallet/app | rg -v "shared/spark.ts"
rg -n "useCreateCrossAccountReceiveQuotes" apps/web-wallet/app
rg -n "\bTransactionRepository\b|useTransactionRepository" apps/web-wallet/app | rg -v "transaction-repository.ts"
```
Expected: each returns only the declaration site (or empty). If any external consumer appears, do NOT strip that one.

- [ ] **Step 2: Strip the exports**

Remove the listed symbols (and any now-unused imports they pulled — biome flags them). For `transaction-repository.ts`, remove the class + the `useTransactionRepository` factory but keep `export type Cursor = ...`. For `shared/spark.ts`, change `export const sparkWalletQueryOptions` → `const sparkWalletQueryOptions` (drop `export`).

- [ ] **Step 3: Gate.** `bun run typecheck && bun run fix:all && bun --filter=web-wallet run test` → PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(web): strip dead named exports (defaultAccounts, Read* repos, useUserService, useCryptography, sparkWalletQueryOptions export, useCreateCrossAccountReceiveQuotes, TransactionRepository class) (S15)"
```

---

### Task 12: Drop the unused `@radix-ui/react-scroll-area` dependency

**Files:**
- Modify: `apps/web-wallet/package.json`

- [ ] **Step 1: Re-confirm zero usage**

Run: `rg -n "scroll-area|ScrollArea|react-scroll-area" apps/web-wallet/app apps/web-wallet/components.json` → expect ZERO hits.

- [ ] **Step 2: Remove the dependency line** from `apps/web-wallet/package.json`, then reinstall the lockfile.

Run: `bun install`

- [ ] **Step 3: Gate.** `bun run typecheck && bun run fix:all && bun --filter=web-wallet run test` → PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web-wallet/package.json bun.lock
git commit -m "chore(web): drop unused @radix-ui/react-scroll-area dependency (S15)"
```

---

## Phase 4 — Polish + final gate

### Task 13: Minor polish (comments / JSDoc / type-spelling / test hermeticity)

**Files:**
- `apps/web-wallet/app/features/accounts/account-hooks.ts` — replace the 3 stale `getAllActive` references (the `structuralSharing` comment ~lines 118-121 and the `useAccounts` JSDoc ~lines 192-193) with `sdk.accounts.list()`; normalize `ACCOUNT_UPDATED` → `account:updated` only if that is the actual emitted event name (verify first).
- `apps/web-wallet/app/hooks/use-exchange-rate.ts` — restore the normalization JSDoc above `exchangeRatesQueryOptions` (line ~30).
- `apps/web-wallet/app/features/contacts/contact.ts` — tidy `isContact` (lines 18-22): `import type { Contact } from '@agicash/wallet-sdk'` + `export type { Contact }`, predicate `value is Contact`.
- `packages/wallet-sdk/src/internal/auth/session-expiry-scheduler.test.ts` — make the `disarm()` test (lines 96-110) inject a fixed `nowMs` instead of `Date.now()`.
- `packages/wallet-sdk/src/domains/auth/auth-domain.test.ts` — replace `Date.now()` at lines 111/249/267/348/370/391 with a fixed `NOW`/`NOW_S` constant.

- [ ] **Step 1: Apply the comment/JSDoc/type-alias edits** (account-hooks, use-exchange-rate, contact.ts) — no runtime change.
- [ ] **Step 2: Apply the test-hermeticity edits** (freeze the clock in the two SDK auth test files; the production code already accepts the injected `now`).
- [ ] **Step 3: Run to confirm green twice (determinism)**

Run: `bun --filter=@agicash/wallet-sdk run test && bun --filter=@agicash/wallet-sdk run test`
Expected: PASS both runs.

- [ ] **Step 4: Gate + commit**

```bash
bun run fix:all && bun run typecheck && bun --filter=web-wallet run test
git add apps/web-wallet/app/features/accounts/account-hooks.ts apps/web-wallet/app/hooks/use-exchange-rate.ts apps/web-wallet/app/features/contacts/contact.ts packages/wallet-sdk/src/internal/auth/session-expiry-scheduler.test.ts packages/wallet-sdk/src/domains/auth/auth-domain.test.ts
git commit -m "chore: refresh stale comments/JSDoc + freeze the clock in SDK auth tests (S15 polish)"
```

---

### Task 14: Final full-suite gate

- [ ] **Step 1: Run the whole gate from the repo root**

Run:
```bash
bun run fix:all && bun run typecheck && bun --filter=web-wallet run test && bun --filter=@agicash/wallet-sdk run test
```
Expected: `fix:all` exit 0; `typecheck` 4/4; web ≥134 pass / 0 fail; SDK ≥651 pass / 0 fail. (Counts rise from the new tests in T1/T2/T4.)

- [ ] **Step 2: Sweep for any straggler dead exports the deletions exposed**

Run (informational — biome won't flag unused exports):
```bash
rg -n "PendingCashuSendSwap" apps/web-wallet/app          # if only its own decl, prune from cashu-send-swap.ts
rg -n "ExtendedMintQuoteBolt11Response|AgicashMintExtension" apps/web-wallet/app  # prune from protocol-extensions.ts if unused
```
Strip any confirmed-unused export, re-run `fix:all`/`typecheck`, and fold into a final cleanup commit. These are low-priority — skip if uncertain.

- [ ] **Step 3: DO NOT push.** Record the slice complete in `<git-dir>/sdd/progress.md`, update the `project-wallet-sdk-nocache-track` memory + plan-of-plans row 15 → done, and leave the branch for the combined live money-path gate (F6) + user nod before the PR.

---

## Self-Review

**Spec coverage (spec §9 S15 = "delete the web's now-dead lib copies, drop unused deps, `fix:all`"):**
- Dead lib/feature copies → Tasks 7-11 (every file/export verified dead on today's tree, not the carryover list).
- Unused deps → Task 12 (`@radix-ui/react-scroll-area` only; all crypto/cashu/spark/supabase deps remain used by the un-migrated token-claim/tx-detail/feature-flags residual — documented in the SCOPE GUARD).
- `fix:all` → every task's gate + Task 14.
- Deferred carryover fixes (B1-B6 + minor polish from S13/auth/S14) → Tasks 1-6, 13.

**Placeholder scan:** every deletion task lists exact paths + a re-grep gate; every fix task shows complete before/after code. No "TBD"/"handle edge cases"/"similar to Task N".

**Type/name consistency:** `CompletedSparkLightningSendTransactionDetails` (T1), `upsertWithRetry`/`UpsertUserParams` (T2), `AuthDomainTestSeam`/`SessionExpirySchedulerDeps` (T3), `createLnurlVerifyTokenCodec` (T4), `userQueryOptions`/`UserCache.Key` (T6), `CashuLightningQuote`/`SparkLightningQuote`/`Cursor` types kept (T7/T11) — all used consistently.

**Ordering hazards encoded:** transfer-service.ts deleted **before** stripping the send-service classes (T7); `lib/timeout.ts` deleted **after** both `use-long-timeout.ts` (T10) and `melt-quote-subscription.ts` (T8) — flagged in T8's dependency note; `Ticker` re-pointed **before** the exchange-rate dir delete (T9); SDK type fix (T1) lands SDK+web together.

**Risk flags for the executor:** T6 (B4) is MEDIUM-risk auth work and may be deferred; T5 (B6) is OPTIONAL; the SCOPE GUARD forbids touching the live token-claim/tx-detail/feature-flags substrate.
