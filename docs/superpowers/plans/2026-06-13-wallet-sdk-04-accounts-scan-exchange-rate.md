# Accounts + Scan + ExchangeRate Domains (`@agicash/wallet-sdk` S4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `accounts`, `scan`, and `exchangeRate` SDK domains with **live wallet-handle resolution** — which front-loads extracting the pure protocol libs (`bolt11`, `lnurl`, `cashu-protocol`, spark stub/errors) and wiring `@cashu/cashu-ts`, so `Account.wallet` becomes a real `ExtendedCashuWallet` / `BreezSdk` handle instead of a `unknown` placeholder.

**Architecture:** S4 ports master's `account-repository.toAccount` faithfully (cashu mint-init + proof decryption; spark connect + balance), replacing the web's TanStack-Query memoization of live handles with **SDK-owned memos** (`SparkWalletService` connects once per network; `CashuWalletService` caches mint metadata per mint URL) added to `SdkConnections`. The three domains receive the shared `DomainContext` (from S3) plus the account/user repositories; `accounts`/`scan`/`exchangeRate` flip from `NotImplementedError` stubs to real while the other 6 stay stubbed. Money-moving machinery (melt/mint subscriptions, the spark balance *listener* with the §8 stale-balance reconcile) stays out — it is S7.

**Tech Stack:** Bun workspaces, TypeScript 5.9.3, `@cashu/cashu-ts@3.6.1`, `light-bolt11-decoder@3.2.0`, `@scure/base@1.2.6`, `ky@1.14.3`, `big.js@7.0.1`, `zod@4.3.6` (`zod/mini`), `@stablelib/base64` (catalog), `@agicash/breez-sdk-spark@0.13.5-1` (already a dep), `@agicash/money`, `@noble/hashes`, `@scure/bip32`/`bip39` (already deps), `bun:test`.

---

## Scope boundary (read first)

**In scope (S4):**
- The pure protocol-lib extraction the live handles require: `internal/lib/bolt11`, `internal/lib/lnurl`, `internal/lib/cashu` (the non-orchestrator subset: `types`, `secret`, `proof`, `protocol-extensions`, `utils`, `token`, `mint-validation`), the small `internal/lib/json` + `internal/lib/zod` helpers, and `internal/lib/spark/errors` + `createSparkWalletStub`. Wiring `@cashu/cashu-ts` into the contract's `types/dependencies.ts` placeholders.
- The **Encryption service** (`internal/crypto/encryption`) — ported from `shared/encryption.ts` (the SDK has only the ECIES *primitives* so far).
- **Live wallet-handle resolution** + the SDK-owned memos: `SparkWalletService`, `CashuWalletService`, and the gift-card-mint `MintAuthTokenProvider` — added to `SdkConnections`.
- The **DB account-detail schemas** (`CashuAccountDetailsDbDataSchema`/`SparkAccountDetailsDbDataSchema`) + `isCashuAccount`/`isSparkAccount` guards in `internal/db`.
- The **AccountRepository** (`get`/`getAllActive`/`create`/`toAccount` + proof decryption) and the account domain helpers (`getAccountBalance`, `canSendToLightning`, `canReceiveFromLightning`, `getExtendedAccounts`, `isDefaultAccount`).
- **`AccountsDomain`** (`list`/`get`/`getDefault`/`add`/`setDefault`/`getBalance`/`suggestFor`) + the net-new `suggestFor` heuristic + `AccountSuggestion`.
- **`ScanDomain.parse`** (the `classify-input` port → `ParsedDestination`).
- **`ExchangeRateDomain`** (`getRates`/`getRate`/`convert`) — the §6 contract delta + vendored service + 3 providers.
- Wiring `accounts` + `scan` + `exchangeRate` into `Sdk` and the `SdkConnections` additions into `buildConnections`. The `account:updated` / `user:updated` emissions for `add` / `setDefault`.

**Out of scope (later slices):**
- cashu send/receive **operations** + the melt/mint **subscription managers** (S5); spark send/receive ops (S6).
- The orchestrator incl. the spark balance **listener** with the §8 `synced` stale-balance reconcile and the nutshell-#788 change refetch (S7).
- The `cashuMintValidator` **instance** + its env-backed blocklist config (the `mint-validation` *lib* is vendored here because S5 needs it, but no validator is constructed/called in S4 — master's account wallet-init + `addCashuAccount` never call it). `cashuMintBlocklist` config lands in S5.
- transactions/contacts/transfers (S8), background/realtime (S9), `ServerSdk` (S10), web cut-over (S11–S15).
- LNURL-pay *resolution* (`getInvoiceFromLud16`) is used by sends (S5/S6); S4 vendors the `lnurl` lib (scan needs `buildLightningAddressFormatValidator`) but wires no resolution path.
- The web stays **untouched** (dark build); S4 is verified by SDK unit tests alone.

---

## Decisions (locked)

- **D4-1 — Front-load the protocol-lib extraction + build live `Account.wallet` handles, in one plan (owner, this session).** Rationale: `Account.wallet` is non-optional and `list`/`get`/`add` must return real accounts; scan's `extractCashuToken` already forces `@cashu/cashu-ts` + part of `lib/cashu` into S4; the libs are leaf, framework-free, and needed by S5/S6 anyway; building accounts once (vs. a deferred `WalletInitializer` port retrofitted in S5+S6) keeps the type story honest and verifies the money-adjacent construction early.
- **D4-2 — SDK-owned handle memos replace TanStack memoization (no-cache).** `SparkWalletService` connects Breez **once per network** (single-flight; a failed connect is *not* cached so the next call retries). `CashuWalletService` caches **mint metadata per mint URL** (mirrors master's 1h-staleTime mint-info/keysets/keys queries) and rebuilds the cheap `ExtendedCashuWallet` per call. Both live on `SdkConnections` (instance lifetime).
- **D4-3 — Wallet services take injected connect/fetch functions (DI over `mock.module`).** `SparkWalletService` is constructed with a `connect(network)` fn; `CashuWalletService` with a `fetchMintMetadata(mintUrl)` fn. Unit tests pass fakes — so these tests need **no** `mock.module` on `@cashu/cashu-ts` / `@agicash/breez-sdk-spark`, sidestepping bun's global-mock hazard. `buildConnections` supplies the real fns.
- **D4-4 — De-dup the spark lib.** Do **not** re-vendor `lib/spark/wasm.ts` or `getSparkIdentityPublicKeyFromMnemonic` — S2's `internal/connections/breez.ts` already has `initBreezWasm` + `getSparkIdentityPublicKey`. Only `createSparkWalletStub` (the offline Proxy stub) and `lib/spark/errors.ts` (used by S6) are net-new here.
- **D4-5 — `suggestFor` is a pure, net-new heuristic over the passed accounts.** Filter by ability (`send` → `canSendToLightning`; `receive`/`token-receive` → `canReceiveFromLightning`); among candidates, partition by **same-currency** sufficient balance; rank `offer` > `gift-card` > input-array order; `recommended` = the top sufficient candidate, else throw `DomainError`. It does **not** resolve the user's default (it has no user context — the caller orders accounts default-first) and does **not** do gift-card-config destination matching (that stays web-side per spec §11). `alternatives` = other sufficient candidates; `insufficient` = ability-matched but under-funded.
- **D4-6 — ExchangeRate contract delta mirrors Plan 03.** Add `getRates`/`getRate` + the `Ticker`/`Rates` types (§6); `convert` = `getRate(\`${amount.currency}-${to}\`)` then `amount.convert(to, rate)` (`Money.convert` exists). Service + 3 providers are vendored verbatim (already framework-free).
- **D4-7 — scan `MODE` → config.** `SdkConfig.allowLocalhostLightningAddress?: boolean` (default `false` = production behavior) replaces `classify-input.ts`'s `import.meta.env.MODE === 'development'`.
- **CI gate:** `bun run typecheck` + `bun run test` (NOT `fix:all`). Commit per task locally; do not push.

---

## Grounding facts (verified 2026-06-16 — authoritative)

**SDK shapes S4 builds on (re-verified):**
- `Sdk` (`src/sdk.ts`): `protected constructor(config, connections)`; `static async create(config)` → `buildConnections(config)`; domains field-initialized (`auth`/`user` real, the other 9 are `notImplementedDomain` stubs); `private readonly emitter`, constructor builds a `DomainContext = { config, connections, emitter }` and assigns `this.user`/`this.auth`.
- `SdkConnections` (`src/internal/connections/index.ts`): `{ supabase: SupabaseClient<Database>; session: SupabaseSessionTokenProvider; realtime: SupabaseRealtimeManager; keys: KeyProvider }`, built by `buildConnections(config)` (configures OpenSecret, builds session/supabase/realtime/keys).
- `DomainContext` (`src/domains/context.ts`): `{ config: SdkConfig; connections: SdkConnections; emitter: SdkEventEmitter<SdkEventMap> }`.
- `KeyProvider` (`src/internal/crypto/keys.ts`): `getChildMnemonic(path): Promise<string>`, `getPrivateKeyBytes(path): Promise<Uint8Array>`, `getPublicKeyHex(path, 'schnorr'|'ecdsa'): Promise<string>`. Constants: `CASHU_MNEMONIC_PATH = "m/83696968'/39'/0'/12'/0'"`, `SPARK_MNEMONIC_PATH = "m/83696968'/39'/0'/12'/1'"`, `ENCRYPTION_KEY_PATH = "m/10111099'/0'"`.
- `breez.ts` exports `initBreezWasm`, `tryInitLogging`, `connectBreez(cfg: { apiKey; network: 'mainnet'|'regtest'; storageDir; debugLogging? }, mnemonic): Promise<BreezSdk>`, `getSparkIdentityPublicKey`, `WebAssemblyUnavailableError`.
- `internal/lib/ecies/ecies.ts` exports `eciesEncrypt`, `eciesEncryptBatch`, `eciesDecrypt`, `eciesDecryptBatch` (the SDK has the ECIES *primitives* but **no** higher-level `Encryption` service).
- `classify(error)`, `errors.ts` (`SdkError`/`DomainError`/`ConcurrencyError`/`NotFoundError`/`NotImplementedError`), `notImplementedDomain`, `SdkEventEmitter`, `UserRepository` (`get`/`getByUsername`/`update`/`upsert`), `toUser` — all from S2/S3.
- `internal/test-support.ts`: `makeFakeDb({selectResult, updateResult, rpcResult, calls})`, `inMemoryStorage(seed?)`, `jwtWith({sub?, exp?})`.
- `SdkConfig` (`src/config.ts`) today: `openSecret`, `supabase`, `breezApiKey?: string`, `storage`, `defaultAccounts?: DefaultAccountConfig[]`, `clientId?`. **No** `sparkStorageDir`/`debugLoggingSpark`/`allowLocalhostLightningAddress` yet (S4 adds them). **No** `featureFlags`/`cashuMintBlocklist` yet (later slices).
- `events.ts`: `'account:updated': { account: Account; op: 'created' | 'updated' }`; `'user:updated': { user: User }`.

**Contract surfaces S4 implements (`src/domains.ts`, re-verified):**
- `AccountsDomain`: `list(): Promise<Account[]>` · `get(id): Promise<Account|null>` · `getDefault(params?: {currency?: Currency}): Promise<Account|null>` · `add(config: AddAccountConfig): Promise<Account>` · `setDefault(account: Account): Promise<void>` · `getBalance(account: Account): Promise<Money>` · `suggestFor(intent: PaymentIntent, accounts: Account[]): Promise<AccountSuggestion>`.
- `ScanDomain`: `parse(input: string): Promise<ParsedDestination>`.
- `ExchangeRateDomain`: today only `convert(params: {amount: Money; to: Currency}): Promise<Money>` (with a `TODO(post-PR1)`); S4 adds `getRates`/`getRate` (§6).
- `AddAccountConfig` (`types/account-config.ts`): `{ type:'cashu'; mintUrl; currency; name? } | { type:'spark'; currency; name? }`.
- `AccountSuggestion` (`types/account-config.ts`): `{ recommended: Account; alternatives: Account[]; insufficient: Account[]; reason: string }`.
- `ParsedDestination` (`types/scan.ts`): `{ kind:'bolt11'; invoice: Bolt11Invoice } | { kind:'ln-address'; address: string } | { kind:'cashu-token'; token: ParsedToken }`.
- `PaymentIntent` (`types/scan.ts`): `{ kind:'send'; destination: ParsedDestination; amount? } | { kind:'receive'; amount? } | { kind:'token-receive'; token: string }`.
- `Account` / `CashuAccount` / `SparkAccount` (`types/account.ts`): `wallet` is non-optional — `ExtendedCashuWallet` (cashu) / `BreezSdk` (spark), both `unknown` placeholders today (Task 6 wires them real). `CashuProof` already a hand-written type.

**`types/dependencies.ts` placeholders to wire real in Task 6 (each carries its TODO):** `BreezSdk = unknown` → `@agicash/breez-sdk-spark`; `ExtendedCashuWallet = unknown` → `internal/lib/cashu`; `ParsedToken`/`CashuProtocolProof`/`ProofDleq`/`ProofWitness` → `@cashu/cashu-ts`; `Bolt11Invoice` (already the full `DecodedBolt11` shape) → `internal/lib/bolt11`'s `DecodedBolt11`; `DistributedOmit` → `type-fest`. `SparkNetwork = 'MAINNET'|'REGTEST'` stays (already concrete).

**Web behaviour S4 reproduces (verified; web stays untouched):**
- `account-repository.ts` `toAccount(data)`: common fields + `isCashuAccount` → `Promise.all([getInitializedCashuWallet(mint_url, currency, purpose), decryptCashuProofs(data)])` → cashu `Account`; `isSparkAccount` → `getInitializedSparkWallet(network)` → spark `Account`. `getAllActive(userId)` selects `accounts` join `cashu_proofs(*)` filtered `state='active'` + `cashu_proofs.state='UNSPENT'`, then `Promise.all(data.map(toAccount))`. `create` parses details via the json-model schemas, inserts, returns `toAccount`.
- `getInitializedCashuWallet` (`shared/cashu.ts`): race `[mintInfo, keysets, keys]` fetch vs a 10s timeout (rejects `NetworkError`); on `NetworkError` → `{ wallet: getCashuWallet(mintUrl,{unit,bip39seed,authProvider}), isOnline:false }`; else pick the active keyset for the unit, `wallet.loadMintFromCache(mintInfo.cache, KeyChain.mintToCacheDTO(wallet.unit, mintUrl, keysets, [activeKeys]))`, `{ wallet, isOnline:true }`. `getMintAuthProvider(purpose)` = gift-card/offer → `getAgicashMintAuthProvider()` else `undefined`.
- `getInitializedSparkWallet` (`shared/spark.ts`): connect (memoized) → `getInfo({})` → `balance = Money({amount: info.balanceSats, currency:'BTC', unit:'sat'})`, `isOnline:true`; on error → `{ wallet: createSparkWalletStub('Spark is offline, please try again later.'), balance:null, isOnline:false }`.
- `decryptCashuProofs`: `encryption.decryptBatch(cashu_proofs.flatMap(p => [p.amount, p.secret]))` → for each proof `{ amount: z.number().parse(...), secret: z.string().parse(...), dleq: ProofSchema.shape.dleq.parse(dbProof.dleq), witness: ProofSchema.shape.witness.parse(dbProof.witness), ... }`.
- `account.ts` helpers: `getAccountBalance` (cashu = `Money(sumProofs(proofs), currency, getCashuUnit(currency))`; spark = `account.balance`); `canSendToLightning` (spark → true; cashu → `!isTestMint && purpose==='transactional' && isOnline && !wallet.getMintInfo().isSupported(5).disabled`); `canReceiveFromLightning` (spark → true; cashu → `!isTestMint && isOnline && !wallet.getMintInfo().isSupported(4).disabled`).
- `account-service.ts`: `isDefaultAccount(user, account)` (BTC → `user.defaultBtcAccountId===account.id`; USD → `user.defaultUsdAccountId===account.id`); `getExtendedAccounts(user, accounts)` (map `isDefault`, sort default-first); `addCashuAccount` (`checkIsTestMint(mintUrl)`; if `purpose==='offer'` derive `expiresAt` from the active keyset; `create({...account, isTestMint, expiresAt, keysetCounters:{}})`).
- `user-service.ts` `setDefaultAccount(user, account, {setDefaultCurrency?})`: `userRepository.update(user.id, { defaultCurrency: setDefaultCurrency ? account.currency : user.defaultCurrency, defaultBtcAccountId: account.currency==='BTC' ? account.id : user.defaultBtcAccountId, defaultUsdAccountId: account.currency==='USD' ? account.id : user.defaultUsdAccountId })`. Throws `'Unsupported currency'` if not BTC/USD.
- `account-hooks.ts` `useDefaultAccount`: default = account whose id matches the user's `defaultBtcAccountId` (BTC) / `defaultUsdAccountId` (USD) for the requested currency; fallback to first account of that currency.
- `classify-input.ts` `classifyInput(raw)`: trim → `extractCashuToken` → `{direction:'receive', type:'cashu-token', encoded}`; else `parseBolt11Invoice` valid → `{direction:'send', type:'bolt11', invoice:encoded, decoded}`; else lowercase + `validateLnAddressFormat` true → `{direction:'send', type:'ln-address', address}`; else `null`. The validator is built with `allowLocalhost: import.meta.env.MODE === 'development'`.
- `exchange-rate-service.ts`: `getRates({tickers, signal})` resolves same-ticker (`X-X`→`'1'`) then queries the first provider supporting all remaining tickers (priority `MempoolSpace`, `Coingecko`, `Coinbase`); `getRate(ticker, signal?)` = `getRates([ticker])[ticker]`. Providers use `ky` + `big.js`; framework-free.
- `Money.convert<U>(currency: U, exchangeRate)` exists (`packages/money/src/money.ts:625`); rate is in source/target format.

**External dep versions (from `apps/web-wallet/package.json` / `bun.lock`):** `@cashu/cashu-ts@3.6.1`, `light-bolt11-decoder@3.2.0`, `@scure/base@1.2.6` (top-level resolved), `ky@1.14.3`, `big.js@7.0.1` (+ `@types/big.js@6.2.2`), `zod@4.3.6`, `@stablelib/base64` (`catalog:`). Already SDK deps: `@noble/hashes@1.8.0`, `@noble/curves@1.9.7`, `@scure/bip32@1.7.0`, `@scure/bip39@1.6.0`, `type-fest@5.4.3`, `@agicash/breez-sdk-spark@0.13.5-1`.

**Lib couplings (grep-verified):** `lib/bolt11`, `lib/lnurl`, `lib/cashu` (token/proof/secret/types/protocol-extensions/utils/mint-validation), `lib/spark`, and `lib/exchange-rate` have **no** `import.meta.env` / `window` / `react` / `@tanstack` couplings. The ONLY coupled file is `agicash-mint-auth-provider.ts` (uses `getQueryClient().fetchQuery(...)` for token caching → Task 10 reimplements as a `MintAuthTokenProvider` mirroring `SupabaseSessionTokenProvider`). `lib/cashu/secret.ts` imports `../json#safeJsonParse`; `lib/cashu/types.ts` imports `../zod#nullToUndefined` → vendor both helpers (Task 5).

---

## File Structure

**Created (SDK):**
- `src/types/exchange-rate.ts` — `Ticker`, `Rates` (public types).
- `src/internal/lib/bolt11/index.ts` (+ `.test.ts`) — vendored.
- `src/internal/lib/lnurl/index.ts` + `types.ts` (+ `.test.ts`) — vendored.
- `src/internal/lib/json.ts`, `src/internal/lib/zod.ts` — vendored helpers.
- `src/internal/lib/cashu/{types,secret,proof,protocol-extensions,utils,token,mint-validation,index}.ts` (+ ported tests) — vendored.
- `src/internal/lib/spark/errors.ts` — vendored.
- `src/internal/crypto/encryption.ts` (+ `.test.ts`) — `getEncryption` + `EncryptionService`.
- `src/internal/db/account-details.ts` (+ `.test.ts`) — detail schemas + `isCashuAccount`/`isSparkAccount`.
- `src/internal/connections/spark-wallet.ts` (+ `.test.ts`) — `SparkWalletService` + `createSparkWalletStub`.
- `src/internal/connections/cashu-wallet.ts` (+ `.test.ts`) — `CashuWalletService`.
- `src/internal/connections/mint-auth.ts` (+ `.test.ts`) — `MintAuthTokenProvider`, `getAgicashMintAuthProvider`, `getMintAuthProvider`.
- `src/internal/repositories/account-repository.ts` (+ `.test.ts`) — `AccountRepository`.
- `src/domains/accounts/account-utils.ts` (+ `.test.ts`) — balance/ability/extended/default helpers.
- `src/domains/accounts/suggest.ts` (+ `.test.ts`) — `suggestForAccounts`.
- `src/domains/accounts/accounts-domain.ts` (+ `.test.ts`) — `createAccountsDomain`.
- `src/domains/scan/scan-domain.ts` (+ `.test.ts`) — `createScanDomain`.
- `src/domains/exchange-rate/{exchange-rate-service,providers/coinbase,providers/coingecko,providers/mempool-space,providers/types}.ts` (+ ported service test) + `exchange-rate-domain.ts` (+ `.test.ts`) — vendored + domain.

**Modified (SDK):**
- `src/domains.ts` — amend `ExchangeRateDomain` (§6 delta).
- `src/config.ts` — add `sparkStorageDir?`, `debugLoggingSpark?`, `allowLocalhostLightningAddress?`.
- `src/index.ts` — export `Ticker`, `Rates`.
- `src/types/dependencies.ts` — wire placeholders to real types (Task 6).
- `src/internal/db/database.ts` — re-export the new account-detail guards/schemas (or keep in `account-details.ts` and import where needed).
- `src/internal/connections/index.ts` — extend `SdkConnections` + `buildConnections` (Task 17).
- `src/sdk.ts` — wire `accounts`/`scan`/`exchangeRate` (Task 17).
- `src/sdk.test.ts` — assert the three domains are real (Task 17).
- `packages/wallet-sdk/package.json` — add the external deps (Task 2).

---

## Task 1: ExchangeRate contract delta + config additions (types only)

**Files:** Create `src/types/exchange-rate.ts`; modify `src/domains.ts`, `src/config.ts`, `src/index.ts`.

- [ ] **Step 1: Create the public exchange-rate types** (`src/types/exchange-rate.ts`):

```ts
/**
 * Exchange-rate types — §6 contract delta (multi-provider rate surface).
 *
 * Lifted from `app/lib/exchange-rate/providers/types.ts`. A `Ticker` is a
 * `${from}-${to}` currency pair (e.g. `'BTC-USD'`); `Rates` maps each requested
 * ticker to its rate string at a `timestamp`.
 */

/** A currency pair, formatted `${from}-${to}` (e.g. `'BTC-USD'`, `'USD-BTC'`). */
export type Ticker = `${string}-${string}`;

/** A set of fetched rates: each ticker → its rate string, plus the fetch `timestamp`. */
export type Rates = {
  timestamp: number;
  [ticker: Ticker]: string;
};
```

- [ ] **Step 2: Amend `ExchangeRateDomain`** in `src/domains.ts`. Add the import (with the other `./types/*` imports):

```ts
import type { Rates, Ticker } from './types/exchange-rate';
```

Replace the entire `export interface ExchangeRateDomain { … }` block (the one with the `TODO(post-PR1)`) with:

```ts
/** Fiat/BTC exchange-rate conversion (multi-provider). */
export interface ExchangeRateDomain {
  /** Convert `amount` into the `to` currency at the current rate. */
  convert(params: { amount: Money; to: Currency }): Promise<Money>;
  /** Fetch the current rate(s) for the given ticker(s) (e.g. `'BTC-USD'`). */
  getRates(params: { tickers: Ticker[] }): Promise<Rates>;
  /** Fetch a single current rate string for `ticker`. */
  getRate(ticker: Ticker): Promise<string>;
}
```

- [ ] **Step 3: Add the config fields** in `src/config.ts`, inside `SdkConfig` after `breezApiKey`:

```ts
  /** Storage directory for the Spark/Breez SDK (default `./.spark-data`; server uses `/tmp/.spark-data`). */
  sparkStorageDir?: string;
  /** Enable verbose Breez SDK logging (maps the web's `DEBUG_LOGGING_SPARK` flag). */
  debugLoggingSpark?: boolean;
  /**
   * Allow `localhost` Lightning addresses when parsing scanned input (dev only;
   * replaces the web's `import.meta.env.MODE === 'development'`). Default false.
   */
  allowLocalhostLightningAddress?: boolean;
```

- [ ] **Step 4: Export the new types** in `src/index.ts` — add near the scan/account type exports:

```ts
export type { Ticker, Rates } from './types/exchange-rate';
```

- [ ] **Step 5: Verify + commit.** Run `bun run typecheck` → PASS (the `notImplementedDomain<ExchangeRateDomain>` Proxy still satisfies the widened interface; new config fields are optional). Run `bun --filter=@agicash/wallet-sdk run test` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): exchangeRate §6 contract delta + S4 config flags

Widen ExchangeRateDomain (getRates/getRate + Ticker/Rates types) and add the
config flags S4 needs (sparkStorageDir, debugLoggingSpark,
allowLocalhostLightningAddress). Types only — domains stay stubbed; gate green.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add the external protocol-lib deps

**Files:** Modify `packages/wallet-sdk/package.json`.

- [ ] **Step 1: Add the runtime deps** to `dependencies` (keep alphabetical):

```
"@cashu/cashu-ts": "3.6.1",
"@scure/base": "1.2.6",
"@stablelib/base64": "catalog:",
"big.js": "7.0.1",
"ky": "1.14.3",
"light-bolt11-decoder": "3.2.0",
"zod": "4.3.6"
```

Add to `devDependencies`:

```
"@types/big.js": "6.2.2"
```

- [ ] **Step 2: Install.** Run `bun install`. Expected: resolves all from the workspace/registry (most already present transitively), updates `bun.lock`. (`@scure/base@1.2.6` is the workspace top-level resolution; `@stablelib/base64` resolves via the catalog, matching the web.)

- [ ] **Step 3: Verify nothing regressed.** Run `bun run typecheck` → PASS and `bun --filter=@agicash/wallet-sdk run test` → PASS (nothing imports the new deps yet).

- [ ] **Step 4: Commit.**

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): add cashu/bolt11/lnurl/exchange-rate runtime deps

