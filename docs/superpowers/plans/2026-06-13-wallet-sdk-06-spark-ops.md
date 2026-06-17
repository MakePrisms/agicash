# Spark Ops (`@agicash/wallet-sdk` S6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the spark domain's **building blocks + create/read public surface** — the spark send-quote / receive-quote models, repositories, the session-agnostic receive-quote core, and services (all per-operation methods incl. the wallet-driven primitives `initiateSend`/`complete`/`fail` and the receive `complete`), wired into a real `createSparkDomain` whose `send.createLightningQuote`/`failQuote`/`get` + `receive.createLightningQuote`/`get` are live — leaving the **Breez-event-driven orchestration** (`executeQuote`, the send/receive task processors, the balance listener + its §8 `synced` reconcile) to S7.

**Architecture:** S6 ports master's spark send/receive services + repositories faithfully, stripping the React/TanStack hooks and using **dependency injection** (the S4/S5 pattern): repositories take the RLS `supabase` client + `EncryptionService`; services take repositories; the receive-quote core stays a set of pure functions taking an explicit `wallet: BreezSdk` (so the SAME `getLightningQuote` serves both the client user-wallet and the future S10 server wallet). Every method is a single wallet+DB operation, **unit-tested offline with fake wallets + `makeFakeDb`** — no live Breez, no event listener, no task loop. The spark domain flips from a `notImplementedDomain` stub to a real `createSparkDomain(ctx)` that wires the create/read/fail methods and throws `NotImplementedError` for `send.executeQuote` (assembled + driven by the Breez listener in S7). The other 4 domains stay stubbed.

**Tech Stack:** Bun workspaces, TypeScript 5.9.3, `@agicash/breez-sdk-spark` (`BreezSdk` — `prepareSendPayment`/`sendPayment`/`receivePayment`/`getInfo`), `@agicash/money`, `zod@4.3.6` (`zod/mini`), `@cashu/cashu-ts` (`Proof` type only, for the CASHU_TOKEN melt-data), the SDK's `internal/lib/bolt11` (`parseBolt11Invoice`), `internal/lib/lnurl` (`getInvoiceFromLud16`), `internal/lib/spark/errors`, `bun:test`.

---

## Scope boundary (read first)

**In scope (S6):**
- **DB json-model schemas** → `internal/db`: `SparkLightningSendDbDataSchema`, `SparkLightningReceiveDbDataSchema` (the latter reuses the already-vendored `cashu-token-melt-db-data.ts`).
- **Spark lib barrel** (`internal/lib/spark/index.ts`) re-exporting `./errors` (`isInsufficentBalanceError`, `isInvoiceAlreadyPaidError`).
- **The 2 repositories** (`internal/repositories/spark-{send,receive}-quote-repository.ts`): full CRUD/RPC + row→domain mappers + the ported zod entity schemas (`SparkSendQuoteSchema`, `SparkReceiveQuoteSchema`). Offline-testable with `makeFakeDb`.
- **The receive-quote core** (`domains/spark/spark-receive-quote-core.ts`): `getLightningQuote` (session-agnostic — takes an explicit `wallet` + optional `receiverIdentityPubkey`), `computeQuoteExpiry`, `getAmountAndFee`, and the param types (`SparkReceiveLightningQuote`, `GetLightningQuoteParams`, `CreateQuoteBaseParams`, `RepositoryCreateQuoteParams`).
- **The services** (`domains/spark/*`), with **every** method incl. the wallet-driven per-operation primitives:
  - `SparkSendQuoteService` (`getLightningSendQuote`, `createSendQuote`, `initiateSend`→`wallet.sendPayment`, `complete`, `fail`, `get`).
  - `SparkReceiveQuoteService` (`createReceiveQuote` for LIGHTNING **and** CASHU_TOKEN, `complete`, `expire`, `fail`, `markMeltInitiated`, `get`).
- **`createSparkDomain`** wired into `Sdk`: `send.{createLightningQuote, failQuote, get}` + `receive.{createLightningQuote, get}` real; `send.executeQuote` throws `NotImplementedError` (S7).

**Out of scope (S7 — the orchestrator, confirmed fork D6-1):**
- `spark.send.executeQuote` (the kickoff that S7 wires to `initiateSend` + the Breez completion listener) — **stays `NotImplementedError`**.
- The Breez-event-driven processors (`useProcessSparkSendQuoteTasks`/`useProcessSparkReceiveQuoteTasks`), the per-account event listeners (`useOnSparkSendStateChange`/`useOnSparkReceiveStateChange`), and the **balance listener** (`useTrackAndUpdateSparkAccountBalances`) **with the §8 `synced` re-read** (the named §10 regression) — **S7 owns these + the §8 regression test**. None of S6's service primitives import them.
- The cross-account cashu-token→spark claim (`createCrossAccountReceiveQuotes`, `ClaimCashuTokenService`) that *consumes* `SparkReceiveQuoteService.createReceiveQuote({ receiveType: 'CASHU_TOKEN', … })` — **S7**. S6 builds + tests that create path; no public domain method exposes it yet.

**Out of scope (S10 — the server facade, confirmed fork D6-2):**
- `config.serverSparkMnemonic`, the dedicated **server** `SparkWalletService` instance (own mnemonic + own `storageDir`), the server receive **repository** (`SparkReceiveQuoteRepositoryServer` — `encryptToPublicKey`, service-role client) + service (`SparkReceiveQuoteServiceServer`), and the `ServerSdk` wiring. These belong in `createServer`'s connection assembly and have **no consumer** until S10. S6 proves the server receive **primitive** is ready via a unit test that drives `getLightningQuote` with `receiverIdentityPubkey`.
- The web stays **untouched** (dark build); S6 is verified by SDK unit tests alone.

---

## Decisions (locked)

