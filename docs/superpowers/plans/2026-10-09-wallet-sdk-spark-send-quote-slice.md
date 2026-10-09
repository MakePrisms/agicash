# Wallet SDK Spark Send Quote Slice (Step 15) Implementation Plan

> **Orchestration note:** like steps 10–14, this slice ships as **one whole-slice contribution job**, after an adversarial review of this plan. A separate implementer forks the repo at the base of `sdk/spark-send-quote-slice` (branched off `master` at `55e72bb9`, the step-14 merge), reads this plan and the referenced code in the fork, and delivers everything together on a branch descending from that base: the two spark methods on the existing `createSendApi` factory, the service options param, the new and updated tests, and the web hook flip. The orchestrator then integrates locally and runs the gates from the Verification summary. Adversarial review of the integrated diff follows. The job text stays task-only; this document is the full spec. All `path:line` citations are valid at the pinned base.

**Goal:** Implement `send.spark.getLightningQuote` and `send.spark.createQuote` from the SDK contract (spark lightning send). The `SendApi` type already declares both methods and their result types (`domain/sdk/send.ts:29–37`); this slice fills the two `unknown` param placeholders (`send.ts:80–81`) and replaces the `get spark()` throwing getter (`domain/send/send-api.ts:138–140`) with the host verbs. Flip the web spark preview and confirm hooks from `@agicash/wallet-sdk/temporary` to `sdk.send.spark.*`. After this slice, `send.cashu` and `send.spark` are fully implemented; `resolveDestination` stays a throwing getter.

**Architecture:** This is step 15 of the 19-step no-cache extraction (spec `docs/superpowers/specs/2026-06-24-wallet-sdk-no-cache-production-design.md`, step list `:68–116`, step 15 at `:93`). The already-moved `domain/send/spark-send-quote-service.ts` gets its two host-initiated verbs exposed through the existing `createSendApi`, the same way step 13 exposed the cashu lightning pair (`send-api.ts:79–107`). The spark send-quote **background lifecycle** (`initiateSend`, `complete`, `fail` in `useProcessSparkSendQuoteTasks` / `useOnSparkSendStateChange`) stays on `/temporary` until step 18. The **transfer** flow's in-package calls into the same service (step 16) are untouched. That is the same boundary style as steps 9–14.

**Tech stack:** TypeScript, bun workspaces, bun:test, Supabase (postgrest-js), Breez Spark SDK (`@agicash/breez-sdk-spark`), TanStack Query v5 (web side only).

## Global constraints