Add @cashu/cashu-ts, light-bolt11-decoder, @scure/base, ky, big.js, zod, and
@stablelib/base64 — the leaf protocol libs S4 vendors for live wallet-handle
resolution + scan + exchange rates. Nothing imports them yet.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Vendor the `bolt11` lib

**Files:** Create `src/internal/lib/bolt11/index.ts` + `.test.ts`.

- [ ] **Step 1: Copy verbatim.** Copy `apps/web-wallet/app/lib/bolt11/index.ts` → `packages/wallet-sdk/src/internal/lib/bolt11/index.ts`. It is framework-free; its imports (`@noble/curves/secp256k1`, `@noble/hashes/sha2`, `@noble/hashes/utils`, `@scure/base#bech32`, `light-bolt11-decoder`) all resolve against the deps added in Task 2. **No edits needed** beyond the copy (no relative imports, no couplings).

```bash
cp apps/web-wallet/app/lib/bolt11/index.ts packages/wallet-sdk/src/internal/lib/bolt11/index.ts
```

- [ ] **Step 2: Port the test.** Copy `apps/web-wallet/app/lib/bolt11/bolt11.test.ts` → `packages/wallet-sdk/src/internal/lib/bolt11/index.test.ts`, fixing the import path to `./index` (or `from './index'`). Keep all cases verbatim.

```bash
cp apps/web-wallet/app/lib/bolt11/bolt11.test.ts packages/wallet-sdk/src/internal/lib/bolt11/index.test.ts
```
Then update the import line in the copied test to `import { … } from './index';` (it referenced `./index` or `~/lib/bolt11` in the web — point it at `./index`).

- [ ] **Step 3: Verify + commit.** `bun --filter=@agicash/wallet-sdk run test` → bolt11 cases PASS. `bun run typecheck` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): vendor bolt11 decode lib

Copy the framework-free bolt11 invoice parser (parseBolt11Invoice/decodeBolt11 +
DecodedBolt11) verbatim from app/lib/bolt11; port its test. Needed by scan and
later send flows; backs the contract's Bolt11Invoice type.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Vendor the `lnurl` lib

**Files:** Create `src/internal/lib/lnurl/index.ts` + `src/internal/lib/lnurl/types.ts` + `index.test.ts`.

- [ ] **Step 1: Copy verbatim.** Copy both files (framework-free; deps `@agicash/money` + `ky`, both available):

```bash
cp apps/web-wallet/app/lib/lnurl/types.ts packages/wallet-sdk/src/internal/lib/lnurl/types.ts
cp apps/web-wallet/app/lib/lnurl/index.ts packages/wallet-sdk/src/internal/lib/lnurl/index.ts
```

The exported `buildLightningAddressFormatValidator({ message, allowLocalhost })` already takes `allowLocalhost` as a parameter — **no env coupling inside the lib**; the scan domain (Task 15) passes the value from config. Leave the lib unchanged.

- [ ] **Step 2: Write a focused test** (`src/internal/lib/lnurl/index.test.ts`) covering the format validator (the piece scan uses):

```ts
import { describe, expect, it } from 'bun:test';
import { buildLightningAddressFormatValidator } from './index';

describe('buildLightningAddressFormatValidator', () => {
  const validate = buildLightningAddressFormatValidator({
    message: 'invalid',
    allowLocalhost: false,
  });

  it('accepts a well-formed lightning address', () => {
    expect(validate('alice@agi.cash')).toBe(true);
  });

  it('rejects a non-address string', () => {
    expect(validate('not-an-address')).not.toBe(true);
  });

  it('rejects localhost when allowLocalhost is false', () => {
    expect(validate('alice@localhost')).not.toBe(true);
  });

  it('accepts localhost when allowLocalhost is true', () => {
    const dev = buildLightningAddressFormatValidator({
      message: 'invalid',
      allowLocalhost: true,
    });
    expect(dev('alice@localhost')).toBe(true);
  });
});
```

(If the validator returns a string message rather than `false` on failure, `not.toBe(true)` still holds — verify the exact return contract against the copied `index.ts` and adjust the assertions to match its actual `true | string` shape.)

- [ ] **Step 3: Verify + commit.** `bun --filter=@agicash/wallet-sdk run test` → PASS. `bun run typecheck` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): vendor lnurl lib

Copy the framework-free lnurl helpers verbatim from app/lib/lnurl (format
validator used by scan; lud16 resolution used by later send flows). Add a
focused format-validator test (allowLocalhost gating).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Vendor the `cashu-protocol` lib (+ json/zod helpers)

