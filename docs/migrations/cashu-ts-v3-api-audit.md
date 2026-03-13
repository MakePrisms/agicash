# cashu-ts v3 API Audit for Agicash

## How to read this doc

**Section 1** lists every v3 API we currently use — confirming what's correct and what's not.
**Section 2** lists v3 APIs we *don't* use yet that would improve our code.
**Section 3** is a prioritized list of refactoring recommendations.

---

## 1. Current Usage — What We Have

### Wallet Construction & Initialization

| What we do | Where | Idiomatic? |
|------------|-------|------------|
| `new ExtendedCashuWallet(mintUrl, { keys, keysets, mintInfo, ... })` | `getInitializedCashuWallet` in `shared/cashu.ts:303` | **No** — `keys`, `keysets`, `mintInfo` constructor options are **deprecated** in v3. v3 wants `loadMintFromCache()` after construction. |
| Fetch info/keysets/keys separately via TanStack Query then inject | `shared/cashu.ts:252-272` | Pattern is fine, but injection point should change to `loadMintFromCache` |
| `getCashuWallet(mintUrl)` for throwaway wallets (subscriptions, test mint check) | `mint-quote-subscription-manager.ts:58`, `melt-quote-subscription-manager.ts:56`, `utils.ts:314` | **Problem** — these wallets are never initialized with `loadMint()`. Works only because subscription methods don't need keysets. But fragile. |

**Recommendation:** Switch to `loadMintFromCache(mintInfo, keyChainCache)` pattern. See Section 3.1.

### Core Operations

| Operation | v3 API used | Where | Idiomatic? |
|-----------|-------------|-------|------------|
| **Melt (send Lightning)** | `wallet.meltProofsIdempotent()` → wraps `meltProofsBolt11()` | `cashu-send-quote-service.ts:346` | Yes — our idempotent wrapper is app-specific logic. Using `{ type: 'deterministic', counter: N }` here is correct. |
| **Melt change reconstruction** | Manual `OutputData.createDeterministicData` + `outputData[i].toProof(s, keyset)` | `cashu-send-quote-service.ts:430-438` | **Not idiomatic** — v3 has `prepareMelt()` + `completeMelt()` which handles change proofs internally. See Section 2.2. |
| **Send swap (split proofs)** | `wallet.send(amount, proofs, config, outputConfig)` | `cashu-send-swap-service.ts:418-428` | Yes — using `{ type: 'custom', data }` for both send and keep outputs. |
| **Receive swap (claim token)** | `wallet.send(amount, tokenProofs, {}, { send: { type: 'custom', data } })` | `cashu-receive-swap-service.ts:207-216` | **Not idiomatic** — using `send()` to receive a token. v3 has `wallet.receive(token)` which is semantically correct and handles the swap automatically. See Section 2.1. |
| **Mint proofs** | `wallet.mintProofsBolt11(amount, quoteObj, config, { type: 'custom', data })` | `cashu-receive-quote-service.ts:310-325` | Passing a full MintQuote object is fine but unnecessary — v3 accepts a string quote ID directly: `mintProofsBolt11(amount, quoteId, ...)`. We construct the full object anyway at line 312-319. |
| **Proof selection** | `wallet.selectProofsToSend(proofs, amount, includeFees)` | `cashu-send-quote-service.ts:544`, `cashu-send-swap-service.ts:336` | Yes — correct API. |
| **Fee calculation** | `wallet.getFeesForProofs(proofs)` | multiple files | Yes |
| **Restore** | `wallet.restore(counter, count, { keysetId })` | 3 service files | Yes — signature unchanged in v3. |

### Keyset & Key Management

| What we do | Where | Idiomatic? |
|------------|-------|------------|
| `wallet.getKeyset()` / `wallet.getKeyset(id)` | All 4 service files | Yes — v3 `getKeyset()` enforces wallet binding. |
| `wallet.keysetId` getter | `cashu-receive-quote-service.ts:244`, `cashu-receive-swap-service.ts:98` | Yes |
| `wallet.keyChain.ensureKeysetKeys(id)` | 3 service files | Yes — ensures keys are loaded before use. |
| `wallet.keyChain.getCheapestKeyset()` | `utils.ts:193` (in fee estimation) | Yes |
| `keyset.keys` (raw `Keys` record) | `utils.ts:200`, `cashu-send-swap-service.ts:157-158` | Yes — accessing keys directly from Keyset is correct. |

