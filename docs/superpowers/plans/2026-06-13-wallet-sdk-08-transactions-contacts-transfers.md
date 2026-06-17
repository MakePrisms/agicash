# Wallet SDK — S8: Transactions + Contacts + Transfers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the three remaining read/CRUD domains — `transactions` (cursor-paginated history + ack), `contacts` (CRUD + username search), `transfers` (cross-account cashu↔spark-via-LN quote + paired-quote persist with the §10 auto-fail) — by porting the web's repos/services + the deferred internal transaction-detail DB-data parsers into the SDK, wiring them into `sdk.ts`, and verifying with SDK unit tests alone.

**Architecture:** Slice S8 of the no-cache full migration (spec §9 Phase 1, built "dark" — verified by SDK unit tests; the web is untouched until cut-over). The three domain *interfaces* + *entity types* already exist (PR1119, in `domains.ts` + `src/types/*` + the public barrel). S8 builds the **implementations + repositories + the deferred internal DB-data parsers** (decision 7-ii). Transactions are **read-mostly** (rows are written server-side by the cashu/spark quote RPCs; the SDK never inserts a transaction row — its only transaction write is `acknowledge`). A transfer is **not a stored entity** — it is two `Transaction`s (a SEND debit + a RECEIVE credit) linked by a shared `transferId`; `transfers` persists the paired send+receive *quotes* (both tagged `purpose:'TRANSFER'`), and the §10 regression (receive-auto-fails-on-send-failure) is an **initiation-time compensating action only** (no DB trigger, no runtime linkage). Unlike S7, S8 domains are **wired live** into `sdk.ts` (they have no orchestrator dependency); the only deferred entry point that stays `NotImplementedError` after S8 is `background`.

**Tech Stack:** TypeScript, `bun test` (+ `bun:test` `mock`), `zod/mini`, `@agicash/money`, `@noble/curves`/`@noble/hashes` (test ECIES round-trips), the SDK's `SdkEventEmitter`. Package manager: `bun`/`bunx` only. CI gate per task: `bun run typecheck` + `bun run test` (NOT `fix:all`).

## Global Constraints

- `SdkError`/`DomainError` take **`(message, code)`**; `NotImplementedError` takes **`(method)`**. Every ported throw needs a `code`. Repo DB errors go through `classify(error)` (the S3–S6 convention), except the one special-cased contact `LIMIT_REACHED` hint.
- **Never** use bare `mock.module` (process-global; leaked into 100+ sibling tests in S3/S5). Repos are unit-tested against the **`makeFakeDb`** mocked Supabase client with **real ECIES encrypt/decrypt round-trips** (random-key `EncryptionService`, the S5/S6 pattern). Domains take DI'd deps; assert emissions on a **real `SdkEventEmitter`**.
- Emit SDK events **only on a real state transition** (decision D4 carried from 07b): `transaction:updated` fires from `acknowledge` only when the status actually flips `pending → acknowledged` (and carries the re-read, version-incremented entity); `contact:created`/`contact:deleted` fire only after a successful DB write.
- **NO `transfer:*` events** (spec decision 5). `transfers.executeQuote` emits nothing aggregate; the two legs' own `transaction:*` events (emitted by the S9 realtime forwarder) are correlated consumer-side by `transferId`.
- Per-task gate: `bun run typecheck` + `bun run test` (run from `packages/wallet-sdk/`). **One git commit per task**, message `feat(wallet-sdk): …`.
- bun/bunx only. Worktree root is the cwd; SDK paths are under `packages/wallet-sdk/`.

---

## Background facts (verified against current code 2026-06-18 — do not re-derive)

### The three contract interfaces (`src/domains.ts`, declarations only)

```ts
export interface TransactionsDomain {
  list(params?: { accountId?: string; cursor?: TransactionCursor; pageSize?: number }):
    Promise<{ transactions: Transaction[]; nextCursor: TransactionCursor | null }>;
  get(id: string): Promise<Transaction | null>;
  countPendingAck(): Promise<number>;
  acknowledge(transaction: Transaction): Promise<void>;
}
export interface ContactsDomain {
  list(): Promise<Contact[]>;
  get(id: string): Promise<Contact | null>;
  add(params: { username: string }): Promise<Contact>;
  remove(contact: Contact): Promise<void>;
  search(params: { query: string }): Promise<UserProfile[]>;
}
export interface TransfersDomain {
  createQuote(params: { sourceAccount: Account; destinationAccount: Account; amount: Money }): Promise<TransferQuote>;
  executeQuote(quote: TransferQuote): Promise<TransferResult>;
}
```

### Entity types (already in `src/types/*`, already re-exported from `src/index.ts` — do NOT re-declare or re-export)

- `Transaction` = `(TransactionByType & { purpose:'TRANSFER'; details:{ transferId:string } }) | (TransactionByType & { purpose:'PAYMENT'|'BUY_CASHAPP' })`. `BaseTransaction` carries `id, userId, direction, type, state, accountId:string|null, accountName, accountType, accountPurpose, amount:Money, details:TransactionDetails, reversedTransactionId?, purpose, acknowledgmentStatus:'pending'|'acknowledged'|null, createdAt:string (ISO), pendingAt?/completedAt?/failedAt?/reversedAt?, version:number`.
- `TransactionCursor = { stateSortOrder:number; createdAt:string; id:string }`.
- `TransactionDetails` = a 6-variant union (`src/types/transaction-details.ts`); the SDK owns these PUBLIC types. The parallel **DB-data union + parsers are INTERNAL** (decision 7-ii) — S8 builds them.
- `Contact = { id:string; ownerId:string; username:string; lud16:string; createdAt:Date }` (NOTE: `createdAt` is **`Date`**; NO `version` column). `UserProfile = { id:string; username:string; lud16:string }`.
- `TransferLeg = { account:CashuAccount; fee:Money } | { account:SparkAccount; fee:Money }`. `TransferQuote = { amount; amountToReceive; totalFees; totalCost; receive:TransferLeg; send:TransferLeg }` (slim, ephemeral, no live quote, no id). `TransferResult = { transferId; receiveTransactionId; sendTransactionId }`.

### Events (`src/events.ts`, payloads exact — already declared)

```ts
'transaction:created': { transaction: Transaction };
'transaction:updated': { transaction: Transaction };   // "apply by transaction.version"
'contact:created':     { contact: Contact };
'contact:deleted':     { contactId: string };           // asymmetric: only the id
// NO transfer:* events (decision 5)
```
`SdkEventEmitter` (`src/internal/event-emitter.ts`): `emit(event, data)`, `on(event, handler) => () => void`. Tests construct a real `new SdkEventEmitter<SdkEventMap>()` and `.on(...)`.

### DB surface (already in `src/internal/db/database.types.ts`)

- `wallet.contacts` Row: `{ created_at:string; id:string; owner_id:string; username:string|null }`. **`username` is nullable.**
- RPC `find_contact_candidates`: `Args { current_user_id:string; partial_username:string }` → `Returns { id:string; username:string }[]` (NO lud16 — derive it).
- RPC `list_transactions`: `Args { p_user_id:string; p_account_id?; p_cursor_created_at?; p_cursor_id?; p_cursor_state_sort_order?; p_page_size? }` → `Returns` the full transaction row shape (incl. `encrypted_transaction_details:string`, `transaction_details:Json|null`, `state_sort_order:number|null`, `account_name/type/purpose`, `version`, …). **The RPC's SQL filters `state in ('PENDING','COMPLETED','REVERSED')` (excludes DRAFT/FAILED); `get`/`countPendingAck` do NOT filter — preserve this asymmetry.**
- `wallet.transactions` Row has `account_name/account_type/account_purpose/currency/encrypted_transaction_details/transaction_details/state_sort_order/version/...` (so `get(id)` via `.from('transactions').select()` can build a full `Transaction`).

### The 6 DB-data schemas the parsers consume ALREADY EXIST in the SDK (built S5/S6) — import, don't re-port

| Web `~/features/agicash-db/json-models` export | SDK location |
|---|---|
| `CashuLightningSendDbDataSchema` | `src/internal/db/cashu-send-quote-db-data.ts` |
| `CashuLightningReceiveDbDataSchema` | `src/internal/db/cashu-receive-quote-db-data.ts` |
| `CashuSwapSendDbDataSchema` | `src/internal/db/cashu-send-swap-db-data.ts` |
| `CashuSwapReceiveDbDataSchema` | `src/internal/db/cashu-receive-swap-db-data.ts` |
| `SparkLightningSendDbDataSchema` | `src/internal/db/spark-send-quote-db-data.ts` |
| `SparkLightningReceiveDbDataSchema` | `src/internal/db/spark-receive-quote-db-data.ts` |
| `DestinationDetailsSchema` (web `~/features/send/cashu-send-quote`) | `src/internal/db/cashu-send-quote-db-data.ts` |

The cashu/spark **receive** DbData schemas carry an optional `cashuTokenMeltData` field (the token-receive parser does `z.required(...,{ cashuTokenMeltData:true })`). `Json` type → `src/internal/db/database.types.ts`.

### Repo + test conventions (verified precedents)

- **Simple repo** (`src/internal/repositories/user-repository.ts`): `constructor(private readonly db: SupabaseClient<Database>)`; `if (error) throw classify(error)` (import `{ classify } from '../classify'`); `maybeSingle()` → `null`. `import type { Database } from '../db/database'`.
- **Encryption repo** (`src/internal/repositories/cashu-receive-quote-repository.ts`): `constructor(db, private readonly encryption: EncryptionService, …)`; decrypt via `const enc = await this.encryption.get(); const decrypted = await enc.decrypt(row.encrypted_xxx)`.
- **`EncryptionService`** (`src/internal/crypto/encryption.ts`): `new EncryptionService(keyProvider).get(): Promise<Encryption>` where `Encryption = { encrypt, decrypt, encryptBatch, decryptBatch }`.
- **Test harness** (`src/internal/test-support.ts`): `makeFakeDb({ selectResult?, updateResult?, rpcResult?, calls? })` returns a chainable fake `SupabaseClient<Database>`. `from(t)` → builder where `select/eq/in/order/limit/abortSignal` return `this`, `insert`/`update` return a builder, `single`/`maybeSingle`/`then` resolve to `selectResult` (or `updateResult` after `update()`); `rpc(name,args)` resolves to `rpcResult`. **`makeFakeDb` has no `.delete()` — T5 adds it.** Real-ECIES test setup:
  ```ts
  import { secp256k1 } from '@noble/curves/secp256k1';
  import { bytesToHex } from '@noble/hashes/utils';
  import { EncryptionService } from '../crypto/encryption';
  const priv = secp256k1.utils.randomPrivateKey();
  const pubHex = bytesToHex(secp256k1.getPublicKey(priv, true));
  const encryption = new EncryptionService({
    getChildMnemonic: async () => 'm',
    getPrivateKeyBytes: async () => priv,
    getPublicKeyHex: async () => pubHex,
  });
  const enc = async (v: unknown) => (await encryption.get()).encrypt(v);
  ```

### Domain factory convention (`src/domains/accounts/accounts-domain.ts`, `cashu-domain.ts`, `spark-domain.ts`)

- `export function createXDomain(ctx: DomainContext, …): XDomain { … }`. `DomainContext = { config, connections, emitter }`.
- User-scoped resolve: `const requireUserId = async () => { const id = await getCurrentUserId(ctx.config.storage); if (!id) throw new SdkError('No active session','NOT_AUTHENTICATED'); return id; };` (`import { getCurrentUserId } from '../../internal/connections/open-secret'`).
- Emit via `ctx.emitter.emit('event', payload)`.
- Quote services are built inside each factory from `ctx.connections` (`{ supabase, encryption, cashuCrypto }`) + the passed `accountRepository`. `createTransfersDomain` rebuilds the four it needs (see Decision D2).
- `canSendToLightning` / `canReceiveFromLightning` live in `src/domains/accounts/account-utils.ts`.

### `sdk.ts` assembly (current — `src/sdk.ts`)

Lines 55–64 declare `transactions`/`contacts`/`transfers`/`background` as field initializers `= notImplementedDomain<T>(name)`. The constructor builds `const ctx: DomainContext = { config, connections, emitter }`, then `const accountRepository = new AccountRepository(connections.supabase, connections.encryption, connections.cashuWallets, connections.sparkWallets, connections.mintAuth, connections.getCashuSeed)`, then assigns the real domains (`createAccountsDomain(ctx, accountRepository)`, `createCashuDomain(ctx, accountRepository)`, `createSparkDomain(ctx)`, …). S8 drops the 3 transactions/contacts/transfers initializers to bare `readonly x: XDomain;` and assigns them in the constructor (keeping `background` on `notImplementedDomain`).

---

## Decisions (forks resolved before writing — carry, do NOT re-litigate)

The grounding workflow surfaced design forks not fully pinned by the starting notes. Each is resolved below from the contract + the no-cache architecture; the owner can override at the execution handoff.

