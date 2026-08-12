# Wallet SDK Transactions Slice (Step 8) Implementation Plan

> **Orchestration note:** tasks 1–4 are delivered as maxplayer marketplace greenfield jobs (file-payload deliverables; the orchestrator pastes all needed context into the job text and integrates + verifies locally). Tasks 0 and 5 run locally. A post-integration adversarial-review job and the PR-description job also run on the marketplace.

**Goal:** Wire the `transactions` namespace of the SDK contract and flip the web transactions feature from `@agicash/wallet-sdk/temporary` to `sdk.transactions.*`.

**Architecture:** Step 8 of the 19-step no-cache extraction (spec: `docs/superpowers/specs/2026-06-24-wallet-sdk-no-cache-production-design.md`). The already-moved `domain/transactions` code gets a session-fenced API wrapper (`createTransactionsApi`), the `AgicashSdk` constructor wires it (replacing the `NotImplementedError` getter), and the web hooks call `sdk.transactions.*`. Web keeps its TanStack cache and its realtime invalidation layer (flips in step 18).

**Tech stack:** TypeScript, bun workspaces, bun:test, Supabase (postgrest-js), TanStack Query v5 (web side only).

## Global constraints

- The SDK stays React-agnostic: `packages/wallet-sdk` never imports `react` or `@tanstack/react-query`.
- Do not touch other domains' `/temporary` imports — only transactions files listed here.
- The web realtime invalidation layer stays as-is: `useTransactionChangeHandlers` keeps decrypting realtime rows via a `TransactionRepository` instance until step 18.
- No event emission from `TransactionsApi`. `transaction.created`/`transaction.updated` stay type-only until the step-18 realtime feed (contacts precedent).
- Package manager: `bun` / `bunx` only.
- Base branch: `master`. Work branch: `sdk/transactions-slice`.
- No DB schema changes, no dependency changes. The `list_transactions` RPC is used unchanged.
- `packages/wallet-sdk/domain/sdk/sdk.test.ts` has no transactions assertions — leave it untouched.

## Resolved design decisions