### Output Data & Counters

| What we do | Where | Idiomatic? |
|------------|-------|------------|
| `OutputData.createDeterministicData(amount, seed, counter, keyset, amounts)` | 5 call sites across 4 service files | Yes for `{ type: 'custom' }` pattern. But see below for simplification opportunities. |
| `{ type: 'custom', data: outputData }` | send swap, receive swap, mint proofs | Yes — correctly bypasses v3 counter system when we manage counters ourselves. |
| `{ type: 'deterministic', counter: N }` | `cashu-send-quote-service.ts:352-355` (initiateSend/melt) | Yes — but note this lets v3 handle output creation. Inconsistent with other sites that create `OutputData` manually. |
| `splitAmount(amount, keyset.keys)` | `cashu-send-swap-service.ts:157-158`, `cashu-receive-swap-service.ts:92`, `cashu-receive-quote-service.ts:248` | Yes — using v3 export correctly. |

### Subscriptions & Events

| What we do | Where | Idiomatic? |
|------------|-------|------------|
| `wallet.on.mintQuoteUpdates(ids, cb, errCb)` | `mint-quote-subscription-manager.ts:72` | Yes — correct v3 event API. |
| `wallet.on.meltQuoteUpdates(ids, cb, errCb)` | `melt-quote-subscription-manager.ts:70` | Yes |
| `wallet.mint.webSocketConnection?.onClose(cb)` | Both subscription managers | Yes — accessing mint's WS connection. |
| Manual subscription tracking with Map/Set | Both managers | **Verbose** — v3 has `on.group()` for managing multiple subscriptions. |

### Types

| Type | Source | Idiomatic? |
|------|--------|------------|
| `Proof`, `Token`, `MintKeyset`, `MintKeys`, `Keys` | `@cashu/cashu-ts` | Yes |
| `MintQuoteBolt11Response`, `MeltQuoteBolt11Response` | `@cashu/cashu-ts` | Yes |
| `MintQuoteState`, `MeltQuoteState`, `CheckStateEnum` | `@cashu/cashu-ts` | Yes |
| `OutputData`, `splitAmount`, `MintOperationError`, `NetworkError` | `@cashu/cashu-ts` | Yes |
| `MintInfo` (our type alias: `ReturnType<Wallet['getMintInfo']>`) | `lib/cashu/types.ts:49` | **Redundant** — v3 exports `MintInfo` as a class. We could import directly. But our alias does the same thing so low priority. |
| `ProofSchema` (Zod) | `lib/cashu/types.ts:30` | Correct — v3 doesn't ship Zod schemas. |
| `CashuProtocolUnit` | `lib/cashu/types.ts:64` | Correct — v3 uses `string` for units. |

---

## 2. v3 APIs We Should Adopt

### 2.1. `wallet.receive(token)` — Replace `send()` for token claims

**Current:** `cashu-receive-swap-service.ts` uses `wallet.send(amount, tokenProofs, {}, { send: { type: 'custom', data } })` to claim incoming tokens. This works but is semantically wrong — `send()` is for splitting your own proofs, `receive()` is for claiming someone else's token.

**v3 API:**
```ts
// Simple:
const proofs = await wallet.receive(token, config?, outputType?);

// Builder:
const proofs = await wallet.ops.receive(token)
  .asCustom(outputData)
  .keyset(keysetId)
  .run();
```

**Benefits:**
- Semantically correct — `receive()` handles token parsing, validation, DLEQ checks
- Returns `Proof[]` directly instead of `SendResponse` (no `.send` unwrapping)
- v3 automatically handles the swap with the mint
- Simpler error handling

**Impact:** `cashu-receive-swap-service.ts` `swapProofs()` method. Medium refactor.

### 2.2. `prepareMelt()` + `completeMelt()` — Replace manual change reconstruction

**Current:** `cashu-send-quote-service.ts:420-438` manually reconstructs change proofs after melt by:
1. Re-creating `OutputData.createDeterministicData` with same counter
2. Calling `outputData[i].toProof(signature, keyset)` for each change signature