**Files:** Create `src/internal/lib/json.ts`, `src/internal/lib/zod.ts`, `src/internal/lib/cashu/{types,secret,proof,protocol-extensions,utils,token,mint-validation,index}.ts` + ported tests.

- [ ] **Step 1: Vendor the two small helpers** that the cashu lib imports transitively:

```bash
cp apps/web-wallet/app/lib/json.ts packages/wallet-sdk/src/internal/lib/json.ts
cp apps/web-wallet/app/lib/zod.ts packages/wallet-sdk/src/internal/lib/zod.ts
```

(`json.ts#safeJsonParse`, `zod.ts#nullToUndefined`; both framework-free — `zod.ts` imports `zod/mini`.)

- [ ] **Step 2: Vendor the cashu-protocol subset.** Copy these eight files verbatim, preserving relative imports (they import each other + `../json`/`../zod`, which now sit one level up at `internal/lib/`):

```bash
for f in types secret proof protocol-extensions utils token mint-validation index; do
  cp "apps/web-wallet/app/lib/cashu/$f.ts" "packages/wallet-sdk/src/internal/lib/cashu/$f.ts"
done
```

Then **trim `index.ts`** to the S4 subset — remove the re-exports of the orchestrator-only modules that are NOT vendored here (they land in S5): delete the `export * from './payment-request';`, `export * from './melt-quote-subscription';`, `export * from './melt-quote-subscription-manager';`, and `export * from './mint-quote-subscription-manager';` lines. The remaining barrel is:

```ts
export * from './proof';
export * from './secret';
export * from './token';
export * from './utils';
export * from './error-codes';
export { ExtendedMintInfo, type MintPurpose } from './protocol-extensions';
export { ProofSchema } from './types';
```

Also copy `error-codes.ts` (referenced by the barrel; framework-free):

```bash
cp apps/web-wallet/app/lib/cashu/error-codes.ts packages/wallet-sdk/src/internal/lib/cashu/error-codes.ts
```

Fix any `~/lib/...` alias imports inside the copied files to relative paths (e.g. `~/lib/json` → `../json`). Verify no copied file imports `~/features/...`, `react`, `@tanstack`, or `import.meta` (grep confirmed clean for these eight; the only such imports live in the orchestrator files we did NOT copy).

- [ ] **Step 3: Port the lib tests.** Copy the existing colocated tests for the vendored files, fixing import paths to `./`:

```bash
cp apps/web-wallet/app/lib/cashu/proof.test.ts packages/wallet-sdk/src/internal/lib/cashu/proof.test.ts
cp apps/web-wallet/app/lib/cashu/secret.test.ts packages/wallet-sdk/src/internal/lib/cashu/secret.test.ts
cp apps/web-wallet/app/lib/cashu/token.test.ts packages/wallet-sdk/src/internal/lib/cashu/token.test.ts
```

In each, repoint imports from `~/lib/cashu/*` to the local `./*`. Do **not** copy `payment-request.test.ts` (its module is S5). If `token.test.ts` exercises network calls (`getUnspentProofsFromToken` calls `wallet.checkProofsStates`), keep only the offline cases (`extractCashuToken`, `encodeToken`/`getTokenHash` round-trips) and delete any case that hits a mint — note the deletion in the commit body.

- [ ] **Step 4: Verify + commit.** `bun --filter=@agicash/wallet-sdk run test` → cashu lib cases PASS. `bun run typecheck` → PASS (the lib typechecks against `@cashu/cashu-ts@3.6.1` + `zod/mini`).

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): vendor cashu-protocol lib (non-orchestrator subset)

Copy the framework-free cashu lib subset from app/lib/cashu — types, secret,
proof, protocol-extensions (ExtendedMintInfo), utils (ExtendedCashuWallet,
getCashuWallet, unit + keyset helpers, normalizeMintUrl), token, mint-validation,
error-codes — plus the json/zod helpers. Trim the barrel to exclude the
melt/mint subscription managers + payment-request (S5). Port proof/secret/token
tests (offline cases). Backs the live cashu Account.wallet handle.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Wire `types/dependencies.ts` placeholders to real types

**Files:** Modify `src/types/dependencies.ts`.

- [ ] **Step 1: Replace the external-package + lib placeholders.** In `src/types/dependencies.ts`, replace the placeholder type aliases with real imports/re-exports. The file currently defines `BreezSdk = unknown`, `ExtendedCashuWallet = unknown`, `CashuProtocolProof = unknown`, `ProofDleq = unknown`, `ProofWitness = unknown`, `Bolt11Invoice = {…}` (a full inline shape), `ParsedToken = {…}`, `DistributedOmit<…>`, `Json`. Rewrite the external/lib-backed ones as:

```ts
import type { Proof, TokenMetadata } from '@cashu/cashu-ts';
import type { DistributedOmit as TypeFestDistributedOmit } from 'type-fest';
import type { DecodedBolt11 } from '../internal/lib/bolt11';
import type { ExtendedCashuWallet as RealExtendedCashuWallet } from '../internal/lib/cashu';

export type { BreezSdk } from '@agicash/breez-sdk-spark';

/** Live cashu wallet handle (mint info / keysets / keys / seed) held on a cashu `Account`. */
export type ExtendedCashuWallet = RealExtendedCashuWallet;

/** A raw cashu-ts protocol `Proof` (distinct from the domain `CashuProof`). */
export type CashuProtocolProof = Proof;
/** The `dleq` / `witness` sub-fields of a cashu-ts `Proof`. */
export type ProofDleq = Proof['dleq'];
export type ProofWitness = Proof['witness'];

/** Decoded BOLT11 invoice carried by a `bolt11` `ParsedDestination`. */
export type Bolt11Invoice = DecodedBolt11;

/** Parsed cashu token metadata carried by a `cashu-token` `ParsedDestination`. */
export type ParsedToken = { encoded: string; metadata: TokenMetadata };

/** `DistributedOmit` distributes `Omit` over a union (each member omits `K`). */
export type DistributedOmit<T, K extends PropertyKey> = TypeFestDistributedOmit<
  T,
  K
>;
```

Keep `SparkNetwork = 'MAINNET' | 'REGTEST'` and `Json` as-is (already concrete). Delete the now-obsolete `TODO(Slice-*)` comments for the wired types; keep a one-line JSDoc on each.

> Note: the contract's `Bolt11Invoice` placeholder shape (amountMsat/amountSat/createdAtUnixMs/expiryUnixMs/network/description/payeeNodeKey/paymentHash) is identical to the lib's `DecodedBolt11` (verified), so `ParsedDestination`/`PaymentIntent` consumers are unaffected.

- [ ] **Step 2: Verify the account/scan types still hold.** Run `bun run typecheck`. Expected: PASS. `types/account.ts` now has a real `wallet: ExtendedCashuWallet` (an `@cashu/cashu-ts` `Wallet` subclass) and `wallet: BreezSdk`; `types/scan.ts` has a real `Bolt11Invoice`/`ParsedToken`. If `@cashu/cashu-ts`'s `Proof['dleq']`/`['witness']` differ structurally from the hand-written `CashuProof.dleq/witness` (`types/account.ts`) and the compiler complains, reconcile `types/account.ts`'s `dleq`/`witness` field types to `ProofDleq`/`ProofWitness` (they already reference these placeholders) — no value change.

- [ ] **Step 3: Run the full suite + commit.** `bun --filter=@agicash/wallet-sdk run test` → PASS. `bun run typecheck` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): wire dependencies.ts placeholders to real types

Replace the PR1 `unknown`/inline placeholders with real types now that the libs
+ packages are in: BreezSdk + Proof (dleq/witness) from the SDKs, ExtendedCashuWallet
from internal/lib/cashu, Bolt11Invoice from internal/lib/bolt11, DistributedOmit
from type-fest. Account.wallet is now a live handle type.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: DB account-detail schemas + type guards

**Files:** Create `src/internal/db/account-details.ts` + `.test.ts`.

- [ ] **Step 1: Implement** (`src/internal/db/account-details.ts`) — port the json-model schemas + the row type guards (the web's live in `agicash-db/json-models/*` + `agicash-db/database.ts`):

```ts
import { z } from 'zod/mini';
import type { AgicashDbAccount, AgicashDbAccountWithProofs } from './database';

/** `wallet.accounts.details` for a cashu account. */
export const CashuAccountDetailsDbDataSchema = z.object({
  mint_url: z.string(),
  is_test_mint: z.boolean(),
  keyset_counters: z.record(z.string(), z.number()),
});
export type CashuAccountDetailsDbData = z.infer<
  typeof CashuAccountDetailsDbDataSchema
>;

/** `wallet.accounts.details` for a spark account. */
export const SparkAccountDetailsDbDataSchema = z.object({
  network: z.enum(['MAINNET', 'REGTEST']),
});
export type SparkAccountDetailsDbData = z.infer<
  typeof SparkAccountDetailsDbDataSchema
>;

/** The DB account row narrowed to cashu, with `details` parsed. */
export type CashuDbAccount = AgicashDbAccountWithProofs & {
  type: 'cashu';
  details: CashuAccountDetailsDbData;
};
/** The DB account row narrowed to spark, with `details` parsed. */
export type SparkDbAccount = AgicashDbAccountWithProofs & {
  type: 'spark';
  details: SparkAccountDetailsDbData;
};

/** True if the DB account row is a cashu account (and narrows `details`). */
export function isCashuAccount(
  account: AgicashDbAccount | AgicashDbAccountWithProofs,
): account is CashuDbAccount {
  return account.type === 'cashu';
}

/** True if the DB account row is a spark account (and narrows `details`). */
export function isSparkAccount(
  account: AgicashDbAccount | AgicashDbAccountWithProofs,
): account is SparkDbAccount {
  return account.type === 'spark';
}
```

> Reconcile the narrowed `details` against the generated `AgicashDbAccount['details']` type when implementing — if the generated type already unions the two detail shapes, the guards can narrow directly; otherwise cast `details` through `CashuAccountDetailsDbDataSchema.parse` inside the repository. Read `internal/db/database.ts` (the `AgicashDbAccount`/`AgicashDbAccountWithProofs` definitions) before finalizing.

- [ ] **Step 2: Write the test** (`account-details.test.ts`):

```ts
import { describe, expect, it } from 'bun:test';
import {
  CashuAccountDetailsDbDataSchema,
  SparkAccountDetailsDbDataSchema,
  isCashuAccount,
  isSparkAccount,
} from './account-details';

describe('account-details', () => {
  it('parses cashu details', () => {
    const parsed = CashuAccountDetailsDbDataSchema.parse({
      mint_url: 'https://mint.test',
      is_test_mint: false,
      keyset_counters: { abc: 3 },
    });
    expect(parsed.mint_url).toBe('https://mint.test');
  });

  it('parses spark details', () => {
    expect(
      SparkAccountDetailsDbDataSchema.parse({ network: 'MAINNET' }).network,
    ).toBe('MAINNET');
  });

  it('isCashuAccount / isSparkAccount narrow by type', () => {
    const cashu = { type: 'cashu' } as never;
    const spark = { type: 'spark' } as never;
    expect(isCashuAccount(cashu)).toBe(true);
    expect(isCashuAccount(spark)).toBe(false);
    expect(isSparkAccount(spark)).toBe(true);
  });
});
```

- [ ] **Step 3: Verify + commit.** `bun --filter=@agicash/wallet-sdk run test` → PASS. `bun run typecheck` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): DB account-detail schemas + isCashu/isSpark guards

Port the cashu/spark account_details json-model schemas + the row type guards
from agicash-db. Used by the account repository's toAccount mapping.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Encryption service

**Files:** Create `src/internal/crypto/encryption.ts` + `.test.ts`.

- [ ] **Step 1: Implement** (`src/internal/crypto/encryption.ts`) — port `shared/encryption.ts`'s pure functions + `getEncryption`, dropping the React/query hooks and the direct OpenSecret key fetches; add an `EncryptionService` that lazily derives + memoizes the keypair over the `KeyProvider`:

```ts
import { Money } from '@agicash/money';
import { hexToBytes } from '@noble/hashes/utils';
import { decode, encode } from '@stablelib/base64';
import {
  eciesDecrypt,
  eciesDecryptBatch,
  eciesEncrypt,
  eciesEncryptBatch,
} from '../lib/ecies/ecies';
import { ENCRYPTION_KEY_PATH, type KeyProvider } from './keys';

function preprocessData(obj: unknown): unknown {
  if (obj === undefined) return { __type: 'undefined' };
  if (typeof obj === 'number' && !Number.isFinite(obj)) {
    return { __type: 'number', value: obj.toString() };
  }
  if (obj === null || typeof obj !== 'object' || obj instanceof Money) {
    return obj;
  }
  if (obj instanceof Date) return { __type: 'Date', value: obj.toISOString() };
  if (Array.isArray(obj)) return obj.map(preprocessData);
  const result: Record<string, unknown> = {};
  for (const key in obj) {
    result[key] = preprocessData(obj[key as keyof typeof obj]);
  }
  return result;
}

function serializeData(data: unknown): string {
  return JSON.stringify(preprocessData(data));
}

function deserializeData<T = unknown>(serializedData: string): T {
  return JSON.parse(serializedData, (_, value) => {
    if (value && typeof value === 'object' && '__type' in value) {
      switch (value.__type) {
        case 'Date':
          return new Date(value.value);
        case 'undefined':
          return undefined;
        case 'number':
          return Number(value.value);
        case 'Money':
          return new Money({
            amount: value.amount,
            currency: value.currency,
            unit: value.unit,
          });
      }
    }
    return value;
  }) as T;
}

function encryptToPublicKey<T = unknown>(data: T, publicKeyHex: string): string {
  const dataBytes = new TextEncoder().encode(serializeData(data));
  const encryptedBytes = eciesEncrypt(dataBytes, hexToBytes(publicKeyHex));
  return encode(encryptedBytes);
}

function encryptBatchToPublicKey<T extends readonly unknown[]>(
  data: T,
  publicKeyHex: string,
): string[] {
  const encoder = new TextEncoder();
  const dataBytes = data.map((x) =>
    encoder.encode(JSON.stringify(preprocessData(x))),
  );
  return eciesEncryptBatch(dataBytes, hexToBytes(publicKeyHex)).map((x) =>
    encode(x),
  );
}

function decryptWithPrivateKey<T = unknown>(
  encryptedData: string,
  privateKeyBytes: Uint8Array,
): T {
  const decryptedBytes = eciesDecrypt(decode(encryptedData), privateKeyBytes);
  return deserializeData<T>(new TextDecoder().decode(decryptedBytes));
}

function decryptBatchWithPrivateKey<T extends readonly unknown[]>(
  encryptedDataArray: readonly [...{ [K in keyof T]: string }],
  privateKeyBytes: Uint8Array,
): T {
  const decoded = encryptedDataArray.map((x) => decode(x));
  const decoder = new TextDecoder();
  return eciesDecryptBatch(decoded, privateKeyBytes).map((x) =>
    deserializeData(decoder.decode(x)),
  ) as unknown as T;
}

/** ECIES encrypt/decrypt bound to the user's data-encryption keypair. */
export type Encryption = {
  encrypt: <T = unknown>(data: T) => Promise<string>;
  decrypt: <T = unknown>(data: string) => Promise<T>;
  encryptBatch: <T extends readonly unknown[]>(data: T) => Promise<string[]>;
  decryptBatch: <T extends readonly unknown[]>(
    data: readonly [...{ [K in keyof T]: string }],
  ) => Promise<T>;
};

/** Build an {@link Encryption} from a derived keypair (private bytes + public hex). */
export function getEncryption(
  privateKey: Uint8Array,
  publicKeyHex: string,
): Encryption {
  return {
    encrypt: async (data) => encryptToPublicKey(data, publicKeyHex),
    decrypt: async (data) => decryptWithPrivateKey(data, privateKey),
    encryptBatch: async (data) => encryptBatchToPublicKey(data, publicKeyHex),
    decryptBatch: async (data) => decryptBatchWithPrivateKey(data, privateKey),
  };
}

/**
 * Lazily derives (once per SDK instance) the user's data-encryption keypair at
 * {@link ENCRYPTION_KEY_PATH} via the {@link KeyProvider} and exposes an
 * {@link Encryption}. Memoized — matches the web's Infinity-staleTime query;
 * lifetime is the SDK instance (a re-login uses a fresh `Sdk`).
 */
export class EncryptionService {
  private cached: Promise<Encryption> | null = null;
  constructor(private readonly keys: KeyProvider) {}

  get(): Promise<Encryption> {
    this.cached ??= this.build();
    return this.cached;
  }

  private async build(): Promise<Encryption> {
    const [privateKey, publicKeyHex] = await Promise.all([
      this.keys.getPrivateKeyBytes(ENCRYPTION_KEY_PATH),
      this.keys.getPublicKeyHex(ENCRYPTION_KEY_PATH, 'schnorr'),
    ]);
    return getEncryption(privateKey, publicKeyHex);
  }
}
```

