# Cashu V2 Keyset ID Support

## Problem

Two bugs when interacting with mints that use v2 keysets (NUT-02, `01`-prefixed IDs):

1. **Pasting a v2 token shows "invalid"** — `getDecodedToken()` from cashu-ts requires keyset IDs to resolve v2 keyset IDs. Our code calls it without keyset IDs, so it always fails for v2 tokens (both cashuA and cashuB formats).

2. **Reclaiming a token fails with "Could not get fee. No keyset found"** — `getEncodedToken()` truncates v2 keyset IDs from 66 to 16 hex chars for v4 token encoding. When the token is later decoded without keyset resolution, proofs retain the short 16-char IDs. The wallet's KeyChain stores keysets by full 66-char IDs, so `getFeesForProofs()` fails on exact-match lookup.

## Background

### V1 vs V2 Keyset IDs

| Property | V1 (`00` prefix) | V2 (`01` prefix) |
|----------|-------------------|-------------------|
| Length | 16 hex chars (8 bytes) | 66 hex chars (33 bytes) |
| Derivation | SHA-256 of concatenated pubkeys, truncated to 7 bytes | SHA-256 of `{amount}:{pubkey}` pairs + unit + fee + expiry, full hash |
| Token encoding | Stored as-is (already short) | Truncated to 16 chars (short ID) in v4 tokens |

### How cashu-ts Decodes Tokens

`getDecodedToken(token, keysetIds?)` internally:
1. Strips prefix, decodes base64url/CBOR → Token with proofs
2. Runs `mapShortKeysetIds(proofs, keysetIds)` which:
   - V1 IDs (`0x00` first byte): passes through unchanged
   - V2 IDs (`0x01` first byte): prefix-matches against provided keyset IDs
   - Rejects ambiguous matches (multiple full IDs match same short ID)
   - Throws if no keyset IDs provided or no match found

This resolution step runs for ALL v2 IDs — even full-length 66-char IDs in cashuA tokens. Without keyset IDs, any token with v2 keysets fails.

### cashu-ts Utility: `getTokenMetadata(token)`

Exported function that decodes a token WITHOUT keyset resolution. Returns `{ mint, unit, amount, memo?, incompleteProofs }` where proofs lack the `id` field. Safe to call without any keyset knowledge. Used to extract the mint URL for cache lookup.

### Security of Short ID Resolution

- Keyset IDs are SHA-256 derived from public keys + metadata — unforgeable
- `mapShortKeysetIds` rejects ambiguous matches (spec requirement from NUT-02)
- Resolution uses keysets from the token's declared mint only
- The mint validates all operations server-side regardless

### Reference: cashu.me Implementation