- **D6-1 — `executeQuote` defers to S7; S6 builds + unit-tests every per-operation primitive (owner-confirmed).** In master there is no single `executeQuote`: the UI creates an UNPAID quote, then the background processor (`useProcessSparkSendQuoteTasks`) runs `initiateSend` (`prepareSendPayment` → `sendPayment` → `markAsPending` PENDING) and a per-account Breez event listener (`useOnSparkSendStateChange`) drives `complete`/`fail` on `paymentSucceeded`/`paymentFailed`. The kickoff primitive (`initiateSend`) and the terminal primitives (`complete`/`fail`) are each a single op, **unit-testable offline with a fake wallet**. S6 ships them; the public `executeQuote` only *assembles* `initiateSend` + the Breez listener (which carries the §8 `synced` balance reconcile), so it ships as `NotImplementedError`. S7 turns `executeQuote` NotImplemented→fully-working **in one slice** (wire `executeQuote = initiateSend` + register the listener), so no half-wired money method is ever live. Mirrors the cashu S5 precedent (D5-1) exactly.
- **D6-2 — Session-agnostic core + client only in S6; ALL server wiring defers to S10 (owner-confirmed).** `spark-receive-quote-core.ts#getLightningQuote` already takes an explicit `wallet: BreezSdk` + optional `receiverIdentityPubkey` — it is the SAME function for the client (user wallet, no pubkey) and the S10 server (dedicated server wallet, `receiverIdentityPubkey = user.sparkIdentityPublicKey`). S6 builds the core + the CLIENT repos/services/domain and **proves server-readiness with a unit test** passing `receiverIdentityPubkey`. The server *wiring* (`config.serverSparkMnemonic`, the dedicated server `SparkWalletService`, the encrypt-only server repo/service) belongs in `createServer`'s assembly (S10) — building it in S6 would create dead code with no consumer for ~4 slices and would wrongly place a server-wallet builder beside the client `buildConnections`. The existing `SparkWalletService` (S4) already fits a dedicated server wallet as a **second instance** with its own connect closure (it memoizes by network; each instance owns one mnemonic) — **no class change is needed in S6 or S10.**
- **D6-3 — DI over `mock.module` (the S4/S5 pattern).** Repositories take `(supabase: SupabaseClient<Database>, encryption: EncryptionService)`; services take repositories; the live `BreezSdk` arrives via the `SparkAccount.wallet` handle (live since S4) or an injected fake in tests. Tests use `makeFakeDb` + hand-rolled fake wallets — **no `mock.module` on `@agicash/breez-sdk-spark`**. Any test that nonetheless uses `mock.module` MUST add `afterAll(() => mock.restore())` + the complete `breezModuleMock`/`openSecretModuleMock` factories (carryover) — but none should be needed.
- **D6-4 — Port the zod entity schemas; the contract ships only TS types.** `types/spark.ts` has `SparkSendQuote`/`SparkReceiveQuote` as hand-written types (no zod). The repos' `toQuote` validate via `SparkSendQuoteSchema`/`SparkReceiveQuoteSchema` ported from master into the repo files (one copy each, mirroring S5's `CashuSendQuoteSchema`-in-repo). **Drop master's `satisfies AllUnionFieldsRequired<…>`** (the `AllUnionFieldsRequired` util is NOT in the SDK) — replace with a plain `Schema.parse({…})` plus a module-level compile-time check `type _Fits = z.infer<typeof Schema> extends ContractType ? true : never; const _c: _Fits = true; void _c;` (the exact S5 pattern in `cashu-send-quote-repository.ts:73-80`).
- **D6-5 — Every ported `new DomainError(msg)` / `new Error(msg)` that is a user-facing domain failure becomes `new DomainError(msg, code)`** (the SDK's 2-arg requirement). Codes used by S6: `'invalid_invoice'`, `'expired'`, `'insufficient_balance'`, `'fee_changed'`, `'already_paid'`, `'amount_required'`, `'invalid_state'`, `'duplicate'`, `'lnurl_error'`. Internal "should never happen" Breez-response invariants (`Expected bolt11Invoice payment method…`, `Breez SDK did not return lightning{Send,Receive}Details`) → `new SdkError(msg, 'spark_unexpected_response')` (not user-facing). Repository DB-error wrapping uses `classify(error)` for unknown DB errors; the send repo's `23505` partial-index hit → `new DomainError(msg, 'duplicate')`. Strip `measureOperation`/`~/lib/performance` (S5 dropped it; it does not exist in the SDK).
- **CI gate:** `bun run typecheck` + `bun run test` (NOT `fix:all`). Commit per task locally; do not push.

---

## Grounding facts (verified 2026-06-17 — authoritative)

**SDK shapes S6 builds on (re-verified):**
- `Sdk` (`src/sdk.ts`): `protected constructor(config, connections)` builds `ctx: DomainContext = { config, connections, emitter }`, builds `accountRepository = new AccountRepository(supabase, encryption, cashuWallets, sparkWallets, mintAuth, getCashuSeed)` inline, then assigns the 6 real domains incl. `this.cashu = createCashuDomain(ctx, accountRepository)`. The spark stub is `readonly spark: SparkDomain = { send: notImplementedDomain<SparkSendOps>('spark.send'), receive: notImplementedDomain<SparkReceiveOps>('spark.receive') }` (Task 8 replaces it). **`createSparkDomain` needs only `ctx`** — NOT `accountRepository` (spark `failQuote(quote, reason)` calls `repo.fail` directly; no account lookup, unlike cashu).
- `SparkDomain` contract (`src/domains.ts:236-285`): `SparkSendOps` = `createLightningQuote({account: SparkAccount; destination: string; amount?: Money}): Promise<SparkSendQuote>` · `executeQuote(quote): Promise<SparkSendQuote>` **(S7)** · `failQuote(quote, reason): Promise<void>` · `get(quoteId): Promise<SparkSendQuote | null>`. `SparkReceiveOps` = `createLightningQuote({account: SparkAccount; amount: Money; description?: string; purpose?: 'PAYMENT'|'BUY_CASHAPP'}): Promise<SparkReceiveQuote>` · `get(quoteId): Promise<SparkReceiveQuote | null>`. `SparkDomain = { send: SparkSendOps; receive: SparkReceiveOps }`.
- `types/spark.ts`: `SparkSendQuote` (base ∧ state UNPAID/PENDING/COMPLETED/FAILED; `createdAt: string`, `expiresAt?: string|null`) + `SparkReceiveQuote` (base ∧ type LIGHTNING/CASHU_TOKEN ∧ state UNPAID|EXPIRED / PAID / FAILED; `CashuTokenMeltData` from `./cashu`). **TS types only — no zod schema (port it, D6-4).**
- `types/account.ts`: `SparkAccount = Extract<Account, {type:'spark'}>` = base ∧ `{ type:'spark'; balance: Money|null; network: SparkNetwork; wallet: BreezSdk }`. `SparkNetwork = 'MAINNET'|'REGTEST'` (`types/dependencies.ts`). `BreezSdk` re-exported from `@agicash/breez-sdk-spark` (`types/dependencies.ts`).
- `internal/connections/spark-wallet.ts`: `SparkWalletService` memoizes by `SparkNetwork` (`constructor(connect: (network) => Promise<BreezSdk>)`; `getInitialized(network) → { wallet, balance, isOnline }`; failed connect not cached). `createSparkWalletStub(reason)`. On `SdkConnections.sparkWallets`. **Confirmed it fits a dedicated server wallet as a 2nd instance (own connect closure) — no change needed (D6-2).**
- `internal/connections/breez.ts`: `connectBreez(cfg: BreezConnectConfig, mnemonic): Promise<BreezSdk>`, `getSparkIdentityPublicKey(mnemonic, network): Promise<string>`, `initBreezWasm()`, `tryInitLogging(debug)` (the §8 `initLogging` single-global guard already lives here). `BreezConnectConfig = { apiKey; network:'mainnet'|'regtest'; storageDir; debugLogging? }`.
- `internal/lib/spark/errors.ts`: `isInsufficentBalanceError(error)`, `isInvoiceAlreadyPaidError(error)`. **No barrel yet** — Task 1 adds `internal/lib/spark/index.ts`.
- `internal/lib/bolt11/index.ts`: `parseBolt11Invoice(invoice) → { valid:true; encoded; decoded: DecodedBolt11 } | { valid:false }`; `decodeBolt11`. `DecodedBolt11 = { amountMsat?; amountSat?; createdAtUnixMs; expiryUnixMs; network?; description?; payeeNodeKey; paymentHash }`. (Note master reads `invoice.expiryUnixMs`/`createdAtUnixMs`/`amountMsat`/`paymentHash` — all present.)
- `internal/lib/lnurl`: `getInvoiceFromLud16(address, amountBtc)`, `buildLightningAddressFormatValidator({message, allowLocalhost})`, `isLNURLError(x)` (proven by `createCashuDomain`'s `resolveDestination`).
- `errors.ts`: `SdkError(message, code)`; `DomainError`/`ConcurrencyError`/`NotFoundError extends SdkError` (all 2-arg); `NotImplementedError(method)` (1-arg → code `'not_implemented'`). `classify(error)` routes DB errors. `notImplementedDomain<T>(domain)`.
- `internal/db/database.ts` aliases `AgicashDbSparkSendQuote`, `AgicashDbSparkReceiveQuote`. `internal/db/database.types.ts` has all 9 spark RPCs: `create_spark_send_quote`, `mark_spark_send_quote_as_pending`, `complete_spark_send_quote`, `fail_spark_send_quote`, `create_spark_receive_quote`, `complete_spark_receive_quote`, `expire_spark_receive_quote`, `fail_spark_receive_quote`, `mark_spark_receive_quote_cashu_token_melt_initiated`.
- `internal/db/cashu-token-melt-db-data.ts` **already exists** (S5 vendored it) — `SparkLightningReceiveDbDataSchema` imports `CashuTokenMeltDbDataSchema` from `./cashu-token-melt-db-data`.
- `internal/db/cashu-proofs.ts`: `toEncryptedProofData`/`toDecryptedCashuProofs` — **not needed by spark** (spark proofs ride inside `encrypted_data.cashuTokenMeltData.tokenProofs` as `Proof[]`, not in `cashu_proofs` rows). No spark RPC returns proof rows.
- `internal/test-support.ts`: `makeFakeDb({selectResult, updateResult, rpcResult, calls})` (awaitable builder + `insert`/`abortSignal`/`maybeSingle`/`single`/`.eq`/`.in`), `inMemoryStorage`, `jwtWith`. `EncryptionService` (`internal/crypto/encryption.ts`) memoizes a real ECIES keypair; tests build one from a random secp256k1 key (S4/S5 pattern). **`AllUnionFieldsRequired` is NOT in the SDK** (S5 dropped it) — use the `_Fits` compile-time check (D6-4).
- `domains/context.ts`: `DomainContext = { config: SdkConfig; connections: SdkConnections; emitter: SdkEventEmitter<SdkEventMap> }`. `createCashuDomain(ctx, accountRepository)` is the template factory (the `requireUserId` helper + the `resolveDestination` ln-address helper are reusable patterns — `src/domains/cashu/cashu-domain.ts`).

**Web behaviour S6 reproduces (verified; web stays untouched). Master files to port from:**
- `app/features/send/spark-send-quote.ts` (`SparkSendQuoteSchema`), `…/spark-send-quote-service.ts` (`SparkSendQuoteService` + `SparkLightningQuote`), `…/spark-send-quote-repository.ts` (`SparkSendQuoteRepository`), `…/spark-send-quote-hooks.ts` (the `useCreateSparkLightningSendQuote` + `useInitiateSparkSendQuote` compose order — S7 owns `useProcessSparkSendQuoteTasks`/`useOnSparkSendStateChange`).
- `app/features/receive/spark-receive-quote.ts` (`SparkReceiveQuoteSchema`), `…/spark-receive-quote-core.ts` (the session-agnostic core), `…/spark-receive-quote-service.ts` (`SparkReceiveQuoteService`), `…/spark-receive-quote-repository.ts` (`SparkReceiveQuoteRepository`), `…/spark-receive-quote-hooks.ts` (the `useCreateSparkReceiveQuote` compose order — S7 owns `useProcessSparkReceiveQuoteTasks`/`useOnSparkReceiveStateChange`).
- `app/features/agicash-db/json-models/spark-lightning-send-db-data.ts`, `…/spark-lightning-receive-db-data.ts`.
- `app/features/shared/spark.ts` — **S7 only** (`useTrackAndUpdateSparkAccountBalances` balance listener + the §8 `synced` re-read at lines 180-230). S6 imports nothing from it.

**The DB-data schemas (what the repos encrypt/decrypt as `encrypted_data`):** master's json-models are `zod/mini` `z.object({...})` over `Money` (`z.instanceof(Money)`), optional strings, and (receive only) the embedded `cashuTokenMeltData` (`CashuTokenMeltDbDataSchema`). Framework-free (deps: `zod/mini`, `@agicash/money`, `./cashu-token-melt-db-data`). Re-read each side-by-side when porting (Task 1).

**RPC error handling (master, ported to 2-arg SDK errors):** `create_spark_send_quote` → on `error.code === '23505'` throw `new DomainError('A payment for this invoice is already being processed or was completed', 'duplicate')` (the `spark_send_quotes_payment_hash_active_unique` partial index covers UNPAID/PENDING/COMPLETED); else `throw classify(error)`. `create_spark_receive_quote` + all other RPCs: master throws `new Error('Failed to …', { cause })` → SDK uses `throw classify(error)` (preserves cause + maps known PG codes).

**breez-sdk API used (reconcile against `node_modules/@agicash/breez-sdk-spark` when implementing):**
- `wallet.prepareSendPayment({ paymentRequest, amount: bigint }) → { paymentMethod }` where `paymentMethod.type === 'bolt11Invoice'` carries `lightningFeeSats: number`.
- `wallet.sendPayment({ prepareResponse, idempotencyKey, options: { type:'bolt11Invoice', preferSpark:false } }) → { payment, lightningSendDetails }` where `payment.id: string`, `payment.fees: bigint`, `lightningSendDetails.sendRequestId: string`.
- `wallet.receivePayment({ paymentMethod: { type:'bolt11Invoice', description, amountSats, receiverIdentityPubkey?, descriptionHash? } }) → { paymentRequest, lightningReceiveDetails: { receiveRequestId, status, createdAt, updatedAt } }`.
- `wallet.getInfo({}) → { balanceSats }` (used by `SparkWalletService`, not by S6 services).
- `LightningReceiveStatus` (type on `SparkReceiveLightningQuote.status`). Read the master service/core alongside each task — the bodies are near-verbatim ports.

---

## File Structure

**Created (SDK):**
- `src/internal/lib/spark/index.ts` — barrel (`export * from './errors'`).
- `src/internal/db/spark-send-quote-db-data.ts`, `src/internal/db/spark-receive-quote-db-data.ts` (+ `src/internal/db/spark-db-data.test.ts`) — vendored schemas.
- `src/internal/repositories/spark-send-quote-repository.ts` (+ `.test.ts`) — incl. ported `SparkSendQuoteSchema`.
- `src/internal/repositories/spark-receive-quote-repository.ts` (+ `.test.ts`) — incl. ported `SparkReceiveQuoteSchema`.
- `src/domains/spark/spark-receive-quote-core.ts` (+ `.test.ts`).
- `src/domains/spark/spark-send-quote-service.ts` (+ `.test.ts`).
- `src/domains/spark/spark-receive-quote-service.ts` (+ `.test.ts`).
- `src/domains/spark/spark-domain.ts` (+ `.test.ts`) — `createSparkDomain`.

**Modified (SDK):**
- `src/sdk.ts` — build the spark repos/services + `createSparkDomain(ctx)`; drop the spark stub.
- `src/sdk.test.ts` — assert spark create/read methods are real; `send.executeQuote` throws `NotImplementedError`.

**Not touched in S6 (defers):** `src/config.ts` (no `serverSparkMnemonic` until S10), `src/internal/connections/index.ts` (no server wallet until S10), `src/internal/connections/spark-wallet.ts` (already fits a server wallet — no change).

---

## Task 1: Spark lib barrel + DB-data schemas + shared token-melt domain schema

**Files:** Create `src/internal/lib/spark/index.ts`, `src/internal/db/spark-send-quote-db-data.ts`, `src/internal/db/spark-receive-quote-db-data.ts`, `src/internal/db/cashu-token-melt-data.ts`, `src/internal/db/spark-db-data.test.ts`. Modify `src/internal/repositories/cashu-receive-quote-repository.ts` (extract the inline schema).

- [ ] **Step 1: Add the spark lib barrel.** Create `src/internal/lib/spark/index.ts`:

```ts
export * from './errors';
```

- [ ] **Step 2: Vendor the send DB-data schema.** Create `src/internal/db/spark-send-quote-db-data.ts` by copying `app/features/agicash-db/json-models/spark-lightning-send-db-data.ts` verbatim (it is already framework-free — deps `@agicash/money` + `zod/mini`):

```ts
import { Money } from '@agicash/money';
import { z } from 'zod/mini';

/** Schema for spark lightning send db data (the jsonb `encrypted_data` column). */
export const SparkLightningSendDbDataSchema = z.object({
  paymentRequest: z.string(),
  amountReceived: z.instanceof(Money),
  estimatedLightningFee: z.instanceof(Money),
  amountSpent: z.optional(z.instanceof(Money)),
  lightningFee: z.optional(z.instanceof(Money)),
  paymentPreimage: z.optional(z.string()),
});

export type SparkLightningSendDbData = z.infer<
  typeof SparkLightningSendDbDataSchema
>;
```

- [ ] **Step 3: Vendor the receive DB-data schema** (reusing the already-vendored token-melt schema). Create `src/internal/db/spark-receive-quote-db-data.ts` by copying `app/features/agicash-db/json-models/spark-lightning-receive-db-data.ts`, repointing the `./cashu-token-melt-db-data` import (same relative path — it already lives in `internal/db`):

```ts
import { Money } from '@agicash/money';
import { z } from 'zod/mini';
import { CashuTokenMeltDbDataSchema } from './cashu-token-melt-db-data';

/** Schema for spark lightning receive db data (the jsonb `encrypted_data` column). */
export const SparkLightningReceiveDbDataSchema = z.object({
  paymentRequest: z.string(),
  amountReceived: z.instanceof(Money),
  description: z.optional(z.string()),
  paymentPreimage: z.optional(z.string()),
  cashuTokenMeltData: z.optional(CashuTokenMeltDbDataSchema),
  totalFee: z.instanceof(Money),
});

export type SparkLightningReceiveDbData = z.infer<
  typeof SparkLightningReceiveDbDataSchema
>;
```

> Verify against master that the field set matches exactly (read both json-models). Confirm `CashuTokenMeltDbDataSchema` is exported from `src/internal/db/cashu-token-melt-db-data.ts` (it is — S5 vendored it). **Do not confuse the two token-melt schemas:** `cashu-token-melt-db-data.ts` is the *DB `encrypted_data`* shape (`tokenMintUrl`, …); the domain `tokenReceiveData` shape (`sourceMintUrl`, `meltInitiated`, …) needed by the receive *entity* schemas is extracted in Step 4. Verify neither file imports `~/features`, `react`, `@tanstack`, or `import.meta`.

- [ ] **Step 4: Extract the shared token-melt DOMAIN schema (DRY).** S5 inlined a private `CashuTokenMeltDataSchema` (the parsed `tokenReceiveData` shape) inside `src/internal/repositories/cashu-receive-quote-repository.ts` (≈ lines 41–58). Both the cashu **and** spark receive *entity* schemas (`CashuReceiveQuoteSchema` / `SparkReceiveQuoteSchema`) embed it, so extract it to a shared module rather than duplicate (layering: `internal/repositories` → `internal/db`).
  - Create `src/internal/db/cashu-token-melt-data.ts`: move the inline `CashuTokenMeltDataSchema` **verbatim** out of the cashu repo (export the schema + `export type CashuTokenMeltData = z.infer<typeof CashuTokenMeltDataSchema>`). Repoint its imports relative to `internal/db` (`@agicash/money`, `zod/mini`, and `ProofSchema`/proof type from `../lib/cashu` — match whatever the inline copy used).
  - Edit `cashu-receive-quote-repository.ts` to delete the inline schema and `import { CashuTokenMeltDataSchema } from '../db/cashu-token-melt-data'` instead. No behavior change.

```ts
// src/internal/db/cashu-token-melt-data.ts
import { Money } from '@agicash/money';
import { z } from 'zod/mini';
import { ProofSchema } from '../lib/cashu';

/** The parsed `tokenReceiveData` carried by a CASHU_TOKEN cashu/spark receive quote. */
export const CashuTokenMeltDataSchema = z.object({
  sourceMintUrl: z.string(),
  tokenAmount: z.instanceof(Money),
  tokenProofs: z.array(ProofSchema),
  meltQuoteId: z.string(),
  meltInitiated: z.boolean(),
  cashuReceiveFee: z.instanceof(Money),
  lightningFeeReserve: z.instanceof(Money),
  lightningFee: z.optional(z.instanceof(Money)),
});

export type CashuTokenMeltData = z.infer<typeof CashuTokenMeltDataSchema>;
```

> Copy the field set from the **actual inline schema** in `cashu-receive-quote-repository.ts` (it is the ground truth — the block above mirrors master's `app/features/receive/cashu-token-melt-data.ts`; reconcile `tokenProofs`' element schema against whatever the inline copy uses). Re-run the cashu receive repo test in Step 5 to confirm the refactor is behavior-neutral.

- [ ] **Step 5: Write `spark-db-data.test.ts`** — one parse round-trip per schema with minimal valid fixtures:

```ts
import { describe, expect, it } from 'bun:test';
import { Money } from '@agicash/money';
import { SparkLightningReceiveDbDataSchema } from './spark-receive-quote-db-data';
import { SparkLightningSendDbDataSchema } from './spark-send-quote-db-data';

const btc = (amount: number) => new Money({ amount, currency: 'BTC', unit: 'sat' });

describe('spark db-data schemas parse', () => {
  it('parses lightning-send db data (Money fields survive)', () => {
    const parsed = SparkLightningSendDbDataSchema.parse({
      paymentRequest: 'lnbc1...',
      amountReceived: btc(100),
      estimatedLightningFee: btc(1),
    });
    expect(parsed.amountReceived).toBeInstanceOf(Money);
    expect(parsed.amountReceived.toNumber('sat')).toBe(100);
  });

  it('parses lightning-receive db data (LIGHTNING, no token melt data)', () => {
    const parsed = SparkLightningReceiveDbDataSchema.parse({
      paymentRequest: 'lnbc1...',
      amountReceived: btc(100),
      totalFee: btc(0),
    });
    expect(parsed.amountReceived).toBeInstanceOf(Money);
    expect(parsed.cashuTokenMeltData).toBeUndefined();
  });
});
```

- [ ] **Step 6: Verify + commit.** `bun run typecheck` → PASS. `bun --filter=@agicash/wallet-sdk run test` → PASS (incl. the existing cashu receive-quote repo test, confirming the Step 4 extraction is behavior-neutral).

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): spark lib barrel + DB-data schemas + shared token-melt schema

Add internal/lib/spark/index.ts (re-exports errors), vendor the spark lightning
send/receive encrypted_data schemas (receive reuses cashu-token-melt-db-data), and
extract the shared CashuTokenMeltData domain schema out of the cashu receive repo
into internal/db (consumed by both cashu + spark receive entity schemas; DRY).
Parse round-trip tested; cashu receive repo test still green. Gate green.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `spark-receive-quote-core` (session-agnostic)

**Files:** Create `src/domains/spark/spark-receive-quote-core.ts` + `.test.ts`. **Port from** `app/features/receive/spark-receive-quote-core.ts`.

- [ ] **Step 1: Implement.** Pure functions + types (no class). Port verbatim, repointing imports: `~/lib/bolt11` → `../../internal/lib/bolt11`; `@agicash/money` (keep); `@cashu/cashu-ts` `Proof` (keep); `BreezSdk`/`LightningReceiveStatus` from `@agicash/breez-sdk-spark`; drop `measureOperation`/`~/lib/performance`; `SparkAccount` from `../../types/account`; `TransactionPurpose` from `../../types/transaction`.

The exported surface (signatures verbatim from master):

```ts
export type SparkReceiveLightningQuote = { /* id, createdAt, updatedAt, invoice{paymentRequest,paymentHash,amount,createdAt,expiresAt,memo?}, status, receiverIdentityPublicKey? */ };
export type GetLightningQuoteParams = { wallet: BreezSdk; amount: Money; receiverIdentityPubkey?: string; description?: string; descriptionHash?: string };
export type CreateQuoteBaseParams = { userId: string; account: SparkAccount; lightningQuote: SparkReceiveLightningQuote; purpose?: TransactionPurpose; transferId?: string } & ({ receiveType:'LIGHTNING' } | { receiveType:'CASHU_TOKEN'; tokenAmount: Money; sourceMintUrl: string; tokenProofs: Proof[]; meltQuoteId: string; meltQuoteExpiresAt: string; cashuReceiveFee: Money; lightningFeeReserve: Money });
export type RepositoryCreateQuoteParams = { userId; accountId; amount: Money; paymentRequest; paymentHash; expiresAt; description?; sparkId; receiverIdentityPubkey?; totalFee: Money; purpose?; transferId? } & ({ receiveType:'LIGHTNING' } | { receiveType:'CASHU_TOKEN'; meltData: { tokenMintUrl; meltQuoteId; tokenAmount: Money; tokenProofs: Proof[]; cashuReceiveFee: Money; lightningFeeReserve: Money } });

export async function getLightningQuote(params: GetLightningQuoteParams): Promise<SparkReceiveLightningQuote>;
export function computeQuoteExpiry(params: CreateQuoteBaseParams): string;
export function getAmountAndFee(params: CreateQuoteBaseParams): { amount: Money; totalFee: Money };
```

The `getLightningQuote` body (master verbatim, minus `measureOperation` — call `wallet.receivePayment({ paymentMethod: { type:'bolt11Invoice', description: description ?? '', amountSats: amount.toNumber('sat'), receiverIdentityPubkey, descriptionHash } })` directly), then `parseBolt11Invoice(response.paymentRequest)` (throw `new SdkError('Breez SDK returned an invalid bolt11 invoice', 'spark_unexpected_response')` if `!valid`), guard `response.lightningReceiveDetails` (throw `new SdkError('Breez SDK did not return lightningReceiveDetails for a lightning receive', 'spark_unexpected_response')`), and build the return object verbatim. `computeQuoteExpiry`/`getAmountAndFee` are pure — copy verbatim.

> Read `app/features/receive/spark-receive-quote-core.ts` end-to-end; the bodies are near-verbatim. Master throws plain `Error` for the two invariants — map to `SdkError(msg, 'spark_unexpected_response')` (D6-5). Import `SdkError` from `../../errors`. Reconcile `wallet.receivePayment`'s response shape + `parseBolt11Invoice`'s `decoded` fields (`amountMsat`, `paymentHash`, `createdAtUnixMs`, `expiryUnixMs`) against `node_modules` + the SDK `internal/lib/bolt11`.

- [ ] **Step 2: Write the test** (`spark-receive-quote-core.test.ts`) — fake `wallet.receivePayment`; a **known-valid bolt11 invoice** fixture (reuse one from `src/internal/lib/bolt11/index.test.ts` so `parseBolt11Invoice` succeeds). Cover:
  - `getLightningQuote` (client path, no pubkey) → returns a quote whose `invoice.paymentRequest` matches and `receiverIdentityPublicKey` is undefined; assert the fake `receivePayment` was called with `amountSats` = the requested sats.
  - **`getLightningQuote` (server path) — proves D6-2 server-readiness:** call with `receiverIdentityPubkey: 'deadbeef…'`; assert the fake `receivePayment` received `paymentMethod.receiverIdentityPubkey === 'deadbeef…'` AND the returned quote's `receiverIdentityPublicKey === 'deadbeef…'`.
  - `computeQuoteExpiry`: LIGHTNING → the invoice expiry; CASHU_TOKEN → the earlier of invoice vs `meltQuoteExpiresAt`.
  - `getAmountAndFee`: LIGHTNING → `{ amount, totalFee: zero }`; CASHU_TOKEN → `totalFee = cashuReceiveFee + lightningFeeReserve`.

```ts
import { describe, expect, it } from 'bun:test';
import { Money } from '@agicash/money';
import { getLightningQuote } from './spark-receive-quote-core';

// A real, decodable bolt11 invoice (copy one from internal/lib/bolt11/index.test.ts).
const INVOICE = 'lnbc...';

function fakeWallet(captured: { method?: unknown }) {
  return {
    receivePayment: async ({ paymentMethod }: { paymentMethod: unknown }) => {
      captured.method = paymentMethod;
      return {
        paymentRequest: INVOICE,
        lightningReceiveDetails: {
          receiveRequestId: 'rr_1',
          status: 'pending',
          createdAt: 1_700_000_000,
          updatedAt: 1_700_000_000,
        },
      };
    },
  } as never;
}

describe('spark-receive-quote-core.getLightningQuote', () => {
  it('passes receiverIdentityPubkey through (server-readiness, D6-2)', async () => {
    const captured: { method?: { receiverIdentityPubkey?: string } } = {};
    const quote = await getLightningQuote({
      wallet: fakeWallet(captured) as never,
      amount: new Money({ amount: 100, currency: 'BTC', unit: 'sat' }),
      receiverIdentityPubkey: 'deadbeef',
    });
    expect(captured.method?.receiverIdentityPubkey).toBe('deadbeef');
    expect(quote.receiverIdentityPublicKey).toBe('deadbeef');
  });
  // + client path (no pubkey), computeQuoteExpiry, getAmountAndFee cases
});
```

- [ ] **Step 3: Verify + commit.** `bun run typecheck` → PASS. `bun --filter=@agicash/wallet-sdk run test` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): spark receive-quote core (session-agnostic getLightningQuote)

