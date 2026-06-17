# Cashu Ops (`@agicash/wallet-sdk` S5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the cashu domain's **building blocks + pure create/read public surface** — the send-quote / send-swap / receive-quote / receive-swap models, repositories, and services (all of their per-operation methods, including the wallet-driven primitives), plus the same-mint token-claim primitives — leaving the **WS-driven orchestration** (`executeQuote`, `receiveToken`, the subscription managers, the #788 change-refetch, the task loop) to S7.

**Architecture:** S5 ports master's cashu services + repositories faithfully, stripping the React/TanStack hooks and using **dependency injection** (the S4 pattern): repositories take the RLS `supabase` client + `EncryptionService`; services take repositories + a new `CashuCryptography` (derived locally from the existing `getCashuSeed` via `@scure/bip32` HDKey). Every method is a single wallet+DB operation, **unit-tested offline with fake wallets + `makeFakeDb`** — no live mint, no websocket, no task loop. The cashu domain flips from a `notImplementedDomain` stub to a real `createCashuDomain(...)` that wires the create/read/fail/reverse methods and throws `NotImplementedError` for `executeQuote` + `receiveToken` (assembled in S7). The other 5 domains stay stubbed.

**Tech Stack:** Bun workspaces, TypeScript 5.9.3, `@cashu/cashu-ts@3.6.1` (`Wallet`/`Mint`/`OutputData`/`KeyChain`/`splitAmount`/`MeltQuoteState`/`MintQuoteState`/`MintOperationError`/`NetworkError`/`Proof`/`Token`/`MeltQuoteBolt11Response`/`MintQuoteBolt11Response`), `@scure/bip32@1.7.0` (`HDKey`), `@agicash/money`, `zod@4.3.6` (`zod/mini`), `@noble/hashes`, `bun:test`.

---

## Scope boundary (read first)

**In scope (S5):**
- **Lib additions** to the already-vendored `internal/lib/cashu`: `toProof` (domain `CashuProof` → cashu-ts `Proof`), `getTokenHash`, `tokenToMoney`, and the vendored `blind-signature-matching.ts` (`matchBlindSignaturesToOutputData`, used by send-quote completion).
- **DB json-model schemas** → `internal/db`: `CashuLightningSendDbDataSchema`, `CashuSwapSendDbDataSchema`, `CashuLightningReceiveDbDataSchema` (+ the embedded `CashuTokenMeltDataSchema`), `CashuSwapReceiveDbDataSchema`, plus the shared proof DB-mapping helpers (`toDecryptedCashuProofs`, `toEncryptedProofData`).
- **`CashuCryptography`** (`internal/connections/cashu-crypto.ts`): `getSeed`/`getXpub`/`getPrivateKey`, derived locally from `connections.getCashuSeed` via `HDKey` (the SDK owns key derivation — D3).
- **The 4 repositories** (`internal/repositories/cashu-{send-quote,send-swap,receive-quote,receive-swap}-repository.ts`): full CRUD/RPC + row→domain mappers. Offline-testable with `makeFakeDb`.
- **The services** (`domains/cashu/*`), with **every** method including the wallet-driven per-operation primitives:
  - `CashuSendQuoteService` (`getLightningQuote`, `createSendQuote`, `initiateSend`, `markSendQuoteAsPending`, `completeSendQuote`, `failSendQuote`, `expireSendQuote`, `selectProofs`).
  - `CashuSendSwapService` (`getQuote`, `create`, `swapForProofsToSend`, `complete`, `fail`, `reverse`, `prepareProofsAndFee`).
  - `cashu-receive-quote-core.ts` (`deriveNut20LockingPublicKey`, `getLightningQuote`, `computeQuoteExpiry`, `computeTotalFee`).
  - `CashuReceiveQuoteService` (`getLightningQuote`, `createReceiveQuote`, `markMeltInitiated`, `expire`, `fail`, `completeReceive` + `processUnpaidQuote`/`processPaidQuote`/`mintProofs`).
  - `CashuReceiveSwapService` (`create`, `fail`, `completeSwap`).
  - `receive-cashu-token-models.ts` (`TokenFlags`, `isClaimingToSameCashuAccount`) + `ReceiveCashuTokenService` (`buildAccountForMint`, `getSourceAndDestinationAccounts`, `getDefaultReceiveAccount`).
- **`cashuMintValidator` instance + `cashuMintBlocklist` config** (deferred from S4): `SdkConfig.cashuMintBlocklist?: string[]`; `buildConnections` constructs `cashuMintValidator` via the already-vendored `buildMintValidator`.
- **`createCashuDomain`** wired into `Sdk`: `send.{createLightningQuote, createTokenQuote, failQuote, reverse, get}` + `receive.{createLightningQuote, get}` real; `send.executeQuote` + `receive.receiveToken` throw `NotImplementedError` (S7).

**Out of scope (S7 — the orchestrator, confirmed forks):**
- `cashu.send.executeQuote` (the WS-driven UNPAID→PENDING→PAID state machine) and `cashu.receive.receiveToken` (the public claim entry-point) — **stay `NotImplementedError`**.
- The 3 WS subscription managers (`MeltQuoteSubscriptionManager`, `MintQuoteSubscriptionManager`, `ProofStateSubscriptionManager`), the `melt-quote-subscription.ts` **#788 change-refetch** handler, and the task-processing loop — **vendored/built in S7** ("whichever slice owns execution vendors them"). None of S5's service primitives import them.
- **Cross-account token-claim** (`ReceiveCashuTokenQuoteService.createCrossAccountReceiveQuotes` — needs `SparkReceiveQuoteService` from S6) and the `ClaimCashuTokenService` melt-then-mint orchestration — **S7**.
- `payment-request.ts` (NUT-18) — no S5 service references it; vendored if/when a slice needs it.
- Leader election / background lifecycle (S9); spark ops (S6); the spark balance listener + §8 stale-balance reconcile (S7).
- The web stays **untouched** (dark build); S5 is verified by SDK unit tests alone.

---

## Decisions (locked)

