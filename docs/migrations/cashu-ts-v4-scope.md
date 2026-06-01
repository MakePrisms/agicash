# cashu-ts v3.6.1 → v4.x upgrade — Scope & Classification

> Branch: `cashu-ts-v4`. No code changes yet — this is a planning doc to scope a clean-start migration.
> Current pin: `@cashu/cashu-ts: 3.6.1`. Latest: `v4.5.0` (2026-05-21).

## TL;DR

- Recommended target: **v4.5.0** (or the latest stable at merge time).
- Upstream ships **both** a human migration guide (`migration-4.0.0.md`) **and** an agent playbook (`migration-4.0.0.SKILL.md`) — use the SKILL doc as the line-by-line checklist.
- Size: **Medium-Large.** ~26 first-party files import cashu-ts. The work is mechanical but touches every send/receive service, the encryption-at-rest schema, the Money/Amount boundary, and a handful of Zod schemas. Code volume is small, blast radius is broad, and there are persisted-shape questions that need product answers.
- Two foundational questions block sequencing: **(Q1)** Amount strategy — adopt natively or convert at boundary; **(Q2)** how to handle the `Proof.amount: number → bigint/Amount` change in the encrypted DB payload.

---

## Section 1 — v4 breaking changes summary

Sources:
- Release index: https://github.com/cashubtc/cashu-ts/releases
- Human guide: https://github.com/cashubtc/cashu-ts/blob/main/migration-4.0.0.md
- Agent playbook: https://github.com/cashubtc/cashu-ts/blob/main/migration-4.0.0.SKILL.md
- v4.0.0 notes: https://github.com/cashubtc/cashu-ts/releases/tag/v4.0.0

### 1.1 The big four (everything else falls out of these)

**(A) `Amount` value object replaces `number` on most APIs.** Immutable, bigint-backed, non-negative. Has `.add/.subtract/.multiplyBy/.divideBy/.toNumber()/.toBigInt()/.toJSON()` plus finance helpers (`scaledBy`, `clamp`, `inRange`, `ceilPercent`, `floorPercent`). `Amount.from(x)` accepts `number | bigint | string | Amount`. `AmountLike` is the boundary union. `toJSON()` always emits a decimal string — so `JSON.stringify(amount)` no longer produces a bare number. Affected fields:

- `Proof.amount: number → Amount` (and `Proof` literals must use `Amount.from(...)`)
- `MintQuoteBolt11Response.amount`, `MeltQuoteBolt11Response.amount`, `MeltQuote*.fee_reserve`
- `sumProofs() → Amount`, `getTokenMetadata().amount → Amount`
- `splitAmount() → Amount[]`, `getKeysetAmounts() → Amount[]`
- `wallet.getFeesForProofs() → Amount`, `wallet.getFeesForKeyset() → Amount`
- `OutputData.sumOutputAmounts() → Amount`
- `SwapPreview.amount/.fees → Amount`
- `PaymentRequest.amount → Amount | undefined`
- `SerializedBlindedMessage.amount → Amount`

v4.1 also widened `selectProofsToSend` / `groupProofsByState` to accept `ProofLike[]` (proof with `amount: AmountLike`). v4.4 added an opt-in `AmountWithUnit` value object for multi-unit apps.

**(B) Token encoding no longer mutates input.** PR cashubtc/cashu-ts#536 (authored by gudnuf) landed in v4.0. `getEncodedToken()` deep-clones proofs before encoding, so our `encodeToken` wrapper in `app/lib/cashu/token.ts` becomes obsolete. Related: `getEncodedTokenV3` removed entirely; `{ version: 3 }` option on `getEncodedToken` removed; `getEncodedTokenV4` made internal — call `getEncodedToken` instead. Encoding a token whose proofs carry legacy base64 keyset IDs now **throws** ("Proofs contain a legacy keyset ID and cannot be encoded. Swap them at the mint first.") — fresh-swap via `wallet.receive(legacyProofs)` first.

**(C) `getDecodedToken` requires a `keysetIds: readonly string[]` second arg.** Passing `[]` is unsafe (throws on v2 short keyset IDs). Two new safe paths:
- `getTokenMetadata(str)` — pre-wallet decoder (mint, unit, amount, incompleteProofs). Always safe.
- `wallet.decodeToken(str)` — post-wallet decoder, returns fully-hydrated `Token`.

