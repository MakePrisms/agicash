# cashu-ts v2 → v3 Migration

## Context

Agicash uses `@cashu/cashu-ts@2.6.0` for all Cashu protocol operations. v3 (`3.5.0`) brings
a cleaner API, better type exports, and first-class support for features we had to work around
in v2. This migration should **delete and simplify** significant custom code.

Also installed: `@cashu/crypto@0.3.4` (used only for `hashToCurve`). v3 inlines this — the
separate package can be removed.

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
- v3: `await wallet.loadMint()` to complete initialization (fetches info, keysets, keys)

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

### New exports we can use

| Export | Replaces |
|--------|----------|
| `splitAmount(value, keyset, split?, order?)` | `getOutputAmounts` dummy-seed hack in `utils.ts` |
| `MintInfo` class with `.cache` getter | `getMintPurpose` `_mintInfo` unwrapping hack |
| `hashToCurve` from main package | `@cashu/crypto` dependency |
| `parseSecret`, `Secret`, `SecretKind`, `SecretData` | Our NUT-10 secret types in `types.ts` |
| `parseP2PKSecret` | Our P2PK secret parsing |
| `mintProofsBolt11(amount, quoteId: string, ...)` | Dummy `MintQuoteResponse` construction |

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

### DELETE — v3 makes these unnecessary

| Code | Location | Why deletable |
|------|----------|---------------|
| `getMintPurpose` + `_mintInfo` unwrapping | `lib/cashu/utils.ts` | v3 `MintInfo.cache` exposes raw `GetInfoResponse` |
| `getOutputAmounts` dummy-seed hack | `lib/cashu/utils.ts` | v3 exports `splitAmount` |
| `MintInfo` type alias (ReturnType inference) | `lib/cashu/types.ts` | v3 exports `MintInfo` as named class |
| `NUT10SecretSchema`, `RawNUT10SecretSchema`, `NUT10Secret`, `RawNUT10Secret`, `P2PKSecret`, `PlainSecret`, `ProofSecret` | `lib/cashu/types.ts` | v3 exports `Secret`, `SecretKind`, `SecretData`, `parseSecret`, `parseP2PKSecret` |
| Dummy `MintQuoteResponse` object in `mintProofs` | `receive/cashu-receive-quote-service.ts` | v3 `mintProofsBolt11` accepts `string` quote ID directly |
| `hashToCurve` import from `@cashu/crypto` | `lib/cashu/proof.ts` | v3 exports `hashToCurve` from main package |
| `@cashu/crypto` dependency | `package.json` | cashu-ts v3 inlines all crypto |
| `wallet.keysetId = ...` manual assignment | `features/shared/cashu.ts` | v3 `KeyChain` auto-selects when keys/keysets passed to constructor |

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

### ADAPT — keep but must change

| Code | Change needed |
|------|---------------|
| `ExtendedCashuWallet` | Extend `Wallet` instead of `CashuWallet`. Constructor takes URL string. `getFeesEstimateToReceiveAtLeast` must use `keyChain.getKeyset(id).toMintKeys()` instead of `this.keys.get(id)` Map |
| `getCashuWallet` factory | `new ExtendedCashuWallet(url, opts)` instead of `new ExtendedCashuWallet(new CashuMint(url), opts)` |
| `getInitializedCashuWallet` | New construction pattern (URL string). Remove manual `keysetId` assignment — KeyChain auto-selects when keys/keysets passed. Keep TanStack Query pre-fetch (faster than `loadMint()`) |
| Static `CashuMint.getKeySets/getKeys` calls | Instantiate `new Mint(url)` then call instance methods (2 calls in `shared/cashu.ts`) |
| All `wallet.getKeys(...)` calls | → `wallet.keyChain.getKeyset(...)` — returns `Keyset` with `.toMintKeys()` for `MintKeys` (10+ calls in 4 service files) |
| All `wallet.onXxxUpdates(...)` calls | → `wallet.on.xxxUpdates(...)` (3 subscription managers) |
| `wallet.mintProofs(...)` calls | → `wallet.mintProofsBolt11(...)` |
| `wallet.swap(amount, proofs, { outputData })` | → `wallet.send(amount, proofs, config, { send: { type: 'custom', data }, keep: { type: 'custom', data } })` |
| `wallet.meltProofs(quote, proofs, { counter })` | → `wallet.meltProofsBolt11(quote, proofs, config, { type: 'custom', data: changeOutputData })` |
| `OutputData.createDeterministicData` calls | Adapt to `AmountLike` + `HasKeysetKeys` generic — `MintKeys` satisfies `HasKeysetKeys` (has `id` + `keys`), so existing calls likely work with minimal changes (4 service files) |
| `wallet.mint.webSocketConnection` access | v3 `Wallet` has `public readonly mint: Mint` — same access pattern, class name changed (3 subscription managers) |

