# Wallet SDK Cashu Receive Swap Slice (Step 10) Implementation Plan

> **Orchestration note:** unlike step 9's four parallel jobs, this slice ships as **one whole-slice maxplayer contribution job**: a single seller forks `https://github.com/MakePrisms/agicash.git` pinned to the base commit of branch `sdk/cashu-receive-swap-slice`, reads this plan and the referenced code in the fork, and delivers the SDK namespace extension + tests + web flip + canary prune together on a branch descending from the base. The orchestrator then integrates locally, runs the gates, and does the browser smoke; two independent marketplace adversarial-review jobs follow. Job text stays task-only; this document is the full spec.

**Goal:** Add `createSwap` to the `receive.cashu` sub-namespace of the SDK contract and flip the web same-mint token-claim swap creation from the `@agicash/wallet-sdk/temporary` classes to `sdk.receive.cashu.createSwap`.

**Architecture:** Step 10 of the 19-step no-cache extraction (spec: `docs/superpowers/specs/2026-06-24-wallet-sdk-no-cache-production-design.md`). The already-moved `domain/receive` cashu-receive-swap code (`cashu-receive-swap.ts` / `-service.ts` / `-repository.ts`) gets its one host-initiated verb exposed through the step-9 `createReceiveApi` factory; the web claim flow calls it. This is a **money-path slice**: the web background processor (`useProcessCashuReceiveSwapTasks`) keeps completing and failing swaps through `/temporary` until step 18 — the same boundary style as step 9's quote processor. `sdk.ts` needs no change: the `receive` namespace was wired in step 9 (`sdk.ts:181`); the factory's return object just grows.

**Tech stack:** TypeScript, bun workspaces, bun:test, Supabase (postgrest-js), TanStack Query v5 (web side only).

## Global constraints