**(D) Proof serialization helpers + `ProofLike` type.** `serializeProofs(proofs): string[]` and `deserializeProofs(json | string[] | ProofLike[]): Proof[]` are the supported JSON-safe round-trip helpers. `normalizeProofAmounts(raw: ProofLike[])` is the lower-level normalizer. Wallet APIs accept `ProofLike[]` directly — you can pass DB-loaded proofs with `amount: number` straight into `wallet.send/receive/meltProofsBolt11/selectProofsToSend/groupProofsByState/signP2PKProofs` without converting first.

### 1.2 API drift (removed / renamed)

| Old | New / Replacement |
|-----|-------------------|
| `getEncodedTokenV3`, `getEncodedTokenV4` | `getEncodedToken` only |
| `getEncodedToken(token, { version: 3 })` | option removed |
| `getDecodedToken(str)` | `getDecodedToken(str, keysetIds)` or use `getTokenMetadata`/`wallet.decodeToken` |
| `wallet.swap` | `wallet.send` |
| `wallet.createMintQuote/checkMintQuote/mintProofs` | `*Bolt11` variants |
| `wallet.createMeltQuote/checkMeltQuote/meltProofs` | `*Bolt11` variants |
| `MeltBlanks` / `meltBlanksCreated` / `preferAsync` (TS) | `prepareMelt()` + `completeMelt()` (or `prefer_async` in payload) |
| `new Wallet(mint, { keys, keysets, mintInfo })` preload | `wallet.loadMintFromCache(cache)` |
| `KeyChain.fromCache(mint, cache)` | `KeyChain.fromCache(mint, unit, cache)` — **unit is now explicit** |
| `KeyChain.mintToCacheDTO(unit, url, keysets, keys)` | `KeyChain.mintToCacheDTO(url, keysets, keys)` — **unit removed** |
| `KeyChainCache.unit` field | removed; cache covers all units; new `savedAt?: number` |
| `chain.getCache()` | `chain.cache` |
| `keyset.active / .input_fee_ppk / .final_expiry` | `.isActive / .fee / .expiry` (on `Keyset` domain class; raw `MintKeyset` DTO still uses old names) |
| `handleTokens`, `MessageQueue`, `MessageNode`, `getKeepAmounts`, `bytesToNumber`, `verifyKeysetId`, `deriveKeysetId`, `mergeUInt8Arrays`, `hasNonHexId`, `checkResponse`, `deepEqual` | removed / made internal |
| `RawProof`, `constructProofFromPromise`, `createRandomBlindedMessage`, `verifyProof`, `BlindedMessage`, `SerializedProof`, `serializeProof`, `deserializeProof` | renamed: `UnblindedSignature`, `constructUnblindedSignature`, `createRandomRawBlindedMessage`, `verifyUnblindedSignature`, `RawBlindedMessage`; serialization removed (use `Proof` directly) |
| `createBlindSignature(B_, sk, amount, id)` | `createBlindSignature(B_, sk, id)` (amount param dropped) |
| `BlindSignature.amount` field | removed |
| Low-level P2PK getters (`getP2PKWitnessPubkeys`, `getP2PKLockState`, `getP2PKNSigs`, etc.) | `verifyP2PKSpendingConditions(proof)` returns `{ main: { pubkeys, requiredSigners, receivedSigners }, refund: { ... }, lockState, locktime }` |
| `signP2PKSecret` | `schnorrSignMessage` |
| `mintInfo.supportsBolt12Description` | `mintInfo.supportsNut04Description('bolt12')` |
| `wsConnection.closeSubscription(id)` | `wsConnection.cancelSubscription(id)` |
| `OutputDataFactory<TKeyset>` generic | removed; `amount: number → AmountLike` |
| `OutputDataLike<TKeyset>` generic | removed |
| `MintPreview.quote: string` | `MintPreview.quote: TQuote` (full object) |
| `sanitizeUrl` (public) | `normalizeUrl` (internal); renamed v4.2 |
| `ConnectionManager` singleton | removed (transport refactor) |
| CJS build | **gone** — ESM only |
| `Proof.amount` in `serialize/deserializeProofs` round-trip | new `ProofLike` boundary type |

### 1.3 New features Agicash may want

