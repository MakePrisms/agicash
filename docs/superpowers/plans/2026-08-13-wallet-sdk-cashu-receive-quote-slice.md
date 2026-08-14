# Wallet SDK Cashu Receive Quote Slice (Step 9) Implementation Plan

> **Orchestration note:** tasks 1–4 are delivered as maxplayer marketplace **contribution-mode** jobs: the seller forks `https://github.com/MakePrisms/agicash.git` pinned to the base commit of branch `sdk/cashu-receive-quote-slice`, reads this plan and the referenced code in the fork, edits only the task's declared files, and delivers a branch descending from the base. Job text stays task-only; this document is the full spec. Tasks 0 and 5 run locally. The post-integration adversarial-review job and the PR-description job also run on the marketplace.

**Goal:** Wire the `receive.cashu` sub-namespace of the SDK contract and flip the web cashu-receive-quote creation/tracking from `@agicash/wallet-sdk/temporary` to `sdk.receive.cashu.*`.

**Architecture:** Step 9 of the 19-step no-cache extraction (spec: `docs/superpowers/specs/2026-06-24-wallet-sdk-no-cache-production-design.md`). The already-moved `domain/receive` cashu-receive-quote code gets a session-fenced API factory (`createReceiveApi`), the `AgicashSdk` constructor wires it (replacing the `NotImplementedError` getter), and the web receive flow calls `sdk.receive.cashu.*`. This is a **money-path slice**: the web background processor (`useProcessCashuReceiveQuoteTasks`) keeps completing, expiring, failing, and melt-initiating quotes through `/temporary` until step 18 — exactly like the realtime echo in step 8.

**Tech stack:** TypeScript, bun workspaces, bun:test, Supabase (postgrest-js), TanStack Query v5 (web side only).

## Global constraints

- The SDK stays React-agnostic: `packages/wallet-sdk` never imports `react` or `@tanstack/react-query`.
- Do not touch other domains' `/temporary` imports — only the files listed in this plan.
- The web money-path boundary stays intact: `useProcessCashuReceiveQuoteTasks`, `useCashuReceiveQuoteChangeHandlers`, `usePendingCashuReceiveQuotes`, and the `useCashuReceiveQuoteRepository`/`useCashuReceiveQuoteService` hook exports keep building `/temporary` classes until step 18.
- No event emission from the receive API. `cashu-receive-quote.created`/`.updated` stay type-only until the step-18 realtime feed (contacts + transactions precedent). `events.ts` is untouched.
- Package manager: `bun` / `bunx` only.
- Base branch: `master`. Work branch: `sdk/cashu-receive-quote-slice`.
- No DB schema changes, no dependency changes. All RPCs (`create_cashu_receive_quote` etc.) are used unchanged.
- `packages/wallet-sdk/domain/sdk/sdk.test.ts` has no receive assertions — leave it untouched.
- `packages/wallet-sdk/index.ts` is untouched: `export * from './domain/sdk'` already carries the filled param types; `CashuReceiveQuote` (line 92) and `CashuReceiveLightningQuote` (line 93) are already exported.

## Resolved design decisions