1. **Delete `userId` from the domain entity** (`BaseTransactionSchema`) and from `toTransaction`'s mapping. Nothing reads `transaction.userId` (repo-wide grep; every other `userId` in the domain is an input parameter). The contract file then re-exports the domain `Transaction` directly instead of `Omit<DomainTransaction, 'userId'>`. Rationale: `Omit` over the discriminated union collapses it to a flat object type and breaks narrowing — `transaction-list.tsx:156` (`details.destinationDetails?.sendType` behind `type === 'CASHU_LIGHTNING' && direction === 'SEND'`) stops compiling the moment the `index.ts` shadow export lifts. Same resolution as the contacts slice (entity field deleted, one type, root `index.ts` export stays the sole origin).
2. **Normalize `Cursor` to the non-null keyset tuple** `{ stateSortOrder: number; createdAt: string; id: string }`. The `| null` moves to the use sites: repository `ListOptions.cursor?: Cursor | null`, contract `cursor?: Cursor | null`, and `nextCursor: Cursor | null`. The old `type Cursor = {...} | null` made `Cursor | null` redundant and `cursor?: Cursor` confusingly nullable-by-type.
3. **Fold the page-end rule into `TransactionRepository.list`**: `nextCursor` is `null` when `transactions.length < pageSize`. Previously the web hook applied this rule (`length === PAGE_SIZE ? nextCursor : null`); folding it into the repository gives headless consumers true end-of-list semantics and the web hook becomes a pass-through. Behavior is identical for every case including the exact-full last page (next fetch returns an empty page → `null`).
4. **`createTransactionsApi` follows the accounts template, not contacts**: `TransactionRepository` needs `Encryption` from `await keys.getEncryption()`, so the test seam is `createRepository?: () => Promise<TransactionRepository>` and every method captures `sessionSignal()` **before** `await getRepository()`, re-checks after it, threads it as `abortSignal`, and re-checks after the repository call (fence order of `accounts-api.ts:51-62`).
5. `requireUserId()` only where the repository needs it: `list`, `countPendingAck`, `acknowledge`. `get` is id-scoped (RLS enforces ownership), same as contacts.
6. **`transaction-repository-hooks.ts` survives.** `toTransaction` is an instance method (needs decryption), so the realtime change handlers keep `useTransactionRepository()` — the accounts slice kept `account-repository-hooks.ts` for exactly this reason. No `getRepository` bridge from `createTransactionsApi`: the web echo path keeps its own `useEncryption()`-built repository until step 18 (accounts precedent — no unification attempt).
7. **`useAcknowledgeTransaction` keeps `{ transaction }` mutation variables** (`onSuccess` needs the whole transaction for the history-cache patch); only the `mutationFn` body changes to `sdk.transactions.acknowledge(transaction.id)`.
8. `transaction-hooks.ts` flips `NotFoundError` and `Cursor` imports to `@agicash/wallet-sdk` (both are on the public surface; `root.tsx` already imports `NotFoundError` from the root). `AgicashDbTransaction` stays on `/temporary` (realtime payload type). Other files' `/temporary` `NotFoundError` imports are out of scope.
9. **Canary prunes the dead transaction re-exports in `temporary.ts`**: `TransactionDetailsParserInput`/`TransactionDetailsParserShape`, the four enum schemas, `BaseTransactionSchema`/`TransactionSchema`, all per-variant details schemas/parsers, `TransactionDetailsDbDataSchema`/`TransactionDetailsSchema`, and `TransactionDetailsParser` — zero importers repo-wide. `AgicashDbTransaction`, `TransactionRepository` stay (live realtime consumers); the `Cursor` re-export is pruned at integration, after the web flip stops importing it.
10. The contract `list` gains JSDoc for semantics the RPC enforces: `DRAFT` and `FAILED` transactions never appear (state filter), ordering is `state_sort_order desc, created_at desc, id desc` (pending first), default `pageSize` 25.
11. `events.ts` flips its `Transaction` import from the contract file to `../transactions/transaction` (contacts precedent: events import domain entities).
12. Wiring in `sdk.ts`: `readonly transactions: TransactionsApi;` assigned in the constructor tail after `this.contacts`, via `createTransactionsApi({ db, getSession: getLiveSession, keys })`. The throwing getter is deleted; `NotImplementedError` stays imported (other getters still throw it).

## Delegation map (maxplayer)

| Task | Route | Deliverable files |
|---|---|---|
| 0 branch + plan commit | local | — |
| 1 canary: prune dead transaction `/temporary` exports | marketplace | `packages/wallet-sdk/temporary.ts` |
| 2 SDK: entity + repository + contract + transactions-api + events import + sdk.ts wiring | marketplace | 6 files (see file map) |
| 3 SDK: transactions-api tests | marketplace | `packages/wallet-sdk/domain/transactions/transactions-api.test.ts` |
| 4 web flip: transaction-hooks → `sdk.transactions` | marketplace | `apps/web-wallet/app/features/transactions/transaction-hooks.ts` |
| 5 integration, gates, smoke | local | — |
| 6 adversarial review of the integrated diff | marketplace | findings report |
| 7 PR description | marketplace | PR body markdown |

Jobs 1–4 are posted in parallel: the plan pins the shared seams (contract shape, `Deps` type, factory signature) so the test and web-flip jobs compile against the pinned contract rather than job 2's delivery. Greenfield mechanics: all context is pasted into the job text; sellers deliver full file contents at exact repo-relative paths; the orchestrator verifies with local gates after `collect`, before commit. Failed deliveries: log, re-route or do locally.

## Pinned seams (authoritative for jobs 2–4)

Contract (`packages/wallet-sdk/domain/sdk/transactions.ts`, full new content shape):