- **Param precedent (binding, set by the #1176 review):** contract methods take the full domain objects the caller supplies (`account: SparkAccount`, `lightningQuote: SparkLightningQuote`). They never take an id the SDK re-fetches. A flipped web flow must issue no additional network requests versus master. Binding text: production design "Corollary (foreground parity)" (`2026-06-24-wallet-sdk-no-cache-production-design.md:31–37`) and contract proposal "Conventions across all namespaces" (`2026-07-02-wallet-sdk-contract-proposal.md:297–325`). The merged `send-api.ts` cashu methods are authoritative for shape and fences.
- **`userId` is implicit** (`contract-proposal.md:299–301`): no public param carries it. `createQuote` takes it from `requireUserId()`.
- **`get*` = stateless preview, `create*` = persists** (`contract-proposal.md:302–306`). `getLightningQuote` does no DB write (`spark-send-quote-service.ts:112–194`: bolt11 parse + `account.wallet.prepareSendPayment` + balance check). `createQuote` persists (`create_spark_send_quote` RPC via `spark-send-quote-repository.ts:91`).
- **Completion verbs never appear on the public surface** (`contract-proposal.md:317–321`). `initiateSend` / `get` / `complete` / `fail` (`spark-send-quote-service.ts:244–379`) are not exposed. For spark the payment itself is initiated by the background processor (`useProcessSparkSendQuoteTasks`), not by the create verb — the create persists an `UNPAID` quote only.
- The SDK stays React-agnostic: `packages/wallet-sdk` never imports `react` or `@tanstack/react-query`.
- **No SDK event emission.** `domain/sdk/events.ts` is untouched.
- No DB schema, RPC, dependency, or migration changes. `create_spark_send_quote` (`db/supabase/migrations/20260420152512_denormalize_account_on_transactions.sql:441–521`) is used unchanged. No `bun add`, no `db:generate-types`.
- Session fences follow the merged cashu quote methods in `send-api.ts` (decision 6).
- **Canary rule for `temporary.ts`:** prune only re-exports this flip makes dead, verified by repo-wide grep. This flip makes **none** dead (decision 9), so `temporary.ts` is untouched.
- Do not touch other domains' `/temporary` imports. Only the files in the File map change.
- Root `packages/wallet-sdk/index.ts` is untouched: `SparkSendQuote` and `SparkLightningQuote` are already root-exported (`index.ts:117–118`), and the two filled param types ship automatically through `export * from './domain/sdk'` → `domain/sdk/index.ts` → `./send`.
- **`sdk.ts` is untouched.** `createSendApi` already receives `db`, `getSession`, `keys`, and `getAccountRepository` (`domain/sdk/sdk.ts:187–192`); the spark builders need only `db` + `keys.getEncryption()`. (This differs from step 14, which had to add a dep.)
- **`.server.ts` twins are untouched** (step 17). The spark-send domain has none.
- Package manager: `bun` / `bunx` only. Base branch: `master` at `55e72bb9`. Work branch: `sdk/spark-send-quote-slice`.

## Resolved design decisions

1. **Slice scope = the two web host entry points into `SparkSendQuoteService`, and nothing else.** A repo-wide grep for `getLightningSendQuote` / `createSendQuote` / `useCreateSparkLightningSendQuote` / `useInitiateSparkSendQuote` finds these callers:
   - (a) `useCreateSparkLightningSendQuote` (`apps/web-wallet/app/features/send/spark-send-quote-hooks.ts:321–343`). It calls `sparkSendQuoteService.getLightningSendQuote` (`:330`): the **preview**. Consumed as `getSparkLightningQuote` via `send-provider.tsx:35–36` → `createSendStore` (`send-provider.tsx:51`) → `send-store.ts:391–396`. The store prop type is `{ account: SparkAccount; paymentRequest: string; amount?: Money<Currency> }` (`send-store.ts:162–166`).
   - (b) `useInitiateSparkSendQuote` (`:361–393`). It calls `sparkSendQuoteService.createSendQuote` (`:376`) and is consumed only by `send-confirmation.tsx:152–178` (`usePayBolt11`; mutate at `:188–191` with `{ account, quote }`). Despite the hook name, the verb persists an UNPAID quote; the lightning payment is initiated later by the processor.
   - In-package callers that stay: `domain/transfer/transfer-service.ts:197` (`getLightningSendQuote`) and `:266–272` (`createSendQuote` with `purpose: 'TRANSFER'` + `transferId`) — transfer is step 16 and calls the service directly.
   - Stays on `/temporary` (step 18): `useSparkSendQuoteRepository` (`:31–34`), `useSparkSendQuoteService` (`:36–39`; also constructed by `features/transfer/transfer-service-hooks.ts:11`), `UnresolvedSparkSendQuotesCache`, `useSparkSendQuoteChangeHandlers`, `useUnresolvedSparkSendQuotes`, `useOnSparkSendStateChange`, `useProcessSparkSendQuoteTasks`.

2. **`GetSparkSendLightningQuoteParams` = `{ account: SparkAccount; paymentRequest: string; amount?: Money }`.** Evidence:
   - These are the fields the only caller passes (`send-store.ts:391–395`) and the fields of the service's `GetSparkSendQuoteOptions` (`spark-send-quote-service.ts:56–69`), with `amount` widened from `Money<'BTC'>` to `Money` to mirror the cashu sibling (`send.ts:44–48`).
   - **The `Money<'BTC'>` cast moves from the hook into the API.** Master's hook casts `amount as Money<'BTC'>` (`spark-send-quote-hooks.ts:333`) because the service narrows (`:68`). The API passes `amount: params.amount as Money<'BTC'> | undefined`. Runtime behavior is identical (the cast is erased); the unsoundness is master's, relocated, and is safe in practice because spark accounts are BTC-currency.
   - *Rejected:* `amount?: Money<'BTC'>` on the public params. The store would still compile (it binds to the hook's local variables type, `spark-send-quote-hooks.ts:303–316`), but the narrowing cast would just stay in the hook, and the public type would diverge from the cashu sibling (`send.ts:48`) for no runtime gain. One `Money` contract across send params wins; the cast lives in the API (previous bullet).
   - `amount` is passed through unconditionally; the service ignores it when the invoice carries an amount (`:135–145`), master-identical.

3. **`CreateSparkSendQuoteParams` = `{ account: SparkAccount; lightningQuote: SparkLightningQuote }`.** Evidence:
   - The confirm passes `{ account, quote }` (`send-confirmation.tsx:188–191`); the service reads `{ userId, account, quote }` plus optional `purpose` / `transferId` (`spark-send-quote-service.ts:71–93`, `:200–236`).
   - The public field is named **`lightningQuote`**, matching the cashu sibling (`send.ts:54–55`) — the contract's vocabulary is per-namespace-consistent; the API maps it to the service's `quote` field. The web hook keeps its local `{ account, quote }` variables (decision 10), so `send-confirmation.tsx` is untouched.
   - **`purpose` and `transferId` are omitted from the public params.** Their only caller is the in-package transfer flow (`transfer-service.ts:266–272`), which stays on the service class until step 16 decides its own contract. No flipped caller passes them (`send-confirmation.tsx:188–191`); adding optional fields later is non-breaking (step-13 `exchangeRate` / step-14 `senderPaysFee` precedent). The API forwards neither, so the RPC receives `p_purpose: undefined` → `PAYMENT` default, master-identical.
   - `userId` stays implicit (`contract-proposal.md:299–301`).

4. **`createQuote` returns `{ transactionId: string }` — already pinned by the contract.** `SendApi['spark']['createQuote']` was typed `Promise<{ transactionId: string }>` in step 13 (`send.ts:33–35`), the "Observing an initiated payment" idiom (`contract-proposal.md:326–341`): a send returns only an id; completion is observed via events/realtime.
   - The only consumer reads only `sendQuote.transactionId` and navigates to `/transactions/${transactionId}` (`send-confirmation.tsx:154–157`). `SparkSendQuote.transactionId` exists (`spark-send-quote.ts:42`).
   - **No cache seeding depends on the mutation result.** Master's `onSuccess` only forwards to the caller (`spark-send-quote-hooks.ts:382–384`); the unresolved-quotes cache is fed by the `SPARK_SEND_QUOTE_CREATED` realtime handler (`:103–107`), untouched. This differs from step 14's `{ swap }` (where the share page needed the object); here `{ transactionId }` adds zero fetches.
   - The flipped hook's `onSuccess` param type narrows from `SparkSendQuote` to `{ transactionId: string }`; the inline callback in `send-confirmation.tsx:154` only reads `.transactionId`, so it compiles unchanged.

5. **No ConcurrencyError path on spark create — the `account` object stays a mutation variable.** `create_spark_send_quote` (`20260420152512_denormalize_account_on_transactions.sql:441–521`) raises no `CONCURRENCY_ERROR` (no proof reservation exists for spark). The repository maps only Postgres `23505` (the `spark_send_quotes_payment_hash_active_unique` partial index) to a `DomainError` (`spark-send-quote-repository.ts:109–118`), which is never retried. So the step-13/14 `accountId` + per-attempt cache read exception does **not** apply; master already passes the full `account` as a variable (`:375`) and the flipped hook keeps that. No retry-forever rule exists to feed stale state.

6. **Session fences follow the merged cashu template.**
   - **`getLightningQuote` (preview)** matches `send-api.ts:79–90`: **no `requireUserId()`**, capture `deps.keys.sessionSignal()` → `await getSparkService()` → re-check → `service.getLightningSendQuote({...})` → re-check → return the quote. The service takes no options (its awaits are `account.wallet.prepareSendPayment`, a Breez SDK call with no abort support — master-identical).
   - **`createQuote`** matches `send-api.ts:91–107`: `requireUserId()` → capture `sessionSignal()` → `await getSparkService()` → re-check → `createSendQuote({ userId, account, quote: params.lightningQuote }, { abortSignal: signal })` → re-check → `return { transactionId: quote.transactionId }`. A result is never returned for an ended session.

7. **`SparkSendQuoteService.createSendQuote` gains `options?: { abortSignal?: AbortSignal }` as a second positional param, forwarded to `this.repository.create(params, options)`.**
   - The repository already accepts and applies it (`spark-send-quote-repository.ts:11–13`, `:68–71`, `:103–105`).
   - This matches steps 9–14 (step-13 `createSendQuote` on the cashu service; step-14 `create` on the swap service).
   - Compatibility: the callers are the web hook this slice flips (`spark-send-quote-hooks.ts:376`) and `transfer-service.ts:266` — both one-argument calls, which keep compiling with an optional second param. `getLightningSendQuote` gets **no** options param (nothing in it can abort). `initiateSend` / `complete` / `fail` / `get` signatures are unchanged (background verbs; step 18).

8. **Factory seams: two optional test seams, no new required deps.** `Deps` (`send-api.ts:17–31`) grows `createSparkRepository?` / `createSparkService?` next to the existing quote and swap seams. Default builders mirror the cashu pair (`send-api.ts:43–51`): repository = `new SparkSendQuoteRepository(deps.db, await deps.keys.getEncryption())`, service = `new SparkSendQuoteService(await getSparkRepository())`. `keys.getEncryption()` is memoized per session and warm at any send (`domain/sdk/session-keys.ts`; warmed at provisioning, same argument as step-14 decision 9). No `getAccountRepository` involvement, no mnemonic read: the service uses only the **caller-supplied** `account.wallet`; `keys.getSparkMnemonic` is never on this path (asserted by test (c6)).

9. **Canary: no `/temporary` re-export becomes dead. `temporary.ts` is untouched.** After the flip, `spark-send-quote-hooks.ts` still imports and uses:
   - `SparkSendQuoteRepository` (`temporary.ts:131`) via `useSparkSendQuoteRepository` (`:31–34` — change handlers, unresolved query).
   - `SparkSendQuoteService` (`temporary.ts:132`) via `useSparkSendQuoteService` (`:36–39` — processor; also `transfer-service-hooks.ts:11`).
   - `sparkDebugLog` (`temporary.ts:41` via `lib/spark`) at `:238`, `:501`.
   - `DomainError` in the kept processor mutations (`:453`) and the flipped hooks' retry predicates.
   - `AgicashDbSparkSendQuote` type (`spark-send-quote-hooks.ts:8`) in the change handlers (`:104`, `:111`).
   - `SparkSendQuoteSchema` (`temporary.ts:130`) has no web importer today (pre-existing; step-19 cleanup). Do **not** prune it or anything else. Run a repo-wide grep before delivering to confirm.

10. **Web flip: two hook bodies in `spark-send-quote-hooks.ts`. `send-confirmation.tsx`, `send-provider.tsx`, and `send-store.ts` are byte-identical.**
    - **`useCreateSparkLightningSendQuote`** (`:321–343`): drop the `useSparkSendQuoteService()` construction and the `as Money<'BTC'>` cast; `mutationFn` becomes `({ account, paymentRequest, amount }: CreateSparkLightningSendQuoteParams) => sdk.send.spark.getLightningQuote({ account, paymentRequest, amount })`. The local `CreateSparkLightningSendQuoteParams` type (`:303–316`) stays as the variables type, so the store prop (`send-store.ts:162–166`) compiles unchanged. Retry gains `SessionEndedError → false` as the **first** branch (the step-13 preview template, `cashu-send-quote-hooks.ts:131–139`); `DomainError → false` and `failureCount < 1` stay. No `scope` is added (master has none here; the cashu preview's `scope` is not copied).
    - **`useInitiateSparkSendQuote`** (`:361–393`): drop `useUser` usage and `useSparkSendQuoteService()`; keep `scope: { id: 'create-spark-send-quote' }` (`:372–374`); `mutationFn` becomes `({ account, quote }: CreateSparkSendQuoteParams) => sdk.send.spark.createQuote({ account, lightningQuote: quote })`; the hook's local `CreateSparkSendQuoteParams` type (`:345–354`) stays. `onSuccess` prop type becomes `(data: { transactionId: string }) => void` (mirror `useInitiateCashuSendQuote`, `cashu-send-quote-hooks.ts:143–147`). Retry gains the `SessionEndedError → false` first branch; `DomainError → false` and `failureCount < 1` stay. Do not import the SDK `CreateSparkSendQuoteParams` into the hook; the local type (same name, `{ account, quote }` shape) is the mutation variables type.
    - **The create hook never retries `SessionEndedError`** (`packages/wallet-sdk/lib/error.ts:50–62`: "Never retry the same operation"). Master's predicate would fall through to `failureCount < 1` for it; after a quick same-user re-login the retry would persist the old send intent under the new session. Same fix as step 14 decision 11. **Limit:** this branch covers the construction and post-op fences only. A session that ends while the `create_spark_send_quote` request is in flight surfaces as postgrest `{ error }` → plain `Error('Failed to create spark send quote')` (`spark-send-quote-repository.ts:118`), so the post-op fence never runs and the predicate retries once (identical to the merged cashu hooks). Closing that window is a family-wide follow-up (see Out of scope), not this slice.
    - Imports: add `import { SessionEndedError } from '@agicash/wallet-sdk';` (a **new value import** — the file's existing root import at `:3–7` is type-only; mirror the split `cashu-send-quote-hooks.ts:3–9` uses) and `import { sdk } from '~/features/shared/sdk.client';` (same form as `cashu-send-quote-hooks.ts:31`). Keep every other import: `useUser` (still used by `useUnresolvedSparkSendQuotes`, `:128`), `Payment` (`:219`), `SparkAccount` / `SparkLightningQuote` / `SparkSendQuote` types, `AgicashDbSparkSendQuote`, `DomainError`, `SparkSendQuoteRepository`, `SparkSendQuoteService`, `sparkDebugLog`, `Money`.
    - Everything else in the file is byte-identical: `useSparkSendQuoteRepository`, `useSparkSendQuoteService`, the cache class + hook, the change handlers, `useUnresolvedSparkSendQuotes`, `useOnSparkSendStateChange`, `useProcessSparkSendQuoteTasks`.

11. **No `index.ts` / `temporary.ts` / `events.ts` / `sdk.ts` / `domain/sdk/index.ts` changes.** See Global constraints.

## Pinned seams (authoritative for the implementation)

### Contract (`packages/wallet-sdk/domain/sdk/send.ts`)

Replace lines 80–81 (the two `unknown` placeholders) with:

```ts
export type GetSparkSendLightningQuoteParams = {
  /** The spark account to send from. */
  account: SparkAccount;
  /** The bolt11 invoice to pay. */
  paymentRequest: string;
  /**
   * Amount to send. Required for amountless invoices; ignored when the
   * invoice carries an amount.
   */
  amount?: Money;
};

export type CreateSparkSendQuoteParams = {
  /** The spark account to send from. Must be the account the quote was created for. */
  account: SparkAccount;
  /** The lightning quote to create the send quote from (see `getLightningQuote`). */
  lightningQuote: SparkLightningQuote;
};
```

**Mandatory import edit:** `send.ts:2` is `import type { CashuAccount } from '../accounts/account';` — extend it to `import type { CashuAccount, SparkAccount } from '../accounts/account';`. `SparkLightningQuote` (`:7`) and `Money` (`:1`) are already imported. The `SendApi` type (`:16–37`) and every other line stay byte-identical. Let `bun run fix:all` confirm import order.

### API factory (`packages/wallet-sdk/domain/send/send-api.ts`)

Add to `Deps` (after the swap seams at `:25–30`):

```ts
  /** Test seam; defaults to building the spark repository from db + session-keys encryption. */
  createSparkRepository?: () => Promise<SparkSendQuoteRepository>;
  /** Test seam; defaults to building the spark service from the spark repository. */
  createSparkService?: () => Promise<SparkSendQuoteService>;
```

New imports: `import type { Money } from '@agicash/money';` (for the cast), `SparkSendQuoteRepository` from `./spark-send-quote-repository`, `SparkSendQuoteService` from `./spark-send-quote-service`. Biome orders them.

Builders, next to the existing swap builders (`:53–72`):

```ts
  const getSparkRepository =
    deps.createSparkRepository ??
    (async (): Promise<SparkSendQuoteRepository> =>
      new SparkSendQuoteRepository(deps.db, await deps.keys.getEncryption()));

  const getSparkService =
    deps.createSparkService ??
    (async (): Promise<SparkSendQuoteService> =>
      new SparkSendQuoteService(await getSparkRepository()));
```

Replace the throwing getter (`:138–140`) with:

```ts
    spark: {
      getLightningQuote: async (params) => {
        const signal = deps.keys.sessionSignal();
        const service = await getSparkService();
        if (signal.aborted) throw new SessionEndedError();
        const quote = await service.getLightningSendQuote({
          account: params.account,
          paymentRequest: params.paymentRequest,
          amount: params.amount as Money<'BTC'> | undefined,
        });
        if (signal.aborted) throw new SessionEndedError();
        return quote;
      },
      createQuote: async (params) => {
        const userId = requireUserId();
        const signal = deps.keys.sessionSignal();
        const service = await getSparkService();
        if (signal.aborted) throw new SessionEndedError();
        const quote = await service.createSendQuote(
          {
            userId,
            account: params.account,
            quote: params.lightningQuote,
          },
          { abortSignal: signal },
        );
        if (signal.aborted) throw new SessionEndedError();
        return { transactionId: quote.transactionId };
      },
    },
```

`resolveDestination` stays a throwing getter (`:75–77`). The cashu methods stay byte-identical. Do **not** switch `resolveDestination` to a rejecting method.

### Service change (`packages/wallet-sdk/domain/send/spark-send-quote-service.ts`)

Change `createSendQuote` (`:200–236`) to take a second parameter. The first parameter's destructuring and type stay byte-identical:

```ts
  async createSendQuote(
    { userId, account, quote, purpose, transferId }: CreateSendQuoteParams,
    options?: { abortSignal?: AbortSignal },
  ): Promise<SparkSendQuote> {
```

and pass it through at `:224`:

```ts
    return this.repository.create(
      {
        /* …existing fields, unchanged… */
      },
      options,
    );
```

Nothing else in the file changes. `getLightningSendQuote`, `initiateSend`, `get`, `complete`, and `fail` stay byte-identical.

### Web flip (`apps/web-wallet/app/features/send/spark-send-quote-hooks.ts`)

1. Imports: add `import { SessionEndedError } from '@agicash/wallet-sdk';` next to the existing type-only root import (`:3–7`), and `import { sdk } from '~/features/shared/sdk.client';`. Keep every other import (decision 10).
2. Replace `useCreateSparkLightningSendQuote` (`:321–343`) with:

```ts
export function useCreateSparkLightningSendQuote() {
  return useMutation({
    mutationFn: ({
      account,
      paymentRequest,
      amount,
    }: CreateSparkLightningSendQuoteParams) => {
      return sdk.send.spark.getLightningQuote({
        account,
        paymentRequest,
        amount,
      });
    },
    retry: (failureCount, error) => {
      if (error instanceof SessionEndedError) {
        return false;
      }
      if (error instanceof DomainError) {
        return false;
      }
      return failureCount < 1;
    },
  });
}
```

3. Replace `useInitiateSparkSendQuote` (`:361–393`) with:

```ts
export function useInitiateSparkSendQuote({
  onSuccess,
  onError,
}: {
  onSuccess: (data: { transactionId: string }) => void;
  onError: (error: Error) => void;
}) {
  return useMutation({
    scope: {
      id: 'create-spark-send-quote',
    },
    mutationFn: ({ account, quote }: CreateSparkSendQuoteParams) => {
      return sdk.send.spark.createQuote({
        account,
        lightningQuote: quote,
      });
    },
    onSuccess: (data) => {
      onSuccess(data);
    },
    onError,
    retry: (failureCount, error) => {
      if (error instanceof SessionEndedError) {
        return false;
      }
      if (error instanceof DomainError) {
        return false;
      }
      return failureCount < 1;
    },
  });
}
```

The JSDoc on both hooks stays as it is in master (`:318–320`, `:356–360`). `send-confirmation.tsx:152–192` compiles unchanged: its `onSuccess` callback reads only `sendQuote.transactionId` (`:157`), and the mutate still passes `{ account, quote }` (`:188–191`).

## File map

- Modify: `packages/wallet-sdk/domain/sdk/send.ts` (two filled param types + the `SparkAccount` import; decisions 2–3)
- Modify: `packages/wallet-sdk/domain/send/send-api.ts` (spark seams + builders + methods; decisions 6–8)
- Modify: `packages/wallet-sdk/domain/send/send-api.test.ts` (new spark tests s1–s5, c1–c8; in-place edits to the two unimplemented-members tests; `makeApi` gains the spark seams)
- Modify: `packages/wallet-sdk/domain/send/spark-send-quote-service.ts` (options param; decision 7)
- Modify: `packages/wallet-sdk/domain/sdk/sdk.test.ts` (edit the send-wiring test in place)
- Modify: `apps/web-wallet/app/features/send/spark-send-quote-hooks.ts` (web flip; decision 10)
- **Untouched on purpose:**
  - Package root and contract: `packages/wallet-sdk/index.ts`, `temporary.ts` (decision 9), `domain/sdk/index.ts`, `domain/sdk/events.ts`, `domain/sdk/sdk.ts`, `domain/sdk/receive.ts`, `domain/sdk/transfer.ts`.
  - Send domain: `spark-send-quote-repository.ts`, `spark-send-quote.ts`, all `cashu-send-*` files, `resolve-destination.ts`, `send-destination.ts`.
  - Other domains: `transfer-service.ts`, `accounts-api.ts`, all receive files.
  - Web: `send-confirmation.tsx`, `send-provider.tsx`, `send-store.ts`, `routes/_protected.send*.tsx`, `cashu-send-quote-hooks.ts`, `cashu-send-swap-hooks.ts`, `transfer-service-hooks.ts`, `sdk.client.ts`.
  - All RPCs and migrations.

## Task specs

**Task 0 (local, orchestrator): branch + plan commit.** The commit that adds this document is the pinned base of the implementation job (`sdk/spark-send-quote-slice` off `55e72bb9`). The implementation job appends its delivery branch onto it.

**Task 1 (contribution, single implementer): the whole slice.** Edit exactly the six files in the File map, applying the pinned seams verbatim. Working order:

1. **Read first:** `domain/send/send-api.ts`, `domain/send/send-api.test.ts` (the whole harness: `makeApi` at `:174–195`, fixtures at `:31–172`), `domain/sdk/send.ts`, `domain/sdk/sdk.test.ts:81–97`, `domain/send/spark-send-quote-service.ts`, `domain/send/spark-send-quote-repository.ts`, `domain/sdk/session-keys.ts:73–76` (fake reader config), `apps/web-wallet/app/features/send/spark-send-quote-hooks.ts`, `apps/web-wallet/app/features/send/cashu-send-quote-hooks.ts:112–192` (the flipped-hook template). Match their structure, naming, and JSDoc style. Step-13/14 plan-attack lessons apply: annotate every nested callback param in test fixtures (TS7006 — test files are typechecked); never leave an unused variable (`noUnusedVariables` is a biome error); read every `let`-captured value through optional chaining, i.e. `captured?.account`, `capturedOptions?.abortSignal`, `capturedArgs?.userId`, and `Object.keys(captured ?? {}).sort()` (TS18048 / TS2769 otherwise; precedent `send-api.test.ts` ~`:443`).
2. **Contract + factory + service** (pinned seams). Existing cashu methods and tests stay behavior-identical.
3. **Canary check (no edit):** after the flip, grep the repo to confirm `SparkSendQuoteRepository`, `SparkSendQuoteService`, `sparkDebugLog`, `DomainError`, and `AgicashDbSparkSendQuote` still each have a `/temporary` importer. Do not edit `temporary.ts`.
4. **Tests.** Extend `send-api.test.ts` in the existing harness style: fake `getSession` (`authUser` / `loggedIn`, `:31–45`), real `createSessionKeys` with `keys.reset()` as the session-end trigger, seam injection with `as unknown as` casts (`:177–194`).
   - New imports: `import type { SparkAccount } from '../accounts/account';` (extend the existing `DomainCashuAccount` import line), `import type { SparkSendQuote } from './spark-send-quote';`, `import type { SparkSendQuoteRepository } from './spark-send-quote-repository';`, `import type { SparkLightningQuote, SparkSendQuoteService } from './spark-send-quote-service';`.
   - **`makeApi` grows** optional `sparkRepository?: Partial<SparkSendQuoteRepository>` / `sparkService?: Partial<SparkSendQuoteService>` seams wired to `createSparkRepository` / `createSparkService`, exactly like the swap seams (`:179–180`, `:191–194`). Existing tests are untouched by this (the seams are optional).
   - New fixtures (next to `makeSendSwap`):
     - `sparkDomain(overrides: Partial<Record<string, unknown>> = {}): SparkAccount` — `{ id: 'acct-spark', name: 'Spark BTC', type: 'spark', currency: 'BTC', balance: sats(1000), wallet: { marker: 'spark-wallet' }, ...overrides } as unknown as SparkAccount` (the service reads `account.wallet`, `account.balance`, `account.currency`, `account.id` only).
     - `makeSparkLightningQuote(): SparkLightningQuote` — `{ paymentRequest: fixtureInvoice, paymentHash: fixturePaymentHash, amountRequested: sats(50), amountRequestedInBtc: sats(50), amountToReceive: sats(50), estimatedLightningFee: sats(2), estimatedTotalFee: sats(2), estimatedTotalAmount: sats(52), paymentRequestIsAmountless: false, expiresAt: null } as unknown as SparkLightningQuote`.
     - `makeSparkSendQuote(): SparkSendQuote` — `{ id: 'ssq-1', transactionId: 'tx-spark-1', userId: 'user-x', accountId: 'acct-spark', state: 'UNPAID', version: 1, paymentRequest: fixtureInvoice, paymentHash: fixturePaymentHash } as unknown as SparkSendQuote`.

   Exact test list. All existing tests stay; only the two unimplemented-members tests and the sdk wiring test are edited in place.

   - **`spark.getLightningQuote`** (new describe):
     - (s1) **Passthrough:** fake `createSparkService` whose `getLightningSendQuote` captures `(params: Record<string, unknown>)` and returns `makeSparkLightningQuote()`. Counting `getSession` returning `{ isLoggedIn: false }`. Call with `{ account: sparkDomain(), paymentRequest: fixtureInvoice, amount: sendSats(50) }`. Assert captured `toEqual({ account, paymentRequest: fixtureInvoice, amount })`, `captured.account` `toBe` the account, `captured.amount` `toBe` the amount (the cast is identity at runtime), result `toBe` the quote, `getSession` 0 calls (the preview never reads the session).
     - (s2) **Mid-construction fence:** `createSparkService` calls `keys.reset()` before returning a service whose `getLightningSendQuote` counts calls. Rejects `SessionEndedError`, 0 service calls (pattern: `:244–273`).
     - (s3) **Post-op fence:** the service's `getLightningSendQuote` calls `keys.reset()` then resolves. Rejects `SessionEndedError` (pattern: `:275–294`).
     - (s4) **Error propagation:** a service rejection `new DomainError('Invalid lightning invoice')` propagates as the **same instance** (`rejects.toBe(error)`).
     - (s5) **Default service, expired invoice, no wallet call:** call `createSendApi` directly **without** `createSparkService`, with `createSparkRepository` returning `{}` cast as `SparkSendQuoteRepository` (the preview never touches the repository; the seam exists only so the default service builder skips `getEncryption` — same shape as the cashu default-service test at `:317–350`). Account: `sparkDomain({ wallet: { prepareSendPayment: async () => { prepareCalls += 1; return { paymentMethod: { type: 'bolt11Invoice', lightningFeeSats: 1 } }; } } })`. Call with `{ account, paymentRequest: fixtureInvoice }` (the 2017 BOLT11 spec test vector, expired). Rejects `DomainError` with `'Lightning invoice has expired'`; `prepareCalls` 0.

   - **`spark.createQuote`** (new describe):
     - (c1) **No session:** `getSession: () => ({ isLoggedIn: false })` → rejects `NoSessionError` before any construction; counting `createSparkRepository` / `createSparkService` both 0 (pattern: `:354–380`).
     - (c2) **Passthrough + result shape:** fake `createSparkService` whose `createSendQuote` captures `(params: Record<string, unknown>, options?: { abortSignal?: AbortSignal })` and returns `makeSparkSendQuote()`. Call with `{ account, lightningQuote: makeSparkLightningQuote() }`. Assert captured `toEqual({ userId: 'user-x', account, quote: lightningQuote })`, `captured.account` `toBe` the account, `captured.quote` `toBe` the given quote object, `Object.keys(captured).sort()` equals `['account', 'quote', 'userId']` (locks `purpose` / `transferId` off the wire), `capturedOptions.abortSignal` `toBe(keys.sessionSignal())`, result `toStrictEqual({ transactionId: 'tx-spark-1' })`, `Object.keys(result)` equals `['transactionId']` (no quote fields leak).
     - (c3) **Mid-construction fence:** `createSparkService` calls `keys.reset()`. Rejects `SessionEndedError`; `createSendQuote` never called.
     - (c4) **Post-op fence:** `createSendQuote` calls `keys.reset()` then resolves `makeSparkSendQuote()`. Rejects `SessionEndedError` — no `{ transactionId }` for an ended session.
     - (c5) **`DomainError` identity:** `new DomainError('A payment for this invoice is already being processed or was completed')` rejects as the **same instance**.
     - (c6) **Abort-signal identity and mnemonic non-access through the real default service:** call `createSendApi` **without** `createSparkService`, with `createSparkRepository` returning `{ create }` capturing `(args: Record<string, unknown>, options?: { abortSignal?: AbortSignal })` and returning `makeSparkSendQuote()`, and `keys = createSessionKeys({ readSparkMnemonic: async () => { throw new Error('spark mnemonic must not be read'); } })` (`session-keys.ts:73–76`; no encryption fakes needed — the injected repository seam bypasses `getEncryption`). Account: `sparkDomain({ wallet: { prepareSendPayment: async () => { throw new Error('wallet must not be called on create'); } } })`. Quote: `makeSparkLightningQuote()` (`expiresAt: null`; `estimatedTotalAmount` 52 sats < the fixture balance 1000 sats). Assert the result `toStrictEqual({ transactionId: 'tx-spark-1' })`; `capturedOptions.abortSignal` `toBe(keys.sessionSignal())` (locks the new service → repository forwarding, which (c2)'s fake service cannot see); `args.userId === 'user-x'`, `args.accountId === 'acct-spark'`, `args.paymentHash === fixturePaymentHash`, `args.purpose` and `args.transferId` are `undefined`; the wallet and the mnemonic reader never fire.
     - (c7) **Expired quote via the default service, no write:** same seams as (c6); quote `makeSparkLightningQuote()` overridden with `expiresAt: new Date(Date.now() - 60_000)` (build the object literal with the override — the fixture helper returns a plain object, so spread + override, cast as in the fixture). Rejects `DomainError` `'Lightning invoice has expired'`; repository `create` 0 calls.
     - (c8) **Insufficient balance via the default service, no write:** same seams; account `sparkDomain({ balance: sats(10) })`. Rejects `DomainError` matching `'Insufficient balance'`; repository `create` 0 calls.

   - **Unimplemented members (edit in place):**
     - The first test (`:1017–1028`): keep the `api.resolveDestination` assertions (both the `NotImplementedError` and the message `'send.resolveDestination is not implemented yet.'`). **Delete** the two `api.spark` throw assertions (`:1026–1027`); add `expect(typeof api.spark.getLightningQuote).toBe('function')` and the same for `createQuote`. Do **not** call them.
     - The lazy-construction test (`:1030–1078`): add counting `createSparkRepository` / `createSparkService` seams; **delete** `expect(() => api.spark).toThrow(NotImplementedError)` (`:1071`); access `api.spark` and assert both members are functions; `expect(() => api.resolveDestination).toThrow(NotImplementedError)` stays; **all** counters stay 0, including the two new ones.
   - **`sdk.test.ts` (edit in place, `:81–97`):** keep the `describe` / `try/finally { await sdk.dispose(); }` structure. Title becomes `'wires send: cashu and spark methods are callable; resolveDestination and transfer throw NotImplementedError'`. Add `expect(typeof sdk.send.spark.getLightningQuote).toBe('function')` and the same for `createQuote`; **delete** the `sdk.send.spark` toThrow line (`:91`); the `resolveDestination` and `sdk.transfer` toThrow lines stay.

   Existing suites (the cashu half of `send-api.test.ts`, `receive-api.test.ts`, the other `*-api.test.ts`, the other `sdk.test.ts` cases) stay green and unedited.

5. **Web flip** (pinned seams). The flipped hooks must not reference `useSparkSendQuoteService` or `useUser`; every other hook, the cache class, the change handlers, and `useProcessSparkSendQuoteTasks` stay byte-identical.

**Gates in the implementer's fork, all mandatory:**
- `bun install --frozen-lockfile`
- `bun run fix:all` exits 0, then `git status --porcelain` lists only the six File-map paths (`fix:all` is a repo-wide `biome check --write`; revert any other file it touched)
- `bun run typecheck` exits 0
- `cd packages/wallet-sdk && bun test` green (existing suites + the new spark tests + the edited tests)
- `cd apps/web-wallet && bun test` green

The delivered branch's changed-file set must equal the six-file list exactly.

**Task 2 (local, orchestrator): integration, gates, smoke.** Merge the delivery onto the work branch, re-run all gates at the repo root, run the smoke plan below, and check the network tab against the Foreground parity tables.

**Task 3 (marketplace): adversarial review** of the integrated diff against this plan. Focus prompts:
- Foreground parity (no added requests; `account` / `lightningQuote` caller-supplied; no in-SDK `accounts.get` / `list` / `user.get`; no mnemonic or seed read).
- Fence order versus the merged cashu methods (`send-api.ts:79–107`), including **no** `requireUserId()` on the preview and no result for an ended session.
- `{ transactionId }` result (not the full quote), and the hook's `onSuccess` narrowing compiling against `send-confirmation.tsx:152–178` unchanged.
- `purpose` / `transferId` off the public params; the captured service args carry neither.
- The `Money<'BTC'>` cast relocation (hook → API) with the store byte-identical.
- The options param forwarded service → repository; `transfer-service.ts:266` one-arg call still compiles.
- No ConcurrencyError machinery invented for spark (decision 5); `SessionEndedError → false` first in both flipped retries.
- The step-18 boundary: processor, caches, change handlers, `initiateSend` / `complete` / `fail` untouched and off the contract.
- Throwing-getter shape only for `resolveDestination`; tests edited in place, not duplicated.
- No canary prune; `sdk.ts` and `index.ts` untouched.

Findings route back through the orchestrator; only confirmed findings trigger a fix cycle.

## Verification summary

| Gate | Command | Expectation |
|---|---|---|
| Install | `bun install --frozen-lockfile` | exit 0, lockfile unchanged |
| Lint/format + write | `bun run fix:all` | exit 0; only the six File-map paths modified |
| Types (all pkgs) | `bun run typecheck` | exit 0 |
| SDK unit tests | `cd packages/wallet-sdk && bun test` | green (existing + s1–s5, c1–c8 + edited tests) |
| Web unit tests | `cd apps/web-wallet && bun test` | green |
| Smoke | manual, browser, local stack | see below |

**Smoke plan** (local stack: `bun run dev`, local Supabase, guest signup; `VITE_BREEZ_API_KEY` present in the dev env):

Background facts:
- Guest signup provisions a default spark account named **Bitcoin** (`domain/user/user-api.ts:29–38`). A fresh guest's spark balance is 0.
- The preview (`getLightningSendQuote`) runs `parseBolt11Invoice` → expiry check → `account.wallet.prepareSendPayment` (one Breez SSP request) → **balance check last** (`spark-send-quote-service.ts:117–180`). So an unfunded account still exercises the full flipped path and fails with the balance `DomainError` — that failure is the cheap positive signal.
- `createSendQuote` checks expiry and balance before the RPC (`:207–222`), so an unfunded account cannot reach the DB write. The funded confirm path is maintainer-gated (real sats).

Steps:

1. **Boot + guest signup.** App boots; the **Bitcoin** (spark) account is visible.
2. **Spark preview, unfunded negative (runnable; proves the flipped preview end to end).** Generate a fresh small bolt11 in any external LN wallet (it will never be paid). Send → choose **Bitcoin** (spark) → paste the invoice → Continue. `send-store.ts:391` → `sdk.send.spark.getLightningQuote`. Expect the `DomainError` toast `Insufficient balance. Estimated total including fee is …` (`spark-send-quote-service.ts:173–180`), returned by `send-store.ts:398–404` and toasted by `send-input.tsx:109–124`.
   - Network: the same Breez requests as master for one `prepareSendPayment` call (compare against a master run; do not assert an absolute count). **No** Supabase request, no mint HTTP, no Open Secret read. If Breez itself rejects the prepare for the unfunded wallet, the destructive "Error" toast (`send-input.tsx:115–121`) is an acceptable alternate outcome; it still proves the flipped path ran. Record which one occurred.
3. **Expired invoice — destination-validation regression (runnable, no network).** Paste an old bolt11 (any expired mainnet invoice). Expect the destructive toast titled `Invalid destination` with description `Invoice expired` (`resolve-destination.ts:68–74` → `validation.ts:32–41`, toast at `send-input.tsx:141–148`) and **zero** network requests. This path stops before `sdk.send.spark.getLightningQuote`; the SDK's own expired branch (`'Lightning invoice has expired'`) is covered by test (s5), not by smoke.
4. **Funded spark send (maintainer, live).** With a funded Spark account: preview shows "Recipient gets" / fee rows (`send-confirmation.tsx:240–254`) → Confirm → exactly one `POST …/rest/v1/rpc/create_spark_send_quote`, no `accounts` / `users` select → navigates to `/transactions/<transactionId>` (proves the `{ transactionId }` unwrap) → the background processor (still `/temporary`, step 18) initiates and completes the payment; the transaction page shows completion via the existing realtime path.
5. **Cashu regression (runnable).** Lightning send preview from a cashu account (step-13 hooks) and token send preview (step-14 hooks) still work.
6. **No console errors** on any runnable path.

## Foreground parity accounting

Rule: the flipped flow adds **zero** network requests versus master.

- **Encryption.** `keys.getEncryption()` is memoized per session and warm (provisioning awaited it; same argument as step-14's table notes). Master's `useEncryption()` is a warm suspense query. Encrypting the RPC payload is local.
- **Supabase JWT.** The cross-cutting two-client token cost shared by every flipped write since step 5 (see the step-14 plan, same section) applies unchanged and ends at steps 18–19.

### A. Lightning preview (`send-store.ts:391` → `getSparkLightningQuote`)

| Request | Master | Flipped | Notes |
|---|---|---|---|
| Breez SSP `prepareSendPayment` | 1 | 1 | Same call on the caller-supplied `account.wallet` (`spark-send-quote-service.ts:147–150`). |
| Supabase (any) | 0 | 0 | Preview persists nothing; the repository is never touched. |
| Open Secret key read | 0 | 0 | Encryption memoized (only read when the default repository is built); no seed/mnemonic on this path. |
| Account / user re-fetch | 0 | 0 | `account` from the store (`send-store.ts:327`). |
| **Net added** | | **0** | |

### B. Confirm / create quote (`send-confirmation.tsx:188` → `useInitiateSparkSendQuote`)

| Request | Master | Flipped | Notes |
|---|---|---|---|
| Supabase RPC `create_spark_send_quote` | 1 | 1 | Same args; `userId` from the session instead of `useUser`, same identity. |
| Breez SSP (any) | 0 | 0 | `createSendQuote` never touches the wallet (`spark-send-quote-service.ts:200–236`); `initiateSend` runs later in the processor. |
| User read | 0 (`useUser` cache) | 0 (session) | |
| Post-create processor | unchanged | unchanged | `/temporary`, step 18; fed by realtime `SPARK_SEND_QUOTE_CREATED`, not the mutation result. |
| **Net added** | | **0** | |

### C. After create (navigation to `/transactions/<id>`)

| Request | Master | Flipped | Notes |
|---|---|---|---|
| Transaction page fetches | identical | identical | Both sides navigate with only `transactionId` (`send-confirmation.tsx:154–157`); the mutation result carries nothing else the page could have used. |
| **Net added** | | **0** | |

## Out of scope

- **Background processing (step 18):** `useProcessSparkSendQuoteTasks` (`initiateSend` / `complete` / `fail`), `useOnSparkSendStateChange`, the unresolved-quotes query + cache, the change handlers, and `useSparkSendQuoteRepository` / `useSparkSendQuoteService`.
- **Transfer (step 16):** `transfer-service.ts` and `transfer-service-hooks.ts` keep constructing the service directly; `purpose` / `transferId` stay off the public params until that slice decides its contract.
- **`resolveDestination`:** stays throwing; contract shape unresolved (carried from steps 13–14, Open question 1).
- **`SessionEndedError` retries in hooks this slice does not rewrite** (receive hooks from steps 9–12, the step-14 preview). Follow-up, not this slice.
- **In-flight abort → `SessionEndedError` remap (all flipped verbs, steps 9–15).** An abort during a postgrest call rejects as a plain repository `Error`, which skips the post-op fence and is retried once by `failureCount < 1`. Follow-up: in the API fence, catch and rethrow `SessionEndedError` when `signal.aborted`. Not this slice.
- **Create retry vs. committed first attempt (pre-existing, master-identical).** A transient client-side error after a committed `create_spark_send_quote` is retried once and surfaces the 23505 `DomainError` toast while the first quote proceeds. Not this slice; any fix needs an idempotency key on the RPC.
- **A shared Supabase token source between the web and SDK db clients** (cross-cutting; Open question 2 of step 14).
- **`#1164` narrowing** of quote fields that ride along in `SparkLightningQuote` (`send.ts:8–11` note).
- **`temporary.ts` pruning:** none made dead (decision 9). `index.ts`, `events.ts`, `sdk.ts`: untouched.
- **No DB schema, RPC, dependency, or migration changes.**

## Open questions

1. **`resolveDestination` contract shape and owner.** Carried from steps 13–14 unchanged. Does not block step 15.
2. **The service's `amount?: Money<'BTC'>` narrowing.** The honest long-term shape is a `Money` param the service narrows internally (or a currency check); today the cast lives in the API (decision 2), exactly as unsound as master's hook cast. A later cleanup (step 19 or #1164) can revisit. Not this slice.

## Plan-attack corrections (2026-10-09)

One adversarial review ran against plan commit `c027197` (maxplayer open-pool contribution job; claude harness, static-only — no `bun` in its environment). Verdict NOT READY with 0 Critical / 2 Important / 7 Minor+Nit; every finding is a plan-text fix, no redesign. All are folded into the body above; where this section and older wording disagree, the body as now written wins. Separately, the orchestrator applied the pinned seams locally as a throwaway scratch before the review: `bun run fix:all` exit 0 (biome only reordered `send-api.ts` imports) and `bun run typecheck` exit 0 on all 8 packages, with exactly the three pinned tests failing (SDK 232 pass / 3 fail) — the seams and the test-edit list are compile-verified.

Accepted and folded in:

- **Smoke step 3 could not reach the flipped code** (Important): a pasted expired invoice dies at destination validation (`resolve-destination.ts:68–74` → `validation.ts:32–41`, "Invalid destination" toast at `send-input.tsx:141–148`) and never reaches `sdk.send.spark.getLightningQuote`. The step rewritten as a destination-validation regression check; the SDK's own expired branch is proven by test (s5).
- **`SessionEndedError → false` covers only the two fence windows** (Important): an abort during the in-flight RPC resolves as postgrest `{ error }` → plain repository `Error` (`spark-send-quote-repository.ts:118`), skipping the post-op fence, and is retried once — identical to the merged cashu hooks. Decision 10 now states the limit; a new Out-of-scope bullet records the family-wide in-flight-abort remap follow-up (steps 9–15).
- **Decision 2's rejected-alternative rationale was wrong** (Minor): the store binds to the hook's local variables type, so `Money<'BTC'>` public params would still compile; the real reason for `Money` is sibling consistency. Rewritten.
- **Capture-variable assertions needed optional chaining** (Minor): `captured?.…` / `Object.keys(captured ?? {}).sort()` pinned in Task 1 step 1 (TS18048 / TS2769; precedent `send-api.test.ts` ~`:443`).
- **The lazy-construction edit now says to delete** the `api.spark` throw assertion (`send-api.test.ts:1071`) (Minor).
- **Smoke names and citations** (Minor): the default spark account is named **Bitcoin** (`user-api.ts:29–38`); the insufficient-balance toast is raised by `send-input.tsx:109–124` (the store only returns the error); the Breez request count is not asserted absolutely, and a Breez-side prepare rejection on an unfunded wallet is an acceptable alternate outcome.
- **New Out-of-scope bullet** (Minor): a transient error after a committed `create_spark_send_quote` retries into the 23505 `DomainError` toast while the first quote proceeds — pre-existing, master-identical, needs an RPC idempotency key.
- **Test (s5) seam simplified** (Nit): the preview never touches the repository, so the seam is `{}` cast as `SparkSendQuoteRepository` and the vacuous create counter is dropped. Decision 8 wording softened to "asserted by test (c6)". Decision 10 notes the hook must not import the SDK `CreateSparkSendQuoteParams` (same name, different shape). Citation fixes: `spark-send-quote-hooks.ts:8`, fixtures range `:31–172`.

Verified by the review and unchanged: slice scope and callers (no buy/gift-card/offer/e2e consumer; transfer stays in-package), the `{ transactionId }` result and the `onSuccess` narrowing compiling against `send-confirmation.tsx` unchanged, the RPC's latest definition (`20260425181643` only recreates the unique index) with no `CONCURRENCY_ERROR` raise, the options forwarding and transfer's one-arg compatibility, the fence order, `lightningQuote` naming, the seams and default builders, the `Money` cast compiling, the canary (nothing in `temporary.ts` goes dead), the import forms, every test fixture shape incl. the 2017 expiry ordering, foreground-parity tables A–C, and the untouched-file list.
