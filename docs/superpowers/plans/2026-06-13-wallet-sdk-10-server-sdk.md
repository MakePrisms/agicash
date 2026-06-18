# Wallet SDK — S10: `ServerSdk` facade (server-mode LNURL/lightning-address surface) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the narrow server-mode facade `createServer(config): ServerSdk` over the **same** shared internals as the client `Sdk` — a service-role Supabase client + a dedicated **server** Spark wallet (own mnemonic + storageDir) + seedless cashu mint clients — exposing exactly three session-less operations the Lightning-Address routes need: resolve a username → public receiving capability, create a receive quote (cashu **or** spark) for a resolved account, and read a quote's settle status (LUD-21 verify). All verified by SDK unit tests alone; the web + RR routes stay untouched (S14 cuts the routes over to `ServerSdk`).

**Architecture:** Slice S10 of the no-cache full migration (spec §9 Phase 1, the LAST Phase-1 slice). Server mode is **request-scoped**: no OpenSecret session, no per-user keys, no background loop, no realtime, no leader election (spec D9/§3/§8; S9→S10 carryover). The server holds none of the receiving user's private keys — it encrypts stored receive-quote data **to the receiving user's public key** (`encryptToPublicKey`), locks cashu mint quotes to the user's `cashuLockingXpub`, and mints spark invoices claimable only by the user's `sparkIdentityPublicKey`. `ServerSdk` is a **standalone narrow facade**, NOT a subclass of `Sdk` (subclassing drags in all 11 client domains + the `protected (config, SdkConnections)` ctor — spec D9: "not one class branching on mode"). The session-agnostic receive-quote **cores** (`getLightningQuote` for cashu + spark) are reused verbatim; S10 adds only the create-only server repos/services (encrypt-to-pubkey, minimal `*Created` returns), a server account resolver, the server connection bundle, and the facade.

**Tech Stack:** Bun workspaces, TypeScript 5.9.3, `@agicash/breez-sdk-spark` (`BreezSdk` — `receivePayment`, `getLightningReceiveRequest`), `@cashu/cashu-ts` (`ExtendedCashuWallet.createLockedMintQuote`/`checkMintQuoteBolt11`, `MintQuoteState`), `@agicash/money`, `zod/mini`, `bun:test`. The SDK's `internal/crypto` (ECIES `encryptToPublicKey`, `sha256Hex`), `internal/connections` (`createServerClient`, `SparkWalletService`, `CashuWalletService`, `connectBreez`), `internal/lib/cashu` (`getCashuWallet`), and the existing receive-quote cores.

---

## Scope boundary (read first)