## Files changed (by PR)

### PR 1: Prep — no cashu-ts version change

Version-independent restructuring to make the upgrade PR cleaner.

- [ ] Audit `@cashu/crypto` usage — confirm only `hashToCurve` is imported
- [ ] Check if any code depends on noble/scure v1-specific APIs that would break with nested v2

### PR 2: Bump cashu-ts + mechanical fixes

Bump `@cashu/cashu-ts` from `2.6.0` to `^3.5.0`. Every change is a direct API adaptation —
no behavior changes, no deletions.

**Core layer (`lib/cashu/`):**
- [ ] `utils.ts` — `ExtendedCashuWallet` extends `Wallet`, constructor takes URL string, add re-export aliases (`export { Wallet as CashuWallet }` etc.), adapt `getFeesEstimateToReceiveAtLeast` from `this.keys` Map to `keyChain`, update `getOutputAmounts` to use new `splitAmount` (or adapt `OutputData` signature)
- [ ] `types.ts` — Replace `MintInfo` alias with import from cashu-ts
- [ ] `token.ts` — Update `CashuWallet`/`CashuMint` references to use aliases, update `checkProofsStates` if API changed
- [ ] `proof.ts` — Switch `hashToCurve` import from `@cashu/crypto` to `@cashu/cashu-ts`
- [ ] `mint-quote-subscription-manager.ts` — `wallet.onMintQuoteUpdates(...)` → `wallet.on.mintQuoteUpdates(...)`
- [ ] `melt-quote-subscription-manager.ts` — `wallet.onMeltQuoteUpdates(...)` → `wallet.on.meltQuoteUpdates(...)`
- [ ] `melt-quote-subscription.ts` — Update any direct cashu-ts type references

**Feature layer:**
- [ ] `features/shared/cashu.ts` — Replace static `CashuMint.getKeySets/getKeys` with Mint instance methods, update `getInitializedCashuWallet` construction pattern, remove manual `keysetId` assignment
- [ ] `features/send/cashu-send-quote-service.ts` — `wallet.getKeys()` → `wallet.keyChain.getKeyset()`, adapt `OutputData.createDeterministicData` signature
- [ ] `features/send/cashu-send-swap-service.ts` — Same
- [ ] `features/receive/cashu-receive-quote-service.ts` — Same + `wallet.mintProofs` → `wallet.mintProofsBolt11`, remove dummy `MintQuoteResponse` construction
- [ ] `features/receive/cashu-receive-swap-service.ts` — Same
- [ ] `features/send/proof-state-subscription-manager.ts` — `wallet.onProofStateUpdates(...)` → `wallet.on.proofStateUpdates(...)`

**Package:**
- [ ] `package.json` — Bump `@cashu/cashu-ts`, remove `@cashu/crypto`
- [ ] Run `bun install`, verify bun resolves noble/scure v1 + v2 cleanly

**Verification:**
- [ ] `bun run fix:all` passes
- [ ] `bun test` passes
- [ ] Manual smoke test: send, receive, swap flows

### PR 3: Simplify — delete workarounds v3 makes unnecessary