- **`RateLimitError` + `parseRetryAfter` + `ResponseMeta` callback** (v4.0) — explicit 429 handling. Today the codebase greps `HttpResponseError && error.status === 429` in one place (`cashu-receive-quote-hooks.ts:387`); this could become typed.
- **`requireSigDleq` Wallet option** (v4.0) — strict DLEQ signature enforcement.
- **`createEphemeralCounterSource(initial)`** (v4.1) — DX win; not load-bearing for us (we use `{ type: 'custom' }`).
- **`maxSpendableAfterFees`** (v4.3) — primitive for "send max" workflows.
- **`createMeltChangeProofs`** (v4.3) — async melt-change handling. Could replace our `matchBlindSignaturesToOutputData` wrapper in `app/lib/cashu/blind-signature-matching.ts`. Worth a follow-up audit.
- **`AmountWithUnit`** (v4.4) — unit-aware arithmetic; not needed today, but conceptually overlaps with `Money`.
- **`CTSError` base class** (v4.0/v4.3) — new common ancestor across cashu-ts errors. Useful for the PR #1090 classifier.
- **Anti-fingerprinting header overrides** (v4.0) — request headers now consumer-overridable.

### 1.4 Minor / spec-alignment

- `expiry` fields on `MintQuoteBolt11Response` / `Bolt12Response` may be `null` (was always `number`). This bites us — see `cashu-receive-quote-core.ts:274` (`new Date(mintQuoteResponse.expiry * 1000)`) and `cashu-send-quote-service.ts:240` (`new Date(meltQuote.expiry * 1000)`). Both will crash on `expiry: null` and need null-guards.
- `T | null` propagation on other nullable wire fields (v4.3).
- BOLT12 quote `amount` may be `null` (we don't use BOLT12 yet).
- `P2PKBuilder.requireLockSignatures` now **throws** on non-positive integers (was silent clamp).

---

## Section 2 — File-by-file audit

26 first-party files (50 grep hits — 24 are package.json/bun.lock/docs/CLAUDE.md). Grouped by area. **Buckets** key: A=Amount migration, B=Encoding fix, C=Error surface, D=Other API drift, E=Money-unit cleanup opportunity. Numbers in parens after a bucket = approximate hot spots in that file.

### 2.1 Core lib (`app/lib/cashu/`)

| File | Imports | Buckets |
|---|---|---|
| `utils.ts` | `Keyset, MeltQuoteBolt11Response, MeltQuoteState, Mint, MintKeyset, MintQuoteBolt11Response, Proof, Wallet, splitAmount, Token` | A(3), D(2), E(1) — `splitAmount → Amount[]`; `ExtendedCashuWallet.getFeesEstimateToReceiveAtLeast(amount: number)` boundary; `meltProofsIdempotent` change-proof return + `meltQuote.amount` arithmetic; existing TODO at line 133 about `cent`/`usd` mismatch is exactly the cleanup gudnuf has in mind |
| `token.ts` | `CheckStateEnum, Proof, Token, TokenMetadata, Wallet, getEncodedToken, getTokenMetadata` | **B (DELETE wrapper)** — `encodeToken()` at lines 44-51 has an explicit TODO citing cashu-ts#536 (the v4 fix). Delete this function entirely and inline call sites to `getEncodedToken`. Also: `new Wallet(token.mint, { unit: token.unit })` then `wallet.checkProofsStates(token.proofs)` will keep working but consider `wallet.decodeToken` pattern |
| `proof.ts` | `Proof, hashToCurve` | A(1) — `sumProofs` reduces `acc + proof.amount` with `acc = 0`. v4 `Proof.amount` is `Amount` (or `AmountLike`), so this needs `Amount.zero()` + `.add()` or just defer to the new upstream `sumProofs` |
| `proof.test.ts` | `Proof` | A — test fixtures use literal `amount: number` |
| `secret.ts` | `Secret, SecretKind, parseSecret` | — no v4 impact |
| `secret.test.ts` | — | — |
| `payment-request.ts` | `PaymentRequest, decodePaymentRequest` | A(1) — `PaymentRequest.amount` is now `Amount \| undefined` |
| `payment-request.test.ts` | — | A — test fixtures |
| `mint-validation.ts` | `MintInfo, MintKeyset, WebSocketSupport` | — no v4 impact (raw DTOs unchanged) |
| `protocol-extensions.ts` | `GetInfoResponse, MintInfo, MintQuoteBolt11Response` | D — `MintQuoteFee.fee?: number` still works, but if our agicash fork eventually returns `Amount`, this becomes A too |
| `error-codes.ts` | local enum only | C(0 direct) — but it's *the* point of intersection with PR #1090. v4 introduced `CTSError` base class — we can keep the enum but consider routing through `CTSError` for classification |
| `melt-quote-subscription.ts` | `MeltQuoteBolt11Response, MeltQuoteState` | A(2) — `meltQuote.amount > quoteData.inputAmount` comparison at line 71; `meltQuote.amount` is now `Amount`, `inputAmount` is `number` |
| `melt-quote-subscription-manager.ts` | `MeltQuoteBolt11Response` | — type-only |
| `mint-quote-subscription-manager.ts` | `MintQuoteBolt11Response` | — type-only |
| `blind-signature-matching.ts` | `HasKeysetKeys, OutputData, Proof, SerializedBlindedSignature, pointFromHex, verifyDLEQProof_reblind` | A(1) — `sig.amount` is used as object key in `keyset.keys[sig.amount]` (line 50). `Amount` is not a valid object key — need `.toNumber()` or `.toString()` |
| `blind-signature-matching.test.ts` | `OutputData, SerializedBlindedSignature, createBlindSignature, createDLEQProof, pointFromHex` | D(1) — `createBlindSignature` lost its `amount` param in v4. Test fixtures must drop the arg |
| `types.ts` | local zod schemas | A — `ProofSchema.amount = z.number()` (line 34) needs a decision (see Q2) |

### 2.2 Send / Receive services (the hot path)

| File | Imports | Buckets |
|---|---|---|
| `features/send/cashu-send-quote-service.ts` | `MeltQuoteBolt11Response, MeltQuoteState, OutputData` | **A(many), D(1)** — `meltQuote.amount + meltQuote.fee_reserve` (lines 152, 252); `sumOfSendProofs < amountWithLightningFee` (line 173); `selectProofs(account, amount: number)` and `getFeesForProofs(send) → Amount` mismatch (lines 533, 565); `meltQuote.expiry * 1000` (line 240) — v4 allows `null` |
| `features/send/cashu-send-swap-service.ts` | `MintOperationError, OutputData, Proof, Wallet, splitAmount` | A(many), C(1) — same Amount churn; `getFeesForProofs` is the main hot spot |
| `features/send/cashu-send-quote-hooks.ts` | `MeltQuoteBolt11Response, MintOperationError` | C(1) — `error instanceof MintOperationError` retry gate. Unchanged in v4 |
| `features/send/cashu-send-quote-repository.ts` | `Proof` (type) | A — proof persistence shape (see Q2) |
| `features/send/cashu-send-swap-repository.ts` | `Proof` (type) | A — proof persistence shape (see Q2) |
| `features/send/proof-state-subscription-manager.ts` | `Proof, ProofState` | — type-only; `ProofState` unchanged |
| `features/send/share-cashu-token.tsx` | `Token` | — type-only |
| `features/receive/cashu-receive-quote-service.ts` | `MintOperationError, MintQuoteState, OutputData, Proof, splitAmount` | **A(many), C(2), D(1)** — `quote.amount.toNumber(cashuUnit)` already converts to Money internally; `splitAmount(...) → Amount[]` (line 249) needs `.map(a => a.toNumber())` if `outputAmounts: number[]` stays in the DB; `MintOperationError && error.code === CashuErrorCodes.X` retry gate (line 333); `wallet.ops.mintBolt11(amount, { ... amount, ... }).asCustom(outputData).run()` — `amount` field on the manually-constructed quote object is now `Amount` |
| `features/receive/cashu-receive-swap-service.ts` | `MintOperationError, OutputData, Token, Wallet, splitAmount` | A(many), C(1) — `wallet.getFeesForProofs(token.proofs) → Amount`; `sumProofs(token.proofs) - fee` (line 74) Amount-vs-Amount arithmetic; `splitAmount → Amount[]` |
| `features/receive/cashu-receive-quote-hooks.ts` | `HttpResponseError, MintOperationError, MintQuoteBolt11Response, NetworkError, WebSocketSupport` | **C(2)** — `error instanceof HttpResponseError && error.status === 429` (line 387) — candidate for `RateLimitError` + `parseRetryAfter`; `MintOperationError` retry gate (line 705); `meltProofsIdempotent({ ..., amount: quote.amount.toNumber(cashuUnit) })` — partial melt-quote shape passes `amount` as raw number to wallet, will break v4's `MeltQuoteBaseResponse.amount: Amount` typing |
| `features/receive/cashu-receive-quote-core.ts` | `MintQuoteBolt11Response, Proof` | A(2), D(1) — `wallet.createLockedMintQuote(amount.toNumber(cashuUnit), ...)` returns `MintQuoteBolt11Response` whose `.amount` and `.expiry` are now `Amount` / nullable; `mintQuoteResponse.expiry * 1000` (line 274) crashes on `null`; `mintQuoteResponse.fee` is local agicash CDK extension — keep typed as `number` |
| `features/receive/cashu-receive-quote-repository.ts` | `Proof` (type) | A — `proofs.flatMap((x) => [x.amount, x.secret])` (line 319) — `x.amount` becomes `Amount`, currently encrypted as `number` |
| `features/receive/cashu-receive-quote-service.server.ts` | `MintQuoteState` | — enum-only |
| `features/receive/cashu-receive-swap-repository.ts` | `Proof, Token` | A — same proof persistence shape |
| `features/receive/cashu-receive-swap-hooks.ts` | `Token` | — type-only |
| `features/receive/receive-cashu-token-service.ts` | `Token` | — type-only |
| `features/receive/receive-cashu-token-quote-service.ts` | `MeltQuoteBolt11Response, Token` | A — `MeltQuoteBolt11Response.amount/fee_reserve` |
| `features/receive/receive-cashu-token-hooks.ts` | `NetworkError, Proof, Token` | C(1) — `error instanceof NetworkError` |
| `features/receive/receive-cashu-token.tsx` | `Token` | — type-only |
| `features/receive/claim-cashu-token-service.ts` | `Token` | — type-only |
| `features/receive/spark-receive-quote-core.ts` | `Proof` (type) | A — `Proof` in our own type literals |
| `features/receive/spark-receive-quote-hooks.ts` | `MintOperationError, NetworkError` | C(1) |

### 2.3 Shared / shell

| File | Imports | Buckets |
|---|---|---|
| `features/shared/cashu.ts` | `AuthProvider, GetKeysResponse, GetKeysetsResponse, KeyChain, Mint, NetworkError, Token, getDecodedToken` | **D (high)** — `getDecodedToken(result.encoded, keysetIds)` (line 235) — already passes keyset IDs (good), but should consider moving to `getTokenMetadata` + `wallet.decodeToken` for the cleaner path; `KeyChain.mintToCacheDTO(wallet.unit, mintUrl, unitKeysets, [activeKeysForUnit])` (line 344) — first arg `unit` REMOVED in v4; `tokenToMoney` converts `sumProofs(token.proofs)` — sumProofs now returns `Amount`; `encodeToken` import comes from local wrapper (to be deleted, see B) |
| `features/shared/agicash-mint-auth-provider.ts` | `AuthProvider` (type) | — type-only |
| `features/accounts/cashu-account.ts` | `Proof` (type) | **A (load-bearing)** — `CashuProofSchema.amount = z.number()` (line 10), `toProof(proof: CashuProof): Proof` builds a `Proof` literal with `amount: proof.amount` (number). v4 `Proof.amount` is `Amount`. Either: (a) keep DB as `number`, wrap with `Amount.from()` in `toProof`; or (b) propagate `Amount` deeper |
| `features/settings/accounts/account-proofs.tsx` | `CheckStateEnum` | — enum-only |
| `features/settings/accounts/add-mint-form.tsx` | `MintKeyset` (type) | — type-only |
| `features/transactions/transaction-additional-details.tsx` | `CheckStateEnum, Proof` | A — `Proof` literals |
| `features/scan/classify-input.test.ts` | `Token, getEncodedToken` | **D (TEST BREAK)** — `getEncodedToken(CASHU_TOKEN, { version: 3 })` and `{ version: 4 }` at lines 20-21. Both options REMOVED in v4. Plus test `Token` literal with `amount: 1` (number) needs `Amount.from(1)` |

### 2.4 Docs

- `docs/migrations/cashu-ts-v3.md`, `cashu-ts-v3-api-audit.md`, `cashu-ts-v3-todo.md` — existing v3 migration docs. Leave in place; create new `docs/migrations/cashu-ts-v4.md` mirror as the project journal.

---

## Section 3 — Per-bucket counts and pain ranking

### Bucket A — Amount-type migration (~17 files touched, dozens of sites)
**Top 3 most painful:**
1. **`app/features/accounts/cashu-account.ts`** — `CashuProofSchema` is the DB-encryption boundary. Decision needed before code changes (see Q2). Every other Proof-touching site downstream depends on this.
2. **`app/features/send/cashu-send-quote-service.ts`** — densest arithmetic (lines 152, 252, 254, 286, 446). Money/Amount/number all collide in `selectProofs`, change-proof calc, and insufficient-balance comparisons.
3. **`app/features/receive/cashu-receive-quote-service.ts`** — splits across three units: persisted `Money.toNumber(cashuUnit)`, mint API `Amount`, manually-constructed mint-quote object literal at line 318. Subtle.

### Bucket B — Encoding fix (1 file + downstream)
**Top 3 most painful:**
1. **`app/lib/cashu/token.ts`** — `encodeToken()` wrapper at lines 44-51 has the explicit TODO referencing cashu-ts#536. Delete the function, update the single import in `features/shared/cashu.ts:38`.
2. (None else — this is a one-shot cleanup.)

### Bucket C — Error surface (5 files, intersects PR #1090)
**Top 3 most painful:**
1. **`app/features/receive/cashu-receive-quote-hooks.ts`** — only call site that already inspects `HttpResponseError.status === 429`. Either adopt v4's `RateLimitError` + `parseRetryAfter` here, or leave alone. This is also where `meltProofsIdempotent` is invoked from the React layer.
2. **`app/features/receive/cashu-receive-quote-service.ts`** + **`cashu-receive-swap-service.ts`** + **`cashu-send-swap-service.ts`** — all three do `error instanceof MintOperationError && [LIST].includes(error.code)` for restore-recovery. These are exactly the patterns PR #1090's classifier needs to consume. Coordinate landing order.
3. **`app/features/send/cashu-send-quote-hooks.ts`** + **`spark-receive-quote-hooks.ts`** + **`receive-cashu-token-hooks.ts`** — simpler `instanceof` retry gates that don't read `.code`. Probably untouched by v4, but worth verifying `MintOperationError` / `NetworkError` / `HttpResponseError` shapes stayed stable (memory says yes — `MintOperationError` is not in v4's rename table; `CTSError` is the new base class).