1. **Contract params filled in `domain/sdk/receive.ts`** (replacing the two step-9 `unknown` placeholders; spark/cashuToken placeholders stay): `GetCashuReceiveLightningQuoteParams = { accountId, amount: Money, description? }`, `CreateCashuReceiveQuoteParams = { accountId, lightningQuote: CashuReceiveLightningQuote, purpose?: TransactionPurpose, transferId? }`. `receiveType` is pinned to `'LIGHTNING'` inside the API — `CASHU_TOKEN` quotes are created only by the in-package flows (steps 12/16/17: `receive-cashu-token-quote-service`, `transfer-service`, `lightning-address-service`), never by the host.
2. **`createReceiveApi` in `domain/receive/receive-api.ts` returns the full `ReceiveApi`** with `cashu` implemented and `spark`/`cashuToken` as throwing getters (`NotImplementedError('receive.spark')` / `('receive.cashuToken')`), so the step-11/12 slices fill them without reshaping `sdk.ts`. `sdk.ts` deletes the `get receive()` getter and assigns `readonly receive` in the constructor via `createReceiveApi({ db, getSession: getLiveSession, keys, getAccountRepository: accounts.getRepository })` — the accounts bridge, same as `createUserApi` (sdk.ts:168).
3. **`CashuCryptography` is assembled from session keys inside the factory** (first SDK-side assembly; the web builds its own from TanStack caches): `getSeed: () => keys.getCashuSeed()` (memoized + session-fenced), `getXpub: async (path) => deriveCashuXpub(await keys.getCashuSeed(), path)` (pure re-derivation; for the base locking path this equals `keys.getCashuLockingXpub()` output), `getPrivateKey: getCashuPrivateKey` (direct Open Secret read; only reachable through `completeReceive`, which no step-9 contract method calls — the processor path stays web-side until step 18).
4. **Account resolution by id through the accounts bridge**: each cashu method that needs the account calls `(await deps.getAccountRepository()).get(accountId, { abortSignal })`. `null` → `NotFoundError('Account not found')`; `type !== 'cashu'` → `Error('Account is not a cashu account')`. The fetched `CashuAccount` is structurally assignable to `RedactedCashuAccount` (`RedactedAccount = DistributedOmit<Account, 'proofs'>` keeps `wallet`), so it passes to `createReceiveQuote` directly and `account.wallet` feeds `getLightningQuote`.
5. **Latency parity note (accepted):** quote creation becomes `getLightningQuote` + `createQuote`, each fetching the account fresh (DB read + wallet init) instead of using the web's cached wallet. This is the no-cache design working as intended — reads hit the DB; flipped account reads have behaved this way since step 6.
6. **Session fences follow the accounts template** (fence order of `accounts-api.ts:51–62`): capture `sessionSignal()` → await the repository/service deps → re-check → call with `abortSignal` where the layer accepts it → re-check. `CashuReceiveQuoteService.createReceiveQuote` gains an optional second param `options?: { abortSignal?: AbortSignal }` threaded to `repository.create` — backward-compatible; the in-package callers (transfer-service.ts:210, receive-cashu-token-quote-service.ts:139, lightning-address-service.ts:201) are unchanged. `getLightningQuote` performs mint HTTP calls that cashu-ts cannot abort — pre/post signal checks only.
7. **`requireUserId()` only where the repository needs it**: `createQuote` (the `userId` column). `getQuote` is id-scoped (RLS enforces ownership; `transactions.get`/`contacts.get` precedent). `getLightningQuote` has no explicit session check — the session-keys getters already reject after session end.
8. **Web flip is confined to two hooks in `cashu-receive-quote-hooks.ts`**: `useCreateCashuReceiveQuote` (mutation body → `sdk.receive.cashu.getLightningQuote` + `createQuote`; the hook's external `CreateProps` API is unchanged, so `receive-cashu.tsx` and `buy-provider.tsx` callers are untouched) and `useTrackCashuReceiveQuote` (`queryFn` → `sdk.receive.cashu.getQuote`). Everything else in the file stays: caches, change handlers, `usePendingCashuReceiveQuotes`, `useProcessCashuReceiveQuoteTasks`, and the repository/service hook exports (still consumed by the processor, `transfer-service-hooks.ts`, `receive-cashu-token-hooks.ts`, and `transaction-additional-details.tsx`).
9. **Untouched laggard consumers** (each has its own slice): `transaction-additional-details.tsx` (`getByTransactionId` is not on the contract), `transfer-service-hooks.ts` (step 16), `receive-cashu-token-hooks.ts` + `_protected.receive.cashu_.token.tsx` (step 12), `spark-receive-quote-hooks.ts` (step 11), `cashu-receive-quote-*.server.ts` (step 17).
10. **Canary prunes the dead cashu-receive-quote re-exports in `temporary.ts`**: the `CashuReceiveQuoteSchema` line and the `{ computeTotalFee, deriveNut20LockingPublicKey }` block from `./domain/receive/cashu-receive-quote-core` — zero repo-wide importers. `AgicashDbCashuReceiveQuote`, `getInitializedCashuWallet`, `CashuReceiveQuoteRepository`, and `CashuReceiveQuoteService` stay (live consumers listed in decision 8/9).
11. **No SDK events, no root-index changes, no `sdk.test.ts` changes** (see Global constraints).

## Delegation map (maxplayer, contribution mode)

| Task | Route | Deliverable files |
|---|---|---|
| 0 branch + plan commit + push | local | — |
| 1 canary: prune dead cashu-receive-quote `/temporary` exports | contribution | `packages/wallet-sdk/temporary.ts` |
| 2 SDK: contract params + receive-api + service options param + sdk.ts wiring | contribution | 4 files (see Task specs) |
| 3 SDK: receive-api tests | contribution | `packages/wallet-sdk/domain/receive/receive-api.test.ts` |
| 4 web flip: two hooks → `sdk.receive.cashu` | contribution | `apps/web-wallet/app/features/receive/cashu-receive-quote-hooks.ts` |
| 5 integration, gates, smoke (live testnut receive) | local | — |
| 6 adversarial review of the integrated diff | marketplace | findings report |
| 7 PR description | marketplace | PR body markdown |

Jobs 1–4 are posted in parallel against the same base commit (this plan commit on `sdk/cashu-receive-quote-slice`). The pinned seams below are authoritative: the test and web-flip jobs compile against the pinned contract, not job 2's delivery. Each job edits ONLY its declared files. The orchestrator verifies each delivered tree against the base (`git archive` + `diff -rq`; changed set must equal the declared set), integrates, and runs the local gates. Failed deliveries: log, re-route or do locally.

## Pinned seams (authoritative for jobs 2–4)

Contract (`packages/wallet-sdk/domain/sdk/receive.ts`) — replace only the two step-9 placeholder lines with:

```ts
export type GetCashuReceiveLightningQuoteParams = {
  /** ID of the cashu account to receive into. */
  accountId: string;
  /** The amount to receive. */
  amount: Money;
  /** The description of the receive request. */
  description?: string;
};

export type CreateCashuReceiveQuoteParams = {
  /** ID of the cashu account to receive into. */
  accountId: string;
  /** The lightning quote to create the receive quote from (see `getLightningQuote`). */
  lightningQuote: CashuReceiveLightningQuote;
  /** The purpose of the transaction. When not provided, PAYMENT is used. */
  purpose?: TransactionPurpose;
  /** UUID linking paired send/receive transactions in a transfer. */
  transferId?: string;
};
```

with two new type-only imports: `import type { Money } from '@agicash/money';` and `import type { TransactionPurpose } from '../transactions/transaction-enums';`. The spark/cashuToken placeholder types and everything else in the file stay byte-identical.

API factory (`packages/wallet-sdk/domain/receive/receive-api.ts`, new file):

```ts
type Deps = {
  db: AgicashDb;
  getSession: () => AuthSession;
  keys: SessionKeys;
  /** Accounts bridge; resolves the receiving account (sdk.ts wires accounts.getRepository). */
  getAccountRepository: () => Promise<AccountRepository>;
  /** Test seam; defaults to building the repository from db + session keys + account repository. */
  createRepository?: () => Promise<CashuReceiveQuoteRepository>;
  /** Test seam; defaults to building the service from session-keys cryptography + the repository. */
  createService?: () => Promise<CashuReceiveQuoteService>;
};

export function createReceiveApi(deps: Deps): ReceiveApi;
```

Method bodies (fence order pinned):

```ts
getLightningQuote: async (params) => {
  const signal = deps.keys.sessionSignal();
  const service = await getService();
  const account = await getCashuAccount(params.accountId, signal);
  const quote = await service.getLightningQuote({
    wallet: account.wallet,
    amount: params.amount,
    description: params.description,
  });
  if (signal.aborted) throw new SessionEndedError();
  return quote;
},
createQuote: async (params) => {
  const userId = requireUserId();
  const signal = deps.keys.sessionSignal();
  const service = await getService();
  const account = await getCashuAccount(params.accountId, signal);
  const quote = await service.createReceiveQuote(
    {
      userId,
      account,
      receiveType: 'LIGHTNING',
      lightningQuote: params.lightningQuote,
      purpose: params.purpose,
      transferId: params.transferId,
    },
    { abortSignal: signal },
  );
  if (signal.aborted) throw new SessionEndedError();
  return quote;
},
getQuote: async (id) => {
  const signal = deps.keys.sessionSignal();
  const repository = await getRepository();
  if (signal.aborted) throw new SessionEndedError();
  const quote = await repository.get(id, { abortSignal: signal });
  if (signal.aborted) throw new SessionEndedError();
  return quote;
},
```

`getCashuAccount(accountId, signal)` is a factory-scoped helper: `await deps.getAccountRepository()` → re-check signal → `repository.get(accountId, { abortSignal: signal })` → re-check signal → `null` → `NotFoundError('Account not found')` → `account.type !== 'cashu'` → `Error('Account is not a cashu account')` → returns `CashuAccount`. `requireUserId()` is verbatim from `transactions-api.ts:16–22`. The `cryptography` const follows decision 3. `spark`/`cashuToken` are throwing getters typed `ReceiveApi['spark']` / `ReceiveApi['cashuToken']`.

Service signature change (`packages/wallet-sdk/domain/receive/cashu-receive-quote-service.ts`):

```ts
async createReceiveQuote(
  params: CreateQuoteParams,
  options?: { abortSignal?: AbortSignal },
): Promise<CashuReceiveQuote>
```

with both `this.cashuReceiveQuoteRepository.create(...)` calls gaining `options` as the second argument. Nothing else in the service changes.

Wiring (`packages/wallet-sdk/domain/sdk/sdk.ts`): delete the `get receive()` getter; add `readonly receive: ReceiveApi;` alongside the other readonly namespaces; assign in the constructor tail after `this.transactions`:

```ts
this.receive = createReceiveApi({
  db,
  getSession: getLiveSession,
  keys,
  getAccountRepository: accounts.getRepository,
});
```

`NotImplementedError` stays imported (other getters still throw it).

Web flip (`apps/web-wallet/app/features/receive/cashu-receive-quote-hooks.ts`): add `import { sdk } from '~/features/shared/sdk.client';`. In `useCreateCashuReceiveQuote`, delete the `useUser`/`useCashuReceiveQuoteService` locals and replace the mutation body:

```ts
mutationFn: async ({ account, amount, description, purpose, transferId }: CreateProps) => {
  const lightningQuote = await sdk.receive.cashu.getLightningQuote({
    accountId: account.id,
    amount,
    description,
  });
  return sdk.receive.cashu.createQuote({
    accountId: account.id,
    lightningQuote,
    purpose,
    transferId,
  });
},
```

In `useTrackCashuReceiveQuote`, delete the repository local and use `queryFn: () => sdk.receive.cashu.getQuote(quoteId!)` (keep the biome-ignore comment for the non-null assertion). No other hook, cache, type, or import in the file changes (`useUser` stays — `usePendingCashuReceiveQuotes` uses it).

## File map

- Modify: `packages/wallet-sdk/temporary.ts` (canary prune, task 1)
- Modify: `packages/wallet-sdk/domain/sdk/receive.ts` (contract params, task 2)
- Create: `packages/wallet-sdk/domain/receive/receive-api.ts` (task 2)
- Modify: `packages/wallet-sdk/domain/receive/cashu-receive-quote-service.ts` (options param, task 2)
- Modify: `packages/wallet-sdk/domain/sdk/sdk.ts` (wire the namespace, task 2)
- Create: `packages/wallet-sdk/domain/receive/receive-api.test.ts` (task 3)
- Modify: `apps/web-wallet/app/features/receive/cashu-receive-quote-hooks.ts` (task 4)
- Untouched on purpose: `packages/wallet-sdk/index.ts`, `domain/sdk/index.ts`, `domain/sdk/events.ts`, `sdk.test.ts`, `cashu-receive-quote-repository.ts`, `cashu-receive-quote-core.ts`, `cashu-receive-quote.ts`, both `*.server.ts` files, all web `.tsx` components, `task-processing.ts`, `use-track-wallet-changes.ts`, `sdk.client.ts`, all RPCs and migrations.

## Task specs (read by contribution-mode sellers)

**Task 1 (canary prune).** In `packages/wallet-sdk/temporary.ts`, delete exactly two export statements: `export { CashuReceiveQuoteSchema } from './domain/receive/cashu-receive-quote';` and the block `export { computeTotalFee, deriveNut20LockingPublicKey } from './domain/receive/cashu-receive-quote-core';`. Before deleting, verify with a repo-wide grep that no file imports these three names from `@agicash/wallet-sdk/temporary` (the spark-core exports of the same-named `computeQuoteExpiry`/`getLightningQuote` are a different block — do not touch it). Gate: `bun install && bun run fix:all && bun run typecheck` all exit 0.

**Task 2 (SDK namespace).** Apply the pinned seams above to the four files in the file map. Read `domain/transactions/transactions-api.ts` and `domain/accounts/accounts-api.ts` first — `receive-api.ts` follows their structure, naming, and JSDoc style. Imports for `receive-api.ts`: `AgicashDb` from `../../db/database`; `NoSessionError`, `NotFoundError`, `NotImplementedError`, `SessionEndedError` from `../../lib/error`; `CashuCryptography`, `getCashuPrivateKey` from `../../lib/cashu`; `deriveCashuXpub` from `../../lib/cryptography`; `AuthSession`, `ReceiveApi` types from `../sdk`; `SessionKeys` from `../sdk/session-keys`; `AccountRepository` from `../accounts/account-repository`; `CashuAccount` from `../accounts/account`; `CashuReceiveQuoteRepository` / `CashuReceiveQuoteService` from their files. Gate: `bun install && bun run fix:all && bun run typecheck` all exit 0 (the service's in-package callers must still compile).

**Task 3 (tests).** Create `packages/wallet-sdk/domain/receive/receive-api.test.ts` with bun:test, mirroring the harness style of `domain/transactions/transactions-api.test.ts` and `domain/accounts/accounts-api.test.ts` (fake `getSession`, fake `SessionKeys` with a controllable `sessionSignal`, seam injection via `createRepository`/`createService`/`getAccountRepository`). Compile against the pinned seams in this plan, not task 2's delivery. Required coverage: (a) `createQuote` throws `NoSessionError` when the session is not logged in, before any repository work; (b) `createQuote` happy path passes `{ userId, account, receiveType: 'LIGHTNING', lightningQuote, purpose, transferId }` and `{ abortSignal }` to the service; (c) `createQuote` rejects with `SessionEndedError` when the signal aborts during repository/service construction (mid-write fence) and the service is never called; (d) `getLightningQuote` resolves the account by id and calls the service with `{ wallet, amount, description }`; (e) `getLightningQuote` throws `NotFoundError` for a missing account and `Error` for a non-cashu account; (f) `getQuote` returns the repository result including `null` and threads the abort signal; (g) `getQuote` rejects with `SessionEndedError` when the signal is aborted; (h) accessing `receive.spark` and `receive.cashuToken` throws `NotImplementedError`. Gate: `bun install`, then from `packages/wallet-sdk`: `bun test domain/receive/receive-api.test.ts` green; `bun run fix:all && bun run typecheck` exit 0. NOTE: task 2 lands in parallel — if `receive-api.ts` does not exist in your fork, still write the test importing `./receive-api`; the orchestrator integrates and runs the suite after both land (your gate then only needs `fix:all` formatting conformance on the new file).

**Task 4 (web flip).** Apply the pinned web-flip seam to `apps/web-wallet/app/features/receive/cashu-receive-quote-hooks.ts` only. The two flipped hooks must not reference `useCashuReceiveQuoteService`/`useCashuReceiveQuoteRepository` anymore; every other hook in the file stays byte-identical (the processor and change handlers are the step-18 boundary). Do not remove exports or imports that are still used elsewhere in the file. NOTE: the SDK side lands in parallel — `sdk.receive.cashu.*` may throw `NotImplementedError` in your fork; that is expected. Gate: `bun install && bun run fix:all` exit 0, plus `cd apps/web-wallet && bun run typecheck` if the SDK task has landed in your base (otherwise skip typecheck; the orchestrator gates it at integration).

## Verification summary

| Gate | Command | Expectation |
|---|---|---|
| Lint/format | `bun run fix:all` | exit 0 |
| Types (all pkgs) | `bun run typecheck` | exit 0 |
| Unit tests | `bun run test` | green (existing suites + new receive-api tests) |
| Smoke | manual, browser, local stack | app boots; receive flow creates a cashu quote via `sdk.receive.cashu.*`; live testnut receive completes end-to-end (web processor mints via `/temporary`); transaction appears; no console errors |