Each commit removes one workaround. No behavior changes — just less code.

- [ ] **Remove `_mintInfo` unwrapping** — `getMintPurpose` uses `MintInfo.cache` instead of recursive private field access. Delete the unwrapping helper.
- [ ] **Remove `getOutputAmounts` hack** — Replace with direct `splitAmount` call. Delete the dummy-seed `OutputData.createDeterministicData` usage for denomination calculation.
- [ ] **Replace NUT-10 secret types** — Use v3's `Secret`, `SecretKind`, `SecretData`, `parseSecret`, `parseP2PKSecret`. Delete `NUT10SecretSchema`, `RawNUT10SecretSchema`, and related local types. Update consumers in `proof.ts`, `secret.ts`, and anywhere secrets are parsed.
- [ ] **Remove dummy `MintQuoteResponse`** — Pass quote ID string directly to `mintProofsBolt11`.
- [ ] **Remove `@cashu/crypto` import** — `hashToCurve` from `@cashu/cashu-ts` directly.
- [ ] **Remove manual `keysetId` assignment** — Verify KeyChain auto-selection works, then delete the assignment in `getInitializedCashuWallet`.

**Verification:**
- [ ] `bun run fix:all` passes
- [ ] `bun test` passes

### PR 4 (optional): Adopt v3 patterns

Opportunities to use v3's improved APIs beyond just fixing breakage.

- [ ] Use `wallet.ops` fluent builder where it simplifies P2PK/send operations
- [ ] Use `KeyChain` methods more idiomatically
- [ ] Evaluate `WalletEvents` higher-level subscription helpers (`onceMintPaid`, `onceMeltPaid`) vs our subscription managers
- [ ] Evaluate if `loadMint()` can replace our manual pre-fetch + inject pattern in `getInitializedCashuWallet`

## Resolved questions

1. **`ExtendedCashuWallet` subclassing** — v3 `Wallet(url, opts)` takes URL string. `super(url, opts)` works. Constructor also accepts `keys`, `keysets`, `keysetId` in options.

2. **`wallet.keys` removal** — `getFeesEstimateToReceiveAtLeast` uses `this.keys.get(keyset.id)`. In v3: `this.keyChain.getKeyset(keyset.id).toMintKeys()`. `Keyset` also exposes `.keys` (raw `Keys` record) and `.fee` directly.

3. **`OutputData` with `HasKeysetKeys`** — `HasKeysetKeys = { id: string; keys: Keys }`. `MintKeys` has both fields, so existing calls satisfy the constraint.

4. **`wallet.mint` access** — v3 `Wallet` has `public readonly mint: Mint`. `wallet.mint.webSocketConnection` still works.

5. **Counter management** — v3's `{ type: 'custom', data: [...] }` OutputType bypasses all counter logic. Our DB-persisted counter pattern works unchanged. See "Counter management: our migration path" above.

6. **`loadMint()` vs pre-fetch** — Keep our TanStack Query pre-fetch pattern. `loadMint()` would add a network call we already avoid by injecting cached data. Our pattern is faster for returning users.

## Open questions

1. **NUT-10 secret migration** — Our `NUT10Secret` is a Zod-validated type used for DB storage. v3's `Secret` is a tuple `[SecretKind, SecretData]`. Need to map between them carefully, especially for `parseSecret` compatibility with our existing stored secrets. Our Zod schemas may need to wrap v3's types rather than replace them entirely.

2. **`meltProofsIdempotent` in v3** — Our method wraps `meltProofs` and re-checks quote state on failure. In v3, `meltProofs` → `meltProofsBolt11` with different params (`OutputType` instead of `{ counter }`). Need to verify the error handling path still works — particularly whether `MintOperationError` shape is unchanged.

3. **`wallet.restore()` API** — Used in all 4 service files for idempotent recovery. Need to verify v3's `restore()` signature — does it still accept `(counter, count)` params?

4. **`checkProofsStates` API** — Used in `token.ts`. Need to verify v3 signature and return type.