### Bucket D — Other API drift (5+ sites)
**Top 3 most painful:**
1. **`app/features/shared/cashu.ts:344`** — `KeyChain.mintToCacheDTO(wallet.unit, mintUrl, unitKeysets, [activeKeysForUnit])` — first arg `unit` REMOVED. Plus cache no longer per-unit — could simplify the 3-query TanStack setup (see follow-up in v3 todo doc).
2. **`app/features/scan/classify-input.test.ts:20-21`** — `{ version: 3 }` and `{ version: 4 }` options on `getEncodedToken` are gone; will break tests immediately.
3. **`app/features/receive/cashu-receive-quote-core.ts:274`** + **`app/features/send/cashu-send-quote-service.ts:240`** — `quote.expiry` may now be `null`; both unconditionally do `new Date(expiry * 1000)`. Null-guards required.

### Bucket E — Money-unit cleanup opportunity (architectural, not strictly required)
**Top 3 most painful (but most rewarding):**
1. **`app/lib/cashu/utils.ts`** — already has TODO at line 133 calling out the `cent`/`usd` mismatch. v4's `AmountWithUnit` (v4.4) is exactly the primitive that could replace `getCashuUnit/getCashuProtocolUnit` plumbing — but it's a different abstraction from `Money` (which carries currency + display formatting). Need a design conversation. (See Q1.)
2. **`app/lib/money/money.ts`** + **`types.ts`** — agicash's `Money` is `Big`-backed (`NumberInput = number | string | Big`). v4's `Amount` is `bigint`-backed. There's no direct value-object interop — `Money.toNumber(cashuUnit)` will still be how we cross the boundary. The real question is whether `Money` should grow a `Money.toAmount()` helper and stop us from passing raw `number` to cashu-ts.
3. **`app/features/receive/cashu-receive-quote-service.ts`** + **`cashu-receive-swap-service.ts`** + **`cashu-send-swap-service.ts`** — the `getCashuUnit(currency)` + `money.toNumber(cashuUnit)` dance appears identically in ~6 places. After v4, this becomes a perfect refactor target.