- [ ] **Step 2: Write the test** (`encryption.test.ts`) — round-trip using a real secp256k1 keypair (no module mocks needed):

```ts
import { describe, expect, it } from 'bun:test';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { EncryptionService, getEncryption } from './encryption';
import type { KeyProvider } from './keys';

const priv = secp256k1.utils.randomPrivateKey();
const pubHex = bytesToHex(secp256k1.getPublicKey(priv, true));

describe('getEncryption', () => {
  it('round-trips an object (incl. Date) via encrypt/decrypt', async () => {
    const enc = getEncryption(priv, pubHex);
    const data = { a: 1, when: new Date('2026-01-01T00:00:00.000Z') };
    const cipher = await enc.encrypt(data);
    expect(typeof cipher).toBe('string');
    const out = await enc.decrypt<typeof data>(cipher);
    expect(out.a).toBe(1);
    expect(out.when instanceof Date).toBe(true);
  });

  it('round-trips a batch preserving order', async () => {
    const enc = getEncryption(priv, pubHex);
    const cipher = await enc.encryptBatch([10, 'x', true] as const);
    expect(await enc.decryptBatch(cipher)).toEqual([10, 'x', true]);
  });
});

describe('EncryptionService', () => {
  it('derives the keypair at ENCRYPTION_KEY_PATH and memoizes', async () => {
    let privCalls = 0;
    const keys: KeyProvider = {
      getChildMnemonic: async () => 'm',
      getPrivateKeyBytes: async (path) => {
        expect(path).toBe("m/10111099'/0'");
        privCalls += 1;
        return priv;
      },
      getPublicKeyHex: async (path) => {
        expect(path).toBe("m/10111099'/0'");
        return pubHex;
      },
    };
    const svc = new EncryptionService(keys);
    const a = await svc.get();
    const b = await svc.get();
    expect(a).toBe(b);
    expect(privCalls).toBe(1);
    expect(await a.decrypt(await a.encrypt('hi'))).toBe('hi');
  });
});
```

- [ ] **Step 3: Verify + commit.** `bun --filter=@agicash/wallet-sdk run test` → PASS. `bun run typecheck` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): Encryption service (ECIES + serialize/deserialize)

Port shared/encryption.ts pure functions + getEncryption (drop React/query
hooks). Add EncryptionService: lazily derives + memoizes the data-encryption
keypair at m/10111099'/0' over the KeyProvider. Needed to decrypt cashu proofs.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Spark wallet service (+ offline stub + spark errors)

**Files:** Create `src/internal/lib/spark/errors.ts`, `src/internal/connections/spark-wallet.ts` + `.test.ts`.

- [ ] **Step 1: Vendor the spark errors** (used by S6; framework-free):

```bash
cp apps/web-wallet/app/lib/spark/errors.ts packages/wallet-sdk/src/internal/lib/spark/errors.ts
```

- [ ] **Step 2: Implement `SparkWalletService` + `createSparkWalletStub`** (`src/internal/connections/spark-wallet.ts`). `connect` is injected (DI — tests pass a fake; `buildConnections` passes the real `connectBreez` closure):

```ts
import type { BreezSdk } from '@agicash/breez-sdk-spark';
import { Money } from '@agicash/money';
import type { SparkNetwork } from '../../types/dependencies';

/** A BreezSdk Proxy whose every method throws — used when Spark is offline. */
export function createSparkWalletStub(reason: string): BreezSdk {
  return new Proxy({} as BreezSdk, {
    get(_target, prop) {
      if (typeof prop === 'string') {
        return () => {
          console.error(`Cannot call ${prop} on Spark wallet stub`);
          throw new Error(reason);
        };
      }
      return undefined;
    },
  });
}

/** A connected (or offline-stubbed) spark wallet plus its current balance. */
export type InitializedSparkWallet = {
  wallet: BreezSdk;
  balance: Money | null;
  isOnline: boolean;
};

/**
 * Owns the live Breez/Spark connection(s). Connects ONCE per network
 * (single-flight; a failed connect is not cached so the next call retries),
 * replacing the web's TanStack `spark-wallet` query memo. On any failure returns
 * an offline stub + null balance (mirrors master's `getInitializedSparkWallet`).
 * The balance LISTENER (re-read on `synced`) is NOT here — it is S7.
 */
export class SparkWalletService {
  private readonly connections = new Map<SparkNetwork, Promise<BreezSdk>>();

  constructor(
    private readonly connect: (network: SparkNetwork) => Promise<BreezSdk>,
  ) {}

  async getInitialized(network: SparkNetwork): Promise<InitializedSparkWallet> {
    try {
      const wallet = await this.connectOnce(network);
      const info = await wallet.getInfo({});
      const balance = new Money({
        amount: info.balanceSats,
        currency: 'BTC',
        unit: 'sat',
      });
      return { wallet, balance, isOnline: true };
    } catch (error) {
      console.error('Failed to initialize spark wallet', { cause: error });
      return {
        wallet: createSparkWalletStub(
          'Spark is offline, please try again later.',
        ),
        balance: null,
        isOnline: false,
      };
    }
  }

  private connectOnce(network: SparkNetwork): Promise<BreezSdk> {
    const existing = this.connections.get(network);
    if (existing) return existing;
    const promise = this.connect(network);
    promise.catch(() => this.connections.delete(network));
    this.connections.set(network, promise);
    return promise;
  }
}
```

- [ ] **Step 3: Write the test** (`spark-wallet.test.ts`) — inject a fake `connect` (no breez module mock):

```ts
import { describe, expect, it } from 'bun:test';
import { Money } from '@agicash/money';
import {
  SparkWalletService,
  createSparkWalletStub,
} from './spark-wallet';

function fakeWallet(balanceSats: number) {
  return { getInfo: async () => ({ balanceSats }) } as never;
}

describe('SparkWalletService', () => {
  it('connects once per network and reports balance + online', async () => {
    let connects = 0;
    const svc = new SparkWalletService(async () => {
      connects += 1;
      return fakeWallet(1234);
    });
    const a = await svc.getInitialized('MAINNET');
    const b = await svc.getInitialized('MAINNET');
    expect(connects).toBe(1);
    expect(a.isOnline).toBe(true);
    expect((a.balance as Money).toString()).toBe(
      new Money({ amount: 1234, currency: 'BTC', unit: 'sat' }).toString(),
    );
    expect(b.isOnline).toBe(true);
  });

  it('returns an offline stub + null balance when connect fails (and retries next time)', async () => {
    let connects = 0;
    const svc = new SparkWalletService(async () => {
      connects += 1;
      throw new Error('offline');
    });
    const first = await svc.getInitialized('MAINNET');
    expect(first.isOnline).toBe(false);
    expect(first.balance).toBeNull();
    await svc.getInitialized('MAINNET'); // failed connect not cached → retried
    expect(connects).toBe(2);
  });

  it('createSparkWalletStub throws on any method call', () => {
    const stub = createSparkWalletStub('down') as unknown as {
      getInfo: () => unknown;
    };
    expect(() => stub.getInfo()).toThrow('down');
  });
});
```

- [ ] **Step 4: Verify + commit.** `bun --filter=@agicash/wallet-sdk run test` → PASS. `bun run typecheck` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): SparkWalletService (connect-once memo + offline stub)

Own the live Breez connection: connect once per network (single-flight, retry on
failure), getInfo for balance, offline → createSparkWalletStub. Connect is
injected (DI) so the test needs no breez module mock. Vendor lib/spark/errors
(used by S6). The synced balance listener stays S7.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Cashu wallet service + mint-auth provider

**Files:** Create `src/internal/connections/mint-auth.ts` + `.test.ts`, `src/internal/connections/cashu-wallet.ts` + `.test.ts`.

- [ ] **Step 1: Implement the mint-auth provider** (`src/internal/connections/mint-auth.ts`) — reimplement `agicash-mint-auth-provider.ts`'s queryClient-cached token as a self-contained provider mirroring `SupabaseSessionTokenProvider` (expiry-aware, 5s skew, single-flight):

```ts
import type { AuthProvider } from '@cashu/cashu-ts';
import { jwtDecode } from 'jwt-decode';
import type { AccountPurpose } from '../../types/account';

/**
 * Caches the agicash mint Clear-Auth token (CAT), refreshing 5s before expiry.
 * Mirrors {@link SupabaseSessionTokenProvider}; replaces the web's queryClient
 * memo for `agicash-mint-auth-token`.
 */
export class MintAuthTokenProvider {
  private token: string | null = null;
  private expMs = 0;
  private inflight: Promise<string | null> | null = null;

  constructor(
    private readonly generateToken: () => Promise<string>,
    private readonly isLoggedIn: () => Promise<boolean>,
  ) {}

  getToken = async (): Promise<string | null> => {
    if (!(await this.isLoggedIn())) {
      this.token = null;
      return null;
    }
    if (this.token && Date.now() < this.expMs - 5000) return this.token;
    this.inflight ??= this.fetch();
    try {
      return await this.inflight;
    } finally {
      this.inflight = null;
    }
  };

  private async fetch(): Promise<string> {
    const token = await this.generateToken();
    const { exp } = jwtDecode<{ exp?: number }>(token);
    this.token = token;
    this.expMs = (exp ?? 0) * 1000;
    return token;
  }
}

/** A cashu-ts `AuthProvider` for NUT-21 Clear Auth backed by {@link MintAuthTokenProvider}. */
export function getAgicashMintAuthProvider(
  tokenProvider: MintAuthTokenProvider,
): AuthProvider {
  return {
    getCAT: () => {
      throw new Error('Not implemented: use ensureCAT');
    },
    setCAT: () => {
      throw new Error('Not implemented: use ensureCAT');
    },
    ensureCAT: async () => (await tokenProvider.getToken()) ?? undefined,
    getBlindAuthToken: async () => {
      throw new Error('Blind auth is not supported');
    },
  };
}

/** The auth provider for an account purpose: gift-card/offer get the agicash CAT; others none. */
export function getMintAuthProvider(
  purpose: AccountPurpose,
  tokenProvider: MintAuthTokenProvider,
): AuthProvider | undefined {
  return purpose === 'gift-card' || purpose === 'offer'
    ? getAgicashMintAuthProvider(tokenProvider)
    : undefined;
}
```

> The real `generateToken` closure (`buildConnections`, Task 17) is `async () => (await generateThirdPartyToken('agicash-mint')).token`. Confirm `generateThirdPartyToken` accepts the audience argument against the OpenSecret rc types before wiring.

- [ ] **Step 2: Test the mint-auth provider** (`mint-auth.test.ts`) — DI'd token/loginness, `jwtWith` from test-support:

```ts
import { describe, expect, it } from 'bun:test';
import { jwtWith } from '../test-support';
import {
  MintAuthTokenProvider,
  getMintAuthProvider,
} from './mint-auth';

const future = () => Math.floor(Date.now() / 1000) + 3600;

describe('MintAuthTokenProvider', () => {
  it('returns null when logged out', async () => {
    const p = new MintAuthTokenProvider(
      async () => jwtWith({ exp: future() }),
      async () => false,
    );
    expect(await p.getToken()).toBeNull();
  });

  it('fetches once and caches until near expiry', async () => {
    let calls = 0;
    const p = new MintAuthTokenProvider(
      async () => {
        calls += 1;
        return jwtWith({ exp: future() });
      },
      async () => true,
    );
    const a = await p.getToken();
    const b = await p.getToken();
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });
});

describe('getMintAuthProvider', () => {
  const tp = new MintAuthTokenProvider(
    async () => jwtWith({ exp: future() }),
    async () => true,
  );
  it('returns an AuthProvider for gift-card/offer, undefined otherwise', () => {
    expect(getMintAuthProvider('gift-card', tp)).toBeDefined();
    expect(getMintAuthProvider('offer', tp)).toBeDefined();
    expect(getMintAuthProvider('transactional', tp)).toBeUndefined();
  });
});
```

- [ ] **Step 3: Implement `CashuWalletService`** (`src/internal/connections/cashu-wallet.ts`) — port `getInitializedCashuWallet`, replacing the queryClient mint-metadata fetches with an injected `fetchMintMetadata(mintUrl)` + a per-mint memo. `getCashuWallet` builds the live `ExtendedCashuWallet`:

```ts
import { NetworkError } from '@cashu/cashu-ts';
import type { Currency } from '@agicash/money';
import {
  type ExtendedCashuWallet,
  ExtendedMintInfo,
  getCashuProtocolUnit,
  getCashuUnit,
  getCashuWallet,
} from '../lib/cashu';
import { KeyChain } from '@cashu/cashu-ts';
import type { AuthProvider } from '@cashu/cashu-ts';

/** Mint metadata fetched once per mint URL (mirrors master's 1h-staleTime queries). */
export type MintMetadata = {
  mintInfo: ExtendedMintInfo;
  keysets: Awaited<ReturnType<import('@cashu/cashu-ts').Mint['getKeySets']>>;
  keys: Awaited<ReturnType<import('@cashu/cashu-ts').Mint['getKeys']>>;
};

export type InitializedCashuWallet = {
  wallet: ExtendedCashuWallet;
  isOnline: boolean;
};

const FETCH_TIMEOUT_MS = 10_000;

/**
 * Builds the live cashu wallet handle for an account. Caches mint metadata per
 * mint URL (replacing the web's TanStack mint-info/keysets/keys queries) and
 * rebuilds the cheap `ExtendedCashuWallet` per call. On a network failure/timeout
 * returns a minimal offline wallet (`isOnline:false`), matching master.
 */
export class CashuWalletService {
  private readonly metadata = new Map<string, Promise<MintMetadata>>();

  constructor(
    private readonly fetchMintMetadata: (
      mintUrl: string,
    ) => Promise<MintMetadata>,
  ) {}

  async getInitialized(
    mintUrl: string,
    currency: Currency,
    bip39seed: Uint8Array | undefined,
    authProvider: AuthProvider | undefined,
  ): Promise<InitializedCashuWallet> {
    const buildOffline = (): InitializedCashuWallet => ({
      wallet: getCashuWallet(mintUrl, {
        unit: getCashuUnit(currency),
        bip39seed,
        authProvider,
      }),
      isOnline: false,
    });

    let meta: MintMetadata;
    try {
      meta = await this.withTimeout(this.getMetadata(mintUrl));
    } catch (error) {
      this.metadata.delete(mintUrl); // don't cache a failed fetch
      if (error instanceof NetworkError) return buildOffline();
      throw error;
    }

    const protocolUnit = getCashuProtocolUnit(currency);
    const unitKeysets = meta.keysets.keysets.filter(
      (ks) => ks.unit === protocolUnit,
    );
    const activeKeyset = unitKeysets.find((ks) => ks.active);
    if (!activeKeyset) {
      throw new Error(`No active keyset found for ${currency} on ${mintUrl}`);
    }
    const activeKeysForUnit = meta.keys.keysets.find(
      (ks) => ks.id === activeKeyset.id,
    );
    if (!activeKeysForUnit) {
      throw new Error(
        `Got active keyset ${activeKeyset.id} from ${mintUrl} but could not find keys for it`,
      );
    }

    const wallet = getCashuWallet(mintUrl, {
      unit: getCashuUnit(currency),
      bip39seed,
      authProvider,
    });
    const keyChainCache = KeyChain.mintToCacheDTO(
      wallet.unit,
      mintUrl,
      unitKeysets,
      [activeKeysForUnit],
    );
    wallet.loadMintFromCache(meta.mintInfo.cache, keyChainCache);
    return { wallet, isOnline: true };
  }

  private getMetadata(mintUrl: string): Promise<MintMetadata> {
    const existing = this.metadata.get(mintUrl);
    if (existing) return existing;
    const promise = this.fetchMintMetadata(mintUrl);
    this.metadata.set(mintUrl, promise);
    return promise;
  }

  private withTimeout<T>(p: Promise<T>): Promise<T> {
    return Promise.race([
      p,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new NetworkError('Mint request timed out')),
          FETCH_TIMEOUT_MS,
        ),
      ),
    ]);
  }
}
```