- **D1 — `SdkConfig.lud16Domain: string` is added (required).** `config.ts` has no domain field today, but `Contact.lud16`/`UserProfile.lud16` are `${username}@${domain}` and the domain must come from config (spec §7c lists "lud16 domain" on the client `SdkConfig`). Added as a required string; any full `SdkConfig` literal (today only `src/sdk.test.ts`, if it builds one) is updated in the same task. Domain unit tests cast a partial `config`, so they are unaffected.
- **D2 — `createTransfersDomain(ctx, accountRepository)` builds its own four quote services** from `ctx.connections` (`supabase`, `encryption`, `cashuCrypto`) + `accountRepository`, mirroring `createCashuDomain`/`createSparkDomain` (~10 lines of construction). Rationale: those services are constructed *privately* inside the cashu/spark factories (not exported/shared); duplicating their construction is self-contained and matches the established pattern, vs. a cross-domain refactor to hoist them. `accountRepository` is threaded because `CashuReceiveQuoteRepository` needs it.
- **D3 — `executeQuote` RE-DERIVES the live sides; `TransferService` stays a near-verbatim internal port.** The contract `TransferQuote` is slim (no live `lightningQuote`, no `id`) and crosses the SDK↔web serialization boundary, so the live quotes cannot be stashed and looked up (no key; no SDK per-call state — the SDK is stateless per call). Therefore: the internal `TransferService` is a faithful port of master (`TransferReceiveSide`/`TransferSendSide`/internal rich `TransferQuote` + `getTransferQuote` + `initiateTransfer` + the §10 catch), and the **domain** maps rich→slim in `createQuote` and re-derives slim→rich (a fresh `getTransferQuote`) before `initiateTransfer` in `executeQuote`. Re-quoting at execute time yields fresh invoices for the same `amount`; minor fee/rate drift vs. the preview is acceptable for an ephemeral quote (this is the no-cache tradeoff; "keep the internal sides SDK-internal" per the starting notes is satisfied).
- **D4 — `acknowledge` is the ONLY transaction write S8 makes, and it emits `transaction:updated` only on a real transition.** No-op if `transaction.acknowledgmentStatus !== 'pending'`. On a real flip, the repo updates with `.select().single()` and re-parses, so the emitted entity carries the **incremented `version`** (required by the §5 version-aware cache apply). The broad `transaction:created`/`transaction:updated` for server-written rows is the **S9 realtime forwarder's** job — S8 sets up no realtime subscription.
- **D5 — `contacts.add`/`remove` emit synchronously after the DB write** (the contract JSDoc says "`add`/`remove` drive the `contact:created`/`contact:deleted` events"). Differs from master (realtime-driven), but matches the contract; S9's forwarder must avoid double-driving contacts (recorded as carryover).
- **D6 — `get()` returns `null`, not throw.** Both `TransactionRepository.get` and `ContactRepository.get` use `.maybeSingle()` → `null` (the contract returns `T | null`; master's contact `get` used `.single()` which throws — a deliberate SDK change).
- **D7 — `repo.list` nulls `nextCursor` when `transactions.length < pageSize`.** Master computes a non-null cursor in the repo and nulls it in the *hook* when the page is short; the SDK has no hook, so the repo folds in the rule (else a short final page re-fetches forever). The magic ranks `PENDING → 2 else 1` match the DB `state_sort_order` generated column.
- **D8 — `lud16` null-username is coalesced (master bug fixed).** `Contact.lud16` is non-nullable; the DB `username` is nullable. `toContact` coalesces `username ?? ''` and derives `lud16` from the coalesced value (so a null username yields `@${domain}`, not master's `null@${domain}`).
- **D9 — Internal placement.** The transaction schema layer lives in `src/internal/db/` (alongside `user-mapper.ts`, which also maps DB→domain): `transaction-enums.ts`, `transaction.ts` (the `TransactionSchema`), and a `transaction-details/` subdir (the 6 detail schema+parser files + types + parser union). None are added to the public barrel (parsers stay internal, decision 7-ii). The repos live in `src/internal/repositories/`; the domains in `src/domains/{transactions,contacts,transfers}/`.

---

## File Structure

```
packages/wallet-sdk/src/
  config.ts                                           (T5: add lud16Domain)
  sdk.ts                                              (T9: wire 3 domains)
  internal/
    test-support.ts                                   (T5: add .delete() to makeFakeDb)
    db/
      transaction-enums.ts                            (T1, new)
      transaction.ts                                  (T2, new — BaseTransactionSchema + TransactionSchema)
      transaction-details/                            (T1, new dir)
        cashu-lightning-receive-transaction-details.ts
        cashu-lightning-send-transaction-details.ts
        cashu-token-receive-transaction-details.ts
        cashu-token-send-transaction-details.ts
        spark-lightning-receive-transaction-details.ts
        spark-lightning-send-transaction-details.ts
        transaction-details-types.ts                  (DbData union + TransactionDetailsSchema + parser types)
        transaction-details-parser.ts                 (union of the 6 parsers)
        transaction-details-parser.test.ts            (T1)
    repositories/
      transaction-repository.ts                       (T3, new)
      transaction-repository.test.ts                  (T3)
      contact-repository.ts                           (T5, new)
      contact-repository.test.ts                      (T5)
  domains/
    transactions/
      transactions-domain.ts                          (T4, new)
      transactions-domain.test.ts                     (T4)
    contacts/
      contacts-domain.ts                              (T6, new)
      contacts-domain.test.ts                         (T6)
    transfers/
      transfer-service.ts                             (T7, new — internal port)
      transfer-service.test.ts                        (T7 — §10 regression)
      transfers-domain.ts                             (T8, new)
      transfers-domain.test.ts                        (T8)
```

**Untouched until cut-over:** the web app; `background` stays `notImplementedDomain`. No public barrel changes (entity types already exported).

---

## Task 1: Transaction detail parser machinery (the deferred internal DB-data parsers)

Port the web's transaction-detail layer verbatim, remapping imports to the SDK's existing DB-data schemas. This is the "deferred internal DB-data parsers" of decision 7-ii: 6 per-variant files (each holding the domain detail zod schema **and** its `z.pipe(...)` parser), the enums, the types module (DbData union + `TransactionDetailsSchema` + parser input/shape), and the parser union.

**Files:**
- Create: `packages/wallet-sdk/src/internal/db/transaction-enums.ts`
- Create: `packages/wallet-sdk/src/internal/db/transaction-details/` (8 files below)
- Test: `packages/wallet-sdk/src/internal/db/transaction-details/transaction-details-parser.test.ts`

**Interfaces:**
- Produces: `TransactionDirectionSchema`/`TransactionTypeSchema`/`TransactionStateSchema`/`TransactionPurposeSchema` (`transaction-enums.ts`); the 6 detail schemas (e.g. `CashuLightningSendTransactionDetailsSchema`, `CompletedCashuLightningSendTransactionDetailsSchema`, …) + their parsers; `TransactionDetailsSchema`, `TransactionDetailsDbDataSchema`, `TransactionDetailsParserInput`, `TransactionDetailsParserShape` (`transaction-details-types.ts`); `TransactionDetailsParser` (`transaction-details-parser.ts`).
- Consumes: the 6 existing `*DbDataSchema` + `DestinationDetailsSchema` from `src/internal/db/` (see the Background table); `Money` from `@agicash/money`; `z` from `zod/mini`.

- [ ] **Step 1: Create `transaction-enums.ts`** — copy verbatim from `apps/web-wallet/app/features/transactions/transaction-enums.ts` (no import changes needed; it only imports `z` from `zod/mini`). Content:

```ts
import { z } from 'zod/mini';

export const TransactionDirectionSchema = z.enum(['SEND', 'RECEIVE']);
export type TransactionDirection = z.infer<typeof TransactionDirectionSchema>;

export const TransactionTypeSchema = z.enum([
  'CASHU_LIGHTNING',
  'CASHU_TOKEN',
  'SPARK_LIGHTNING',
]);
export type TransactionType = z.infer<typeof TransactionTypeSchema>;

export const TransactionStateSchema = z.enum([
  'DRAFT',
  'PENDING',
  'COMPLETED',
  'FAILED',
  'REVERSED',
]);
export type TransactionState = z.infer<typeof TransactionStateSchema>;

export const TransactionPurposeSchema = z.enum([
  'PAYMENT',
  'BUY_CASHAPP',
  'TRANSFER',
]);
export type TransactionPurpose = z.infer<typeof TransactionPurposeSchema>;
```

- [ ] **Step 2: Create the 6 detail files + types + parser, by copying each web file verbatim then applying the import remap.** For each file under `apps/web-wallet/app/features/transactions/transaction-details/`, copy it to `packages/wallet-sdk/src/internal/db/transaction-details/<same-name>` and replace **only** the imports per this table (the bodies — schemas, `z.pipe`/`z.transform` parsers, `amount` derivations — are copied **unchanged**):

| Web import | SDK import (file is in `internal/db/transaction-details/`) |
|---|---|
| `import { CashuLightningSendDbDataSchema } from '~/features/agicash-db/json-models';` | `import { CashuLightningSendDbDataSchema } from '../cashu-send-quote-db-data';` |
| `import { CashuLightningReceiveDbDataSchema } from '~/features/agicash-db/json-models';` | `import { CashuLightningReceiveDbDataSchema } from '../cashu-receive-quote-db-data';` |
| `import { CashuSwapSendDbDataSchema } from '~/features/agicash-db/json-models';` | `import { CashuSwapSendDbDataSchema } from '../cashu-send-swap-db-data';` |
| `import { CashuSwapReceiveDbDataSchema } from '~/features/agicash-db/json-models';` | `import { CashuSwapReceiveDbDataSchema } from '../cashu-receive-swap-db-data';` |
| `import { SparkLightningSendDbDataSchema } from '~/features/agicash-db/json-models';` | `import { SparkLightningSendDbDataSchema } from '../spark-send-quote-db-data';` |
| `import { SparkLightningReceiveDbDataSchema } from '~/features/agicash-db/json-models';` | `import { SparkLightningReceiveDbDataSchema } from '../spark-receive-quote-db-data';` |
| `import { DestinationDetailsSchema } from '~/features/send/cashu-send-quote';` | `import { DestinationDetailsSchema } from '../cashu-send-quote-db-data';` |
| `import { ... } from '../transaction-enums';` | `import { ... } from '../transaction-enums';` (unchanged — `transaction-enums.ts` is one level up) |
| `import type { Json } from 'supabase/database.types';` (in `transaction-details-types.ts`) | `import type { Json } from '../database.types';` |

The web `cashu-token-receive-transaction-details.ts` imports **three** DbData schemas in one block — remap each to its `../*-db-data` file:
```ts
import {
  CashuLightningReceiveDbDataSchema,   // ../cashu-receive-quote-db-data
  CashuSwapReceiveDbDataSchema,        // ../cashu-receive-swap-db-data
  SparkLightningReceiveDbDataSchema,   // ../spark-receive-quote-db-data
} from '~/features/agicash-db/json-models';
```
becomes three single imports from the respective `../*-db-data` files.

For `transaction-details-types.ts`, the web imports the 6 DbData schemas from the `json-models` barrel — split into 6 single imports from the `../*-db-data` files; the 6 detail-schema imports (`./cashu-lightning-...` etc.) stay as-is; `TransactionDirection/State/Type` import stays `../transaction-enums`.

For `transaction-details-parser.ts`, imports are all relative (`./...`) — copy unchanged.

> These files are verbatim except for the imports above — read the real web files (still on-branch) to copy the bodies; do not re-type them by hand. Key invariants to preserve (assert in Step 3): `CashuLightningSendTransactionDetailsParser` derives `estimatedTotalFee = lightningFeeReserve.add(cashuSendFee)` and, when `state==='COMPLETED'`, overrides `amount = amountSpent`, `preimage = paymentPreimage`, `lightningFee`, `totalFee` (else `amount = amountReserved`); `CashuTokenReceiveTransactionDetailsParser` is a `z.union` of three sub-parsers (`CashuSwapReceiveParser`, plus `CashuLightningReceiveParser`/`SparkLightningReceiveParser` that `z.required(...,{ cashuTokenMeltData:true })`).

- [ ] **Step 3: Write the parser test** — `transaction-details/transaction-details-parser.test.ts`. Build each `decryptedTransactionDetails` fixture by parsing through the **SDK's** DbData schema (guarantees the fixture matches the persisted shape; surfaces any field-parity gap as a failure), then assert the parser's domain output.

```ts
import { describe, expect, it } from 'bun:test';
import { type Currency, Money } from '@agicash/money';
import { CashuLightningReceiveDbDataSchema } from '../cashu-receive-quote-db-data';
import { CashuLightningSendDbDataSchema } from '../cashu-send-quote-db-data';
import { CashuSwapReceiveDbDataSchema } from '../cashu-receive-swap-db-data';
import { CashuSwapSendDbDataSchema } from '../cashu-send-swap-db-data';
import { SparkLightningReceiveDbDataSchema } from '../spark-receive-quote-db-data';
import { SparkLightningSendDbDataSchema } from '../spark-send-quote-db-data';
import { TransactionDetailsParser } from './transaction-details-parser';

const btc = (sats: number) =>
  new Money({ amount: sats, currency: 'BTC', unit: 'sat' }) as Money<Currency>;

describe('TransactionDetailsParser', () => {
  it('cashu lightning send: incomplete derives amount=amountReserved + estimatedTotalFee', () => {
    const decryptedTransactionDetails = CashuLightningSendDbDataSchema.parse({
      paymentRequest: 'lnbc1',
      amountReserved: btc(1100),
      amountReceived: btc(1000),
      lightningFeeReserve: btc(80),
      cashuSendFee: btc(20),
    });
    const details = TransactionDetailsParser.parse({
      type: 'CASHU_LIGHTNING',
      direction: 'SEND',
      state: 'PENDING',
      transactionDetails: { paymentHash: 'ph1' },
      decryptedTransactionDetails,
    });
    expect(details.amount.toNumber('sat')).toBe(1100);
    expect(
      (details as { estimatedTotalFee: Money }).estimatedTotalFee.toNumber('sat'),
    ).toBe(100);
    expect((details as { paymentHash: string }).paymentHash).toBe('ph1');
  });

  it('cashu lightning send: completed overrides amount=amountSpent + preimage/lightningFee/totalFee', () => {
    const decryptedTransactionDetails = CashuLightningSendDbDataSchema.parse({
      paymentRequest: 'lnbc1',
      amountReserved: btc(1100),
      amountReceived: btc(1000),
      lightningFeeReserve: btc(80),
      cashuSendFee: btc(20),
      amountSpent: btc(1030),
      paymentPreimage: 'pre',
      lightningFee: btc(10),
      totalFee: btc(30),
    });
    const details = TransactionDetailsParser.parse({
      type: 'CASHU_LIGHTNING',
      direction: 'SEND',
      state: 'COMPLETED',
      transactionDetails: { paymentHash: 'ph1' },
      decryptedTransactionDetails,
    });
    expect(details.amount.toNumber('sat')).toBe(1030);
    expect((details as { preimage: string }).preimage).toBe('pre');
    expect((details as { totalFee: Money }).totalFee.toNumber('sat')).toBe(30);
  });

  it('cashu lightning receive: maps amount + totalFee', () => {
    const decryptedTransactionDetails = CashuLightningReceiveDbDataSchema.parse({
      paymentRequest: 'lnbc2',
      mintQuoteId: 'mq1',
      amountReceived: btc(2000),
      totalFee: btc(0),
    });
    const details = TransactionDetailsParser.parse({
      type: 'CASHU_LIGHTNING',
      direction: 'RECEIVE',
      state: 'COMPLETED',
      transactionDetails: { paymentHash: 'ph2' },
      decryptedTransactionDetails,
    });
    expect(details.amount.toNumber('sat')).toBe(2000);
    expect((details as { paymentHash: string }).paymentHash).toBe('ph2');
  });

  it('cashu token send: maps tokenAmount + fees', () => {
    const decryptedTransactionDetails = CashuSwapSendDbDataSchema.parse({
      tokenMintUrl: 'https://mint',
      amountToReceive: btc(900),
      amountToSend: btc(1000),
      inputAmount: btc(1000),
      cashuReceiveFee: btc(50),
      cashuSendFee: btc(0),
    });
    const details = TransactionDetailsParser.parse({
      type: 'CASHU_TOKEN',
      direction: 'SEND',
      state: 'PENDING',
      transactionDetails: undefined,
      decryptedTransactionDetails,
    });
    expect((details as { tokenMintUrl: string }).tokenMintUrl).toBe('https://mint');
  });

  it('cashu token receive (cross-mint via lightning): reads cashuTokenMeltData', () => {
    const decryptedTransactionDetails = CashuLightningReceiveDbDataSchema.parse({
      paymentRequest: 'lnbc3',
      mintQuoteId: 'mq2',
      amountReceived: btc(800),
      totalFee: btc(20),
      cashuTokenMeltData: {
        tokenAmount: btc(820),
        tokenMintUrl: 'https://source-mint',
        cashuReceiveFee: btc(5),
        lightningFeeReserve: btc(15),
      },
    });
    const details = TransactionDetailsParser.parse({
      type: 'CASHU_TOKEN',
      direction: 'RECEIVE',
      state: 'PENDING',
      transactionDetails: undefined,
      decryptedTransactionDetails,
    });
    expect((details as { tokenMintUrl: string }).tokenMintUrl).toBe('https://source-mint');
    expect((details as { tokenAmount: Money }).tokenAmount.toNumber('sat')).toBe(820);
  });

  it('spark lightning send + receive: round-trip a representative fixture each', () => {
    const sendDetails = TransactionDetailsParser.parse({
      type: 'SPARK_LIGHTNING',
      direction: 'SEND',
      state: 'PENDING',
      transactionDetails: { paymentHash: 'sph' },
      decryptedTransactionDetails: SparkLightningSendDbDataSchema.parse({
        paymentRequest: 'lnbc4',
        amountReceived: btc(500),
        estimatedFee: btc(10),
      }),
    });
    expect(sendDetails.amount.toNumber('sat')).toBeGreaterThan(0);

    const receiveDetails = TransactionDetailsParser.parse({
      type: 'SPARK_LIGHTNING',
      direction: 'RECEIVE',
      state: 'PENDING',
      transactionDetails: { paymentHash: 'rph' },
      decryptedTransactionDetails: SparkLightningReceiveDbDataSchema.parse({
        paymentRequest: 'lnbc5',
        sparkId: 'sid',
        amount: btc(700),
      }),
    });
    expect(receiveDetails.amount.toNumber('sat')).toBe(700);
  });
});
```

> The fixture field names above are illustrative — when implementing, **match the actual SDK DbData schema field names** for each `*DbDataSchema.parse({...})` (read the schema file; the `.parse` will throw on a wrong shape, which is the parity check). Adjust the asserted numbers to the chosen fixtures. If a parser reads a field the SDK DbData schema lacks, add the missing optional field to that DbData schema (it is the same persisted JSON) and note it in the commit.

- [ ] **Step 3b: Run; expect FAIL** — `cd packages/wallet-sdk && bun test src/internal/db/transaction-details/`. Expected: FAIL (modules not found).

- [ ] **Step 4: Implement Steps 1–2** (create the files), then run — `bun test src/internal/db/transaction-details/`. Expected: all parser tests pass. Then `bun run typecheck`.

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/internal/db/transaction-enums.ts src/internal/db/transaction-details/
git commit -m "feat(wallet-sdk): port transaction detail DB-data parsers (S8)"
```

---

## Task 2: `TransactionSchema` (full transaction zod schema)

Port `apps/web-wallet/app/features/transactions/transaction.ts` into `src/internal/db/transaction.ts`, remapping the account-enum imports to local definitions (the SDK `types/account.ts` is types-only).

**Files:**
- Create: `packages/wallet-sdk/src/internal/db/transaction.ts`
- Test: append to `packages/wallet-sdk/src/internal/db/transaction.test.ts`

**Interfaces:**
- Produces: `BaseTransactionSchema`, `TransactionSchema` (and `type Transaction = z.infer<typeof TransactionSchema>` for internal use — the public `Transaction` type stays the one in `src/types/transaction.ts`; the repo casts the parsed value to it).
- Consumes: `TransactionDetailsSchema` + the 6 detail schemas (T1); the enum schemas (T1).

- [ ] **Step 1: Write the failing test** — `transaction.test.ts`

```ts
import { describe, expect, it } from 'bun:test';
import { type Currency, Money } from '@agicash/money';
import { TransactionSchema } from './transaction';

const btc = (sats: number) =>
  new Money({ amount: sats, currency: 'BTC', unit: 'sat' }) as Money<Currency>;

const baseFields = {
  id: 't1',
  userId: 'u1',
  accountId: 'a1',
  accountName: 'Spark',
  accountType: 'spark' as const,
  accountPurpose: 'transactional' as const,
  reversedTransactionId: null,
  acknowledgmentStatus: null,
  createdAt: '2024-01-01T00:00:00Z',
  pendingAt: null,
  completedAt: null,
  failedAt: null,
  reversedAt: null,
  version: 1,
};

const sparkReceiveDetails = {
  paymentRequest: 'lnbc1',
  paymentHash: 'ph',
  sparkId: 'sid',
  amount: btc(1000),
};

describe('TransactionSchema', () => {
  it('parses a PAYMENT spark lightning receive', () => {
    const tx = TransactionSchema.parse({
      ...baseFields,
      direction: 'RECEIVE',
      type: 'SPARK_LIGHTNING',
      state: 'PENDING',
      purpose: 'PAYMENT',
      amount: btc(1000),
      details: sparkReceiveDetails,
    });
    expect(tx.purpose).toBe('PAYMENT');
    expect(tx.amount.toNumber('sat')).toBe(1000);
  });

  it('parses a TRANSFER leg (details narrows to { transferId })', () => {
    const tx = TransactionSchema.parse({
      ...baseFields,
      direction: 'RECEIVE',
      type: 'SPARK_LIGHTNING',
      state: 'PENDING',
      purpose: 'TRANSFER',
      amount: btc(1000),
      details: { ...sparkReceiveDetails, transferId: 'xfer-1' },
    });
    expect(tx.purpose).toBe('TRANSFER');
    expect((tx.details as { transferId: string }).transferId).toBe('xfer-1');
  });
});
```

- [ ] **Step 2: Run; expect FAIL** — `bun test src/internal/db/transaction.test.ts`. Expected: FAIL (`Cannot find module './transaction'`).

- [ ] **Step 3: Implement `transaction.ts`** — copy the web `transaction.ts` verbatim with these changes: (a) drop `import { AccountPurposeSchema, AccountTypeSchema } from '../accounts/account';` and define them locally; (b) remap the detail-schema imports to `./transaction-details/<file>`; (c) enums from `./transaction-enums`; (d) export `type Transaction = z.infer<typeof TransactionSchema>`. The local enums (match `src/types/account.ts`):

```ts
import { Money } from '@agicash/money';
import { z } from 'zod/mini';
import { CashuLightningReceiveTransactionDetailsSchema } from './transaction-details/cashu-lightning-receive-transaction-details';
import {
  CompletedCashuLightningSendTransactionDetailsSchema,
  IncompleteCashuLightningSendTransactionDetailsSchema,
} from './transaction-details/cashu-lightning-send-transaction-details';
import { CashuTokenReceiveTransactionDetailsSchema } from './transaction-details/cashu-token-receive-transaction-details';
import { CashuTokenSendTransactionDetailsSchema } from './transaction-details/cashu-token-send-transaction-details';
import {
  CompletedSparkLightningReceiveTransactionDetailsSchema,
  SparkLightningReceiveTransactionDetailsSchema,
} from './transaction-details/spark-lightning-receive-transaction-details';
import {
  CompletedSparkLightningSendTransactionDetailsSchema,
  IncompleteSparkLightningSendTransactionDetailsSchema,
} from './transaction-details/spark-lightning-send-transaction-details';
import { TransactionDetailsSchema } from './transaction-details/transaction-details-types';
import {
  TransactionDirectionSchema,
  TransactionPurposeSchema,
  TransactionStateSchema,
  TransactionTypeSchema,
} from './transaction-enums';

const AccountTypeSchema = z.enum(['cashu', 'spark']);
const AccountPurposeSchema = z.enum(['transactional', 'gift-card', 'offer']);

// ... BaseTransactionSchema + the 9 per-variant schemas + TransactionByTypeSchema +
// TransactionSchema — copied verbatim from apps/web-wallet/app/features/transactions/transaction.ts ...

export type Transaction = z.infer<typeof TransactionSchema>;
```

(Copy the full `BaseTransactionSchema` … `TransactionSchema` bodies verbatim from the web file; they reference only the imports above.)

- [ ] **Step 4: Run; expect PASS** — `bun test src/internal/db/transaction.test.ts`. Expected: 2 pass. Then `bun run typecheck` (confirm `z.infer<typeof TransactionSchema>` is assignable to the public `Transaction` — if a drift surfaces, fix the schema, not the public type).

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/internal/db/transaction.ts src/internal/db/transaction.test.ts
git commit -m "feat(wallet-sdk): port TransactionSchema (S8)"
```

---

## Task 3: `TransactionRepository` (read-mostly + acknowledge)

**Files:**
- Create: `packages/wallet-sdk/src/internal/repositories/transaction-repository.ts`
- Test: `packages/wallet-sdk/src/internal/repositories/transaction-repository.test.ts`

**Interfaces:**
- Produces:
  ```ts
  class TransactionRepository {
    constructor(db: SupabaseClient<Database>, encryption: EncryptionService);
    get(transactionId: string): Promise<Transaction | null>;
    list(params: { userId: string; cursor?: TransactionCursor | null; pageSize?: number; accountId?: string }):
      Promise<{ transactions: Transaction[]; nextCursor: TransactionCursor | null }>;
    countPendingAck(userId: string): Promise<number>;
    acknowledge(params: { userId: string; transactionId: string }): Promise<Transaction>;   // re-reads → incremented version
    toTransaction(row): Promise<Transaction>;
  }
  ```
- Consumes: `TransactionSchema` (T2), `TransactionDetailsParser`/`TransactionDetailsDbDataSchema`/`TransactionDetailsParserInput` (T1), `classify`, `EncryptionService`, the public `Transaction`/`TransactionCursor` types.

- [ ] **Step 1: Write the failing test** — uses `makeFakeDb` + a real ECIES `EncryptionService`. Encrypt a `CashuLightningReceiveDbDataSchema` fixture, embed it in a row, assert `toTransaction`/`get`/`list`/`countPendingAck`/`acknowledge`.

```ts
import { describe, expect, it } from 'bun:test';
import { type Currency, Money } from '@agicash/money';
import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { EncryptionService } from '../crypto/encryption';
import { CashuLightningReceiveDbDataSchema } from '../db/cashu-receive-quote-db-data';
import { makeFakeDb } from '../test-support';
import { TransactionRepository } from './transaction-repository';

const priv = secp256k1.utils.randomPrivateKey();
const pubHex = bytesToHex(secp256k1.getPublicKey(priv, true));
const encryption = new EncryptionService({
  getChildMnemonic: async () => 'm',
  getPrivateKeyBytes: async () => priv,
  getPublicKeyHex: async () => pubHex,
});
const enc = async (v: unknown) => (await encryption.get()).encrypt(v);
const btc = (sats: number) =>
  new Money({ amount: sats, currency: 'BTC', unit: 'sat' }) as Money<Currency>;

const dbData = CashuLightningReceiveDbDataSchema.parse({
  paymentRequest: 'lnbc1',
  mintQuoteId: 'mq1',
  amountReceived: btc(2000),
  totalFee: btc(0),
});

async function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    user_id: 'u1',
    account_id: 'a1',
    account_name: 'Cashu',
    account_type: 'cashu',
    account_purpose: 'transactional',
    type: 'CASHU_LIGHTNING',
    direction: 'RECEIVE',
    state: 'COMPLETED',
    purpose: 'PAYMENT',
    acknowledgment_status: 'pending',
    created_at: '2024-01-01T00:00:00Z',
    pending_at: null,
    completed_at: '2024-01-01T00:05:00Z',
    failed_at: null,
    reversed_at: null,
    reversed_transaction_id: null,
    version: 1,
    transaction_details: { paymentHash: 'ph1' },
    encrypted_transaction_details: await enc(dbData),
    ...overrides,
  };
}

describe('TransactionRepository', () => {
  it('toTransaction decrypts + parses a row into a Transaction', async () => {
    const repo = new TransactionRepository(makeFakeDb({}), encryption);
    const tx = await repo.toTransaction((await row()) as never);
    expect(tx.id).toBe('t1');
    expect(tx.amount.toNumber('sat')).toBe(2000);
    expect(tx.acknowledgmentStatus).toBe('pending');
  });

  it('get returns null when the row is absent', async () => {
    const repo = new TransactionRepository(
      makeFakeDb({ selectResult: { data: null, error: null } }),
      encryption,
    );
    expect(await repo.get('missing')).toBeNull();
  });

  it('list computes nextCursor for a full page and nulls it for a short page', async () => {
    const rows = await Promise.all([row({ id: 't1' }), row({ id: 't2' })]);
    const full = new TransactionRepository(
      makeFakeDb({ rpcResult: { data: rows, error: null } }),
      encryption,
    );
    const fullPage = await full.list({ userId: 'u1', pageSize: 2 });
    expect(fullPage.transactions).toHaveLength(2);
    expect(fullPage.nextCursor).toEqual({
      stateSortOrder: 1, // COMPLETED → 1
      createdAt: '2024-01-01T00:00:00Z',
      id: 't2',
    });

    const short = new TransactionRepository(
      makeFakeDb({ rpcResult: { data: [await row({ id: 't1' })], error: null } }),
      encryption,
    );
    const shortPage = await short.list({ userId: 'u1', pageSize: 2 });
    expect(shortPage.nextCursor).toBeNull();
  });

  it('list cursor uses stateSortOrder 2 when the last row is PENDING', async () => {
    const rows = await Promise.all([
      row({ id: 't1', state: 'COMPLETED' }),
      row({ id: 't2', state: 'PENDING' }),
    ]);
    const repo = new TransactionRepository(
      makeFakeDb({ rpcResult: { data: rows, error: null } }),
      encryption,
    );
    const page = await repo.list({ userId: 'u1', pageSize: 2 });
    expect(page.nextCursor?.stateSortOrder).toBe(2);
  });

  it('countPendingAck returns the count', async () => {
    const repo = new TransactionRepository(
      makeFakeDb({ selectResult: { count: 3, error: null } as never }),
      encryption,
    );
    expect(await repo.countPendingAck('u1')).toBe(3);
  });

  it('acknowledge re-reads the updated row (incremented version)', async () => {
    const updated = await row({ acknowledgment_status: 'acknowledged', version: 2 });
    const repo = new TransactionRepository(
      makeFakeDb({ updateResult: { data: updated, error: null } }),
      encryption,
    );
    const tx = await repo.acknowledge({ userId: 'u1', transactionId: 't1' });
    expect(tx.acknowledgmentStatus).toBe('acknowledged');
    expect(tx.version).toBe(2);
  });
});
```

- [ ] **Step 2: Run; expect FAIL** — `bun test src/internal/repositories/transaction-repository.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `transaction-repository.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod/mini';
import type { EncryptionService } from '../crypto/encryption';
import { classify } from '../classify';
import type { Database } from '../db/database';
import {
  type BaseTransactionSchema,
  TransactionSchema,
} from '../db/transaction';
import { TransactionDetailsParser } from '../db/transaction-details/transaction-details-parser';
import {
  TransactionDetailsDbDataSchema,
  type TransactionDetailsParserInput,
} from '../db/transaction-details/transaction-details-types';
import type { Transaction, TransactionCursor } from '../../types/transaction';

type TransactionRow =
  Database['wallet']['Functions']['list_transactions']['Returns'][number];

export type ListTransactionsParams = {
  userId: string;
  cursor?: TransactionCursor | null;
  pageSize?: number;
  accountId?: string;
};

/** Read-mostly access to `wallet.transactions` (rows are written server-side by quote RPCs). */
export class TransactionRepository {
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly encryption: EncryptionService,
  ) {}

  async get(transactionId: string): Promise<Transaction | null> {
    const { data, error } = await this.db
      .from('transactions')
      .select()
      .eq('id', transactionId)
      .maybeSingle();
    if (error) throw classify(error);
    return data ? this.toTransaction(data as TransactionRow) : null;
  }

  async list({
    userId,
    cursor = null,
    pageSize = 25,
    accountId,
  }: ListTransactionsParams): Promise<{
    transactions: Transaction[];
    nextCursor: TransactionCursor | null;
  }> {
    const { data, error } = await this.db.rpc('list_transactions', {
      p_user_id: userId,
      p_cursor_state_sort_order: cursor?.stateSortOrder,
      p_cursor_created_at: cursor?.createdAt,
      p_cursor_id: cursor?.id,
      p_page_size: pageSize,
      p_account_id: accountId,
    });
    if (error) throw classify(error);

    const transactions = await Promise.all(
      (data ?? []).map((tx) => this.toTransaction(tx)),
    );
    const last = transactions[transactions.length - 1];
    // Only advance the cursor on a full page (a short page is the last page);
    // otherwise a short final page would re-fetch forever (web does this hook-side).
    const nextCursor =
      last && transactions.length >= pageSize
        ? {
            stateSortOrder: last.state === 'PENDING' ? 2 : 1,
            createdAt: last.createdAt,
            id: last.id,
          }
        : null;

    return { transactions, nextCursor };
  }

  async countPendingAck(userId: string): Promise<number> {
    const { count, error } = await this.db
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('acknowledgment_status', 'pending');
    if (error || count === null) throw classify(error ?? new Error('null count'));
    return count;
  }

  /** Flip `acknowledgment_status` to `acknowledged`; returns the re-read (version-incremented) row. */
  async acknowledge({
    userId,
    transactionId,
  }: {
    userId: string;
    transactionId: string;
  }): Promise<Transaction> {
    const { data, error } = await this.db
      .from('transactions')
      .update({ acknowledgment_status: 'acknowledged' })
      .eq('id', transactionId)
      .eq('user_id', userId)
      .select()
      .single();
    if (error) throw classify(error);
    return this.toTransaction(data as TransactionRow);
  }

  async toTransaction(data: TransactionRow): Promise<Transaction> {
    const enc = await this.encryption.get();
    const decrypted = await enc.decrypt(data.encrypted_transaction_details);
    const decryptedTransactionDetails =
      TransactionDetailsDbDataSchema.parse(decrypted);

    const details = TransactionDetailsParser.parse({
      type: data.type,
      direction: data.direction,
      state: data.state,
      transactionDetails: data.transaction_details,
      decryptedTransactionDetails,
    } satisfies TransactionDetailsParserInput);

    return TransactionSchema.parse({
      id: data.id,
      userId: data.user_id,
      accountId: data.account_id,
      accountName: data.account_name,
      accountType: data.account_type,
      accountPurpose: data.account_purpose,
      createdAt: data.created_at,
      pendingAt: data.pending_at,
      completedAt: data.completed_at,
      failedAt: data.failed_at,
      reversedTransactionId: data.reversed_transaction_id,
      purpose: data.purpose,
      reversedAt: data.reversed_at,
      acknowledgmentStatus: data.acknowledgment_status,
      version: data.version,
      direction: data.direction,
      type: data.type,
      state: data.state,
      amount: details.amount,
      details,
    } satisfies z.input<typeof BaseTransactionSchema>) as Transaction;
  }
}
```

> If `typeof BaseTransactionSchema` import-as-type trips on `z.input`, mirror the web file's exact import (it imports `type BaseTransactionSchema`). The `as TransactionRow` cast on the `.from('transactions')` rows is because the Table Row and the RPC Return share the needed columns.

- [ ] **Step 4: Run; expect PASS** — `bun test src/internal/repositories/transaction-repository.test.ts`. Expected: all pass. Then `bun run typecheck`.

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/internal/repositories/transaction-repository.ts src/internal/repositories/transaction-repository.test.ts
git commit -m "feat(wallet-sdk): transaction repository (read + acknowledge) (S8)"
```

---

## Task 4: `createTransactionsDomain` (wire + emit on real ack transition)

**Files:**
- Create: `packages/wallet-sdk/src/domains/transactions/transactions-domain.ts`
- Test: `packages/wallet-sdk/src/domains/transactions/transactions-domain.test.ts`

**Interfaces:**
- Produces: `createTransactionsDomain(ctx: DomainContext, repo: TransactionRepository): TransactionsDomain` (the repo is a **required injected collaborator**, built in `sdk.ts` — the `accountRepository` convention; tests inject a fake).
- Consumes: `TransactionRepository` (T3); `getCurrentUserId`; `SdkError`; `DomainContext`; the `TransactionsDomain` interface + `Transaction`/`TransactionCursor`.

- [ ] **Step 1: Write the failing test** — DI a fake repo + a real emitter; assert delegation + the real-transition emit gate.

```ts
import { describe, expect, it, mock } from 'bun:test';
import type { Transaction } from '../../types/transaction';
import { SdkEventEmitter } from '../../internal/event-emitter';
import type { SdkEventMap } from '../../events';
import { inMemoryStorage, jwtWith } from '../../internal/test-support';
import type { DomainContext } from '../context';
import { createTransactionsDomain } from './transactions-domain';

const tx = (over: Partial<Transaction> = {}) =>
  ({
    id: 't1',
    acknowledgmentStatus: 'pending',
    version: 1,
    ...over,
  }) as unknown as Transaction;

function setup(repo: Record<string, unknown>) {
  const emitter = new SdkEventEmitter<SdkEventMap>();
  const events: Transaction[] = [];
  emitter.on('transaction:updated', (e) => events.push(e.transaction));
  // a signed-in session: storage carries an access token whose `sub` is the user id
  const storage = inMemoryStorage({ access_token: jwtWith({ sub: 'u1' }) });
  const ctx = {
    config: { storage },
    connections: { supabase: {} },
    emitter,
  } as unknown as DomainContext;
  // inject the fake repo by spying on the repo ctor is avoided; instead the domain
  // accepts the repo via a thin seam: see Step 3 (createTransactionsDomain builds
  // `new TransactionRepository(...)`). For the test we override via the connections.
  return { emitter, events, ctx, repo };
}

describe('createTransactionsDomain', () => {
  it('acknowledge emits transaction:updated only on a real pending→acknowledged transition', async () => {
    const acknowledged = tx({ acknowledgmentStatus: 'acknowledged', version: 2 });
    const repo = {
      acknowledge: mock(async () => acknowledged),
    };
    const { events, ctx } = setup(repo);
    const domain = createTransactionsDomain(ctx, repo as never);

    await domain.acknowledge(tx({ acknowledgmentStatus: 'pending' }));
    expect(repo.acknowledge).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(events[0]?.version).toBe(2);
  });

  it('acknowledge is a no-op when status is not pending', async () => {
    const repo = { acknowledge: mock(async () => tx()) };
    const { events, ctx } = setup(repo);
    const domain = createTransactionsDomain(ctx, repo as never);

    await domain.acknowledge(tx({ acknowledgmentStatus: 'acknowledged' }));
    await domain.acknowledge(tx({ acknowledgmentStatus: null }));
    expect(repo.acknowledge).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
  });

  it('list / get / countPendingAck delegate to the repo with the resolved user id', async () => {
    const repo = {
      list: mock(async () => ({ transactions: [], nextCursor: null })),
      get: mock(async () => null),
      countPendingAck: mock(async () => 5),
    };
    const { ctx } = setup(repo);
    const domain = createTransactionsDomain(ctx, repo as never);

    await domain.list({ pageSize: 10 });
    expect(repo.list).toHaveBeenCalledWith({ userId: 'u1', pageSize: 10 });
    expect(await domain.get('x')).toBeNull();
    expect(await domain.countPendingAck()).toBe(5);
    expect(repo.countPendingAck).toHaveBeenCalledWith('u1');
  });
});
```

> The factory takes the repo as a **required** 2nd arg (mirrors `createAccountsDomain(ctx, accountRepository)`); `sdk.ts` (T9) builds the real `TransactionRepository` and passes it. The test injects a fake — the established way to unit-test domain logic in isolation without `mock.module` (see `accounts-domain.test.ts`, which injects a `fakeRepo`).

- [ ] **Step 2: Run; expect FAIL** — `bun test src/domains/transactions/transactions-domain.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `transactions-domain.ts`**

```ts
import type { TransactionsDomain } from '../../domains';
import { SdkError } from '../../errors';
import { getCurrentUserId } from '../../internal/connections/open-secret';
import type { TransactionRepository } from '../../internal/repositories/transaction-repository';
import type { DomainContext } from '../context';

/** Build the transactions domain over the shared context (read-mostly + acknowledge). */
export function createTransactionsDomain(
  ctx: DomainContext,
  repo: TransactionRepository,
): TransactionsDomain {
  const requireUserId = async (): Promise<string> => {
    const id = await getCurrentUserId(ctx.config.storage);
    if (!id) throw new SdkError('No active session', 'NOT_AUTHENTICATED');
    return id;
  };

  return {
    async list(params) {
      const userId = await requireUserId();
      return repo.list({ userId, ...params });
    },

    get(id) {
      return repo.get(id);
    },

    async countPendingAck() {
      return repo.countPendingAck(await requireUserId());
    },

    async acknowledge(transaction) {
      // Only a real pending → acknowledged transition is a write + an event.
      if (transaction.acknowledgmentStatus !== 'pending') return;
      const userId = await requireUserId();
      const updated = await repo.acknowledge({
        userId,
        transactionId: transaction.id,
      });
      ctx.emitter.emit('transaction:updated', { transaction: updated });
    },
  };
}
```

- [ ] **Step 4: Run; expect PASS** — `bun test src/domains/transactions/transactions-domain.test.ts`. Expected: all pass. Then `bun run typecheck`.

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/domains/transactions/
git commit -m "feat(wallet-sdk): transactions domain (list/get/countPendingAck/acknowledge) (S8)"
```

---

## Task 5: `SdkConfig.lud16Domain` + `ContactRepository`

**Files:**
- Modify: `packages/wallet-sdk/src/config.ts` (add `lud16Domain`)
- Modify: `packages/wallet-sdk/src/internal/test-support.ts` (add `.delete()` to `makeFakeDb`)
- Modify: `packages/wallet-sdk/src/sdk.test.ts` **only if** it builds a literal `SdkConfig` (add the field)
- Create: `packages/wallet-sdk/src/internal/repositories/contact-repository.ts`
- Test: `packages/wallet-sdk/src/internal/repositories/contact-repository.test.ts`

**Interfaces:**
- Produces: `SdkConfig.lud16Domain: string`; `class ContactRepository { constructor(db, domain: string); get(id) → Contact|null; getAll(ownerId) → Contact[]; create({ownerId,username}) → Contact; delete(contactId) → void; findContactCandidates(query, currentUserId) → UserProfile[]; static toContact(row, domain) → Contact }`.
- Consumes: `classify`; `DomainError`; `Database`; the public `Contact`/`UserProfile`.

- [ ] **Step 1: Add `lud16Domain` to `SdkConfig`** — append to the `SdkConfig` object in `config.ts`:

```ts
  /**
   * The Lightning-Address domain used to derive `Contact.lud16` / `UserProfile.lud16`
   * (`${username}@${domain}`). Supplied by the consumer (web: the request origin host).
   */
  lud16Domain: string;
```

Run `bun run typecheck`; if it flags a missing `lud16Domain` in a literal `SdkConfig` (e.g. in `sdk.test.ts`), add `lud16Domain: 'agi.cash'` there.

- [ ] **Step 2: Add `.delete()` support to `makeFakeDb`** — in `src/internal/test-support.ts`, inside `builder`, alongside `b.insert`:

```ts
    b.delete = () => builder(terminal);
```

- [ ] **Step 3: Write the failing test** — `contact-repository.test.ts`

```ts
import { describe, expect, it } from 'bun:test';
import { DomainError } from '../../errors';
import { makeFakeDb } from '../test-support';
import { ContactRepository } from './contact-repository';

const DOMAIN = 'agi.cash';
const dbContact = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  owner_id: 'u1',
  username: 'alice',
  created_at: '2024-01-01T00:00:00Z',
  ...over,
});

describe('ContactRepository', () => {
  it('toContact derives lud16 + Date createdAt; coalesces a null username', () => {
    const ok = ContactRepository.toContact(dbContact() as never, DOMAIN);
    expect(ok.lud16).toBe('alice@agi.cash');
    expect(ok.createdAt).toBeInstanceOf(Date);

    const nullName = ContactRepository.toContact(
      dbContact({ username: null }) as never,
      DOMAIN,
    );
    expect(nullName.username).toBe('');
    expect(nullName.lud16).toBe('@agi.cash'); // master bug fixed (not 'null@agi.cash')
  });

  it('get returns null when absent', async () => {
    const repo = new ContactRepository(
      makeFakeDb({ selectResult: { data: null, error: null } }),
      DOMAIN,
    );
    expect(await repo.get('missing')).toBeNull();
  });

  it('getAll maps rows to contacts', async () => {
    const repo = new ContactRepository(
      makeFakeDb({ selectResult: { data: [dbContact()], error: null } }),
      DOMAIN,
    );
    const all = await repo.getAll('u1');
    expect(all).toHaveLength(1);
    expect(all[0]?.lud16).toBe('alice@agi.cash');
  });

  it('create maps the LIMIT_REACHED hint to a DomainError', async () => {
    const repo = new ContactRepository(
      makeFakeDb({
        selectResult: {
          data: null,
          error: { hint: 'LIMIT_REACHED', message: 'Too many', details: 'max 150' },
        },
      }),
      DOMAIN,
    );
    await expect(repo.create({ ownerId: 'u1', username: 'bob' })).rejects.toBeInstanceOf(
      DomainError,
    );
  });

  it('create returns the created contact on success', async () => {
    const repo = new ContactRepository(
      makeFakeDb({ selectResult: { data: dbContact({ username: 'bob' }), error: null } }),
      DOMAIN,
    );
    const created = await repo.create({ ownerId: 'u1', username: 'bob' });
    expect(created.username).toBe('bob');
  });

  it('findContactCandidates short-circuits to [] for queries under 3 chars', async () => {
    const repo = new ContactRepository(makeFakeDb({}), DOMAIN);
    expect(await repo.findContactCandidates('ab', 'u1')).toEqual([]);
  });

  it('findContactCandidates maps RPC rows to UserProfile with lud16', async () => {
    const repo = new ContactRepository(
      makeFakeDb({ rpcResult: { data: [{ id: 'u2', username: 'carol' }], error: null } }),
      DOMAIN,
    );
    const profiles = await repo.findContactCandidates('car', 'u1');
    expect(profiles).toEqual([{ id: 'u2', username: 'carol', lud16: 'carol@agi.cash' }]);
  });
});
```

- [ ] **Step 4: Run; expect FAIL** — `bun test src/internal/repositories/contact-repository.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 5: Implement `contact-repository.ts`**

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { DomainError } from '../../errors';
import { classify } from '../classify';
import type { Database } from '../db/database';
import type { Contact, UserProfile } from '../../types/contact';

type ContactRow = Database['wallet']['Tables']['contacts']['Row'];

/** Data access for `wallet.contacts`. CRUD + username-candidate search; lud16 derived from `domain`. */
export class ContactRepository {
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly domain: string,
  ) {}

  async get(contactId: string): Promise<Contact | null> {
    const { data, error } = await this.db
      .from('contacts')
      .select()
      .eq('id', contactId)
      .maybeSingle();
    if (error) throw classify(error);
    return data ? ContactRepository.toContact(data, this.domain) : null;
  }

  async getAll(ownerId: string): Promise<Contact[]> {
    const { data, error } = await this.db
      .from('contacts')
      .select()
      .eq('owner_id', ownerId)
      .limit(150)
      .order('username', { ascending: true });
    if (error) throw classify(error);
    return (data ?? []).map((c) => ContactRepository.toContact(c, this.domain));
  }

  async create(contact: { ownerId: string; username: string }): Promise<Contact> {
    const { data, error } = await this.db
      .from('contacts')
      .insert({ owner_id: contact.ownerId, username: contact.username })
      .select()
      .single();
    if (error) {
      if (error.hint === 'LIMIT_REACHED') {
        throw new DomainError(
          `${error.message} ${error.details}`,
          'CONTACTS_LIMIT_REACHED',
        );
      }
      throw classify(error);
    }
    return ContactRepository.toContact(data, this.domain);
  }

  async delete(contactId: string): Promise<void> {
    const { error } = await this.db.from('contacts').delete().eq('id', contactId);
    if (error) throw classify(error);
  }

  async findContactCandidates(
    query: string,
    currentUserId: string,
  ): Promise<UserProfile[]> {
    const trimmed = query.trim();
    if (trimmed.length < 3) return [];

    const { data, error } = await this.db.rpc('find_contact_candidates', {
      partial_username: trimmed,
      current_user_id: currentUserId,
    });
    if (error) throw classify(error);
    return (data ?? []).map((u) => ({
      id: u.id,
      username: u.username,
      lud16: `${u.username}@${this.domain}`,
    }));
  }

  static toContact(dbContact: ContactRow, domain: string): Contact {
    const username = dbContact.username ?? '';
    return {
      id: dbContact.id,
      createdAt: new Date(dbContact.created_at),
      ownerId: dbContact.owner_id,
      username,
      lud16: `${username}@${domain}`,
    };
  }
}
```

- [ ] **Step 6: Run; expect PASS** — `bun test src/internal/repositories/contact-repository.test.ts`. Expected: all pass. Then `bun run typecheck`.

- [ ] **Step 7: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/config.ts src/internal/test-support.ts src/internal/repositories/contact-repository.ts src/internal/repositories/contact-repository.test.ts src/sdk.test.ts
git commit -m "feat(wallet-sdk): SdkConfig.lud16Domain + contact repository (S8)"
```

---

## Task 6: `createContactsDomain` (CRUD + search + synchronous events)

**Files:**
- Create: `packages/wallet-sdk/src/domains/contacts/contacts-domain.ts`
- Test: `packages/wallet-sdk/src/domains/contacts/contacts-domain.test.ts`

**Interfaces:**
- Produces: `createContactsDomain(ctx: DomainContext, repo: ContactRepository): ContactsDomain` (required injected repo, built in `sdk.ts` with `config.lud16Domain`; tests inject a fake).
- Consumes: `ContactRepository` (T5); `getCurrentUserId`; `SdkError`; `Contact`/`UserProfile`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, mock } from 'bun:test';
import type { Contact } from '../../types/contact';
import { SdkEventEmitter } from '../../internal/event-emitter';
import type { SdkEventMap } from '../../events';
import { inMemoryStorage, jwtWith } from '../../internal/test-support';
import type { DomainContext } from '../context';
import { createContactsDomain } from './contacts-domain';

const contact = (over: Partial<Contact> = {}): Contact => ({
  id: 'c1',
  ownerId: 'u1',
  username: 'alice',
  lud16: 'alice@agi.cash',
  createdAt: new Date('2024-01-01T00:00:00Z'),
  ...over,
});

function setup(repo: Record<string, unknown>) {
  const emitter = new SdkEventEmitter<SdkEventMap>();
  const created: Contact[] = [];
  const deleted: string[] = [];
  emitter.on('contact:created', (e) => created.push(e.contact));
  emitter.on('contact:deleted', (e) => deleted.push(e.contactId));
  const storage = inMemoryStorage({ access_token: jwtWith({ sub: 'u1' }) });
  const ctx = {
    config: { storage, lud16Domain: 'agi.cash' },
    connections: { supabase: {} },
    emitter,
  } as unknown as DomainContext;
  return { emitter, created, deleted, ctx };
}

describe('createContactsDomain', () => {
  it('add creates the contact and emits contact:created', async () => {
    const c = contact();
    const repo = { create: mock(async () => c) };
    const { created, ctx } = setup(repo);
    const domain = createContactsDomain(ctx, repo as never);

    const result = await domain.add({ username: 'alice' });
    expect(repo.create).toHaveBeenCalledWith({ ownerId: 'u1', username: 'alice' });
    expect(result).toBe(c);
    expect(created).toEqual([c]);
  });

  it('remove deletes and emits contact:deleted with only the id', async () => {
    const repo = { delete: mock(async () => undefined) };
    const { deleted, ctx } = setup(repo);
    const domain = createContactsDomain(ctx, repo as never);

    await domain.remove(contact({ id: 'c9' }));
    expect(repo.delete).toHaveBeenCalledWith('c9');
    expect(deleted).toEqual(['c9']);
  });

  it('search delegates to findContactCandidates with the resolved user id', async () => {
    const repo = {
      findContactCandidates: mock(async () => [
        { id: 'u2', username: 'carol', lud16: 'carol@agi.cash' },
      ]),
    };
    const { ctx } = setup(repo);
    const domain = createContactsDomain(ctx, repo as never);

    const profiles = await domain.search({ query: 'car' });
    expect(repo.findContactCandidates).toHaveBeenCalledWith('car', 'u1');
    expect(profiles[0]?.lud16).toBe('carol@agi.cash');
  });

  it('list resolves the user id; get delegates by id', async () => {
    const repo = {
      getAll: mock(async () => [contact()]),
      get: mock(async () => null),
    };
    const { ctx } = setup(repo);
    const domain = createContactsDomain(ctx, repo as never);

    await domain.list();
    expect(repo.getAll).toHaveBeenCalledWith('u1');
    expect(await domain.get('x')).toBeNull();
  });
});
```

- [ ] **Step 2: Run; expect FAIL** — `bun test src/domains/contacts/contacts-domain.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `contacts-domain.ts`**

```ts
import type { ContactsDomain } from '../../domains';
import { SdkError } from '../../errors';
import { getCurrentUserId } from '../../internal/connections/open-secret';
import type { ContactRepository } from '../../internal/repositories/contact-repository';
import type { DomainContext } from '../context';

/** Build the contacts domain over the shared context (CRUD + username search). */
export function createContactsDomain(
  ctx: DomainContext,
  repo: ContactRepository,
): ContactsDomain {
  const requireUserId = async (): Promise<string> => {
    const id = await getCurrentUserId(ctx.config.storage);
    if (!id) throw new SdkError('No active session', 'NOT_AUTHENTICATED');
    return id;
  };

  return {
    async list() {
      return repo.getAll(await requireUserId());
    },

    get(id) {
      return repo.get(id);
    },

    async add({ username }) {
      const ownerId = await requireUserId();
      const contact = await repo.create({ ownerId, username });
      ctx.emitter.emit('contact:created', { contact });
      return contact;
    },

    async remove(contact) {
      await repo.delete(contact.id);
      ctx.emitter.emit('contact:deleted', { contactId: contact.id });
    },

    async search({ query }) {
      const userId = await requireUserId();
      return repo.findContactCandidates(query, userId);
    },
  };
}
```

- [ ] **Step 4: Run; expect PASS** — `bun test src/domains/contacts/contacts-domain.test.ts`. Expected: all pass. Then `bun run typecheck`.

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/domains/contacts/
git commit -m "feat(wallet-sdk): contacts domain (CRUD + search + events) (S8)"
```

---

## Task 7: `TransferService` (internal port + the §10 regression — MANDATED)

Port `apps/web-wallet/app/features/transfer/transfer-service.ts` into `src/domains/transfers/transfer-service.ts` (internal, rich sides). This task **owns the §10 regression** (receive-auto-fails-on-send-failure). Keep master's internal method names (`getTransferQuote`/`initiateTransfer`) — the domain (T8) exposes the contract names.

**Files:**
- Create: `packages/wallet-sdk/src/domains/transfers/transfer-service.ts`
- Test: `packages/wallet-sdk/src/domains/transfers/transfer-service.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type TransferReceiveSide = { account: CashuAccount; fee: Money; lightningQuote: CashuReceiveLightningQuote }
                           | { account: SparkAccount; fee: Money; lightningQuote: SparkReceiveLightningQuote };
  type TransferSendSide    = { account: CashuAccount; lightningQuote: CashuLightningQuote }
                           | { account: SparkAccount; lightningQuote: SparkLightningQuote };
  type InternalTransferQuote = { amount; amountToReceive; totalFees; totalCost; receive: TransferReceiveSide; send: TransferSendSide };
  class TransferService {
    constructor(cashuReceiveQuoteService, sparkReceiveQuoteService, cashuSendQuoteService, sparkSendQuoteService);
    getTransferQuote({ sourceAccount, destinationAccount, amount }): Promise<InternalTransferQuote>;
    initiateTransfer({ userId, quote }): Promise<{ transferId; receiveTransactionId; sendTransactionId }>;
  }
  ```
- Consumes (all already in the SDK): `CashuReceiveQuoteService`, `SparkReceiveQuoteService`, `CashuSendQuoteService`, `SparkSendQuoteService` (`src/domains/{cashu,spark}/...`); `getLightningQuote` core (`src/domains/spark/spark-receive-quote-core`); `canSendToLightning`/`canReceiveFromLightning` (`src/domains/accounts/account-utils`); the quote/account types; `DomainError`; `Money`.

- [ ] **Step 1: Write the failing test (the §10 regression is the centerpiece)** — DI'd fake services; assert the compensating action.

```ts
import { describe, expect, it, mock } from 'bun:test';
import { type Currency, Money } from '@agicash/money';
import { DomainError } from '../../errors';
import { TransferService } from './transfer-service';

const btc = (sats: number) =>
  new Money({ amount: sats, currency: 'BTC', unit: 'sat' }) as Money<Currency>;

const cashuAccount = (over = {}) =>
  ({ id: 'src', type: 'cashu', name: 'Cashu', currency: 'BTC', wallet: {} }) as never;
const sparkAccount = (over = {}) =>
  ({ id: 'dst', type: 'spark', name: 'Spark', currency: 'BTC', wallet: {} }) as never;

// cashu send lightning quote (estimatedTotalFee + amountToReceive + the persist payload fields)
const cashuSendQuote = {
  paymentRequest: 'lnbc-x',
  amountRequested: btc(1000),
  amountRequestedInBtc: btc(1000),
  meltQuote: { quote: 'mq' },
  amountToReceive: btc(1000),
  estimatedTotalFee: btc(20),
};
// spark receive lightning quote carries the invoice we quote against
const sparkReceiveQuote = { invoice: { paymentRequest: 'lnbc-x' } };

function services(overrides: Record<string, ReturnType<typeof mock>> = {}) {
  return {
    cashuReceive: { getLightningQuote: mock(async () => ({})), createReceiveQuote: mock(), fail: mock() },
    sparkReceive: {
      createReceiveQuote: mock(async () => ({ transactionId: 'rx-tx' })),
      fail: mock(async () => undefined),
    },
    cashuSend: {
      getLightningQuote: mock(async () => cashuSendQuote),
      createSendQuote: mock(async () => ({ transactionId: 'sx-tx' })),
    },
    sparkSend: { getLightningSendQuote: mock(), createSendQuote: mock() },
    ...overrides,
  };
}

// helper: a cashu(send) → spark(receive) transfer (canSend/canReceive must pass for these fakes)
function build(s: ReturnType<typeof services>) {
  return new TransferService(
    s.cashuReceive as never,
    s.sparkReceive as never,
    s.cashuSend as never,
    s.sparkSend as never,
  );
}

describe('TransferService', () => {
  it('§10 REGRESSION: a send-persist failure fails the already-persisted receive quote and rethrows the ORIGINAL error', async () => {
    const sendError = new Error('persist send failed');
    const receiveQuote = { transactionId: 'rx-tx', id: 'rq1' };
    const s = services();
    s.sparkReceive.createReceiveQuote = mock(async () => receiveQuote);
    s.cashuSend.createSendQuote = mock(async () => {
      throw sendError;
    });
    const service = build(s);

    const quote = {
      amount: btc(1000),
      amountToReceive: btc(1000),
      totalFees: btc(20),
      totalCost: btc(1020),
      receive: { account: sparkAccount(), fee: btc(0), lightningQuote: sparkReceiveQuote },
      send: { account: cashuAccount(), lightningQuote: cashuSendQuote },
    } as never;

    await expect(service.initiateTransfer({ userId: 'u1', quote })).rejects.toBe(sendError);
    // the receive quote was failed (compensating action), with the fixed reason string
    expect(s.sparkReceive.fail).toHaveBeenCalledWith(receiveQuote, 'Transfer initiation failed');
  });

  it('§10: a cleanup (fail) error is swallowed; the ORIGINAL send error still propagates', async () => {
    const sendError = new Error('persist send failed');
    const s = services();
    s.sparkReceive.createReceiveQuote = mock(async () => ({ transactionId: 'rx', id: 'rq' }));
    s.cashuSend.createSendQuote = mock(async () => {
      throw sendError;
    });
    s.sparkReceive.fail = mock(async () => {
      throw new Error('cleanup blew up');
    });
    const service = build(s);
    const quote = {
      amount: btc(1000), amountToReceive: btc(1000), totalFees: btc(20), totalCost: btc(1020),
      receive: { account: sparkAccount(), fee: btc(0), lightningQuote: sparkReceiveQuote },
      send: { account: cashuAccount(), lightningQuote: cashuSendQuote },
    } as never;

    await expect(service.initiateTransfer({ userId: 'u1', quote })).rejects.toBe(sendError);
  });

  it('happy path persists receive then send and returns all three ids', async () => {
    const s = services();
    s.sparkReceive.createReceiveQuote = mock(async () => ({ transactionId: 'rx-tx' }));
    s.cashuSend.createSendQuote = mock(async () => ({ transactionId: 'sx-tx' }));
    const service = build(s);
    const quote = {
      amount: btc(1000), amountToReceive: btc(1000), totalFees: btc(20), totalCost: btc(1020),
      receive: { account: sparkAccount(), fee: btc(0), lightningQuote: sparkReceiveQuote },
      send: { account: cashuAccount(), lightningQuote: cashuSendQuote },
    } as never;

    const result = await service.initiateTransfer({ userId: 'u1', quote });
    expect(result.receiveTransactionId).toBe('rx-tx');
    expect(result.sendTransactionId).toBe('sx-tx');
    expect(typeof result.transferId).toBe('string');
    expect(s.sparkReceive.fail).not.toHaveBeenCalled();
  });

  it('getTransferQuote throws a DomainError when the source cannot send Lightning', async () => {
    const service = build(services());
    // a test-mint cashu account cannot send to lightning; use a shape canSendToLightning rejects.
    const badSource = { id: 's', type: 'cashu', name: 'Test', currency: 'BTC', isTestMint: true } as never;
    await expect(
      service.getTransferQuote({
        sourceAccount: badSource,
        destinationAccount: sparkAccount(),
        amount: btc(1000),
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
```

> Confirm against `account-utils.ts` what makes `canSendToLightning` return false (e.g. a test-mint cashu account), and shape `badSource` accordingly so the gate fires. If both gates need real account fields, build the fixtures to satisfy `canReceiveFromLightning(destination)` and fail `canSendToLightning(source)`.

- [ ] **Step 2: Run; expect FAIL** — `bun test src/domains/transfers/transfer-service.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `transfer-service.ts`** — port from master with SDK imports + `(message, code)` on the two capability gates. Keep the §10 `catch` **exactly** (rethrow the original `error`; `console.error`-swallow the cleanup `failError` with the keys `{ cause, transferId, receiveAccountId, sendAccountId }`).

```ts
import { Money } from '@agicash/money';
import { DomainError } from '../../errors';
import {
  canReceiveFromLightning,
  canSendToLightning,
} from '../accounts/account-utils';
import type { CashuReceiveQuoteService } from '../cashu/cashu-receive-quote-service';
import type { CashuSendQuoteService, CashuLightningQuote } from '../cashu/cashu-send-quote-service';
import { getLightningQuote as getSparkLightningQuote } from '../spark/spark-receive-quote-core';
import type { SparkReceiveLightningQuote } from '../spark/spark-receive-quote-core';
import type { SparkReceiveQuoteService } from '../spark/spark-receive-quote-service';
import type { SparkSendQuoteService, SparkLightningQuote } from '../spark/spark-send-quote-service';
import type { Account, CashuAccount, SparkAccount } from '../../types/account';
import type { CashuReceiveQuote, CashuReceiveLightningQuote } from '../../types/cashu';
import type { SparkReceiveQuote } from '../../types/spark';

export type TransferReceiveSide =
  | { account: CashuAccount; fee: Money; lightningQuote: CashuReceiveLightningQuote }
  | { account: SparkAccount; fee: Money; lightningQuote: SparkReceiveLightningQuote };

export type TransferSendSide =
  | { account: CashuAccount; lightningQuote: CashuLightningQuote }
  | { account: SparkAccount; lightningQuote: SparkLightningQuote };

export type InternalTransferQuote = {
  amount: Money;
  amountToReceive: Money;
  totalFees: Money;
  totalCost: Money;
  receive: TransferReceiveSide;
  send: TransferSendSide;
};

function extractPaymentRequest(receive: TransferReceiveSide): string {
  if (receive.account.type === 'cashu') {
    return (receive.lightningQuote as CashuReceiveLightningQuote).mintQuote.request;
  }
  return (receive.lightningQuote as SparkReceiveLightningQuote).invoice.paymentRequest;
}

/** Internal transfer orchestration (rich sides). The transfers DOMAIN maps to the slim contract shape. */
export class TransferService {
  constructor(
    private readonly cashuReceiveQuoteService: CashuReceiveQuoteService,
    private readonly sparkReceiveQuoteService: SparkReceiveQuoteService,
    private readonly cashuSendQuoteService: CashuSendQuoteService,
    private readonly sparkSendQuoteService: SparkSendQuoteService,
  ) {}

  async getTransferQuote({
    sourceAccount,
    destinationAccount,
    amount,
  }: {
    sourceAccount: Account;
    destinationAccount: Account;
    amount: Money;
  }): Promise<InternalTransferQuote> {
    if (!canSendToLightning(sourceAccount)) {
      throw new DomainError(
        `${sourceAccount.name} cannot send Lightning payments`,
        'CANNOT_SEND_LIGHTNING',
      );
    }
    if (!canReceiveFromLightning(destinationAccount)) {
      throw new DomainError(
        `${destinationAccount.name} cannot receive Lightning payments`,
        'CANNOT_RECEIVE_LIGHTNING',
      );
    }

    const receive = await this.getReceiveSide(destinationAccount, amount);
    const paymentRequest = extractPaymentRequest(receive);
    const send = await this.getSendSide(sourceAccount, paymentRequest);

    const amountToReceive = send.lightningQuote.amountToReceive;
    const totalFees = send.lightningQuote.estimatedTotalFee.add(receive.fee);
    const totalCost = amountToReceive.add(totalFees);

    return { amount, amountToReceive, totalFees, totalCost, receive, send };
  }

  async initiateTransfer({
    userId,
    quote,
  }: {
    userId: string;
    quote: InternalTransferQuote;
  }): Promise<{ transferId: string; receiveTransactionId: string; sendTransactionId: string }> {
    const transferId = crypto.randomUUID();
    const { receive, send } = quote;

    const receiveQuote = await this.persistReceiveQuote(userId, receive, transferId);

    try {
      const sendQuote = await this.persistSendQuote(userId, send, transferId);
      return {
        transferId,
        receiveTransactionId: receiveQuote.transactionId,
        sendTransactionId: sendQuote.transactionId,
      };
    } catch (error) {
      try {
        await this.failReceiveQuote(receive, receiveQuote);
      } catch (failError) {
        console.error('Failed to cleanup receive quote', {
          cause: failError,
          transferId,
          receiveAccountId: receive.account.id,
          sendAccountId: send.account.id,
        });
      }
      throw error;
    }
  }

  private async getReceiveSide(account: Account, amount: Money): Promise<TransferReceiveSide> {
    if (account.type === 'cashu') {
      const lightningQuote = await this.cashuReceiveQuoteService.getLightningQuote({
        wallet: account.wallet,
        amount,
      });
      return {
        account,
        fee: lightningQuote.mintingFee ?? Money.zero(amount.currency),
        lightningQuote,
      };
    }
    return {
      account,
      fee: Money.zero(amount.currency),
      lightningQuote: await getSparkLightningQuote({ wallet: account.wallet, amount }),
    };
  }

  private async getSendSide(account: Account, paymentRequest: string): Promise<TransferSendSide> {
    if (account.type === 'cashu') {
      return {
        account,
        lightningQuote: await this.cashuSendQuoteService.getLightningQuote({
          account,
          paymentRequest,
        }),
      };
    }
    return {
      account,
      lightningQuote: await this.sparkSendQuoteService.getLightningSendQuote({
        account,
        paymentRequest,
      }),
    };
  }

  private async persistReceiveQuote(
    userId: string,
    receive: TransferReceiveSide,
    transferId: string,
  ): Promise<CashuReceiveQuote | SparkReceiveQuote> {
    if (receive.account.type === 'cashu') {
      return this.cashuReceiveQuoteService.createReceiveQuote({
        userId,
        account: receive.account,
        lightningQuote: receive.lightningQuote as CashuReceiveLightningQuote,
        receiveType: 'LIGHTNING',
        purpose: 'TRANSFER',
        transferId,
      });
    }
    return this.sparkReceiveQuoteService.createReceiveQuote({
      userId,
      account: receive.account,
      lightningQuote: receive.lightningQuote as SparkReceiveLightningQuote,
      receiveType: 'LIGHTNING',
      purpose: 'TRANSFER',
      transferId,
    });
  }

  private async failReceiveQuote(
    receive: TransferReceiveSide,
    quote: CashuReceiveQuote | SparkReceiveQuote,
  ): Promise<void> {
    if (receive.account.type === 'cashu') {
      await this.cashuReceiveQuoteService.fail(quote as CashuReceiveQuote, 'Transfer initiation failed');
    } else {
      await this.sparkReceiveQuoteService.fail(quote as SparkReceiveQuote, 'Transfer initiation failed');
    }
  }

  private async persistSendQuote(
    userId: string,
    send: TransferSendSide,
    transferId: string,
  ): Promise<{ transactionId: string }> {
    if (send.account.type === 'cashu') {
      const quote = send.lightningQuote as CashuLightningQuote;
      return this.cashuSendQuoteService.createSendQuote({
        userId,
        account: send.account,
        sendQuote: {
          paymentRequest: quote.paymentRequest,
          amountRequested: quote.amountRequested,
          amountRequestedInBtc: quote.amountRequestedInBtc,
          meltQuote: quote.meltQuote,
        },
        purpose: 'TRANSFER',
        transferId,
      });
    }
    return this.sparkSendQuoteService.createSendQuote({
      userId,
      account: send.account,
      quote: send.lightningQuote as SparkLightningQuote,
      purpose: 'TRANSFER',
      transferId,
    });
  }
}
```

> Verify the exact import paths/names for `CashuLightningQuote`/`SparkLightningQuote`/`CashuReceiveLightningQuote`/`SparkReceiveLightningQuote` and the service method signatures against the S5/S6 source files (`createCashuDomain`/`createSparkDomain` already call all of these — copy the import locations from there). `CashuReceiveLightningQuote` may live in a core module rather than `types/cashu`; follow what `cashu-domain.ts` imports.

- [ ] **Step 4: Run; expect PASS** — `bun test src/domains/transfers/transfer-service.test.ts`. Expected: all pass (esp. the two §10 cases). Then `bun run typecheck`.

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/domains/transfers/transfer-service.ts src/domains/transfers/transfer-service.test.ts
git commit -m "feat(wallet-sdk): transfer service + §10 receive-auto-fail regression (S8)"
```

---

## Task 8: `createTransfersDomain` (rich→slim map + re-derive on execute)

**Files:**
- Create: `packages/wallet-sdk/src/domains/transfers/transfers-domain.ts`
- Test: `packages/wallet-sdk/src/domains/transfers/transfers-domain.test.ts`

**Interfaces:**
- Produces: `buildTransferService(ctx: DomainContext, accountRepository: AccountRepository): TransferService` (constructs the 4 quote services, Decision D2) and `createTransfersDomain(ctx: DomainContext, service: TransferService): TransfersDomain` (required injected service; `sdk.ts` calls `createTransfersDomain(ctx, buildTransferService(ctx, accountRepository))`; tests inject a fake service).
- Consumes: `TransferService` (T7); the four quote services + their repos (S5/S6); `AccountRepository`; `getCurrentUserId`/`SdkError`; the contract `TransferQuote`/`TransferLeg`/`TransferResult`.

- [ ] **Step 1: Write the failing test** — inject a fake `TransferService`; assert the rich→slim map and the re-derive-then-initiate path.

```ts
import { describe, expect, it, mock } from 'bun:test';
import { type Currency, Money } from '@agicash/money';
import { SdkEventEmitter } from '../../internal/event-emitter';
import type { SdkEventMap } from '../../events';
import { inMemoryStorage, jwtWith } from '../../internal/test-support';
import type { DomainContext } from '../context';
import { createTransfersDomain } from './transfers-domain';

const btc = (sats: number) =>
  new Money({ amount: sats, currency: 'BTC', unit: 'sat' }) as Money<Currency>;
const cashu = { id: 'src', type: 'cashu', currency: 'BTC' } as never;
const spark = { id: 'dst', type: 'spark', currency: 'BTC' } as never;

const richQuote = {
  amount: btc(1000),
  amountToReceive: btc(1000),
  totalFees: btc(20),
  totalCost: btc(1020),
  receive: { account: spark, fee: btc(0), lightningQuote: { invoice: { paymentRequest: 'x' } } },
  send: { account: cashu, lightningQuote: { estimatedTotalFee: btc(20), amountToReceive: btc(1000) } },
};

function setup() {
  const emitter = new SdkEventEmitter<SdkEventMap>();
  const storage = inMemoryStorage({ access_token: jwtWith({ sub: 'u1' }) });
  const ctx = {
    config: { storage },
    connections: { supabase: {}, encryption: {}, cashuCrypto: {} },
    emitter,
  } as unknown as DomainContext;
  const service = {
    getTransferQuote: mock(async () => richQuote),
    initiateTransfer: mock(async () => ({
      transferId: 'xfer', receiveTransactionId: 'rx', sendTransactionId: 'sx',
    })),
  };
  return { ctx, service };
}

describe('createTransfersDomain', () => {
  it('createQuote maps the rich quote to the slim contract shape (legs = { account, fee })', async () => {
    const { ctx, service } = setup();
    const domain = createTransfersDomain(ctx, service as never);

    const quote = await domain.createQuote({
      sourceAccount: cashu,
      destinationAccount: spark,
      amount: btc(1000),
    });
    expect(quote.totalCost.toNumber('sat')).toBe(1020);
    expect(quote.send).toEqual({ account: cashu, fee: btc(20) });
    expect(quote.receive).toEqual({ account: spark, fee: btc(0) });
    expect('lightningQuote' in quote.send).toBe(false);
  });

  it('executeQuote re-derives the live sides then initiates the transfer', async () => {
    const { ctx, service } = setup();
    const domain = createTransfersDomain(ctx, service as never);

    const result = await domain.executeQuote({
      amount: btc(1000),
      amountToReceive: btc(1000),
      totalFees: btc(20),
      totalCost: btc(1020),
      receive: { account: spark, fee: btc(0) },
      send: { account: cashu, fee: btc(20) },
    });

    expect(service.getTransferQuote).toHaveBeenCalledWith({
      sourceAccount: cashu,
      destinationAccount: spark,
      amount: btc(1000),
    });
    expect(service.initiateTransfer).toHaveBeenCalledWith({ userId: 'u1', quote: richQuote });
    expect(result).toEqual({ transferId: 'xfer', receiveTransactionId: 'rx', sendTransactionId: 'sx' });
  });
});
```

- [ ] **Step 2: Run; expect FAIL** — `bun test src/domains/transfers/transfers-domain.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `transfers-domain.ts`** — build the four quote services from `ctx.connections` + `accountRepository` (Decision D2), construct the `TransferService`, and map/re-derive.

```ts
import type { TransfersDomain } from '../../domains';
import { SdkError } from '../../errors';
import { getCurrentUserId } from '../../internal/connections/open-secret';
import type { AccountRepository } from '../../internal/repositories/account-repository';
import { CashuReceiveQuoteRepository } from '../../internal/repositories/cashu-receive-quote-repository';
import { CashuSendQuoteRepository } from '../../internal/repositories/cashu-send-quote-repository';
import { SparkReceiveQuoteRepository } from '../../internal/repositories/spark-receive-quote-repository';
import { SparkSendQuoteRepository } from '../../internal/repositories/spark-send-quote-repository';
import { CashuReceiveQuoteService } from '../cashu/cashu-receive-quote-service';
import { CashuSendQuoteService } from '../cashu/cashu-send-quote-service';
import { SparkReceiveQuoteService } from '../spark/spark-receive-quote-service';
import { SparkSendQuoteService } from '../spark/spark-send-quote-service';
import type { DomainContext } from '../context';
import {
  type InternalTransferQuote,
  type TransferReceiveSide,
  type TransferSendSide,
  TransferService,
} from './transfer-service';

export function buildTransferService(
  ctx: DomainContext,
  accountRepository: AccountRepository,
): TransferService {
  const { supabase, encryption, cashuCrypto } = ctx.connections;
  const cashuReceive = new CashuReceiveQuoteService(
    cashuCrypto,
    new CashuReceiveQuoteRepository(supabase, encryption, accountRepository),
  );
  const sparkReceive = new SparkReceiveQuoteService(
    new SparkReceiveQuoteRepository(supabase, encryption),
  );
  const cashuSend = new CashuSendQuoteService(
    new CashuSendQuoteRepository(supabase, encryption),
  );
  const sparkSend = new SparkSendQuoteService(
    new SparkSendQuoteRepository(supabase, encryption),
  );
  return new TransferService(cashuReceive, sparkReceive, cashuSend, sparkSend);
}

/** Build the transfers domain: createQuote (preview) + executeQuote (persist paired quotes). */
export function createTransfersDomain(
  ctx: DomainContext,
  service: TransferService,
): TransfersDomain {
  const requireUserId = async (): Promise<string> => {
    const id = await getCurrentUserId(ctx.config.storage);
    if (!id) throw new SdkError('No active session', 'NOT_AUTHENTICATED');
    return id;
  };

  const toLeg = (side: TransferReceiveSide | TransferSendSide) =>
    'fee' in side
      ? { account: side.account, fee: side.fee }
      : { account: side.account, fee: side.lightningQuote.estimatedTotalFee };

  const toSlim = (q: InternalTransferQuote) => ({
    amount: q.amount,
    amountToReceive: q.amountToReceive,
    totalFees: q.totalFees,
    totalCost: q.totalCost,
    receive: toLeg(q.receive),
    send: toLeg(q.send),
  });

  return {
    async createQuote({ sourceAccount, destinationAccount, amount }) {
      const quote = await service.getTransferQuote({
        sourceAccount,
        destinationAccount,
        amount,
      });
      return toSlim(quote);
    },

    async executeQuote(quote) {
      const userId = await requireUserId();
      // The slim quote carries no live lightning quotes (and crosses the SDK boundary),
      // so re-derive fresh sides for the same amount + accounts before persisting.
      const rich = await service.getTransferQuote({
        sourceAccount: quote.send.account,
        destinationAccount: quote.receive.account,
        amount: quote.amount,
      });
      return service.initiateTransfer({ userId, quote: rich });
    },
  };
}
```

> The `toLeg` helper handles both sides: the send side's fee is `lightningQuote.estimatedTotalFee` (it has no `fee` field), the receive side carries `fee` directly. Confirm `TransferLeg`'s `fee` for the send leg should be the send's estimated total fee (matches `totalFees = send.estimatedTotalFee + receive.fee`). If `typeof` narrowing on the union is awkward, branch on `'fee' in side` as written.

- [ ] **Step 4: Run; expect PASS** — `bun test src/domains/transfers/transfers-domain.test.ts`. Expected: all pass. Then `bun run typecheck`.

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/domains/transfers/transfers-domain.ts src/domains/transfers/transfers-domain.test.ts
git commit -m "feat(wallet-sdk): transfers domain (createQuote map + executeQuote re-derive) (S8)"
```

---

## Task 9: Wire the three domains into `sdk.ts`

**Files:**
- Modify: `packages/wallet-sdk/src/sdk.ts`
- Test: `packages/wallet-sdk/src/sdk.test.ts` (extend the existing suite)

**Interfaces:**
- Consumes: `createTransactionsDomain` (T4), `createContactsDomain` (T6), `createTransfersDomain` (T8); the existing `ctx` + `accountRepository`.

- [ ] **Step 1: Write the failing test** — assert the three domains are live (no longer throwing `NotImplementedError`). Add to `sdk.test.ts` (follow its existing harness for constructing an `Sdk`/ctx; if it constructs a real `Sdk`, ensure the config includes `lud16Domain`).

```ts
import { describe, expect, it } from 'bun:test';
// ... reuse the file's existing Sdk construction helper ...

describe('Sdk S8 domains are wired', () => {
  it('exposes transactions/contacts/transfers as real domains (not NotImplemented stubs)', async () => {
    const sdk = await makeTestSdk(); // the file's existing helper
    // The stubs throw synchronously on access; a real domain method returns a promise.
    expect(() => sdk.transactions.list()).not.toThrow();
    expect(() => sdk.contacts.list()).not.toThrow();
    // transfers has no zero-arg method; assert the accessor is a real object with createQuote
    expect(typeof sdk.transfers.createQuote).toBe('function');
    // background is still a stub
    expect(() => sdk.background.start()).toThrow();
  });
});
```

> If `notImplementedDomain` throws on *property access* rather than on call, adapt the assertions accordingly (e.g. wrap in `expect(() => sdk.transactions.countPendingAck()).not.toThrow()` — a real method that returns a rejected promise still does not throw synchronously). Inspect `src/internal/not-implemented.ts` to choose the right assertion shape.

- [ ] **Step 2: Run; expect FAIL** — `bun test src/sdk.test.ts`. Expected: FAIL (the stubs throw).

- [ ] **Step 3: Edit `sdk.ts`** —
  1. Imports: add
     ```ts
     import { createTransactionsDomain } from './domains/transactions/transactions-domain';
     import { createContactsDomain } from './domains/contacts/contacts-domain';
     import {
       buildTransferService,
       createTransfersDomain,
     } from './domains/transfers/transfers-domain';
     import { TransactionRepository } from './internal/repositories/transaction-repository';
     import { ContactRepository } from './internal/repositories/contact-repository';
     ```
  2. Drop the three field initializers; change them to bare declarations (keep `background`):
     ```ts
     readonly transactions: TransactionsDomain;
     readonly contacts: ContactsDomain;
     readonly transfers: TransfersDomain;
     ```
  3. In the constructor, after `this.cashu = createCashuDomain(ctx, accountRepository);` / `this.spark = createSparkDomain(ctx);`, build each collaborator and pass it (the `accountRepository` convention — required injected deps):
     ```ts
     this.transactions = createTransactionsDomain(
       ctx,
       new TransactionRepository(connections.supabase, connections.encryption),
     );
     this.contacts = createContactsDomain(
       ctx,
       new ContactRepository(connections.supabase, config.lud16Domain),
     );
     this.transfers = createTransfersDomain(
       ctx,
       buildTransferService(ctx, accountRepository),
     );
     ```
  4. Update the top-of-file comment and the class JSDoc: `transactions`, `contacts`, `transfers` are now implemented; only `background` remains a `NotImplementedError` stub. Keep `import { notImplementedDomain } from './internal/not-implemented';` (still used for `background`).

- [ ] **Step 4: Run; expect PASS** — `bun test src/sdk.test.ts`. Expected: pass. Then `bun run typecheck`.

- [ ] **Step 5: Gate + commit**

```bash
cd packages/wallet-sdk && bun run typecheck && bun run test
git add src/sdk.ts src/sdk.test.ts
git commit -m "feat(wallet-sdk): wire transactions/contacts/transfers domains into Sdk (S8)"
```

---

## Task 10: Whole-slice verification gate + plan-of-plans update

**Files:** `docs/superpowers/plans/2026-06-13-wallet-sdk-00-plan-of-plans.md` (status + carryover); no SDK code changes.

- [ ] **Step 1: Full SDK gate** — from `packages/wallet-sdk/`:

```bash
bun run typecheck && bun run test
```

Expected: green; SDK test count = the prior 535 + the S8 tests added here (≈30; confirm **no failures** and the count rose only by the new tests).

- [ ] **Step 2: Confirm the dark→live transition is correct** —

```bash
git grep -n "notImplementedDomain" src/sdk.ts          # → only `background`
git grep -n "NotImplementedError" src/domains/transfers/ src/domains/transactions/ src/domains/contacts/  # → none
git grep -n "transfer:" src/events.ts                  # → only the "NO transfer:* events" comment
git status --short                                     # clean
```

Expected: `transactions`/`contacts`/`transfers` are assigned in the constructor; only `background` remains stubbed; no `transfer:*` event key exists.

- [ ] **Step 3: Update the plan-of-plans index** — flip row 08 to ✅ done with a one-line summary (tasks + test count), and append a **"Plan 08 → S9 / S11"** carryover block recording: (a) `transaction:created` + broad `transaction:updated` (server-written rows) are the S9 realtime forwarder's job — S8 only emits `transaction:updated` from `acknowledge`; (b) S9's forwarder must not double-drive `contact:created`/`contact:deleted` (S8 emits them synchronously from `add`/`remove`); (c) `executeQuote` re-derives fresh quotes (Decision D3 — re-quote drift vs. the preview is accepted); (d) `SdkConfig.lud16Domain` is now required (S11 web entry must supply it; S10 server config too); (e) `transfers` persists paired quotes only — actual LN payment kickoff is the S9 background orchestrator (the send `executeQuote` it relies on is still `NotImplementedError` and is wired in S9).

- [ ] **Step 4: Commit the docs**

```bash
git add docs/superpowers/plans/2026-06-13-wallet-sdk-00-plan-of-plans.md
git commit -m "docs(wallet-sdk): record Plan 08 (transactions/contacts/transfers) done + S9/S11 carryover"
```

---

## Self-Review

**1. Spec coverage (§7b transactions/contacts/transfers + §9 S8 + §10):**
- Transactions: schema + repo (cursor `list`, `get`, `countPendingAck`, `acknowledge`, `toTransaction`) + the 6 deferred detail parsers → **T1–T4**. ✓
- Contacts: repo (CRUD + `findContactCandidates` + `toContact` lud16) + domain + lud16 config → **T5–T6**. ✓
- Transfers: internal service (paired send+receive, `transferId`) + domain (createQuote/executeQuote) → **T7–T8**. ✓
- §10 regression "transfer receive-auto-fails-on-send-failure" (initiation-time compensating action; rethrow original error) → **T7** (owns it). ✓
- No `transfer:*` events (decision 5); `transaction:*`/`contact:*` bridge rows (§5) → events emitted from `acknowledge` (T4) + `add`/`remove` (T6); broad transaction forwarding deferred to S9 → recorded in **T10**. ✓
- Wired live (not dark) since no orchestrator dependency → **T9**; `background` stays stubbed. ✓

**2. Placeholder scan:** every code step has full code or a precise verbatim-copy + import-remap table (T1/T2 detail/schema ports). Test fixtures are real; commands have expected output. The two "verify field names against the real schema" notes (T1 Step 3, T7 Step 3) are deliberate grounding instructions, not TBDs — the test/typecheck makes them deterministic. No TODO/"implement later".

**3. Type consistency:** `createTransactionsDomain(ctx, repo)` / `createContactsDomain(ctx, repo)` / `createTransfersDomain(ctx, service)` — the collaborator is a **required injected param** (the `accountRepository` convention), built in `sdk.ts` (`new TransactionRepository(...)`, `new ContactRepository(supabase, config.lud16Domain)`, `buildTransferService(ctx, accountRepository)`); tests inject fakes. `acknowledge` returns `Promise<void>` (contract) but the repo's `acknowledge` returns the re-read `Transaction` (for the version-correct emit). `get` returns `T | null` via `maybeSingle` (D6). `TransferLeg.fee` for the send leg = `lightningQuote.estimatedTotalFee`; receive leg = its `fee`; `totalFees = send.estimatedTotalFee + receive.fee` (consistent). `Contact.createdAt` is `new Date(...)` (D8); `lud16` coalesces null username. Error arities `(message, code)`; codes chosen: `NOT_AUTHENTICATED`, `CONTACTS_LIMIT_REACHED`, `CANNOT_SEND_LIGHTNING`, `CANNOT_RECEIVE_LIGHTNING`. Cursor ranks `PENDING→2 else 1` match the DB generated column; `nextCursor` nulled on a short page (D7).

**Risks / carryover to S9 (recorded in T10):**
- `transaction:created` and server-written `transaction:updated` are NOT emitted by S8 (only `acknowledge` emits) — S9's realtime forwarder owns them; until then the web cut-over reads still work via TanStack refetch.
- `contacts.add`/`remove` emit synchronously (D5) — S9's forwarder must avoid double-driving contacts.
- `executeQuote` re-derives (D3) — accepted re-quote drift; if the owner wants fee-stable execution, revisit (would need a contract change to carry the live quote, which PR1119 deliberately removed).
- `transfers` persists paired quotes only; the LN payment is driven by the S9 background orchestrator (whose send `executeQuote` is still `NotImplementedError`).
- `SdkConfig.lud16Domain` is now required — S10 (server) + S11 (web entry) configs must set it.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-13-wallet-sdk-08-transactions-contacts-transfers.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. (REQUIRED SUB-SKILL: superpowers:subagent-driven-development.)
2. **Inline Execution** — execute tasks in this session via superpowers:executing-plans, batch execution with checkpoints.