---

## Section 4 — Open questions for gudnuf

> These should be answered before any code lands. The first two are blocking.

**Q1 (BLOCKING) — Amount strategy?**
The v4 SKILL doc forces a choice up-front:
- **(a) Adopt `Amount` natively** — propagate `Amount` / `AmountLike` through agicash domain code; use `Amount` helpers (`.add`, `.scaledBy`, etc.) for arithmetic; call `.toNumber()` only at genuine number-only boundaries (e.g. `Money` constructor, DB, React props).
- **(b) Convert at the boundary** — call `.toNumber()` immediately on every `Amount` the library returns; leave all internal types as `number`. Simpler, but reintroduces precision risk at scale.

Recommendation: **(b)** for the migration PR itself (mechanical, minimal diff), then a follow-up audit to migrate the 3 hot files in Bucket E to native `Amount` where it improves the Money/cashu boundary.

**Q2 (BLOCKING) — `Proof.amount` in encrypted DB payload?**
`CashuProofSchema.amount = z.number()` and `toProof()` produces `amount: number`. v4 `Proof.amount` is `Amount`. Three options:
- (a) Keep DB as `number`. `toProof()` calls `Amount.from(proof.amount)`. Repositories decrypt and store `number`. Simplest; works because wallet APIs accept `ProofLike[]` (proof with `amount: AmountLike`).
- (b) Migrate DB rows to store `Amount.toJSON()` string. Forward-compatible with bigint, but requires a data migration and breaks the current encryption-batch shape (`proofs.flatMap((x) => [x.amount, x.secret])` at `cashu-receive-quote-repository.ts:319` would need to stringify).
- (c) Store as `bigint`. Cleanest in-memory, but Postgres BIGINT vs JS bigint vs `Money`(Big.js) is a three-way headache.

