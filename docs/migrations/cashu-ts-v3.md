# cashu-ts v2 → v3 Migration

## Context

Agicash migrated `@cashu/cashu-ts` from v2.6.0 to v3.5.0. v3 brings a cleaner API, better
type exports, and first-class support for features we had to work around in v2. The migration
deleted ~132 net lines of custom workaround code.

`@cashu/crypto@0.3.4` was removed — v3 inlines all crypto (including `hashToCurve`).

## Dependency cascade

v3 requires `@noble/curves@^2`, `@noble/hashes@^2`, `@scure/bip32@^2`, `@scure/base@^2`.

**Blocker:** `@buildonspark/spark-sdk@0.6.6` pins all noble/scure to `^1.x`. No v2-compatible
release exists. bun resolves this by nesting: cashu-ts v3 gets its own v2 copies, spark-sdk
keeps v1. No cross-library object passing between them (only bytes/hex), so this is safe.

**Strategy:** Keep top-level noble/scure at v1 for now. Upgrade to v2 later when spark-sdk
catches up. `@agicash/bc-ur` also pins `@noble/hashes@^1` — we control this and can update
it when ready.

## What v3 changes

### Class renames

| v2 | v3 |
|----|-----|
| `CashuWallet` | `Wallet` |
| `CashuMint` | `Mint` |

**Decision:** Re-export as `CashuWallet` / `CashuMint` aliases to minimize churn across the
codebase. Only the alias file and `ExtendedCashuWallet` need to reference the new names.

### Wallet construction

- v2: `new CashuWallet(new CashuMint(url), options)`
- v3: `new Wallet(url, options)` — takes a URL string, not a Mint instance
- v3: `wallet.loadMintFromCache(mintInfo, keyChainCache)` for offline init from cached data
- v3: `await wallet.loadMint()` for network init (not used in Agicash — we prefetch via TanStack Query)

**Agicash pattern (finalized):**
```ts
const wallet = getCashuWallet(mintUrl, { unit, bip39seed });
const keyChainCache = KeyChain.mintToCacheDTO(wallet.unit, mintUrl, unitKeysets, [activeKeysForUnit]);
wallet.loadMintFromCache(mintInfo.cache, keyChainCache);
```

`mintInfoQueryOptions()` returns `MintInfo` via `new MintInfo(await new Mint(mintUrl).getInfo())`.
TanStack Query handles caching. Use `mintInfo.cache` to get the raw `GetInfoResponse` for
`loadMintFromCache()`.

### Method renames

| v2 | v3 |
|----|-----|
| `wallet.getKeys(id?)` | `wallet.keyChain.getKeyset(id?)` |
| `wallet.getKeySets()` | `wallet.keyChain.getKeysets()` |
| `wallet.getActiveKeyset()` | `wallet.keyChain.getCheapestKeyset()` |
| `wallet.getAllKeys()` | `wallet.keyChain.getAllKeys()` |
| `wallet.mintProofs(...)` | `wallet.mintProofsBolt11(...)` |
| `wallet.onMintQuoteUpdates(...)` | `wallet.on.mintQuoteUpdates(...)` |
| `wallet.onMeltQuoteUpdates(...)` | `wallet.on.meltQuoteUpdates(...)` |
| `wallet.onProofStateUpdates(...)` | `wallet.on.proofStateUpdates(...)` |

### Removed APIs

- `CashuMint.getKeySets(url)` static → must instantiate `new Mint(url).getKeySets()`
- `CashuMint.getKeys(url, id)` static → must instantiate `new Mint(url).getKeys(id)`
- `wallet.keys` Map property → use `wallet.keyChain`
- `wallet.keysetId` setter → v3 manages via `KeyChain` internally

### New exports we use

| Export | Replaced | Status |
|--------|----------|--------|
| `splitAmount(value, keyset, split?, order?)` | `getOutputAmounts` dummy-seed hack in `utils.ts` | Done |
| `MintInfo` class with `.cache` getter | `getMintPurpose` `_mintInfo` unwrapping hack | Done |
| `hashToCurve` from main package | `@cashu/crypto` dependency | Done |
| `parseSecret`, `Secret`, `SecretKind`, `SecretData` | Our NUT-10 secret types in `types.ts` | Done |
| `parseP2PKSecret` | Our P2PK secret parsing | Done |
| `mintProofsBolt11(amount, quoteId: string, ...)` | Dummy `MintQuoteResponse` construction | Done |
| `KeyChain.mintToCacheDTO(unit, mintUrl, keysets, keys)` | Deprecated constructor preload options | Done |
| `wallet.loadMintFromCache(info, cache)` | Deprecated `keys`/`keysets`/`mintInfo` constructor opts | Done |
| `wallet.receive(token, config?, outputType?)` | Misuse of `wallet.send()` for token claims | Done |