> Reconcile `KeyChain.mintToCacheDTO` / `wallet.loadMintFromCache` / `Mint.getKeySets()` / `Mint.getKeys()` / `ExtendedMintInfo` / `NetworkError` signatures against `node_modules/@cashu/cashu-ts@3.6.1` when implementing — these mirror master's `getInitializedCashuWallet` (`shared/cashu.ts:266-356`); read it side-by-side. The real `fetchMintMetadata` closure (Task 17) is `async (mintUrl) => { const mint = new Mint(mintUrl); const [info, keysets, keys] = await Promise.all([mint.getInfo(), mint.getKeySets(), mint.getKeys()]); return { mintInfo: new ExtendedMintInfo(info), keysets, keys }; }`.

- [ ] **Step 4: Test `CashuWalletService`** (`cashu-wallet.test.ts`) — inject a fake `fetchMintMetadata` (no cashu-ts module mock). Cover the memo + the offline fallback (NetworkError):

```ts
import { describe, expect, it } from 'bun:test';
import { NetworkError } from '@cashu/cashu-ts';
import { CashuWalletService } from './cashu-wallet';

describe('CashuWalletService', () => {
  it('returns an offline wallet on NetworkError (and does not cache the failure)', async () => {
    let calls = 0;
    const svc = new CashuWalletService(async () => {
      calls += 1;
      throw new NetworkError('down');
    });
    const a = await svc.getInitialized(
      'https://mint.test',
      'BTC',
      undefined,
      undefined,
    );
    expect(a.isOnline).toBe(false);
    expect(a.wallet).toBeDefined();
    await svc.getInitialized('https://mint.test', 'BTC', undefined, undefined);
    expect(calls).toBe(2); // failed fetch not memoized → retried
  });

  it('memoizes successful metadata per mint URL', async () => {
    let calls = 0;
    const meta = {
      mintInfo: { cache: {} },
      keysets: { keysets: [{ id: 'ks1', unit: 'sat', active: true }] },
      keys: { keysets: [{ id: 'ks1', unit: 'sat', keys: {} }] },
    } as never;
    const svc = new CashuWalletService(async () => {
      calls += 1;
      return meta;
    });
    // Two calls for the same mint should fetch metadata once. The online branch
    // builds a real ExtendedCashuWallet + loadMintFromCache; if the fake cache
    // shape is too thin for loadMintFromCache, wrap each call in try/catch and
    // assert on `calls` only (the memo is the unit under test here).
    await svc.getInitialized('https://m.test', 'BTC', undefined, undefined).catch(() => {});
    await svc.getInitialized('https://m.test', 'BTC', undefined, undefined).catch(() => {});
    expect(calls).toBe(1);
  });
});
```

> The second case's online branch may need richer fake metadata to satisfy `KeyChain.mintToCacheDTO`/`loadMintFromCache`. The assertion of record is the **memo** (`calls === 1`); the `.catch(() => {})` tolerates a thin fake. If reconciling against the real cashu-ts API yields an easy minimal valid cache, drop the catch and additionally assert `isOnline === true`.

- [ ] **Step 5: Verify + commit.** `bun --filter=@agicash/wallet-sdk run test` → PASS. `bun run typecheck` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): CashuWalletService + mint-auth provider

CashuWalletService builds the live ExtendedCashuWallet, memoizing mint metadata
per mint URL (replacing the web's TanStack queries) with a 10s timeout → offline
fallback. Metadata fetch is injected (DI; no cashu-ts module mock in tests).
MintAuthTokenProvider reimplements the gift-card-mint CAT cache (expiry-aware,
mirroring SupabaseSessionTokenProvider).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Account repository

**Files:** Create `src/internal/repositories/account-repository.ts` + `.test.ts`.

- [ ] **Step 1: Implement** (`src/internal/repositories/account-repository.ts`) — port master's `AccountRepository` (`get`/`getAllActive`/`create`/`toAccount`/`decryptCashuProofs`), taking the SDK connection deps by constructor and using `classify` for errors:

```ts
import type { Currency } from '@agicash/money';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod/mini';
import { DomainError } from '../../errors';
import type {
  Account,
  AccountPurpose,
  CashuProof,
} from '../../types/account';
import { classify } from '../classify';
import type { Encryption } from '../crypto/encryption';
import type { EncryptionService } from '../crypto/encryption';
import {
  CashuAccountDetailsDbDataSchema,
  SparkAccountDetailsDbDataSchema,
  isCashuAccount,
  isSparkAccount,
} from '../db/account-details';
import type { AgicashDbAccountWithProofs, Database } from '../db/database';
import { ProofSchema, normalizeMintUrl } from '../lib/cashu';
import type { CashuWalletService } from '../connections/cashu-wallet';
import type { MintAuthTokenProvider } from '../connections/mint-auth';
import { getMintAuthProvider } from '../connections/mint-auth';
import type { SparkWalletService } from '../connections/spark-wallet';

type Options = { abortSignal?: AbortSignal };

/** Data access for `wallet.accounts` (+ `cashu_proofs`). Builds live `Account`s. */
export class AccountRepository {
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly encryption: EncryptionService,
    private readonly cashuWallets: CashuWalletService,
    private readonly sparkWallets: SparkWalletService,
    private readonly mintAuth: MintAuthTokenProvider,
    private readonly getCashuSeed: () => Promise<Uint8Array>,
  ) {}

  /** The account with this id (with unspent proofs), or null. */
  async get(id: string, options?: Options): Promise<Account | null> {
    const query = this.db
      .from('accounts')
      .select('*, cashu_proofs(*)')
      .eq('id', id)
      .eq('cashu_proofs.state', 'UNSPENT');
    if (options?.abortSignal) query.abortSignal(options.abortSignal);
    const { data, error } = await query.maybeSingle();
    if (error) throw classify(error);
    return data ? this.toAccount(data) : null;
  }

  /** All active accounts for the user (with unspent proofs). */
  async getAllActive(userId: string, options?: Options): Promise<Account[]> {
    const query = this.db
      .from('accounts')
      .select('*, cashu_proofs(*)')
      .eq('user_id', userId)
      .eq('state', 'active')
      .eq('cashu_proofs.state', 'UNSPENT');
    if (options?.abortSignal) query.abortSignal(options.abortSignal);
    const { data, error } = await query;
    if (error) throw classify(error);
    return Promise.all((data ?? []).map((x) => this.toAccount(x)));
  }

  /** Insert a new account row and return the built `Account`. */
  async create(
    input: {
      userId: string;
      name: string;
      currency: Currency;
      purpose: AccountPurpose;
      expiresAt: string | null;
    } & (
      | { type: 'cashu'; mintUrl: string; isTestMint: boolean }
      | { type: 'spark'; network: 'MAINNET' | 'REGTEST' }
    ),
    options?: Options,
  ): Promise<Account> {
    const details =
      input.type === 'cashu'
        ? CashuAccountDetailsDbDataSchema.parse({
            mint_url: normalizeMintUrl(input.mintUrl),
            is_test_mint: input.isTestMint,
            keyset_counters: {},
          })
        : SparkAccountDetailsDbDataSchema.parse({ network: input.network });

    const query = this.db
      .from('accounts')
      .insert({
        name: input.name,
        type: input.type,
        currency: input.currency,
        details,
        user_id: input.userId,
        purpose: input.purpose,
        expires_at: input.expiresAt,
      })
      .select('*, cashu_proofs(*)')
      .eq('cashu_proofs.state', 'UNSPENT');
    if (options?.abortSignal) query.abortSignal(options.abortSignal);

    const { data, error, status } = await query.single();
    if (error) {
      if (error.hint === 'LIMIT_REACHED') {
        throw new DomainError(`${error.message} ${error.details}`);
      }
      if (status === 409 && input.type === 'cashu') {
        throw new DomainError(
          'Account for this mint and currency already exists',
        );
      }
      throw classify(error);
    }
    return this.toAccount(data);
  }

  /** Map a DB row (+ proofs) to a live `Account` (cashu wallet-init / spark connect). */
  async toAccount(data: AgicashDbAccountWithProofs): Promise<Account> {
    const common = {
      id: data.id,
      name: data.name,
      currency: data.currency,
      purpose: data.purpose,
      state: data.state,
      createdAt: data.created_at,
      version: data.version,
      expiresAt: data.expires_at,
    };

    if (isCashuAccount(data)) {
      const details = CashuAccountDetailsDbDataSchema.parse(data.details);
      const [{ wallet, isOnline }, proofs] = await Promise.all([
        this.initCashuWallet(details.mint_url, data.currency, data.purpose),
        this.decryptCashuProofs(data),
      ]);
      return {
        ...common,
        isOnline,
        type: 'cashu',
        mintUrl: details.mint_url,
        isTestMint: details.is_test_mint,
        keysetCounters: details.keyset_counters,
        proofs,
        wallet,
      } as Account;
    }

    if (isSparkAccount(data)) {
      const { network } = SparkAccountDetailsDbDataSchema.parse(data.details);
      const { wallet, balance, isOnline } =
        await this.sparkWallets.getInitialized(network);
      return {
        ...common,
        type: 'spark',
        balance,
        network,
        isOnline,
        wallet,
      } as Account;
    }

    throw new Error('Invalid account type');
  }

  private async initCashuWallet(
    mintUrl: string,
    currency: Currency,
    purpose: AccountPurpose,
  ) {
    const seed = await this.getCashuSeed();
    const authProvider = getMintAuthProvider(purpose, this.mintAuth);
    return this.cashuWallets.getInitialized(
      mintUrl,
      currency,
      seed,
      authProvider,
    );
  }

  private async decryptCashuProofs(
    data: AgicashDbAccountWithProofs,
  ): Promise<CashuProof[]> {
    if (!isCashuAccount(data)) {
      throw new Error('Account is not a cashu account');
    }
    const encryption: Encryption = await this.encryption.get();
    const encrypted = data.cashu_proofs.flatMap((x) => [x.amount, x.secret]);
    const decrypted = await encryption.decryptBatch(encrypted);
    return data.cashu_proofs.map((dbProof, index) => {
      const i = index * 2;
      return {
        id: dbProof.id,
        accountId: dbProof.account_id,
        userId: dbProof.user_id,
        keysetId: dbProof.keyset_id,
        amount: z.number().parse(decrypted[i]),
        secret: z.string().parse(decrypted[i + 1]),
        unblindedSignature: dbProof.unblinded_signature,
        publicKeyY: dbProof.public_key_y,
        dleq: ProofSchema.shape.dleq.parse(dbProof.dleq),
        witness: ProofSchema.shape.witness.parse(dbProof.witness),
        state: dbProof.state,
        version: dbProof.version,
        createdAt: dbProof.created_at,
        reservedAt: dbProof.reserved_at,
      };
    });
  }
}
```

> `makeFakeDb` (test-support) supports `from().select().eq().maybeSingle()/single()` and records `from`. The `getAllActive` non-`maybeSingle` terminal (awaiting the builder directly) needs the builder to be awaitable — verify `makeFakeDb`'s builder resolves to `selectResult` when awaited; if not, extend the fake (add a `then` to the builder returning `selectResult`) as part of this task's Step 2.

- [ ] **Step 2: Write the test** (`account-repository.test.ts`) — inject fake wallet services + a fake db; assert mapping + decryption. (Extend `makeFakeDb` if `getAllActive`'s awaited-builder terminal isn't supported.)

```ts
import { describe, expect, it } from 'bun:test';
import { makeFakeDb } from '../test-support';
import { AccountRepository } from './account-repository';
import { EncryptionService } from '../crypto/encryption';
import { MintAuthTokenProvider } from '../connections/mint-auth';
import { CashuWalletService } from '../connections/cashu-wallet';
import { SparkWalletService } from '../connections/spark-wallet';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';

const priv = secp256k1.utils.randomPrivateKey();
const pubHex = bytesToHex(secp256k1.getPublicKey(priv, true));
const encryption = new EncryptionService({
  getChildMnemonic: async () => 'm',
  getPrivateKeyBytes: async () => priv,
  getPublicKeyHex: async () => pubHex,
});

// Build encrypted amount/secret so decryptCashuProofs round-trips.
async function enc(value: unknown) {
  return (await encryption.get()).encrypt(value);
}

const cashuWallets = new CashuWalletService(async () => {
  throw new (await import('@cashu/cashu-ts')).NetworkError('offline');
}); // → isOnline:false, real ExtendedCashuWallet stub-of-sorts
const sparkWallets = new SparkWalletService(async () => {
  throw new Error('offline');
}); // → offline stub
const mintAuth = new MintAuthTokenProvider(
  async () => 'tok',
  async () => false,
);

function repo(db: ReturnType<typeof makeFakeDb>) {
  return new AccountRepository(
    db,
    encryption,
    cashuWallets,
    sparkWallets,
    mintAuth,
    async () => new Uint8Array(64),
  );
}

describe('AccountRepository.toAccount', () => {
  it('maps a spark row → spark Account (offline stub when connect fails)', async () => {
    const row = {
      id: 'a1',
      name: 'Bitcoin',
      type: 'spark',
      currency: 'BTC',
      purpose: 'transactional',
      state: 'active',
      created_at: 't',
      version: 1,
      expires_at: null,
      details: { network: 'MAINNET' },
      cashu_proofs: [],
    } as never;
    const account = await repo(makeFakeDb({})).toAccount(row);
    expect(account.type).toBe('spark');
    expect(account.isOnline).toBe(false);
    if (account.type === 'spark') expect(account.network).toBe('MAINNET');
  });

  it('maps a cashu row → cashu Account, decrypting proofs', async () => {
    const row = {
      id: 'c1',
      name: 'USD',
      type: 'cashu',
      currency: 'USD',
      purpose: 'transactional',
      state: 'active',
      created_at: 't',
      version: 1,
      expires_at: null,
      details: {
        mint_url: 'https://mint.test',
        is_test_mint: false,
        keyset_counters: {},
      },
      cashu_proofs: [
        {
          id: 'p1',
          account_id: 'c1',
          user_id: 'u1',
          keyset_id: 'ks1',
          amount: await enc(21),
          secret: await enc('s3cret'),
          unblinded_signature: 'sig',
          public_key_y: 'Y',
          dleq: null,
          witness: null,
          state: 'UNSPENT',
          version: 1,
          created_at: 't',
          reserved_at: null,
        },
      ],
    } as never;
    const account = await repo(makeFakeDb({})).toAccount(row);
    expect(account.type).toBe('cashu');
    if (account.type === 'cashu') {
      expect(account.isOnline).toBe(false); // mint offline in this test
      expect(account.proofs[0]?.amount).toBe(21);
      expect(account.proofs[0]?.secret).toBe('s3cret');
    }
  });
});
```

> `ProofSchema.shape.dleq.parse(null)` / `witness.parse(null)` must accept `null` — verify against the vendored `lib/cashu/types.ts` (master stores `null` for absent dleq/witness). If the schema requires a specific shape, use a valid minimal fixture instead of `null`.

- [ ] **Step 3: Verify + commit.** `bun --filter=@agicash/wallet-sdk run test` → PASS. `bun run typecheck` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): account repository (toAccount + proof decryption)