cashu.me (PR #470) uses a two-tier decode:
- `decode()` — sync, uses `getTokenMetadata()` for UI preview (no resolution)
- `decodeFull()` — async, tries cached keyset IDs first, falls back to network fetch

## Design

### Approach: Fix at Decode Time with Dependency Injection

Keep all decode logic in `lib/cashu/token.ts` (which can only import from `@cashu/cashu-ts`). Inject keyset resolution as a callback to respect the import hierarchy (`lib` → `features` → `routes`).

### 1. Token Extraction Functions (`app/lib/cashu/token.ts`)

Three exported functions:

**`extractCashuTokenString(content: string): string | null`**

Extracts and validates a cashu token string from arbitrary content. Uses regex to find the token, then `getTokenMetadata()` to validate it's a structurally valid token (not just a regex match). Returns the raw encoded token string without full decoding. Used by paste/scan handlers to navigate with the original token string, avoiding the lossy decode-then-re-encode cycle.

```typescript
export function extractCashuTokenString(content: string): string | null {
  const tokenMatch = content.match(/cashu[AB][A-Za-z0-9_-]+={0,2}/);
  if (!tokenMatch) return null;

  try {
    getTokenMetadata(tokenMatch[0]); // validates token structure
    return tokenMatch[0];
  } catch {
    return null;
  }
}
```

**`extractCashuToken(content: string, getKeysetIds?: (mintUrl: string) => string[] | undefined): Token | null`**

Synchronous v2-aware decode with optional keyset resolver. Follows the cashu.me pattern: try standard decode first, fall back to keyset-resolved decode on failure.

Flow:
1. Extract and validate token string via `extractCashuTokenString`
2. Try `getDecodedToken(tokenString)` — succeeds for v1 keysets
3. If fails (v2 keyset), use `getTokenMetadata(tokenString)` to get mint URL without keyset resolution
4. Call injected `getKeysetIds(mintUrl)` to get cached keyset IDs
5. Decode with `getDecodedToken(tokenString, keysetIds)` for v2 resolution

If no resolver is provided or cache misses, returns null.

**`extractCashuTokenAsync(content: string, fetchKeysetIds: (mintUrl: string) => Promise<string[]>): Promise<Token | null>`**

Async variant with network fallback. Same flow but the injected resolver can fetch from the network. Used when the sync version returns null (unknown mint, cache miss).

### 2. Keyset Resolver Factory (`app/features/shared/cashu.ts`)

Provides the resolver functions that bridge `lib` and `features`:

```typescript
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
      return data.keysets.map(k => k.id);
    },
  };
}
```

`fromCache` reads synchronously from the TanStack Query cache. Keysets are already cached from wallet initialization (`getInitializedCashuWallet` calls `allMintKeysetsQueryOptions` with 1-hour staleTime).

`fromNetwork` uses `fetchQuery` which returns cached data if fresh, or fetches from the mint if stale/missing.

### 3. Paste/Scan Handlers

Four call sites: `receive-input.tsx`, `receive-scanner.tsx`, `transfer-input.tsx`, `transfer-scanner.tsx`.

Current flow (broken for v2):
```
extractCashuToken(content)  →  getEncodedToken(token)  →  navigate with hash
```

The re-encoding step is lossy: `getEncodedToken` truncates v2 keyset IDs to 16 chars. When the destination route decodes the hash, it faces the same v2 resolution problem.

New flow:
```
extractCashuTokenString(content)  →  navigate with raw string
```

No decoding or re-encoding. The raw token string preserves the original keyset ID format. Validation (is this actually a cashu token?) now happens in the destination route's clientLoader where async decode is available.

The regex `/cashu[AB][A-Za-z0-9_-]+={0,2}/` is specific enough that false positives are negligible.

### 4. Route ClientLoaders

Two call sites: `_protected.receive.cashu_.token.tsx`, `_public.receive-cashu-token.tsx`.

Both are already async (`clientLoader` is an async function). New flow:

```typescript
const queryClient = getQueryClient();
const resolver = createKeysetIdsResolver(queryClient);

// Try sync (cache hit for known mints)
let token = extractCashuToken(hash, resolver.fromCache);

// Fall back to async (network fetch for unknown mints)
if (!token) {
  token = await extractCashuTokenAsync(hash, resolver.fromNetwork);
}

if (!token) {
  throw redirect('/receive');
}
```

For the user's own mints (reclaim flow), keysets are always cached — no network request. For tokens from unknown mints, the network fetch is unavoidable but happens only once (then cached for 1 hour).

### 5. No Changes to Downstream Operations

If tokens are decoded properly at the entry points (paste/scan/route), proofs carry full v2 keyset IDs (66 chars). All downstream code — `getFeesForProofs`, `wallet.ops.receive()`, `wallet.getKeyset()` — works as-is because the KeyChain stores keysets by full ID.

No `resolveTokenKeysetIds` safety net is needed since no v2 tokens are in production yet.

### 6. Re-encoding is Intentional, Not a Bug

Several places in the app call `getEncodedToken(token)` which truncates v2 keyset IDs to 16 chars:
- `receive-cashu-token.tsx` — copy-to-clipboard and "Log In and Claim" redirect link
- `share-cashu-token.tsx` — shareable link and QR code
- `getTokenHash` — token deduplication

This truncation is correct v4 encoding behavior (short IDs for size). It is NOT a problem because every re-encoded token eventually goes through a decode step that uses our v2-aware decode with keyset resolution:
- Login redirect → protected route clientLoader → v2-aware decode
- Shared token → recipient pastes → navigate → clientLoader → v2-aware decode
- `getTokenHash` → `getEncodedToken` normalizes deterministically (same Token always produces same encoding)

### 7. Public Route Always Takes Async Path

The public route (`_public.receive-cashu-token.tsx`) runs before the user logs in, so `getInitializedCashuWallet` has never been called and the TanStack Query cache has no keyset data. For v2 tokens, `resolver.fromCache` will miss and `resolver.fromNetwork` will fetch keysets from the mint. This adds one network request to the public receive flow — acceptable since the receive UI already makes network calls (proof state checks, mint info).

### 8. Paste/Scan Validation Preserved

`extractCashuTokenString` validates tokens via `getTokenMetadata()` — not just regex. This catches malformed tokens immediately in paste/scan handlers (same UX as today: instant toast for invalid input). Only structurally valid tokens trigger navigation. Full v2 keyset resolution then happens in the destination route's async clientLoader.

## Files Changed

| File | Change |
|------|--------|
| `app/lib/cashu/token.ts` | Add `extractCashuTokenString`, `extractCashuTokenAsync`. Modify `extractCashuToken` to accept keyset resolver. Import `getTokenMetadata` from cashu-ts. |
| `app/features/shared/cashu.ts` | Add `createKeysetIdsResolver` factory function. |
| `app/routes/_protected.receive.cashu_.token.tsx` | Use async decode with resolver in clientLoader. |
| `app/routes/_public.receive-cashu-token.tsx` | Use async decode with resolver in clientLoader. |
| `app/features/receive/receive-input.tsx` | Use `extractCashuTokenString` in paste handler. Remove `getEncodedToken` re-encoding. |
| `app/features/receive/receive-scanner.tsx` | Use `extractCashuTokenString` in scan callback. Remove `getEncodedToken` re-encoding. |
| `app/features/transfer/transfer-input.tsx` | Use `extractCashuTokenString` in paste handler. Remove `getEncodedToken` re-encoding. |
| `app/features/transfer/transfer-scanner.tsx` | Use `extractCashuTokenString` in scan callback. Remove `getEncodedToken` re-encoding. |

## Testing

- Unit test `extractCashuToken` with v1 and v2 tokens (both cashuA and cashuB formats)
- Unit test `extractCashuTokenString` extracts token from various content formats
- Unit test keyset resolver returns correct IDs from mock cache
- Manual test: paste a v2 cashuB token → should decode and show receive UI
- Manual test: create and reclaim a token from a v2 keyset mint → should swap successfully
- Manual test: receive a token from an unknown v2 mint → should fetch keysets and decode
- Unit test round-trip: decode v2 token → `getEncodedToken` (truncates IDs) → decode again with resolver → should produce identical Token
