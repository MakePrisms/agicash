# Wallet SDK Cashu Receive Swap Slice (Step 10) Implementation Plan

**Goal:** Add `createSwap` to the `receive.cashu` sub-namespace of the SDK contract and flip the web same-mint token claim (`useCreateCashuReceiveSwap`) from `@agicash/wallet-sdk/temporary` to `sdk.receive.cashu.createSwap`.

**Architecture:** Step 10 of the 19-step no-cache extraction (spec: `docs/superpowers/specs/2026-06-24-wallet-sdk-no-cache-production-design.md`). The already-moved `domain/receive` cashu-receive-swap code gets a host-facing contract method inside the existing session-fenced `createReceiveApi` factory (step 9). This is a **money-path slice**: the web background processor (`useProcessCashuReceiveSwapTasks`) keeps completing swaps through `/temporary` until step 18 — the same boundary step 9 kept for quotes.

**Tech stack:** TypeScript, bun workspaces, bun:test, Supabase (postgrest-js), TanStack Query v5 (web side only).

## Global constraints

- The SDK stays React-agnostic: `packages/wallet-sdk` never imports `react` or `@tanstack/react-query`.
- Do not touch other domains' `/temporary` imports — only the files listed in this plan.
- The web money-path boundary stays intact: `useProcessCashuReceiveSwapTasks`, `useCashuReceiveSwapChangeHandlers`, `usePendingCashuReceiveSwaps`, `usePendingCashuReceiveSwapsCache`, and the `useCashuReceiveSwapRepository`/`useCashuReceiveSwapService` hook exports keep building `/temporary` classes until step 18.
- No event emission from the receive API. `cashu-receive-swap.created`/`.updated` stay type-only until the step-18 realtime feed. `events.ts` is untouched.
- Contract methods take the caller-supplied full `account: CashuAccount` (contract proposal, "Conventions across all namespaces"; set by the step-9 review #1176). Fetch-by-id stays reserved for background/orchestrator paths. A slice never re-decides this.
- Do not split the receive/send repositories or services into host/processing halves — that is the step-18 bullet in the production design, decided there and not earlier.
- Package manager: `bun` / `bunx` only.
- Base branch: `master` (at 056cbfc5, step 9 merged).
- No DB schema changes, no dependency changes. The `create_cashu_receive_swap` RPC is used unchanged.
- `packages/wallet-sdk/index.ts`, `domain/sdk/index.ts`, and `domain/sdk/sdk.ts` are untouched: `createReceiveApi` is already wired (step 9) and `export * from './domain/sdk'` already carries the new param types; `CashuReceiveSwap` is already a root type export.

## Resolved design decisions

1. **Contract home is `receive.cashu.createSwap`.** The entity is `CashuReceiveSwap`, a cashu-rail receive; rails appear as sub-namespaces where flows diverge, and the send-side sketch already places `createSwap` under `send.cashu`. The `spark`/`cashuToken` placeholders (steps 11/12) stay untouched. The contract-proposal `ReceiveApi` sketch gains the matching one-line entry so spec and code do not drift.
2. **Params: `CreateCashuReceiveSwapParams = { account: CashuAccount; token: Token }`.** The host passes the account it already holds (convention above). The web resolves it from its accounts cache — a cache read, not a network request, so the flipped flow issues no additional requests versus master.
3. **Result: `{ swap: CashuReceiveSwap; account: CashuAccount }`** — the service's own return shape. The `create_cashu_receive_swap` RPC advances the account keyset counter, so the updated account rides back on the same call (no extra read); a host without realtime needs it to stay coherent. The web component keeps using only `swap.transactionId` — parity, not new behavior.
4. **`reversedTransactionId` stays in-package.** Only `CashuSendSwapService` (reversal, step 14) and `ClaimCashuTokenService` (claim orchestration, step 12) pass it; the host never does. Same move as step 9 pinning `receiveType: 'LIGHTNING'`.
5. **No read surface this slice.** The only foreground swap read is the debug details page (`transaction-additional-details.tsx` → `getByTransactionId`), which step 9 deliberately left repo-level for the quote domain too (its decision 9). `getPending` is processor-only (step 18).
6. **`CashuReceiveSwapService.create` gains an optional second param `options?: { abortSignal?: AbortSignal }`**, threaded to `receiveSwapRepository.create(params, options)` (the repository already accepts `Options`). In-package callers (`claim-cashu-token-service.ts:125`, `cashu-send-swap-service.ts:280`) are unchanged — the param is optional. Mirrors step 9's `createReceiveQuote` change.
7. **Session fences follow the step-9 template** (accounts pattern): `requireUserId()` → capture `sessionSignal()` → await the service builder → re-check → `service.create(params, { abortSignal: signal })` → re-check. New test seams `createSwapRepository`/`createSwapService` mirror the quote seams.
8. **Web flip is confined to `useCreateCashuReceiveSwap`** in `cashu-receive-swap-hooks.ts`: the mutation body resolves the account from the accounts cache (`useGetCashuAccount`, unchanged) and calls `sdk.receive.cashu.createSwap({ token, account })`. The hook's external `{ token, accountId }` interface is unchanged, so `receive-cashu-token.tsx` is untouched. The `useUser` local leaves the hook (the SDK closes over the session); the import stays for `usePendingCashuReceiveSwaps`.
9. **Untouched laggard consumers** (each has its own slice): `_protected.receive.cashu_.token.tsx` + `ClaimCashuTokenService` graph (step 12), `cashu-send-swap-hooks.ts`'s `useCashuReceiveSwapService` ctor dep (step 14), `transaction-additional-details.tsx` (see decision 5), processor + change handlers + pending reads (step 18).
10. **Prune the dead swap-domain re-exports in `temporary.ts`**: `CashuSwapReceiveDbData` (type), `CashuSwapReceiveDbDataSchema`, and `CashuReceiveSwapSchema` — zero repo-wide importers (verified with grep over `apps/`). `AgicashDbCashuReceiveSwap`, `CashuReceiveSwapRepository`, and `CashuReceiveSwapService` stay (live consumers in decisions 8/9).

## Pinned seams

Contract (`packages/wallet-sdk/domain/sdk/receive.ts`) — `cashu` gains one method; two new types; one new type-only import (`Token` from `@cashu/cashu-ts`):

```ts
cashu: {
  // ...existing three quote methods...
  createSwap(
    params: CreateCashuReceiveSwapParams,
  ): Promise<CreateCashuReceiveSwapResult>;
};

export type CreateCashuReceiveSwapParams = {
  /** The cashu account to receive the token into. Must match the token's mint and currency. */
  account: CashuAccount;
  /** The token to receive. */
  token: Token;
};

export type CreateCashuReceiveSwapResult = {
  /** The created receive swap. Completion is background-driven; observe `cashu-receive-swap.updated`. */
  swap: CashuReceiveSwap;
  /** The receiving account with the keyset counter advanced for the swap's reserved outputs. */
  account: CashuAccount;
};
```

API factory (`packages/wallet-sdk/domain/receive/receive-api.ts`) — two new deps seams and builders mirroring the quote ones, plus the method:

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

Service signature change (`packages/wallet-sdk/domain/receive/cashu-receive-swap-service.ts`):

```ts
async create(
  { userId, token, account, reversedTransactionId }: { /* unchanged */ },
  options?: { abortSignal?: AbortSignal },
): Promise<{ swap: CashuReceiveSwap; account: CashuAccount }>
```

with the `receiveSwapRepository.create(...)` call gaining `options` as the second argument. Nothing else in the service changes.

Web flip (`apps/web-wallet/app/features/receive/cashu-receive-swap-hooks.ts`): add `import { sdk } from '~/features/shared/sdk.client';`; in `useCreateCashuReceiveSwap` delete the `useUser`/`useCashuReceiveSwapService` locals and replace the mutation body:

```ts
mutationFn: ({ token, accountId }: CreateProps) => {
  const account = getCashuAccount(accountId);
  return sdk.receive.cashu.createSwap({ token, account });
},
```

No other hook, cache, type, or import in the file changes.

## File map

- Modify: `packages/wallet-sdk/domain/sdk/receive.ts` (contract method + types)
- Modify: `packages/wallet-sdk/domain/receive/receive-api.ts` (swap builders + `createSwap`)
- Modify: `packages/wallet-sdk/domain/receive/cashu-receive-swap-service.ts` (options param)
- Modify: `packages/wallet-sdk/domain/receive/receive-api.test.ts` (createSwap suite + seams)
- Modify: `apps/web-wallet/app/features/receive/cashu-receive-swap-hooks.ts` (web flip)
- Modify: `packages/wallet-sdk/temporary.ts` (prune 3 dead re-exports)
- Modify: `docs/superpowers/specs/2026-07-02-wallet-sdk-contract-proposal.md` (ReceiveApi sketch gains `createSwap`)
- Untouched on purpose: `packages/wallet-sdk/index.ts`, `domain/sdk/index.ts`, `domain/sdk/sdk.ts`, `domain/sdk/events.ts`, `sdk.test.ts`, `cashu-receive-swap-repository.ts`, `cashu-receive-swap.ts`, `claim-cashu-token-service.ts`, `cashu-send-swap-service.ts`, all web `.tsx` components, `receive-cashu-token-hooks.ts`, `task-processing.ts`, `use-track-wallet-changes.ts`, `sdk.client.ts`, `transaction-additional-details.tsx`, `send/cashu-send-swap-hooks.ts`, `_protected.receive.cashu_.token.tsx`, all RPCs and migrations.

## Test coverage (extend `receive-api.test.ts`)

The `makeApi` harness gains `swapRepository?`/`swapService?` seam params. New `cashu.createSwap` block:

- (a) throws `NoSessionError` without a session, before any repository work (builder call counters stay 0);
- (b) happy path passes `{ userId, token, account }` and `{ abortSignal }` to the service and returns the `{ swap, account }` result verbatim;
- (c) rejects with `SessionEndedError` when the session ends during service construction (mid-write fence) and the service is never called;
- (d) rejects with `SessionEndedError` when the session ends during the write;
- (e) threads the session signal into the service write (`options.abortSignal === keys.sessionSignal()`).

## Verification summary

| Gate | Command | Expectation |
|---|---|---|
| Lint/format | `bun run fix:all` | exit 0 |
| Types (all pkgs) | `bun run typecheck` | exit 0 |
| Unit tests | `bun run test` | green (existing suites + new createSwap tests) |
| Smoke | manual, browser, local stack | app boots; a live testnut token claim to a same-mint account creates the swap via `sdk.receive.cashu.createSwap` (web processor completes it via `/temporary`); transaction page shows the completed receive; no console errors |