```ts
import type { Transaction } from '../transactions/transaction';
import type { Cursor } from '../transactions/transaction-repository';

export type { Cursor };

export type TransactionsApi = {
  get(id: string): Promise<Transaction | null>;
  /**
   * Transaction history, newest first with `PENDING` transactions on top
   * (`state_sort_order desc, created_at desc, id desc`). `DRAFT` and `FAILED`
   * transactions are excluded; `get` still returns them. `nextCursor` is
   * `null` on the last page.
   */
  list(params: {
    /** Opaque pagination token from a previous page's `nextCursor`. */
    cursor?: Cursor | null;
    /** Defaults to 25. */
    pageSize?: number;
    accountId?: string;
  }): Promise<{ transactions: Transaction[]; nextCursor: Cursor | null }>;
  countPendingAck(): Promise<number>;
  acknowledge(transactionId: string): Promise<void>;
};
```

API factory (`packages/wallet-sdk/domain/transactions/transactions-api.ts`):

```ts
type Deps = {
  db: AgicashDb;
  getSession: () => AuthSession;
  keys: SessionKeys;
  /** Test seam; defaults to building the repository from db + session keys. */
  createRepository?: () => Promise<TransactionRepository>;
};

export function createTransactionsApi(deps: Deps): TransactionsApi;
```

Cursor (`transaction-repository.ts`):

```ts
export type Cursor = {
  stateSortOrder: number;
  createdAt: string;
  id: string;
};
```

## File map

- Modify: `packages/wallet-sdk/temporary.ts` (canary prune + `Cursor` line at integration)
- Modify: `packages/wallet-sdk/domain/transactions/transaction.ts` (drop `userId` from `BaseTransactionSchema`)
- Modify: `packages/wallet-sdk/domain/transactions/transaction-repository.ts` (drop `userId` mapping; non-null `Cursor`; fold page-end rule)
- Modify: `packages/wallet-sdk/domain/sdk/transactions.ts` (contract per pinned seam)
- Create: `packages/wallet-sdk/domain/transactions/transactions-api.ts`
- Create: `packages/wallet-sdk/domain/transactions/transactions-api.test.ts`
- Modify: `packages/wallet-sdk/domain/sdk/events.ts` (domain `Transaction` import)
- Modify: `packages/wallet-sdk/domain/sdk/sdk.ts` (wire the namespace)
- Modify: `apps/web-wallet/app/features/transactions/transaction-hooks.ts` (flip to `sdk.transactions`)
- Untouched on purpose: `packages/wallet-sdk/index.ts` (line 65 stays the sole `Transaction` origin), `domain/sdk/index.ts`, `sdk.test.ts`, `transaction-repository-hooks.ts`, `transaction-ack-status-store.ts`, all `.tsx` components, `use-track-wallet-changes.ts`, `sdk.client.ts`, `list_transactions` RPC and migrations.

## Verification summary

| Gate | Command | Expectation |
|---|---|---|
| Lint/format | `bun run fix:all` | exit 0 |
| Types (4 pkgs) | `bun run typecheck` | exit 0 |
| Unit tests | `bun run test` | green (existing suites + new transactions-api tests) |
| Smoke | manual, browser | app boots; transaction history renders + paginates; transaction detail opens; pending-ack badge works; no `sdk.transactions.*` console errors |

## Execution notes (post-integration)

- All four marketplace jobs (canary prune, SDK namespace, tests, web flip) delivered exactly to the pinned specs; the only integration-time correction was a single biome line-width reformat in the delivered test file.
- The `Cursor` re-export in `temporary.ts` was pruned at integration after the web flip landed, as planned (decision 9).
- The post-integration adversarial review returned READY (0 Critical, 0 Important, 2 Minor, 2 Nit). Follow-up commit abc84f86 added the two tests it identified as missing: direct `TransactionRepository.list` pagination-rule coverage (full page / pending-first cursor / short page / empty page) and an `acknowledge` mid-write session-fence test.
- Two review items were kept as-is for sibling-namespace consistency: `get` throws no `NoSessionError` (id-scoped reads rely on RLS, same as the contacts and accounts namespaces), and the repository factory runs before the first abort check (accounts fence order).
- The browser smoke included a live testnut receive: the money path created a real transaction end-to-end, exercising `sdk.transactions.list`, `get`, `acknowledge`, and `countPendingAck` with zero console errors.