- **D5-1 — `executeQuote` + `receiveToken` defer to S7; S5 builds + unit-tests every per-operation primitive (owner-confirmed).** The service methods that touch the live wallet (`initiateSend`→`wallet.meltProofsIdempotent`, `completeSendQuote`→change derivation, `swapForProofsToSend`→`wallet.ops.send`, `completeReceive`→`wallet.ops.mintBolt11`, `completeSwap`→`wallet.ops.receive`) are each a single op, **unit-testable offline with a fake wallet**. The public `executeQuote`/`receiveToken` only *assemble* these via the WS managers + task loop + leader election (S7/S9), so they ship as `NotImplementedError`. Honest: no half-built money method ships; matches master (executeQuote = hand the quote to the background loop, which only exists S7+S9).
- **D5-2 — Same-mint token-claim primitives only in S5 (owner-confirmed).** S5 builds `CashuReceiveSwapService` (same-mint NUT-03 receive), `ReceiveCashuTokenService` (source/dest account selection + `buildAccountForMint`), and the `cashuMintValidator` + `cashuMintBlocklist` config. The cross-account quote (`createCrossAccountReceiveQuotes` — needs Spark S6) and the `ClaimCashuTokenService` orchestration land in S7. The contract's `receiveToken` return type (`CashuReceiveQuote | SparkReceiveQuote`) does not even model the same-mint `CashuReceiveSwap`, reinforcing that the public `receiveToken` belongs with the S7 orchestration.
- **D5-3 — DI over `mock.module` (the S4 pattern).** Repositories take `(supabase, encryption: EncryptionService, …)`; services take repositories + injected `CashuCryptography` (a plain object of async fns). Wallets are passed via the `CashuAccount.wallet` handle (already live since S4) or injected fakes. Tests use `makeFakeDb` + hand-rolled fake wallets — **no `mock.module` on `@cashu/cashu-ts`**. Any test that nonetheless uses `mock.module` MUST add `afterAll(() => mock.restore())` + the complete factories (carryover).
- **D5-4 — `CashuCryptography` is derived locally from the cashu seed (SDK owns key derivation — D3).** Master derives the locking xpub locally (`HDKey.fromMasterSeed(cashuSeed)`) but fetches the locking private key via OpenSecret; both are BIP-32 over the same cashu child seed, so the SDK derives **both** locally from `connections.getCashuSeed()` via `HDKey`. A unit test asserts the xpub-derived public key matches the private-key-derived public key at the same path (so NUT-20 locking verifies).
- **D5-5 — Repositories take `EncryptionService` (not a resolved `Encryption`).** Matches S4's `AccountRepository`; each method calls `await this.encryption.get()` once (memoized). Drops the web's `useEncryption()` hook.
- **D5-6 — Every ported `new DomainError(msg)` / `new Error(msg)` that is a user-facing domain failure becomes `new DomainError(msg, code)`** (the SDK's 2-arg requirement). Codes used by S5: `'invalid_invoice'`, `'expired'`, `'insufficient_balance'`, `'invalid_state'`, `'account_mismatch'`, `'quote_mismatch'`, `'token_too_small'`, `'mint_mismatch'`, `'currency_mismatch'`, `'token_already_claimed'`, `'unsupported'`. Repository DB-error wrapping uses `classify(error)` (the SDK router) for unknown DB errors and the 2-arg `ConcurrencyError`/`DomainError` for the explicit hints (`CONCURRENCY_ERROR`, `LIMIT_REACHED`, `23505`/409).
- **CI gate:** `bun run typecheck` + `bun run test` (NOT `fix:all`). Commit per task locally; do not push.

---

## Grounding facts (verified 2026-06-17 — authoritative)

**SDK shapes S5 builds on (re-verified):**
- `Sdk` (`src/sdk.ts`): `protected constructor(config, connections)` builds `ctx: DomainContext = { config, connections, emitter }`, builds `accountRepository = new AccountRepository(supabase, encryption, cashuWallets, sparkWallets, mintAuth, getCashuSeed)` inline, and assigns the 5 real domains. The cashu stub is `readonly cashu: CashuDomain = { send: notImplementedDomain<CashuSendOps>('cashu.send'), receive: notImplementedDomain<CashuReceiveOps>('cashu.receive') }` (Task 18 replaces it).
- `SdkConnections` (`src/internal/connections/index.ts`): `{ supabase, session, realtime, keys, encryption: EncryptionService, cashuWallets: CashuWalletService, sparkWallets: SparkWalletService, mintAuth: MintAuthTokenProvider, getCashuSeed: () => Promise<Uint8Array> }`. S5 adds `cashuCrypto: CashuCryptography` + `cashuMintValidator`.
- `errors.ts`: `SdkError(message, code)`; `DomainError`/`ConcurrencyError`/`NotFoundError extends SdkError` (all 2-arg `(message, code)`); `NotImplementedError(method)` (1-arg → code `'not_implemented'`). `classify(error)` routes DB errors. `notImplementedDomain<T>(domain)` proxy-stubs a whole domain.
- `internal/lib/cashu` barrel exports today: `./proof` (`sumProofs`, `proofToY`, `getClaimableProofs`), `./secret`, `./token` (`getUnspentProofsFromToken`, `encodeToken`, `extractCashuToken`), `./utils` (`getCashuUnit`, `getCashuProtocolUnit`, `ExtendedCashuWallet`, `getCashuWallet`, `normalizeMintUrl`, `checkIsTestMint`, `areMintUrlsEqual`, `findFirstActiveKeyset`, `getKeysetExpiry`, `getMintPurpose`, `validateCashuToken`, `getWalletCurrency`), `./error-codes`, `ExtendedMintInfo`/`MintPurpose` (from `./protocol-extensions`), `ProofSchema` (from `./types`). **Missing (S5 adds):** `toProof`, `getTokenHash`, `tokenToMoney`, `matchBlindSignaturesToOutputData`. `mint-validation.ts` exports `MintBlocklistSchema` + `buildMintValidator` (no validator instance built yet).
- `internal/db/database.ts` already aliases `AgicashDbCashuProof`, `AgicashDbCashuReceiveQuote`, `AgicashDbCashuReceiveSwap`, `AgicashDbCashuSendQuote`, `AgicashDbCashuSendSwap`, and the RPC **result bundles** (`{ quote, reserved_proofs }`, `{ quote, spent_proofs, change_proofs }`, `{ swap, added_proofs }`, etc.). `AgicashDbAccountWithProofs` carries `cashu_proofs: AgicashDbCashuProof[]`.
- `internal/db/database.types.ts` contains **all** the cashu tables (`cashu_send_quotes`, `cashu_send_swaps`, `cashu_receive_quotes`, `cashu_receive_swaps`) and **all** RPCs S5 needs: `create_cashu_send_quote`, `complete_cashu_send_quote`, `expire_cashu_send_quote`, `fail_cashu_send_quote`, `mark_cashu_send_quote_as_pending`, `create_cashu_send_swap`, `commit_proofs_to_send`, `complete_cashu_send_swap`, `fail_cashu_send_swap`, `create_cashu_receive_quote`, `expire_cashu_receive_quote`, `fail_cashu_receive_quote`, `mark_cashu_receive_quote_cashu_token_melt_initiated`, `process_cashu_receive_quote_payment`, `complete_cashu_receive_quote`, `create_cashu_receive_swap`, `complete_cashu_receive_swap`, `fail_cashu_receive_swap`.
- `internal/crypto/sha256.ts` exports `sha256Hex(message: string): Promise<string>` (the SDK equivalent of master's `computeSHA256`).
- `internal/crypto/keys.ts`: `KeyProvider` has `getChildMnemonic`/`getPrivateKeyBytes`/`getPublicKeyHex` (no `getXpub`); `CASHU_MNEMONIC_PATH = "m/83696968'/39'/0'/12'/0'"` already encodes master's `getSeedPhraseDerivationPath('cashu', 12)`. `getCashuSeed` on connections = `keys.getChildMnemonic(CASHU_MNEMONIC_PATH).then(mnemonicToSeedSync)`.
- `internal/crypto/bootstrap-keys.ts` already `import { HDKey } from '@scure/bip32'` — the dep + import path are proven.
- `internal/test-support.ts`: `makeFakeDb({selectResult, updateResult, rpcResult, calls})` (awaitable builder + `insert`/`abortSignal`/`maybeSingle`/`single`/`.eq`), `inMemoryStorage`, `jwtWith`. `EncryptionService` (`internal/crypto/encryption.ts`) memoizes a real ECIES keypair; tests build one from a random secp256k1 key (S4 pattern).
- `domains/accounts/account-utils.ts` (S4): `canReceiveFromLightning`, `canSendToLightning`, `getAccountBalance`, `isDefaultAccount`, `getExtendedAccounts`.

**Contract surfaces S5 implements (`src/domains.ts` + `src/types/cashu.ts`, re-verified):**
- `CashuSendOps`: `createLightningQuote({account: CashuAccount; destination: string; amount?: Money}): Promise<CashuSendQuote>` · `createTokenQuote({account: CashuAccount; amount: Money}): Promise<CashuSendSwap>` · `executeQuote(quote): Promise<CashuSendQuote>` **(S7)** · `failQuote(quote, reason): Promise<void>` · `reverse(swap): Promise<CashuSendSwap>` · `get(id): Promise<CashuSendQuote | CashuSendSwap | null>`.
- `CashuReceiveOps`: `receiveToken({token; destinationAccount?}): Promise<CashuReceiveQuote | SparkReceiveQuote>` **(S7)** · `createLightningQuote({account: CashuAccount; amount: Money; purpose?: 'PAYMENT' | 'BUY_CASHAPP'}): Promise<CashuReceiveQuote>` · `get(quoteId): Promise<CashuReceiveQuote | null>`.
- `CashuDomain`: `{ send: CashuSendOps; receive: CashuReceiveOps }`.
- `types/cashu.ts` (public domain types, already shipped): `CashuSendQuote` (state UNPAID/PENDING/EXPIRED/FAILED/PAID; `DestinationDetails`), `CashuSendSwap` (state DRAFT/PENDING/COMPLETED/FAILED/REVERSED; `PendingCashuSendSwap`), `CashuReceiveQuote` (type LIGHTNING/CASHU_TOKEN ∧ state UNPAID/EXPIRED/PAID/COMPLETED/FAILED; `CashuTokenMeltData`). `CashuSendSwap.createdAt` is a `Date` (not ISO string). `CashuProof` (`types/account.ts`) is the hand-written domain proof.

**Web behaviour S5 reproduces (verified; web stays untouched). Master files to port from:**
- `app/features/send/cashu-send-quote.ts` (model/schemas), `…/cashu-send-quote-service.ts` (`CashuSendQuoteService`), `…/cashu-send-quote-repository.ts` (`CashuSendQuoteRepository`).
- `app/features/send/cashu-send-swap.ts`, `…/cashu-send-swap-service.ts`, `…/cashu-send-swap-repository.ts`.
- `app/features/receive/cashu-receive-quote.ts`, `…/cashu-receive-quote-core.ts`, `…/cashu-receive-quote-service.ts`, `…/cashu-receive-quote-repository.ts`.
- `app/features/receive/cashu-receive-swap.ts`, `…/cashu-receive-swap-service.ts`, `…/cashu-receive-swap-repository.ts`.
- `app/features/receive/receive-cashu-token-models.ts`, `…/receive-cashu-token-service.ts`.
- `app/features/shared/cashu.ts` (`tokenToMoney`, `getTokenHash`, `CashuCryptography`, `getCashuCryptography`, `cashuMintValidator`), `app/lib/cashu/blind-signature-matching.ts`, `app/features/agicash-db/json-models/cashu-{lightning-send,swap-send,lightning-receive,swap-receive,token-melt}-db-data.ts`.
- `toProof` / `toDecryptedCashuProofs` live in `app/features/shared/cashu.ts` (+ used by `…/utils.ts` and the repos).

**The DB-data schemas (what the repos encrypt/decrypt as `encrypted_data`):** master's json-models are `zod/mini` `z.object({...})` over `Money` (`z.instanceof(Money)`), `Proof[]` (`z.array(ProofSchema)`), strings, numbers, and the discriminated state fields. Re-read each `cashu-*-db-data.ts` side-by-side when porting (Task 3) — they are framework-free (deps: `zod/mini`, `@agicash/money`, `internal/lib/cashu#ProofSchema`).

**RPC error handling (master, ported to 2-arg SDK errors):** `create_cashu_send_quote` → on `error.hint === 'LIMIT_REACHED'` throw `DomainError`; on `409` (cashu) throw `DomainError`; else `classify`. `create_cashu_send_swap` → on `error.hint === 'CONCURRENCY_ERROR'` throw `ConcurrencyError`. `create_cashu_receive_swap` → on `error.code === '23505'` throw a "token already claimed" `DomainError`. All other RPC failures: the web throws `new Error('Failed to …', { cause })` → SDK uses `throw classify(error)` (preserves cause + maps known PG codes).

**cashu-ts API used (reconcile against `node_modules/@cashu/cashu-ts@3.6.1` when implementing):** `wallet.createMeltQuoteBolt11`, `wallet.checkMeltQuoteBolt11`, `wallet.meltProofsIdempotent`, `wallet.selectProofsToSend`, `wallet.getFeesForProofs`, `wallet.getFeesEstimateToReceiveAtLeast`, `wallet.createLockedMintQuote`, `wallet.keyChain.ensureKeysetKeys`, `wallet.getKeyset`, `wallet.getKeyset().id`/`wallet.keysetId`, `wallet.ops.send(...).keyset(...).asCustom(...).keepAsCustom(...).run()`, `wallet.ops.receive({mint,proofs,unit}).asCustom(...).run()`, `wallet.ops.mintBolt11(amount, {...}).keyset(...).privkey(...).asCustom(...).run()`, `wallet.restore(counter, count, {keysetId})`, `wallet.seed`, `wallet.unit`; `OutputData.createDeterministicData(amount, seed, counter, keyset, outputAmounts)`, `KeyChain`, `splitAmount(amount, keys)`, `MeltQuoteState`, `MintQuoteState`, `MintOperationError`, `NetworkError`, `Mint`. Read the master service file alongside each task — the bodies are near-verbatim ports.

---

## File Structure

**Created (SDK):**
- `src/internal/lib/cashu/blind-signature-matching.ts` (+ `.test.ts`) — vendored.
- `src/internal/db/cashu-send-quote-db-data.ts`, `cashu-send-swap-db-data.ts`, `cashu-receive-quote-db-data.ts`, `cashu-receive-swap-db-data.ts` (+ tests) — vendored schemas.
- `src/internal/db/cashu-proofs.ts` (+ `.test.ts`) — `toDecryptedCashuProofs` + `toEncryptedProofData`.
- `src/internal/connections/cashu-crypto.ts` (+ `.test.ts`) — `CashuCryptography` + `getCashuCryptography`.
- `src/internal/repositories/cashu-send-quote-repository.ts` (+ `.test.ts`).
- `src/internal/repositories/cashu-send-swap-repository.ts` (+ `.test.ts`).
- `src/internal/repositories/cashu-receive-quote-repository.ts` (+ `.test.ts`).
- `src/internal/repositories/cashu-receive-swap-repository.ts` (+ `.test.ts`).
- `src/domains/cashu/cashu-send-quote-service.ts` (+ `.test.ts`).
- `src/domains/cashu/cashu-send-swap-service.ts` (+ `.test.ts`).
- `src/domains/cashu/cashu-receive-quote-core.ts` (+ `.test.ts`).
- `src/domains/cashu/cashu-receive-quote-service.ts` (+ `.test.ts`).
- `src/domains/cashu/cashu-receive-swap-service.ts` (+ `.test.ts`).
- `src/domains/cashu/receive-cashu-token-models.ts`, `src/domains/cashu/receive-cashu-token-service.ts` (+ `.test.ts`).
- `src/domains/cashu/cashu-domain.ts` (+ `.test.ts`) — `createCashuDomain`.

**Modified (SDK):**
- `src/internal/lib/cashu/proof.ts` — add `toProof`.
- `src/internal/lib/cashu/token.ts` — add `getTokenHash`, `tokenToMoney`.
- `src/internal/lib/cashu/index.ts` — export the new helpers.
- `src/config.ts` — add `cashuMintBlocklist?: string[]`.
- `src/internal/connections/index.ts` — add `cashuCrypto` + `cashuMintValidator` to `SdkConnections` + `buildConnections`.
- `src/sdk.ts` — build the cashu repos/services + `createCashuDomain`; drop the cashu stub.
- `src/sdk.test.ts` — assert cashu create/read methods are real; `executeQuote`/`receiveToken` throw `NotImplementedError`.

---

## Task 1: Lib helper additions + config flag

**Files:** Modify `src/internal/lib/cashu/proof.ts`, `src/internal/lib/cashu/token.ts`, `src/internal/lib/cashu/index.ts`, `src/config.ts`. Test: `src/internal/lib/cashu/proof.test.ts` (extend), `src/internal/lib/cashu/token.test.ts` (extend).

- [ ] **Step 1: Add `toProof`** to `src/internal/lib/cashu/proof.ts`. Port master's `toProof` (`app/features/shared/cashu.ts`) — it maps a domain `CashuProof` to a cashu-ts `Proof`. Read master to confirm the exact field map; it is:

```ts
import type { Proof } from '@cashu/cashu-ts';
import type { CashuProof } from '../../../types/account';

/** Map a domain {@link CashuProof} to a cashu-ts protocol `Proof`. */
export const toProof = (proof: CashuProof): Proof => ({
  id: proof.keysetId,
  amount: proof.amount,
  secret: proof.secret,
  C: proof.unblindedSignature,
  ...(proof.dleq ? { dleq: proof.dleq } : {}),
  ...(proof.witness ? { witness: proof.witness } : {}),
});
```

> Reconcile the exact `Proof` shape + the `CashuProof` field names (`keysetId`/`unblindedSignature`/`dleq`/`witness`) against `node_modules/@cashu/cashu-ts@3.6.1` and `src/types/account.ts`. Master's `toProof` is the ground truth.

- [ ] **Step 2: Add `getTokenHash` + `tokenToMoney`** to `src/internal/lib/cashu/token.ts`. Port from master's `app/features/shared/cashu.ts`, mapping `computeSHA256` → `sha256Hex`:

```ts
import { Money } from '@agicash/money';
import type { Currency, CurrencyUnit } from '@agicash/money';
import type { Token } from '@cashu/cashu-ts';
import { sha256Hex } from '../../crypto/sha256';
import { sumProofs } from './proof';

function getCurrencyAndUnitFromToken(token: Token): {
  currency: Currency;
  unit: CurrencyUnit;
} {
  if (token.unit === 'sat') return { currency: 'BTC', unit: 'sat' };
  if (token.unit === 'usd') return { currency: 'USD', unit: 'cent' };
  throw new Error(`Invalid token unit ${token.unit}`);
}

/** The total value of a cashu token as {@link Money}, in the token's currency. */
export function tokenToMoney(token: Token): Money {
  const { currency, unit } = getCurrencyAndUnitFromToken(token);
  return new Money<Currency>({ amount: sumProofs(token.proofs), currency, unit });
}

/** SHA-256 hash of an encoded token (or token object), used as the swap identity. */
export function getTokenHash(token: Token | string): Promise<string> {
  return typeof token === 'string' ? sha256Hex(token) : sha256Hex(encodeToken(token));
}
```

> `encodeToken` already lives in this file (the barrel exports it). Confirm `CurrencyUnit` is exported from `@agicash/money` (it is — `Money`'s unit type). Confirm `Token.unit` typing against cashu-ts.

- [ ] **Step 3: Export the new helpers** — `src/internal/lib/cashu/index.ts` already does `export * from './proof'` and `export * from './token'`, so `toProof`/`getTokenHash`/`tokenToMoney` are exported automatically. No barrel edit needed yet (the `blind-signature-matching` export is added in Task 2). Verify no duplicate-export clash (`tokenToMoney`/`getTokenHash` are new names).

- [ ] **Step 4: Add the config flag** — `src/config.ts`, inside `SdkConfig` after the S4 flags:

```ts
  /**
   * Cashu mint URLs to block (the SDK refuses to validate/claim from them).
   * Replaces the web's `VITE_CASHU_MINT_BLOCKLIST` (the consumer parses the env
   * JSON via `MintBlocklistSchema` and passes the array). Default `[]`.
   */
  cashuMintBlocklist?: string[];
```

- [ ] **Step 5: Extend the lib tests.** In `src/internal/lib/cashu/proof.test.ts` add a `toProof` case (a domain `CashuProof` fixture → assert `{id, amount, secret, C}` map). In `src/internal/lib/cashu/token.test.ts` add `tokenToMoney` (a `sat`/`usd` token → assert `Money` value + currency) and `getTokenHash` (a token string → a 64-char hex; same input → same hash). Use the existing token fixtures in that test file.

- [ ] **Step 6: Verify + commit.** `bun run typecheck` → PASS. `bun --filter=@agicash/wallet-sdk run test` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): cashu lib helpers (toProof/getTokenHash/tokenToMoney) + blocklist config

Add toProof (CashuProof -> cashu-ts Proof) to proof.ts and getTokenHash/tokenToMoney
to token.ts (computeSHA256 -> sha256Hex), and SdkConfig.cashuMintBlocklist. Building
blocks for the S5 cashu repos/services; gate green.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Vendor `blind-signature-matching`

**Files:** Create `src/internal/lib/cashu/blind-signature-matching.ts` + `.test.ts`; modify `src/internal/lib/cashu/index.ts`.

- [ ] **Step 1: Copy verbatim.** `matchBlindSignaturesToOutputData` matches a mint's NUT-08 change blind signatures to deterministic outputs via DLEQ — used by `completeSendQuote`. It is framework-free (deps: `@cashu/cashu-ts`, `@noble/*`).

```bash
cp apps/web-wallet/app/lib/cashu/blind-signature-matching.ts packages/wallet-sdk/src/internal/lib/cashu/blind-signature-matching.ts
```

Fix any `~/lib/...` imports to relative `./...`. Verify it imports nothing from `~/features`, `react`, `@tanstack`, or `import.meta` (grep the copied file).

- [ ] **Step 2: Export it** — add to `src/internal/lib/cashu/index.ts`:

```ts
export * from './blind-signature-matching';
```

- [ ] **Step 3: Port the test if one exists**, else write a focused test. If `app/lib/cashu/blind-signature-matching.test.ts` exists, copy it and repoint imports to `./blind-signature-matching`. Otherwise add a minimal test asserting `matchBlindSignaturesToOutputData([], [], keysetStub)` returns `[]` (empty change → empty proofs) — the realistic DLEQ path is exercised end-to-end by the send-quote-service test (Task 10).

```bash
cp apps/web-wallet/app/lib/cashu/blind-signature-matching.test.ts packages/wallet-sdk/src/internal/lib/cashu/blind-signature-matching.test.ts 2>/dev/null || true
```

- [ ] **Step 4: Verify + commit.** `bun run typecheck` → PASS. `bun --filter=@agicash/wallet-sdk run test` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): vendor cashu blind-signature-matching lib

Copy matchBlindSignaturesToOutputData (NUT-08 change matching via DLEQ) verbatim
from app/lib/cashu; needed by cashu send-quote completion (change derivation).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Vendor the 4 cashu DB-data schemas

**Files:** Create `src/internal/db/cashu-send-quote-db-data.ts`, `cashu-send-swap-db-data.ts`, `cashu-receive-quote-db-data.ts`, `cashu-receive-swap-db-data.ts` + a single `cashu-db-data.test.ts`.

- [ ] **Step 1: Copy the schemas verbatim** from the json-models, repointing imports. Each is a `zod/mini` schema describing the `encrypted_data` JSON for its entity. Read each master file and copy:

```bash
cp apps/web-wallet/app/features/agicash-db/json-models/cashu-lightning-send-db-data.ts packages/wallet-sdk/src/internal/db/cashu-send-quote-db-data.ts
cp apps/web-wallet/app/features/agicash-db/json-models/cashu-swap-send-db-data.ts      packages/wallet-sdk/src/internal/db/cashu-send-swap-db-data.ts
cp apps/web-wallet/app/features/agicash-db/json-models/cashu-lightning-receive-db-data.ts packages/wallet-sdk/src/internal/db/cashu-receive-quote-db-data.ts
cp apps/web-wallet/app/features/agicash-db/json-models/cashu-swap-receive-db-data.ts   packages/wallet-sdk/src/internal/db/cashu-receive-swap-db-data.ts
```

The receive-quote schema embeds the token-melt schema (`cashu-token-melt-db-data.ts`); if it is `import`ed rather than inlined, also copy it (as `src/internal/db/cashu-token-melt-db-data.ts`) and repoint. Fix imports in all copied files:
- `~/lib/money` / `@agicash/money` → `@agicash/money` (keep).
- `~/lib/cashu` (`ProofSchema`) → `../lib/cashu`.
- `zod/mini` → `zod/mini` (keep).
- any `./cashu-token-melt-db-data` cross-import → keep relative.

Verify none import `~/features`, `react`, `@tanstack`, or `import.meta`.

- [ ] **Step 2: Write `cashu-db-data.test.ts`** — one parse round-trip per schema, using minimal valid fixtures (a `Money` instance, an empty/short `Proof[]`, the required string/number fields). Assert `Schema.parse(fixture)` returns the `Money`/`Proof[]` intact. (The exact field set comes from the copied schema — read it and build the fixture to match.)

```ts
import { describe, expect, it } from 'bun:test';
import { Money } from '@agicash/money';
import { CashuLightningSendDbDataSchema } from './cashu-send-quote-db-data';
// + the other three schema imports

describe('cashu db-data schemas parse', () => {
  it('parses lightning-send db data', () => {
    // Build a fixture matching every required field in the copied schema.
    // Money fields use new Money({...}); proof arrays use [] or a ProofSchema-valid fixture.
    // Assert .parse(fixture) succeeds and Money fields survive as Money instances.
  });
  // ... one it() per schema (swap-send, lightning-receive incl. token-melt, swap-receive)
});
```

> Fill each fixture from the copied schema's actual fields (do not guess — the schemas are the ground truth you just copied). Keep `Money` fixtures well-formed (`new Money({ amount: 1, currency: 'BTC', unit: 'sat' })`).

- [ ] **Step 3: Verify + commit.** `bun run typecheck` → PASS. `bun --filter=@agicash/wallet-sdk run test` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): vendor cashu send/receive quote+swap DB-data schemas