Recommendation: **(a)**. Keep DB shape, only normalize at read time.

**Q3 — Are we OK with the v4 `expiry: null` semantics for amountless / never-expiring quotes?**
Two sites currently assume non-null (`receive/cashu-receive-quote-core.ts:274`, `send/cashu-send-quote-service.ts:240`). Need a product call on what `expiry: null` means at the wallet UI level — "never expires" or "show no countdown"?

**Q4 — Adopt `RateLimitError` + `ResponseMeta` now or follow-up?**
v4.0 ships explicit 429 handling. Today we have one site that inspects `HttpResponseError.status === 429`. Cheap to convert during the migration; bigger payoff if we also wire `ResponseMeta` for per-mint observability — but that's a separate PR.

**Q5 — `wallet.decodeToken` adoption?**
Today `features/shared/cashu.ts:235` already calls `getDecodedToken(encoded, keysetIds)` with the keyset list from TanStack Query — it's safe and explicit. v4's idiomatic replacement is `getTokenMetadata(str)` to get the mint URL, then build the wallet, then `wallet.decodeToken(str)`. We already build the wallet right after, so the migration is small. Worth doing in the same PR, or split?

**Q6 — Multi-unit `KeyChainCache` simplification?**
v4 makes the cache mint-wide (covers all units). Today we maintain 3 separate TanStack queries (`mintInfo`, `allMintKeysets`, `mintKeys`) and a per-unit cache. The v3 todo doc already flagged this as a candidate cleanup. Do it in this PR or defer?