Port master's AccountRepository (get/getAllActive/create/toAccount) over the RLS
client + the SDK wallet services + EncryptionService; classify() error routing,
LIMIT_REACHED/409 → DomainError. Builds the live cashu/spark Account.wallet.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Account domain helpers

**Files:** Create `src/domains/accounts/account-utils.ts` + `.test.ts`.

- [ ] **Step 1: Implement** (`src/domains/accounts/account-utils.ts`) — port the pure helpers from master's `account.ts` + `account-service.ts`:

```ts
import { Money } from '@agicash/money';
import { getCashuUnit, sumProofs } from '../../internal/lib/cashu';
import type {
  Account,
  ExtendedAccount,
} from '../../types/account';
import type { User } from '../../types/user';

/** The account's balance: cashu = Σ proofs; spark = its tracked balance (nullable). */
export function getAccountBalance(account: Account): Money | null {
  if (account.type === 'cashu') {
    return new Money({
      amount: sumProofs(account.proofs),
      currency: account.currency,
      unit: getCashuUnit(account.currency),
    });
  }
  return account.balance;
}

/** Whether the account can SEND over Lightning (spark always; cashu gated on NUT-05 + flags). */
export function canSendToLightning(account: Account): boolean {
  if (account.type === 'spark') return true;
  if (account.isTestMint) return false;
  if (account.purpose !== 'transactional') return false;
  if (!account.isOnline) return false;
  return !account.wallet.getMintInfo().isSupported(5).disabled;
}

/** Whether the account can RECEIVE over Lightning (spark always; cashu gated on NUT-04 + flags). */
export function canReceiveFromLightning(account: Account): boolean {
  if (account.type === 'spark') return true;
  if (account.isTestMint) return false;
  if (!account.isOnline) return false;
  return !account.wallet.getMintInfo().isSupported(4).disabled;
}

/** True if `account` is the user's default for its currency. */
export function isDefaultAccount(user: User, account: Account): boolean {
  if (account.currency === 'BTC') return user.defaultBtcAccountId === account.id;
  if (account.currency === 'USD') return user.defaultUsdAccountId === account.id;
  return false;
}

/** Tag each account with `isDefault` and sort defaults to the top. */
export function getExtendedAccounts(
  user: User,
  accounts: Account[],
): ExtendedAccount[] {
  return accounts
    .map((account) => ({ ...account, isDefault: isDefaultAccount(user, account) }))
    .sort((_, b) => (b.isDefault ? 1 : -1)) as ExtendedAccount[];
}
```

- [ ] **Step 2: Write the test** (`account-utils.test.ts`) — use plain account fixtures (cashu balance via proofs; spark balance; default tagging). For `canSend/Receive`, build a cashu account with a fake `wallet.getMintInfo().isSupported(n)` and a spark account:

```ts
import { describe, expect, it } from 'bun:test';
import { Money } from '@agicash/money';
import {
  canReceiveFromLightning,
  canSendToLightning,
  getAccountBalance,
  getExtendedAccounts,
  isDefaultAccount,
} from './account-utils';
import type { Account } from '../../types/account';
import type { User } from '../../types/user';

const cashu = (over: Partial<Account> = {}): Account =>
  ({
    id: 'c1',
    name: 'USD',
    type: 'cashu',
    currency: 'USD',
    purpose: 'transactional',
    state: 'active',
    isOnline: true,
    createdAt: 't',
    version: 1,
    expiresAt: null,
    mintUrl: 'https://m.test',
    isTestMint: false,
    keysetCounters: {},
    proofs: [{ amount: 50 } as never, { amount: 70 } as never],
    wallet: {
      getMintInfo: () => ({ isSupported: () => ({ disabled: false }) }),
    } as never,
    ...over,
  }) as Account;

const spark: Account = {
  id: 's1',
  name: 'BTC',
  type: 'spark',
  currency: 'BTC',
  purpose: 'transactional',
  state: 'active',
  isOnline: true,
  createdAt: 't',
  version: 1,
  expiresAt: null,
  balance: new Money({ amount: 1000, currency: 'BTC', unit: 'sat' }),
  network: 'MAINNET',
  wallet: {} as never,
} as Account;

const user = {
  defaultBtcAccountId: 's1',
  defaultUsdAccountId: 'c1',
} as User;

describe('account-utils', () => {
  it('getAccountBalance sums cashu proofs', () => {
    expect(getAccountBalance(cashu())?.toString()).toBe(
      new Money({ amount: 120, currency: 'USD', unit: 'cent' }).toString(),
    );
  });

  it('getAccountBalance returns spark balance', () => {
    expect(getAccountBalance(spark)?.toString()).toBe(
      (spark as Extract<Account, { type: 'spark' }>).balance?.toString(),
    );
  });

  it('canSendToLightning: spark true; test mint false; offline false', () => {
    expect(canSendToLightning(spark)).toBe(true);
    expect(canSendToLightning(cashu({ isTestMint: true } as never))).toBe(false);
    expect(canSendToLightning(cashu({ isOnline: false } as never))).toBe(false);
    expect(canSendToLightning(cashu())).toBe(true);
  });

  it('canReceiveFromLightning gates on NUT-04 + flags', () => {
    expect(canReceiveFromLightning(spark)).toBe(true);
    expect(
      canReceiveFromLightning(
        cashu({
          wallet: {
            getMintInfo: () => ({ isSupported: () => ({ disabled: true }) }),
          },
        } as never),
      ),
    ).toBe(false);
  });

  it('isDefaultAccount + getExtendedAccounts tag and sort defaults first', () => {
    expect(isDefaultAccount(user, spark)).toBe(true);
    const ext = getExtendedAccounts(user, [cashu({ id: 'other' } as never), spark]);
    expect(ext[0]?.isDefault).toBe(true);
  });
});
```

- [ ] **Step 3: Verify + commit.** `bun --filter=@agicash/wallet-sdk run test` → PASS. `bun run typecheck` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): account domain helpers (balance/ability/default)

Port getAccountBalance, canSend/canReceiveToLightning, isDefaultAccount, and
getExtendedAccounts from master. Pure functions over Account; used by getBalance,
getDefault, and suggestFor.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: `suggestFor` heuristic + `AccountSuggestion`

**Files:** Create `src/domains/accounts/suggest.ts` + `.test.ts`.

- [ ] **Step 1: Implement** (`src/domains/accounts/suggest.ts`) — the net-new pure heuristic (D4-5):

```ts
import type { Money } from '@agicash/money';
import { DomainError } from '../../errors';
import type { Account } from '../../types/account';
import type {
  AccountSuggestion,
} from '../../types/account-config';
import type { PaymentIntent } from '../../types/scan';
import { canReceiveFromLightning, canSendToLightning, getAccountBalance } from './account-utils';

/** The amount an intent needs satisfied, if known (used for the balance check). */
function intentAmount(intent: PaymentIntent): Money | undefined {
  if (intent.kind === 'send') return intent.amount;
  if (intent.kind === 'receive') return intent.amount;
  return undefined; // token-receive: amount is inside the token
}

/** Rank: offer first, then gift-card, then input-array order (caller orders default-first). */
function purposeRank(account: Account): number {
  if (account.purpose === 'offer') return 0;
  if (account.purpose === 'gift-card') return 1;
  return 2;
}

/**
 * Recommend which of the passed-in `accounts` to use for `intent`. PURE — no DB
 * read, no rate fetch, no cross-protocol cost comparison. Filters by ability
 * (send → canSendToLightning; receive/token-receive → canReceiveFromLightning),
 * then partitions by SAME-CURRENCY sufficient balance, ranks offer > gift-card >
 * input order, and recommends the top sufficient candidate. The caller is
 * responsible for passing accounts default-first and for any gift-card-config
 * destination matching (web-side). Throws `DomainError` when nothing can serve.
 */
export function suggestForAccounts(
  intent: PaymentIntent,
  accounts: Account[],
): AccountSuggestion {
  const canUse =
    intent.kind === 'send' ? canSendToLightning : canReceiveFromLightning;
  const candidates = accounts.filter(canUse);

  if (candidates.length === 0) {
    throw new DomainError('No account can service this payment');
  }

  const amount = intentAmount(intent);
  const hasSufficientBalance = (account: Account): boolean => {
    const balance = getAccountBalance(account);
    if (!balance) return false;
    if (!amount) return intent.kind === 'send' ? balance.isPositive() : true;
    // Same-currency comparison only (no conversion in a pure heuristic).
    if (account.currency !== amount.currency) return true;
    return balance.greaterThanOrEqual(amount);
  };

  const ranked = [...candidates].sort((a, b) => purposeRank(a) - purposeRank(b));
  const sufficient = ranked.filter(hasSufficientBalance);
  const insufficient = ranked.filter((a) => !hasSufficientBalance(a));

  if (sufficient.length === 0) {
    throw new DomainError('No account has sufficient balance for this payment');
  }

  const [recommended, ...alternatives] = sufficient;
  const reason =
    recommended.purpose === 'offer'
      ? 'offer match'
      : recommended.purpose === 'gift-card'
        ? 'gift-card-mint match'
        : `default ${recommended.type}`;

  return { recommended, alternatives, insufficient, reason };
}
```

> Verify `Money.greaterThanOrEqual` / `Money.isPositive` exist on `@agicash/money` (read `packages/money/src/money.ts`) — master's `findMatchingOfferOrGiftCardAccount` uses `greaterThanOrEqual` + `isPositive`, so they should. Adjust names if the API differs.

- [ ] **Step 2: Write the test** (`suggest.test.ts`):

```ts
import { describe, expect, it } from 'bun:test';
import { Money } from '@agicash/money';
import { DomainError } from '../../errors';
import { suggestForAccounts } from './suggest';
import type { Account } from '../../types/account';
import type { PaymentIntent } from '../../types/scan';

const spark = (id: string, sats: number, over: Partial<Account> = {}): Account =>
  ({
    id,
    name: id,
    type: 'spark',
    currency: 'BTC',
    purpose: 'transactional',
    state: 'active',
    isOnline: true,
    createdAt: 't',
    version: 1,
    expiresAt: null,
    balance: new Money({ amount: sats, currency: 'BTC', unit: 'sat' }),
    network: 'MAINNET',
    wallet: {} as never,
    ...over,
  }) as Account;

const sendIntent = (sats: number): PaymentIntent => ({
  kind: 'send',
  destination: { kind: 'ln-address', address: 'a@b.co' },
  amount: new Money({ amount: sats, currency: 'BTC', unit: 'sat' }),
});

describe('suggestForAccounts', () => {
  it('recommends the first sufficient candidate (array order = priority)', () => {
    const result = suggestForAccounts(sendIntent(100), [
      spark('a', 1000),
      spark('b', 2000),
    ]);
    expect(result.recommended.id).toBe('a');
    expect(result.alternatives.map((x) => x.id)).toEqual(['b']);
    expect(result.insufficient).toHaveLength(0);
  });

  it('puts under-funded accounts in `insufficient`', () => {
    const result = suggestForAccounts(sendIntent(1500), [
      spark('a', 1000),
      spark('b', 2000),
    ]);
    expect(result.recommended.id).toBe('b');
    expect(result.insufficient.map((x) => x.id)).toEqual(['a']);
  });

  it('prefers an offer/gift-card account over transactional', () => {
    const result = suggestForAccounts(sendIntent(100), [
      spark('plain', 1000),
      spark('gift', 1000, { purpose: 'gift-card' }),
    ]);
    expect(result.recommended.id).toBe('gift');
    expect(result.reason).toBe('gift-card-mint match');
  });

  it('throws DomainError when no candidate can serve', () => {
    expect(() =>
      suggestForAccounts(sendIntent(100), [
        spark('off', 1000, { isOnline: false, type: 'cashu', isTestMint: true } as never),
      ]),
    ).toThrow(DomainError);
  });

  it('throws DomainError when none has sufficient balance', () => {
    expect(() => suggestForAccounts(sendIntent(5000), [spark('a', 1000)])).toThrow(
      DomainError,
    );
  });
});
```

- [ ] **Step 3: Verify + commit.** `bun --filter=@agicash/wallet-sdk run test` → PASS. `bun run typecheck` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): suggestFor account heuristic + AccountSuggestion

Net-new pure heuristic: filter by lightning ability, partition by same-currency
sufficient balance, rank offer > gift-card > input order, recommend the top
sufficient candidate (else DomainError). Gift-card-config destination matching
stays web-side (spec §11); no user default resolution (no user context).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Accounts domain

**Files:** Create `src/domains/accounts/accounts-domain.ts` + `.test.ts`.

- [ ] **Step 1: Implement** (`src/domains/accounts/accounts-domain.ts`) — compose the repository + user repo + helpers; emit `account:updated` on `add` and `user:updated` on `setDefault`:

```ts
import type { Currency, Money } from '@agicash/money';
import type { AccountsDomain } from '../../domains';
import { DomainError, SdkError } from '../../errors';
import type { Account } from '../../types/account';
import type { AddAccountConfig } from '../../types/account-config';
import type { PaymentIntent } from '../../types/scan';
import { getCurrentUserId } from '../../internal/connections/open-secret';
import { checkIsTestMint } from '../../internal/lib/cashu';
import type { AccountRepository } from '../../internal/repositories/account-repository';
import { UserRepository } from '../../internal/repositories/user-repository';
import type { DomainContext } from '../context';
import { getAccountBalance } from './account-utils';
import { suggestForAccounts } from './suggest';

/** Build the accounts domain over the shared context + the account repository. */
export function createAccountsDomain(
  ctx: DomainContext,
  accounts: AccountRepository,
): AccountsDomain {
  const users = new UserRepository(ctx.connections.supabase);

  const requireUserId = async (): Promise<string> => {
    const id = await getCurrentUserId(ctx.config.storage);
    if (!id) throw new SdkError('No active session', 'NOT_AUTHENTICATED');
    return id;
  };

  const sparkNetworkFromConfig = (): 'MAINNET' | 'REGTEST' => {
    const sparkDefault = ctx.config.defaultAccounts?.find(
      (a) => a.type === 'spark' && a.currency === 'BTC',
    );
    return sparkDefault && sparkDefault.type === 'spark'
      ? sparkDefault.network
      : 'MAINNET';
  };

  return {
    async list() {
      return accounts.getAllActive(await requireUserId());
    },

    get(id: string) {
      return accounts.get(id);
    },

    async getDefault(params?: { currency?: Currency }) {
      const userId = await requireUserId();
      const user = await users.get(userId);
      if (!user) return null;
      const currency = params?.currency ?? user.defaultCurrency;
      const defaultId =
        currency === 'BTC' ? user.defaultBtcAccountId : user.defaultUsdAccountId;
      if (!defaultId) return null;
      return accounts.get(defaultId);
    },

    async add(config: AddAccountConfig) {
      const userId = await requireUserId();
      let created: Account;
      if (config.type === 'cashu') {
        created = await accounts.create({
          userId,
          type: 'cashu',
          name: config.name ?? 'Cashu',
          currency: config.currency,
          purpose: 'transactional',
          expiresAt: null,
          mintUrl: config.mintUrl,
          isTestMint: checkIsTestMint(config.mintUrl),
        });
      } else {
        created = await accounts.create({
          userId,
          type: 'spark',
          name: config.name ?? 'Spark',
          currency: config.currency,
          purpose: 'transactional',
          expiresAt: null,
          network: sparkNetworkFromConfig(),
        });
      }
      ctx.emitter.emit('account:updated', { account: created, op: 'created' });
      return created;
    },

    async setDefault(account: Account) {
      if (account.currency !== 'BTC' && account.currency !== 'USD') {
        throw new DomainError('Unsupported currency');
      }
      const userId = await requireUserId();
      const user = await users.get(userId);
      if (!user) throw new SdkError('No active session', 'NOT_AUTHENTICATED');
      const updated = await users.update(userId, {
        defaultBtcAccountId:
          account.currency === 'BTC' ? account.id : user.defaultBtcAccountId,
        defaultUsdAccountId:
          account.currency === 'USD' ? account.id : user.defaultUsdAccountId,
      });
      ctx.emitter.emit('user:updated', { user: updated });
    },

    async getBalance(account: Account): Promise<Money> {
      const balance = getAccountBalance(account);
      if (!balance) {
        throw new DomainError('Account balance is unavailable (offline)');
      }
      return balance;
    },

    suggestFor(intent: PaymentIntent, accountList: Account[]) {
      return Promise.resolve(suggestForAccounts(intent, accountList));
    },
  };
}
```

> `getDefault`'s offer-expiry path and the offer/gift-card `add` purposes are not exposed by the contract's `AddAccountConfig` (it only carries `transactional` cashu/spark adds) — offer/gift-card accounts are created elsewhere (gift-card flows, S-later). S4's `add` covers the contract's surface (transactional). `setDefault` preserving `defaultCurrency`: the contract `setDefault` doesn't change currency, so it is omitted from the update (matches `setDefaultCurrency:false`); `users.update` only writes the provided fields (S3 repo).

- [ ] **Step 2: Write the test** (`accounts-domain.test.ts`) — mock `getCurrentUserId` via storage (no module mock; `getCurrentUserId` reads the access token from storage), inject a fake `AccountRepository`, drive `getDefault`/`setDefault`/`add`/`getBalance`/`suggestFor`:

```ts
import { describe, expect, it } from 'bun:test';
import { Money } from '@agicash/money';
import { createAccountsDomain } from './accounts-domain';
import type { DomainContext } from '../context';
import type { SdkConfig } from '../../config';
import type { AccountRepository } from '../../internal/repositories/account-repository';
import { SdkEventEmitter } from '../../internal/event-emitter';
import type { SdkEventMap } from '../../events';
import { inMemoryStorage, jwtWith, makeFakeDb } from '../../internal/test-support';

const userRow = {
  id: 'u1',
  username: 'a',
  email: 'a@b.co',
  email_verified: true,
  created_at: 't',
  updated_at: 't',
  cashu_locking_xpub: 'x',
  encryption_public_key: 'e',
  spark_identity_public_key: 's',
  default_btc_account_id: 'btc-acc',
  default_usd_account_id: null,
  default_currency: 'BTC',
  terms_accepted_at: null,
  gift_card_mint_terms_accepted_at: null,
};

const sparkAccount = {
  id: 'btc-acc',
  type: 'spark',
  currency: 'BTC',
  balance: new Money({ amount: 500, currency: 'BTC', unit: 'sat' }),
} as never;

function ctx(db: ReturnType<typeof makeFakeDb>): {
  ctx: DomainContext;
  events: { user: unknown[]; account: unknown[] };
} {
  const emitter = new SdkEventEmitter<SdkEventMap>();
  const events = { user: [] as unknown[], account: [] as unknown[] };
  emitter.on('user:updated', (e) => events.user.push(e));
  emitter.on('account:updated', (e) => events.account.push(e));
  return {
    ctx: {
      config: {
        storage: inMemoryStorage({ access_token: jwtWith({ sub: 'u1' }) }),
        defaultAccounts: [
          {
            type: 'spark',
            currency: 'BTC',
            name: 'Bitcoin',
            network: 'MAINNET',
            purpose: 'transactional',
            isDefault: true,
          },
        ],
      } as unknown as SdkConfig,
      connections: { supabase: db } as unknown as DomainContext['connections'],
      emitter,
    },
    events,
  };
}

const fakeRepo = (over: Partial<AccountRepository> = {}): AccountRepository =>
  ({
    getAllActive: async () => [sparkAccount],
    get: async (id: string) => (id === 'btc-acc' ? sparkAccount : null),
    create: async () => ({ ...sparkAccount, id: 'new' }),
    ...over,
  }) as unknown as AccountRepository;

describe('accounts domain', () => {
  it('getDefault reads the user row and returns the default account', async () => {
    const { ctx: c } = ctx(
      makeFakeDb({ selectResult: { data: userRow, error: null } }),
    );
    const account = await createAccountsDomain(c, fakeRepo()).getDefault();
    expect(account?.id).toBe('btc-acc');
  });

  it('setDefault updates the user row and emits user:updated', async () => {
    const calls = { update: [] as unknown[] };
    const { ctx: c, events } = ctx(
      makeFakeDb({
        selectResult: { data: userRow, error: null },
        updateResult: { data: { ...userRow }, error: null },
        calls,
      }),
    );
    await createAccountsDomain(c, fakeRepo()).setDefault(sparkAccount);
    expect(calls.update[0]).toEqual({
      default_btc_account_id: 'btc-acc',
      default_usd_account_id: null,
    });
    expect(events.user).toHaveLength(1);
  });

  it('add(spark) creates + emits account:updated{op:created}', async () => {
    const { ctx: c, events } = ctx(makeFakeDb({}));
    const created = await createAccountsDomain(c, fakeRepo()).add({
      type: 'spark',
      currency: 'BTC',
    });
    expect(created.id).toBe('new');
    expect(events.account).toHaveLength(1);
  });

  it('getBalance returns the spark balance', async () => {
    const { ctx: c } = ctx(makeFakeDb({}));
    const balance = await createAccountsDomain(c, fakeRepo()).getBalance(
      sparkAccount,
    );
    expect(balance.toString()).toBe(
      new Money({ amount: 500, currency: 'BTC', unit: 'sat' }).toString(),
    );
  });
});
```

- [ ] **Step 3: Verify + commit.** `bun --filter=@agicash/wallet-sdk run test` → PASS. `bun run typecheck` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): accounts domain (list/get/getDefault/add/setDefault/getBalance/suggestFor)

Compose the account + user repositories + helpers. add emits
account:updated{op:created}; setDefault updates the user's default-for-currency
and emits user:updated; getBalance derives via getAccountBalance; suggestFor is
pure.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Scan domain

**Files:** Create `src/domains/scan/scan-domain.ts` + `.test.ts`.

- [ ] **Step 1: Implement** (`src/domains/scan/scan-domain.ts`) — port `classify-input.ts`, mapping its result to the contract's `ParsedDestination` and reading `allowLocalhost` from config; throw `DomainError` on unrecognized input:

```ts
import type { ScanDomain } from '../../domains';
import { DomainError } from '../../errors';
import type { ParsedDestination } from '../../types/scan';
import { parseBolt11Invoice } from '../../internal/lib/bolt11';
import { extractCashuToken } from '../../internal/lib/cashu';
import { buildLightningAddressFormatValidator } from '../../internal/lib/lnurl';
import type { DomainContext } from '../context';

/** Build the scan domain. `parse` classifies raw input into a ParsedDestination. */
export function createScanDomain(ctx: DomainContext): ScanDomain {
  const validateLnAddressFormat = buildLightningAddressFormatValidator({
    message: 'invalid',
    allowLocalhost: ctx.config.allowLocalhostLightningAddress ?? false,
  });

  return {
    async parse(input: string): Promise<ParsedDestination> {
      const trimmed = input.trim();

      const cashu = extractCashuToken(trimmed);
      if (cashu) {
        return { kind: 'cashu-token', token: cashu };
      }

      const bolt11 = parseBolt11Invoice(trimmed);
      if (bolt11.valid) {
        return { kind: 'bolt11', invoice: bolt11.decoded };
      }

      const lowered = trimmed.toLowerCase();
      if (validateLnAddressFormat(lowered) === true) {
        return { kind: 'ln-address', address: lowered };
      }

      throw new DomainError('Unrecognized payment destination');
    },
  };
}
```

> `extractCashuToken` returns `{ encoded, metadata } | undefined` (the `ParsedToken` shape). Confirm the contract `ParsedDestination` `cashu-token` payload field name is `token` (it is) and that `extractCashuToken`'s return matches `ParsedToken` (`{ encoded, metadata }`) — wire directly. `parseBolt11Invoice` returns `{ valid: true; encoded; decoded } | { valid: false }`; `decoded` matches `Bolt11Invoice` after Task 6.

- [ ] **Step 2: Write the test** (`scan-domain.test.ts`) — real fixtures (no mocks). Port representative cases from `classify-input.test.ts`, adapting assertions to `ParsedDestination`:

```ts
import { describe, expect, it } from 'bun:test';
import { createScanDomain } from './scan-domain';
import type { DomainContext } from '../context';
import type { SdkConfig } from '../../config';

// A real testnet/mainnet bolt11 + a real cashu token string from
// classify-input.test.ts — copy the exact fixtures used there.
const BOLT11 = '<copy a valid bolt11 fixture from classify-input.test.ts>';
const CASHU_TOKEN = '<copy a valid cashuB token fixture from token.test.ts>';

function domain(allowLocalhost = false) {
  const ctx = {
    config: { allowLocalhostLightningAddress: allowLocalhost } as unknown as SdkConfig,
  } as DomainContext;
  return createScanDomain(ctx);
}

describe('scan domain parse', () => {
  it('classifies a cashu token', async () => {
    const result = await domain().parse(CASHU_TOKEN);
    expect(result.kind).toBe('cashu-token');
  });

  it('classifies a bolt11 invoice', async () => {
    const result = await domain().parse(BOLT11);
    expect(result.kind).toBe('bolt11');
    if (result.kind === 'bolt11') {
      expect(typeof result.invoice.paymentHash).toBe('string');
    }
  });

  it('classifies a lightning address', async () => {
    const result = await domain().parse('alice@agi.cash');
    expect(result).toEqual({ kind: 'ln-address', address: 'alice@agi.cash' });
  });

  it('throws DomainError on garbage', async () => {
    await expect(domain().parse('not a destination')).rejects.toThrow();
  });
});
```

> Lift the exact `BOLT11` / `CASHU_TOKEN` fixtures from `apps/web-wallet/app/features/scan/classify-input.test.ts` and `apps/web-wallet/app/lib/cashu/token.test.ts` so the cases exercise real decoding. Do NOT invent invoice/token strings.

- [ ] **Step 3: Verify + commit.** `bun --filter=@agicash/wallet-sdk run test` → PASS. `bun run typecheck` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): scan domain (classify-input → ParsedDestination)

Port classify-input: cashu token → bolt11 → ln-address, mapping to the contract
ParsedDestination; allowLocalhost from config (replaces import.meta.env.MODE).
Unrecognized input → DomainError. Tests use real bolt11/token fixtures.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: ExchangeRate domain

**Files:** Create `src/domains/exchange-rate/{providers/types,providers/coinbase,providers/coingecko,providers/mempool-space,exchange-rate-service}.ts` + ported service test, `src/domains/exchange-rate/exchange-rate-domain.ts` + `.test.ts`.

- [ ] **Step 1: Vendor the service + providers + types.** Copy verbatim (all framework-free; deps `ky` + `big.js` + `@agicash/money`):

```bash
mkdir -p packages/wallet-sdk/src/domains/exchange-rate/providers
cp apps/web-wallet/app/lib/exchange-rate/providers/types.ts packages/wallet-sdk/src/domains/exchange-rate/providers/types.ts
cp apps/web-wallet/app/lib/exchange-rate/providers/coinbase.ts packages/wallet-sdk/src/domains/exchange-rate/providers/coinbase.ts
cp apps/web-wallet/app/lib/exchange-rate/providers/coingecko.ts packages/wallet-sdk/src/domains/exchange-rate/providers/coingecko.ts
cp apps/web-wallet/app/lib/exchange-rate/providers/mempool-space.ts packages/wallet-sdk/src/domains/exchange-rate/providers/mempool-space.ts
cp apps/web-wallet/app/lib/exchange-rate/exchange-rate-service.ts packages/wallet-sdk/src/domains/exchange-rate/exchange-rate-service.ts
```

Fix the copied files' imports: change `~/lib/exchange-rate/providers/*` → `./providers/*` / `./types` as appropriate. The public `Ticker`/`Rates` types in `src/types/exchange-rate.ts` (Task 1) must be the canonical ones — have `providers/types.ts` re-export them (`export type { Ticker, Rates } from '../../../types/exchange-rate';`) and keep `ExchangeRateProvider`/`GetRatesParams` local, so the domain and the public surface share one `Ticker`/`Rates`.

- [ ] **Step 2: Port the service test.** Copy `apps/web-wallet/app/lib/exchange-rate/exchange-rate-service.test.ts` → `packages/wallet-sdk/src/domains/exchange-rate/exchange-rate-service.test.ts`, fixing imports to `./exchange-rate-service` / `./providers/types`. The web test injects fake providers into `new ExchangeRateService([...])`, so **no `ky` mock** is needed (DI). Keep cases verbatim.

- [ ] **Step 3: Implement the domain** (`src/domains/exchange-rate/exchange-rate-domain.ts`):

```ts
import type { Currency, Money } from '@agicash/money';
import type { ExchangeRateDomain } from '../../domains';
import type { Ticker } from '../../types/exchange-rate';
import { ExchangeRateService } from './exchange-rate-service';

/** Build the exchange-rate domain over the multi-provider service. */
export function createExchangeRateDomain(
  service: ExchangeRateService = new ExchangeRateService(),
): ExchangeRateDomain {
  return {
    getRates({ tickers }) {
      return service.getRates({ tickers });
    },
    getRate(ticker: Ticker) {
      return service.getRate(ticker);
    },
    async convert({ amount, to }: { amount: Money; to: Currency }) {
      if (amount.currency === to) return amount;
      const rate = await service.getRate(`${amount.currency}-${to}`);
      return amount.convert(to, rate);
    },
  };
}
```

> `Money.convert(currency, exchangeRate)` consumes a source/target-format rate; the web pairs `getExchangeRate(\`${amount.currency}-${to}\`)` with `amount.convert(to, rate)` (verified in `send-scanner.tsx` / `cashu-send-quote-service.ts`). Match that direction.

- [ ] **Step 4: Write the domain test** (`exchange-rate-domain.test.ts`) — inject a fake service (no network):