Port getLightningQuote/computeQuoteExpiry/getAmountAndFee + the create-quote param
types. getLightningQuote takes an explicit wallet + optional receiverIdentityPubkey
so the SAME fn serves client (user wallet) and the future S10 server (dedicated
wallet). A unit test drives the receiverIdentityPubkey path (server-readiness).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `SparkSendQuoteRepository`

**Files:** Create `src/internal/repositories/spark-send-quote-repository.ts` + `.test.ts`. **Port from** `app/features/send/spark-send-quote-repository.ts` + `app/features/send/spark-send-quote.ts` (for `SparkSendQuoteSchema`).

- [ ] **Step 1: Port `SparkSendQuoteSchema` into the repo file.** Copy the schema from `app/features/send/spark-send-quote.ts` verbatim (`z.intersection(Base, z.union([UNPAID, PENDING, COMPLETED, FAILED]))`), repointing `@agicash/money` (keep) + `zod/mini` (keep). Add the compile-time contract check (D6-4):

```ts
import { Money as MoneyClass } from '@agicash/money';
import { z } from 'zod/mini';
import type { SparkSendQuote } from '../../types/spark';

const SparkSendQuoteBaseSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  expiresAt: z.nullish(z.string()),
  amount: z.instanceof(MoneyClass),
  estimatedFee: z.instanceof(MoneyClass),
  paymentRequest: z.string(),
  paymentHash: z.string(),
  transactionId: z.string(),
  userId: z.string(),
  accountId: z.string(),
  version: z.number(),
  paymentRequestIsAmountless: z.boolean(),
});

const SparkSendQuoteSchema = z.intersection(
  SparkSendQuoteBaseSchema,
  z.union([
    z.object({ state: z.literal('UNPAID') }),
    z.object({
      state: z.literal('PENDING'),
      sparkId: z.string(),
      sparkTransferId: z.string(),
      fee: z.instanceof(MoneyClass),
    }),
    z.object({
      state: z.literal('COMPLETED'),
      sparkId: z.string(),
      sparkTransferId: z.string(),
      fee: z.instanceof(MoneyClass),
      paymentPreimage: z.string(),
    }),
    z.object({
      state: z.literal('FAILED'),
      failureReason: z.string(),
      sparkId: z.optional(z.string()),
      sparkTransferId: z.optional(z.string()),
      fee: z.optional(z.instanceof(MoneyClass)),
    }),
  ]),
);

type _SendFits = z.infer<typeof SparkSendQuoteSchema> extends SparkSendQuote
  ? true
  : never;
const _sendCheck: _SendFits = true;
void _sendCheck;
```

