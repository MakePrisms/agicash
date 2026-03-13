# cashu-ts v3 API Audit for Agicash

## How to read this doc

**Section 1** lists every v3 API we use and confirms our usage is idiomatic.
**Section 2** lists v3 APIs we don't use yet but could adopt in the future.
**Section 3** is the complete v3 API reference (Agicash-relevant subset).

---

## 1. Current Usage

### Wallet Construction & Initialization

| What we do | Where | Idiomatic? |
|------------|-------|------------|
| `getCashuWallet(mintUrl, { unit, bip39seed })` then `loadMintFromCache(mintInfo.cache, keyChainCache)` | `getInitializedCashuWallet` in `shared/cashu.ts` | Yes — v3-preferred cache init pattern. |
| `KeyChain.mintToCacheDTO(unit, mintUrl, keysets, keys)` to build cache | `shared/cashu.ts` | Yes — converts prefetched TanStack Query data to `KeyChainCache`. |
| `getCashuWallet(mintUrl)` for throwaway wallets (subscriptions, test mint check) | `mint-quote-subscription-manager.ts`, `melt-quote-subscription-manager.ts`, `utils.ts` | Works — subscription methods don't need keysets. Fragile but acceptable. |

### Core Operations

| Operation | v3 API used | Where | Idiomatic? |
|-----------|-------------|-------|------------|
| **Melt (send Lightning)** | `wallet.meltProofsIdempotent()` → wraps `meltProofsBolt11()` | `cashu-send-quote-service.ts` | Yes — idempotent wrapper is app-specific. |
| **Melt change reconstruction** | Manual `OutputData.createDeterministicData` + `toProof()` | `cashu-send-quote-service.ts` | Works but verbose — v3 has `prepareMelt()` + `completeMelt()` (see Section 2). |
| **Send swap (split proofs)** | `wallet.ops.send().keyset().asCustom().keepAsCustom().run()` | `cashu-send-swap-service.ts` | Yes — using v3 fluent builder. |
| **Receive swap (claim token)** | `wallet.ops.receive().asCustom().run()` | `cashu-receive-swap-service.ts` | Yes — semantically correct v3 API via builder. |
| **Mint proofs** | `wallet.ops.mintBolt11().keyset().privkey().asCustom().run()` | `cashu-receive-quote-service.ts` | Yes — string quote ID via builder. |
| **Proof selection** | `wallet.selectProofsToSend(proofs, amount, includeFees)` | `cashu-send-quote-service.ts`, `cashu-send-swap-service.ts` | Yes |
| **Fee calculation** | `wallet.getFeesForProofs(proofs)` | multiple files | Yes |
| **Restore** | `wallet.restore(counter, count, { keysetId })` | 3 service files | Yes — signature unchanged in v3. |

### Keyset & Key Management

| What we do | Where | Idiomatic? |
|------------|-------|------------|
| `wallet.getKeyset()` / `wallet.getKeyset(id)` | All 4 service files | Yes — returns `Keyset` directly, no `toMintKeys()` needed. |
| `wallet.keysetId` getter | `cashu-receive-quote-service.ts`, `cashu-receive-swap-service.ts` | Yes |
| `wallet.keyChain.ensureKeysetKeys(id)` | 3 service files | Yes — ensures keys are loaded for historical keysets. |
| `wallet.keyChain.getCheapestKeyset()` | `utils.ts` (fee estimation) | Yes |
| `keyset.keys` (raw `Keys` record) | `utils.ts`, `cashu-send-swap-service.ts` | Yes — direct access, no `toMintKeys()` indirection. |

### Output Data & Counters

| What we do | Where | Idiomatic? |
|------------|-------|------------|
| `OutputData.createDeterministicData(amount, seed, counter, keyset, amounts)` | 5 call sites across 4 service files | Yes — `Keyset` satisfies `HasKeysetKeys` directly. |
| `{ type: 'custom', data: outputData }` via `.asCustom()` builder | send swap, receive swap, mint proofs | Yes — bypasses v3 counter system; we manage counters in DB. |
| `{ type: 'deterministic', counter: N }` | `cashu-send-quote-service.ts` (melt) | Yes — lets v3 handle output creation for melt change. |
| `splitAmount(amount, keyset.keys)` | 3 service files | Yes — v3 export, uses `keyset.keys` directly. |

### Subscriptions & Events

| What we do | Where | Idiomatic? |
|------------|-------|------------|
| `wallet.on.mintQuoteUpdates(ids, cb, errCb)` | `mint-quote-subscription-manager.ts` | Yes |
| `wallet.on.meltQuoteUpdates(ids, cb, errCb)` | `melt-quote-subscription-manager.ts` | Yes |
| `wallet.mint.webSocketConnection?.onClose(cb)` | Both subscription managers | Yes |
| Manual subscription tracking with Map/Set | Both managers | Works — v3 `on.group()` could simplify (see Section 2). |

### Types

| Type | Source | Idiomatic? |
|------|--------|------------|
| `Proof`, `Token`, `MintKeyset`, `MintKeys`, `Keys` | `@cashu/cashu-ts` | Yes |
| `MintQuoteBolt11Response`, `MeltQuoteBolt11Response` | `@cashu/cashu-ts` | Yes |
| `MintQuoteState`, `MeltQuoteState`, `CheckStateEnum` | `@cashu/cashu-ts` | Yes |
| `OutputData`, `splitAmount`, `MintOperationError`, `NetworkError` | `@cashu/cashu-ts` | Yes |
| `MintInfo` class | `@cashu/cashu-ts` | Yes — imported directly. |
| `ProofSchema` (Zod) | `lib/cashu/types.ts` | Correct — v3 doesn't ship Zod schemas. |
| `CashuProtocolUnit` | `lib/cashu/types.ts` | Correct — v3 uses `string` for units. |

---

## 2. v3 APIs to Consider in the Future

### `prepareMelt()` + `completeMelt()` — Replace manual change reconstruction

`cashu-send-quote-service.ts` manually reconstructs change proofs after melt via
`OutputData.createDeterministicData` + `toProof()`. v3's `prepareMelt()` returns a
serializable `MeltPreview` and `completeMelt()` returns `{ quote, change }` directly.

Requires persisting `MeltPreview` — significant refactor but eliminates manual blind
signature math.

### `onceMintPaid` / `onceMeltPaid` — Promise-based quote watching

One-liner replacement for subscription managers in single-quote Lightning flows:
```ts
const paid = await wallet.on.onceMintPaid(quoteId, { signal, timeoutMs });
```

Keep subscription managers for multi-quote batch scenarios.

### `wallet.on.group()` — Composite subscription management

```ts
const cancelAll = wallet.on.group();
cancelAll.add(wallet.on.mintQuoteUpdates(ids, cb, errCb));
cancelAll(); // disposes everything
```

Could replace manual Map-based subscription tracking.

### `groupProofsByState(proofs)` — Proof state grouping

```ts
const { unspent, pending, spent } = await wallet.groupProofsByState(proofs);
```

Single call instead of `checkProofsStates` + manual filtering.

### `KeyChainCache` consolidation

Could replace 3 separate TanStack Query caches (`mintInfo`, `allMintKeysets`, `mintKeys`)
with a single `KeyChainCache` query. Simplifies `getInitializedCashuWallet`.

### `CounterSource` backed by Supabase

Would let v3 manage counter allocation during operations. Deferred — our `{ type: 'custom' }`
pattern works and preserves transactional guarantees.

---

## 3. Complete v3 API Reference (Agicash-relevant subset)

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