**Q7 — `meltProofsIdempotent` over `prepareMelt`/`completeMelt`?**
The v3 todo doc already flagged switching to `prepareMelt()` + `completeMelt()` as a P2. v4 adds `createMeltChangeProofs` for async melt change. Both could obsolete our `matchBlindSignaturesToOutputData` workaround. Out of scope for the v4 PR itself but worth a follow-up issue.

**Q8 — `CTSError` base class for PR #1090?**
v4 introduced `CTSError` as the common ancestor for cashu-ts errors. PR #1090 (#cashu-error-codes umbrella, send-hardening) is building a classifier. Discuss with Josip whether the classifier should `instanceof CTSError` rather than `instanceof MintOperationError | NetworkError | HttpResponseError`.

**Q9 — `AmountWithUnit` vs `Money` long-term?**
v4.4 introduced `AmountWithUnit` for multi-unit apps. It's not `Money` — it's a unit-aware arithmetic wrapper on `Amount`, without currency formatting. Long-term, would we ever fold `Money` onto `AmountWithUnit` (with display layer on top)? Or stay split? Doesn't block the v4 PR; useful to name now.

**Q10 — Do we want the `requireSigDleq` strict-DLEQ Wallet option?**
v4.0 ships this as opt-in. We already require NUT-12 (`mint-validation.ts` requires nut 12). Could harden by enforcing strict signature DLEQ — but this might reject proofs from older mints. Test mint compatibility check needed.