> If `_sendCheck` fails to assign, reconcile the schema optionals against `types/spark.ts` (the contract is the ground truth). `expiresAt` must be `string | null | undefined`-compatible on both sides (`z.nullish` ⇒ `?: string | null`).

- [ ] **Step 2: Implement the repository.** Constructor `(db: SupabaseClient<Database>, encryption: EncryptionService)`. Methods (signatures verbatim from master, adapted to DI + 2-arg errors):

```ts
create(params: CreateQuoteParams, options?: Options): Promise<SparkSendQuote>
markAsPending(input: { quote: SparkSendQuote; sparkSendRequestId: string; sparkTransferId: string; fee: Money }, options?: Options): Promise<SparkSendQuote>
complete(input: { quote: SparkSendQuote & { state: 'PENDING' }; paymentPreimage: string }, options?: Options): Promise<SparkSendQuote>
fail(quoteId: string, failureReason: string, options?: Options): Promise<SparkSendQuote>
get(id: string, options?: Options): Promise<SparkSendQuote | null>
getUnresolved(userId: string, options?: Options): Promise<SparkSendQuote[]>
private toQuote(data: AgicashDbSparkSendQuote): Promise<SparkSendQuote>
```

Apply these transforms (apply to **both** repo tasks):
- Replace `useEncryption()`/the `encryption: Encryption` ctor param with `private readonly encryption: EncryptionService`; each method that encrypts/decrypts does `const encryption = await this.encryption.get();` first (then `encryption.encrypt(...)` / in `toQuote` `encryption.decrypt(data.encrypted_data)`).
- `db: SupabaseClient<Database>` (not `AgicashDb`). RPC names verbatim: `create_spark_send_quote`, `mark_spark_send_quote_as_pending`, `complete_spark_send_quote`, `fail_spark_send_quote`. `get`/`getUnresolved` selects: `.from('spark_send_quotes').select().eq('id', id)` / `.eq('user_id', userId).in('state', ['UNPAID','PENDING'])`.
- Error handling: `create` → `if (error.code === '23505') throw new DomainError('A payment for this invoice is already being processed or was completed', 'duplicate'); throw classify(error);`. Every other `new Error('Failed to …', { cause })` → `throw classify(error)`.
- Drop `AllUnionFieldsRequired`; `toQuote` ends with `return SparkSendQuoteSchema.parse({ … })` over the same field map master uses (`sparkId: data.spark_id ?? undefined`, `fee: sendData.lightningFee`, etc.).
- `CreateQuoteParams` (input type) + `Options = { abortSignal?: AbortSignal }`: copy master's `CreateQuoteParams` (userId, accountId, amount: Money, estimatedFee: Money, paymentRequest, paymentHash, paymentRequestIsAmountless, expiresAt?: Date | null, purpose?: TransactionPurpose, transferId?). Encrypt via `SparkLightningSendDbDataSchema` (Task 1).
- Imports: `Database`/`AgicashDbSparkSendQuote` → `../db/database`; `SparkLightningSendDbDataSchema` → `../db/spark-send-quote-db-data`; `classify` → `../classify`; `DomainError` → `../../errors`; `EncryptionService` → `../crypto/encryption`; `Money` → `@agicash/money`; `TransactionPurpose` → `../../types/transaction`; `SparkSendQuote` → `../../types/spark`.