- **Param precedent (binding, set by the #1176 review):** contract methods take the caller-supplied full domain object (`account: CashuAccount`), never an id the SDK re-fetches. Fetch-by-id is reserved for paths with no caller state (background/orchestrator work, server routes). A flipped web flow must issue no additional network requests versus master. Binding text: production design → "Corollary (foreground parity)"; contract proposal → "Conventions across all namespaces". The step-9 *plan* text predates this and says `accountId` — the merged `receive-api.ts` / `domain/sdk/receive.ts` are authoritative, not that plan.
- **No host/processing split.** Do not split `CashuReceiveSwapRepository`/`CashuReceiveSwapService` (or any receive/send repo or service) into host and processing halves — the spec assigns that to step 18 explicitly ("Split the receive/send repos + services along the host/processing line"). The service keeps `completeSwap`/`fail`; they just never appear on the contract.
- The SDK stays React-agnostic: `packages/wallet-sdk` never imports `react` or `@tanstack/react-query`.
- The web money-path boundary stays intact: `useProcessCashuReceiveSwapTasks`, `useCashuReceiveSwapChangeHandlers`, `usePendingCashuReceiveSwaps`, `usePendingCashuReceiveSwapsCache`, and the `useCashuReceiveSwapRepository`/`useCashuReceiveSwapService` hook exports keep building `/temporary` classes until step 18.
- No event emission. `cashu-receive-swap.created`/`.updated` stay type-only until the step-18 realtime feed. `domain/sdk/events.ts` is untouched.
- No DB schema changes, no dependency changes. The RPCs (`create_cashu_receive_swap`, `complete_cashu_receive_swap`, `fail_cashu_receive_swap`) are used unchanged.
- Do not touch other domains' `/temporary` imports — only the files listed in this plan. Laggard consumers with their own future slices stay untouched (decision 10).
- `packages/wallet-sdk/index.ts` is untouched: `export * from './domain/sdk'` (line 10) carries the new param/result types; `CashuReceiveSwap` is already exported (line 94). `domain/sdk/sdk.ts` and `sdk.test.ts` are untouched. The contract-proposal doc is untouched (its `ReceiveApi` sketch is representative; "exact param types settle in each slice PR" per its own text).
- Package manager: `bun` / `bunx` only. Base branch: `master`. Work branch: `sdk/cashu-receive-swap-slice`.

## Resolved design decisions

1. **Slice scope = the cashu-receive-swap domain, whose only host-initiated verb is swap creation.** Evidence: repo-wide grep shows exactly three web-side entry points into `CashuReceiveSwapService.create`: (a) `useCreateCashuReceiveSwap` (`cashu-receive-swap-hooks.ts:99`), called from the **same-account claim branch** of `receive-cashu-token.tsx:166–173` (`isClaimingToSameCashuAccount` → swap on the mint's `/v1/swap`, NUT-03); (b) in-package `claim-cashu-token-service.ts:125` (Lightning-address server claim, step 17); (c) in-package `cashu-send-swap-service.ts:288` (send reversal, step 14). Step 10 flips (a) only. Neighbors on the spec's step list stay put: spark receive quote = step 11 (`spark-receive-quote-hooks.ts`), cross-account token claim (`createCrossAccountReceiveQuotes` in `receive-cashu-token-hooks.ts` + the token route) = step 12, cashu/spark sends = steps 13–15, transfer = step 16.
2. **Exactly one contract method: `createSwap`.** `completeSwap`, `fail`, `getPending`, and `getByTransactionId` do NOT go on the contract — the proposal's "Completion is not the host's job" convention hides background verbs behind `sdk.background` (step 18), pending tracking is the processor's read (step 18), and `getByTransactionId` follows step 9's `transaction-additional-details.tsx` laggard precedent. There is no `get*` preview twin: the claim UI computes nothing ahead of creation (fees come back on the created swap), so the `get*`/`create*` convention needs no preview method here.
3. **Contract params take the full account and the parsed token:** `CreateCashuReceiveSwapParams = { account: CashuAccount, token: Token }` (param precedent, Global constraints). The web hook resolves the account synchronously from its TanStack accounts cache via `useGetCashuAccount` — caller-held state, zero added requests. `reversedTransactionId` is deliberately **not** on the params: its only supplier is in-package `cashu-send-swap-service.ts:288` (never the host), the same reasoning that pinned `receiveType: 'LIGHTNING'` inside the step-9 API. Step 14 keeps reaching the service in-package.
4. **Return type is the service's `{ swap: CashuReceiveSwap; account: CashuAccount }`, exported as `CreateCashuReceiveSwapResult`.** The domain entities ride along per the standing note in `domain/sdk/receive.ts:9–11` (#1164 narrows later). `receive-cashu-token.tsx:167–172` destructures `swap.transactionId` from exactly this shape, so the caller is untouched.
5. **`receive-api.ts` grows additively.** Two new optional test seams on `Deps` (`createSwapRepository?`, `createSwapService?`) next to the existing quote seams, two lazy default builders, and one method on the returned `cashu` object. The existing quote seams, `cryptography` const, fences, and the `spark`/`cashuToken` throwing getters are byte-identical. The swap service takes **no** `CashuCryptography` — its constructor holds only the repository; encryption enters via `keys.getEncryption()` in the repository, the accounts bridge (`deps.getAccountRepository`) feeds the repository's row-mapper, same wiring as the quote repository.
6. **`CashuReceiveSwapService.create` gains an optional `options?: { abortSignal?: AbortSignal }` second param**, threaded to `receiveSwapRepository.create` (which already accepts it, `cashu-receive-swap-repository.ts:74–86`). Backward-compatible: the in-package callers (`claim-cashu-token-service.ts:125`, `cashu-send-swap-service.ts:288`) are unchanged. `completeSwap`/`fail` signatures are unchanged (background verbs; step 18 decides their threading).
7. **Session fences follow the merged step-9 template** (fence order of `receive-api.ts:75–93`): `requireUserId()` → capture `sessionSignal()` → await the service builder → re-check → call with `{ abortSignal: signal }` → re-check. `requireUserId()` is required because the repository writes the `userId` column (`p_user_id`), same rationale as step-9 decision 7. The mint HTTP work (`ensureKeysetKeys` in `completeSwap`) never runs on this path — `create` is DB-only plus pure fee/split math on the caller's wallet.
8. **Web flip is confined to one hook, `useCreateCashuReceiveSwap`** (`cashu-receive-swap-hooks.ts:99–118`): the mutation body calls `sdk.receive.cashu.createSwap({ token, account })` with the account from `useGetCashuAccount`; the `useUser` and `useCashuReceiveSwapService` locals in that hook are deleted. The hook's external `CreateProps` (`{ token, accountId }`) and return shape are unchanged, so `receive-cashu-token.tsx` is untouched. Error behavior is unchanged: the same repository throws the same `UniqueConstraintError('This token has already been claimed')`, surfaced by the caller's existing toast.
9. **Step-18 boundary (stays on `/temporary`):** everything else in `cashu-receive-swap-hooks.ts` is byte-identical — `useCashuReceiveSwapRepository`, `useCashuReceiveSwapService`, `PendingCashuReceiveSwapsCache` + `usePendingCashuReceiveSwapsCache`, `usePendingCashuReceiveSwaps`, `useCashuReceiveSwapChangeHandlers` (consumed by `use-track-wallet-changes.ts`), `useProcessCashuReceiveSwapTasks` (consumed by `task-processing.ts`). The `useUser` import stays (`usePendingCashuReceiveSwaps` uses it); the `AgicashDbCashuReceiveSwap` type import stays (change handlers).
10. **Untouched laggard consumers** (each has its own slice): `transaction-additional-details.tsx` (`getByTransactionId` is not on the contract), `send/cashu-send-swap-hooks.ts` (builds `CashuReceiveSwapService` for reversal wiring, step 14), `receive-cashu-token-hooks.ts` + `routes/_protected.receive.cashu_.token.tsx` (cross-account claim + loader, step 12), `spark-receive-quote-hooks.ts` (step 11), `lightning-address-service.ts` / `claim-cashu-token-service.ts` consumers (step 17).
11. **Canary prunes three dead swap-domain `/temporary` exports:** `CashuReceiveSwapSchema` (temporary.ts:123), `export type { CashuSwapReceiveDbData }` (line 24), and `CashuSwapReceiveDbDataSchema` (line 77) — repo-wide grep finds zero importers outside `packages/wallet-sdk` internals (verified 2026-08-18; re-verify before deleting). `CashuReceiveSwapRepository`, `CashuReceiveSwapService`, and `AgicashDbCashuReceiveSwap` stay (live consumers in decisions 9–10). The flip itself kills no further exports: the service class is still constructed by the processor hooks and `cashu-send-swap-hooks.ts`.
12. **No SDK events, no `sdk.ts` / `index.ts` / `sdk.test.ts` changes** (see Global constraints).

## Pinned seams (authoritative for the implementation job)

Contract (`packages/wallet-sdk/domain/sdk/receive.ts`) — add one method to the `cashu` object of `ReceiveApi`:

```ts
createSwap(
  params: CreateCashuReceiveSwapParams,
): Promise<CreateCashuReceiveSwapResult>;
```

and two new exported types below `CreateCashuReceiveQuoteParams`:

```ts
export type CreateCashuReceiveSwapParams = {
  /** The cashu account to receive the token into. Must match the token's mint and currency. */
  account: CashuAccount;
  /** The cashu token to receive. */
  token: Token;
};

export type CreateCashuReceiveSwapResult = {
  /** The created receive swap; completion happens in the background. */
  swap: CashuReceiveSwap;
  /** The receiving account with the updated keyset counter. */
  account: CashuAccount;
};
```

Imports: add `import type { Token } from '@cashu/cashu-ts';` and convert line 12's bare re-export into an import + re-export so the name is locally usable (the line-13 pattern): `import type { CashuReceiveSwap } from '../receive/cashu-receive-swap';` + `export type { CashuReceiveSwap };`. The spark/cashuToken placeholders and everything else stay byte-identical.

API factory (`packages/wallet-sdk/domain/receive/receive-api.ts`) — add to `Deps`:

```ts
/** Test seam; defaults to building the swap repository from db + session keys + account repository. */
createSwapRepository?: () => Promise<CashuReceiveSwapRepository>;
/** Test seam; defaults to building the swap service from the swap repository. */
createSwapService?: () => Promise<CashuReceiveSwapService>;
```

builders next to the existing `getRepository`/`getService`:

```ts
const getSwapRepository =
  deps.createSwapRepository ??
  (async (): Promise<CashuReceiveSwapRepository> => {
    const encryption = await deps.keys.getEncryption();
    const accountRepository = await deps.getAccountRepository();
    return new CashuReceiveSwapRepository(deps.db, encryption, accountRepository);
  });

const getSwapService =
  deps.createSwapService ??
  (async (): Promise<CashuReceiveSwapService> =>
    new CashuReceiveSwapService(await getSwapRepository()));
```

and the method on the returned `cashu` object, after `getQuote` (fence order pinned):

```ts
createSwap: async (params) => {
  const userId = requireUserId();
  const signal = deps.keys.sessionSignal();
  const service = await getSwapService();
  if (signal.aborted) throw new SessionEndedError();
  const result = await service.create(
    { userId, token: params.token, account: params.account },
    { abortSignal: signal },
  );
  if (signal.aborted) throw new SessionEndedError();
  return result;
},
```

New imports: `CashuReceiveSwapRepository` and `CashuReceiveSwapService` from their files. Nothing existing in the file changes.

Service signature change (`packages/wallet-sdk/domain/receive/cashu-receive-swap-service.ts`):

```ts
async create(
  { userId, token, account, reversedTransactionId }: { /* params unchanged */ },
  options?: { abortSignal?: AbortSignal },
): Promise<{ swap: CashuReceiveSwap; account: CashuAccount }>
```

with the single `this.receiveSwapRepository.create(...)` call gaining `options` as the second argument. `fail` and `completeSwap` are unchanged.

Web flip (`apps/web-wallet/app/features/receive/cashu-receive-swap-hooks.ts`): add `import { sdk } from '~/features/shared/sdk.client';` and replace the body of `useCreateCashuReceiveSwap`:

```ts
export function useCreateCashuReceiveSwap() {
  const getCashuAccount = useGetCashuAccount();

  return useMutation({
    mutationKey: ['create-cashu-receive-swap'],
    scope: {
      id: 'create-cashu-receive-swap',
    },
    mutationFn: ({ token, accountId }: CreateProps) => {
      const account = getCashuAccount(accountId);
      return sdk.receive.cashu.createSwap({ token, account });
    },
  });
}
```

No other hook, cache, type, or import in the file changes.

## File map

- Modify: `packages/wallet-sdk/temporary.ts` (canary prune, decision 11)
- Modify: `packages/wallet-sdk/domain/sdk/receive.ts` (contract method + param/result types)
- Modify: `packages/wallet-sdk/domain/receive/receive-api.ts` (swap seams + `createSwap`)
- Modify: `packages/wallet-sdk/domain/receive/cashu-receive-swap-service.ts` (options param)
- Modify: `packages/wallet-sdk/domain/receive/receive-api.test.ts` (new `cashu.createSwap` coverage)
- Modify: `apps/web-wallet/app/features/receive/cashu-receive-swap-hooks.ts` (web flip)
- Untouched on purpose: `packages/wallet-sdk/index.ts`, `domain/sdk/sdk.ts`, `domain/sdk/index.ts`, `domain/sdk/events.ts`, `sdk.test.ts`, `cashu-receive-swap-repository.ts`, `cashu-receive-swap.ts`, `claim-cashu-token-service.ts`, `cashu-send-swap-service.ts`, all web `.tsx` components (including `receive-cashu-token.tsx`), `receive-cashu-token-hooks.ts`, `send/cashu-send-swap-hooks.ts`, `transaction-additional-details.tsx`, `task-processing.ts`, `use-track-wallet-changes.ts`, `sdk.client.ts`, all RPCs and migrations.

## Task specs

**Task 0 (local, orchestrator): branch + plan commit.** Create `sdk/cashu-receive-swap-slice` off `master`, commit this plan, push. The plan commit is the pinned base for the contribution job.

**Task 1 (contribution, single seller): the whole slice.** Edit exactly the six files in the file map, applying the pinned seams verbatim. Working order and requirements:

1. **Canary prune.** Re-verify with a repo-wide grep that nothing outside `packages/wallet-sdk` imports `CashuReceiveSwapSchema`, `CashuSwapReceiveDbData`, or `CashuSwapReceiveDbDataSchema` from `@agicash/wallet-sdk/temporary`; then delete those three export statements from `temporary.ts`. If the grep finds a live importer, leave that export in place and note it in the delivery — do not widen scope to migrate the importer.
2. **Contract + factory + service.** Apply the pinned seams. Read the merged step-9 files first — `domain/sdk/receive.ts`, `domain/receive/receive-api.ts`, `domain/receive/cashu-receive-quote-service.ts` (its `createReceiveQuote` options param is the exact pattern for the swap service's `create`) — and match their structure, naming, and JSDoc style.
3. **Tests.** Extend `receive-api.test.ts` in its existing harness style (fake `getSession`, real `createSessionKeys` with controllable session scope, seam injection). Add a `cashu.createSwap` describe plus fence cases in the existing `session fences` describe. Required coverage:
   - (a) `createSwap` throws `NoSessionError` when the session is not logged in, before any repository/service construction (assert the seam was never invoked);
   - (b) happy path: passes exactly `{ userId, token, account }` to `CashuReceiveSwapService.create` with `{ abortSignal }` as the second argument, and returns the service result verbatim (`{ swap, account }`);
   - (c) rejects with `SessionEndedError` when the session ends during service construction (mid-fence) and the service is never called;
   - (d) rejects with `SessionEndedError` when the session ends after the service call resolves;
   - (e) a service rejection (e.g. `UniqueConstraintError`) propagates unchanged;
   - (f) the default swap-service builder path constructs without touching `CashuCryptography` (no `getPrivateKey` reachable from `createSwap` — mirror the intent of the existing `default service cryptography` describe; a construction-level assertion via the `createSwapRepository` seam is sufficient);
   - (g) the existing quote tests and the `spark`/`cashuToken` `NotImplementedError` getter tests still pass unmodified.
4. **Web flip.** Apply the pinned hook body. The flipped hook must not reference `useCashuReceiveSwapService` or `useUser`; every other export in the file stays byte-identical (the processor and change handlers are the step-18 boundary).

Gates in the seller's fork, all mandatory: `bun install`; `bun run fix:all` exit 0; `bun run typecheck` exit 0; `cd packages/wallet-sdk && bun test` green. The changed-file set of the delivered branch must equal the six-file list exactly (the orchestrator verifies with `git archive` + `diff -rq`).

**Task 2 (local, orchestrator): integration, gates, smoke.** Merge the delivery onto the work branch, re-run all four gates at the repo root, then browser-smoke against the local stack: boot the app, claim a same-mint testnut token (the `isSameAccountClaim` branch), confirm the swap is created via `sdk.receive.cashu.createSwap` (network tab: one `create_cashu_receive_swap` RPC, no extra account reads versus master), confirm the web processor completes the swap through `/temporary` (balance credited, transaction appears), and confirm the duplicate-claim path still toasts "This token has already been claimed". No console errors.

**Tasks 3–4 (marketplace): two independent adversarial reviews** of the integrated diff against this plan. Focus prompts: foreground parity (no added requests), fence order vs the step-9 template, the step-18 boundary (no processor/change-handler drift, no host/processing split), backward compatibility of the service signature for `claim-cashu-token-service.ts` and `cashu-send-swap-service.ts`, and canary-prune safety. Findings route back through the orchestrator; only confirmed findings trigger a fix cycle.

## Verification summary

| Gate | Command | Expectation |
|---|---|---|
| Lint/format | `bun run fix:all` | exit 0 |
| Types (all pkgs) | `bun run typecheck` | exit 0 |
| SDK unit tests | `cd packages/wallet-sdk && bun test` | green (existing suites + new `createSwap` coverage) |
| Smoke | manual, browser, local stack | app boots; same-mint token claim creates the swap via `sdk.receive.cashu.createSwap` with no added requests vs master; web processor completes it via `/temporary`; balance credited; transaction appears; duplicate claim toasts; no console errors |
