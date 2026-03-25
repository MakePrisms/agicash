# Clear Auth Wallet AuthProvider — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire cashu-ts `AuthProvider` for NUT-21 Clear Auth so all mint requests from AgiCash include an HS256 JWT obtained from Open Secret.

**Architecture:** Create a `mintAuthTokenQuery` (modeled after the existing `supabaseSessionTokenQuery`) that calls `generateThirdPartyToken("agicash-mint")`. Build an `AuthProvider` implementation backed by this query. Inject `authProvider` by default inside `getCashuWallet` and a new `getCashuMint` helper so all 11+ downstream callers are covered automatically without per-site changes.

**Tech Stack:** TypeScript, React Query (TanStack Query 5), cashu-ts 3.6.1, `@agicash/opensecret`, `jwt-decode`.

**Spec:** `../cdk/docs/superpowers/specs/2026-03-23-clear-auth-shared-secret-design.md` (Section 9)

**Prerequisite:** CDK mint must be deployed with shared secret auth enabled (see CDK implementation plan).

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `app/lib/auth/is-logged-in.ts` | Shared `isLoggedIn()` utility (extracted from `supabase-session.ts`) | **Create** |
| `app/lib/cashu/mint-auth-provider.ts` | `AuthProvider` implementation + mint auth token query | **Create** |
| `app/lib/cashu/mint-auth-provider.test.ts` | Tests for the AuthProvider | **Create** |
| `app/lib/cashu/utils.ts` | Inject `authProvider` by default in `getCashuWallet` | **Modify** |
| `app/features/shared/cashu.ts` | Use `getCashuMint` helper for `Mint` constructors | **Modify** |
| `app/lib/cashu/token.ts` | Use `getCashuWallet` instead of raw `new Wallet(...)` | **Modify** |
| `app/features/agicash-db/supabase-session.ts` | Import shared `isLoggedIn` | **Modify** |
| `app/lib/cashu/index.ts` | Re-export `getMintAuthProvider` and `getCashuMint` | **Modify** |

**No change needed** in the following files — they already use `getCashuWallet()` which will automatically get auth:
- `app/lib/cashu/melt-quote-subscription-manager.ts:56`
- `app/lib/cashu/mint-quote-subscription-manager.ts:58`
- `app/lib/cashu/melt-quote-subscription.ts:71,124`
- `app/lib/cashu/utils.ts:263` (`checkIsTestMint`)
- `app/features/send/proof-state-subscription-manager.ts:64`
- `app/features/receive/spark-receive-quote-hooks.ts:580`
- `app/features/receive/cashu-receive-quote-hooks.ts:666`
- `app/features/receive/lightning-address-service.ts:296`

---

## Task 1: Extract shared `isLoggedIn` utility

**Files:**
- Create: `app/lib/auth/is-logged-in.ts`
- Modify: `app/features/agicash-db/supabase-session.ts`

- [ ] **Step 1: Create `app/lib/auth/is-logged-in.ts`**

```typescript
import { jwtDecode } from 'jwt-decode';

/** Check if the user is logged in by verifying localStorage tokens. */
export const isLoggedIn = (): boolean => {
  const accessToken = window.localStorage.getItem('access_token');
  const refreshToken = window.localStorage.getItem('refresh_token');
  if (!accessToken || !refreshToken) {
    return false;
  }
  const decoded = jwtDecode(refreshToken);
  return !!decoded.exp && decoded.exp * 1000 > Date.now();
};
```

- [ ] **Step 2: Update `supabase-session.ts` to import from shared utility**

In `app/features/agicash-db/supabase-session.ts`, remove the local `isLoggedIn` function (lines 8-16) and replace with:

```typescript
import { isLoggedIn } from '~/lib/auth/is-logged-in';
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add app/lib/auth/is-logged-in.ts app/features/agicash-db/supabase-session.ts
git commit -m "refactor: extract shared isLoggedIn utility"
```

---

## Task 2: Create mint auth token query and `AuthProvider`

**Files:**
- Create: `app/lib/cashu/mint-auth-provider.ts`

- [ ] **Step 1: Create `app/lib/cashu/mint-auth-provider.ts`**