### Signature changes

- `OutputData.createDeterministicData`: `number` → `AmountLike`, `MintKeys` → `T extends HasKeysetKeys`
- `splitAmount`: now takes `AmountLike` instead of `number`
- `wallet.swap` is now `wallet.send` (aliased) — different param shape
- `wallet.meltProofs` → `wallet.meltProofsBolt11` — counter/outputData moves to `OutputType` param

### Counter and keyset management (v3 internals)

v3 introduces a formal counter system via `CounterSource` interface and `WalletCounters` wrapper.
This is critical context for our migration because we persist counters to DB for idempotency.

**CounterSource interface:**
- `reserve(keysetId, n)` — atomically reserve `n` counters. `n === 0` peeks without mutating.
- `advanceToAtLeast(keysetId, minNext)` — monotonic bump (no-op if already past `minNext`)
- `setNext?(keysetId, next)` — optional hard-set for tests/migrations
- Default impl: `EphemeralCounterSource` (in-memory, starts at 0 per keyset)

**When v3 auto-increments counters:**
Only when `OutputType` is `{ type: 'deterministic', counter: 0 }` (0 is the auto-assign sentinel).
v3 calls `counterSource.reserve(keysetId, totalOutputs)` during `prepareSwapToSend`,
`prepareSwapToReceive`, `_mintProofs`, and `prepareMelt`.

**KeyChain class:**
Manages all keysets for a single unit on a single mint. Replaces the `wallet.keys` Map.
- `getKeyset(id?)` — returns `Keyset` by ID, or cheapest active if no ID
- `getCheapestKeyset()` — filters active keysets with loaded keys, returns lowest fee
- `getAllKeys()` — returns `MintKeys[]`
- `init(forceRefresh?)` — fetches from mint API, filters by unit, verifies crypto

**Keyset class:**
- `id`, `unit`, `isActive`, `fee`, `hasKeys`, `keys` (raw `Keys` record)
- `toMintKeys()` → `MintKeys | null` (the full keyset DTO)
- Satisfies `HasKeysetKeys` when keys are loaded (just needs `{ id, keys }`)

**OutputType discriminated union** (how you tell v3 what outputs to create):
- `{ type: 'random' }` — random blinding factors
- `{ type: 'deterministic', counter: N }` — N=0 auto-assigns from CounterSource, N>0 uses exact counter
- `{ type: 'custom', data: OutputData[] }` — pre-built outputs, **bypasses counter system entirely**
- `{ type: 'p2pk', options: P2PKOptions }` — P2PK locked
- `{ type: 'factory', factory: OutputDataFactory }` — custom factory

**OutputConfig** (for operations with keep + send outputs):
```
{ send: OutputType, keep?: OutputType }
```

### Counter management: our migration path

**Our current pattern (v2):** DB atomically allocates counter range in RPC → service reads
`quote.keysetCounter` → creates `OutputData.createDeterministicData(amount, seed, counter, keys, amounts)`
→ passes pre-built `OutputData` to wallet operations via `outputData` option. On retry, same counter
produces identical deterministic outputs.

**v3 equivalent:** Same pattern, but pass pre-built `OutputData` as `{ type: 'custom', data: [...] }`.
v3 uses our data verbatim and **never touches CounterSource** — no reservation, no advancement.

```typescript
// v2 (current)
wallet.swap(amount, proofs, { outputData: { keep: keepOD, send: sendOD } })
wallet.meltProofs(quote, proofs, { counter, keysetId })
wallet.mintProofs(amount, quoteResponse, { outputData })

// v3 (migration)
wallet.send(amount, proofs, config, {
  send: { type: 'custom', data: sendOD },
  keep: { type: 'custom', data: keepOD },
})
wallet.meltProofsBolt11(quote, proofs, config, { type: 'custom', data: changeOD })
wallet.mintProofsBolt11(amount, quoteId, config, { type: 'custom', data: mintOD })
```

**Counter footguns to avoid:**
1. Never use `counter: 0` — that triggers v3 auto-assign from EphemeralCounterSource
2. `wallet.send()` may try offline exact-match before swapping — always pass explicit `OutputConfig`
3. Default `EphemeralCounterSource` starts at 0 — harmless since we never let v3 auto-assign
4. If using `{ type: 'deterministic', counter: N }` (not recommended), v3 calls
   `advanceToAtLeast` on internal source — safe but unnecessary side effect