**v3 API:**
```ts
// Step 1: Prepare (before melt)
const preview = await wallet.prepareMelt('bolt11', meltQuote, proofs, config?, outputType?);
// preview has: inputs, outputData, keysetId, quote

// Step 2: Execute
const { quote, change } = await wallet.completeMelt(preview, privkey?);
// change is already Proof[]!
```

**Benefits:**
- No manual change proof reconstruction
- The `MeltPreview` is serializable — can be persisted and completed later
- v3 handles all the blind signature math internally
- Eliminates the `OutputData.createDeterministicData` + `toProof` dance in `completeSendQuote`

**Impact:** Requires rethinking the melt flow. `prepareMelt` should happen at initiation time, `completeMelt` at completion. The `MeltPreview` needs to be persisted (in the send quote DB row). This is a **significant but valuable refactor**.

### 2.3. `wallet.ops` Builder Pattern — Cleaner Operation Composition

**Current:** Operations pass positional args to methods:
```ts
wallet.send(amount, proofs, { keysetId }, { send: { type: 'custom', data: sendOD }, keep: { type: 'custom', data: keepOD } })
```

**v3 API:**
```ts
const { keep, send } = await wallet.ops
  .send(amount, proofs)
  .asCustom(sendOD)
  .keepAsCustom(keepOD)
  .keyset(keysetId)
  .run();
```

**Benefits:**
- More readable
- Discoverable API via method chaining
- `.prepare()` returns a `SwapPreview` (can preview before executing)
- Each builder is single-use, reducing mistakes

**Impact:** Optional improvement. Most useful where we compose complex operations. Low priority since our current code works.

### 2.4. `onceMintPaid(quoteId)` / `onceMeltPaid(quoteId)` — Promise-based quote watching

**Current:** Our `MintQuoteSubscriptionManager` and `MeltQuoteSubscriptionManager` manage WebSocket subscriptions manually with Maps, Sets, and callback routing.

**v3 API:**
```ts
try {
  const paidQuote = await wallet.on.onceMintPaid(quoteId, {
    signal: abortController.signal,
    timeoutMs: 60_000,
  });
  // Quote is paid!
} catch (e) {
  if (e.name === 'AbortError') { /* user cancelled */ }
}
```

Also: `onceAnyMintPaid(ids[])` for racing multiple quotes.

**Benefits:**
- One-liner replaces entire subscription manager for single-quote use cases
- Built-in abort signal support
- Built-in timeout
- Auto-cleanup on resolve/reject
- `onceAnyMintPaid` races multiple quotes — useful for batch operations

**Impact:** Could significantly simplify the quote subscription code. However, our managers handle multi-quote subscriptions with callback updates, which is different from the "wait for one" pattern. Consider using `onceMintPaid` for the single-quote case (Lightning receive) and keeping the manager for batch scenarios.

### 2.5. `wallet.on.group()` — Composite subscription management

**v3 API:**
```ts
const cancelAll = wallet.on.group();
cancelAll.add(wallet.on.mintQuoteUpdates(ids, cb, errCb));
cancelAll.add(wallet.on.meltQuoteUpdates(ids, cb, errCb));
// later:
cancelAll(); // disposes everything
```

**Benefits:** Replaces manual Map-based subscription tracking. Simpler cleanup.

### 2.6. `loadMintFromCache()` + `KeyChainCache` — Proper cache initialization

**Current:** We pass `keys`, `keysets`, `mintInfo` as deprecated constructor options.

**v3 API:**
```ts
const wallet = new Wallet(mintUrl, { unit, bip39seed });
wallet.loadMintFromCache(mintInfo, keyChainCache);
// or: await wallet.loadMint(); // fetches from network
```

Where `keyChainCache` comes from:
```ts
// Build from raw data (what we have):
const cache = KeyChain.mintToCacheDTO(unit, mintUrl, allKeysets, allKeys);

// Or get from existing wallet:
const cache = wallet.keyChain.cache;
```

**Benefits:**
- Not using deprecated options
- `KeyChainCache` is a single serializable object — can replace 3 separate TanStack Query caches
- `loadMintFromCache` is synchronous (no network)

### 2.7. `groupProofsByState(proofs)` — Proof state grouping