**In scope (S10):**
- **Export** the already-implemented private `encryptToPublicKey` from `internal/crypto/encryption.ts` (the named crypto helper — it is byte-identical to the web's; do NOT reimplement).
- **`SdkConfig.serverSparkMnemonic?: string`** (server-only; runtime-required by `createServer`).
- **Server receive-quote repos** (`internal/repositories/{cashu,spark}-receive-quote-repository.server.ts`): create-only, `db: SupabaseClient<Database>` (service-role), encrypt-to-pubkey, return minimal `CashuReceiveQuoteCreated` / `SparkReceiveQuoteCreated`. Offline-tested with `makeFakeDb` + a random ECIES pubkey.
- **Server receive-quote services** (`domains/{cashu,spark}/{cashu,spark}-receive-quote-service.server.ts`): mirror the client services, thread `userEncryptionPublicKey`; the spark service adds a `getLightningQuote` wrapper.
- **`ServerAccountRepository.getDefaultAccount(userId, currency?)`** (`internal/repositories/server-account-repository.ts`): resolve the receiving account → `RedactedAccount` (no proof decryption; seedless cashu wallet / server spark wallet).
- **`buildServerConnections(config): ServerConnections`** + the `ServerConnections` type (`internal/connections/server-connections.ts`), reusing `createServerClient` + a dedicated server `SparkWalletService` + a shared seedless `CashuWalletService` builder extracted from `buildConnections` (DRY).
- **`ServerSdk` + `createServer`** (`src/server-sdk.ts`): the three operations over the bundle; re-exported from `index.ts`.

**Out of scope (S14 — the web cut-over, do NOT build here):**
- The RR routes (`[.]well-known.lnurlp.$username.ts`, `api.lnurlp.callback.$userId.ts`, `api.lnurlp.verify.$encryptedQuoteData.ts`) stay untouched on this branch. **The LUD JSON wire format, the `verify`-URL base prefix, the msat parsing, the range-error strings, and the xchacha20poly1305 encode/decode of the opaque `$encryptedQuoteData` token (with `LNURL_SERVER_ENCRYPTION_KEY`) all STAY in the routes** (spec §6). `ServerSdk` works with a **structured `LnurlVerifyRef`**, not an encrypted token — see D10-3. S14 wires the routes → `ServerSdk` and deletes `lightning-address-service.ts` + the web `.server` repos.
- The web stays a dark build; S10 is verified by SDK unit tests alone.

---

## Decisions (locked — carry, do NOT re-litigate)

- **D10-1 — `ServerSdk` is a standalone narrow facade, NOT `extends Sdk`.** `Sdk`'s ctor is `protected (config: SdkConfig, connections: SdkConnections)` and assigns all 11 client domains; subclassing forces a full client `SdkConnections` (OpenSecret session, per-user keys, realtime, background) that server mode neither has nor wants. `ServerSdk` is its own class implementing a 3-method interface, with a DI'd-deps constructor + a thin `createServer(config)` assembler (mirrors `Sdk`'s `protected ctor` + `static create`, but with a server bundle). Spec D9.
- **D10-2 — `createServer(config: SdkConfig)` reuses `SdkConfig` + is SYNC.** Spec §4/§11 say `serverSparkMnemonic` arrives via `SdkConfig`; so add it to `SdkConfig` (top-level optional) rather than a separate `ServerConfig`. `openSecret`/`storage`/`defaultAccounts`/`lud16Domain`(partly)/`clientId` are simply unused by server paths. `buildServerConnections` is synchronous (Breez connect is lazy via `SparkWalletService`), so `createServer` returns `ServerSdk` (not a Promise) — matching spec §4's `createServer(config): ServerSdk`.
- **D10-3 — `ServerSdk` works with a structured `LnurlVerifyRef`; the verify-token xchacha stays ROUTE-side (S14).** `createLightningReceiveQuote` returns `{ paymentRequest, verify: LnurlVerifyRef }`; `getLightningReceiveStatus(ref)` takes the ref. The route (S14) owns the symmetric `LNURL_SERVER_ENCRYPTION_KEY` + the xchacha20poly1305 encode of the ref into the `verify`-URL path segment and its decode of the inbound `$encryptedQuoteData`. Rationale: the token is wire-transport obfuscation tied to the verify URL (spec §6 keeps wire format in routes); this keeps a server secret + a symmetric-key config seam out of the SDK. `LnurlVerifyRef = { type:'cashu'; quoteId; mintUrl } | { type:'spark'; quoteId }`.
- **D10-4 — Server repos are create-only + encrypt-to-pubkey + minimal `*Created`.** Port the web `.server` repos near-verbatim (they are already decrypt-free). The client repos (`Cashu/SparkReceiveQuoteRepository`) cannot be reused for create: they take an `EncryptionService` (the SDK user's own keypair) and their `toQuote` **decrypts** — impossible server-side. The server encrypts the receiveData to the **resolved receiver's** `encryptionPublicKey` (a per-request value), via the standalone `encryptToPublicKey(data, pubkeyHex)` (sync). They omit `p_purpose`/`p_transfer_id` (optional in the RPC; LN-address is always plain `LIGHTNING` `PAYMENT`).
- **D10-5 — Two distinct receiver pubkeys; do not conflate.** `receiverIdentityPubkey` = `user.sparkIdentityPublicKey` (Spark invoice-claim authority → Breez `receivePayment` + the `p_receiver_identity_pubkey` column). `userEncryptionPublicKey` = `user.encryptionPublicKey` (ECIES target for the stored receiveData). Spelling trap (carry verbatim): the spark core INPUT/RPC field is `receiverIdentityPubkey` (abbrev) but the core result field is `receiverIdentityPublicKey` (full); the service renames output→input. Cashu locking uses a THIRD key, `user.cashuLockingXpub` (NUT-20 locking, via the core).
- **D10-6 — Verify reads PROTOCOL CLIENTS, never the DB/decrypt.** Cashu: `getCashuWallet(mintUrl).checkMintQuoteBolt11(quoteId)`, `settled` when `state ∈ ['PAID','ISSUED']`, `preimage = ''` (cashu mint quotes have none), `pr = mintQuote.request`. Spark: `serverSparkWallet.getLightningReceiveRequest({ requestId: quoteId })` (→ `... | undefined`; `undefined` → `NotFoundError`), `settled = status === 'transferCompleted'`, `preimage = paymentPreimage ?? null`, `pr = invoice`. The server spark wallet's verify network is `'MAINNET'` (web parity; server spark accounts are mainnet in prod).
- **D10-7 — `min/max` are FIXED constants (1 sat / 1_000_000 sat, BTC), owned by `ServerSdk`.** `resolveLightningAddress` does NOT read the account (cashu-vs-spark resolution + FX are deferred to `createLightningReceiveQuote`). `createLightningReceiveQuote` range-checks the amount and throws `DomainError(..., 'amount_out_of_range')` (the route maps to the LUD error string). `bypassAmountValidation=false` (default; external requests) forces the **BTC** default account; `=true` (agicash↔agicash) uses the user's `defaultCurrency` account + an exchange-rate convert. The range check is unconditional (independent of `bypassAmountValidation`).
- **D10-8 — Spark descriptionHash commits to the LUD-06 metadata; cashu skips it.** `ServerSdk` derives the metadata string from `${username}@${config.lud16Domain}` (a private `buildLnurlMetadata` helper, mirroring the web's `buildLnurlpMetadata`), and the spark create path passes `descriptionHash = await sha256Hex(metadata)` (BOLT11 `h` tag). **The cashu path passes NO descriptionHash** (cashubtc/nuts#110). `resolveLightningAddress` returns the same `metadata` string so S14's LUD-16 route reuses it verbatim (so the wallet's computed `description_hash` matches the invoice's). Preserve this divergence.
- **CI gate:** `bun run typecheck` + `bun run test` (NOT `fix:all`), run from `packages/wallet-sdk/`. Commit per task locally; do not push.

---

## Global Constraints

- `SdkError`/`DomainError`/`NotFoundError` take **`(message, code)`**; `NotImplementedError` takes `(method)`. Every ported `new Error(msg, { cause })` that is a DB/RPC failure becomes `throw classify(error)` (`import { classify } from '../classify'` / `'../../internal/classify'` per layer). User-facing guard failures → `new DomainError(msg, code)`; not-found → `new NotFoundError(msg, code)`.
- **Never** bare `mock.module` (process-global; leaked into 100+ sibling tests in S3/S5). Use **DI'd fakes** (every new class takes its deps via the constructor) + `makeFakeDb` for repos with **real ECIES round-trips** (`internal/test-support.ts` + a random-key keypair). `spyOn` + `afterEach/afterAll(() => mock.restore())` only if a real prototype must be redirected.
- Per-task gate: `bun run typecheck` + `bun run test` (from `packages/wallet-sdk/`). **One git commit per task**, message `feat(wallet-sdk): …`.
- bun/bunx only. Worktree root is the cwd; SDK paths are under `packages/wallet-sdk/`. `noUnusedLocals` is OFF (but do not leave dead code). SDK runtime MAY use `new Date()`/`crypto.randomUUID()`.

---

## Grounding facts (verified 2026-06-18 — authoritative; re-verify the `>`-noted shapes before writing)

**SDK pieces S10 reuses as-is (do NOT rebuild):**
- `internal/connections/supabase-client.ts` — `createServerClient(config): SupabaseClient<Database>` (service-role, schema `wallet`, no session; throws `'createServerClient requires supabase.serviceRoleKey'`).
- `internal/connections/spark-wallet.ts` — `class SparkWalletService { constructor(connect: (network: SparkNetwork) => Promise<BreezSdk>); getInitialized(network): Promise<{ wallet: BreezSdk; balance: Money|null; isOnline: boolean }> }`. No change needed for a 2nd (server) instance.
- `internal/connections/breez.ts` — `connectBreez(cfg: { apiKey; network: 'mainnet'|'regtest'; storageDir; debugLogging? }, mnemonic): Promise<BreezSdk>`.
- `internal/connections/cashu-wallet.ts` — `class CashuWalletService { constructor(fetchMintMetadata: (mintUrl) => Promise<MintMetadata>); getInitialized(mintUrl, currency, bip39seed: Uint8Array|undefined, authProvider: AuthProvider|undefined): Promise<{ wallet: ExtendedCashuWallet; isOnline: boolean }> }`. **`bip39seed: undefined` is accepted** → seedless server wallet works for `createLockedMintQuote`/`checkMintQuoteBolt11`.
- `internal/lib/cashu` barrel — `getCashuWallet(mintUrl, options?: { unit?; bip39seed?; authProvider? }): ExtendedCashuWallet` (`utils.ts:272`); `ExtendedCashuWallet.checkMintQuoteBolt11(quoteId)` (`utils.ts:207`); `getCashuUnit(currency)`.
- `internal/crypto/encryption.ts` — `EncryptionService(keys)`; `getEncryption(priv, pubHex): Encryption`; and the **module-private** `encryptToPublicKey<T>(data: T, publicKeyHex: string): string` (`serializeData` → utf8 → `eciesEncrypt(bytes, hexToBytes(pubHex))` → `@stablelib/base64` `encode`). **SYNC.** Task 1 exports it.
- `internal/crypto/sha256.ts` — `sha256Hex(message: string): Promise<string>`.
- `internal/repositories/user-repository.ts` — `class UserRepository { constructor(db: SupabaseClient<Database>); get(id): Promise<User|null>; getByUsername(username): Promise<User|null>; … }`. Construct over the service-role client (RLS blocks reading a 3rd party's row otherwise).
- `internal/db/user-mapper.ts` — `toUser(dbUser: AgicashDbUser): User` (pure; no decrypt). `User` carries `username`, `cashuLockingXpub`, `encryptionPublicKey`, `sparkIdentityPublicKey`, `defaultCurrency`, `defaultBtcAccountId`, `defaultUsdAccountId`.
- `internal/db/account-details.ts` — `CashuAccountDetailsDbDataSchema` (`{ mint_url, is_test_mint, keyset_counters }`), `SparkAccountDetailsDbDataSchema` (`{ network }`), `isCashuAccount(data)`, `isSparkAccount(data)` (accept `AgicashDbAccountWithProofs`).
- `internal/db/database.ts` — `AgicashDbAccount`, `AgicashDbAccountWithProofs`, `Database`. `internal/db/{cashu,spark}-receive-quote-db-data.ts` — `CashuLightningReceiveDbDataSchema` / `SparkLightningReceiveDbDataSchema`.
- `domains/cashu/cashu-receive-quote-core.ts` — `getLightningQuote({ wallet: ExtendedCashuWallet; amount: Money; description?; xPub: string }): Promise<CashuReceiveLightningQuote>` (calls `wallet.createLockedMintQuote(amount.toNumber(unit), lockingPublicKey, description)`; returns `{ mintQuote: MintQuoteBolt11Response, lockingPublicKey, fullLockingDerivationPath, expiresAt, amount, description?, mintingFee?, paymentHash }`); `computeQuoteExpiry(params)`; `computeTotalFee(params)`; types `CreateQuoteBaseParams` (`account: RedactedCashuAccount`), `RepositoryCreateQuoteParams`.
- `domains/spark/spark-receive-quote-core.ts` — `getLightningQuote({ wallet: BreezSdk; amount: Money; receiverIdentityPubkey?; description?; descriptionHash? }): Promise<SparkReceiveLightningQuote>` (result `{ id, createdAt, updatedAt, invoice:{ paymentRequest, paymentHash, amount: Money<'BTC'>, createdAt, expiresAt, memo? }, status, receiverIdentityPublicKey? }`); `computeQuoteExpiry(params)`; `getAmountAndFee(params): { amount; totalFee }`; types `GetLightningQuoteParams`, `CreateQuoteBaseParams` (`account: SparkAccount`), `RepositoryCreateQuoteParams`.
- `types/account.ts` — `RedactedAccount = DistributedOmit<Account,'proofs'>`; `RedactedCashuAccount = Extract<RedactedAccount,{type:'cashu'}>`; the spark variant of `RedactedAccount` is structurally `SparkAccount` (spark has no `proofs`).
- `domains/exchange-rate/exchange-rate-domain.ts` — `createExchangeRateDomain(): ExchangeRateDomain` (no args); `convert({ amount: Money; to: Currency }): Promise<Money>`.
- `errors.ts` — `SdkError(message, code)` + `DomainError`/`NotFoundError` 2-arg subclasses. `internal/classify.ts` — `classify(error)`.
- `internal/test-support.ts` — `makeFakeDb({ selectResult, rpcResult, calls, … })` (awaitable builder + `.single()`/`.maybeSingle()`/`.eq()`/`.rpc()`; records `{ name:'rpc', args:[name, args] }` into `calls`). `EncryptionService` built from a random secp256k1 key (S5/S6 pattern).
- `internal/lib/lnurl/types.ts` — `LNURLPayParams`/`LNURLPayResult`/`LNURLVerifyResult`/`LNURLError` (the wire JSON shapes — **stay route-side**, S14).

**Web sources to port (verbatim shapes; repoint imports to SDK-internal):**
- `app/features/receive/cashu-receive-quote-repository.server.ts` → `CashuReceiveQuoteRepositoryServer` + `CashuReceiveQuoteCreated`.
- `app/features/receive/spark-receive-quote-repository.server.ts` → `SparkReceiveQuoteRepositoryServer` + `SparkReceiveQuoteCreated`.
- `app/features/receive/cashu-receive-quote-service.server.ts` → `CashuReceiveQuoteServiceServer`.
- `app/features/receive/spark-receive-quote-service.server.ts` → `SparkReceiveQuoteServiceServer`.
- `app/features/user/user-repository.ts` `ReadUserDefaultAccountRepository.getDefaultAccount` → `ServerAccountRepository.getDefaultAccount` (minus the `QueryClient`/web-spark wiring; uses the SDK's `CashuWalletService`/`SparkWalletService`).
- `app/features/receive/lightning-address-service.ts` (`handleLud16Request` / `handleLnurlpCallback` / `handleLnurlpVerify`) → the three `ServerSdk` methods (the LUD JSON shaping + xchacha verify-token stay in the routes, S14).

**Verified shapes for the wiring:**
- RPCs `create_cashu_receive_quote` (`p_user_id, p_account_id, p_currency, p_expires_at, p_locking_derivation_path, p_receive_type, p_encrypted_data, p_quote_id_hash, p_payment_hash`; `p_purpose?`/`p_transfer_id?` optional → omit) and `create_spark_receive_quote` (`p_user_id, p_account_id, p_currency, p_payment_hash, p_expires_at, p_spark_id, p_receiver_identity_pubkey, p_receive_type, p_encrypted_data`). Returns carry `id` (+ spark: `spark_id`).
- Breez: `wallet.getLightningReceiveRequest({ requestId }): Promise<{ id; status: LightningReceiveStatus; invoice: string; createdAt; updatedAt; transferId?; transferAmountSat?; paymentPreimage? } | undefined>`; `LightningReceiveStatus` includes `'transferCompleted'`.

---

## File Structure

**Created (SDK):**
- `src/internal/repositories/spark-receive-quote-repository.server.ts` (+ `.test.ts`) — `SparkReceiveQuoteRepositoryServer` + `SparkReceiveQuoteCreated`.
- `src/internal/repositories/cashu-receive-quote-repository.server.ts` (+ `.test.ts`) — `CashuReceiveQuoteRepositoryServer` + `CashuReceiveQuoteCreated`.
- `src/domains/spark/spark-receive-quote-service.server.ts` (+ `.test.ts`) — `SparkReceiveQuoteServiceServer`.
- `src/domains/cashu/cashu-receive-quote-service.server.ts` (+ `.test.ts`) — `CashuReceiveQuoteServiceServer`.
- `src/internal/repositories/server-account-repository.ts` (+ `.test.ts`) — `ServerAccountRepository`.
- `src/internal/connections/server-connections.ts` (+ `.test.ts`) — `buildServerConnections` + `ServerConnections`.
- `src/server-sdk.ts` (+ `server-sdk.test.ts`) — `ServerSdk` + `createServer` + the public types (`ServerSdk`, `LnurlVerifyRef`, `LightningAddressReceiveInfo`, `LightningReceiveQuoteResult`, `LightningReceiveStatusResult`).

**Modified (SDK):**
- `src/internal/crypto/encryption.ts` (+ `.test.ts`) — export `encryptToPublicKey`.
- `src/config.ts` — add `serverSparkMnemonic?: string`.
- `src/internal/connections/index.ts` — extract a shared `buildCashuWalletService()` (DRY; consumed by both `buildConnections` + `buildServerConnections`).
- `src/index.ts` (+ `index.test.ts` if present) — re-export `createServer` + the `ServerSdk` public types.

**Not touched in S10:** the RR routes, `lightning-address-service.ts`, the web `.server` repos (S14 deletes them), `sdk.ts` (the client facade is unchanged).

---

## Task 1: Export `encryptToPublicKey` (prove server-encrypt → client-decrypt byte-compat)

**Files:**
- Modify: `packages/wallet-sdk/src/internal/crypto/encryption.ts`
- Modify: `packages/wallet-sdk/src/internal/crypto/encryption.test.ts`

**Interfaces:**
- Produces: `export function encryptToPublicKey<T = unknown>(data: T, publicKeyHex: string): string` — ECIES-encrypts (serialize-aware) to an arbitrary public key; base64 string. The server repos (Tasks 2/3) consume it.

- [ ] **Step 1: Write the failing test** — append to `encryption.test.ts`. It encrypts to a random keypair's public key with the (to-be-exported) standalone fn, then decrypts with that keypair's `Encryption` (which uses the private key) — proving the server-encrypted blob round-trips through the client decrypt path, incl. a `Money` field.

```ts
import { Money } from '@agicash/money';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { encryptToPublicKey, getEncryption } from './encryption';

describe('encryptToPublicKey (exported, server-mode)', () => {
  it('produces a blob the holder of the private key can decrypt (Money survives)', async () => {
    const priv = secp256k1.utils.randomPrivateKey();
    const pubHex = bytesToHex(secp256k1.getPublicKey(priv, true)); // 33-byte compressed
    const payload = { hello: 'world', fee: new Money({ amount: 3, currency: 'BTC', unit: 'sat' }) };

    const blob = encryptToPublicKey(payload, pubHex);
    expect(typeof blob).toBe('string');

    const decrypted = await getEncryption(priv, pubHex).decrypt<typeof payload>(blob);
    expect(decrypted.hello).toBe('world');
    expect(decrypted.fee).toBeInstanceOf(Money);
    expect(decrypted.fee.toNumber('sat')).toBe(3);
  });
});
```

> Confirm `getEncryption` is exported from `encryption.ts` (it is — `EncryptionService.build` calls it). If the file already imports `Money`/`secp256k1`/`bytesToHex` in its existing tests, reuse those imports. `encryptToPublicKey` accepts a 33-byte compressed or 32-byte schnorr x-only hex (`parsePublicKey` lifts both).

- [ ] **Step 2: Run it; expect FAIL** — `bun test src/internal/crypto/encryption.test.ts -t "server-mode"`. Expected: FAIL (`encryptToPublicKey` is not exported — import error / undefined).

- [ ] **Step 3: Export the function** — in `encryption.ts`, add `export` to the existing private declaration. No body change:

```ts
export function encryptToPublicKey<T = unknown>(
  data: T,
  publicKeyHex: string,
): string {
  // ...existing body unchanged...
}
```

> Do NOT reimplement or move the serialization. The existing `serializeData`/`preprocessData` (Money/Date/undefined/non-finite handling) must stay co-located so server-encrypted blobs are byte-compatible with the client's `decrypt`/`deserializeData`. Only add the `export` keyword. (Leave `decryptWithPrivateKey`/`encryptBatchToPublicKey` private — the server never decrypts and S10 needs no batch.)

- [ ] **Step 4: Run it; expect PASS** — `bun test src/internal/crypto/encryption.test.ts`. Expected: all pass (incl. the existing tests).

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/internal/crypto/encryption.ts src/internal/crypto/encryption.test.ts
git commit -m "$(cat <<'EOF'
feat(wallet-sdk): export encryptToPublicKey (server-mode encrypt-to-recipient)

Surface the existing module-private ECIES encryptToPublicKey so server-mode
receive-quote repos can encrypt stored data to the receiving user's public key
(no per-user private key server-side). Round-trip test proves a server-encrypted
blob decrypts via the holder's keypair, Money field intact. Gate green.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `SparkReceiveQuoteRepositoryServer` + `SparkReceiveQuoteCreated`

**Files:**
- Create: `packages/wallet-sdk/src/internal/repositories/spark-receive-quote-repository.server.ts`
- Create: `packages/wallet-sdk/src/internal/repositories/spark-receive-quote-repository.server.test.ts`

**Interfaces:**
- Consumes: `encryptToPublicKey` (Task 1); `SparkLightningReceiveDbDataSchema` (`../db/spark-receive-quote-db-data`); `RepositoryCreateQuoteParams` (`../../domains/spark/spark-receive-quote-core`); `classify`; `Database`.
- Produces: `class SparkReceiveQuoteRepositoryServer { constructor(db: SupabaseClient<Database>); create(params: RepositoryCreateQuoteParams & { userEncryptionPublicKey: string }, options?: { abortSignal?: AbortSignal }): Promise<SparkReceiveQuoteCreated> }` and `type SparkReceiveQuoteCreated`.

- [ ] **Step 1: Write the failing test** — `spark-receive-quote-repository.server.test.ts`. `makeFakeDb` + a random ECIES pubkey (server has only the pubkey).

```ts
import { describe, expect, it } from 'bun:test';
import { Money } from '@agicash/money';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { makeFakeDb } from '../test-support';
import { SparkReceiveQuoteRepositoryServer } from './spark-receive-quote-repository.server';

const userEncryptionPublicKey = bytesToHex(
  secp256k1.getPublicKey(secp256k1.utils.randomPrivateKey(), true),
);
const sat = (n: number) => new Money({ amount: n, currency: 'BTC', unit: 'sat' });

const baseParams = {
  userId: 'user-1',
  accountId: 'acc-1',
  amount: sat(100),
  paymentRequest: 'lnbc1...',
  paymentHash: 'ph-1',
  expiresAt: '2026-06-18T00:00:00.000Z',
  sparkId: 'spark-rr-1',
  receiverIdentityPubkey: 'deadbeef',
  totalFee: sat(0),
  receiveType: 'LIGHTNING' as const,
  userEncryptionPublicKey,
};

describe('SparkReceiveQuoteRepositoryServer', () => {
  it('encrypts to the user pubkey, calls create_spark_receive_quote, returns minimal Created data', async () => {
    const calls: { name: string; args: unknown }[] = [];
    const db = makeFakeDb({ rpcResult: { data: { id: 'row-1', spark_id: 'spark-rr-1' }, error: null }, calls });
    const repo = new SparkReceiveQuoteRepositoryServer(db);

    const created = await repo.create(baseParams);

    expect(created).toEqual({
      id: 'row-1',
      receiveType: 'LIGHTNING',
      sparkId: 'spark-rr-1',
      paymentRequest: 'lnbc1...',
      paymentHash: 'ph-1',
      expiresAt: '2026-06-18T00:00:00.000Z',
      amount: baseParams.amount,
      totalFee: baseParams.totalFee,
      description: undefined,
    });
    const rpcCall = calls.find((c) => c.name === 'rpc') as { args: [string, Record<string, unknown>] };
    expect(rpcCall.args[0]).toBe('create_spark_receive_quote');
    expect(rpcCall.args[1]).toMatchObject({
      p_user_id: 'user-1',
      p_account_id: 'acc-1',
      p_payment_hash: 'ph-1',
      p_spark_id: 'spark-rr-1',
      p_receiver_identity_pubkey: 'deadbeef',
      p_receive_type: 'LIGHTNING',
    });
    expect(typeof (rpcCall.args[1] as { p_encrypted_data: unknown }).p_encrypted_data).toBe('string');
    expect('p_purpose' in rpcCall.args[1]).toBe(false);
    expect('p_transfer_id' in rpcCall.args[1]).toBe(false);
  });

  it('routes RPC errors through classify', async () => {
    const db = makeFakeDb({ rpcResult: { data: null, error: { message: 'boom', code: 'XX000' } } });
    const repo = new SparkReceiveQuoteRepositoryServer(db);
    await expect(repo.create(baseParams)).rejects.toBeDefined();
  });
});
```

> Verify `makeFakeDb`'s `rpc(name, args)` records into `calls` as `{ name:'rpc', args:[name, args] }` (per `internal/test-support.ts` / the Task-2 precedent in Plan 09). If the recorded shape differs, adjust the assertion to match the harness — do not change the harness. Reconcile the RPC Returns column (`data.spark_id`) against `internal/db/database.types.ts` (the client repo's `toQuote` reads `data.spark_id`).

- [ ] **Step 2: Run it; expect FAIL** — `bun test src/internal/repositories/spark-receive-quote-repository.server.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `spark-receive-quote-repository.server.ts`. Port the web `spark-receive-quote-repository.server.ts` verbatim, repointing imports + swapping `new Error(...,{cause})` → `classify(error)`:

```ts
import type { Money } from '@agicash/money';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod/mini';
import { encryptToPublicKey } from '../crypto/encryption';
import { classify } from '../classify';
import { SparkLightningReceiveDbDataSchema } from '../db/spark-receive-quote-db-data';
import type { Database } from '../db/database';
import type { SparkReceiveQuote } from '../../types/spark';
import type { RepositoryCreateQuoteParams } from '../../domains/spark/spark-receive-quote-core';

/** Minimal data returned after creating a spark receive quote server-side (no decrypt). */
export type SparkReceiveQuoteCreated = {
  id: string;
  sparkId: string;
  paymentRequest: string;
  paymentHash: string;
  expiresAt: string;
  receiveType: SparkReceiveQuote['type'];
  amount: Money;
  totalFee: Money;
  description?: string;
};

type CreateQuoteParams = RepositoryCreateQuoteParams & {
  /** The receiving user's encryption public key; the stored data is ECIES-encrypted to it. */
  userEncryptionPublicKey: string;
};

type Options = { abortSignal?: AbortSignal };

/**
 * Server-side spark receive-quote repository: create-only. Encrypts the stored
 * receiveData to the RECEIVING user's public key (the server has no per-user
 * private key) and returns minimal data — it cannot decrypt existing quotes.
 */
export class SparkReceiveQuoteRepositoryServer {
  constructor(private readonly db: SupabaseClient<Database>) {}

  async create(
    params: CreateQuoteParams,
    options?: Options,
  ): Promise<SparkReceiveQuoteCreated> {
    const {
      userId,
      userEncryptionPublicKey,
      accountId,
      amount,
      paymentRequest,
      paymentHash,
      expiresAt,
      sparkId,
      receiverIdentityPubkey,
      receiveType,
      description,
      totalFee,
    } = params;

    const receiveData = SparkLightningReceiveDbDataSchema.parse({
      paymentRequest,
      amountReceived: amount,
      description,
      cashuTokenMeltData: receiveType === 'CASHU_TOKEN' ? params.meltData : undefined,
      totalFee,
    } satisfies z.input<typeof SparkLightningReceiveDbDataSchema>);

    const encryptedData = encryptToPublicKey(receiveData, userEncryptionPublicKey);

    const query = this.db.rpc('create_spark_receive_quote', {
      p_user_id: userId,
      p_account_id: accountId,
      p_currency: amount.currency,
      p_payment_hash: paymentHash,
      p_expires_at: expiresAt,
      p_spark_id: sparkId,
      p_receiver_identity_pubkey: receiverIdentityPubkey ?? null,
      p_receive_type: receiveType,
      p_encrypted_data: encryptedData,
    });
    if (options?.abortSignal) query.abortSignal(options.abortSignal);

    const { data, error } = await query;
    if (error) throw classify(error);

    return {
      id: data.id,
      receiveType,
      sparkId: data.spark_id,
      paymentRequest,
      paymentHash,
      expiresAt,
      amount,
      totalFee,
      description,
    };
  }
}
```

> `encryptToPublicKey` is **synchronous** — do not `await` it. Confirm `SparkLightningReceiveDbDataSchema`'s field set against `internal/db/spark-receive-quote-db-data.ts` (it reuses `cashu-token-melt-db-data`).

- [ ] **Step 4: Run it; expect PASS** — `bun test src/internal/repositories/spark-receive-quote-repository.server.test.ts`. Expected: 2 pass.

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/internal/repositories/spark-receive-quote-repository.server.ts src/internal/repositories/spark-receive-quote-repository.server.test.ts
git commit -m "feat(wallet-sdk): server spark receive-quote repository (encrypt-to-pubkey, create-only)"
```

---

## Task 3: `CashuReceiveQuoteRepositoryServer` + `CashuReceiveQuoteCreated`

**Files:**
- Create: `packages/wallet-sdk/src/internal/repositories/cashu-receive-quote-repository.server.ts`
- Create: `packages/wallet-sdk/src/internal/repositories/cashu-receive-quote-repository.server.test.ts`

**Interfaces:**
- Consumes: `encryptToPublicKey` (Task 1); `sha256Hex` (`../crypto/sha256`); `CashuLightningReceiveDbDataSchema` (`../db/cashu-receive-quote-db-data`); `RepositoryCreateQuoteParams` (`../../domains/cashu/cashu-receive-quote-core`); `classify`; `Database`.
- Produces: `class CashuReceiveQuoteRepositoryServer { constructor(db: SupabaseClient<Database>); create(params: RepositoryCreateQuoteParams & { userEncryptionPublicKey: string }, options?): Promise<CashuReceiveQuoteCreated> }` and `type CashuReceiveQuoteCreated`.

- [ ] **Step 1: Write the failing test** — `cashu-receive-quote-repository.server.test.ts` (mirror Task 2's harness; cashu fields).

```ts
import { describe, expect, it } from 'bun:test';
import { Money } from '@agicash/money';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { makeFakeDb } from '../test-support';
import { CashuReceiveQuoteRepositoryServer } from './cashu-receive-quote-repository.server';

const userEncryptionPublicKey = bytesToHex(
  secp256k1.getPublicKey(secp256k1.utils.randomPrivateKey(), true),
);
const sat = (n: number) => new Money({ amount: n, currency: 'BTC', unit: 'sat' });

const baseParams = {
  userId: 'user-1',
  accountId: 'acc-1',
  amount: sat(100),
  quoteId: 'mint-quote-1',
  paymentRequest: 'lnbc1...',
  paymentHash: 'ph-1',
  expiresAt: '2026-06-18T00:00:00.000Z',
  lockingDerivationPath: "m/129372'/0'/0/7",
  receiveType: 'LIGHTNING' as const,
  totalFee: sat(0),
  userEncryptionPublicKey,
};

describe('CashuReceiveQuoteRepositoryServer', () => {
  it('encrypts to the user pubkey, hashes the quoteId, calls create_cashu_receive_quote', async () => {
    const calls: { name: string; args: unknown }[] = [];
    const db = makeFakeDb({ rpcResult: { data: { id: 'row-1' }, error: null }, calls });
    const repo = new CashuReceiveQuoteRepositoryServer(db);

    const created = await repo.create(baseParams);

    expect(created).toMatchObject({
      id: 'row-1',
      quoteId: 'mint-quote-1',
      paymentRequest: 'lnbc1...',
      paymentHash: 'ph-1',
      type: 'LIGHTNING',
    });
    const rpcCall = calls.find((c) => c.name === 'rpc') as { args: [string, Record<string, unknown>] };
    expect(rpcCall.args[0]).toBe('create_cashu_receive_quote');
    expect(rpcCall.args[1]).toMatchObject({
      p_user_id: 'user-1',
      p_account_id: 'acc-1',
      p_locking_derivation_path: "m/129372'/0'/0/7",
      p_receive_type: 'LIGHTNING',
      p_payment_hash: 'ph-1',
    });
    expect(typeof (rpcCall.args[1] as { p_encrypted_data: unknown }).p_encrypted_data).toBe('string');
    expect(typeof (rpcCall.args[1] as { p_quote_id_hash: unknown }).p_quote_id_hash).toBe('string');
    expect('p_purpose' in rpcCall.args[1]).toBe(false);
  });

  it('routes RPC errors through classify', async () => {
    const db = makeFakeDb({ rpcResult: { data: null, error: { message: 'boom', code: 'XX000' } } });
    const repo = new CashuReceiveQuoteRepositoryServer(db);
    await expect(repo.create(baseParams)).rejects.toBeDefined();
  });
});
```

- [ ] **Step 2: Run it; expect FAIL** — `bun test src/internal/repositories/cashu-receive-quote-repository.server.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `cashu-receive-quote-repository.server.ts`. Port the web `cashu-receive-quote-repository.server.ts` verbatim, repointing imports + `computeSHA256` → `sha256Hex` + `new Error(...)` → `classify(error)`:

```ts
import type { Money } from '@agicash/money';
import { z } from 'zod/mini';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptToPublicKey } from '../crypto/encryption';
import { sha256Hex } from '../crypto/sha256';
import { classify } from '../classify';
import { CashuLightningReceiveDbDataSchema } from '../db/cashu-receive-quote-db-data';
import type { Database } from '../db/database';
import type { CashuReceiveQuote } from '../../types/cashu';
import type { RepositoryCreateQuoteParams } from '../../domains/cashu/cashu-receive-quote-core';

/** Minimal data returned after creating a cashu receive quote server-side (no decrypt). */
export type CashuReceiveQuoteCreated = {
  id: string;
  quoteId: string;
  paymentRequest: string;
  paymentHash: string;
  expiresAt: string;
  type: CashuReceiveQuote['type'];
  amount: Money;
  mintingFee?: Money;
  description?: string;
};

type CreateQuoteParams = RepositoryCreateQuoteParams & {
  userEncryptionPublicKey: string;
};

type Options = { abortSignal?: AbortSignal };

/**
 * Server-side cashu receive-quote repository: create-only. Encrypts the stored
 * receiveData to the receiving user's public key and returns minimal data.
 */
export class CashuReceiveQuoteRepositoryServer {
  constructor(private readonly db: SupabaseClient<Database>) {}

  async create(
    params: CreateQuoteParams,
    options?: Options,
  ): Promise<CashuReceiveQuoteCreated> {
    const {
      userId,
      accountId,
      amount,
      quoteId,
      paymentRequest,
      paymentHash,
      expiresAt,
      description,
      lockingDerivationPath,
      receiveType,
      userEncryptionPublicKey,
      mintingFee,
      totalFee,
    } = params;

    const receiveData = CashuLightningReceiveDbDataSchema.parse({
      paymentRequest,
      mintQuoteId: quoteId,
      amountReceived: amount,
      description,
      mintingFee,
      cashuTokenMeltData: receiveType === 'CASHU_TOKEN' ? params.meltData : undefined,
      totalFee,
    } satisfies z.input<typeof CashuLightningReceiveDbDataSchema>);

    const [encryptedReceiveData, quoteIdHash] = await Promise.all([
      Promise.resolve(encryptToPublicKey(receiveData, userEncryptionPublicKey)),
      sha256Hex(quoteId),
    ]);

    const query = this.db.rpc('create_cashu_receive_quote', {
      p_user_id: userId,
      p_account_id: accountId,
      p_currency: amount.currency,
      p_expires_at: expiresAt,
      p_locking_derivation_path: lockingDerivationPath,
      p_receive_type: receiveType,
      p_encrypted_data: encryptedReceiveData,
      p_quote_id_hash: quoteIdHash,
      p_payment_hash: paymentHash,
    });
    if (options?.abortSignal) query.abortSignal(options.abortSignal);

    const { data, error } = await query;
    if (error) throw classify(error);

    return {
      id: data.id,
      quoteId,
      paymentRequest,
      paymentHash,
      expiresAt,
      type: receiveType,
      amount,
      mintingFee,
      description,
    };
  }
}
```

> `encryptToPublicKey` is sync; `Promise.resolve(...)` keeps the `Promise.all` shape (or just call it before the `await sha256Hex` — either is fine). Confirm `CashuLightningReceiveDbDataSchema`'s field set against `internal/db/cashu-receive-quote-db-data.ts`.

- [ ] **Step 4: Run it; expect PASS** — `bun test src/internal/repositories/cashu-receive-quote-repository.server.test.ts`. Expected: 2 pass.

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/internal/repositories/cashu-receive-quote-repository.server.ts src/internal/repositories/cashu-receive-quote-repository.server.test.ts
git commit -m "feat(wallet-sdk): server cashu receive-quote repository (encrypt-to-pubkey, create-only)"
```

---

## Task 4: `SparkReceiveQuoteServiceServer`

**Files:**
- Create: `packages/wallet-sdk/src/domains/spark/spark-receive-quote-service.server.ts`
- Create: `packages/wallet-sdk/src/domains/spark/spark-receive-quote-service.server.test.ts`

**Interfaces:**
- Consumes: the spark core (`getLightningQuote`, `computeQuoteExpiry`, `getAmountAndFee`, `CreateQuoteBaseParams`, `GetLightningQuoteParams`, `SparkReceiveLightningQuote`); `SparkReceiveQuoteRepositoryServer` + `SparkReceiveQuoteCreated` (Task 2).
- Produces: `class SparkReceiveQuoteServiceServer { constructor(repository: SparkReceiveQuoteRepositoryServer); getLightningQuote(params: GetLightningQuoteParams): Promise<SparkReceiveLightningQuote>; createReceiveQuote(params: CreateQuoteBaseParams & { userEncryptionPublicKey: string }): Promise<SparkReceiveQuoteCreated> }`.

- [ ] **Step 1: Write the failing test** — `spark-receive-quote-service.server.test.ts`. Inject a fake repo; a fake `BreezSdk` (`receivePayment`) for `getLightningQuote`; a known-decodable bolt11 fixture (reuse one from `internal/lib/bolt11/index.test.ts`).

```ts
import { describe, expect, it, mock } from 'bun:test';
import { Money } from '@agicash/money';
import type { SparkReceiveQuoteRepositoryServer } from '../../internal/repositories/spark-receive-quote-repository.server';
import { SparkReceiveQuoteServiceServer } from './spark-receive-quote-service.server';

// A real, decodable bolt11 invoice (copy one from internal/lib/bolt11/index.test.ts).
const INVOICE = 'lnbc...';

describe('SparkReceiveQuoteServiceServer', () => {
  it('getLightningQuote passes receiverIdentityPubkey + descriptionHash to the wallet', async () => {
    const captured: { method?: { receiverIdentityPubkey?: string; descriptionHash?: string } } = {};
    const wallet = {
      receivePayment: async ({ paymentMethod }: { paymentMethod: unknown }) => {
        captured.method = paymentMethod as never;
        return {
          paymentRequest: INVOICE,
          lightningReceiveDetails: { receiveRequestId: 'rr-1', status: 'invoiceCreated', createdAt: 1_700_000_000, updatedAt: 1_700_000_000 },
        };
      },
    } as never;
    const svc = new SparkReceiveQuoteServiceServer({} as SparkReceiveQuoteRepositoryServer);

    const quote = await svc.getLightningQuote({
      wallet,
      amount: new Money({ amount: 100, currency: 'BTC', unit: 'sat' }),
      receiverIdentityPubkey: 'deadbeef',
      descriptionHash: 'abc123',
    });

    expect(captured.method?.receiverIdentityPubkey).toBe('deadbeef');
    expect(captured.method?.descriptionHash).toBe('abc123');
    expect(quote.receiverIdentityPublicKey).toBe('deadbeef');
  });

  it('createReceiveQuote (LIGHTNING) builds repo params from the lightning quote', async () => {
    const create = mock(async () => ({ id: 'row-1' }) as never);
    const repo = { create } as unknown as SparkReceiveQuoteRepositoryServer;
    const svc = new SparkReceiveQuoteServiceServer(repo);

    const lightningQuote = {
      id: 'rr-1',
      createdAt: '2026-06-18T00:00:00.000Z',
      updatedAt: '2026-06-18T00:00:00.000Z',
      invoice: { paymentRequest: INVOICE, paymentHash: 'ph-1', amount: new Money({ amount: 100, currency: 'BTC', unit: 'sat' }), createdAt: '2026-06-18T00:00:00.000Z', expiresAt: '2026-06-18T01:00:00.000Z', memo: 'hi' },
      status: 'invoiceCreated',
      receiverIdentityPublicKey: 'deadbeef',
    } as never;

    await svc.createReceiveQuote({
      userId: 'user-1',
      account: { id: 'acc-1', currency: 'BTC' } as never,
      lightningQuote,
      receiveType: 'LIGHTNING',
      userEncryptionPublicKey: 'pub-1',
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({
      userId: 'user-1',
      accountId: 'acc-1',
      paymentRequest: INVOICE,
      paymentHash: 'ph-1',
      sparkId: 'rr-1',
      receiverIdentityPubkey: 'deadbeef',
      receiveType: 'LIGHTNING',
      userEncryptionPublicKey: 'pub-1',
    });
  });
});
```

> Reuse a real INVOICE fixture so `getLightningQuote`'s internal `parseBolt11Invoice` succeeds. The fake `account` only needs `{ id, currency }` for `createReceiveQuote`.

- [ ] **Step 2: Run it; expect FAIL** — `bun test src/domains/spark/spark-receive-quote-service.server.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `spark-receive-quote-service.server.ts`. Port the web `spark-receive-quote-service.server.ts` verbatim (repoint imports to the SDK core + Task-2 repo):

```ts
import {
  type CreateQuoteBaseParams,
  type GetLightningQuoteParams,
  type SparkReceiveLightningQuote,
  computeQuoteExpiry,
  getAmountAndFee,
  getLightningQuote,
} from './spark-receive-quote-core';
import type {
  SparkReceiveQuoteCreated,
  SparkReceiveQuoteRepositoryServer,
} from '../../internal/repositories/spark-receive-quote-repository.server';

type CreateQuoteParams = CreateQuoteBaseParams & {
  userEncryptionPublicKey: string;
};

/** Server-side spark receive-quote service: get a lightning quote + create (no read/decrypt). */
export class SparkReceiveQuoteServiceServer {
  constructor(private readonly repository: SparkReceiveQuoteRepositoryServer) {}

  getLightningQuote(params: GetLightningQuoteParams): Promise<SparkReceiveLightningQuote> {
    return getLightningQuote(params);
  }

  async createReceiveQuote(params: CreateQuoteParams): Promise<SparkReceiveQuoteCreated> {
    const { userEncryptionPublicKey, userId, account, lightningQuote } = params;
    const expiresAt = computeQuoteExpiry(params);
    const { amount, totalFee } = getAmountAndFee(params);

    const baseParams = {
      userId,
      accountId: account.id,
      amount,
      paymentRequest: lightningQuote.invoice.paymentRequest,
      paymentHash: lightningQuote.invoice.paymentHash,
      description: lightningQuote.invoice.memo,
      expiresAt,
      sparkId: lightningQuote.id,
      receiverIdentityPubkey: lightningQuote.receiverIdentityPublicKey,
      totalFee,
    };

    if (params.receiveType === 'CASHU_TOKEN') {
      return this.repository.create({
        ...baseParams,
        userEncryptionPublicKey,
        receiveType: 'CASHU_TOKEN',
        meltData: {
          tokenMintUrl: params.sourceMintUrl,
          tokenAmount: params.tokenAmount,
          tokenProofs: params.tokenProofs,
          meltQuoteId: params.meltQuoteId,
          cashuReceiveFee: params.cashuReceiveFee,
          lightningFeeReserve: params.lightningFeeReserve,
        },
      });
    }

    return this.repository.create({
      ...baseParams,
      userEncryptionPublicKey,
      receiveType: 'LIGHTNING',
    });
  }
}
```

- [ ] **Step 4: Run it; expect PASS** — `bun test src/domains/spark/spark-receive-quote-service.server.test.ts`. Expected: 2 pass.

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/domains/spark/spark-receive-quote-service.server.ts src/domains/spark/spark-receive-quote-service.server.test.ts
git commit -m "feat(wallet-sdk): server spark receive-quote service (getLightningQuote + create)"
```

---

## Task 5: `CashuReceiveQuoteServiceServer`

**Files:**
- Create: `packages/wallet-sdk/src/domains/cashu/cashu-receive-quote-service.server.ts`
- Create: `packages/wallet-sdk/src/domains/cashu/cashu-receive-quote-service.server.test.ts`

**Interfaces:**
- Consumes: the cashu core (`computeQuoteExpiry`, `computeTotalFee`, `CreateQuoteBaseParams`); `CashuReceiveQuoteRepositoryServer` + `CashuReceiveQuoteCreated` (Task 3); `MintQuoteState` from `@cashu/cashu-ts`; `DomainError`.
- Produces: `class CashuReceiveQuoteServiceServer { constructor(repository: CashuReceiveQuoteRepositoryServer); createReceiveQuote(params: CreateQuoteBaseParams & { userEncryptionPublicKey: string }): Promise<CashuReceiveQuoteCreated> }`. (No `getLightningQuote` method — the cashu core `getLightningQuote` is called by `ServerSdk` directly with the resolved `xPub`.)

- [ ] **Step 1: Write the failing test** — `cashu-receive-quote-service.server.test.ts`.

```ts
import { describe, expect, it, mock } from 'bun:test';
import { Money } from '@agicash/money';
import { MintQuoteState } from '@cashu/cashu-ts';
import { DomainError } from '../../errors';
import type { CashuReceiveQuoteRepositoryServer } from '../../internal/repositories/cashu-receive-quote-repository.server';
import { CashuReceiveQuoteServiceServer } from './cashu-receive-quote-service.server';

const lightningQuote = (state: MintQuoteState) => ({
  mintQuote: { quote: 'mint-quote-1', request: 'lnbc1...', state, expiry: 0 },
  lockingPublicKey: '02abc',
  fullLockingDerivationPath: "m/129372'/0'/0/7",
  expiresAt: '2026-06-18T01:00:00.000Z',
  amount: new Money({ amount: 100, currency: 'BTC', unit: 'sat' }),
  description: 'hi',
  paymentHash: 'ph-1',
}) as never;

describe('CashuReceiveQuoteServiceServer', () => {
  it('creates a LIGHTNING quote when the mint quote is UNPAID', async () => {
    const create = mock(async () => ({ id: 'row-1' }) as never);
    const svc = new CashuReceiveQuoteServiceServer({ create } as unknown as CashuReceiveQuoteRepositoryServer);

    await svc.createReceiveQuote({
      userId: 'user-1',
      account: { id: 'acc-1', mintUrl: 'https://mint.test' } as never,
      lightningQuote: lightningQuote(MintQuoteState.UNPAID),
      receiveType: 'LIGHTNING',
      userEncryptionPublicKey: 'pub-1',
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({
      userId: 'user-1',
      accountId: 'acc-1',
      quoteId: 'mint-quote-1',
      paymentRequest: 'lnbc1...',
      paymentHash: 'ph-1',
      lockingDerivationPath: "m/129372'/0'/0/7",
      receiveType: 'LIGHTNING',
      userEncryptionPublicKey: 'pub-1',
    });
  });

  it('rejects when the mint quote is not UNPAID', async () => {
    const svc = new CashuReceiveQuoteServiceServer({ create: mock() } as unknown as CashuReceiveQuoteRepositoryServer);
    await expect(
      svc.createReceiveQuote({
        userId: 'user-1',
        account: { id: 'acc-1' } as never,
        lightningQuote: lightningQuote(MintQuoteState.PAID),
        receiveType: 'LIGHTNING',
        userEncryptionPublicKey: 'pub-1',
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
```

- [ ] **Step 2: Run it; expect FAIL** — `bun test src/domains/cashu/cashu-receive-quote-service.server.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `cashu-receive-quote-service.server.ts`. Port the web `cashu-receive-quote-service.server.ts` verbatim; `new Error('Mint quote must be unpaid')` → `new DomainError('Mint quote must be unpaid', 'invalid_state')`:

```ts
import { MintQuoteState } from '@cashu/cashu-ts';
import {
  type CreateQuoteBaseParams,
  computeQuoteExpiry,
  computeTotalFee,
} from './cashu-receive-quote-core';
import { DomainError } from '../../errors';
import type {
  CashuReceiveQuoteCreated,
  CashuReceiveQuoteRepositoryServer,
} from '../../internal/repositories/cashu-receive-quote-repository.server';

type CreateQuoteParams = CreateQuoteBaseParams & {
  userEncryptionPublicKey: string;
};

/** Server-side cashu receive-quote service: create-only (no read/decrypt). */
export class CashuReceiveQuoteServiceServer {
  constructor(
    private readonly cashuReceiveQuoteRepository: CashuReceiveQuoteRepositoryServer,
  ) {}

  async createReceiveQuote(params: CreateQuoteParams): Promise<CashuReceiveQuoteCreated> {
    const { userId, account, lightningQuote, receiveType, userEncryptionPublicKey } = params;

    if (lightningQuote.mintQuote.state !== MintQuoteState.UNPAID) {
      throw new DomainError('Mint quote must be unpaid', 'invalid_state');
    }

    const expiresAt = computeQuoteExpiry(params);
    const totalFee = computeTotalFee(params);

    const baseParams = {
      accountId: account.id,
      userId,
      amount: lightningQuote.amount,
      description: lightningQuote.description,
      quoteId: lightningQuote.mintQuote.quote,
      expiresAt,
      paymentRequest: lightningQuote.mintQuote.request,
      paymentHash: lightningQuote.paymentHash,
      lockingDerivationPath: lightningQuote.fullLockingDerivationPath,
      mintingFee: lightningQuote.mintingFee,
      totalFee,
      receiveType,
      userEncryptionPublicKey,
    };

    if (receiveType === 'CASHU_TOKEN') {
      return this.cashuReceiveQuoteRepository.create({
        ...baseParams,
        receiveType,
        meltData: {
          tokenMintUrl: params.sourceMintUrl,
          tokenAmount: params.tokenAmount,
          tokenProofs: params.tokenProofs,
          meltQuoteId: params.meltQuoteId,
          cashuReceiveFee: params.cashuReceiveFee,
          lightningFeeReserve: params.lightningFeeReserve,
        },
      });
    }

    return this.cashuReceiveQuoteRepository.create({ ...baseParams, receiveType });
  }
}
```

- [ ] **Step 4: Run it; expect PASS** — `bun test src/domains/cashu/cashu-receive-quote-service.server.test.ts`. Expected: 2 pass.

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/domains/cashu/cashu-receive-quote-service.server.ts src/domains/cashu/cashu-receive-quote-service.server.test.ts
git commit -m "feat(wallet-sdk): server cashu receive-quote service (create-only, UNPAID guard)"
```

---

## Task 6: `ServerAccountRepository.getDefaultAccount`

**Files:**
- Create: `packages/wallet-sdk/src/internal/repositories/server-account-repository.ts`
- Create: `packages/wallet-sdk/src/internal/repositories/server-account-repository.test.ts`

**Interfaces:**
- Consumes: `CashuWalletService`, `SparkWalletService`; `CashuAccountDetailsDbDataSchema`/`SparkAccountDetailsDbDataSchema`/`isCashuAccount`/`isSparkAccount` (`../db/account-details`); `classify`; `NotFoundError`/`SdkError`; `Database`/`AgicashDbAccountWithProofs`.
- Produces: `class ServerAccountRepository { constructor(db: SupabaseClient<Database>, cashuWallets: CashuWalletService, sparkWallets: SparkWalletService); getDefaultAccount(userId: string, currency?: Currency): Promise<RedactedAccount> }`. Builds the receiving account WITHOUT decrypting proofs (cashu wallet seedless; spark wallet from the server `SparkWalletService`).

- [ ] **Step 1: Write the failing test** — `server-account-repository.test.ts`. `makeFakeDb` returns a joined user+accounts row via `.single()`; fake wallet services.

```ts
import { describe, expect, it } from 'bun:test';
import { makeFakeDb } from '../test-support';
import { ServerAccountRepository } from './server-account-repository';

const cashuWallets = { getInitialized: async () => ({ wallet: { id: 'cashu-wallet' }, isOnline: true }) } as never;
const sparkWallets = { getInitialized: async () => ({ wallet: { id: 'spark-wallet' }, balance: null, isOnline: true }) } as never;

const userRow = (overrides: Record<string, unknown> = {}) => ({
  default_btc_account_id: 'acc-btc',
  default_usd_account_id: 'acc-usd',
  default_currency: 'BTC',
  accounts: [
    { id: 'acc-btc', name: 'Bitcoin', type: 'cashu', currency: 'BTC', purpose: 'transactional', state: 'active', created_at: '2026-01-01T00:00:00.000Z', version: 1, expires_at: null, details: { mint_url: 'https://mint.test', is_test_mint: false, keyset_counters: {} } },
  ],
  ...overrides,
});

describe('ServerAccountRepository.getDefaultAccount', () => {
  it('returns a redacted cashu account (no proofs) built with a seedless wallet', async () => {
    const db = makeFakeDb({ selectResult: { data: userRow(), error: null } });
    const repo = new ServerAccountRepository(db, cashuWallets, sparkWallets);
    const account = await repo.getDefaultAccount('user-1', 'BTC');
    expect(account).toMatchObject({ id: 'acc-btc', type: 'cashu', mintUrl: 'https://mint.test', isOnline: true });
    expect('proofs' in account).toBe(false);
  });

  it('throws NotFoundError when no default account exists for the currency', async () => {
    const db = makeFakeDb({ selectResult: { data: userRow({ default_btc_account_id: null, accounts: [] }), error: null } });
    const repo = new ServerAccountRepository(db, cashuWallets, sparkWallets);
    await expect(repo.getDefaultAccount('user-1', 'BTC')).rejects.toMatchObject({ code: 'account_not_found' });
  });
});
```

> Confirm `makeFakeDb`'s `.single()` returns `selectResult.data`. The `.eq('accounts.cashu_proofs.state','UNSPENT')` filter is a no-op against the fake (it returns canned data); the test asserts behaviour, not the join. If the builder lacks chained `.eq` after a nested select, simplify the implementation's query to a plain `.select('*, accounts:accounts!user_id(*, cashu_proofs(*))').eq('id', userId).single()` and drop the proof-state `.eq` (the server never reads proofs anyway) — match the harness, then note the divergence from the web in a comment only if it changes behaviour.

- [ ] **Step 2: Run it; expect FAIL** — `bun test src/internal/repositories/server-account-repository.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `server-account-repository.ts`. Mirror the web `ReadUserDefaultAccountRepository.getDefaultAccount` + `toAccount`, minus proof decryption (uses the SDK wallet services; cashu seedless):

```ts
import type { Currency } from '@agicash/money';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NotFoundError, SdkError } from '../../errors';
import type { RedactedAccount } from '../../types/account';
import { classify } from '../classify';
import type { CashuWalletService } from '../connections/cashu-wallet';
import type { SparkWalletService } from '../connections/spark-wallet';
import {
  CashuAccountDetailsDbDataSchema,
  SparkAccountDetailsDbDataSchema,
  isCashuAccount,
  isSparkAccount,
} from '../db/account-details';
import type { AgicashDbAccountWithProofs, Database } from '../db/database';

type Options = { abortSignal?: AbortSignal };

/**
 * Server-side account resolution for the LN-address flow. Reads the user's
 * default receiving account WITHOUT decrypting cashu proofs (the server has no
 * per-user key): cashu wallets are built seedless (sufficient for createLockedMintQuote),
 * spark wallets come from the dedicated server SparkWalletService.
 */
export class ServerAccountRepository {
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly cashuWallets: CashuWalletService,
    private readonly sparkWallets: SparkWalletService,
  ) {}

  /** The user's default account for `currency` (defaults to the user's `default_currency`). */
  async getDefaultAccount(
    userId: string,
    currency?: Currency,
    options?: Options,
  ): Promise<RedactedAccount> {
    const query = this.db
      .from('users')
      .select('*, accounts:accounts!user_id(*, cashu_proofs(*))')
      .eq('id', userId)
      .eq('accounts.cashu_proofs.state', 'UNSPENT');
    if (options?.abortSignal) query.abortSignal(options.abortSignal);
    const { data, error } = await query.single();
    if (error) throw classify(error);

    const accountCurrency = currency ?? data.default_currency;
    const defaultAccountId =
      accountCurrency === 'BTC' ? data.default_btc_account_id : data.default_usd_account_id;
    const account = data.accounts.find(
      (a: AgicashDbAccountWithProofs) => a.id === defaultAccountId,
    );
    if (!account) {
      throw new NotFoundError(
        `No default ${accountCurrency} account for user`,
        'account_not_found',
      );
    }
    return this.toRedactedAccount(account);
  }

  private async toRedactedAccount(
    data: AgicashDbAccountWithProofs,
  ): Promise<RedactedAccount> {
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
      const { wallet, isOnline } = await this.cashuWallets.getInitialized(
        details.mint_url,
        data.currency,
        undefined, // seedless: createLockedMintQuote needs no bip39 seed
        undefined, // no mint-auth provider server-side
      );
      return {
        ...common,
        isOnline,
        type: 'cashu',
        mintUrl: details.mint_url,
        isTestMint: details.is_test_mint,
        keysetCounters: details.keyset_counters,
        wallet,
      };
    }

    if (isSparkAccount(data)) {
      const { network } = SparkAccountDetailsDbDataSchema.parse(data.details);
      const { wallet, balance, isOnline } = await this.sparkWallets.getInitialized(network);
      return { ...common, type: 'spark', balance, network, isOnline, wallet };
    }

    throw new SdkError('Invalid account type', 'invalid_account_type');
  }
}
```

> Verify `RedactedAccount` accepts the returned object shapes (it is `Account` minus `proofs`). If TS rejects the cashu branch because `keysetCounters`/`mintUrl` need exact typing, mirror `AccountRepository.toAccount`'s `as Account`-style assembly (it uses no cast for these — the discriminated return should type-check). Confirm `data.accounts` is typed as an array on the joined select; if the generated types make it `unknown`, add a minimal local type for the nested `accounts` rather than `any`.

- [ ] **Step 4: Run it; expect PASS** — `bun test src/internal/repositories/server-account-repository.test.ts`. Expected: 2 pass.

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/internal/repositories/server-account-repository.ts src/internal/repositories/server-account-repository.test.ts
git commit -m "feat(wallet-sdk): server account resolver (default receive account, no proof decrypt)"
```

---

## Task 7: `serverSparkMnemonic` config + `buildServerConnections` (+ extract shared cashu-wallet builder)

**Files:**
- Modify: `packages/wallet-sdk/src/config.ts`
- Modify: `packages/wallet-sdk/src/internal/connections/index.ts` (extract `buildCashuWalletService`)
- Create: `packages/wallet-sdk/src/internal/connections/server-connections.ts`
- Create: `packages/wallet-sdk/src/internal/connections/server-connections.test.ts`

**Interfaces:**
- Produces: `SdkConfig.serverSparkMnemonic?: string`; `export function buildCashuWalletService(): CashuWalletService` (in `connections/index.ts`); `type ServerConnections = { supabase: SupabaseClient<Database>; sparkWallets: SparkWalletService; cashuWallets: CashuWalletService }` + `export function buildServerConnections(config: SdkConfig): ServerConnections` (in `server-connections.ts`).

- [ ] **Step 1: Add the config field** — in `config.ts`, add to `SdkConfig` (top-level, optional; document server-only + runtime-required by `createServer`):

```ts
  /**
   * BIP39 mnemonic for the dedicated SERVER Spark wallet used to mint
   * Lightning-Address invoices on behalf of users. Server-mode only —
   * `createServer` throws if it is missing; omit in the browser.
   */
  serverSparkMnemonic?: string;
```

- [ ] **Step 2: Write the failing test** — `server-connections.test.ts`. Building the bundle does no network (Breez connect is lazy), so assert (a) it returns `{ supabase, sparkWallets, cashuWallets }`, (b) it throws without `serverSparkMnemonic`, (c) it throws without `serviceRoleKey` (delegated to `createServerClient`).

```ts
import { describe, expect, it } from 'bun:test';
import type { SdkConfig } from '../../config';
import { inMemoryStorage } from '../test-support';
import { buildServerConnections } from './server-connections';

const baseConfig = (): SdkConfig => ({
  openSecret: { url: 'https://os.test', clientId: 'cid' },
  supabase: { url: 'https://sb.test', anonKey: 'anon', serviceRoleKey: 'service-role' },
  breezApiKey: 'breez-key',
  sparkStorageDir: '/tmp/.spark-data',
  storage: inMemoryStorage(),
  lud16Domain: 'agi.cash',
  serverSparkMnemonic: 'abandon abandon abandon … art',
});

describe('buildServerConnections', () => {
  it('assembles the server bundle (service-role supabase + server spark + cashu wallets)', () => {
    const conns = buildServerConnections(baseConfig());
    expect(conns.supabase).toBeDefined();
    expect(conns.sparkWallets).toBeDefined();
    expect(conns.cashuWallets).toBeDefined();
  });

  it('throws when serverSparkMnemonic is missing', () => {
    const { serverSparkMnemonic, ...config } = baseConfig();
    expect(() => buildServerConnections(config as SdkConfig)).toThrow(/serverSparkMnemonic/);
  });

  it('throws when serviceRoleKey is missing (createServerClient guard)', () => {
    const config = baseConfig();
    config.supabase = { url: config.supabase.url, anonKey: config.supabase.anonKey };
    expect(() => buildServerConnections(config)).toThrow(/serviceRoleKey/);
  });
});
```

> Confirm `inMemoryStorage` is exported from `internal/test-support.ts` (it is — used in S3 tests). If `buildServerConnections` calls `createServerClient` first, the missing-serviceRoleKey throw comes from there; order the `serverSparkMnemonic` guard BEFORE or AFTER consistently and match the test (the test allows either order since each case omits only one field).

- [ ] **Step 3a: Extract the shared cashu-wallet builder** — in `connections/index.ts`, factor the cashu `CashuWalletService` closure (currently inline in `buildConnections`) into an exported helper, and have `buildConnections` call it (behaviour-neutral):

```ts
export function buildCashuWalletService(): CashuWalletService {
  return new CashuWalletService(async (mintUrl) => {
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
}
```

Then in `buildConnections`, replace the inline `const cashuWallets = new CashuWalletService(async (mintUrl) => {…})` with `const cashuWallets = buildCashuWalletService();`. Keep the `Mint`/`ExtendedMintInfo`/`MintMetadata` imports.

- [ ] **Step 3b: Implement `buildServerConnections`** — `server-connections.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SdkConfig } from '../../config';
import type { Database } from '../db/database';
import { connectBreez } from './breez';
import { buildCashuWalletService } from './index';
import { CashuWalletService } from './cashu-wallet';
import { SparkWalletService } from './spark-wallet';
import { createServerClient } from './supabase-client';

/** The narrow server-mode connection bundle (no OpenSecret, no per-user keys, no realtime). */
export type ServerConnections = {
  supabase: SupabaseClient<Database>;
  sparkWallets: SparkWalletService;
  cashuWallets: CashuWalletService;
};

/**
 * Assembles the server-mode connections: a service-role Supabase client, a
 * dedicated server Spark wallet (own mnemonic + storageDir), and seedless cashu
 * mint clients. Throws if `serviceRoleKey` or `serverSparkMnemonic` is missing.
 */
export function buildServerConnections(config: SdkConfig): ServerConnections {
  const supabase = createServerClient(config); // throws if serviceRoleKey missing
  const serverSparkMnemonic = config.serverSparkMnemonic;
  if (!serverSparkMnemonic) {
    throw new Error('createServer requires config.serverSparkMnemonic');
  }

  const sparkWallets = new SparkWalletService((network) =>
    connectBreez(
      {
        apiKey: config.breezApiKey ?? '',
        network: network.toLowerCase() as 'mainnet' | 'regtest',
        storageDir: config.sparkStorageDir ?? '/tmp/.spark-data',
        debugLogging: config.debugLoggingSpark ?? false,
      },
      serverSparkMnemonic,
    ),
  );

  const cashuWallets = buildCashuWalletService();

  return { supabase, sparkWallets, cashuWallets };
}
```

> Mirror the USER spark closure in `buildConnections` exactly, swapping the OpenSecret-derived mnemonic for `config.serverSparkMnemonic` and defaulting `storageDir` to `/tmp/.spark-data` (the documented server dir). Keep the server `storageDir` distinct from the user wallet's to avoid Breez storage collision (it is, by the default). Confirm the `SparkNetwork` `.toLowerCase()` cast matches `buildConnections`.

- [ ] **Step 4: Run it; expect PASS** — `bun test src/internal/connections/server-connections.test.ts`. Expected: 3 pass. (Also re-run `bun test src/internal/connections/` to confirm the `buildConnections` extraction is behaviour-neutral.)

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/config.ts src/internal/connections/index.ts src/internal/connections/server-connections.ts src/internal/connections/server-connections.test.ts
git commit -m "feat(wallet-sdk): serverSparkMnemonic config + buildServerConnections (service-role + server spark + cashu)"
```

---

## Task 8: `ServerSdk` + `createServer` — wire the three operations

**Files:**
- Create: `packages/wallet-sdk/src/server-sdk.ts`
- Create: `packages/wallet-sdk/src/server-sdk.test.ts`

**Interfaces:**
- Consumes: `buildServerConnections`/`ServerConnections` (Task 7); `UserRepository` (`.get`/`.getByUsername`); `ServerAccountRepository` (Task 6); `CashuReceiveQuoteServiceServer`/`SparkReceiveQuoteServiceServer` (Tasks 4/5); `CashuReceiveQuoteRepositoryServer`/`SparkReceiveQuoteRepositoryServer` (Tasks 2/3); the cashu core `getLightningQuote`; `createExchangeRateDomain`; `getCashuWallet` (`internal/lib/cashu`); `sha256Hex`; `DomainError`/`NotFoundError`.
- Produces: `class ServerSdk implements ServerSdkApi` + `export function createServer(config: SdkConfig): ServerSdk`, plus the public types `LnurlVerifyRef`, `LightningAddressReceiveInfo`, `LightningReceiveQuoteResult`, `LightningReceiveStatusResult`. The `ServerSdk` ctor takes a `ServerSdkDeps` bundle (so tests inject fakes); `createServer` assembles the real deps.

- [ ] **Step 1: Write the failing test** — `server-sdk.test.ts`. Construct `new ServerSdk(fakeDeps)` and drive the three methods with fakes (a fake user repo, a fake `getDefaultAccount` returning an account whose `wallet` is a fake, fake server services, a fake exchangeRate, fake verify-wallet resolvers).

```ts
import { describe, expect, it, mock } from 'bun:test';
import { Money } from '@agicash/money';
import { ServerSdk } from './server-sdk';

const sat = (n: number) => new Money({ amount: n, currency: 'BTC', unit: 'sat' });

function makeDeps(overrides: Record<string, unknown> = {}) {
  const user = {
    id: 'user-1', username: 'alice', cashuLockingXpub: 'xpub...', encryptionPublicKey: 'enc-pub',
    sparkIdentityPublicKey: 'spark-pub', defaultCurrency: 'BTC',
  };
  return {
    lud16Domain: 'agi.cash',
    userRepository: { get: mock(async () => user), getByUsername: mock(async () => user) },
    serverAccountRepository: { getDefaultAccount: mock(async () => ({
      id: 'acc-1', type: 'cashu', currency: 'BTC', mintUrl: 'https://mint.test',
      wallet: { createLockedMintQuote: async () => ({ quote: 'mq-1', request: 'lnbc1...', state: 'UNPAID', expiry: 0 }) },
    })) },
    cashuReceiveQuoteService: { createReceiveQuote: mock(async () => ({ id: 'row-1', quoteId: 'mq-1' })) },
    sparkReceiveQuoteService: {
      getLightningQuote: mock(async () => ({ id: 'rr-1', invoice: { paymentRequest: 'lnbc-spark' } })),
      createReceiveQuote: mock(async () => ({ id: 'row-2' })),
    },
    exchangeRate: { convert: mock(async ({ amount }: { amount: Money }) => amount) },
    getCashuMintWallet: mock(() => ({ checkMintQuoteBolt11: async () => ({ state: 'PAID', request: 'lnbc1...' }) })),
    getServerSparkWallet: mock(async () => ({ getLightningReceiveRequest: async () => ({ status: 'transferCompleted', invoice: 'lnbc-spark', paymentPreimage: 'pre' }) })),
    ...overrides,
  } as never;
}

describe('ServerSdk', () => {
  it('resolveLightningAddress returns the receiving capability (fixed min/max + metadata)', async () => {
    const sdk = new ServerSdk(makeDeps());
    const info = await sdk.resolveLightningAddress('alice');
    expect(info).toMatchObject({ userId: 'user-1', username: 'alice' });
    expect(info?.minSendable.toNumber('sat')).toBe(1);
    expect(info?.maxSendable.toNumber('sat')).toBe(1_000_000);
    expect(info?.metadata).toContain('alice@agi.cash');
  });

  it('resolveLightningAddress returns null for an unknown username', async () => {
    const deps = makeDeps({ userRepository: { get: mock(), getByUsername: mock(async () => null) } });
    expect(await new ServerSdk(deps).resolveLightningAddress('nobody')).toBeNull();
  });

  it('createLightningReceiveQuote (cashu) mints a locked quote and returns a cashu verify ref', async () => {
    const sdk = new ServerSdk(makeDeps());
    const result = await sdk.createLightningReceiveQuote({ userId: 'user-1', amount: sat(100) });
    expect(result.paymentRequest).toBe('lnbc1...');
    expect(result.verify).toEqual({ type: 'cashu', quoteId: 'mq-1', mintUrl: 'https://mint.test' });
  });

  it('createLightningReceiveQuote rejects an out-of-range amount', async () => {
    const sdk = new ServerSdk(makeDeps());
    await expect(sdk.createLightningReceiveQuote({ userId: 'user-1', amount: sat(0) })).rejects.toMatchObject({ code: 'amount_out_of_range' });
    await expect(sdk.createLightningReceiveQuote({ userId: 'user-1', amount: sat(2_000_000) })).rejects.toMatchObject({ code: 'amount_out_of_range' });
  });

  it('getLightningReceiveStatus (cashu) reports settled for PAID', async () => {
    const sdk = new ServerSdk(makeDeps());
    const status = await sdk.getLightningReceiveStatus({ type: 'cashu', quoteId: 'mq-1', mintUrl: 'https://mint.test' });
    expect(status).toEqual({ settled: true, preimage: '', paymentRequest: 'lnbc1...' });
  });

  it('getLightningReceiveStatus (spark) reports settled for transferCompleted', async () => {
    const sdk = new ServerSdk(makeDeps());
    const status = await sdk.getLightningReceiveStatus({ type: 'spark', quoteId: 'rr-1' });
    expect(status).toEqual({ settled: true, preimage: 'pre', paymentRequest: 'lnbc-spark' });
  });
});
```

> The spark create path test is covered by Task 4's service test; this test exercises the cashu create + both verify branches + range/resolve behaviour. Adapt the fake `account.wallet`/`getCashuMintWallet` shapes to what `ServerSdk` actually calls (see Step 3). Keep fakes minimal.

- [ ] **Step 2: Run it; expect FAIL** — `bun test src/server-sdk.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `server-sdk.ts`. Define the public types + the `ServerSdk` class (DI'd deps ctor) + `createServer` assembler:

```ts
import { Money } from '@agicash/money';
import type { BreezSdk } from '@agicash/breez-sdk-spark';
import type { SdkConfig } from './config';
import { DomainError, NotFoundError } from './errors';
import type { ExchangeRateDomain } from './domains';
import { createExchangeRateDomain } from './domains/exchange-rate/exchange-rate-domain';
import { getLightningQuote as getCashuLightningQuote } from './domains/cashu/cashu-receive-quote-core';
import { CashuReceiveQuoteServiceServer } from './domains/cashu/cashu-receive-quote-service.server';
import { SparkReceiveQuoteServiceServer } from './domains/spark/spark-receive-quote-service.server';
import { CashuReceiveQuoteRepositoryServer } from './internal/repositories/cashu-receive-quote-repository.server';
import { SparkReceiveQuoteRepositoryServer } from './internal/repositories/spark-receive-quote-repository.server';
import { ServerAccountRepository } from './internal/repositories/server-account-repository';
import { UserRepository } from './internal/repositories/user-repository';
import { buildServerConnections } from './internal/connections/server-connections';
import { type ExtendedCashuWallet, getCashuWallet } from './internal/lib/cashu';
import { sha256Hex } from './internal/crypto/sha256';
import type { RedactedAccount, RedactedCashuAccount, SparkAccount } from './types/account';

/** An opaque-to-the-LNURL-client reference to a created receive quote (the route encrypts it into the verify URL). */
export type LnurlVerifyRef =
  | { type: 'cashu'; quoteId: string; mintUrl: string }
  | { type: 'spark'; quoteId: string };

export type LightningAddressReceiveInfo = {
  userId: string;
  username: string;
  minSendable: Money<'BTC'>;
  maxSendable: Money<'BTC'>;
  /** LUD-06 metadata JSON string. The route returns it verbatim; the spark descriptionHash commits to it. */
  metadata: string;
};

export type LightningReceiveQuoteResult = {
  paymentRequest: string;
  verify: LnurlVerifyRef;
};

export type LightningReceiveStatusResult = {
  settled: boolean;
  preimage: string | null;
  paymentRequest: string;
};

/** The narrow server-mode surface (LNURL / lightning-address). */
export interface ServerSdkApi {
  resolveLightningAddress(username: string): Promise<LightningAddressReceiveInfo | null>;
  createLightningReceiveQuote(params: {
    userId: string;
    amount: Money<'BTC'>;
    bypassAmountValidation?: boolean;
  }): Promise<LightningReceiveQuoteResult>;
  getLightningReceiveStatus(ref: LnurlVerifyRef): Promise<LightningReceiveStatusResult>;
}

export type ServerSdkDeps = {
  lud16Domain: string;
  userRepository: Pick<UserRepository, 'get' | 'getByUsername'>;
  serverAccountRepository: Pick<ServerAccountRepository, 'getDefaultAccount'>;
  cashuReceiveQuoteService: CashuReceiveQuoteServiceServer;
  sparkReceiveQuoteService: SparkReceiveQuoteServiceServer;
  exchangeRate: Pick<ExchangeRateDomain, 'convert'>;
  /** Verify (cashu): a bare wallet for the source mint — only checkMintQuoteBolt11 is used. */
  getCashuMintWallet: (mintUrl: string) => ExtendedCashuWallet;
  /** Verify (spark): the dedicated server spark wallet (MAINNET). */
  getServerSparkWallet: () => Promise<BreezSdk>;
};

export class ServerSdk implements ServerSdkApi {
  private readonly minSendable = new Money<'BTC'>({ amount: 1, currency: 'BTC', unit: 'sat' });
  private readonly maxSendable = new Money<'BTC'>({ amount: 1_000_000, currency: 'BTC', unit: 'sat' });

  constructor(private readonly deps: ServerSdkDeps) {}

  async resolveLightningAddress(username: string): Promise<LightningAddressReceiveInfo | null> {
    const user = await this.deps.userRepository.getByUsername(username);
    if (!user) return null;
    return {
      userId: user.id,
      username: user.username,
      minSendable: this.minSendable,
      maxSendable: this.maxSendable,
      metadata: this.buildLnurlMetadata(user.username),
    };
  }

  async createLightningReceiveQuote(params: {
    userId: string;
    amount: Money<'BTC'>;
    bypassAmountValidation?: boolean;
  }): Promise<LightningReceiveQuoteResult> {
    const { userId, amount, bypassAmountValidation = false } = params;

    if (amount.lessThan(this.minSendable) || amount.greaterThan(this.maxSendable)) {
      throw new DomainError(
        `Amount out of range. Min: ${this.minSendable.toNumber('sat')} sats, Max: ${this.maxSendable.toNumber('sat')} sats.`,
        'amount_out_of_range',
      );
    }

    const user = await this.deps.userRepository.get(userId);
    if (!user) throw new NotFoundError('User not found', 'user_not_found');

    const account = await this.deps.serverAccountRepository.getDefaultAccount(
      userId,
      bypassAmountValidation ? undefined : 'BTC',
    );

    const amountToReceive: Money =
      amount.currency === account.currency
        ? amount
        : await this.deps.exchangeRate.convert({ amount, to: account.currency });

    if (account.type === 'cashu') {
      return this.createCashuReceiveQuote(user, account, amountToReceive);
    }
    return this.createSparkReceiveQuote(user, account, amountToReceive);
  }

  async getLightningReceiveStatus(ref: LnurlVerifyRef): Promise<LightningReceiveStatusResult> {
    if (ref.type === 'cashu') {
      const wallet = this.deps.getCashuMintWallet(ref.mintUrl);
      const mintQuote = await wallet.checkMintQuoteBolt11(ref.quoteId);
      const settled = ['PAID', 'ISSUED'].includes(mintQuote.state);
      return { settled, preimage: settled ? '' : null, paymentRequest: mintQuote.request };
    }

    const wallet = await this.deps.getServerSparkWallet();
    const receiveRequest = await wallet.getLightningReceiveRequest({ requestId: ref.quoteId });
    if (!receiveRequest) {
      throw new NotFoundError(`Spark lightning receive request ${ref.quoteId} not found`, 'not_found');
    }
    return {
      settled: receiveRequest.status === 'transferCompleted',
      preimage: receiveRequest.paymentPreimage ?? null,
      paymentRequest: receiveRequest.invoice,
    };
  }

  private async createCashuReceiveQuote(
    user: { id: string; cashuLockingXpub: string; encryptionPublicKey: string },
    account: RedactedCashuAccount,
    amount: Money,
  ): Promise<LightningReceiveQuoteResult> {
    const lightningQuote = await getCashuLightningQuote({
      wallet: account.wallet,
      amount,
      xPub: user.cashuLockingXpub,
    });
    await this.deps.cashuReceiveQuoteService.createReceiveQuote({
      userId: user.id,
      userEncryptionPublicKey: user.encryptionPublicKey,
      account,
      receiveType: 'LIGHTNING',
      lightningQuote,
    });
    return {
      paymentRequest: lightningQuote.mintQuote.request,
      verify: { type: 'cashu', quoteId: lightningQuote.mintQuote.quote, mintUrl: account.mintUrl },
    };
  }

  private async createSparkReceiveQuote(
    user: { id: string; username: string; sparkIdentityPublicKey: string; encryptionPublicKey: string },
    account: SparkAccount,
    amount: Money,
  ): Promise<LightningReceiveQuoteResult> {
    const descriptionHash = await sha256Hex(this.buildLnurlMetadata(user.username));
    const lightningQuote = await this.deps.sparkReceiveQuoteService.getLightningQuote({
      wallet: account.wallet,
      amount,
      receiverIdentityPubkey: user.sparkIdentityPublicKey,
      descriptionHash,
    });
    await this.deps.sparkReceiveQuoteService.createReceiveQuote({
      userId: user.id,
      userEncryptionPublicKey: user.encryptionPublicKey,
      account,
      receiveType: 'LIGHTNING',
      lightningQuote,
    });
    return {
      paymentRequest: lightningQuote.invoice.paymentRequest,
      verify: { type: 'spark', quoteId: lightningQuote.id },
    };
  }

  private buildLnurlMetadata(username: string): string {
    const address = `${username}@${this.deps.lud16Domain}`;
    return JSON.stringify([
      ['text/plain', `Pay to ${address}`],
      ['text/identifier', address],
    ]);
  }
}

/** Build a server-mode SDK facade. Throws if the server config (serviceRoleKey / serverSparkMnemonic) is missing. */
export function createServer(config: SdkConfig): ServerSdk {
  const connections = buildServerConnections(config);
  const userRepository = new UserRepository(connections.supabase);
  const serverAccountRepository = new ServerAccountRepository(
    connections.supabase,
    connections.cashuWallets,
    connections.sparkWallets,
  );
  const cashuReceiveQuoteService = new CashuReceiveQuoteServiceServer(
    new CashuReceiveQuoteRepositoryServer(connections.supabase),
  );
  const sparkReceiveQuoteService = new SparkReceiveQuoteServiceServer(
    new SparkReceiveQuoteRepositoryServer(connections.supabase),
  );
  const exchangeRate = createExchangeRateDomain();

  return new ServerSdk({
    lud16Domain: config.lud16Domain,
    userRepository,
    serverAccountRepository,
    cashuReceiveQuoteService,
    sparkReceiveQuoteService,
    exchangeRate,
    getCashuMintWallet: (mintUrl) => getCashuWallet(mintUrl),
    getServerSparkWallet: async () => (await connections.sparkWallets.getInitialized('MAINNET')).wallet,
  });
}
```

> Verify before writing: (a) `Money.lessThan`/`Money.greaterThan` confirmed present (`packages/money/src/money.ts:449,461`; the web LN-address service uses the same `amount.lessThan(min) || amount.greaterThan(max)`). (b) The cashu branch narrows `account` to `RedactedCashuAccount` (`account.type === 'cashu'`) — `account.wallet` is then `ExtendedCashuWallet`. The spark branch's `account` is the spark variant of `RedactedAccount`, structurally `SparkAccount`; if TS does not auto-narrow the `RedactedAccount` union to `SparkAccount` in `createSparkReceiveQuote`, accept `RedactedAccount & { type:'spark' }` and pass it (it has `wallet: BreezSdk`). (c) `getCashuWallet(mintUrl)` with no options returns a wallet whose `checkMintQuoteBolt11` works without loaded keysets (pure mint REST call) — confirm against `internal/lib/cashu/utils.ts`. (d) `createExchangeRateDomain` takes no args. (e) `ExchangeRateDomain.convert` is `({ amount, to }) => Promise<Money>`.

- [ ] **Step 4: Run it; expect PASS** — `bun test src/server-sdk.test.ts`. Expected: all pass.

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/server-sdk.ts src/server-sdk.test.ts
git commit -m "feat(wallet-sdk): ServerSdk + createServer (resolve / create-quote / verify over server internals)"
```

---

## Task 9: Barrel export + whole-slice verification gate + docs/memory

**Files:**
- Modify: `packages/wallet-sdk/src/index.ts`
- Modify: `docs/superpowers/plans/2026-06-13-wallet-sdk-00-plan-of-plans.md`
- Docs/memory only otherwise.

**Interfaces:**
- Produces: the public barrel re-exports `createServer` (value) + `ServerSdk` and the server surface types (types).

- [ ] **Step 1: Write the failing test** — append a barrel smoke check (to `src/index.test.ts` if it exists; else create it):

```ts
import { describe, expect, it } from 'bun:test';
import * as sdk from './index';

describe('public barrel — server surface', () => {
  it('re-exports createServer', () => {
    expect(typeof sdk.createServer).toBe('function');
  });
});
```

- [ ] **Step 2: Run it; expect FAIL** — `bun test src/index.test.ts -t "server surface"`. Expected: FAIL (`createServer` undefined).

- [ ] **Step 3: Add the barrel exports** — in `index.ts`, adjacent to the `Sdk`/`SdkConfig` block:

```ts
// --- server-mode entry point ----------------------------------------------
export { createServer, ServerSdk } from './server-sdk';
export type {
  ServerSdkApi,
  LnurlVerifyRef,
  LightningAddressReceiveInfo,
  LightningReceiveQuoteResult,
  LightningReceiveStatusResult,
} from './server-sdk';
```

> `ServerSdk` is exported as a value (the class) so `instanceof` works for consumers; `ServerSdkApi` is the interface type. The `*Created` repo types stay internal (not part of the `ServerSdk` surface). Confirm `index.ts`'s existing export style (named vs `export *`) and match it.

- [ ] **Step 4: Run it; expect PASS** — `bun test src/index.test.ts`. Expected: pass.

- [ ] **Step 5: Whole-slice gate** — from `packages/wallet-sdk/`:

```bash
bun run typecheck && bun run test
```
Expected: green; the SDK test count = the prior 599 + the tests added here (Tasks 1–8). Confirm no failures and that the count rose only by the new tests.

- [ ] **Step 6: Confirm the server surface is wired + the client is untouched**

```bash
git grep -n "export { createServer" src/index.ts && echo "OK: createServer exported"
git grep -n "NotImplementedError" src/server-sdk.ts || echo "OK: no NotImplemented in ServerSdk"
git status --short   # clean
```

- [ ] **Step 7: Update the plan-of-plans index + memory** — flip the Plan 10 row to ✅ done with a one-line summary + the S10→S11/S14 carryover (below), and update the `project-wallet-sdk-nocache-track` memory (Plans 01–10 done; Phase 1 complete; next = S11 web cut-over).

```bash
git add docs/superpowers/plans/2026-06-13-wallet-sdk-00-plan-of-plans.md docs/superpowers/plans/2026-06-13-wallet-sdk-10-server-sdk.md
git commit -m "docs(wallet-sdk): record Plan 10 (ServerSdk facade) done + S11/S14 carryover"
```

**Carryover to record (S10 → S11 / S14):**
- **(S14 routes)** The RR routes call `createServer(config)` (one server instance) and own ALL wire concerns: LUD JSON envelopes (`payRequest` / `{pr,verify,routes}` / `{status:'OK',settled,preimage,pr}` / `{status:'ERROR',reason}`), the `verify`-URL base prefix (`${origin}/api/lnurlp/verify/${token}`), msat parsing of the callback `amount`, and the **xchacha20poly1305 encode/decode** of the `$encryptedQuoteData` token (with `LNURL_SERVER_ENCRYPTION_KEY`) over the structured `LnurlVerifyRef`. S14 deletes `lightning-address-service.ts` + the web `.server` repos in the same step.
- **(S14 metadata invariant)** The LUD-16 route MUST build its `metadata` from `resolveLightningAddress(...).metadata` (derived from `config.lud16Domain`), so the spark invoice's `descriptionHash` (computed by `ServerSdk` from the same string) matches the wallet-client's `description_hash` commitment.
- **(S11/S14 config)** The server entry assembles a `SdkConfig` with `supabase.serviceRoleKey`, `serverSparkMnemonic` (from `LNURL_SERVER_SPARK_MNEMONIC`), `breezApiKey`, `sparkStorageDir` (`/tmp/.spark-data`), `lud16Domain`; `openSecret`/`storage`/`defaultAccounts` are unused server-side but currently still required by the `SdkConfig` type (supply any value, or revisit a narrower `ServerConfig` if the friction matters).
- **(server spark network)** Verify uses `'MAINNET'`; server spark accounts are mainnet in prod. If REGTEST server receives are ever needed, the verify ref must carry the network.
- **(Phase 1 complete)** All 11 client domains + the `ServerSdk` facade are built dark; the web is untouched. Phase 2 (S11–S15) is the cut-over.

---

## Self-Review

**1. Spec coverage (§3 server facade / §4 server-sdk.ts + SdkConnections / §6 server surface / §8 server-side Spark receive / §9 S10 / §11 open items):**
- Standalone narrow `ServerSdk` (not branching `Sdk`) over shared internals → Task 8 (D10-1, spec D9). ✓
- Server connection bundle: service-role client + dedicated server Spark wallet (own mnemonic + storageDir) + cashu mint clients, NO OpenSecret/per-user keys → Task 7 (spec §3/§4). ✓
- `SdkConfig` gains `serverSparkMnemonic` (spec §4/§11) → Task 7. ✓
- The three server ops: resolve username → capability; create receive quote session-less (cashu + spark); read settle status (LUD-21) → Task 8 (spec §6). ✓
- Server-side Spark receive via the session-agnostic core `getLightningQuote({wallet: serverWallet, amount, receiverIdentityPubkey: user.sparkIdentityPublicKey})` (spec §8) → Tasks 4 + 8; `descriptionHash` for spark only (D10-8). ✓
- `encryptToPublicKey` ported (spec §6/§8: encrypt to the receiver's public key) → Task 1. ✓
- LUD JSON wire format stays in the RR routes (spec §6); ServerSdk returns structured data + a `LnurlVerifyRef` → D10-3, scope boundary. ✓
- Server method names settled (spec §11 open item) → `resolveLightningAddress` / `createLightningReceiveQuote` / `getLightningReceiveStatus` (Decisions). ✓
- ServerSdk has NO background loop / realtime / leader election (S9→S10 carryover) → architecture + D10-1. ✓
- Verified by SDK unit tests alone; web + routes untouched (spec §9/§10) → Tasks 1–9. ✓

**2. Placeholder scan:** every code step shows full code; commands have expected output. The `>`-prefixed notes are *verification reminders* (confirm an existing signature before writing — e.g. `Money.lessThan`/`greaterThan`, `makeFakeDb.rpc` recording shape, `data.spark_id` RPC return, the `RedactedAccount`→`SparkAccount` narrowing, `getCashuWallet` bare usage), not deferred work. No "TBD"/"add error handling"/"similar to Task N".

**3. Type consistency:** `RepositoryCreateQuoteParams` (per protocol) flows from the cores → server repos → server services with `userEncryptionPublicKey` threaded; `CreateQuoteBaseParams` flows into the server services. `SparkReceiveQuoteCreated`/`CashuReceiveQuoteCreated` returned by the repos and the services. `LnurlVerifyRef`/`LightningAddressReceiveInfo`/`LightningReceiveQuoteResult`/`LightningReceiveStatusResult` defined in `server-sdk.ts` and re-exported. `ServerConnections = { supabase, sparkWallets, cashuWallets }` consumed by `createServer`. `encryptToPublicKey(data, pubkeyHex): string` (sync) consumed by both server repos. Errors `(message, code)`; `NotFoundError`(user/not-found), `DomainError`(invalid_state / amount_out_of_range), `classify` for DB. Verify: cashu `['PAID','ISSUED']`+preimage`''`; spark `transferCompleted`+`paymentPreimage ?? null`.

**Risks / carryover to S11/S14:** recorded in Task 9. The biggest S14 coupling is the metadata invariant (LUD-16 `metadata` ⟷ spark `descriptionHash` must be the identical string) and the xchacha verify-token staying route-side. The `SdkConfig`-requires-`openSecret`/`storage`-server-side friction is documented (a narrower `ServerConfig` is a possible later refinement, not needed for S10).

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-13-wallet-sdk-10-server-sdk.md`.**

Per the task, execution proceeds with **superpowers:subagent-driven-development** — a fresh subagent per task, two-stage review between tasks, gate = `bun run typecheck` + `bun run test` (from `packages/wallet-sdk/`), one commit per task, no push.