**Future option:** Implement `CounterSource` backed by our Supabase RPC for tighter v3 integration.
This would let v3 manage counter allocation during operations rather than at quote-creation time.
Not for this migration — current pattern is cleaner and preserves transactional guarantees.

## Keep vs delete map

### DELETED — v3 made these unnecessary

| Code | Location | Status |
|------|----------|--------|
| `getMintPurpose` + `_mintInfo` unwrapping | `lib/cashu/utils.ts` | Deleted |
| `getOutputAmounts` dummy-seed hack | `lib/cashu/utils.ts` | Deleted — uses `splitAmount` |
| `MintInfo` type alias (ReturnType inference) | `lib/cashu/types.ts` | Deleted — imports `MintInfo` class |
| NUT-10 secret types (`NUT10SecretSchema`, etc.) | `lib/cashu/types.ts` | Deleted — uses v3 `Secret`, `parseSecret` |
| Dummy `MintQuoteResponse` object | `receive/cashu-receive-quote-service.ts` | Deleted — passes string `quoteId` |
| `hashToCurve` from `@cashu/crypto` | `lib/cashu/proof.ts` | Deleted — imports from `@cashu/cashu-ts` |
| `@cashu/crypto` dependency | `package.json` | Removed |
| `wallet.keysetId = ...` manual assignment | `features/shared/cashu.ts` | Deleted — `loadMintFromCache` handles it |
| `wallet.send()` for token claims | `receive/cashu-receive-swap-service.ts` | Replaced with `wallet.receive()` |
| `keyset.toMintKeys()` calls | 4 service files + `utils.ts` | Replaced with direct `keyset`/`keyset.keys` |

### KEEP — app-specific logic that persists

| Code | Location | Why |
|------|----------|-----|
| `ExtendedCashuWallet` (slimmed down) | `lib/cashu/utils.ts` | Still needed for: type-cast overrides (CDK fork `fee` field), `getFeesEstimateToReceiveAtLeast`, `meltProofsIdempotent`, `seed` getter (v3 seed is still private) |
| `getCashuWallet` factory | `lib/cashu/utils.ts` | Unit translation (`cent` → `usd`), wallet construction |
| `protocol-extensions.ts` | `lib/cashu/protocol-extensions.ts` | agicash CDK fork types — permanent |
| `CashuErrorCodes` enum | `lib/cashu/error-codes.ts` | v3 still doesn't export error code constants |
| `ProofSchema` (Zod) | `lib/cashu/types.ts` | Runtime validation — cashu-ts has no Zod schemas |
| `CashuProtocolUnit` typed union | `lib/cashu/types.ts` | v3 still uses `string` for units |
| `NUT` / `NUT17WebSocketCommand` constants | `lib/cashu/types.ts` | App-level constants |
| `mint-validation.ts` | `lib/cashu/mint-validation.ts` | App-specific NUT requirements + blocklist |
| `OutputData.createDeterministicData` usage in services | `send/receive` services | Still needed for cross-page-load idempotency (adapt signature) |
| Subscription managers | `lib/cashu/`, `send/` | App-level WebSocket lifecycle (rename method calls) |
| `token.ts` utilities | `lib/cashu/token.ts` | `extractCashuToken`, `getDecodedTokenSafe`, `getUnspentProofsFromToken` |
| `payment-request.ts` | `lib/cashu/payment-request.ts` | Safe-parse wrapper |
| `getInitializedCashuWallet` | `features/shared/cashu.ts` | Offline handling + TanStack Query integration |
| `CashuCryptography` + key derivation | `features/shared/cashu.ts` | Open Secret integration |

### ADAPTED — kept with v3 changes applied

| Code | Change | Status |
|------|--------|--------|
| `ExtendedCashuWallet` | Extends `Wallet`, URL string constructor, `keyChain.getKeyset()` for fee estimation | Done |
| `getCashuWallet` factory | `new ExtendedCashuWallet(url, opts)` | Done |
| `getInitializedCashuWallet` | Uses `loadMintFromCache(mintInfo.cache, keyChainCache)` | Done |
| Static `CashuMint` calls | → `new Mint(url)` instance methods | Done |
| `wallet.getKeys(...)` calls | → `wallet.getKeyset(...)` returning `Keyset` directly | Done |
| `wallet.onXxxUpdates(...)` | → `wallet.on.xxxUpdates(...)` | Done |
| `wallet.mintProofs(...)` | → `wallet.mintProofsBolt11(...)` | Done |
| `wallet.swap(...)` | → `wallet.send(...)` with `OutputConfig` | Done |
| `wallet.meltProofs(...)` | → `wallet.meltProofsBolt11(...)` with `OutputType` | Done |
| `OutputData.createDeterministicData` | Adapted to `AmountLike` + `HasKeysetKeys` — `Keyset` satisfies directly | Done |
| `wallet.mint.webSocketConnection` | Same access pattern, v3 `Wallet` has `public readonly mint: Mint` | Done |

