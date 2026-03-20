# Cashu V2 Keyset ID Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix token decoding to support v2 keyset IDs (NUT-02) so users can paste, receive, and reclaim tokens from mints with v2 keysets.

**Architecture:** Add v2-aware decode functions to `lib/cashu/token.ts` using dependency injection for keyset resolution. Paste/scan handlers pass raw token strings instead of decode-then-re-encode. Route clientLoaders use cache-first async decode. See `docs/superpowers/specs/2026-03-20-cashu-v2-keyset-support-design.md` for full spec.

**Tech Stack:** cashu-ts v3.6.1 (`getDecodedToken`, `getTokenMetadata`), TanStack Query v5 (keyset caching), React Router v7 (clientLoaders)

---

### Task 1: Add `extractCashuTokenString` and update `extractCashuToken`

**Files:**
- Modify: `app/lib/cashu/token.ts`
- Create: `app/lib/cashu/token.test.ts`

- [ ] **Step 1: Write failing tests for the new token functions**

Create `app/lib/cashu/token.test.ts`. We need real v1 tokens to test with. Generate them inline using cashu-ts, and mock v2 behavior via the keyset resolver.

```typescript
import { describe, expect, test } from 'bun:test';
import {
  type Token,
  getDecodedToken,
  getEncodedToken,
  getTokenMetadata,
} from '@cashu/cashu-ts';
import {
  extractCashuToken,
  extractCashuTokenAsync,
  extractCashuTokenString,
} from './token';

// A real v1 cashuA token (v1 keyset ID starts with "00")
// Generate one by encoding a minimal token:
const V1_TOKEN: Token = {
  mint: 'https://mint.example.com',
  proofs: [
    {
      id: '009a1f293253e41e',
      amount: 1,
      secret: 'test-secret-1',
      C: '02698c4e2b5f9534cd0687d87513c759790cf829aa5739184a3e3735471fbda904',
    },
  ],
  unit: 'sat',
};

const V1_ENCODED_A = getEncodedToken(V1_TOKEN, { version: 3 });
const V1_ENCODED_B = getEncodedToken(V1_TOKEN, { version: 4 });

describe('extractCashuTokenString', () => {
  test('extracts a valid cashuA token string from content', () => {
    const result = extractCashuTokenString(`check this out: ${V1_ENCODED_A}`);
    expect(result).toBe(V1_ENCODED_A);
  });

  test('extracts a valid cashuB token string from content', () => {
    const result = extractCashuTokenString(`here: ${V1_ENCODED_B}`);
    expect(result).toBe(V1_ENCODED_B);
  });

  test('returns null for content with no token', () => {
    expect(extractCashuTokenString('hello world')).toBeNull();
  });

  test('returns null for malformed token that matches regex but fails metadata parse', () => {
    expect(extractCashuTokenString('cashuBinvaliddata')).toBeNull();
  });

  test('extracts token from URL with hash', () => {
    const result = extractCashuTokenString(`#${V1_ENCODED_B}`);
    expect(result).toBe(V1_ENCODED_B);
  });
});

describe('extractCashuToken', () => {
  test('decodes a v1 cashuA token without a resolver', () => {
    const token = extractCashuToken(V1_ENCODED_A);
    expect(token).not.toBeNull();
    expect(token!.mint).toBe('https://mint.example.com');
    expect(token!.proofs[0].id).toBe('009a1f293253e41e');
  });

  test('decodes a v1 cashuB token without a resolver', () => {
    const token = extractCashuToken(V1_ENCODED_B);
    expect(token).not.toBeNull();
    expect(token!.mint).toBe('https://mint.example.com');
  });

  test('returns null for invalid content', () => {
    expect(extractCashuToken('not a token')).toBeNull();
  });

  test('does not call resolver for v1 tokens', () => {
    const calls: string[] = [];
    const resolver = (mintUrl: string) => {
      calls.push(mintUrl);
      return undefined;
    };
    extractCashuToken(V1_ENCODED_A, resolver);
    expect(calls).toHaveLength(0);
  });
});

// V2 keyset ID tests — exercise the resolver fallback path.
// We construct tokens with a fake v2 keyset ID (prefix "01", 66 hex chars).
// getDecodedToken(token) will fail for these, triggering the resolver.
const V2_KEYSET_ID = '01' + 'a'.repeat(64); // 66 chars, v2 format

const V2_TOKEN: Token = {
  mint: 'https://v2mint.example.com',
  proofs: [
    {
      id: V2_KEYSET_ID,
      amount: 1,
      secret: 'test-secret-v2',
      C: '02698c4e2b5f9534cd0687d87513c759790cf829aa5739184a3e3735471fbda904',
    },
  ],
  unit: 'sat',
};