Copy the cashu encrypted_data json-model schemas (lightning-send, swap-send,
lightning-receive incl. token-melt, swap-receive) from agicash-db into internal/db.
These define what the cashu repositories encrypt/decrypt; parse round-trip tested.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Shared cashu-proof DB-mapping helpers

**Files:** Create `src/internal/db/cashu-proofs.ts` + `.test.ts`.

- [ ] **Step 1: Implement** (`src/internal/db/cashu-proofs.ts`) — the proof encrypt/decrypt mappers every cashu repository shares (extracted from the per-repo `toDecryptedCashuProofs` + the inline encrypt blocks; mirrors S4's `AccountRepository.decryptCashuProofs`):

```ts
import { z } from 'zod/mini';
import type { Proof } from '@cashu/cashu-ts';
import type { Encryption } from '../crypto/encryption';
import { ProofSchema, proofToY } from '../lib/cashu';
import type { AgicashDbCashuProof } from './database';
import type { CashuProof } from '../../types/account';

/**
 * Decrypt + map DB proof rows (whose `amount`/`secret` are encrypted) to domain
 * {@link CashuProof}s. The encrypted values were stored flattened as
 * `[amount0, secret0, amount1, secret1, …]`; `decrypted` is the matching decrypted
 * array (already batch-decrypted alongside the entity's `encrypted_data`).
 */
export function toDecryptedCashuProofs(
  dbProofs: AgicashDbCashuProof[],
  decrypted: unknown[],
): CashuProof[] {
  return dbProofs.map((dbProof, index) => {
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

/** A DB-ready encrypted proof row (the non-encrypted columns + the encrypted amount/secret). */
export type EncryptedProofData = {
  keysetId: string;
  amount: string;
  secret: string;
  unblindedSignature: string;
  publicKeyY: string;
  dleq: Proof['dleq'] | null;
  witness: Proof['witness'] | null;
};

/**
 * Encrypt cashu-ts proofs for storage: batch-encrypts `[amount, secret]` pairs and
 * pairs them with the plaintext columns (id/C/Y/dleq/witness). Used by the
 * `complete`/`commitProofsToSend`/`completeReceiveSwap` RPC inputs.
 */
export async function toEncryptedProofData(
  proofs: Proof[],
  encryption: Encryption,
): Promise<EncryptedProofData[]> {
  const flat = proofs.flatMap((x) => [x.amount, x.secret]);
  const encrypted = await encryption.encryptBatch(flat);
  return proofs.map((x, index) => ({
    keysetId: x.id,
    amount: encrypted[index * 2] as string,
    secret: encrypted[index * 2 + 1] as string,
    unblindedSignature: x.C,
    publicKeyY: proofToY(x),
    dleq: x.dleq ?? null,
    witness: x.witness ?? null,
  }));
}
```

> Reconcile field names (`CashuProof`/`AgicashDbCashuProof`) against `src/types/account.ts` + `src/internal/db/database.ts`. This mirrors S4's `AccountRepository.decryptCashuProofs` (read it side-by-side). `ProofSchema.shape.dleq.parse(null)` must accept `null` (verified in S4) — if not, use the schema's actual nullable shape.

- [ ] **Step 2: (Optional DRY) refactor `AccountRepository.decryptCashuProofs`** to call `toDecryptedCashuProofs`. Low-risk; skip if it complicates the diff. If done, re-run the S4 account-repository test to confirm green.

- [ ] **Step 3: Write the test** (`cashu-proofs.test.ts`) — round-trip: build a real `EncryptionService` (random secp256k1 key, S4 pattern), `toEncryptedProofData([proof], enc)` then decrypt the `[amount, secret]` and feed `toDecryptedCashuProofs(dbRows, decrypted)`; assert `amount`/`secret` survive.

```ts
import { describe, expect, it } from 'bun:test';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { EncryptionService } from '../crypto/encryption';
import { toDecryptedCashuProofs, toEncryptedProofData } from './cashu-proofs';

const priv = secp256k1.utils.randomPrivateKey();
const pubHex = bytesToHex(secp256k1.getPublicKey(priv, true));
const encryption = new EncryptionService({
  getChildMnemonic: async () => 'm',
  getPrivateKeyBytes: async () => priv,
  getPublicKeyHex: async () => pubHex,
});

describe('cashu-proofs mapping', () => {
  it('round-trips a proof through encrypt -> decrypt mapping', async () => {
    const enc = await encryption.get();
    const proof = { id: 'ks1', amount: 21, secret: 's3cret', C: 'sig' } as never;
    const encrypted = await toEncryptedProofData([proof], enc);
    expect(typeof encrypted[0]?.amount).toBe('string');

    const decrypted = await enc.decryptBatch([
      encrypted[0]!.amount,
      encrypted[0]!.secret,
    ]);
    const dbRows = [
      {
        id: 'p1',
        account_id: 'a1',
        user_id: 'u1',
        keyset_id: 'ks1',
        unblinded_signature: 'sig',
        public_key_y: 'Y',
        dleq: null,
        witness: null,
        state: 'UNSPENT',
        version: 1,
        created_at: 't',
        reserved_at: null,
      },
    ] as never;
    const mapped = toDecryptedCashuProofs(dbRows, decrypted);
    expect(mapped[0]?.amount).toBe(21);
    expect(mapped[0]?.secret).toBe('s3cret');
  });
});
```

- [ ] **Step 4: Verify + commit.** `bun run typecheck` → PASS. `bun --filter=@agicash/wallet-sdk run test` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): shared cashu-proof DB encrypt/decrypt mappers

Extract toDecryptedCashuProofs + toEncryptedProofData (mirrors S4 account-repo
proof decryption) so all four cashu repositories share one proof mapping. Tested
with a real ECIES round-trip.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `CashuCryptography`

**Files:** Create `src/internal/connections/cashu-crypto.ts` + `.test.ts`.

- [ ] **Step 1: Implement** (`src/internal/connections/cashu-crypto.ts`) — derive the cashu locking keys locally from the cashu seed (D5-4). Master's surface is `{ getSeed, getXpub(path?), getPrivateKey(path?) }` (`app/features/shared/cashu.ts`):

```ts
import { HDKey } from '@scure/bip32';
import { bytesToHex } from '@noble/hashes/utils';
import { SdkError } from '../../errors';

/** Base derivation path for cashu NUT-20 locking keys (master verbatim). */
export const BASE_CASHU_LOCKING_DERIVATION_PATH = "m/129372'/0'/0'";

/**
 * Cashu key material derived from the user's cashu BIP-39 seed. `getXpub` yields a
 * BIP-32 extended public key (for deriving NUT-20 locking public keys without the
 * private key); `getPrivateKey` yields the hex private key at a path (for unlocking
 * at mint time). The SDK derives both locally (D3/D5-4) from `getCashuSeed`.
 */
export type CashuCryptography = {
  getSeed: () => Promise<Uint8Array>;
  getXpub: (derivationPath?: string) => Promise<string>;
  getPrivateKey: (derivationPath?: string) => Promise<string>;
};

/** Build a {@link CashuCryptography} over the memoized cashu seed. */
export function getCashuCryptography(
  getCashuSeed: () => Promise<Uint8Array>,
): CashuCryptography {
  const root = async () => HDKey.fromMasterSeed(await getCashuSeed());
  return {
    getSeed: getCashuSeed,
    getXpub: async (derivationPath?: string) => {
      const hd = await root();
      return (derivationPath ? hd.derive(derivationPath) : hd).publicExtendedKey;
    },
    getPrivateKey: async (derivationPath?: string) => {
      const hd = await root();
      const child = derivationPath ? hd.derive(derivationPath) : hd;
      if (!child.privateKey) {
        throw new SdkError(
          `No private key for derivation path ${derivationPath ?? '(root)'}`,
          'no_private_key',
        );
      }
      return bytesToHex(child.privateKey);
    },
  };
}
```

