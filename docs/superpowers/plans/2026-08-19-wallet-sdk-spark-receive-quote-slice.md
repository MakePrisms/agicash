# Wallet SDK Spark Receive Quote Slice (Step 11) Implementation Plan

> **Orchestration note:** like step 10, this slice ships as **one whole-slice contribution job**. A separate implementer forks the repo at the base of a new `sdk/spark-receive-quote-slice` branch (off `master`), reads this plan and the referenced code in the fork, and delivers the SDK namespace extension + tests + web flip + canary prune together on a branch descending from the base. The orchestrator then integrates locally and runs the gates from the Verification summary; adversarial review of the integrated diff follows. Job text stays task-only; this document is the full spec.

**Goal:** Implement the `receive.spark` sub-namespace of the SDK contract and flip the web spark-receive-quote creation/tracking from `@agicash/wallet-sdk/temporary` to `sdk.receive.spark.*`.

**Architecture:** Step 11 of the 19-step no-cache extraction (spec: `docs/superpowers/specs/2026-06-24-wallet-sdk-no-cache-production-design.md`). The already-moved `domain/receive` spark-receive-quote code (`spark-receive-quote.ts` / `-core.ts` / `-service.ts` / `-repository.ts`) gets its host-initiated verbs exposed through the step-9 `createReceiveApi` factory — replacing the `receive-api.ts` throwing `get spark()` getter (`NotImplementedError('receive.spark')`), which is the seam this slice fills — and the web receive flow calls `sdk.receive.spark.*`. This is a **money-path slice**: the web background processor (`useProcessSparkReceiveQuoteTasks`), the change handlers, and the pending-quote reads keep using `/temporary` until step 18 — the same boundary style as steps 9 and 10.

**Tech stack:** TypeScript, bun workspaces, bun:test, Supabase (postgrest-js), TanStack Query v5 (web side only).

## Global constraints