---

## Section 5 — Recommended PR sequencing

### Proposal: **3 PRs.** Single mega-PR is doable but pre-launch makes review risky.

**PR 1 — Mechanical v4 upgrade (boundary strategy, no behavior change)**
Goal: get the codebase compiling on v4.5.x with minimum semantic drift. Choice (b) on Q1 (convert at boundary) and choice (a) on Q2 (keep DB as number).

Includes:
- Bump `@cashu/cashu-ts` to `^4.5.0` in `package.json` + `bun.lock`
- All Bucket A sites: add `.toNumber()` at the library call boundary, leave internal types as `number`. `splitAmount(...).map(a => a.toNumber())`, `wallet.getFeesForProofs(...).toNumber()`, etc.
- `toProof()` in `features/accounts/cashu-account.ts`: wrap `amount: Amount.from(proof.amount)` so wallet APIs receive a valid `Proof`.
- Bucket B: delete `encodeToken` wrapper in `app/lib/cashu/token.ts`; update single import in `features/shared/cashu.ts`. Drop the wrapper's TODO comment.
- Bucket D — must-fix:
  - `KeyChain.mintToCacheDTO(mintUrl, unitKeysets, [activeKeysForUnit])` — drop the `wallet.unit` arg in `features/shared/cashu.ts:344`.
  - Update `classify-input.test.ts` — remove `{ version: N }` options; convert proof `amount: 1` → `Amount.from(1)`.
  - Drop `amount` arg from `createBlindSignature` call in `blind-signature-matching.test.ts`.
  - Null-guard `expiry` in `cashu-receive-quote-core.ts:274` and `cashu-send-quote-service.ts:240`.
  - `blind-signature-matching.ts:50`: `keyset.keys[sig.amount.toNumber()]`.
- Spot-check: `tokenToMoney` in `features/shared/cashu.ts:68` — `sumProofs` now returns `Amount`; wrap with `.toNumber()`.
- Verify `bun run fix:all` passes (zero type errors). Smoke test send + receive on testnet mint.

**Out of scope for PR 1:** any error-surface change, any `Money`/`AmountWithUnit` rework, `KeyChainCache` consolidation, `getTokenMetadata` adoption, `prepareMelt`/`completeMelt`, strict DLEQ.

**PR 2 — `KeyChainCache` simplification + `wallet.decodeToken` adoption**
Goal: realize the cache simplification v4 enables. Single-unit cache → mint-wide cache. Q5 + Q6.

- Collapse the 3 TanStack queries (`mintInfo`, `allMintKeysets`, `mintKeys`) into one `KeyChainCache`-backed query if it cleanly maps.
- Convert `decodeCashuToken` in `features/shared/cashu.ts:225` to `getTokenMetadata` → build wallet → `wallet.decodeToken(str)`.
- Audit `ensureKeysetKeys` call sites to see if mint-wide cache obsoletes them.

**PR 3 — Money/Amount cleanup at the cashu boundary**
Goal: kill the `cent`/`usd` plumbing TODO at `utils.ts:133` and remove duplicated `getCashuUnit + .toNumber(cashuUnit)` patterns. Q1 follow-up.

- Add `Money.toAmount(unit)` helper that returns `Amount.from(money.toNumber(unit))`.
- Optionally adopt `Amount` natively in `cashu-receive-quote-service.ts` + `cashu-receive-swap-service.ts` + `cashu-send-swap-service.ts` (the 3 hottest files for E).
- Consider `ExtendedCashuWallet` absorbing the unit conversion (per the existing TODO).

### Follow-up issues (not PRs)

- `RateLimitError` / `ResponseMeta` adoption (Q4).
- `prepareMelt` / `completeMelt` adoption + retire `matchBlindSignaturesToOutputData` (Q7, also in v3 todo).
- `CTSError` integration in PR #1090 classifier (Q8).
- Strict DLEQ enforcement (Q10).
- Long-term `AmountWithUnit` vs `Money` design (Q9).

---

## Appendix — full grep result

50 files matched `@cashu/cashu-ts`. Non-code (4): `package.json`, `bun.lock`, `CLAUDE.md`, `docs/migrations/*` (3). First-party code (24 listed in §2). Remaining = test/route files implicitly covered by service updates.