> Reconcile against master: `xpubQueryOptions` does `HDKey.fromMasterSeed(seed).derive(path).publicExtendedKey`; the private key is master-fetched via OpenSecret but is BIP-32 over the same cashu seed, so the local `HDKey` private key is equivalent. Confirm the cashu-ts `wallet.ops.mintBolt11(...).privkey(x)` consumes the **hex** private key string (master passes `cryptography.getPrivateKey(...)` straight in) — if it needs `Uint8Array`, return `child.privateKey` instead.

- [ ] **Step 2: Write the test** (`cashu-crypto.test.ts`) — derive from a fixed seed; assert (a) xpub is a `xpub…`/extended key string; (b) **the public key derived from `getPrivateKey(path)` matches the public key the xpub yields at the same unhardened child** (so NUT-20 locking verifies):

```ts
import { describe, expect, it } from 'bun:test';
import { HDKey } from '@scure/bip32';
import { hexToBytes } from '@noble/hashes/utils';
import { secp256k1 } from '@noble/curves/secp256k1';
import {
  BASE_CASHU_LOCKING_DERIVATION_PATH,
  getCashuCryptography,
} from './cashu-crypto';

const seed = new Uint8Array(64).fill(7);
const crypto = getCashuCryptography(async () => seed);

describe('CashuCryptography', () => {
  it('getSeed returns the cashu seed', async () => {
    expect(await crypto.getSeed()).toBe(seed);
  });

  it('getXpub returns an extended public key at the locking base path', async () => {
    const xpub = await crypto.getXpub(BASE_CASHU_LOCKING_DERIVATION_PATH);
    expect(xpub.startsWith('xpub')).toBe(true);
  });

  it('private key at a path matches the public key the xpub derives at that path', async () => {
    const index = 4321;
    const priv = await crypto.getPrivateKey(
      `${BASE_CASHU_LOCKING_DERIVATION_PATH}/${index}`,
    );
    const pubFromPriv = secp256k1.getPublicKey(hexToBytes(priv), true);

    const baseXpub = await crypto.getXpub(BASE_CASHU_LOCKING_DERIVATION_PATH);
    const pubFromXpub = HDKey.fromExtendedKey(baseXpub).deriveChild(index).publicKey;

    expect(Buffer.from(pubFromPriv).toString('hex')).toBe(
      Buffer.from(pubFromXpub!).toString('hex'),
    );
  });
});
```

> If `getPrivateKey` returns `Uint8Array` (per Step 1's reconcile), adjust the test to skip `hexToBytes`.

- [ ] **Step 3: Verify + commit.** `bun run typecheck` → PASS. `bun --filter=@agicash/wallet-sdk run test` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): CashuCryptography (local NUT-20 locking key derivation)

Derive cashu getSeed/getXpub/getPrivateKey locally from the cashu seed via HDKey
(SDK owns key derivation - D3). Test asserts the xpub-derived public key matches
the private-key-derived public key at the same path so NUT-20 locking verifies.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `CashuSendQuoteRepository`

**Files:** Create `src/internal/repositories/cashu-send-quote-repository.ts` + `.test.ts`. **Port from** `app/features/send/cashu-send-quote-repository.ts`.

- [ ] **Step 1: Implement.** Constructor `(db: SupabaseClient<Database>, encryption: EncryptionService)`. Public methods (signatures verbatim from master, adapted to DI + 2-arg errors):

```ts
create(input: CreateSendQuote, options?: Options): Promise<CashuSendQuote>
complete(input: { quote: CashuSendQuote; paymentPreimage: string; amountSpent: Money; changeProofs: Proof[] }, options?: Options): Promise<CashuSendQuote>
expire(id: string, options?: Options): Promise<void>
fail(input: { id: string; reason: string }, options?: Options): Promise<CashuSendQuote>
markAsPending(id: string, options?: Options): Promise<CashuSendQuote>
get(id: string, options?: Options): Promise<CashuSendQuote | null>
getByTransactionId(transactionId: string, options?: Options): Promise<CashuSendQuote | null>
getUnresolved(userId: string, options?: Options): Promise<CashuSendQuote[]>
private toQuote(data: AgicashDbCashuSendQuote & { cashu_proofs: AgicashDbCashuProof[] }): Promise<CashuSendQuote>
```

Port the bodies from master applying these transforms (apply to **all** repo tasks):
- Replace `useEncryption()`/the constructor `encryption: Encryption` with `private readonly encryption: EncryptionService`; in each method that encrypts/decrypts, do `const encryption = await this.encryption.get();` first.
- Encrypt/decrypt proof rows via `toEncryptedProofData` / `toDecryptedCashuProofs` (Task 4) instead of the inline blocks.
- Hash the melt quote id via `sha256Hex` (not `computeSHA256`).
- RPC names verbatim: `create_cashu_send_quote`, `complete_cashu_send_quote`, `expire_cashu_send_quote`, `fail_cashu_send_quote`, `mark_cashu_send_quote_as_pending`. The select for `get`/`getByTransactionId`/`getUnresolved`: `.from('cashu_send_quotes').select('*, cashu_proofs!spending_cashu_send_quote_id(*)')`.
- Error handling: on `create`, `if (error.hint === 'LIMIT_REACHED') throw new DomainError(\`${error.message} ${error.details}\`, 'limit_reached'); if (status === 409) throw new DomainError('A send quote for this payment already exists', 'duplicate'); throw classify(error);`. Every other `new Error('Failed to …', { cause })` → `throw classify(error)`.
- Imports: `~/lib/cashu` → `../lib/cashu`; the DB-data schema → `../db/cashu-send-quote-db-data`; `Database`/`Agicash*` → `../db/database`; `classify` → `../classify`; `DomainError`/`ConcurrencyError` → `../../errors`; `Money` → `@agicash/money`; cashu-ts types from `@cashu/cashu-ts`; `CashuSendQuote`/`CashuProof` from `../../types/...`.
- `CreateSendQuote` (the input type) + `Options = { abortSignal?: AbortSignal }`: copy master's `CreateSendQuote` shape into this file. `toQuote` parses the decrypted `encrypted_data` via `CashuLightningSendDbDataSchema` and validates the final object via `CashuSendQuoteSchema`. **`CashuSendQuoteSchema` lives in master's model file** — port the schema into this repo file (or a small `cashu-send-quote-schema.ts`) as part of this task, since `src/types/cashu.ts` ships only the TS types, not the zod schema. Read `app/features/send/cashu-send-quote.ts` and copy `CashuSendQuoteSchema` + `DestinationDetailsSchema` (repoint `~/lib/money`→`@agicash/money`, `~/lib/cashu`→`../lib/cashu`). Confirm `z.infer<typeof CashuSendQuoteSchema>` is assignable to the contract's `CashuSendQuote` (`src/types/cashu.ts`).

> Read `app/features/send/cashu-send-quote-repository.ts` + `app/features/send/cashu-send-quote.ts` side-by-side; the method bodies + the schema are near-verbatim ports. Reconcile the exact RPC param names (`p_user_id`, `p_account_id`, `p_currency`, `p_currency_requested`, `p_expires_at`, `p_keyset_id`, `p_number_of_change_outputs`, `p_proofs_to_send`, `p_encrypted_data`, `p_quote_id_hash`, `p_payment_hash`, `p_purpose`, `p_transfer_id`) against `src/internal/db/database.types.ts` (the generated `Args` for each RPC).

- [ ] **Step 2: Write the test** (`cashu-send-quote-repository.test.ts`) — `makeFakeDb` with `rpcResult`/`selectResult`; a real `EncryptionService`; cover (a) `toQuote` decrypts an RPC-returned row into a `CashuSendQuote` (build an encrypted `encrypted_data` + encrypted proofs fixture via `enc.encryptBatch`), (b) `get` returns null on no row, (c) `create` maps `LIMIT_REACHED` hint → `DomainError`. Use the S4 account-repo test as the template for the `makeFakeDb` + encryption fixture wiring.

```ts
import { describe, expect, it } from 'bun:test';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { DomainError } from '../../errors';
import { EncryptionService } from '../crypto/encryption';
import { makeFakeDb } from '../test-support';
import { CashuSendQuoteRepository } from './cashu-send-quote-repository';

const priv = secp256k1.utils.randomPrivateKey();
const pubHex = bytesToHex(secp256k1.getPublicKey(priv, true));
const encryption = new EncryptionService({
  getChildMnemonic: async () => 'm',
  getPrivateKeyBytes: async () => priv,
  getPublicKeyHex: async () => pubHex,
});

describe('CashuSendQuoteRepository', () => {
  it('get returns null when the row is absent', async () => {
    const db = makeFakeDb({ selectResult: { data: null, error: null } });
    const repo = new CashuSendQuoteRepository(db, encryption);
    expect(await repo.get('missing')).toBeNull();
  });

  it('create maps LIMIT_REACHED to a DomainError', async () => {
    const db = makeFakeDb({
      rpcResult: {
        data: null,
        error: { hint: 'LIMIT_REACHED', message: 'limit', details: 'reached' },
      },
    });
    const repo = new CashuSendQuoteRepository(db, encryption);
    await expect(
      repo.create({ /* minimal valid CreateSendQuote fixture */ } as never),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('toQuote decrypts an RPC row into a CashuSendQuote', async () => {
    // Build encrypted_data + an encrypted proof using `await encryption.get()`,
    // feed via makeFakeDb({ rpcResult: { data: { quote: row, proofs: [...] }, error: null } }),
    // then call a method that maps it (e.g. markAsPending) and assert state/amount.
  });
});
```

> Fill the `CreateSendQuote` fixture from the input type you copied. For the decrypt case, construct `encrypted_data` via `(await encryption.get()).encrypt(dbDataFixture)` matching `CashuLightningSendDbDataSchema`.

- [ ] **Step 3: Verify + commit.** `bun run typecheck` → PASS. `bun --filter=@agicash/wallet-sdk run test` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): cashu send-quote repository

Port CashuSendQuoteRepository (create/complete/expire/fail/markAsPending/get/
getByTransactionId/getUnresolved + toQuote) over the RLS client + EncryptionService;
shared proof mappers; classify() error routing; LIMIT_REACHED/409 -> DomainError.
Ships CashuSendQuoteSchema (zod). Offline-tested with makeFakeDb.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `CashuSendSwapRepository`

**Files:** Create `src/internal/repositories/cashu-send-swap-repository.ts` + `.test.ts`. **Port from** `app/features/send/cashu-send-swap-repository.ts` + `app/features/send/cashu-send-swap.ts` (for `CashuSendSwapSchema`).

- [ ] **Step 1: Implement.** Constructor `(db, encryption: EncryptionService)`. Methods:

```ts
create(input: CreateSendSwap, options?: Options): Promise<CashuSendSwap>
commitProofsToSend(input: { swap: CashuSendSwap; tokenHash: string; proofsToSend: Proof[]; changeProofs: Proof[] }): Promise<void>
complete(swapId: string): Promise<void>
fail(input: { swapId: string; reason: string }): Promise<void>
getUnresolved(userId: string, options?: Options): Promise<CashuSendSwap[]>
get(id: string, options?: Options): Promise<CashuSendSwap | null>
getByTransactionId(transactionId: string, options?: Options): Promise<CashuSendSwap | null>
private toSwap(data: AgicashDbCashuSendSwap & { cashu_proofs: AgicashDbCashuProof[] }): Promise<CashuSendSwap>
```

Apply the same transforms as Task 6. RPC names verbatim: `create_cashu_send_swap`, `commit_proofs_to_send`, `complete_cashu_send_swap`, `fail_cashu_send_swap`. Select join: `cashu_proofs!spending_cashu_send_swap_id(*)`. `create` error: `if (error.hint === 'CONCURRENCY_ERROR') throw new ConcurrencyError(error.message, error.details ?? 'concurrency'); throw classify(error)`. Port `CashuSendSwapSchema` (+ `PendingCashuSendSwap`) from `app/features/send/cashu-send-swap.ts` into this file — **note its `createdAt: z.date()`** (a `Date`, not ISO string). `toSwap` separates input-proofs vs proofs-to-send by `cashu_send_swap_id`/`requires_input_proofs_swap`, decrypts via the shared mapper, and parses via `CashuSendSwapSchema`.

> Read both master files side-by-side; bodies + schema are near-verbatim. Reconcile the `create_cashu_send_swap` / `commit_proofs_to_send` RPC `Args` against `database.types.ts` (`p_user_id`, `p_account_id`, `p_input_proofs`, `p_currency`, `p_encrypted_data`, `p_requires_input_proofs_swap`, `p_token_hash`, `p_keyset_id`, `p_number_of_outputs`; commit: `p_swap_id`, `p_proofs_to_send`, `p_change_proofs`, `p_token_hash`).