```typescript
import { generateThirdPartyToken } from '@agicash/opensecret';
import type { AuthProvider } from '@cashu/cashu-ts';
import type { FetchQueryOptions } from '@tanstack/react-query';
import { jwtDecode } from 'jwt-decode';
import { isLoggedIn } from '~/lib/auth/is-logged-in';
import { getQueryClient } from '~/features/shared/query-client';

const queryClient = getQueryClient();

/**
 * React Query options for the mint auth token (CAT).
 * Calls generateThirdPartyToken with audience "agicash-mint".
 * Token is refreshed 5 seconds before expiry, matching the Supabase token pattern.
 */
export const mintAuthTokenQuery = (): FetchQueryOptions<string | null> => ({
  queryKey: ['mint-auth-token'],
  queryFn: async () => {
    if (!isLoggedIn()) {
      return null;
    }
    const response = await generateThirdPartyToken('agicash-mint');
    return response.token;
  },
  staleTime: ({ state: { data } }) => {
    if (!data) {
      return 0;
    }

    const decoded = jwtDecode(data);

    if (!decoded.exp) {
      return 0;
    }

    const fiveSecondsBeforeExpirationInMs = (decoded.exp - 5) * 1000;
    const now = Date.now();
    const msToExpiration = fiveSecondsBeforeExpirationInMs - now;

    return Math.max(msToExpiration, 0);
  },
});

/** Fetch a fresh or cached mint auth token. */
export const getMintAuthToken = (): Promise<string | null> =>
  queryClient.fetchQuery(mintAuthTokenQuery());

/**
 * Returns a cashu-ts AuthProvider for NUT-21 Clear Auth.
 * Token lifecycle is managed by React Query with automatic refresh before expiry.
 */
export function getMintAuthProvider(): AuthProvider {
  let cachedToken: string | undefined;

  return {
    getCAT: () => cachedToken,
    setCAT: (cat: string | undefined) => {
      cachedToken = cat;
    },
    ensureCAT: async () => {
      const token = await getMintAuthToken();
      if (token) {
        cachedToken = token;
      }
      return cachedToken;
    },
    getBlindAuthToken: async (_input: {
      method: 'GET' | 'POST';
      path: string;
    }) => {
      throw new Error('Blind auth is not supported');
    },
  };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add app/lib/cashu/mint-auth-provider.ts
git commit -m "feat: add mint AuthProvider with React Query token management"
```

---

## Task 3: Write tests for the AuthProvider

**Files:**
- Create: `app/lib/cashu/mint-auth-provider.test.ts`

- [ ] **Step 1: Create test file**

```typescript
import { describe, expect, it } from 'bun:test';
import { getMintAuthProvider } from './mint-auth-provider';

describe('getMintAuthProvider', () => {
  it('getCAT returns undefined initially', () => {
    const provider = getMintAuthProvider();
    expect(provider.getCAT()).toBeUndefined();
  });

  it('setCAT caches the token', () => {
    const provider = getMintAuthProvider();
    provider.setCAT('test-token');
    expect(provider.getCAT()).toBe('test-token');
  });

  it('setCAT(undefined) clears the cached token', () => {
    const provider = getMintAuthProvider();
    provider.setCAT('test-token');
    provider.setCAT(undefined);
    expect(provider.getCAT()).toBeUndefined();
  });

  it('getBlindAuthToken throws', async () => {
    const provider = getMintAuthProvider();
    await expect(
      provider.getBlindAuthToken({ method: 'POST', path: '/v1/swap' }),
    ).rejects.toThrow('Blind auth is not supported');
  });

  it('each call returns an independent provider', () => {
    const p1 = getMintAuthProvider();
    const p2 = getMintAuthProvider();
    p1.setCAT('token-1');
    expect(p2.getCAT()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `bun test app/lib/cashu/mint-auth-provider.test.ts`
Expected: All 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add app/lib/cashu/mint-auth-provider.test.ts
git commit -m "test: add unit tests for mint AuthProvider"
```

---

## Task 4: Inject `authProvider` by default in `getCashuWallet` and add `getCashuMint`

This is the key architectural decision: inject `authProvider` at the factory level so all 11+ callers get auth automatically.

**Files:**
- Modify: `app/lib/cashu/utils.ts` (lines 230-244)

- [ ] **Step 1: Update imports in `app/lib/cashu/utils.ts`**

Add the `getMintAuthProvider` import:
```typescript
import { getMintAuthProvider } from './mint-auth-provider';
```

Change `type Mint` to a value import (line 4) since `getCashuMint` will call `new Mint(...)`:
```typescript
  Mint,  // was: type Mint
```

- [ ] **Step 2: Inject `authProvider` in `getCashuWallet`**

Update `getCashuWallet` (lines 230-244) to inject `authProvider` by default if not explicitly provided:

```typescript
export const getCashuWallet = (
  mintUrl: string,
  options: DistributedOmit<ConstructorParameters<typeof Wallet>[1], 'unit'> & {
    unit?: CurrencyUnit;
  } = {},
) => {
  const { unit, ...rest } = options;
  const cashuUnit = options.unit === 'cent' ? 'usd' : options.unit;
  return new ExtendedCashuWallet(mintUrl, {
    authProvider: getMintAuthProvider(),
    ...rest, // caller can override authProvider if needed
    unit: cashuUnit,
  });
};
```

Note: `authProvider` is set before `...rest` so callers can override it if needed (e.g., for tests or unauthenticated contexts).

- [ ] **Step 3: Add `getCashuMint` helper**

Add a new helper for `Mint` construction (after `getCashuWallet`):

```typescript
/**
 * Create a cashu-ts Mint instance with auth provider injected.
 * Use this instead of `new Mint(url)` to ensure auth headers are sent.
 */
export const getCashuMint = (
  mintUrl: string,
  options?: ConstructorParameters<typeof Mint>[1],
): Mint => {
  return new Mint(mintUrl, {
    authProvider: getMintAuthProvider(),
    ...options,
  });
};
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add app/lib/cashu/utils.ts
git commit -m "feat: inject authProvider by default in getCashuWallet, add getCashuMint"
```

---

## Task 5: Replace raw `new Mint(...)` and `new Wallet(...)` calls

**Files:**
- Modify: `app/features/shared/cashu.ts` (lines 192, 205, 220)
- Modify: `app/lib/cashu/token.ts` (line 22)
- Modify: `app/lib/cashu/index.ts` (add re-exports)

- [ ] **Step 1: Update `app/features/shared/cashu.ts` — replace `new Mint(...)` with `getCashuMint`**

Add `getCashuMint` to the import from `~/lib/cashu`:

```typescript
import {
  type ExtendedCashuWallet,
  ExtendedMintInfo,
  checkIsTestMint,
  getCashuMint,        // <-- add
  getCashuProtocolUnit,
  getCashuUnit,
  getCashuWallet,
  sumProofs,
} from '~/lib/cashu';
```

Remove `Mint` from the cashu-ts import (line 9) since it's no longer used directly.

Update `mintInfoQueryOptions` (line 192):
```typescript
      new ExtendedMintInfo(await getCashuMint(mintUrl).getInfo()),
```

Update `allMintKeysetsQueryOptions` (line 205):
```typescript
    queryFn: async () => getCashuMint(mintUrl).getKeySets(),
```

Update `mintKeysQueryOptions` (line 220):
```typescript
    queryFn: async () => getCashuMint(mintUrl).getKeys(keysetId),
```

- [ ] **Step 2: Update `app/lib/cashu/token.ts` — use `getCashuWallet` instead of `new Wallet(...)`**

In `app/lib/cashu/token.ts` line 22, replace:
```typescript
  const wallet = new Wallet(token.mint, {
    unit: token.unit,
  });
```
with:
```typescript
  const wallet = getCashuWallet(token.mint, {
    unit: token.unit as CurrencyUnit,
  });
```

Update the imports at the top — remove `Wallet` from cashu-ts import, add `getCashuWallet` and `CurrencyUnit` import:
```typescript
import { getCashuWallet, type CurrencyUnit } from './utils';
```

(Verify `CurrencyUnit` type compatibility — `token.unit` is a string from cashu-ts, `getCashuWallet` options accept `CurrencyUnit` which may need a cast.)

- [ ] **Step 3: Update `app/lib/cashu/index.ts`**

Add re-export for `getCashuMint`:

```typescript
export { getMintAuthProvider } from './mint-auth-provider';
```

(`getCashuMint` is already re-exported via `export * from './utils'`.)

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 5: Run all tests**

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/features/shared/cashu.ts app/lib/cashu/token.ts app/lib/cashu/index.ts
git commit -m "feat: replace raw Mint/Wallet constructors with auth-injecting helpers"
```

---

## Task 6: Final verification

- [ ] **Step 1: Verify no remaining raw `new Mint(` or `new Wallet(` calls**

Search for `new Mint(` and `new Wallet(` in `app/` — the only results should be inside `utils.ts` (the `getCashuWallet`/`getCashuMint` factories) and `ExtendedCashuWallet`'s `super()` call.

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run all tests**

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 4: Lint check**

Run the project's lint command.
Expected: No lint errors.

- [ ] **Step 5: Commit cleanup if needed**

```bash
git add <specific files>
git commit -m "chore: lint and type fixes"
```