// cashuA preserves full keyset IDs in the JSON
const V2_ENCODED_A = getEncodedToken(V2_TOKEN, { version: 3 });
// cashuB truncates v2 keyset IDs to 16 chars (short ID)
const V2_ENCODED_B = getEncodedToken(V2_TOKEN, { version: 4 });

describe('extractCashuToken with v2 keyset IDs', () => {
  test('returns null for v2 token without resolver', () => {
    expect(extractCashuToken(V2_ENCODED_A)).toBeNull();
  });

  test('decodes v2 cashuA token with resolver providing full keyset ID', () => {
    const resolver = (mintUrl: string) => {
      expect(mintUrl).toBe('https://v2mint.example.com');
      return [V2_KEYSET_ID];
    };

    const token = extractCashuToken(V2_ENCODED_A, resolver);
    expect(token).not.toBeNull();
    expect(token!.mint).toBe('https://v2mint.example.com');
    expect(token!.proofs[0].id).toBe(V2_KEYSET_ID);
  });

  test('decodes v2 cashuB token (short ID) with resolver', () => {
    const resolver = (_mintUrl: string) => [V2_KEYSET_ID];

    const token = extractCashuToken(V2_ENCODED_B, resolver);
    expect(token).not.toBeNull();
    expect(token!.proofs[0].id).toBe(V2_KEYSET_ID); // resolved to full ID
  });

  test('returns null when resolver returns no matching keysets', () => {
    const resolver = (_mintUrl: string) => ['00deadbeefcafe00']; // wrong keyset
    expect(extractCashuToken(V2_ENCODED_A, resolver)).toBeNull();
  });
});

describe('extractCashuToken v2 round-trip', () => {
  test('decode v2 → encode (truncates) → decode with resolver → same token', () => {
    // Decode the original v2 cashuA token (full IDs)
    const resolver = (_mintUrl: string) => [V2_KEYSET_ID];
    const original = extractCashuToken(V2_ENCODED_A, resolver);
    expect(original).not.toBeNull();

    // Re-encode: getEncodedToken truncates v2 IDs to 16 chars (cashuB format)
    const reEncoded = getEncodedToken(original!);

    // Decode the re-encoded token — needs resolver to resolve short IDs
    const roundTripped = extractCashuToken(reEncoded, resolver);
    expect(roundTripped).not.toBeNull();
    expect(roundTripped!.mint).toBe(original!.mint);
    expect(roundTripped!.proofs[0].id).toBe(V2_KEYSET_ID);
    expect(roundTripped!.proofs[0].amount).toBe(original!.proofs[0].amount);
  });
});