- [ ] **Step 2: Write the test** (`cashu-send-swap-repository.test.ts`) — `makeFakeDb`; cover `get` → null; `create` → `CONCURRENCY_ERROR` hint → `ConcurrencyError`; `toSwap` round-trip for a PENDING swap (encrypted `encrypted_data` + encrypted proofsToSend). Mirror Task 6's test wiring.

- [ ] **Step 3: Verify + commit.** `bun run typecheck` → PASS. `bun --filter=@agicash/wallet-sdk run test` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): cashu send-swap repository

Port CashuSendSwapRepository (create/commitProofsToSend/complete/fail/get*/toSwap)
+ CashuSendSwapSchema (createdAt is a Date). Shared proof mappers; CONCURRENCY_ERROR
hint -> ConcurrencyError. Offline-tested with makeFakeDb.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `CashuReceiveQuoteRepository`

**Files:** Create `src/internal/repositories/cashu-receive-quote-repository.ts` + `.test.ts`. **Port from** `app/features/receive/cashu-receive-quote-repository.ts` + `app/features/receive/cashu-receive-quote.ts` (for `CashuReceiveQuoteSchema`).

- [ ] **Step 1: Implement.** Constructor `(db, encryption: EncryptionService, accountRepository: AccountRepository)` (the `processPayment`/`completeReceive` RPCs return an account row that maps via `accountRepository.toAccount`). Methods:

```ts
create(params: CreateQuote, options?: Options): Promise<CashuReceiveQuote>
expire(id: string, options?: Options): Promise<void>
fail(input: { id: string; reason: string }, options?: Options): Promise<void>
markMeltInitiated(quote: CashuReceiveQuote & { type: 'CASHU_TOKEN' }, options?: Options): Promise<CashuReceiveQuote & { type: 'CASHU_TOKEN' }>
processPayment(input: { quote: CashuReceiveQuote; keysetId: string; outputAmounts: number[] }, options?: Options): Promise<{ quote: CashuReceiveQuote; account: CashuAccount }>
completeReceive(input: { quoteId: string; proofs: Proof[] }, options?: Options): Promise<{ quote: CashuReceiveQuote; account: CashuAccount; addedProofs: string[] }>
get(id: string, options?: Options): Promise<CashuReceiveQuote | null>
getByTransactionId(transactionId: string, options?: Options): Promise<CashuReceiveQuote | null>
getPending(userId: string, options?: Options): Promise<CashuReceiveQuote[]>
private toQuote(data: AgicashDbCashuReceiveQuote): Promise<CashuReceiveQuote>
```

Apply Task 6's transforms. RPC names verbatim: `create_cashu_receive_quote`, `expire_cashu_receive_quote`, `fail_cashu_receive_quote`, `mark_cashu_receive_quote_cashu_token_melt_initiated`, `process_cashu_receive_quote_payment`, `complete_cashu_receive_quote`. Encrypt the DB data via `CashuLightningReceiveDbDataSchema` (Task 3); hash quote id via `sha256Hex`; encrypt proofs via `toEncryptedProofData`. Port `CashuReceiveQuoteSchema` from `app/features/receive/cashu-receive-quote.ts` into this file. `toQuote` decrypts `encrypted_data`, conditionally builds `tokenReceiveData` (CASHU_TOKEN), and validates via `CashuReceiveQuoteSchema`. `CreateQuote` = master's `RepositoryCreateQuoteParams` (copy it; it lives in `cashu-receive-quote-core.ts` — Task 12 ships the core, so import it from there OR copy the type here and have the core re-export; prefer importing `RepositoryCreateQuoteParams` from `../../domains/cashu/cashu-receive-quote-core` once Task 12 lands — for Task 8 ordering, define a local `CreateQuote` type matching it and reconcile in Task 13).

> Read both master files side-by-side. Reconcile RPC `Args` against `database.types.ts`. The account-row mapping: `accountRepository.toAccount(data.account)` (S4) returns a live `CashuAccount`.

- [ ] **Step 2: Write the test** (`cashu-receive-quote-repository.test.ts`) — `makeFakeDb` + real `EncryptionService` + a fake `AccountRepository` (`{ toAccount: async () => cashuAccountFixture }`); cover `get` → null; `toQuote` decrypts a LIGHTNING quote row; `create` persists + maps. Fake the `AccountRepository` as `{ toAccount: async () => ({ type: 'cashu', id: 'a1' } as never) } as never`.

- [ ] **Step 3: Verify + commit.** `bun run typecheck` → PASS. `bun --filter=@agicash/wallet-sdk run test` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): cashu receive-quote repository

Port CashuReceiveQuoteRepository (create/expire/fail/markMeltInitiated/
processPayment/completeReceive/get*/toQuote) + CashuReceiveQuoteSchema over the RLS
client + EncryptionService + AccountRepository. Offline-tested with makeFakeDb.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `CashuReceiveSwapRepository`

**Files:** Create `src/internal/repositories/cashu-receive-swap-repository.ts` + `.test.ts`. **Port from** `app/features/receive/cashu-receive-swap-repository.ts` + `app/features/receive/cashu-receive-swap.ts` (for `CashuReceiveSwapSchema`).

- [ ] **Step 1: Implement.** Constructor `(db, encryption: EncryptionService, accountRepository: AccountRepository)`. Methods:

```ts
create(input: { token: Token; userId: string; accountId: string; keysetId: string; inputAmount: Money; cashuReceiveFee: Money; receiveAmount: Money; outputAmounts: number[]; reversedTransactionId?: string }, options?: Options): Promise<{ swap: CashuReceiveSwap; account: CashuAccount }>
completeReceiveSwap(input: { tokenHash: string; userId: string; proofs: Proof[] }, options?: Options): Promise<{ swap: CashuReceiveSwap; account: CashuAccount; addedProofs: string[] }>
fail(input: { tokenHash: string; userId: string; reason: string }, options?: Options): Promise<CashuReceiveSwap>
getByTransactionId(transactionId: string, options?: Options): Promise<CashuReceiveSwap | null>
getPending(userId: string, options?: Options): Promise<CashuReceiveSwap[]>
private toReceiveSwap(data: AgicashDbCashuReceiveSwap): Promise<CashuReceiveSwap>
```

Apply Task 6's transforms. RPC names verbatim: `create_cashu_receive_swap`, `complete_cashu_receive_swap`, `fail_cashu_receive_swap`. `create` computes `tokenHash = await getTokenHash(token)` and on `error.code === '23505'` throws `new DomainError('This token has already been claimed', 'token_already_claimed')`. The DB data schema is `CashuSwapReceiveDbDataSchema` (Task 3); port `CashuReceiveSwapSchema` from `cashu-receive-swap.ts`. `create`/`completeReceiveSwap` return `{ swap, account }` via `Promise.all([toReceiveSwap(...), accountRepository.toAccount(...)])`.

> Reconcile RPC `Args` (`p_token_hash`, `p_account_id`, `p_user_id`, `p_currency`, `p_keyset_id`, `p_number_of_outputs`, `p_encrypted_data`, `p_reversed_transaction_id`; complete: `p_token_hash`, `p_user_id`, `p_proofs`) against `database.types.ts`.

- [ ] **Step 2: Write the test** (`cashu-receive-swap-repository.test.ts`) — `makeFakeDb` + real `EncryptionService` + fake `AccountRepository`; cover `create` → `23505` → `DomainError('… already been claimed')`; `toReceiveSwap` decrypts a PENDING swap row. Use a real `Token` fixture (a `cashuB…` string decoded, or a minimal `{ mint, unit, proofs }` object) so `getTokenHash` runs.

- [ ] **Step 3: Verify + commit.** `bun run typecheck` → PASS. `bun --filter=@agicash/wallet-sdk run test` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): cashu receive-swap repository

Port CashuReceiveSwapRepository (create/completeReceiveSwap/fail/getPending/
getByTransactionId/toReceiveSwap) + CashuReceiveSwapSchema over the RLS client +
EncryptionService + AccountRepository; 23505 -> "already claimed" DomainError.
Offline-tested with makeFakeDb.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: `CashuSendQuoteService`

**Files:** Create `src/domains/cashu/cashu-send-quote-service.ts` + `.test.ts`. **Port from** `app/features/send/cashu-send-quote-service.ts`.

- [ ] **Step 1: Implement.** Constructor `(cashuSendRepository: CashuSendQuoteRepository)`. Drop `useCashuSendQuoteService`. Methods (signatures verbatim from master):

```ts
getLightningQuote(options: GetCashuLightningQuoteOptions): Promise<CashuLightningQuote>
createSendQuote(options: { userId: string; account: CashuAccount; sendQuote: SendQuoteRequest; destinationDetails?: DestinationDetails; transferId?: string }): Promise<CashuSendQuote>
initiateSend(account: CashuAccount, sendQuote: CashuSendQuote, meltQuote: Pick<MeltQuoteBolt11Response, 'quote' | 'amount'>): Promise<MeltProofsResponse>
markSendQuoteAsPending(quote: CashuSendQuote): Promise<CashuSendQuote>
completeSendQuote(account: CashuAccount, sendQuote: CashuSendQuote, meltQuote: MeltQuoteBolt11Response): Promise<CashuSendQuote>
failSendQuote(account: CashuAccount, quote: CashuSendQuote, reason: string): Promise<CashuSendQuote>
expireSendQuote(quote: CashuSendQuote): Promise<void>
private selectProofs(account: CashuAccount, amount: number): { proofs: CashuProof[]; fee: number }
```

Apply these transforms (apply to **all** service tasks):
- Drop the `use*` hook + any `queryClient`/react import. Plain class.
- `account.wallet` is the live `ExtendedCashuWallet` (S4) — call `account.wallet.*` directly. `toProof`/`sumProofs`/`getCashuUnit` from `../../internal/lib/cashu`; `matchBlindSignaturesToOutputData` from there too.
- `OutputData`, `MeltQuoteState`, `MintOperationError`, `MeltQuoteBolt11Response`, `MeltProofsResponse` from `@cashu/cashu-ts`.
- Every user-facing `new DomainError(msg)` → `new DomainError(msg, code)` (D5-6): `'invalid_invoice'` (invalid/expired invoice), `'insufficient_balance'`, `'expired'` (quote expired). Internal invariant `throw new Error(...)` (account/quote mismatch, state guards) → `new DomainError(msg, 'invalid_state'|'account_mismatch'|'quote_mismatch')` (these are programmer/precondition errors but should still carry a code; keep them `DomainError` so callers never retry).
- `GetCashuLightningQuoteOptions`/`CashuLightningQuote`/`SendQuoteRequest`: copy these types from master into this file (or a sibling `cashu-send-quote-types.ts`). **Note:** master's `getLightningQuote` takes an `exchangeRate` for amountless invoices and currently throws on amountless cashu invoices — preserve that behavior verbatim (the ln-address resolution + amount handling lands fully when `createLightningQuote` is assembled in the domain, Task 17; the service method mirrors master).

> Read `app/features/send/cashu-send-quote-service.ts` end-to-end; the bodies are near-verbatim. Reconcile `wallet.createMeltQuoteBolt11`/`selectProofsToSend`/`getFeesForProofs`/`meltProofsIdempotent`/`checkMeltQuoteBolt11`/`keyChain.ensureKeysetKeys`/`getKeyset` + `OutputData.createDeterministicData` + `matchBlindSignaturesToOutputData` against cashu-ts + the master file.