> Read `app/features/send/spark-send-quote-repository.ts` side-by-side; the method bodies are near-verbatim. Reconcile the RPC `Args` (`p_user_id`, `p_account_id`, `p_currency`, `p_payment_hash`, `p_payment_request_is_amountless`, `p_encrypted_data`, `p_expires_at`, `p_purpose`, `p_transfer_id`; mark-pending: `p_quote_id`, `p_spark_id`, `p_spark_transfer_id`, `p_encrypted_data`; complete: `p_quote_id`, `p_encrypted_data`; fail: `p_quote_id`, `p_failure_reason`) against `src/internal/db/database.types.ts`.

- [ ] **Step 3: Write the test** (`spark-send-quote-repository.test.ts`) — `makeFakeDb` + a real `EncryptionService` (random secp256k1 key, S5 pattern). Cover: (a) `get` → null when row absent; (b) `create` maps `23505` → `DomainError` (`'duplicate'`); (c) `toQuote` decrypts an RPC-returned UNPAID row into a `SparkSendQuote` (build `encrypted_data` via `(await encryption.get()).encrypt(sendDataFixture)` matching `SparkLightningSendDbDataSchema`, feed via `makeFakeDb({ rpcResult: { data: row, error: null } })`, call `create` or `markAsPending`, assert `state`/`amount`).

```ts
import { describe, expect, it } from 'bun:test';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { DomainError } from '../../errors';
import { EncryptionService } from '../crypto/encryption';
import { makeFakeDb } from '../test-support';
import { SparkSendQuoteRepository } from './spark-send-quote-repository';

const priv = secp256k1.utils.randomPrivateKey();
const pubHex = bytesToHex(secp256k1.getPublicKey(priv, true));
const encryption = new EncryptionService({
  getChildMnemonic: async () => 'm',
  getPrivateKeyBytes: async () => priv,
  getPublicKeyHex: async () => pubHex,
});

describe('SparkSendQuoteRepository', () => {
  it('get returns null when the row is absent', async () => {
    const db = makeFakeDb({ selectResult: { data: null, error: null } });
    expect(await new SparkSendQuoteRepository(db, encryption).get('x')).toBeNull();
  });

  it('create maps 23505 to a duplicate DomainError', async () => {
    const db = makeFakeDb({
      rpcResult: { data: null, error: { code: '23505', message: 'dup' } },
    });
    const repo = new SparkSendQuoteRepository(db, encryption);
    await expect(
      repo.create({ /* minimal valid CreateQuoteParams fixture */ } as never),
    ).rejects.toBeInstanceOf(DomainError);
  });

  // + toQuote decrypt round-trip for an UNPAID row
});
```

- [ ] **Step 4: Verify + commit.** `bun run typecheck` → PASS. `bun --filter=@agicash/wallet-sdk run test` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): spark send-quote repository

Port SparkSendQuoteRepository (create/markAsPending/complete/fail/get/getUnresolved
/toQuote) + SparkSendQuoteSchema over the RLS client + EncryptionService. classify()
error routing; 23505 -> duplicate DomainError. Offline-tested with makeFakeDb.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `SparkReceiveQuoteRepository`

**Files:** Create `src/internal/repositories/spark-receive-quote-repository.ts` + `.test.ts`. **Port from** `app/features/receive/spark-receive-quote-repository.ts` + `app/features/receive/spark-receive-quote.ts` (for `SparkReceiveQuoteSchema`).

- [ ] **Step 1: Port `SparkReceiveQuoteSchema` into the repo file.** Copy from `app/features/receive/spark-receive-quote.ts` verbatim — `z.intersection(Base, z.intersection(z.union([LIGHTNING, CASHU_TOKEN]), z.union([UNPAID|EXPIRED, PAID, FAILED])))`. The CASHU_TOKEN type member embeds `tokenReceiveData: CashuTokenMeltDataSchema` — **import it from `../db/cashu-token-melt-data`** (the shared domain schema extracted in Task 1, Step 4). Repoint `@agicash/money` (keep) + `zod/mini` (keep). Add the compile-time check `type _RecvFits = z.infer<typeof SparkReceiveQuoteSchema> extends SparkReceiveQuote ? true : never; const _recvCheck: _RecvFits = true; void _recvCheck;` (`SparkReceiveQuote` from `../../types/spark`).

> **Note (DB → domain mapping in `toQuote`):** the *DB* `encrypted_data` melt shape (`SparkLightningReceiveDbDataSchema.cashuTokenMeltData`, S5's `cashu-token-melt-db-data.ts`) has `tokenMintUrl`/`meltQuoteId`/…; the *domain* `tokenReceiveData` (the shared `cashu-token-melt-data.ts` schema, Task 1) has `sourceMintUrl`/`meltInitiated`/…. `toQuote` (Step 2) translates DB→domain verbatim per master (`sourceMintUrl: receiveData.cashuTokenMeltData.tokenMintUrl`, `meltInitiated: data.cashu_token_melt_initiated`, etc.).

- [ ] **Step 2: Implement the repository.** Constructor `(db: SupabaseClient<Database>, encryption: EncryptionService)` (**no `accountRepository`** — no spark RPC returns an account row). Methods (verbatim from master):

```ts
create(params: RepositoryCreateQuoteParams, options?: Options): Promise<SparkReceiveQuote>
complete(input: { quote: SparkReceiveQuote; paymentPreimage: string; sparkTransferId: string }, options?: Options): Promise<SparkReceiveQuote>
expire(quoteId: string, options?: Options): Promise<SparkReceiveQuote>
fail(input: { id: string; reason: string }, options?: Options): Promise<void>
markMeltInitiated(quote: SparkReceiveQuote & { type: 'CASHU_TOKEN' }, options?: Options): Promise<SparkReceiveQuote & { type: 'CASHU_TOKEN' }>
get(id: string, options?: Options): Promise<SparkReceiveQuote | null>
getPending(userId: string, options?: Options): Promise<SparkReceiveQuote[]>
private toQuote(data: AgicashDbSparkReceiveQuote): Promise<SparkReceiveQuote>
```

Apply Task 3's transforms. `RepositoryCreateQuoteParams` is imported from `../../domains/spark/spark-receive-quote-core` (Task 2). RPC names verbatim: `create_spark_receive_quote`, `complete_spark_receive_quote`, `expire_spark_receive_quote`, `fail_spark_receive_quote`, `mark_spark_receive_quote_cashu_token_melt_initiated`. Encrypt the DB data via `SparkLightningReceiveDbDataSchema` (Task 1). All RPC failures → `throw classify(error)`. `toQuote` decrypts `encrypted_data`, builds the domain `tokenReceiveData` from `receiveData.cashuTokenMeltData` (+ `meltInitiated: data.cashu_token_melt_initiated`) when present, and `return SparkReceiveQuoteSchema.parse({ … })` (drop `AllUnionFieldsRequired`). Imports: `RepositoryCreateQuoteParams` → `../../domains/spark/spark-receive-quote-core`; `SparkReceiveQuote` → `../../types/spark`; `AgicashDbSparkReceiveQuote`/`Database` → `../db/database`; `SparkLightningReceiveDbDataSchema` → `../db/spark-receive-quote-db-data`; `classify`/`EncryptionService` as Task 3.

> Read `app/features/receive/spark-receive-quote-repository.ts` side-by-side; bodies are near-verbatim. Reconcile RPC `Args` (`create`: `p_user_id`, `p_account_id`, `p_currency`, `p_payment_hash`, `p_expires_at`, `p_spark_id`, `p_receiver_identity_pubkey`, `p_receive_type`, `p_encrypted_data`, `p_purpose`, `p_transfer_id`; complete: `p_quote_id`, `p_spark_transfer_id`, `p_encrypted_data`; expire/markMelt: `p_quote_id`; fail: `p_quote_id`, `p_failure_reason`) against `database.types.ts`.

- [ ] **Step 3: Write the test** (`spark-receive-quote-repository.test.ts`) — `makeFakeDb` + real `EncryptionService`. Cover: (a) `get` → null when absent; (b) `toQuote` decrypts a LIGHTNING UNPAID row (build `encrypted_data` via the receive db-data schema + a `data.type = 'LIGHTNING'`, `data.state = 'UNPAID'` row); (c) `toQuote` decrypts a CASHU_TOKEN row (with `cashuTokenMeltData` + `cashu_token_melt_initiated: false`) and produces `quote.type === 'CASHU_TOKEN'` with `tokenReceiveData.meltInitiated === false`. Mirror Task 3's wiring.

- [ ] **Step 4: Verify + commit.** `bun run typecheck` → PASS. `bun --filter=@agicash/wallet-sdk run test` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): spark receive-quote repository

Port SparkReceiveQuoteRepository (create/complete/expire/fail/markMeltInitiated/get/
getPending/toQuote) + SparkReceiveQuoteSchema over the RLS client + EncryptionService.
Handles LIGHTNING and CASHU_TOKEN quotes; classify() error routing. Offline-tested
with makeFakeDb.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `SparkSendQuoteService`