```ts
import { describe, expect, it } from 'bun:test';
import { Money } from '@agicash/money';
import { createExchangeRateDomain } from './exchange-rate-domain';
import type { ExchangeRateService } from './exchange-rate-service';

const fakeService = {
  getRates: async ({ tickers }: { tickers: string[] }) => ({
    timestamp: 0,
    [tickers[0] as string]: '0.0000005',
  }),
  getRate: async (ticker: string) =>
    ticker === 'USD-BTC' ? '0.0000005' : '100000',
} as unknown as ExchangeRateService;

describe('exchange-rate domain', () => {
  it('getRate delegates to the service', async () => {
    const domain = createExchangeRateDomain(fakeService);
    expect(await domain.getRate('BTC-USD')).toBe('100000');
  });

  it('convert returns the same amount for same currency', async () => {
    const domain = createExchangeRateDomain(fakeService);
    const usd = new Money({ amount: 100, currency: 'USD', unit: 'usd' });
    expect((await domain.convert({ amount: usd, to: 'USD' })).toString()).toBe(
      usd.toString(),
    );
  });

  it('convert uses getRate(`${from}-${to}`) + Money.convert', async () => {
    const domain = createExchangeRateDomain(fakeService);
    const usd = new Money({ amount: 100, currency: 'USD', unit: 'usd' });
    const btc = await domain.convert({ amount: usd, to: 'BTC' });
    expect(btc.currency).toBe('BTC');
  });
});
```

> Confirm the exact `Money` unit literals + `convert` return-currency typing against `packages/money/src/money.ts` when implementing; adjust the fixture amounts/units so the conversion math is well-formed.

- [ ] **Step 5: Verify + commit.** `bun --filter=@agicash/wallet-sdk run test` → PASS. `bun run typecheck` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): exchangeRate domain (getRates/getRate/convert)

Vendor the framework-free ExchangeRateService + 3 providers (coinbase/coingecko/
mempool) sharing the public Ticker/Rates types; port the service test (DI'd
providers, no ky mock). convert = getRate(`${from}-${to}`) + Money.convert.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Wire `accounts` + `scan` + `exchangeRate` into `Sdk`

**Files:** Modify `src/internal/connections/index.ts`, `src/sdk.ts`, `src/sdk.test.ts`.

- [ ] **Step 1: Extend `SdkConnections` + `buildConnections`** (`src/internal/connections/index.ts`). Add the encryption service + wallet services + mint-auth, sourcing config; wire the real `connect`/`fetchMintMetadata`/`generateToken` closures:

```ts
import { Mint } from '@cashu/cashu-ts';
import { mnemonicToSeedSync } from '@scure/bip39';
import { ExtendedMintInfo } from '../lib/cashu';
import { CASHU_MNEMONIC_PATH, SPARK_MNEMONIC_PATH } from '../crypto/keys';
import { EncryptionService } from '../crypto/encryption';
import { connectBreez } from './breez';
import { CashuWalletService, type MintMetadata } from './cashu-wallet';
import { MintAuthTokenProvider } from './mint-auth';
import { SparkWalletService } from './spark-wallet';
import type { SparkNetwork } from '../../types/dependencies';
```

Extend the `SdkConnections` type:

```ts
export type SdkConnections = {
  supabase: SupabaseClient<Database>;
  session: SupabaseSessionTokenProvider;
  realtime: SupabaseRealtimeManager;
  keys: KeyProvider;
  encryption: EncryptionService;
  cashuWallets: CashuWalletService;
  sparkWallets: SparkWalletService;
  mintAuth: MintAuthTokenProvider;
  /** Cashu BIP39 seed (memoized) for wallet init; derived from the cashu child mnemonic. */
  getCashuSeed: () => Promise<Uint8Array>;
};
```

In `buildConnections`, after `keys`:

```ts
  const encryption = new EncryptionService(keys);

  let cashuSeed: Promise<Uint8Array> | null = null;
  const getCashuSeed = () => {
    cashuSeed ??= keys
      .getChildMnemonic(CASHU_MNEMONIC_PATH)
      .then((mnemonic) => mnemonicToSeedSync(mnemonic));
    return cashuSeed;
  };

  const cashuWallets = new CashuWalletService(async (mintUrl) => {
    const mint = new Mint(mintUrl);
    const [info, keysets, mintKeys] = await Promise.all([
      mint.getInfo(),
      mint.getKeySets(),
      mint.getKeys(),
    ]);
    return {
      mintInfo: new ExtendedMintInfo(info),
      keysets,
      keys: mintKeys,
    } satisfies MintMetadata;
  });

  const sparkWallets = new SparkWalletService(async (network: SparkNetwork) => {
    const mnemonic = await keys.getChildMnemonic(SPARK_MNEMONIC_PATH);
    return connectBreez(
      {
        apiKey: config.breezApiKey ?? '',
        network: network.toLowerCase() as 'mainnet' | 'regtest',
        storageDir: config.sparkStorageDir ?? './.spark-data',
        debugLogging: config.debugLoggingSpark ?? false,
      },
      mnemonic,
    );
  });

  const mintAuth = new MintAuthTokenProvider(
    async () => (await generateThirdPartyToken('agicash-mint')).token,
    () => isLoggedIn(config.storage),
  );

  return {
    supabase,
    session,
    realtime,
    keys,
    encryption,
    cashuWallets,
    sparkWallets,
    mintAuth,
    getCashuSeed,
  };
```

> Reconcile `new Mint(mintUrl).getInfo()/getKeySets()/getKeys()` + `new ExtendedMintInfo(info)` against `@cashu/cashu-ts@3.6.1` (master's `mintInfoQueryOptions` does `new ExtendedMintInfo(await new Mint(mintUrl).getInfo())`). Confirm `generateThirdPartyToken` accepts the `'agicash-mint'` audience arg and `MintAuthTokenProvider`'s `isLoggedIn` param type matches `() => Promise<boolean>` (it does — `isLoggedIn(storage)` is async).

- [ ] **Step 2: Wire the three domains in `sdk.ts`.** Add imports:

```ts
import { createAccountsDomain } from './domains/accounts/accounts-domain';
import { createScanDomain } from './domains/scan/scan-domain';
import { createExchangeRateDomain } from './domains/exchange-rate/exchange-rate-domain';
import { AccountRepository } from './internal/repositories/account-repository';
```

Change the `accounts`/`scan`/`exchangeRate` fields from stub initializers to declared fields:

```ts
  readonly accounts: AccountsDomain;
  readonly scan: ScanDomain;
  readonly exchangeRate: ExchangeRateDomain;
```

(delete their `= notImplementedDomain<…>(…)` initializers; keep the other 6 stubs: `cashu`, `spark`, `transactions`, `contacts`, `transfers`, `background`).

In the constructor body (after `this.user`/`this.auth`):

```ts
    const accountRepository = new AccountRepository(
      connections.supabase,
      connections.encryption,
      connections.cashuWallets,
      connections.sparkWallets,
      connections.mintAuth,
      connections.getCashuSeed,
    );
    this.accounts = createAccountsDomain(ctx, accountRepository);
    this.scan = createScanDomain(ctx);
    this.exchangeRate = createExchangeRateDomain();
```

Update the class JSDoc line that lists which domains are real (auth + user + accounts + scan + exchangeRate now; 6 stubbed).

- [ ] **Step 3: Update `sdk.test.ts`.** Extend the config fixture if needed (it already has `defaultAccounts`; ensure `storage` present). Replace/extend the "unimplemented domains still throw" test so the now-real domains are asserted real and the remaining 6 still throw:

```ts
  it('accounts, scan, and exchangeRate domains are wired (not NotImplemented)', async () => {
    const sdk = await Sdk.create(config);
    expect(typeof sdk.accounts.list).toBe('function');
    expect(typeof sdk.scan.parse).toBe('function');
    expect(typeof sdk.exchangeRate.getRate).toBe('function');
    await sdk.destroy();
  });
  it('still-unimplemented domains throw NotImplementedError', async () => {
    const sdk = await Sdk.create(config);
    expect(() => sdk.cashu.send.failQuote({} as never, 'x')).toThrow(
      NotImplementedError,
    );
    expect(() => sdk.transactions.countPendingAck()).toThrow(NotImplementedError);
    expect(() => sdk.background.state()).toThrow(NotImplementedError);
    await sdk.destroy();
  });
```

> `Sdk.create(config)` now builds the wallet services in `buildConnections`. With `@cashu/cashu-ts`/`@agicash/breez-sdk-spark` imported at module load, ensure `sdk.test.ts` does NOT trigger a real connect/fetch (it doesn't — `create` only constructs the services; no account read happens). If any import-time WASM/global init is triggered by `@agicash/breez-sdk-spark`, guard the test per the carryover `breezModuleMock` factory + `afterAll(() => mock.restore())`. Prefer no mock if `create` stays inert.

- [ ] **Step 4: Run the FULL gate.** `bun run typecheck` → PASS (all 4 packages; the web is untouched and still does not import the SDK). `bun run test` → PASS (all SDK unit tests incl. the new ones).

- [ ] **Step 5: Commit.**

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): wire real accounts + scan + exchangeRate domains into Sdk

Extend buildConnections with the EncryptionService + cashu/spark wallet services
+ mint-auth (live handle memos; real cashu-ts Mint + connectBreez closures), and
build the accounts/scan/exchangeRate domains in the Sdk constructor. The other 6
domains stay NotImplemented.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Verification Gate (slice done when)

- `bun run typecheck` green (4 packages) and `bun run test` green (all new SDK unit tests).
- **No named S4 regression** in spec §10 — the stale-balance `synced` re-read (S7), nutshell-#788 change refetch (S7), taken-username (S3, done), and transfer auto-fail (S8) belong to other slices. S4's load-bearing correctness is: cashu/spark **offline fallback** (wallet stub / minimal wallet + `isOnline:false`), the **connect-once** + **mint-metadata** memos, proof **decryption** round-trip, and `suggestFor`'s partition/throw behavior — all covered by unit tests.
- `types/dependencies.ts` placeholders are wired to real types (Task 6) and `Account.wallet` is a live `ExtendedCashuWallet`/`BreezSdk` handle (no `unknown`).
- The web still typechecks (it does not import the SDK yet; the dark build is untouched).
- Spot-check by reading the test assertions: spark connect-once + offline stub; cashu offline fallback + metadata memo; repository proof decryption; `getDefault`/`setDefault`/`add` event emissions; `suggestFor` ranking + DomainError; scan classification on real fixtures; exchangeRate `convert` direction.

---

## Self-Review

**1. Spec coverage (§7b accounts/scan/exchangeRate + §4 internal lib + §6 exchangeRate delta + D4 forks):**
- accounts: types/utils, repo (`toAccount`+decrypt+wallet-init), service logic, `add`/`getDefault`/`setDefault`/`getBalance`/`suggestFor` ✔ (T11 repo, T12 utils, T13 suggest, T14 domain). `AccountsCache`/change-handlers stay web-side (not SDK) ✔.
- scan: `classify-input` → `domains/scan`; `MODE` → config ✔ (T1 config, T15 domain).
- exchangeRate: service + 3 providers → `domains/exchange-rate` exposing `getRates`/`getRate`/`convert` ✔ (T1 delta, T16 vendor+domain).
- Lib extraction (§4 `internal/lib`: cashu-protocol · bolt11 · lnurl; ecies already S2): ✔ (T3 bolt11, T4 lnurl, T5 cashu, T6 wire). spark stub/errors ✔ (T9).
- Live wallet-handle resolution + the no-cache memos (D4-1/D4-2): ✔ (T9 spark, T10 cashu, T11 repo, T17 wiring).
- Encryption service (gap vs S2 primitives): ✔ (T8).
- DB detail schemas + guards: ✔ (T7).
- Out of scope held: melt/mint subscriptions + payment-request (barrel trimmed, T5); spark balance listener / §8 reconcile (S7); cashuMintValidator instance + blocklist config (S5); offer/gift-card `add` purposes beyond the contract surface (later).

**2. Placeholder scan:** vendored files (bolt11, lnurl, cashu subset, json/zod, spark errors, exchange-rate service+providers) are concrete copies with named source paths + explicit couplings to strip + tests to port — the S2/S3-blessed pattern. Net-new logic (EncryptionService, SparkWalletService, CashuWalletService, MintAuthTokenProvider, AccountRepository, account-utils, suggest, the three domains, the Sdk/buildConnections wiring) shows complete code. The handful of "reconcile against node_modules / read master side-by-side" notes (cashu-ts `KeyChain`/`loadMintFromCache`/`Mint` API; `Money.convert`/`greaterThanOrEqual`/`isPositive`; `ProofSchema.shape` null handling; `generateThirdPartyToken` audience; `makeFakeDb` awaited-builder) point at exact files/symbols — not open-ended TODOs. Test fixtures for scan are explicitly "lift the real bolt11/token strings from <named test files>" (no invented invoices).

**3. Type consistency:** `Ticker`/`Rates` (T1, `types/exchange-rate.ts`) consumed by `domains.ts` (T1), the public barrel (T1), the vendored providers (T16). `DecodedBolt11`→`Bolt11Invoice` + cashu-ts→`ParsedToken`/`ProofDleq`/`ProofWitness` + lib→`ExtendedCashuWallet` + breez→`BreezSdk` (T6) consumed by `types/account.ts`/`types/scan.ts`/the repo. `EncryptionService` (T8) used by the repo (T11) + bundle (T17). `SparkWalletService`/`createSparkWalletStub` (T9), `CashuWalletService`/`MintMetadata` (T10), `MintAuthTokenProvider`/`getMintAuthProvider` (T10) used by the repo (T11) + bundle (T17). `isCashuAccount`/`isSparkAccount` + detail schemas (T7) used by the repo (T11). `AccountRepository` (T11) + `account-utils` (T12) + `suggestForAccounts` (T13) used by the accounts domain (T14). `getCurrentUserId` (S2) + `UserRepository` (S3) reused by the accounts domain. `createAccountsDomain`/`createScanDomain`/`createExchangeRateDomain` (T14/T15/T16) + `AccountRepository` wired in `sdk.ts` (T17); `SdkConnections` additions (T17) match the repo/bundle consumers. Event payloads match `events.ts`: `account:updated {account, op:'created'}` (add), `user:updated {user}` (setDefault).

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-06-13-wallet-sdk-04-accounts-scan-exchange-rate.md`. **Subagent-Driven (recommended)** — fresh subagent per task + two-stage review. Task order is dependency-forced: T1 (contract/config) → T2 (deps) → T3/T4/T5 (leaf libs) → T6 (wire placeholders) → T7 (db) → T8 (encryption) → T9/T10 (wallet services + mint-auth) → T11 (repo) → T12/T13 (utils, suggest) → T14 (accounts domain) → T15 (scan) → T16 (exchangeRate) → T17 (wire Sdk + full gate). T3–T5 are independent leaves after T2; T8/T9/T10 are independent after T7; T12/T13 independent after T11. (Alternative: inline execution via executing-plans.)

**Testing note (carryover):** Prefer DI over `mock.module` — the wallet services (injected `connect`/`fetchMintMetadata`), the exchange-rate service (injected providers), and the repo (injected services) are all testable without module mocks, sidestepping bun's process-global `mock.module`. Where `mock.module` is unavoidable, every such test file MUST add `afterAll(() => mock.restore())` and use the COMPLETE `openSecretModuleMock`/`breezModuleMock` factories from `internal/test-support.ts` (modules with direct `import { x }` bindings fail to load on a partial mock).