- [ ] **Step 2: Write the test** (`cashu-send-quote-service.test.ts`) — inject a fake `CashuSendQuoteRepository` + a fake `CashuAccount` whose `wallet` is a hand-rolled fake (the methods each call). Cover the **offline-classifiable** methods with fakes:
  - `markSendQuoteAsPending`: PENDING input → returned as-is (idempotent); UNPAID → calls `repo.markAsPending`.
  - `expireSendQuote`: throws `DomainError` when not UNPAID / not yet expired; calls `repo.expire` when valid.
  - `failSendQuote`: with a fake `wallet.checkMeltQuoteBolt11` returning UNPAID → calls `repo.fail`; returning PAID → throws `DomainError`.
  - `selectProofs` (via a thin public probe or by testing `createSendQuote`'s balance path): fake `wallet.selectProofsToSend`/`getFeesForProofs`, assert proof mapping + the insufficient-balance `DomainError`.
  - `initiateSend`: validates account/quote/state, calls `wallet.meltProofsIdempotent` (fake returns a `MeltProofsResponse`); assert it returns it.
  - `completeSendQuote`: fake `wallet.keyChain.ensureKeysetKeys`/`getKeyset` + a `meltQuote` with `state: PAID` and empty `change` (numberOfChangeOutputs 0) → asserts `repo.complete` called with `amountSpent`/`paymentPreimage`.

```ts
import { describe, expect, it } from 'bun:test';
import { DomainError } from '../../errors';
import { CashuSendQuoteService } from './cashu-send-quote-service';
import type { CashuSendQuoteRepository } from '../../internal/repositories/cashu-send-quote-repository';

const repo = (over: Partial<CashuSendQuoteRepository> = {}): CashuSendQuoteRepository =>
  ({
    markAsPending: async (id: string) => ({ id, state: 'PENDING' }) as never,
    expire: async () => {},
    fail: async ({ id }: { id: string }) => ({ id, state: 'FAILED' }) as never,
    complete: async ({ quote }: { quote: { id: string } }) =>
      ({ id: quote.id, state: 'PAID' }) as never,
    ...over,
  }) as unknown as CashuSendQuoteRepository;

describe('CashuSendQuoteService', () => {
  it('markSendQuoteAsPending returns a PENDING quote as-is', async () => {
    const svc = new CashuSendQuoteService(repo());
    const pending = { id: 'q1', state: 'PENDING' } as never;
    expect(await svc.markSendQuoteAsPending(pending)).toBe(pending);
  });

  it('expireSendQuote throws DomainError when not unpaid', async () => {
    const svc = new CashuSendQuoteService(repo());
    await expect(
      svc.expireSendQuote({ id: 'q', state: 'PAID' } as never),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('failSendQuote rejects when the mint reports the melt is already PAID', async () => {
    const svc = new CashuSendQuoteService(repo());
    const account = {
      id: 'a1',
      wallet: { checkMeltQuoteBolt11: async () => ({ state: 'PAID' }) },
    } as never;
    await expect(
      svc.failSendQuote(account, { accountId: 'a1', state: 'UNPAID', quoteId: 'mq' } as never, 'x'),
    ).rejects.toBeInstanceOf(DomainError);
  });

  // + initiateSend / completeSendQuote / selectProofs cases with fuller fake wallets
});
```

> Build the fake wallet methods to match the exact cashu-ts return shapes the service reads (e.g. `selectProofsToSend` → `{ send: Proof[] }`; `meltProofsIdempotent` → a `MeltProofsResponse`). Keep `MeltQuoteState`/`MintOperationError` real (imported) where the service compares against them.

- [ ] **Step 3: Verify + commit.** `bun run typecheck` → PASS. `bun --filter=@agicash/wallet-sdk run test` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): cashu send-quote service

Port CashuSendQuoteService (getLightningQuote/createSendQuote/initiateSend/
markSendQuoteAsPending/completeSendQuote/failSendQuote/expireSendQuote/selectProofs)
with DI'd repo; 2-arg DomainError codes. Offline-tested with a fake wallet + repo.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: `CashuSendSwapService`

**Files:** Create `src/domains/cashu/cashu-send-swap-service.ts` + `.test.ts`. **Port from** `app/features/send/cashu-send-swap-service.ts`.

- [ ] **Step 1: Implement.** Constructor `(cashuSendSwapRepository: CashuSendSwapRepository, cashuReceiveSwapService: CashuReceiveSwapService)` (the second is for `reverse`). Methods (verbatim from master):

```ts
getQuote(input: { account: CashuAccount; amount: Money; senderPaysFee: boolean }): Promise<CashuSwapQuote>
create(input: { userId: string; account: CashuAccount; amount: Money; senderPaysFee: boolean }): Promise<CashuSendSwap>
swapForProofsToSend(input: { account: CashuAccount; swap: CashuSendSwap }): Promise<void>
complete(swap: CashuSendSwap): Promise<void>
fail(swap: CashuSendSwap, reason: string): Promise<void>
reverse(swap: CashuSendSwap, account: CashuAccount): Promise<void>
private prepareProofsAndFee(wallet: ExtendedCashuWallet, accountProofs: CashuProof[], requestedAmount: Money, includeFeesInSendAmount: boolean): Promise<{ keep: CashuProof[]; send: CashuProof[]; cashuSendFee: number; cashuReceiveFee: number }>
private swapProofs(wallet: ExtendedCashuWallet, swap: CashuSendSwap, outputData: { keep: OutputData[]; send: OutputData[] }): Promise<{ send: Proof[]; keep: Proof[] }>
```

Apply Task 10's transforms. `CashuSwapQuote` type: copy from master. `reverse` calls `this.cashuReceiveSwapService.create({ userId, token: { mint: account.mintUrl, proofs: swap.proofsToSend.map(toProof), unit: getCashuProtocolUnit(account.currency) }, account, reversedTransactionId: swap.transactionId })`. The `prepareProofsAndFee` insufficient-balance throw → `new DomainError('Insufficient balance. …', 'insufficient_balance')`. `swapProofs` error recovery (`OUTPUT_ALREADY_SIGNED`/`TOKEN_ALREADY_SPENT` → `wallet.restore(...)` + filter by secret) — port verbatim.

> Read the master file. Reconcile `wallet.ops.send(...).keyset(...).asCustom(...).keepAsCustom(...).run()`, `wallet.getFeesEstimateToReceiveAtLeast`, `wallet.restore`, `OutputData.createDeterministicData`, `splitAmount` against cashu-ts.

- [ ] **Step 2: Write the test** (`cashu-send-swap-service.test.ts`) — fake repo + fake receive-swap service + fake `CashuAccount.wallet`:
  - `getQuote`: fake `wallet.selectProofsToSend`/`getFeesForProofs` (exact-proofs path) → assert fee fields.
  - `create`: exact-proofs → asserts a PENDING swap created (repo.create called with `tokenHash` set, no `outputAmounts`); inexact → DRAFT (repo.create called with `keysetId`+`outputAmounts`).
  - `complete`/`fail`: state-guarded persist (idempotent no-op when already terminal; throw `DomainError` on wrong state).
  - `reverse`: PENDING swap → calls `cashuReceiveSwapService.create` with `reversedTransactionId`; non-PENDING → `DomainError`.

```ts
it('reverse creates a reversing receive-swap tagged with the transaction id', async () => {
  const created: unknown[] = [];
  const receiveSwap = { create: async (p: unknown) => { created.push(p); return { swap: {}, account: {} }; } } as never;
  const svc = new CashuSendSwapService({} as never, receiveSwap);
  const account = { id: 'a1', mintUrl: 'https://m', currency: 'BTC' } as never;
  await svc.reverse(
    { state: 'PENDING', accountId: 'a1', transactionId: 'tx1', proofsToSend: [] } as never,
    account,
  );
  expect((created[0] as { reversedTransactionId: string }).reversedTransactionId).toBe('tx1');
});
```

- [ ] **Step 3: Verify + commit.** `bun run typecheck` → PASS. `bun --filter=@agicash/wallet-sdk run test` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): cashu send-swap service (incl. reverse)

Port CashuSendSwapService (getQuote/create/swapForProofsToSend/complete/fail/reverse
+ prepareProofsAndFee/swapProofs) with DI'd repo + receive-swap service. reverse
creates a reversing receive-swap tagged reversedTransactionId. Offline-tested.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: `cashu-receive-quote-core`

**Files:** Create `src/domains/cashu/cashu-receive-quote-core.ts` + `.test.ts`. **Port from** `app/features/receive/cashu-receive-quote-core.ts`.

- [ ] **Step 1: Implement.** Pure functions + types (no class). Port verbatim, repointing imports:

```ts
deriveNut20LockingPublicKey(xPub: string): { lockingPublicKey: string; fullLockingDerivationPath: string }
getLightningQuote(params: GetLightningQuoteParams): Promise<CashuReceiveLightningQuote>
computeQuoteExpiry(params: CreateQuoteBaseParams): string
computeTotalFee(params: CreateQuoteBaseParams): Money
// + types: CashuReceiveLightningQuote, GetLightningQuoteParams, CreateQuoteBaseParams, RepositoryCreateQuoteParams
```

`deriveNut20LockingPublicKey` derives a random unhardened index ∈ [0, HARDENED_OFFSET) and the locking public key from `xPub` via `HDKey.fromExtendedKey(xPub).deriveChild(index).publicKey` → hex; full path = `${BASE_CASHU_LOCKING_DERIVATION_PATH}/${index}`. `getLightningQuote` calls `wallet.createLockedMintQuote(amount.toNumber(unit), lockingPublicKey, description)` and decodes the bolt11 payment hash. Import `BASE_CASHU_LOCKING_DERIVATION_PATH` from `../../internal/connections/cashu-crypto`. Replace master's `getRandomBytes`/index source with the SDK's available RNG (`@noble/hashes/utils#randomBytes` — verify the import) — **note:** randomness is fine in a runtime fn (this is not a workflow script).

> Reconcile `wallet.createLockedMintQuote` + the random-index derivation + `derivePublicKey` against cashu-ts + master. `RepositoryCreateQuoteParams` is consumed by Task 8's repo `create` — export it here and have Task 13/8 import it (reconcile the Task-8 local `CreateQuote` to `= RepositoryCreateQuoteParams`).

- [ ] **Step 2: Write the test** (`cashu-receive-quote-core.test.ts`) — `deriveNut20LockingPublicKey(<a fixed xpub>)` returns a 66-char hex pubkey + a `m/129372'/0'/0'/<index>` path; `computeTotalFee` (LIGHTNING → `mintingFee ?? zero`; CASHU_TOKEN → sum); `computeQuoteExpiry` (LIGHTNING vs the `min` for CASHU_TOKEN). Build the xpub via `getCashuCryptography(async () => seed).getXpub(BASE_CASHU_LOCKING_DERIVATION_PATH)`.

- [ ] **Step 3: Verify + commit.** `bun run typecheck` → PASS. `bun --filter=@agicash/wallet-sdk run test` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): cashu receive-quote core (NUT-20 locking + quote helpers)

Port deriveNut20LockingPublicKey/getLightningQuote/computeQuoteExpiry/computeTotalFee
+ the create-quote param types. Locking pubkey derived from the cashu xpub. Tested.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: `CashuReceiveQuoteService`

**Files:** Create `src/domains/cashu/cashu-receive-quote-service.ts` + `.test.ts`. **Port from** `app/features/receive/cashu-receive-quote-service.ts`.

- [ ] **Step 1: Implement.** Constructor `(cryptography: CashuCryptography, cashuReceiveQuoteRepository: CashuReceiveQuoteRepository)`. Methods (verbatim):

```ts
getLightningQuote(params: Omit<GetLightningQuoteParams, 'xPub'>): Promise<CashuReceiveLightningQuote>
createReceiveQuote(params: CreateQuoteBaseParams): Promise<CashuReceiveQuote>
markMeltInitiated(quote: CashuReceiveQuote & { type: 'CASHU_TOKEN' }): Promise<CashuReceiveQuote & { type: 'CASHU_TOKEN' }>
expire(quote: CashuReceiveQuote): Promise<void>
fail(quote: CashuReceiveQuote, reason: string): Promise<void>
completeReceive(account: CashuAccount, quote: CashuReceiveQuote): Promise<{ quote: CashuReceiveQuote; account: CashuAccount; addedProofs: string[] }>
private processUnpaidQuote(wallet, quote): Promise<{ quote; account; addedProofs }>
private processPaidQuote(wallet, quote): Promise<{ quote; account; addedProofs }>
private mintProofs(wallet, quote, outputData): Promise<Proof[]>
```

Apply transforms. `getLightningQuote` reads `cryptography.getXpub(BASE_CASHU_LOCKING_DERIVATION_PATH)` then calls core. `mintProofs` reads `cryptography.getPrivateKey(quote.lockingDerivationPath)` (unlocking key) + derives the locking pubkey from the xpub at the path's index; calls `wallet.ops.mintBolt11(...).keyset(...).privkey(...).asCustom(...).run()` with `OUTPUT_ALREADY_SIGNED`/`QUOTE_ALREADY_ISSUED` → `wallet.restore` recovery. State guards (`new Error(...)`) → `new DomainError(msg, 'invalid_state')`.

> Read the master file end-to-end. Reconcile `wallet.ops.mintBolt11`, `.privkey`, `OutputData.createDeterministicData`, `derivePublicKey(xPub, 'm/${index}')` against cashu-ts + master.

- [ ] **Step 2: Write the test** (`cashu-receive-quote-service.test.ts`) — inject a fake repo + a fake `CashuCryptography` (`getXpub`/`getPrivateKey`/`getSeed` returning fixtures) + a fake `wallet`:
  - `expire`/`fail`/`markMeltInitiated`: state-guarded persist (idempotent no-op + `DomainError` on wrong state + `repo.*` called when valid).
  - `createReceiveQuote`: a LIGHTNING `lightningQuote` (mintQuote `state: UNPAID`) → `repo.create` called with `receiveType: 'LIGHTNING'`.
  - `completeReceive`: a PAID quote + fake `wallet` (`keyChain.ensureKeysetKeys`, `getKeyset`, `ops.mintBolt11(...).keyset().privkey().asCustom().run()` → proofs) → `repo.completeReceive` called; assert `addedProofs` propagates.

- [ ] **Step 3: Verify + commit.** `bun run typecheck` → PASS. `bun --filter=@agicash/wallet-sdk run test` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): cashu receive-quote service

Port CashuReceiveQuoteService (getLightningQuote/createReceiveQuote/markMeltInitiated/
expire/fail/completeReceive + processUnpaid/processPaid/mintProofs) with DI'd
CashuCryptography + repo. Offline-tested with fake wallet + crypto.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: `CashuReceiveSwapService`

**Files:** Create `src/domains/cashu/cashu-receive-swap-service.ts` + `.test.ts`. **Port from** `app/features/receive/cashu-receive-swap-service.ts`.