**Files:** Create `src/domains/spark/spark-send-quote-service.ts` + `.test.ts`. **Port from** `app/features/send/spark-send-quote-service.ts`.

- [ ] **Step 1: Implement.** Constructor `(repository: SparkSendQuoteRepository)`. Drop `useSparkSendQuoteService`. Methods (signatures verbatim from master):

```ts
getLightningSendQuote(input: { account: SparkAccount; paymentRequest: string; amount?: Money<'BTC'> }): Promise<SparkLightningQuote>
createSendQuote(input: { userId: string; account: SparkAccount; quote: SparkLightningQuote; purpose?: TransactionPurpose; transferId?: string }): Promise<SparkSendQuote>
initiateSend(input: { account: SparkAccount; sendQuote: SparkSendQuote }): Promise<SparkSendQuote>
complete(quote: SparkSendQuote, paymentPreimage: string): Promise<SparkSendQuote>
fail(quote: SparkSendQuote, reason: string): Promise<SparkSendQuote>
get(quoteId: string): Promise<SparkSendQuote | null>
```

Apply these transforms (apply to **both** service tasks):
- Drop the `use*` hook + any react import. Plain class. Drop `measureOperation` — call `account.wallet.prepareSendPayment(...)` / `account.wallet.sendPayment(...)` directly.
- `SparkLightningQuote` type: copy from master into this file (paymentRequest, paymentHash, amountRequested, amountRequestedInBtc: Money<'BTC'>, amountToReceive, estimatedLightningFee: Money<'BTC'>, estimatedTotalFee, estimatedTotalAmount, paymentRequestIsAmountless, expiresAt: Date | null).
- Every user-facing `new DomainError(msg)` → `new DomainError(msg, code)` (D6-5): invalid invoice → `'invalid_invoice'`; expired → `'expired'`; insufficient balance → `'insufficient_balance'`; fee changed → `'fee_changed'`; already paid → `'already_paid'`. The internal `throw new Error('Unknown send amount')` → `new DomainError('Amount is required for amountless invoices', 'amount_required')`. The internal invariants `Expected bolt11Invoice payment method…` / `Breez SDK did not return lightningSendDetails…` → `new SdkError(msg, 'spark_unexpected_response')`. The `initiateSend` state guard `Cannot initiate send for quote that is not UNPAID…` → `new DomainError(msg, 'invalid_state')`; `complete`/`fail` state guards → `new DomainError(msg, 'invalid_state')`.
- `isInsufficentBalanceError`/`isInvoiceAlreadyPaidError` from `../../internal/lib/spark`. `parseBolt11Invoice` from `../../internal/lib/bolt11`. `Money` from `@agicash/money`. `SparkAccount` from `../../types/account`. `SparkSendQuote` from `../../types/spark`. `TransactionPurpose` from `../../types/transaction`. `DomainError`/`SdkError` from `../../errors`.
- Keep the balance check in `getLightningSendQuote` + `createSendQuote` (reads `account.balance ?? Money.zero(account.currency)`).

> Read `app/features/send/spark-send-quote-service.ts` end-to-end; bodies are near-verbatim. `initiateSend` is the **executeQuote kickoff primitive** (prepareSendPayment → sendPayment → `repository.markAsPending`); it returns the PENDING quote. `complete`/`fail` are the terminal primitives S7's Breez listener drives. Reconcile `prepareSendPayment`/`sendPayment` shapes against `node_modules/@agicash/breez-sdk-spark`.

- [ ] **Step 2: Write the test** (`spark-send-quote-service.test.ts`) — inject a fake `SparkSendQuoteRepository` + a fake `SparkAccount` whose `wallet` is hand-rolled. Cover the offline-classifiable methods:
  - `getLightningSendQuote`: a valid amount-bearing invoice + fake `wallet.prepareSendPayment` → `{ paymentMethod: { type:'bolt11Invoice', lightningFeeSats: 1 } }`, `account.balance` sufficient → returns a quote with `estimatedLightningFee`/`estimatedTotalAmount`; insufficient balance → `DomainError` (`'insufficient_balance'`); invalid invoice string → `DomainError` (`'invalid_invoice'`).
  - `initiateSend`: PENDING input → returned as-is (idempotent); non-UNPAID → `DomainError` (`'invalid_state'`); UNPAID happy path (fake `prepareSendPayment` + `sendPayment` → `{ payment: { id:'t1', fees: 2n }, lightningSendDetails: { sendRequestId:'sr1' } }`, estimatedFee ≥ lightningFeeSats) → calls `repo.markAsPending` with `sparkTransferId:'t1'`/`sparkSendRequestId:'sr1'`/fee; `sendPayment` throwing an `isInvoiceAlreadyPaidError` → `DomainError` (`'already_paid'`); throwing `isInsufficentBalanceError` → `DomainError` (`'insufficient_balance'`).
  - `complete`: COMPLETED input → returned as-is; non-PENDING → `DomainError`; PENDING → `repo.complete` called.
  - `fail`: FAILED input → returned as-is; not UNPAID/PENDING → `DomainError`; valid → `repo.fail`.

```ts
import { describe, expect, it } from 'bun:test';
import { Money } from '@agicash/money';
import { DomainError } from '../../errors';
import { SparkSendQuoteService } from './spark-send-quote-service';
import type { SparkSendQuoteRepository } from '../../internal/repositories/spark-send-quote-repository';

const repo = (over: Partial<SparkSendQuoteRepository> = {}): SparkSendQuoteRepository =>
  ({
    markAsPending: async ({ quote, sparkTransferId, sparkSendRequestId, fee }: never) =>
      ({ ...quote, state: 'PENDING', sparkTransferId, sparkId: sparkSendRequestId, fee }) as never,
    complete: async ({ quote }: { quote: { id: string } }) => ({ id: quote.id, state: 'COMPLETED' }) as never,
    fail: async (id: string) => ({ id, state: 'FAILED' }) as never,
    ...over,
  }) as unknown as SparkSendQuoteRepository;

describe('SparkSendQuoteService', () => {
  it('initiateSend returns a PENDING quote as-is (idempotent)', async () => {
    const svc = new SparkSendQuoteService(repo());
    const pending = { id: 'q1', state: 'PENDING' } as never;
    expect(await svc.initiateSend({ account: {} as never, sendQuote: pending })).toBe(pending);
  });

  it('initiateSend on UNPAID calls sendPayment then markAsPending', async () => {
    const account = {
      id: 'a1', currency: 'BTC', balance: new Money({ amount: 1000, currency: 'BTC', unit: 'sat' }),
      wallet: {
        prepareSendPayment: async () => ({ paymentMethod: { type: 'bolt11Invoice', lightningFeeSats: 1 } }),
        sendPayment: async () => ({ payment: { id: 't1', fees: 2n }, lightningSendDetails: { sendRequestId: 'sr1' } }),
      },
    } as never;
    const svc = new SparkSendQuoteService(repo());
    const quote = {
      id: 'q1', state: 'UNPAID', paymentRequest: 'lnbc...',
      amount: new Money({ amount: 100, currency: 'BTC', unit: 'sat' }),
      estimatedFee: new Money({ amount: 5, currency: 'BTC', unit: 'sat' }),
    } as never;
    const result = await svc.initiateSend({ account, sendQuote: quote });
    expect(result.state).toBe('PENDING');
  });

  // + getLightningSendQuote / complete / fail / already-paid / insufficient cases
});
```

> Build the fake wallet methods to match the exact breez-sdk return shapes the service reads. Keep `DomainError`/`SdkError` real (imported) where the service throws them.

- [ ] **Step 3: Verify + commit.** `bun run typecheck` → PASS. `bun --filter=@agicash/wallet-sdk run test` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): spark send-quote service

Port SparkSendQuoteService (getLightningSendQuote/createSendQuote/initiateSend/
complete/fail/get) with DI'd repo; 2-arg DomainError codes; measureOperation
stripped. initiateSend is the executeQuote kickoff primitive (sendPayment ->
markAsPending PENDING); complete/fail are the terminal primitives S7's Breez
listener drives. Offline-tested with a fake wallet + repo.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `SparkReceiveQuoteService`

**Files:** Create `src/domains/spark/spark-receive-quote-service.ts` + `.test.ts`. **Port from** `app/features/receive/spark-receive-quote-service.ts`.

- [ ] **Step 1: Implement.** Constructor `(repository: SparkReceiveQuoteRepository)`. Drop `useSparkReceiveQuoteService`. Methods (verbatim from master):

```ts
createReceiveQuote(params: CreateQuoteBaseParams): Promise<SparkReceiveQuote>
complete(quote: SparkReceiveQuote, paymentPreimage: string, sparkTransferId: string): Promise<SparkReceiveQuote>
expire(quote: SparkReceiveQuote): Promise<void>
fail(quote: SparkReceiveQuote, reason: string): Promise<void>
markMeltInitiated(quote: SparkReceiveQuote & { type: 'CASHU_TOKEN' }): Promise<SparkReceiveQuote & { type: 'CASHU_TOKEN' }>
get(quoteId: string): Promise<SparkReceiveQuote | null>
```

Apply transforms. `createReceiveQuote` builds `baseParams` from the `lightningQuote` (+ `computeQuoteExpiry`/`getAmountAndFee` from core) and calls `repository.create` for LIGHTNING **and** CASHU_TOKEN (verbatim — the CASHU_TOKEN path threads `meltData`). The state guards (`Cannot complete quote that is not unpaid…` / `Cannot expire…` / `Cannot fail…` / `Cannot expire quote that has not expired yet` / `Invalid quote type…` / `Invalid quote state…`) → `new DomainError(msg, 'invalid_state')` (D6-5). `CreateQuoteBaseParams`/`computeQuoteExpiry`/`getAmountAndFee` from `./spark-receive-quote-core`. `DomainError` from `../../errors`. `SparkReceiveQuote` from `../../types/spark`.

> Read `app/features/receive/spark-receive-quote-service.ts` end-to-end; bodies are near-verbatim. `complete` is the terminal primitive S7's Breez receive listener drives; `expire`/`fail`/`markMeltInitiated` are S7-consumed primitives. `createReceiveQuote` is consumed by the domain (LIGHTNING) + S7's cross-account claim (CASHU_TOKEN).