**v3 API:**
```ts
const { unspent, pending, spent } = await wallet.groupProofsByState(proofs);
```

**Benefits:** Single call instead of `checkProofsStates` + manual filtering.

### 2.8. `wallet.withKeyset(id)` — Multi-keyset operations

**v3 API:**
```ts
const walletForOldKeyset = wallet.withKeyset(oldKeysetId);
// Shares same CounterSource — counters remain monotonic
```

**Benefits:** When operating on proofs from different keysets, instead of calling `wallet.keyChain.ensureKeysetKeys(id)` + `wallet.getKeyset(id)`, create a derived wallet bound to that keyset.

### 2.9. `mintProofsBolt11(amount, quoteId: string, ...)` — String quote ID

**Current:** We construct a full `MintQuoteBolt11Response` object to pass to `mintProofsBolt11`:
```ts
// cashu-receive-quote-service.ts:312-319
wallet.mintProofsBolt11(amount, {
  quote: quote.quoteId,
  request: quote.paymentRequest,
  state: MintQuoteState.PAID,
  expiry: ...,
  amount,
  unit: wallet.unit,
}, ...)
```

**v3 accepts:** `mintProofsBolt11(amount, quote.quoteId, config, outputType)` — just the string ID.

**Benefits:** Delete 6 lines of object construction.

### 2.10. `CounterSource` Interface — Custom counter persistence

**v3 Interface:**
```ts
type CounterSource = {
  reserve(keysetId: string, n: number): Promise<{ start: number; count: number }>;
  advanceToAtLeast(keysetId: string, minNext: number): Promise<void>;
  setNext?(keysetId: string, next: number): Promise<void>;
  snapshot?(): Promise<Record<string, number>>;
};
```

**Future opportunity:** Implement `CounterSource` backed by our Supabase RPC. This would let v3 manage counter allocation during operations rather than our current pattern of allocating counters at quote-creation time. **Not recommended for this migration** — our current `{ type: 'custom', data }` pattern works and preserves transactional guarantees.

---

## 3. Refactoring Recommendations (Prioritized)

### P0 — Fix deprecated usage (do before merging)

#### 3.1. Replace deprecated constructor options with `loadMintFromCache()`

**Files:** `shared/cashu.ts` (`getInitializedCashuWallet`)

**Current:**
```ts
const wallet = getCashuWallet(mintUrl, {
  unit: getCashuUnit(currency),
  bip39seed,
  mintInfo: mintInfo.cache,
  keys: activeKeysForUnit,
  keysets: unitKeysets,
  keysetId: activeKeyset.id,
});
```

**Proposed:**
```ts
const wallet = getCashuWallet(mintUrl, {
  unit: getCashuUnit(currency),
  bip39seed,
  keysetId: activeKeyset.id,
});
const keyChainCache = KeyChain.mintToCacheDTO(
  getCashuProtocolUnit(currency),
  mintUrl,
  unitKeysets,
  [activeKeysForUnit],
);
wallet.loadMintFromCache(mintInfo.cache, keyChainCache);
```

`keysetId` in the constructor is NOT deprecated — it controls binding. Only `keys`, `keysets`, `mintInfo` are deprecated.

### P1 — Quick wins (low risk, high value)

#### 3.2. Simplify `mintProofsBolt11` call — pass string quote ID

**File:** `cashu-receive-quote-service.ts:310-325`

Replace the full object with just `quote.quoteId`. Delete 6 lines.

#### 3.3. Use `wallet.receive()` for token claims

**File:** `cashu-receive-swap-service.ts`

Replace `wallet.send(amount, tokenProofs, {}, { send: { type: 'custom', data } })` with `wallet.receive(token, {}, { type: 'custom', data: outputData })`. The `receive()` method:
- Accepts `Token | string` directly
- Returns `Proof[]` (not `SendResponse`)
- Handles token validation

The idempotent restore-on-error logic stays the same.

### P2 — Medium refactors (good ROI, needs care)

#### 3.4. Use `prepareMelt()` + `completeMelt()` for Lightning sends

**Files:** `cashu-send-quote-service.ts`