- [ ] **Step 1: Implement.** Constructor `(receiveSwapRepository: CashuReceiveSwapRepository)`. Methods (verbatim):

```ts
create(input: { userId: string; token: Token; account: CashuAccount; reversedTransactionId?: string }): Promise<{ swap: CashuReceiveSwap; account: CashuAccount }>
fail(swap: CashuReceiveSwap, reason: string): Promise<CashuReceiveSwap>
completeSwap(account: CashuAccount, receiveSwap: CashuReceiveSwap): Promise<{ swap: CashuReceiveSwap; account: CashuAccount; addedProofs: string[] }>
private swapProofs(wallet, receiveSwap, outputData): Promise<Proof[]>
```

Apply transforms. `create` guards `areMintUrlsEqual(account.mintUrl, token.mint)` + currency match (→ `new DomainError(msg, 'mint_mismatch'|'currency_mismatch')`), computes fee/amount via `wallet.getFeesForProofs` + `sumProofs`, `splitAmount`, then `repo.create`. `completeSwap` runs `wallet.ops.receive({mint, proofs: receiveSwap.tokenProofs, unit}).asCustom(outputData).run()` with the `OUTPUT_ALREADY_SIGNED`/`TOKEN_ALREADY_SPENT` recovery (`wallet.restore`; on `TOKEN_ALREADY_SPENT` + empty restore → throw `DomainError('Token already claimed', 'token_already_claimed')` → caught → `this.fail(...)`). `tokenToMoney` from `../../internal/lib/cashu`.

> Reconcile `wallet.ops.receive`, `wallet.restore`, `OutputData.createDeterministicData`, `splitAmount` against cashu-ts + master.

- [ ] **Step 2: Write the test** (`cashu-receive-swap-service.test.ts`) — fake repo + fake `CashuAccount.wallet`:
  - `create`: mint mismatch → `DomainError`; happy path (fake `getFeesForProofs`/`getKeyset`/`splitAmount`) → `repo.create` called.
  - `fail`: idempotent no-op when FAILED; `DomainError` when not PENDING; `repo.fail` when valid.
  - `completeSwap`: fake `wallet.ops.receive(...).asCustom(...).run()` → proofs → `repo.completeReceiveSwap` called; idempotent no-op when COMPLETED.

- [ ] **Step 3: Verify + commit.** `bun run typecheck` → PASS. `bun --filter=@agicash/wallet-sdk run test` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): cashu receive-swap service (same-mint claim)

Port CashuReceiveSwapService (create/fail/completeSwap + swapProofs recovery) with
DI'd repo. The same-mint token-claim primitive; cross-account melt-then-mint is S7.
Offline-tested with a fake wallet.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: token models + `ReceiveCashuTokenService`

**Files:** Create `src/domains/cashu/receive-cashu-token-models.ts`, `src/domains/cashu/receive-cashu-token-service.ts` + `.test.ts`. **Port from** `app/features/receive/receive-cashu-token-models.ts` + `receive-cashu-token-service.ts`.

- [ ] **Step 1: Models** (`receive-cashu-token-models.ts`) — port `TokenFlags`, `CashuAccountWithTokenFlags`, `ReceiveCashuTokenAccount`, `isClaimingToSameCashuAccount`. Repoint imports (`ExtendedAccount`/`ExtendedCashuAccount` from `../../types/account`; `areMintUrlsEqual` from `../../internal/lib/cashu`).

- [ ] **Step 2: Service** (`receive-cashu-token-service.ts`). Master's constructor takes `queryClient`; the SDK version takes what `buildAccountForMint` needs to initialize a wallet for an arbitrary (possibly unowned) mint + validate it. Constructor:

```ts
constructor(
  private readonly cashuWallets: CashuWalletService,
  private readonly mintAuth: MintAuthTokenProvider,
  private readonly getCashuSeed: () => Promise<Uint8Array>,
  private readonly cashuMintValidator: ReturnType<typeof buildMintValidator>,
) {}
```

Methods (verbatim logic, DI'd):

```ts
buildAccountForMint(mintUrl: string, currency: Currency): Promise<CashuAccountWithTokenFlags>
getSourceAndDestinationAccounts(token: Token, accounts?: ExtendedAccount[]): Promise<{ sourceAccount: CashuAccountWithTokenFlags; possibleDestinationAccounts: ReceiveCashuTokenAccount[] }>
static getDefaultReceiveAccount(sourceAccount, possibleDestinationAccounts, preferredReceiveAccountId?): ReceiveCashuTokenAccount | null
private augmentNonSourceAccountsWithTokenFlags(accounts): ...
private getPossibleDestinationAccounts(sourceAccount, otherAccounts): ...
```

`buildAccountForMint` mirrors master but replaces `getInitializedCashuWallet({ queryClient, mintUrl, currency })` with `this.cashuWallets.getInitialized(mintUrl, currency, await this.getCashuSeed(), getMintAuthProvider(purpose, this.mintAuth))` (the S4 `CashuWalletService`), and calls `this.cashuMintValidator(mintUrl, unit, mintInfo, keysets)` for the `canReceive` decision. Use `canReceiveFromLightning`/`canSendToLightning` (S4 `account-utils`), `checkIsTestMint`, `getKeysetExpiry`, `getMintPurpose` from the lib. `getMintAuthProvider` from `../../internal/connections/mint-auth`.

> Read master end-to-end. Reconcile the `cashuMintValidator` call signature against the vendored `mint-validation.ts#buildMintValidator` return type, and `getInitialized`'s `InitializedCashuWallet` shape (`{ wallet, isOnline }`) against S4.

- [ ] **Step 3: Write the test** (`receive-cashu-token-service.test.ts`) — `isClaimingToSameCashuAccount` (pure: same mint+currency → true; different → false) + `getDefaultReceiveAccount` (static, pure: test-mint source returns source-if-canReceive; preferred id selection; default fallback). For `buildAccountForMint`, inject a fake `CashuWalletService` returning `{ wallet: fakeWallet, isOnline: true }` + a fake validator returning `true`/`false` → assert `canReceive` flips. Keep the wallet-init cases light (the validator + flags are the unit under test).

- [ ] **Step 4: Verify + commit.** `bun run typecheck` → PASS. `bun --filter=@agicash/wallet-sdk run test` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): cashu token-receive models + ReceiveCashuTokenService

Port TokenFlags/isClaimingToSameCashuAccount + ReceiveCashuTokenService
(buildAccountForMint/getSourceAndDestinationAccounts/getDefaultReceiveAccount) with
DI'd CashuWalletService + cashuMintValidator. Source/dest selection for token claim;
the cross-account orchestration + public receiveToken are S7. Offline-tested.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Connections — `cashuCrypto` + `cashuMintValidator`

**Files:** Modify `src/internal/connections/index.ts` + `src/internal/connections/index.test.ts` (if present).

- [ ] **Step 1: Extend `SdkConnections`** — add:

```ts
  cashuCrypto: CashuCryptography;
  cashuMintValidator: ReturnType<typeof buildMintValidator>;
```

- [ ] **Step 2: Build them in `buildConnections`** (after `getCashuSeed`):

```ts
import { getCashuCryptography } from './cashu-crypto';
import { buildMintValidator } from '../lib/cashu/mint-validation';
// ...
  const cashuCrypto = getCashuCryptography(getCashuSeed);
  const cashuMintValidator = buildMintValidator({
    requiredNuts: [4, 5, 7, 8, 9, 10, 11, 12, 17, 20] as const,
    requiredWebSocketCommands: ['bolt11_melt_quote', 'proof_state'] as const,
    blocklist: config.cashuMintBlocklist ?? [],
  });
```

Add `cashuCrypto` + `cashuMintValidator` to the returned bundle.

> Confirm the `requiredNuts`/`requiredWebSocketCommands` tuple matches master's `cashuMintValidator` (`app/features/shared/cashu.ts:171`) and `buildMintValidator`'s param shape (`MintBlocklistSchema` is `string[]`). `mint-validation.ts` is already vendored.

- [ ] **Step 3: Verify + commit.** `bun run typecheck` → PASS. `bun --filter=@agicash/wallet-sdk run test` → PASS (no consumer yet beyond the type extension).

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): wire cashuCrypto + cashuMintValidator into connections

Add CashuCryptography (local cashu key derivation) and the cashuMintValidator
instance (required NUTs + blocklist from config) to SdkConnections/buildConnections.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: `createCashuDomain` (partial domain)

**Files:** Create `src/domains/cashu/cashu-domain.ts` + `.test.ts`.

- [ ] **Step 1: Implement.** Compose the repos + services into the `CashuDomain`; the create/read/fail/reverse methods are real, `executeQuote` + `receiveToken` throw `NotImplementedError`. `createCashuDomain` receives the shared `ctx` + the pre-built `accountRepository` (so the receive repos share the S4 `toAccount`):

```ts
import type { CashuDomain } from '../../domains';
import { NotImplementedError, SdkError } from '../../errors';
import type { CashuAccount } from '../../types/account';
import type { CashuSendQuote, CashuSendSwap } from '../../types/cashu';
import { getCurrentUserId } from '../../internal/connections/open-secret';
import { getCashuProtocolUnit, tokenToMoney } from '../../internal/lib/cashu';
import { getDecodedToken } from '@cashu/cashu-ts';
import type { AccountRepository } from '../../internal/repositories/account-repository';
import { CashuSendQuoteRepository } from '../../internal/repositories/cashu-send-quote-repository';
import { CashuSendSwapRepository } from '../../internal/repositories/cashu-send-swap-repository';
import { CashuReceiveQuoteRepository } from '../../internal/repositories/cashu-receive-quote-repository';
import { CashuReceiveSwapRepository } from '../../internal/repositories/cashu-receive-swap-repository';
import { CashuSendQuoteService } from './cashu-send-quote-service';
import { CashuSendSwapService } from './cashu-send-swap-service';
import { CashuReceiveQuoteService } from './cashu-receive-quote-service';
import { CashuReceiveSwapService } from './cashu-receive-swap-service';
import { getLightningQuote as getReceiveLightningQuote } from './cashu-receive-quote-core';
import type { DomainContext } from '../context';

export function createCashuDomain(
  ctx: DomainContext,
  accountRepository: AccountRepository,
): CashuDomain {
  const { supabase, encryption, cashuCrypto } = ctx.connections;

  const sendQuoteRepo = new CashuSendQuoteRepository(supabase, encryption);
  const sendSwapRepo = new CashuSendSwapRepository(supabase, encryption);
  const receiveQuoteRepo = new CashuReceiveQuoteRepository(supabase, encryption, accountRepository);
  const receiveSwapRepo = new CashuReceiveSwapRepository(supabase, encryption, accountRepository);

  const sendQuoteService = new CashuSendQuoteService(sendQuoteRepo);
  const receiveSwapService = new CashuReceiveSwapService(receiveSwapRepo);
  const sendSwapService = new CashuSendSwapService(sendSwapRepo, receiveSwapService);
  const receiveQuoteService = new CashuReceiveQuoteService(cashuCrypto, receiveQuoteRepo);

  const requireUserId = async (): Promise<string> => {
    const id = await getCurrentUserId(ctx.config.storage);
    if (!id) throw new SdkError('No active session', 'not_authenticated');
    return id;
  };

  return {
    send: {
      async createLightningQuote({ account, destination, amount }) {
        // Assemble: resolve ln-address -> invoice (lnurl) when destination is an
        // address (amount required), createMeltQuoteBolt11, then
        // sendQuoteService.getLightningQuote + createSendQuote. See note below.
        throw new NotImplementedError('cashu.send.createLightningQuote'); // replaced in Step 2
      },
      async createTokenQuote({ account, amount }) {
        const userId = await requireUserId();
        return sendSwapService.create({ userId, account, amount, senderPaysFee: true });
      },
      executeQuote(): Promise<CashuSendQuote> {
        throw new NotImplementedError('cashu.send.executeQuote');
      },
      async failQuote(quote, reason) {
        const account = /* the quote's account is supplied by the caller's full object? */ undefined as never;
        await sendQuoteService.failSendQuote(account, quote, reason);
      },
      async reverse(swap) {
        // reverse needs the full CashuAccount; see note — fetch via accounts repo by swap.accountId.
        throw new NotImplementedError('cashu.send.reverse'); // replaced in Step 2
      },
      async get(id) {
        return (await sendQuoteRepo.get(id)) ?? (await sendSwapRepo.get(id));
      },
    },
    receive: {
      receiveToken() {
        throw new NotImplementedError('cashu.receive.receiveToken');
      },
      async createLightningQuote({ account, amount, purpose }) {
        throw new NotImplementedError('cashu.receive.createLightningQuote'); // replaced in Step 2
      },
      async get(quoteId) {
        return receiveQuoteRepo.get(quoteId);
      },
    },
  };
}
```