describe('extractCashuTokenAsync', () => {
  test('decodes a v1 token without fetching', async () => {
    const fetcher = async (_mintUrl: string) => {
      throw new Error('should not be called for v1');
    };
    const token = await extractCashuTokenAsync(V1_ENCODED_A, fetcher);
    expect(token).not.toBeNull();
    expect(token!.mint).toBe('https://mint.example.com');
  });

  test('decodes a v2 token by fetching keyset IDs', async () => {
    const fetcher = async (mintUrl: string) => {
      expect(mintUrl).toBe('https://v2mint.example.com');
      return [V2_KEYSET_ID];
    };
    const token = await extractCashuTokenAsync(V2_ENCODED_B, fetcher);
    expect(token).not.toBeNull();
    expect(token!.proofs[0].id).toBe(V2_KEYSET_ID);
  });

  test('returns null for invalid content', async () => {
    const fetcher = async (_mintUrl: string) => [];
    const token = await extractCashuTokenAsync('not a token', fetcher);
    expect(token).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test app/lib/cashu/token.test.ts`
Expected: FAIL — `extractCashuTokenString` and `extractCashuTokenAsync` are not exported from `./token`.

- [ ] **Step 3: Implement the token functions**

Replace the contents of `app/lib/cashu/token.ts` with:

```typescript
import {
  CheckStateEnum,
  type Proof,
  type Token,
  Wallet,
  getDecodedToken,
  getTokenMetadata,
} from '@cashu/cashu-ts';
import { proofToY } from './proof';

/**
 * A token consists of a set of proofs, and each proof can be in one of three states:
 * spent, pending, or unspent. When claiming a token, all that we care about is the unspent proofs.
 * The rest of the proofs will not be claimable.
 *
 * This function returns the set of proofs that are unspent
 * @param token - The token to get the unspent proofs from
 * @returns The set of unspent proofs
 */
export const getUnspentProofsFromToken = async (
  token: Token,
): Promise<Proof[]> => {
  const wallet = new Wallet(token.mint, {
    unit: token.unit,
  });
  const states = await wallet.checkProofsStates(token.proofs);

  return token.proofs.filter((proof) => {
    const Y = proofToY(proof);
    const state = states.find((s) => s.Y === Y);
    return state?.state === CheckStateEnum.UNSPENT;
  });
};

const TOKEN_REGEX = /cashu[AB][A-Za-z0-9_-]+={0,2}/;

/**
 * Extract and validate a cashu token string from arbitrary content.
 * Uses regex to find the token, then getTokenMetadata() to validate it's structurally valid.
 * Returns the raw encoded string without full decoding (no keyset resolution).
 * @param content - The content to search for a cashu token (URL, clipboard text, etc.)
 * @returns The encoded token string if found and valid, otherwise null.
 */
export function extractCashuTokenString(content: string): string | null {
  const tokenMatch = content.match(TOKEN_REGEX);
  if (!tokenMatch) return null;

  try {
    getTokenMetadata(tokenMatch[0]);
    return tokenMatch[0];
  } catch {
    return null;
  }
}

/**
 * Extract and decode a cashu token from arbitrary content.
 * Supports both v1 and v2 keyset IDs. For v2, an optional keyset resolver is used
 * to map short keyset IDs to full IDs (cashu.me pattern: try without, fall back with).
 *
 * @param content - The content to extract the encoded cashu token from.
 * @param getKeysetIds - Optional sync resolver: given a mint URL, returns keyset IDs from cache.
 *   Used to resolve v2 short keyset IDs. If not provided, only v1 tokens can be decoded.
 * @returns The decoded token if found and valid, otherwise null.
 */
export function extractCashuToken(
  content: string,
  getKeysetIds?: (mintUrl: string) => string[] | undefined,
): Token | null {
  const tokenString = extractCashuTokenString(content);
  if (!tokenString) return null;

  // Try standard decode — succeeds for v1 keyset IDs
  try {
    return getDecodedToken(tokenString);
  } catch {
    // V2 keyset IDs require resolution — fall through
  }

  // V2 fallback: get mint URL from metadata, resolve keyset IDs, retry
  if (!getKeysetIds) return null;

  try {
    const { mint } = getTokenMetadata(tokenString);
    const keysetIds = getKeysetIds(mint);
    if (!keysetIds?.length) return null;
    return getDecodedToken(tokenString, keysetIds);
  } catch {
    return null;
  }
}

/**
 * Async variant of extractCashuToken with network fallback.
 * Tries standard decode first (v1), then fetches keyset IDs from the mint for v2 resolution.
 *
 * @param content - The content to extract the encoded cashu token from.
 * @param fetchKeysetIds - Async resolver: given a mint URL, fetches keyset IDs (cache-first via TanStack Query).
 * @returns The decoded token if found and valid, otherwise null.
 */
export async function extractCashuTokenAsync(
  content: string,
  fetchKeysetIds: (mintUrl: string) => Promise<string[]>,
): Promise<Token | null> {
  const tokenString = extractCashuTokenString(content);
  if (!tokenString) return null;

  // Try standard decode — succeeds for v1 keyset IDs
  try {
    return getDecodedToken(tokenString);
  } catch {
    // V2 keyset IDs require resolution — fall through
  }

  // V2 fallback: get mint URL from metadata, fetch keyset IDs, retry
  try {
    const { mint } = getTokenMetadata(tokenString);
    const keysetIds = await fetchKeysetIds(mint);
    if (!keysetIds.length) return null;
    return getDecodedToken(tokenString, keysetIds);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test app/lib/cashu/token.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Run typecheck**

Run: `bun run fix:all`
Expected: No type errors related to token.ts changes.

- [ ] **Step 6: Commit**

```bash
git add app/lib/cashu/token.ts app/lib/cashu/token.test.ts
git commit -m "feat: add v2 keyset support to token extraction functions

Add extractCashuTokenString (validates via getTokenMetadata) and
extractCashuTokenAsync (network fallback). Update extractCashuToken
to accept optional keyset resolver for v2 short ID resolution."
```

---

### Task 2: Add keyset resolver factory

**Files:**
- Modify: `app/features/shared/cashu.ts`

- [ ] **Step 1: Add `createKeysetIdsResolver` to `app/features/shared/cashu.ts`**

Add this function after the existing `allMintKeysetsQueryOptions` definition (around line 207). Import `GetKeysetsResponse` from cashu-ts if not already imported.

```typescript
/**
 * Creates keyset ID resolver functions for v2 token decoding.
 * The sync resolver reads from TanStack Query cache (no network).
 * The async resolver uses fetchQuery (returns cached if fresh, fetches if stale/missing).
 */
export function createKeysetIdsResolver(queryClient: QueryClient) {
  return {
    fromCache: (mintUrl: string): string[] | undefined => {
      const data = queryClient.getQueryData<GetKeysetsResponse>(
        allMintKeysetsQueryKey(mintUrl),
      );
      return data?.keysets.map((k) => k.id);
    },
    fromNetwork: async (mintUrl: string): Promise<string[]> => {
      const data = await queryClient.fetchQuery(
        allMintKeysetsQueryOptions(mintUrl),
      );
      return data.keysets.map((k) => k.id);
    },
  };
}
```

Verify that `GetKeysetsResponse` is already imported from cashu-ts (it's at line 6 of the existing imports). No new import needed.

- [ ] **Step 2: Run typecheck**

Run: `bun run fix:all`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add app/features/shared/cashu.ts
git commit -m "feat: add createKeysetIdsResolver for v2 token decode

Bridges lib/cashu (token decode) and features (TanStack Query cache).
Sync resolver reads cached keysets, async resolver fetches from mint."
```

---

### Task 3: Update paste/scan handlers to use `extractCashuTokenString`

**Files:**
- Modify: `app/features/receive/receive-input.tsx`
- Modify: `app/features/receive/receive-scanner.tsx`
- Modify: `app/features/transfer/transfer-input.tsx`
- Modify: `app/features/transfer/transfer-scanner.tsx`

All four files follow the same pattern: replace `extractCashuToken` + `getEncodedToken` with `extractCashuTokenString`.

- [ ] **Step 1: Update `app/features/receive/receive-input.tsx`**

Change the import at line 25 from:
```typescript
import { extractCashuToken } from '~/lib/cashu';
```
to:
```typescript
import { extractCashuTokenString } from '~/lib/cashu';
```

Remove the `getEncodedToken` import from `@cashu/cashu-ts` at line 1 (it's no longer needed in this file).

Replace the `handlePaste` body (lines 88-118) with:

```typescript
  const handlePaste = async () => {
    const clipboardContent = await readClipboard();
    if (!clipboardContent) {
      return;
    }

    const tokenString = extractCashuTokenString(clipboardContent);
    if (!tokenString) {
      toast({
        title: 'Invalid input',
        description: 'Please paste a valid cashu token',
        variant: 'destructive',
      });
      return;
    }

    const hash = `#${tokenString}`;

    // The hash needs to be set manually before navigating or clientLoader of the destination route won't see it
    // See https://github.com/remix-run/remix/discussions/10721
    window.history.replaceState(null, '', hash);
    navigate(
      {
        ...buildLinkWithSearchParams('/receive/cashu/token', {
          selectedAccountId: receiveAccountId,
        }),
        hash,
      },
      { transition: 'slideLeft', applyTo: 'newView' },
    );
  };
```

- [ ] **Step 2: Update `app/features/receive/receive-scanner.tsx`**

Change the import at line 11 from:
```typescript
import { extractCashuToken } from '~/lib/cashu';
```
to:
```typescript
import { extractCashuTokenString } from '~/lib/cashu';
```

Remove the `getEncodedToken` import from `@cashu/cashu-ts` at line 1.

Replace the `onDecode` callback body (lines 33-58) with:

```typescript
          onDecode={(scannedContent) => {
            const tokenString = extractCashuTokenString(scannedContent);
            if (!tokenString) {
              toast({
                title: 'Invalid input',
                description: 'Please scan a valid cashu token',
                variant: 'destructive',
              });
              return;
            }

            const hash = `#${tokenString}`;

            // The hash needs to be set manually before navigating or clientLoader of the destination route won't see it
            // See https://github.com/remix-run/remix/discussions/10721
            window.history.replaceState(null, '', hash);
            navigate(
              {
                ...buildLinkWithSearchParams('/receive/cashu/token', {
                  selectedAccountId: receiveAccountId,
                }),
                hash,
              },
              { transition: 'slideLeft', applyTo: 'newView' },
            );
          }}
```

- [ ] **Step 3: Update `app/features/transfer/transfer-input.tsx`**

Same pattern. Change import at line 23 from `extractCashuToken` to `extractCashuTokenString`. Remove `getEncodedToken` import from `@cashu/cashu-ts` at line 1.

In the `handlePaste` function (around line 107-135), replace:
```typescript
    const token = extractCashuToken(clipboardContent);
    if (!token) {
```
with:
```typescript
    const tokenString = extractCashuTokenString(clipboardContent);
    if (!tokenString) {
```

And replace:
```typescript
    const encodedToken = getEncodedToken(token);
    const hash = `#${encodedToken}`;
```
with:
```typescript
    const hash = `#${tokenString}`;
```

- [ ] **Step 4: Update `app/features/transfer/transfer-scanner.tsx`**

Same pattern. Change import at line 11 from `extractCashuToken` to `extractCashuTokenString`. Remove `getEncodedToken` import from `@cashu/cashu-ts` at line 1.

Replace lines 34-42:
```typescript
            const token = extractCashuToken(scannedContent);
            if (!token) {
```
with:
```typescript
            const tokenString = extractCashuTokenString(scannedContent);
            if (!tokenString) {
```

Replace lines 44-45:
```typescript
            const encodedToken = getEncodedToken(token);
            const hash = `#${encodedToken}`;
```
with:
```typescript
            const hash = `#${tokenString}`;
```

- [ ] **Step 5: Run typecheck**

Run: `bun run fix:all`
Expected: No errors. Verify that `getEncodedToken` import is removed from all four files and no unused imports remain.

- [ ] **Step 6: Commit**

```bash
git add app/features/receive/receive-input.tsx app/features/receive/receive-scanner.tsx app/features/transfer/transfer-input.tsx app/features/transfer/transfer-scanner.tsx
git commit -m "refactor: pass raw token strings in paste/scan handlers

Replace extractCashuToken + getEncodedToken with extractCashuTokenString.
Avoids lossy decode-then-re-encode cycle that truncates v2 keyset IDs.
Token validation preserved via getTokenMetadata in extractCashuTokenString."
```

---

### Task 4: Update route clientLoaders with v2-aware decode

**Files:**
- Modify: `app/routes/_protected.receive.cashu_.token.tsx`
- Modify: `app/routes/_public.receive-cashu-token.tsx`

- [ ] **Step 1: Update protected route clientLoader**

In `app/routes/_protected.receive.cashu_.token.tsx`:

Change the import at line 33 from:
```typescript
import { extractCashuToken } from '~/lib/cashu';
```
to:
```typescript
import { extractCashuToken, extractCashuTokenAsync } from '~/lib/cashu';
```

Add import for the resolver factory:
```typescript
import { createKeysetIdsResolver } from '~/features/shared/cashu';
```

Also import `getQueryClient` if not already imported (it is imported on line 27 via `~/features/shared/query-client`).

Replace lines 108-114 (the token extraction in clientLoader) with:

```typescript
export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const queryClient = getQueryClient();
  const resolver = createKeysetIdsResolver(queryClient);

  // Request url doesn't include hash so we need to read it from the window location instead
  let token = extractCashuToken(window.location.hash, resolver.fromCache);

  if (!token) {
    token = await extractCashuTokenAsync(
      window.location.hash,
      resolver.fromNetwork,
    );
  }

  if (!token) {
    throw redirect('/receive');
  }
```

The rest of the function (lines 116 onward) stays the same.

- [ ] **Step 2: Update public route clientLoader**

In `app/routes/_public.receive-cashu-token.tsx`:

Change the import at line 7 from:
```typescript
import { extractCashuToken } from '~/lib/cashu';
```
to:
```typescript
import { extractCashuToken, extractCashuTokenAsync } from '~/lib/cashu';
```

Add import:
```typescript
import { createKeysetIdsResolver } from '~/features/shared/cashu';
```

Replace lines 23-27 (the token extraction) with:

```typescript
  const resolver = createKeysetIdsResolver(queryClient);

  let token = extractCashuToken(hash, resolver.fromCache);

  if (!token) {
    token = await extractCashuTokenAsync(hash, resolver.fromNetwork);
  }

  if (!token) {
    throw redirect('/home');
  }
```

Note: `queryClient` is already available from line 14.

- [ ] **Step 3: Run typecheck**

Run: `bun run fix:all`
Expected: No errors.

- [ ] **Step 4: Run all tests**

Run: `bun test`
Expected: All tests pass, including the new token tests from Task 1.

- [ ] **Step 5: Commit**

```bash
git add app/routes/_protected.receive.cashu_.token.tsx app/routes/_public.receive-cashu-token.tsx
git commit -m "feat: use v2-aware token decode in route clientLoaders

Try sync cache-first decode, fall back to async network fetch for
unknown mints. Completes v2 keyset ID support for receive flows."
```