This eliminates the manual change proof reconstruction in `completeSendQuote`. The flow becomes:
1. `initiateSend`: Call `wallet.prepareMelt('bolt11', meltQuote, proofs, config, outputType)` → persist `MeltPreview`
2. `completeSendQuote`: Call `wallet.completeMelt(meltPreview)` → get `{ quote, change }` directly

**Risk:** Requires persisting `MeltPreview` (it's serializable but has `OutputDataLike[]`). May need a new column or blob storage for the preview data.

#### 3.5. Use `onceMintPaid` for single Lightning receive flows

**File:** Could simplify how receive flows wait for payment.

For the common case of "wait for this one mint quote to be paid", replace subscription manager usage with:
```ts
const paid = await wallet.on.onceMintPaid(quoteId, { signal, timeoutMs });
```

Keep the subscription manager for multi-quote batch scenarios.

### P3 — Nice to have (optional, consider later)

#### 3.6. Consolidate TanStack Query caches using `KeyChainCache`

Currently we have 3 separate query caches:
- `mintInfoQueryOptions(mintUrl)` → `MintInfo`
- `allMintKeysetsQueryOptions(mintUrl)` → `GetKeysetsResponse`
- `mintKeysQueryOptions(mintUrl)` → `GetKeysResponse`

Could consolidate into a single `KeyChainCache` query plus the `MintInfo` query. This simplifies `getInitializedCashuWallet` and makes cache invalidation easier.

#### 3.7. Adopt `wallet.ops` builder for complex operations

Low priority. Current positional API works fine. Consider when adding new operations.

#### 3.8. Implement `CounterSource` backed by Supabase

Would allow v3 to manage counter allocation during operations. Deferred — our `{ type: 'custom', data }` pattern is correct and well-tested.

---

## 4. Complete v3 API Reference (Agicash-relevant subset)

### Wallet Class

```ts
class Wallet {
  // --- Properties ---
  readonly mint: Mint;                    // Direct mint access
  readonly ops: WalletOps;               // Fluent builder entry
  readonly on: WalletEvents;             // Event subscriptions
  readonly counters: WalletCounters;     // Counter management

  // --- Construction & Init ---
  constructor(mint: Mint | string, options?: {
    unit?: string;                       // Default: 'sat'
    keysetId?: string;                   // Bind to specific keyset
    bip39seed?: Uint8Array;              // For deterministic secrets
    secretsPolicy?: SecretsPolicy;       // 'auto' | 'deterministic' | 'random'
    counterSource?: CounterSource;       // Custom counter persistence
    counterInit?: Record<string, number>;// Initial counters (ephemeral source)
    keys?: MintKeys[] | MintKeys;        // DEPRECATED → loadMintFromCache
    keysets?: MintKeyset[];              // DEPRECATED → loadMintFromCache
    mintInfo?: GetInfoResponse;          // DEPRECATED → loadMintFromCache
    denominationTarget?: number;         // Default: 3
    selectProofs?: SelectProofs;         // Custom proof selection
    logger?: Logger;
  });

  loadMint(forceRefresh?: boolean): Promise<void>;              // Network init
  loadMintFromCache(info: GetInfoResponse, cache: KeyChainCache): void;  // Offline init

  // --- Getters ---
  get keyChain(): KeyChain;
  get unit(): string;
  get keysetId(): string;
  getMintInfo(): MintInfo;
  getKeyset(id?: string): Keyset;       // Enforces wallet binding
  defaultOutputType(): OutputType;

  // --- Keyset binding ---
  bindKeyset(id: string): void;          // Rebind this wallet
  withKeyset(id: string): Wallet;        // Create derived wallet for different keyset

  // --- Send (swap to split) ---
  send(amount: number, proofs: Proof[], config?: SendConfig, outputConfig?: OutputConfig): Promise<SendResponse>;
  sendOffline(amount: number, proofs: Proof[], config?: SendOfflineConfig): SendResponse;
  prepareSwapToSend(amount, proofs, config?, outputConfig?): Promise<SwapPreview>;

  // --- Receive (swap incoming token) ---
  receive(token: Token | string, config?: ReceiveConfig, outputType?: OutputType): Promise<Proof[]>;
  prepareSwapToReceive(token, config?, outputType?): Promise<SwapPreview>;

  // --- Complete prepared swap ---
  completeSwap(preview: SwapPreview, privkey?): Promise<SendResponse>;

  // --- Mint quotes ---
  createMintQuoteBolt11(amount: number, description?: string): Promise<MintQuoteBolt11Response>;
  createLockedMintQuote(amount, pubkey, description?): Promise<MintQuoteBolt11Response>;
  checkMintQuoteBolt11(quote: string | MintQuoteBolt11Response): Promise<MintQuoteBolt11Response>;

  // --- Mint proofs ---
  mintProofsBolt11(amount, quote: string | MintQuoteBolt11Response, config?, outputType?): Promise<Proof[]>;

  // --- Melt quotes ---
  createMeltQuoteBolt11(invoice: string, amountMsat?: number): Promise<MeltQuoteBolt11Response>;
  checkMeltQuoteBolt11(quote: string | MeltQuoteBolt11Response): Promise<MeltQuoteBolt11Response>;
  createMultiPathMeltQuote(invoice, millisatPartialAmount): Promise<MeltQuoteBolt11Response>;

  // --- Melt proofs ---
  meltProofsBolt11(meltQuote, proofs, config?, outputType?): Promise<MeltProofsResponse>;
  prepareMelt(method, meltQuote, proofs, config?, outputType?): Promise<MeltPreview>;
  completeMelt(preview, privkey?, preferAsync?): Promise<MeltProofsResponse>;

  // --- Proof utilities ---
  selectProofsToSend(proofs, amount, includeFees?, exactMatch?): SendResponse;
  getFeesForProofs(proofs: Proof[]): number;
  getFeesForKeyset(nInputs: number, keysetId: string): number;
  checkProofsStates(proofs: Pick<Proof, 'secret'>[]): Promise<ProofState[]>;
  groupProofsByState(proofs: Proof[]): Promise<{ unspent, pending, spent }>;
  signP2PKProofs(proofs, privkey, outputData?, quoteId?): Proof[];

  // --- Restore ---
  restore(start, count, config?): Promise<{ proofs, lastCounterWithSignature? }>;
  batchRestore(gapLimit?, batchSize?, counter?, keysetId?): Promise<{ proofs, lastCounterWithSignature? }>;

  // --- Token ---
  decodeToken(token: string): Token;
}
```

### WalletEvents (`wallet.on`)

```ts
class WalletEvents {
  // --- Streaming subscriptions ---
  mintQuoteUpdates(ids, cb, errCb, opts?): Promise<SubscriptionCanceller>;
  meltQuoteUpdates(ids, cb, errCb, opts?): Promise<SubscriptionCanceller>;
  proofStateUpdates(proofs, cb, errCb, opts?): Promise<SubscriptionCanceller>;

  // --- One-shot waiters ---
  onceMintPaid(id, opts?: { signal?, timeoutMs? }): Promise<MintQuoteBolt11Response>;
  onceAnyMintPaid(ids, opts?: { signal?, timeoutMs?, failOnError? }): Promise<{ id, quote }>;
  onceMeltPaid(id, opts?: { signal?, timeoutMs? }): Promise<MeltQuoteBolt11Response>;

  // --- Async iterable ---
  proofStatesStream(proofs, opts?): AsyncIterable<ProofState & { proof }>;

  // --- Counter events ---
  countersReserved(cb, opts?): SubscriptionCanceller;

  // --- Subscription management ---
  group(): SubscriptionCanceller & { add, cancelled };

  // --- Deprecated ---
  mintQuotePaid(id, cb, errCb, opts?);    // use onceMintPaid
  meltQuotePaid(id, cb, errCb, opts?);    // use onceMeltPaid
  meltBlanksCreated(cb, opts?);           // use prepareMelt
}
```

### WalletOps (`wallet.ops`) — Fluent Builders

```ts
class WalletOps {
  send(amount, proofs): SendBuilder;
  receive(token: Token | string): ReceiveBuilder;
  mintBolt11(amount, quote): MintBuilder;
  meltBolt11(quote, proofs): MeltBuilder;
}

// All builders share these output type methods:
.asRandom(denoms?)               // Random blinding
.asDeterministic(counter?, denoms?) // counter=0 means auto
.asP2PK(options, denoms?)        // P2PK locked
.asFactory(factory, denoms?)     // Custom factory
.asCustom(data)                  // Pre-built OutputData

// SendBuilder also has:
.keepAsRandom/Deterministic/P2PK/Factory/Custom(...)  // Change output config
.includeFees(on?)               // Sender covers receiver's spend fee
.proofsWeHave(p)                // Optimize denomination selection
.offlineExactOnly(requireDleq?) // Force offline exact match
.offlineCloseMatch(requireDleq?)// Force offline close match

// All builders have:
.keyset(id)                     // Use specific keyset
.privkey(k)                     // Sign P2PK proofs
.onCountersReserved(cb)         // Counter callback
.prepare(): Promise<Preview>    // Preview without executing
.run(): Promise<Result>         // Execute
```

### KeyChain

```ts
class KeyChain {
  // --- Static ---
  static fromCache(mint, cache: KeyChainCache): KeyChain;
  static mintToCacheDTO(unit, mintUrl, keysets, keys): KeyChainCache;
  static cacheToMintDTO(cache): { keysets, keys };

  // --- Init ---
  init(forceRefresh?): Promise<void>;         // Fetch from network
  loadFromCache(cache: KeyChainCache): void;  // Load cached data

  // --- Query ---
  getKeyset(id?): Keyset;                    // By ID, or cheapest active
  getCheapestKeyset(): Keyset | undefined;   // Cheapest active with keys
  getKeysets(): Keyset[];                    // All keysets for this unit
  getAllKeys(): MintKeys[];

  // --- Key management ---
  ensureKeysetKeys(id: string): Promise<void>;  // Fetch keys if not loaded

  // --- Cache ---
  get cache(): KeyChainCache;               // Serializable cache
  getCache(): { keysets, keys };            // DEPRECATED → use cache
}
```

### Key Types

```ts
type OutputType =
  | { type: 'random' }
  | { type: 'deterministic'; counter: number }  // 0 = auto from CounterSource
  | { type: 'custom'; data: OutputDataLike[] }   // Pre-built, bypasses counters
  | { type: 'p2pk'; options: P2PKOptions }
  | { type: 'factory'; factory: OutputDataFactory };

type OutputConfig = {
  send: OutputType;
  keep?: OutputType;
};

type SendResponse = {
  keep: Proof[];
  send: Proof[];
};

type MeltProofsResponse<T> = {
  quote: T;
  change: Proof[];
};

type SendConfig = {
  keysetId?: string;
  privkey?: string | string[];
  includeFees?: boolean;
  proofsWeHave?: Proof[];
  onCountersReserved?: OnCountersReserved;
};

type ReceiveConfig = {
  keysetId?: string;
  privkey?: string | string[];
  requireDleq?: boolean;
  proofsWeHave?: Proof[];
  onCountersReserved?: OnCountersReserved;
};

type MeltProofsConfig = {
  keysetId?: string;
  privkey?: string | string[];
  onCountersReserved?: OnCountersReserved;
};

type KeyChainCache = {
  keysets: KeysetCache[];
  unit: string;
  mintUrl: string;
};

type SecretsPolicy = 'auto' | 'deterministic' | 'random';

type Secret = [SecretKind, SecretData];
type SecretKind = 'P2PK' | 'HTLC' | (string & {});
type SecretData = { nonce: string; data: string; tags?: string[][] };

// Quote states
enum MintQuoteState { UNPAID, PAID, ISSUED }
enum MeltQuoteState { UNPAID, PENDING, PAID }
enum CheckStateEnum { UNSPENT, PENDING, SPENT }
```

### Utility Exports

```ts
// Denomination splitting
function splitAmount(value: AmountLike, keyset: HasKeysetKeys, split?: number[], order?: 'asc' | 'desc'): number[];

// Token encoding/decoding
function getEncodedToken(token: Token): string;
function getDecodedToken(encoded: string): Token;

// Secret parsing (NUT-10)
function parseSecret(secret: string): Secret | undefined;
function parseP2PKSecret(secret: string): Secret | undefined;

// Hashing
function hashToCurve(data: Uint8Array): ProjPointType;

// URL handling
function sanitizeUrl(url: string): string;

// Schnorr
const schnorrSignMessage: (msg, privkey) => string;
const schnorrVerifyMessage: (sig, msg, pubkey, throws?) => boolean;
```