> **Assembly notes (resolve while implementing — these are the contract methods that compose S5 primitives):**
> - `failQuote`/`reverse` take the full quote/swap but the service methods need the full `CashuAccount`. Fetch it via `accountRepository.get(quote.accountId)` (S4) and throw `NotFoundError` if absent. Wire that lookup here.
> - `send.createLightningQuote`: when `destination` is a bolt11 invoice, decode it; when it is a Lightning address, resolve to an invoice via the vendored `internal/lib/lnurl` `getInvoiceFromLud16` using `amount` (the contract says ln-address resolution happens here). Then `account.wallet.createMeltQuoteBolt11(paymentRequest)` → `sendQuoteService.getLightningQuote({...})` (preview) → `sendQuoteService.createSendQuote({ userId, account, sendQuote: { paymentRequest, amountRequested, amountRequestedInBtc, meltQuote }, destinationDetails })`. Read master's `useCreateCashuLightningSendQuote` + `useInitiateCashuSendQuote` (hooks) for the exact compose order; reproduce inline (no hooks).
> - `receive.createLightningQuote`: `receiveQuoteService.getLightningQuote({ wallet: account.wallet, amount, description })` → `receiveQuoteService.createReceiveQuote({ userId, account, receiveType: 'LIGHTNING', lightningQuote, purpose })`. Read master's `useCreateCashuReceiveQuote`.
>
> These three assembled methods ARE in S5 scope (they compose only S5 primitives + the S4 lnurl lib + the live wallet). Implement them fully in Step 2 — they are not deferred. Only `executeQuote` + `receiveToken` are `NotImplementedError`.

- [ ] **Step 2: Replace the three `NotImplementedError` placeholders** (`send.createLightningQuote`, `send.reverse`, `receive.createLightningQuote`) with the full assembled implementations per the notes. `send.reverse` = fetch the account via `accountRepository.get(swap.accountId)` then `sendSwapService.reverse(swap, account)` and return the swap (re-`get` it for the latest state). `failQuote` = fetch account + `sendQuoteService.failSendQuote(account, quote, reason)`.

- [ ] **Step 3: Write the test** (`cashu-domain.test.ts`) — build a `ctx` with `makeFakeDb` + the S4-style connections fakes (`encryption`, `cashuCrypto`, `storage` with a `jwtWith({sub})`), inject a fake `accountRepository`. Assert:
  - `executeQuote` + `receiveToken` throw `NotImplementedError`.
  - `createTokenQuote` calls through to a created swap (fake repo returns a PENDING swap).
  - `get(id)` returns the send-quote when present, else the swap, else null.
  - `receive.createLightningQuote` composes getLightningQuote + createReceiveQuote (fake wallet on the account + fake repo).

```ts
it('executeQuote and receiveToken are NotImplemented (S7)', async () => {
  const domain = createCashuDomain(ctx, fakeAccountRepo);
  expect(() => domain.send.executeQuote({} as never)).toThrow(NotImplementedError);
  expect(() => domain.receive.receiveToken({ token: 't' } as never)).toThrow(NotImplementedError);
});
```

- [ ] **Step 4: Verify + commit.** `bun run typecheck` → PASS. `bun --filter=@agicash/wallet-sdk run test` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): createCashuDomain (create/read/fail/reverse real; execute/claim S7)

Compose the cashu repos + services into CashuDomain: send.createLightningQuote/
createTokenQuote/failQuote/reverse/get + receive.createLightningQuote/get are real;
send.executeQuote + receive.receiveToken throw NotImplementedError (the WS-driven
orchestrator + cross-account claim land in S7). Tested.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Wire cashu into `Sdk` + full gate

**Files:** Modify `src/sdk.ts`, `src/sdk.test.ts`.

- [ ] **Step 1: Wire the domain.** In `src/sdk.ts`: import `createCashuDomain`; change `readonly cashu: CashuDomain = { … }` to `readonly cashu: CashuDomain;` (declared field); delete the `notImplementedDomain` stub initializers for cashu. In the constructor, after `this.accounts = …`:

```ts
    this.cashu = createCashuDomain(ctx, accountRepository);
```

Update the class JSDoc: now `auth`, `user`, `accounts`, `scan`, `exchangeRate`, `cashu` are real (cashu's `executeQuote`/`receiveToken` pending S7); 5 domains (`spark`, `transactions`, `contacts`, `transfers`, `background`) stubbed.

- [ ] **Step 2: Update `sdk.test.ts`.** Add/extend:

```ts
  it('cashu create/read methods are wired (not NotImplemented)', async () => {
    const sdk = await Sdk.create(config);
    expect(typeof sdk.cashu.send.createTokenQuote).toBe('function');
    expect(typeof sdk.cashu.send.get).toBe('function');
    expect(typeof sdk.cashu.receive.createLightningQuote).toBe('function');
    await sdk.destroy();
  });
  it('cashu executeQuote/receiveToken throw NotImplemented (S7)', async () => {
    const sdk = await Sdk.create(config);
    expect(() => sdk.cashu.send.executeQuote({} as never)).toThrow(NotImplementedError);
    expect(() => sdk.cashu.receive.receiveToken({ token: 't' } as never)).toThrow(
      NotImplementedError,
    );
    await sdk.destroy();
  });
  it('still-unimplemented domains throw NotImplementedError', async () => {
    const sdk = await Sdk.create(config);
    expect(() => sdk.spark.send.failQuote({} as never, 'x')).toThrow(NotImplementedError);
    expect(() => sdk.transactions.countPendingAck()).toThrow(NotImplementedError);
    expect(() => sdk.background.state()).toThrow(NotImplementedError);
    await sdk.destroy();
  });
```

(Replace the prior "cashu.send.failQuote throws NotImplemented" assertion — `failQuote` is real now; use `spark.send.failQuote` for the still-stubbed check.)

> `Sdk.create(config)` builds the cashu repos/services in the constructor (synchronous, inert — no DB/mint/WS calls until a method runs). Confirm no import-time side effects; prefer no `mock.module`. If `@cashu/cashu-ts` import triggers anything, the carryover `breez`/openSecret factories pattern + `afterAll(mock.restore)` applies — but it should not.

- [ ] **Step 3: Run the FULL gate.** `bun run typecheck` → PASS (all packages; web untouched, still not importing the SDK). `bun run test` → PASS (all SDK unit tests incl. the new cashu ones).

- [ ] **Step 4: Commit.**

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): wire real cashu domain into Sdk

Replace the cashu notImplementedDomain stub with createCashuDomain. cashu
create/read/fail/reverse are live; executeQuote + receiveToken stay NotImplemented
(S7). 6 of 11 domains now real (auth/user/accounts/scan/exchangeRate/cashu).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Verification Gate (slice done when)

- `bun run typecheck` green (4 packages) and `bun run test` green (all new SDK cashu unit tests).
- **S5 load-bearing correctness covered by unit tests:** proof encrypt/decrypt round-trip (Task 4); `CashuCryptography` xpub↔privkey agreement for NUT-20 locking (Task 5); each repository's `toX` decrypt-mapping + the explicit DB-error hints (`LIMIT_REACHED`/409/`CONCURRENCY_ERROR`/`23505` → the right 2-arg error) (Tasks 6–9); each service's state guards + idempotent no-ops + the wallet-driven primitives against fake wallets (Tasks 10–15); `reverse` creates a `reversedTransactionId`-tagged receive-swap (Task 11); same-mint claim guards (mint/currency mismatch) (Task 14); `executeQuote`/`receiveToken` throw `NotImplementedError`, the rest are real (Tasks 17–18).
- **No named S5 regression is in scope** per spec §10 — the **#788 change-refetch** and the WS state machine are **S7** (the `completeSendQuote` change-derivation *primitive* is built + tested here, but the WS handler that triggers it and the #788 refetch are S7). Note this explicitly so S7 owns the #788 regression test.
- `types/cashu.ts` is unchanged (the public types already shipped); the ported zod schemas (`CashuSendQuoteSchema`/`CashuSendSwapSchema`/`CashuReceiveQuoteSchema`/`CashuReceiveSwapSchema`) infer to types assignable to the contract types.
- The web still typechecks (it does not import the SDK yet).
- Spot-check by reading the test assertions: the decrypt round-trips, the crypto agreement, the error-hint mappings, the service guards, and the partial-domain `NotImplementedError`.

---

## Self-Review

**1. Spec coverage (§7b cashu row + §5 contract + the confirmed forks):**
- send/receive **quote+swap (schema/service/repo)**: ✔ (T3 schemas, T6–T9 repos, T10–T14 services). `CashuSendQuoteSchema`/etc. ported alongside the repos (the contract ships only TS types).
- **token-claim**: same-mint primitives ✔ (T14 receive-swap-service, T15 token models + account selection + `cashuMintValidator`). Cross-account melt-then-mint + `ClaimCashuTokenService` + public `receiveToken` → S7 (D5-2). ✔ held out.
- **mint-validation** instance + `cashuMintBlocklist` config (deferred from S4): ✔ (T1 config, T16 validator).
- **melt/mint subscription managers + #788 + the task loop + `executeQuote`**: → S7 (D5-1). ✔ held out; `executeQuote`/`receiveToken` ship `NotImplementedError` (T17/T18). The per-op primitives they need (`initiateSend`/`markPending`/`completeSendQuote`/`swapForProofsToSend`/`completeReceive`/`completeSwap`) are built + tested (T10–T14).
- contract create/read surface (`createLightningQuote` send+receive, `createTokenQuote`, `failQuote`, `reverse`, `get`): ✔ assembled in the domain (T17).
- Lib gaps (`toProof`, `getTokenHash`, `tokenToMoney`, `blind-signature-matching`) + shared proof mappers + `CashuCryptography`: ✔ (T1, T2, T4, T5).

**2. Placeholder scan:** Vendored files (4 DB schemas, `blind-signature-matching`) are concrete copies with named source paths + import-fix instructions + tests — the S2/S3/S4-blessed pattern. Net-new logic (`toProof`, `getTokenHash`/`tokenToMoney`, the proof mappers, `CashuCryptography`, the partial-domain wiring, the config + connections additions, ALL tests) is shown in full. The repos/services are **faithful ports** of named master files with: the exact constructor + every public method signature, the enumerated transform rules (DI deps; 2-arg `DomainError` codes; `EncryptionService.get()`; `sha256Hex`; shared proof mappers; verbatim RPC names confirmed present in `database.types.ts`; drop hooks), the full tests, and precise "reconcile cashu-ts call X against node_modules + master file:line" pointers — not open TODOs. The three assembled domain methods (T17) carry explicit compose-order notes citing the master hooks to reproduce.

**3. Type consistency:** `toProof` (T1) used by send-quote/send-swap services + the proof mappers. `toEncryptedProofData`/`toDecryptedCashuProofs` (T4) used by all four repos (T6–T9). `CashuCryptography` (T5) used by `CashuReceiveQuoteService` (T13) + `receive-quote-core` (T12, `BASE_CASHU_LOCKING_DERIVATION_PATH`) + connections (T16). `RepositoryCreateQuoteParams`/`CreateQuoteBaseParams`/`CashuReceiveLightningQuote` (T12 core) consumed by `CashuReceiveQuoteService` (T13) + the receive-quote repo (T8). The four repos (T6–T9) consumed by the four services + the domain (T17). `CashuReceiveSwapService` (T14) injected into `CashuSendSwapService` (T11, for `reverse`) and the domain (T17). `cashuMintValidator` (T16) injected into `ReceiveCashuTokenService` (T15). `createCashuDomain` (T17) wired in `sdk.ts` (T18) using the S4 `accountRepository`. The ported zod schemas infer to the contract `types/cashu.ts` types (asserted by `typecheck`). `NotImplementedError`/`DomainError`/`ConcurrencyError`/`SdkError` all 2-arg (T-wide, D5-6).

**4. Fork resolutions honored:** `executeQuote` + `receiveToken` = `NotImplementedError` (D5-1); same-mint token-claim only, cross-account + `ClaimCashuTokenService` deferred (D5-2); subscription managers + #788 + payment-request NOT vendored here (S7). The slice is internally complete + unit-testable with zero WS/mint/task-loop dependencies.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-06-13-wallet-sdk-05-cashu-ops.md`. **Subagent-Driven (recommended)** — fresh subagent per task + two-stage review. Task order is dependency-forced: **T1 → T2** (lib) → **T3 → T4 → T5** (schemas/mappers/crypto; independent after T1) → **T6 → T7 → T8 → T9** (repos; need T3+T4+T1) → **T10 → T11** (send services; T11 needs T14's receive-swap-service type — build T14 before T11, or use a type-only import and reconcile at T17) → **T12 → T13 → T14 → T15** (receive services + token; T13 needs T12+T5+T8, T14 needs T9, T15 needs T16's validator type — inject it) → **T16** (connections) → **T17** (domain; needs all services) → **T18** (Sdk wire + full gate). Practical linear order that satisfies all deps: T1, T2, T3, T4, T5, T16, T6, T7, T8, T9, T14, T10, T11, T12, T13, T15, T17, T18 (T16 early so the validator type is available to T15; T14 before T11 for the receive-swap-service dep).

**Testing note (carryover):** Prefer DI over `mock.module` — every repo (injected `supabase`/`EncryptionService`/`AccountRepository`) and service (injected repos + `CashuCryptography` + the live/fake `account.wallet`) is testable without module mocks, sidestepping bun's process-global `mock.module`. Where `mock.module` is unavoidable, that test file MUST add `afterAll(() => mock.restore())` + the COMPLETE `openSecretModuleMock`/`breezModuleMock` factories from `internal/test-support.ts`.