- [ ] **Step 2: Write the test** (`spark-receive-quote-service.test.ts`) — inject a fake `SparkReceiveQuoteRepository`. Cover:
  - `createReceiveQuote` (LIGHTNING): a fake `lightningQuote` (`{ id, invoice: { paymentRequest, paymentHash, amount, memo, expiresAt } }`) → `repo.create` called with `receiveType: 'LIGHTNING'` + `expiresAt` = the invoice expiry + `totalFee` zero.
  - `createReceiveQuote` (CASHU_TOKEN): same + token fields → `repo.create` called with `receiveType: 'CASHU_TOKEN'` + `meltData` populated + `totalFee = cashuReceiveFee + lightningFeeReserve` + `expiresAt` = min(invoice, meltQuote).
  - `complete`: PAID input → returned as-is; non-UNPAID → `DomainError`; UNPAID → `repo.complete` called with `sparkTransferId`.
  - `expire`/`fail`/`markMeltInitiated`: idempotent no-op + `DomainError` on wrong state/type + `repo.*` called when valid.

- [ ] **Step 3: Verify + commit.** `bun run typecheck` → PASS. `bun --filter=@agicash/wallet-sdk run test` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): spark receive-quote service

Port SparkReceiveQuoteService (createReceiveQuote for LIGHTNING + CASHU_TOKEN,
complete/expire/fail/markMeltInitiated/get) with DI'd repo; 2-arg DomainError codes.
complete is the terminal primitive S7's Breez receive listener drives; the
CASHU_TOKEN create path is consumed by S7's cross-account claim. Offline-tested.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `createSparkDomain` (partial domain)

**Files:** Create `src/domains/spark/spark-domain.ts` + `.test.ts`.

- [ ] **Step 1: Implement.** Compose the repos + services into the `SparkDomain`; `send.createLightningQuote`/`failQuote`/`get` + `receive.createLightningQuote`/`get` are real, `send.executeQuote` throws `NotImplementedError`. `createSparkDomain` receives **only** the shared `ctx` (no `accountRepository`). Mirror `createCashuDomain`'s `requireUserId` + `resolveDestination` (ln-address) helpers:

```ts
import type { Money } from '@agicash/money';
import type { SparkDomain } from '../../domains';
import { DomainError, NotImplementedError, SdkError } from '../../errors';
import { getCurrentUserId } from '../../internal/connections/open-secret';
import {
  buildLightningAddressFormatValidator,
  getInvoiceFromLud16,
  isLNURLError,
} from '../../internal/lib/lnurl';
import { SparkReceiveQuoteRepository } from '../../internal/repositories/spark-receive-quote-repository';
import { SparkSendQuoteRepository } from '../../internal/repositories/spark-send-quote-repository';
import type { DomainContext } from '../context';
import { createExchangeRateDomain } from '../exchange-rate/exchange-rate-domain';
import { getLightningQuote as getReceiveLightningQuote } from './spark-receive-quote-core';
import { SparkReceiveQuoteService } from './spark-receive-quote-service';
import { SparkSendQuoteService } from './spark-send-quote-service';

export function createSparkDomain(ctx: DomainContext): SparkDomain {
  const { supabase, encryption } = ctx.connections;

  const sendQuoteRepo = new SparkSendQuoteRepository(supabase, encryption);
  const receiveQuoteRepo = new SparkReceiveQuoteRepository(supabase, encryption);

  const sendQuoteService = new SparkSendQuoteService(sendQuoteRepo);
  const receiveQuoteService = new SparkReceiveQuoteService(receiveQuoteRepo);

  const exchangeRate = createExchangeRateDomain();

  const isLightningAddress = buildLightningAddressFormatValidator({
    message: 'invalid',
    allowLocalhost: ctx.config.allowLocalhostLightningAddress ?? false,
  });

  const requireUserId = async (): Promise<string> => {
    const id = await getCurrentUserId(ctx.config.storage);
    if (!id) throw new SdkError('No active session', 'NOT_AUTHENTICATED');
    return id;
  };

  /** Resolve `destination` to a bolt11 invoice; ln-address resolves via LNURL-pay using `amountBtc`. */
  const resolveDestination = async (
    destination: string,
    amountBtc?: Money<'BTC'>,
  ): Promise<string> => {
    if (isLightningAddress(destination) !== true) return destination;
    if (!amountBtc) {
      throw new DomainError(
        'Amount is required to send to a lightning address',
        'amount_required',
      );
    }
    const result = await getInvoiceFromLud16(destination, amountBtc);
    if (isLNURLError(result)) throw new DomainError(result.reason, 'lnurl_error');
    return result.pr;
  };

  return {
    send: {
      async createLightningQuote({ account, destination, amount }) {
        const userId = await requireUserId();
        const amountBtc =
          amount === undefined
            ? undefined
            : amount.currency === 'BTC'
              ? (amount as Money<'BTC'>)
              : ((await exchangeRate.convert({ amount, to: 'BTC' })) as Money<'BTC'>);

        const paymentRequest = await resolveDestination(destination, amountBtc);

        const quote = await sendQuoteService.getLightningSendQuote({
          account,
          paymentRequest,
          amount: amountBtc,
        });

        return sendQuoteService.createSendQuote({ userId, account, quote });
      },

      executeQuote() {
        throw new NotImplementedError('spark.send.executeQuote');
      },

      async failQuote(quote, reason) {
        await sendQuoteService.fail(quote, reason);
      },

      async get(quoteId) {
        return sendQuoteRepo.get(quoteId);
      },
    },

    receive: {
      async createLightningQuote({ account, amount, description, purpose }) {
        const userId = await requireUserId();
        const lightningQuote = await getReceiveLightningQuote({
          wallet: account.wallet,
          amount,
          description,
        });

        return receiveQuoteService.createReceiveQuote({
          userId,
          account,
          lightningQuote,
          receiveType: 'LIGHTNING',
          purpose,
        });
      },

      async get(quoteId) {
        return receiveQuoteRepo.get(quoteId);
      },
    },
  };
}
```

> **Assembly notes (resolve while implementing):**
> - `send.createLightningQuote` mirrors `createCashuDomain.send.createLightningQuote` (read it + master's `useCreateSparkLightningSendQuote` + `useInitiateSparkSendQuote`). Spark has **no `destinationDetails`** (the model lacks it), so `resolveDestination` returns just the `paymentRequest`. The `amountBtc` conversion guards `amount.currency === 'BTC'` to avoid a needless rate round-trip; `getLightningSendQuote` needs a BTC amount for amountless invoices, and `resolveDestination` needs it for ln-addresses.
> - `receive.createLightningQuote` forwards the contract's `purpose` (`'PAYMENT'|'BUY_CASHAPP'`) straight into `createReceiveQuote`; this is type-safe because `CreateQuoteBaseParams.purpose` is `TransactionPurpose = 'PAYMENT'|'BUY_CASHAPP'|'TRANSFER'` (a superset — verified). No `transferId` on the public contract method (S8 transfers thread it via the service directly).
> - `executeQuote` is the ONLY stubbed method (S7). `failQuote`/both `createLightningQuote`/both `get` are real.

- [ ] **Step 2: Write the test** (`spark-domain.test.ts`) — build a `ctx` with `makeFakeDb` + the S5-style connections fakes (`encryption`, `storage` with `jwtWith({ sub })`), no `accountRepository`. Assert:
  - `executeQuote` throws `NotImplementedError`.
  - `failQuote` calls through (fake repo `fail` resolves) without throwing.
  - `receive.createLightningQuote` composes core `getLightningQuote` + `createReceiveQuote`: pass a `SparkAccount` whose `wallet.receivePayment` is faked (returns a valid bolt11 + `lightningReceiveDetails`) → assert a quote is returned (the fake `supabase.rpc('create_spark_receive_quote')` returns a LIGHTNING row that `toQuote` maps).
  - `send.get`/`receive.get` delegate to the repos (fake `selectResult`).

```ts
it('executeQuote is NotImplemented (S7)', () => {
  const domain = createSparkDomain(ctx);
  expect(() => domain.send.executeQuote({} as never)).toThrow(NotImplementedError);
});
```

> Build `ctx.connections.supabase` via `makeFakeDb` so the repo RPC/select calls resolve; `ctx.config.storage` via `inMemoryStorage` seeded with a `jwtWith({ sub: 'u1' })` so `requireUserId` resolves. Keep the wallet fakes minimal (only the methods each path calls).

- [ ] **Step 3: Verify + commit.** `bun run typecheck` → PASS. `bun --filter=@agicash/wallet-sdk run test` → PASS.

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): createSparkDomain (create/read/fail real; executeQuote S7)

Compose the spark repos + services into SparkDomain: send.createLightningQuote/
failQuote/get + receive.createLightningQuote/get are real (ln-address resolution
mirrors cashu); send.executeQuote throws NotImplementedError (the Breez-event-driven
kickoff + completion listener + the §8 balance reconcile land in S7). Tested.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Wire spark into `Sdk` + full gate

**Files:** Modify `src/sdk.ts`, `src/sdk.test.ts`.

- [ ] **Step 1: Wire the domain.** In `src/sdk.ts`: import `createSparkDomain` from `./domains/spark/spark-domain`; remove the `SparkReceiveOps`/`SparkSendOps` imports if now unused; change the `readonly spark: SparkDomain = { send: notImplementedDomain…, receive: notImplementedDomain… }` field to a declared `readonly spark: SparkDomain;`. In the constructor, after `this.cashu = createCashuDomain(ctx, accountRepository);`:

```ts
    this.spark = createSparkDomain(ctx);
```

Update the class JSDoc: now `auth`, `user`, `accounts`, `scan`, `exchangeRate`, `cashu`, `spark` are real (cashu's `executeQuote`/`receiveToken` + spark's `executeQuote` pending S7); 4 domains (`transactions`, `contacts`, `transfers`, `background`) stubbed.

- [ ] **Step 2: Update `sdk.test.ts`.** Add/extend:

```ts
  it('spark create/read methods are wired (not NotImplemented)', async () => {
    const sdk = await Sdk.create(config);
    expect(typeof sdk.spark.send.createLightningQuote).toBe('function');
    expect(typeof sdk.spark.send.get).toBe('function');
    expect(typeof sdk.spark.receive.createLightningQuote).toBe('function');
    expect(typeof sdk.spark.receive.get).toBe('function');
    await sdk.destroy();
  });
  it('spark executeQuote throws NotImplemented (S7)', async () => {
    const sdk = await Sdk.create(config);
    expect(() => sdk.spark.send.executeQuote({} as never)).toThrow(NotImplementedError);
    await sdk.destroy();
  });
  it('still-unimplemented domains throw NotImplementedError', async () => {
    const sdk = await Sdk.create(config);
    expect(() => sdk.transactions.countPendingAck()).toThrow(NotImplementedError);
    expect(() => sdk.contacts.list()).toThrow(NotImplementedError);
    expect(() => sdk.background.state()).toThrow(NotImplementedError);
    await sdk.destroy();
  });
```

(Replace any prior assertion that `spark.send.*` throws `NotImplemented` — the create/read/fail methods are real now; use `spark.send.executeQuote` for the still-stubbed check. Keep a still-stubbed domain like `transactions`/`contacts`/`background` for the catch-all check.)

> `Sdk.create(config)` builds the spark repos/services in the constructor (synchronous, inert — no DB/Breez calls until a method runs). Confirm no import-time side effects; prefer no `mock.module`.

- [ ] **Step 3: Run the FULL gate.** `bun run typecheck` → PASS (all packages; web untouched, still not importing the SDK). `bun run test` → PASS (all SDK unit tests incl. the new spark ones).

- [ ] **Step 4: Commit.**

```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(wallet-sdk): wire real spark domain into Sdk

Replace the spark notImplementedDomain stub with createSparkDomain. spark
create/read/fail are live; send.executeQuote stays NotImplemented (S7). 7 of 11
domains now real (auth/user/accounts/scan/exchangeRate/cashu/spark).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Verification Gate (slice done when)

- `bun run typecheck` green (all packages) and `bun run test` green (all new SDK spark unit tests).
- **S6 load-bearing correctness covered by unit tests:** the two DB-data schemas parse round-trip (T1); the receive core `getLightningQuote` passes `receiverIdentityPubkey` through (**server-readiness, D6-2**) + `computeQuoteExpiry`/`getAmountAndFee` (T2); each repository's `toQuote` decrypt-mapping + the `23505`→`duplicate` `DomainError` (T3) + the LIGHTNING & CASHU_TOKEN row mapping (T4); the send service's state guards + idempotent no-ops + `initiateSend`→`sendPayment`→`markAsPending` + the already-paid/insufficient classifications (T5); the receive service's LIGHTNING & CASHU_TOKEN create + state guards (T6); `executeQuote` throws `NotImplementedError` and the rest are real (T7–T8).
- **No named S6 regression is in scope** per spec §10 — the **§8 stale-balance `synced` re-read** (the named §10 regression) lives in the balance listener, which is **S7**. Note this explicitly so S7 owns the §8 regression test. The `initLogging` single-global guard already exists in `breez.ts` (S4) — S6 adds nothing there.
- `types/spark.ts` is unchanged (the public types already shipped); the ported zod schemas (`SparkSendQuoteSchema`/`SparkReceiveQuoteSchema`) infer to types assignable to the contract types (the `_Fits` compile-time checks).
- The web still typechecks (it does not import the SDK yet).
- Spot-check by reading the test assertions: the decrypt round-trips, the receiverIdentityPubkey passthrough, the error classification, the service guards, and the partial-domain `NotImplementedError`.

---

## Self-Review

**1. Spec coverage (§7b spark row + §6 contract + the confirmed forks):**
- send/receive **quote (schema/service/repo)**: ✔ (T1 schemas, T3–T4 repos, T5–T6 services). `SparkSendQuoteSchema`/`SparkReceiveQuoteSchema` ported alongside the repos (the contract ships only TS types, D6-4).
- **client + server spark wallet** (§7b row 06): client ✔ (full domain); server = the **session-agnostic primitive** is built + proven server-ready (T2 `receiverIdentityPubkey` test). The server *wiring* (config/wallet/repo/service/facade) defers to S10 (D6-2) — surfaced as a fork and confirmed.
- **`shared/spark` lifecycle + balance-listener** (§7b row 06): the lifecycle (connect-once memo + offline stub) already shipped in S4 (`SparkWalletService`); the **balance listener + §8 `synced` reconcile** is held for S7 (D6-1, §8) — ✔ held out, S7 owns its regression test.
- **`executeQuote` + the task processors**: → S7 (D6-1). ✔ held out; `executeQuote` ships `NotImplementedError` (T7/T8). The per-op primitives it needs (`initiateSend`/`complete`/`fail` + receive `complete`/`expire`/`fail`/`markMeltInitiated`) are built + tested (T5–T6).
- contract create/read surface (`createLightningQuote` send+receive, `failQuote`, `get`): ✔ assembled in the domain (T7).
- CASHU_TOKEN spark receive (needed by S7's cross-account claim): the service + repo create path ✔ built + tested (T4, T6); no public domain method exposes it (S7 calls the service directly).

**2. Placeholder scan:** Vendored files (2 DB schemas) are concrete copies with named source paths + import-fix instructions + tests — the S2–S5-blessed pattern. Net-new logic (the lib barrel, the receive core ported verbatim, the partial-domain wiring shown in full, ALL tests) is shown in full. The repos/services are **faithful ports** of named master files with: the exact constructor + every public method signature, the enumerated transform rules (DI deps; 2-arg `DomainError` codes; `EncryptionService.get()`; drop `measureOperation`/`AllUnionFieldsRequired`/hooks; verbatim RPC names confirmed present in `database.types.ts`), the full tests, and precise "reconcile breez-sdk call X against node_modules + master file" pointers — not open TODOs. The assembled domain (T7) carries the full body + compose-order notes citing the cashu domain + master hooks to reproduce.

**3. Type consistency:** `RepositoryCreateQuoteParams`/`CreateQuoteBaseParams`/`SparkReceiveLightningQuote` (T2 core) consumed by `SparkReceiveQuoteService` (T6) + the receive repo (T4). `SparkLightningSendDbDataSchema` (T1) used by the send repo (T3); `SparkLightningReceiveDbDataSchema` (T1, reusing the S5 `cashu-token-melt-db-data`) used by the receive repo (T4). `SparkSendQuoteSchema` (T3) / `SparkReceiveQuoteSchema` (T4) infer to the contract `types/spark.ts` types (asserted by the `_Fits` checks). The two repos (T3–T4) consumed by the two services (T5–T6) + the domain (T7). `SparkLightningQuote` (T5) consumed by `createSendQuote` (T5) + the domain (T7). `createSparkDomain(ctx)` (T7) wired in `sdk.ts` (T8) — **no `accountRepository`** (unlike cashu). `NotImplementedError`/`DomainError`/`SdkError` all correct arity (2-arg except `NotImplementedError`).

**4. Fork resolutions honored:** `executeQuote` = `NotImplementedError` (D6-1); session-agnostic core + client only, ALL server wiring deferred to S10, server-readiness proven by a `receiverIdentityPubkey` unit test (D6-2); the §8 balance-listener `synced` reconnect + the Breez event processors NOT built here (S7). The slice is internally complete + unit-testable with zero Breez-event/task-loop dependencies.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-06-13-wallet-sdk-06-spark-ops.md`. **Subagent-Driven (recommended)** — fresh subagent per task + two-stage review. Task order is dependency-forced and linear: **T1** (lib barrel + DB schemas) → **T2** (receive core; ships `RepositoryCreateQuoteParams`) → **T3** (send repo + `SparkSendQuoteSchema`) → **T4** (receive repo + `SparkReceiveQuoteSchema`; needs T2) → **T5** (send service; needs T3) → **T6** (receive service; needs T4 + T2) → **T7** (domain; needs T5 + T6 + T2) → **T8** (Sdk wire + full gate).

**Testing note (carryover):** Prefer DI over `mock.module` — every repo (injected `supabase`/`EncryptionService`) and service (injected repo + the live/fake `account.wallet`) is testable without module mocks, sidestepping bun's process-global `mock.module`. Where `mock.module` is unavoidable, that test file MUST add `afterAll(() => mock.restore())` + the COMPLETE `breezModuleMock`/`openSecretModuleMock` factories from `internal/test-support.ts`. None should be needed in S6.

**Carryover to S7 (record after S6):**
- `executeQuote` = wire `initiateSend` + register the per-account Breez event listener (`paymentSucceeded`→`complete`, `paymentFailed`→`fail`) + the **balance listener with the §8 `synced` re-read** (the named §10 regression — owns its regression test). Port from `app/features/shared/spark.ts:180-230` (`useTrackAndUpdateSparkAccountBalances`) + `spark-{send,receive}-quote-hooks.ts` (`useOnSparkSendStateChange`/`useOnSparkReceiveStateChange`/`useProcessSpark*Tasks`). The receive-side `synced`→expiry check + the CASHU_TOKEN melt path (`useOnMeltQuoteStateChange` → `initiateMelt`/`markMeltInitiated`) are also S7 (the melt path needs S5's cashu wallet + the WS melt-quote subscription manager S7 vendors).
- The cross-account cashu-token→spark claim consumes `SparkReceiveQuoteService.createReceiveQuote({ receiveType: 'CASHU_TOKEN', … })` (built in S6).

**Carryover to S10 (record after S6):**
- Server spark: add `config.serverSparkMnemonic`; build a dedicated server `SparkWalletService` instance (`new SparkWalletService((network) => connectBreez({ apiKey, network, storageDir: serverStorageDir, debugLogging }, config.serverSparkMnemonic))` — own storageDir, distinct from the user wallet); port `SparkReceiveQuoteRepositoryServer` (`encryptToPublicKey`, service-role, returns minimal `SparkReceiveQuoteCreated`) + `SparkReceiveQuoteServiceServer` (reuses the S6 `getLightningQuote` core with `receiverIdentityPubkey = user.sparkIdentityPublicKey`). `encryptToPublicKey` ports from `app/features/shared/encryption.ts`. No `SparkWalletService` class change needed (confirmed S6).