- **Param precedent (binding, set by the #1176 review):** contract methods take the caller-supplied full domain object (`account: SparkAccount`), never an id the SDK re-fetches. Fetch-by-id is reserved for paths with no caller state (background/orchestrator work, server routes). A flipped web flow must issue no additional network requests versus master. Binding text: production design → "Corollary (foreground parity)"; contract proposal → "Conventions across all namespaces". The merged step-9/10 `receive-api.ts` / `domain/sdk/receive.ts` are authoritative — the step-9 *plan*'s `accountId` text predates the review.
- **No host/processing split.** Do not split `SparkReceiveQuoteRepository`/`SparkReceiveQuoteService` into host and processing halves — the spec assigns that to step 18 explicitly ("Split the receive/send repos + services along the host/processing line", step-18 bullet). This slice wraps the bundled classes as they are; `complete`/`expire`/`fail`/`markMeltInitiated` just never appear on the contract.
- The SDK stays React-agnostic: `packages/wallet-sdk` never imports `react` or `@tanstack/react-query`.
- The web money-path boundary stays intact: `useSparkReceiveQuoteService`, `useSparkReceiveQuoteRepository`, `useSparkReceiveQuoteChangeHandlers`, `usePendingSparkReceiveQuotes`, `useProcessSparkReceiveQuoteTasks`, and the `PendingSparkReceiveQuotesCache` keep building `/temporary` classes until step 18.
- No event emission. `spark-receive-quote.created`/`.updated` stay type-only until the step-18 realtime feed. `domain/sdk/events.ts` is untouched.
- No DB schema changes, no dependency changes. The RPCs (`create_spark_receive_quote`, etc.) are used unchanged.
- Do not touch other domains' `/temporary` imports — only the files listed in this plan. Laggard consumers with their own future slices stay untouched (decision 10).
- Root `packages/wallet-sdk/index.ts` is untouched: `export * from './domain/sdk'` (line 10) carries the two new param types, and `SparkAccount` (line 36), `SparkReceiveQuote` (line 86), and `SparkReceiveLightningQuote` (index.ts:87–91, named on line 88) are already exported at the root. The `receive` namespace was wired in step 9 (`sdk.ts:181`); the factory's return object just grows. **`domain/sdk/sdk.ts`, `domain/sdk/index.ts`, and `domain/sdk/sdk.test.ts` ARE in scope** — step 11 is the first Spark slice, so it must fulfill the `Sdk.init()` WASM obligation (decision 12). The contract-proposal doc is untouched (its `ReceiveApi` sketch is representative; "exact param types settle in each slice PR" per its own text).
- Package manager: `bun` / `bunx` only. Base branch: `master`. Work branch: `sdk/spark-receive-quote-slice`.

## Resolved design decisions

1. **Slice scope = the spark-receive-quote domain's host-initiated verbs: preview, create, track.** Evidence: repo-wide grep shows exactly two web host-side entry points into the domain — `useCreateSparkReceiveQuote` (`spark-receive-quote-hooks.ts:305`) and `useTrackSparkReceiveQuote` (`:103`). `complete`/`expire`/`fail`/`markMeltInitiated` are background verbs → hide behind `sdk.background` (step 18), `getPending` is the processor's read (step 18), `toQuote` is a row-mapping detail the change handlers need (step 18).
2. **Contract params take the full `SparkAccount`:** `GetSparkReceiveLightningQuoteParams = { account: SparkAccount, amount: Money, description?: string }`, `CreateSparkReceiveQuoteParams = { account: SparkAccount, lightningQuote: SparkReceiveLightningQuote, purpose?: TransactionPurpose, transferId?: string }`. The web hooks already hold the account (`CreateProps.account: SparkAccount`) and use `account.wallet` for the preview today, so nothing re-fetches and the flipped flow adds zero network requests (foreground parity). Matches the merged step-9/10 shapes (callsites pass `account` straight through).
   **`amount` stays the broad `Money` deliberately, with a pinned runtime BTC guard in the api.** Spark quotes are BTC-only at runtime (`spark-receive-quote-core.ts` executes `amount.toNumber('sat')` unconditionally, which throws `Unsupported unit` for USD), but the core itself types `amount: Money`, the cashu sibling contract is broad, and the web callers (`receive-spark.tsx` `Props.amount: Money`, the buy flow) hold broad `Money` — `Money` is a generic class, not a discriminated union, so a `Money<'BTC'>` contract param cannot be narrowed cast-free at the web boundary without editing the untouched callers. Instead `spark.getLightningQuote` rejects non-BTC amounts up front with a clear error (pinned in the api seam below) plus a USD-rejection test (test 13). `createQuote` needs no guard: `SparkReceiveLightningQuote.amount` is already `Money<'BTC'>` by construction.
3. **The preview goes through a new `SparkReceiveQuoteService.getLightningQuote` delegate** (`getLightningQuote(params) => getLightningQuote(params)`), mirroring the in-package server twin `SparkReceiveQuoteServiceServer.getLightningQuote` (`spark-receive-quote-service.server.ts:36–40`). *Rationale: the host service has no such method today (the web calls the core free function directly); a service-level wrapper keeps the api's preview fenced through service construction and test-seamable via the new `createSparkService` seam this slice adds, same as `cashu.getLightningQuote`.*
4. **`receiveType` is pinned to `'LIGHTNING'` inside the api** — the host receive flow only ever creates `LIGHTNING` quotes. The sole `CASHU_TOKEN` creator is the in-package `ReceiveCashuTokenQuoteService` (`receive-cashu-token-quote-service.ts:168–181`); `TransferService` (`transfer-service.ts:204–226`) and the server Lightning-address flow (`lightning-address-service.ts:231–244`, via the server twin) also pass `LIGHTNING`. Same reasoning that pinned `receiveType: 'LIGHTNING'` in step 9.
5. **`SparkReceiveQuoteService.createReceiveQuote` gains an optional `options?: { abortSignal?: AbortSignal }` second param**, threaded to **both** `this.repository.create(...)` calls (the LIGHTNING and the CASHU_TOKEN branches). Backward-compatible: the **two** unchanged in-package callers of the client service — `receive-cashu-token-quote-service.ts:169` and `transfer-service.ts:219` — still compile (the third current caller is the web hook this slice replaces). `lightning-address-service.ts` constructs the distinct server twin `SparkReceiveQuoteServiceServer` (`lightning-address-service.ts:29`, `:222`) and is unaffected by the client signature change — it matters here only as an untouched-boundary check. Same pattern as step-9's `CashuReceiveQuoteService.createReceiveQuote` change. `get`, `complete`, `expire`, `fail`, `markMeltInitiated` are unchanged.
6. **Session fences follow the merged step-9/10 template** (fence order of `receive-api.ts` `cashu.createQuote`: `requireUserId()` → capture `sessionSignal()` → await service builder → re-check → call with `{ abortSignal }` → re-check): `createQuote` calls `requireUserId()` (the repository writes `p_user_id`), `getQuote` is id-scoped (RLS enforces ownership; `transactions.get`/`contacts.get` precedent, step-9 decision 7) and threads the signal into `repository.get` (already accepts it), and `getLightningQuote` fences via the service-construction await plus the pre/post signal checks (Breez `receivePayment` cannot be aborted — same stance as step-9's mint HTTP calls). A result is never returned for an ended session.
7. **The `spark` getter stops throwing and returns the implemented sub-namespace**; `cashuToken` stays a throwing getter (step 12). This deletes the `NotImplementedError('receive.spark')` from `receive-api.ts`; the `NotImplementedError` import stays (the `cashuToken` getter still throws).
8. **Web flip is confined to two hooks in `spark-receive-quote-hooks.ts`:** `useCreateSparkReceiveQuote` (mutation body → `sdk.receive.spark.getLightningQuote` + `createQuote`) and `useTrackSparkReceiveQuote` (`queryFn` → `sdk.receive.spark.getQuote`). The hooks' external APIs (`CreateProps`, `UseTrackSparkReceiveQuoteProps`, return shapes) are unchanged, so `receive-spark.tsx`, `buy-provider.tsx`, `buy-store.ts`, and `buy-checkout.tsx` callers are untouched — exactly step-9's precedent (`cashu-receive-quote-hooks.ts` body flip; `receive-cashu.tsx` and `buy-provider.tsx` untouched).
9. **Everything else in the hooks file stays byte-identical:** the repository/service hook exports (consumed by `useProcessSparkReceiveQuoteTasks`, `receive-cashu-token-hooks.ts`, and `transfer-service-hooks.ts`), change handlers, pending-quote reads, and `useUser` (`usePendingSparkReceiveQuotes` still uses it).
10. **Canary prunes exactly `getLightningQuote`** from `temporary.ts`: its re-export block is `{ computeQuoteExpiry, getAmountAndFee, getLightningQuote } from './domain/receive/spark-receive-quote-core'` (temporary.ts:112–116), and its **sole** repo-wide importer is `spark-receive-quote-hooks.ts` — the flip deletes that import, making it dead. Verified 2026-08-19 with repo-wide greps; re-verify before deleting. `SparkReceiveQuoteSchema` (temporary.ts:111), `computeQuoteExpiry`, and `getAmountAndFee` also have zero `/temporary` importers (pre-existing dead re-exports) but this flip does **not** make them dead — prune only `getLightningQuote`; the others are step-19 cleanup (per the canary rule: only the re-exports this flip makes dead).
11. **No SDK events, no root `index.ts` changes, no `.server` twin changes** (see Global constraints). The `.server.ts` twins are step-17 scope and stay untouched.
12. **First-Spark WASM obligation: `AgicashSdk.init()` now front-loads the Breez WASM.** The public contract (`domain/sdk/index.ts:82–93`) promises that `init()` front-loads session restore **and** the Breez WASM load, with a migration note scoping the restore-only behavior "until the first Spark slice lands" — which step 11 is. The implementation (`domain/sdk/sdk.ts:201–209`) still restores only. This slice fulfills the contract: `init()` becomes `Promise.all([this.authService.restoreSession(), ensureBreezWasm()])` (pinned seam below), the expired "Migration note" paragraph is deleted from the `domain/sdk/index.ts` JSDoc (the rest of that JSDoc already describes the target behavior, including rejection with `WebAssemblyUnavailableError`), and the stale "folds in when the first Spark slice lands" comment on `sdk.ts` `init()` is replaced. `lib/spark/wasm.ts` is **unchanged** (already memoized single-flight; already pre-checks `WebAssembly` availability). The web hosts are **unchanged**: `entry.client.tsx:40` (fire-and-forget warm-up) and `_protected.tsx:87` (awaited before the temporary spark-mnemonic prefetch) share the same memoized module promise through `/temporary`, so there is no double-load and no web behavior change; those host calls are deleted later, with the slices that remove the temporary prefetches. The web already calls `sdk.init()` (`features/user/auth.ts:66`), and `entry.client.tsx` starts the WASM load at module scope before that, so the awaited work is typically already in flight. Failure semantics are the contract's: `init()` rejects on WASM failure; session-restore retry semantics stay owned by `authService.restoreSession()`.

## Pinned seams (authoritative for the implementation)

Contract (`packages/wallet-sdk/domain/sdk/receive.ts`) — replace only the two step-11 placeholder lines (86–87) with:

```ts
export type GetSparkReceiveLightningQuoteParams = {
  /** The spark account to receive into. */
  account: SparkAccount;
  /** The amount to receive. */
  amount: Money;
  /** The description of the receive request. */
  description?: string;
};

export type CreateSparkReceiveQuoteParams = {
  /** The spark account to receive into. */
  account: SparkAccount;
  /** The lightning quote to create the receive quote from (see `getLightningQuote`). */
  lightningQuote: SparkReceiveLightningQuote;
  /** The purpose of the transaction. When not provided, PAYMENT is used. */
  purpose?: TransactionPurpose;
  /** UUID linking paired send/receive transactions in a transfer. */
  transferId?: string;
};
```

with one import change: line 3 becomes `import type { CashuAccount, SparkAccount } from '../accounts/account';`. `SparkReceiveLightningQuote` (line 8) and `SparkReceiveQuote` (line 7) are already imported; the `ReceiveApi.spark` member signatures (lines 35–43) are already declared. Everything else in the file stays byte-identical.

API factory (`packages/wallet-sdk/domain/receive/receive-api.ts`) — add to `Deps` after the swap seams:

```ts
/** Test seam; defaults to building the spark repository from db + session keys. */
createSparkRepository?: () => Promise<SparkReceiveQuoteRepository>;
/** Test seam; defaults to building the spark service from the spark repository. */
createSparkService?: () => Promise<SparkReceiveQuoteService>;
```

add builders next to the existing `getSwapService`:

```ts
const getSparkRepository =
  deps.createSparkRepository ??
  (async (): Promise<SparkReceiveQuoteRepository> => {
    const encryption = await deps.keys.getEncryption();
    return new SparkReceiveQuoteRepository(deps.db, encryption);
  });

const getSparkService =
  deps.createSparkService ??
  (async (): Promise<SparkReceiveQuoteService> =>
    new SparkReceiveQuoteService(await getSparkRepository()));
```

and replace the throwing `get spark()` getter (lines 138–140) with a plain `spark` property after `cashu` (fence order pinned):

```ts
spark: {
  getLightningQuote: async (params) => {
    if (params.amount.currency !== 'BTC') {
      throw new Error('Spark receive quotes support BTC amounts only');
    }
    const signal = deps.keys.sessionSignal();
    const service = await getSparkService();
    if (signal.aborted) throw new SessionEndedError();
    const quote = await service.getLightningQuote({
      wallet: params.account.wallet,
      amount: params.amount,
      description: params.description,
    });
    if (signal.aborted) throw new SessionEndedError();
    return quote;
  },
  createQuote: async (params) => {
    const userId = requireUserId();
    const signal = deps.keys.sessionSignal();
    const service = await getSparkService();
    if (signal.aborted) throw new SessionEndedError();
    const quote = await service.createReceiveQuote(
      {
        userId,
        account: params.account,
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
    const repository = await getSparkRepository();
    if (signal.aborted) throw new SessionEndedError();
    const quote = await repository.get(id, { abortSignal: signal });
    if (signal.aborted) throw new SessionEndedError();
    return quote;
  },
},
```

New imports: `SparkReceiveQuoteRepository` / `SparkReceiveQuoteService` from their files, and `SparkReceiveLightningQuote` is resolved through the service (no direct core import needed in `receive-api.ts`). The `cashuToken` getter, `cryptography` const, and all existing seams/methods are byte-identical.

Service changes (`packages/wallet-sdk/domain/receive/spark-receive-quote-service.ts`):

```ts
async createReceiveQuote(
  params: CreateQuoteParams,
  options?: { abortSignal?: AbortSignal },
): Promise<SparkReceiveQuote>
```

with both `this.repository.create(...)` calls (the CASHU_TOKEN branch and the LIGHTNING branch) gaining `options` as the second argument. Add the preview delegate (decision 3) above `createReceiveQuote`, extending the existing core import (line 2) with `type GetLightningQuoteParams`, `type SparkReceiveLightningQuote`, and the `getLightningQuote` value:

```ts
/**
 * Gets a Breez SDK lightning receive quote for the given amount.
 * @returns The Spark lightning receive quote.
 */
async getLightningQuote(
  params: GetLightningQuoteParams,
): Promise<SparkReceiveLightningQuote> {
  return getLightningQuote(params);
}
```

`get`, `complete`, `expire`, `fail`, and `markMeltInitiated` are unchanged.

SDK init (`packages/wallet-sdk/domain/sdk/sdk.ts`, decision 12) — add `import { ensureBreezWasm } from '../../lib/spark/wasm';` (house style: direct file import, next to the existing `../../lib/spark/wallet` import) and replace the `init()` method plus its stale comment with:

```ts
/**
 * Front-loads session restore and the Breez WASM load (see the `Sdk.init`
 * contract). Session restore delegates to the auth service, which is
 * single-flight and memoizes success but clears a rejection, so the host's
 * query retries can recover.
 */
init(): Promise<void> {
  return Promise.all([
    this.authService.restoreSession(),
    ensureBreezWasm(),
  ]).then(() => undefined);
}
```

In `packages/wallet-sdk/domain/sdk/index.ts`, delete only the two-line "Migration note" paragraph from the `init()` JSDoc (`index.ts:90–91`); the rest of that JSDoc stays byte-identical. `dispose()`, `create()`, and everything else in both files stay byte-identical. `lib/spark/wasm.ts` is not edited.

Web flip (`apps/web-wallet/app/features/receive/spark-receive-quote-hooks.ts`):

1. Add `import { sdk } from '~/features/shared/sdk.client';` and delete `getLightningQuote,` from the `@agicash/wallet-sdk/temporary` import block (lines 15–21). `SparkReceiveQuoteRepository`, `SparkReceiveQuoteService`, `getInitializedCashuWallet`, and `sparkDebugLog` stay in that block; the `AgicashDbSparkReceiveQuote` type import (line 14) stays (change handlers).
2. In `useTrackSparkReceiveQuote`: delete the `const sparkReceiveQuoteRepository = useSparkReceiveQuoteRepository();` local (line 111); change `queryFn: () => sparkReceiveQuoteRepository.get(quoteId!)` to `queryFn: () => sdk.receive.spark.getQuote(quoteId!)`, keeping the `biome-ignore lint/style/noNonNullAssertion` comment. The `useEffect`, cache key, and response mapping are unchanged.
3. In `useCreateSparkReceiveQuote`: delete the `const userId = useUser((user) => user.id);` (line 306) and `const sparkReceiveQuoteService = useSparkReceiveQuoteService();` (line 307) locals; replace the `mutationFn` body with:

```ts
mutationFn: async ({
  account,
  amount,
  description,
  purpose,
  transferId,
}: CreateProps) => {
  const lightningQuote = await sdk.receive.spark.getLightningQuote({
    account,
    amount,
    description,
  });
  return sdk.receive.spark.createQuote({
    account,
    lightningQuote,
    purpose,
    transferId,
  });
},
```

`onSuccess` (cache add) and `retry: 1` are unchanged; the `sparkReceiveQuoteCache` local stays. `useUser` stays imported (`usePendingSparkReceiveQuotes` uses it); the **local `useSparkReceiveQuoteService` hook definition** (declared in this file at lines 47–50) stays, and the `SparkReceiveQuoteService` **class import** stays (the processor calls the local hook at line 474). No other hook, cache, type, or import in the file changes.

## File map

- Modify: `packages/wallet-sdk/temporary.ts` (canary prune, decision 10)
- Modify: `packages/wallet-sdk/domain/sdk/receive.ts` (contract params, decision 2)
- Modify: `packages/wallet-sdk/domain/receive/receive-api.ts` (spark sub-namespace + seams, decisions 3–7)
- Modify: `packages/wallet-sdk/domain/receive/spark-receive-quote-service.ts` (options param + delegate, decisions 3/5)
- Modify: `packages/wallet-sdk/domain/sdk/sdk.ts` (`init()` WASM wiring, decision 12)
- Modify: `packages/wallet-sdk/domain/sdk/index.ts` (delete the expired `init()` migration note, decision 12)
- Modify: `packages/wallet-sdk/domain/sdk/sdk.test.ts` (`init()` WASM coverage, test 14)
- Modify: `packages/wallet-sdk/domain/receive/receive-api.test.ts` (new `spark` coverage; narrow the `spark and cashuToken` describe)
- Modify: `apps/web-wallet/app/features/receive/spark-receive-quote-hooks.ts` (web flip, decision 8)
- Untouched on purpose: root `packages/wallet-sdk/index.ts`, `domain/sdk/events.ts`, `lib/spark/wasm.ts`, `spark-receive-quote-repository.ts`, `spark-receive-quote.ts`, `spark-receive-quote-core.ts`, both `spark-receive-quote-*.server.ts` files, `lightning-address-service.ts`, `receive-cashu-token-quote-service.ts`, `transfer-service.ts`, all web `.tsx`/store files (`receive-spark.tsx`, `buy-provider.tsx`, `buy-store.ts`, `buy-checkout.tsx`), `entry.client.tsx`, `_protected.tsx`, `receive-cashu-token-hooks.ts`, `transfer-service-hooks.ts`, `claim-cashu-token-service.ts`, `task-processing.ts`, `use-track-wallet-changes.ts`, `sdk.client.ts`, all RPCs and migrations.

## Task specs

**Task 0 (local, orchestrator): branch + plan commit.** The plan commit on this document is the pinned base. The implementation job branches `sdk/spark-receive-quote-slice` off `master` and appends its delivery branch onto it.

**Task 1 (contribution, single implementer): the whole slice.** Edit exactly the nine files in the file map, applying the pinned seams verbatim. Working order and requirements:

1. **Canary prune.** Re-verify with a repo-wide grep that no file outside `packages/wallet-sdk` imports `getLightningQuote` from `@agicash/wallet-sdk/temporary` (the only current importer, `spark-receive-quote-hooks.ts`, has its import deleted in step 4 of this task — do the prune *after* the web flip edit, or confirm the ordering on the same branch so the intermediate commit never breaks). Then delete the `getLightningQuote,` line from the `temporary.ts` block, leaving `export { computeQuoteExpiry, getAmountAndFee } from './domain/receive/spark-receive-quote-core';`. Do **not** touch `SparkReceiveQuoteSchema` (temporary.ts:111), `computeQuoteExpiry`, or `getAmountAndFee` — pre-existing dead re-exports, out of scope.
2. **Contract + factory + service.** Apply the pinned seams. Read the merged step-9/10 files first — `domain/sdk/receive.ts`, `domain/receive/receive-api.ts`, `domain/receive/cashu-receive-quote-service.ts` (its `createReceiveQuote` options param is the exact pattern for the spark service), and the server twin `spark-receive-quote-service.server.ts` (the `getLightningQuote` delegate pattern) — and match their structure, naming, and JSDoc style. The client service's two unchanged in-package callers (`receive-cashu-token-quote-service.ts:169`, `transfer-service.ts:219`) must still compile and are **not** edited; `lightning-address-service.ts` (server twin, unaffected) is not edited either.
   2b. **SDK init (decision 12).** Apply the pinned `sdk.ts` `init()` seam and the `domain/sdk/index.ts` migration-note deletion. Nothing else in either file changes; `lib/spark/wasm.ts` and the web hosts (`entry.client.tsx`, `_protected.tsx`) are untouched.
3. **Tests.** Extend `receive-api.test.ts` in its existing harness style (fake `getSession`, real `createSessionKeys`, seam injection via `createSparkRepository`/`createSparkService`). Extend the `makeApi` helper with `sparkRepository?: Partial<SparkReceiveQuoteRepository>` and `sparkService?: Partial<SparkReceiveQuoteService>` wired to the two new seams. Add a `sparkDomain()` `SparkAccount` fixture, `makeSparkLightningQuote()`, and `makeSparkQuote()` fixtures alongside the existing cashu ones. Update the existing `spark and cashuToken` describe (lines 776–783): the `api.spark` throw assertion is deleted and the describe narrows to `cashuToken` only. Exact test list:

   - **`spark.createQuote`:**
     1. throws `NoSessionError` without a session, before any repository/service construction (assert the `createSparkService`/`createSparkRepository`/`getAccountRepository` seams were never invoked);
     2. happy path param passthrough: passes exactly `{ userId, account, receiveType: 'LIGHTNING', lightningQuote, purpose, transferId }` with `{ abortSignal }` as the second argument, and returns the service's quote verbatim;
     3. rejects with `SessionEndedError` when the session ends during service construction (mid-fence) and the service is never called;
     4. rejects with `SessionEndedError` when the session ends after the service call resolves (post-op fence).
   - **`spark.getLightningQuote`:**
     5. passes `{ wallet, amount, description }` to the service's `getLightningQuote` (wallet identity — `account.wallet`) and returns the quote verbatim;
     6. rejects with `SessionEndedError` when the session ends during service construction and the service is never called;
     7. rejects with `SessionEndedError` when the session ends during the Breez call (post-call fence).
   - **`spark.getQuote`:**
     8. threads the id and the abort signal through and returns the quote verbatim, including `null` for a missing quote;
     9. rejects with `SessionEndedError` and issues no read when the session ends before the read (mid-construction fence);
     10. rejects with `SessionEndedError` when the session ends during the read (post-op fence).
   - **`session fences` additions:**
     11. abort-signal identity through the real default service (mirrors step-10's `threads the session signal through the default swap service` test, `receive-api.test.ts:683–712`): exercise the **default** `createSparkService` path with the `createSparkRepository` seam injecting a fake repository whose `create` records its second argument as `writeOptions`; the second argument is the options **object**, not the signal, so assert `expect(writeOptions?.abortSignal).toBe(keys.sessionSignal())` — this locks the new service-to-repository `options` hop, which case 2's fake service cannot see;
     12. default-service preview: with the **default** `createSparkService` (repository seam injecting a dummy repository) and a fake `account.wallet.receivePayment` returning `{ paymentRequest: <the fixtureInvoice BOLT11 test-vector already in the file at line 719>, lightningReceiveDetails: { receiveRequestId, status, createdAt, updatedAt } }`, `spark.getLightningQuote` resolves to a quote whose `paymentHash` is 64 hex chars — locks the real `getLightningQuote` delegate (one-liner) that the fake-service tests cannot see, mirroring the intent of the existing `default service cryptography` describe.

   - **currency guard (decision 2):**
     13. `spark.getLightningQuote` rejects a USD `Money` (constructed per the file's existing Money style) with the pinned `Error('Spark receive quotes support BTC amounts only')` **before** any construction — assert the `createSparkService`/`createSparkRepository` seams were never invoked.
   - **`init()` WASM coverage (decision 12), in `domain/sdk/sdk.test.ts`, matching its existing harness style:**
     14. `init()` rejects with `WebAssemblyUnavailableError` when the runtime lacks `WebAssembly`: save `globalThis.WebAssembly`, delete it, call `init()`, `expect(...).rejects.toBeInstanceOf(WebAssemblyUnavailableError)`, and restore the global in a `finally`. (The success path is deliberately not unit-tested: `ensureBreezWasm` with `WebAssembly` present kicks off the real wasm fetch/compile, which is not viable in the unit environment and would poison the module-level memo; `lib/spark/wasm.ts` is unchanged by this slice and the success path is covered by the browser smoke.) If the existing `sdk.test.ts` harness makes asserting session-restore participation cheap, also assert `init()` still invokes session restore; otherwise skip that assertion rather than restructuring the harness.

   Existing `cashu`/`cashuToken` tests stay green; the narrowed `cashuToken` throw test stays (step-12 placeholder). Existing `sdk.test.ts` tests stay green.
4. **Web flip.** Apply the pinned hook edits. The flipped hooks must not reference `useUser`, `useSparkReceiveQuoteService`, or `useSparkReceiveQuoteRepository`; every other export in the file stays byte-identical (processor and change handlers are the step-18 boundary).

Gates in the implementer's fork, all mandatory: `bun install`; `bun run fix:all` exit 0; `bun run typecheck` exit 0; `cd packages/wallet-sdk && bun test` green (existing suites + the new spark and init coverage); `cd apps/web-wallet && bun test` green. The changed-file set of the delivered branch must equal the nine-file list exactly (the orchestrator verifies with `git archive` + `diff -rq`).

**Task 2 (local, orchestrator): integration, gates, smoke.** Merge the delivery onto the work branch, re-run all gates at the repo root, then browser-smoke against the local stack: boot the app logged-out and logged-in with `init()` now also awaiting the WASM load (`entry.client.tsx` starts the same memoized load at module scope, so expect no boot regression), run a spark receive flow (the standard receive screen and the Cash App buy flow both exercise `useCreateSparkReceiveQuote`), confirm the quote is created via `sdk.receive.spark.*` (network tab: one `create_spark_receive_quote` RPC, no added account reads versus master — foreground parity), confirm the web processor completes the quote through `/temporary` (balance credited, transaction appears), confirm the invoice QR still copies, and confirm no console errors.

**Task 3 (marketplace): adversarial review** of the integrated diff against this plan. Focus prompts: foreground parity (no added requests — the `account.wallet` comes from the caller's cached object, not an SDK fetch), fence order vs the step-9/10 template, the step-18 boundary (no processor/change-handler/pending-read drift, no host/processing split of the repo/service), backward compatibility of the client service signature for `receive-cashu-token-quote-service.ts` and `transfer-service.ts` (and `lightning-address-service.ts` untouched — server twin), the `init()` WASM wiring (contract fulfilled; `wasm.ts` and web hosts untouched; no double-load), the BTC guard placement and error text, and canary-prune safety (`getLightningQuote` only; `SparkReceiveQuoteSchema`/`computeQuoteExpiry`/`getAmountAndFee` left in place). Findings route back through the orchestrator; only confirmed findings trigger a fix cycle.

## Verification summary

| Gate | Command | Expectation |
|---|---|---|
| Lint/format + write | `bun run fix:all` | exit 0 |
| Types (all pkgs) | `bun run typecheck` | exit 0 |
| SDK unit tests | `cd packages/wallet-sdk && bun test` | green (existing suites + new `spark` and `init()` coverage) |
| Web unit tests | `cd apps/web-wallet && bun test` | green |
| Smoke | manual, browser, local stack | spark receive creates the quote via `sdk.receive.spark.*` with no added requests vs master; web processor completes it via `/temporary`; balance credited; transaction appears; invoice copies; no console errors |

## Out of scope

- **Background processing (step 18):** `useProcessSparkReceiveQuoteTasks`, `useSparkReceiveQuoteChangeHandlers`, `usePendingSparkReceiveQuotes`, the `PendingSparkReceiveQuotesCache`, `useOnSparkReceiveStateChange`, and the processor-side use of `SparkReceiveQuoteService.complete`/`expire`/`fail`/`markMeltInitiated` — all stay on `/temporary`.
- **The receive/send repo+service host/processing split** — deferred to step 18 by the spec; this slice wraps the bundled classes as they are.
- **`receive.cashuToken` sub-namespace** (step 12) and anything importing it (`receive-cashu-token-hooks.ts`, the `_protected.receive.cashu_.token.tsx` route `clientLoader` + `getServices`, `claim-cashu-token-service.ts`).
- **`sdk.send`, `sdk.transfer`, `sdk.featureFlags`, `sdk.taskProcessor`** — later slices (13–16).
- **`.server.ts` twins** (`spark-receive-quote-repository.server.ts`, `spark-receive-quote-service.server.ts`) and `lightning-address-service.ts` — step 17's `ServerSdk`.
- **SDK events** (`spark-receive-quote.*` emissions) — step 18 realtime feed; `events.ts` untouched.
- **Root exports (`packages/wallet-sdk/index.ts`)** — `SparkAccount`, `SparkReceiveQuote`, `SparkReceiveLightningQuote` (index.ts:88), and the `export *` from `./domain/sdk` already carry this slice.
- **Web WASM host calls** — `entry.client.tsx:40` and `_protected.tsx:87` keep calling `ensureBreezWasm` (same memoized promise as `init()`); they are deleted later with the slices that remove the temporary `_protected` prefetches, not here.
- **`lib/spark/wasm.ts` changes** — the memoized loader (including its memoize-a-rejection behavior) ships as-is; any retry-semantics change is a separate discussion, not this slice.
- **Pre-existing dead `/temporary` re-exports** — `SparkReceiveQuoteSchema`, `computeQuoteExpiry`, `getAmountAndFee` have zero `/temporary` importers but this flip does not make them dead; leave for step 19's `/temporary` deletion.
- **No DB schema, RPC, or dependency changes;** no migrations; no `db:generate-types`.