## Commit history (branch: `cashu-ts-v3`)

Single branch with incremental commits. Original plan called for 4 PRs but the work was
small enough to land as one.

| # | Commit | What |
|---|--------|------|
| 1 | `f45127c` | Upgrade `@cashu/cashu-ts` from v2.6.0 to v3.5.0 |
| 2 | `82933dc` | Remove `_mintInfo` unwrapping hack — use v3 `MintInfo.cache` |
| 3 | `4f94dbf` | Replace `getOutputAmounts` hack with v3 `splitAmount` |
| 4 | `759eab4` | Replace local NUT-10 secret types with cashu-ts v3 exports |
| 5 | `0866a6a` | Update deprecated cashu-ts type/method names to Bolt11 variants |
| 6 | (staged) | `loadMintFromCache` init, string `quoteId`, `wallet.receive()`, keyset cleanup |

**Verification:** `bun run fix:all` passes (zero type errors). Manual smoke test pending.

## Remaining work

See `cashu-ts-v3-todo.md` for the full checklist. Summary of what's left:

- [ ] **P2: `prepareMelt()` + `completeMelt()`** — could eliminate manual change proof
      reconstruction in `cashu-send-quote-service.ts`. Significant but valuable refactor.
- [ ] **P2: `onceMintPaid` / `onceMeltPaid`** — could simplify subscription managers for
      single-quote Lightning flows.
- [ ] **P3: `wallet.ops` builder** — optional, current positional API works.
- [ ] **P3: `KeyChainCache` consolidation** — could replace 3 TanStack Query caches with 1.
- [ ] **P3: `CounterSource` backed by Supabase** — deferred, `{ type: 'custom' }` pattern works.

See `cashu-ts-v3-api-audit.md` for the full v3 API reference and prioritized refactoring plan.

## Resolved questions

1. **`ExtendedCashuWallet` subclassing** — v3 `Wallet(url, opts)` takes URL string. `super(url, opts)` works. Constructor also accepts `keys`, `keysets`, `keysetId` in options.

2. **`wallet.keys` removal** — `getFeesEstimateToReceiveAtLeast` uses `this.keys.get(keyset.id)`. In v3: `this.keyChain.getKeyset(keyset.id).toMintKeys()`. `Keyset` also exposes `.keys` (raw `Keys` record) and `.fee` directly.

3. **`OutputData` with `HasKeysetKeys`** — `HasKeysetKeys = { id: string; keys: Keys }`. `MintKeys` has both fields, so existing calls satisfy the constraint.

4. **`wallet.mint` access** — v3 `Wallet` has `public readonly mint: Mint`. `wallet.mint.webSocketConnection` still works.

5. **Counter management** — v3's `{ type: 'custom', data: [...] }` OutputType bypasses all counter logic. Our DB-persisted counter pattern works unchanged. See "Counter management: our migration path" above.

6. **`loadMint()` vs pre-fetch** — Keep our TanStack Query pre-fetch pattern. `loadMint()` would add a network call we already avoid by injecting cached data. Our pattern is faster for returning users.

## Resolved questions

1. **NUT-10 secret migration** — Replaced our Zod types with v3's `Secret`, `SecretKind`,
   `SecretData`, `parseSecret`, `parseP2PKSecret`. Existing stored secrets parse correctly.

2. **`meltProofsIdempotent` in v3** — Works unchanged. `meltProofsBolt11` uses `OutputType`
   instead of `{ counter }` but `MintOperationError` shape is the same.

3. **`wallet.restore()` API** — Signature unchanged: `restore(start, count, config?)`.
   Internally calls `ensureKeysetKeys()`, so no manual guard needed before restore.

4. **`checkProofsStates` API** — Signature unchanged in v3.

5. **`loadMint()` vs pre-fetch** — Keep our TanStack Query pre-fetch pattern.
   `loadMint()` adds a network call we already avoid. Use `loadMintFromCache()` with
   `KeyChain.mintToCacheDTO()` to build the cache from prefetched data.

6. **`wallet.receive()` for token claims** — Adopted. Semantically correct, returns
   `Proof[]` directly (no `.send` unwrapping from `SendResponse`).
