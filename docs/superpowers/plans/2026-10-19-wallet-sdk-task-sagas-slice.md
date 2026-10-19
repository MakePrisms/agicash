# Wallet SDK — task sagas slice (step 18, sub-slice 2) — implementation plan

> **For agentic workers:** execute the tasks below **in order**, one commit
> per task, all on one branch and one PR against `master`. Every `path:line`
> in this document is valid at the pinned base `master` = `18011167`
> (`180111674cfa4d2ddf6e9cb8632e59d5f03eb62a`, merge of #1194). The anchor
> text quoted next to a line wins if the line has drifted. Re-check a cited
> line before you edit it. Third-party behavior that could not be read at the
> pin (no `node_modules` in the planning checkout) is marked **(unverified)**
> and listed in the Self-check.
>
> **Read "Plan-attack corrections (2026-10-19)" at the end first.** Where it
> disagrees with older text, the correction wins.

## Goal

Each of the six web task processors moves into the SDK as a **saga**: plain
TypeScript that runs inside `sdk.taskProcessor` while this instance is
`'leader'`. A saga reads SDK state directly: the SDK event emitter (fed by the
realtime feed from step 18.3), SDK repositories and SDK services. It never
goes through React.

Per flow, in one commit:

- add the SDK saga and register it SDK-internally (no new public contract
  member, no public register method);
- run it under a child `RunScope` minted on the transition into `'leader'`
  and cancelled on leaving `'leader'`, on `stop()`, and on session end;
- `scope.track()` every in-flight action, so `stop()` joins it;
- delete that flow's `useProcess*` hook, its `TaskProcessor` call, and every
  web module, cache, handler branch and sweep entry that only it used.

The final task deletes `TaskProcessor` and the `state === 'leader'` mount in
`wallet.tsx`, and folds the `'error'` throw into `useTaskProcessor(): void`
(18.1 plan, `docs/superpowers/plans/2026-10-12-wallet-sdk-background-runtime-slice.md:462`
"fold that throw into `useTaskProcessor` itself").

## Where this sits

- Spec step 18 (`docs/superpowers/specs/2026-06-24-wallet-sdk-no-cache-production-design.md:96-123`):
  sub-slice 2 is "port each flow's processor into the SDK one at a time"
  (`:98`). The order bullet (`:100-108`, "**Order: sub-slice 3 lands before
  sub-slice 2**") is satisfied: the feed is SDK-owned since #1194, so each saga
  consumes `sdk.events` directly.
- Contract conventions (`docs/superpowers/specs/2026-07-02-wallet-sdk-contract-proposal.md:297-324`):
  fetch-by-id is "reserved for paths with no caller state: background/orchestrator
  work" (`:313-315`), and completion verbs "do NOT appear on the public
  namespaces" (`:318-321`). This slice adds no public member.
- 18.1 runtime: `TaskProcessorRuntime` owns one `RunScopes` controller for the
  lead loop (`packages/wallet-sdk/domain/wallet/task-processor-runtime.ts:82`
  "`private readonly scopes: RunScopes;`"). `run-scope.ts` documents the
  pattern this slice uses: "a consumer that needs several independent
  lifetimes (say, one per leadership stint) creates several controllers"
  (`packages/wallet-sdk/lib/run-scope.ts:80-82`). The 2026-10-13d amendment
  binds the sagas: "a stopped or inactive saga is cancelled and the next
  leader picks the work up from the database; no suspended in-memory
  continuation survives a change of conditions" (18.1 plan `:192`).

Throughout, "stint" means one leadership stint: from a transition into
`'leader'` to the next transition out of it, `stop()`, or session end.

## Global constraints

1. **React-agnostic SDK.** Nothing under `packages/wallet-sdk` imports `react`
   or `@tanstack/*`. The SDK never writes to the console: diagnostics go
   through `Logger` (`packages/wallet-sdk/domain/sdk/index.ts:33-39` "the SDK
   never writes to the console directly"). Exception kept for parity:
   `sparkDebugLog` (`packages/wallet-sdk/lib/spark/wallet.ts:53`), the existing
   feature-flag-gated Spark debug helper.
2. **No contract drift.** `domain/sdk/task-processor.ts`, `domain/sdk/events.ts`,
   `domain/sdk/index.ts` and `packages/wallet-sdk/index.ts` stay byte-identical.
3. **No schema, RPC or migration change.** No new dependency, no `bun add`.
   `bun` / `bunx` only.
4. **Vocabulary.** Say "task processing", never "background work", in code,
   comments, logs and commit messages.
5. **Logs.** Keep master's message strings and meta keys (inventory rows). No
   secret, token, proof, preimage or invoice in a log line or a test fixture.
   Use ids only.
6. **House style.** Deps types with flat optional members tagged
   `/** Test seam; defaults to … */`; a module-level `systemClock`; `create*`
   factories that return facades. Biome `recommended` is on; do not use the
   `delete` operator in new code. Default to no comments (CLAUDE.md "Comments
   and JSDoc"); JSDoc on exported SDK surfaces.
7. **Gates per task:** `bun run fix:all`, `bun run typecheck`, `bun run test`,
   `bun run build`. `bun run fix:all` may rewrite import order; revert any
   path outside the task's file map.

## A. Master inventory (the parity contract)

Path aliases used in this section (all relative to the repo root):

| Alias | Path |
|---|---|
| `CRQ` | `apps/web-wallet/app/features/receive/cashu-receive-quote-hooks.ts` |
| `CRS` | `apps/web-wallet/app/features/receive/cashu-receive-swap-hooks.ts` |
| `SRQ` | `apps/web-wallet/app/features/receive/spark-receive-quote-hooks.ts` |
| `CSQ` | `apps/web-wallet/app/features/send/cashu-send-quote-hooks.ts` |
| `CSS` | `apps/web-wallet/app/features/send/cashu-send-swap-hooks.ts` |
| `SSQ` | `apps/web-wallet/app/features/send/spark-send-quote-hooks.ts` |
| `MINTM` | `apps/web-wallet/app/lib/cashu/mint-quote-subscription-manager.ts` |
| `MELT` | `apps/web-wallet/app/lib/cashu/melt-quote-subscription.ts` |
| `MELTM` | `apps/web-wallet/app/lib/cashu/melt-quote-subscription-manager.ts` |
| `PSM` | `packages/wallet-sdk/domain/send/proof-state-subscription-manager.ts` |
| `AH` | `apps/web-wallet/app/features/accounts/account-hooks.ts` |
| `TW` | `apps/web-wallet/app/features/wallet/use-track-wallet-changes.ts` |
| `TP` | `apps/web-wallet/app/features/wallet/task-processing.ts` |
| `WT` | `apps/web-wallet/app/features/wallet/wallet.tsx` |
| `TMP` | `packages/wallet-sdk/temporary.ts` |

### A.0 Shared rows (all six flows)

| Row | path:line | Anchor | Note |
|---|---|---|---|
| X1 mount | `WT:61` | `{taskProcessor.state === 'leader' && <TaskProcessor />}` | processors run only on the leader tab |
| X2 calls | `TP:84-91` | `export const TaskProcessor = () => {` … `useProcessSparkSendQuoteTasks();` | one call per flow |
| X3 lifecycle | `TP:59`, `TP:63-70` | `export function useTaskProcessor(): {` / `sdk.taskProcessor.start();` | |
| X4 error throw | `WT:54-57` | `throw taskProcessor.error ?? new Error('Task processor entered error');` | unreachable at the pin |
| X5 query client | `apps/web-wallet/app/features/shared/query-client.ts:6` | `return new QueryClient();` | no default options: queries retry 3, mutations retry 0, default delays |
| X6 dynamic scope patch | `package.json:66`, `:71` | `"@tanstack/query-core@5.90.20": "patches/@tanstack%2Fquery-core@5.90.20.patch"` / `"This patch is needed to add support for dynamic mutation scope.` | `mutate(vars, { scope })` overrides the scope per call; mutations that share a scope id run one at a time, FIFO, across observers (they share the `MutationCache`) |
| X7 retry delay | TanStack default (unverified) | `Math.min(1000 * 2 ** failureCount, 30000)`, pre-increment count | same formula the SDK lead loop pins (`task-processor-runtime.ts:232` "`await scope.delay(Math.min(1000 * 2 ** failureCount, 30_000));`") |
| X8 retry pause | TanStack `retryer` `canContinue` (unverified; 18.1 plan `:66` describes it) | a backoff that ends while unfocused or offline pauses until both hold | |
| X9 online filter | `AH:490-502` | `export function useSelectItemsWithOnlineAccount() {` … `return account?.isOnline;` | applied as `select` on each list query; guards read the unfiltered cache |
| X10 account by id | `AH:347-367`, `AH:373`, `AH:402` | `useGetAccount` … `useGetCashuAccount` / `useGetSparkAccount` | reads the web accounts cache; throws `Account not found for id` (`AH:358`) |
| X11 account by mint | `AH:381-396` | `export function useGetCashuAccountByMintUrlAndCurrency() {` | `?? null` when absent |
| X12 handler map | `TW:77-108` | `const handlers = {` … `satisfies WalletChangeHandlers<` | must cover the feed events at compile time (18.3 code-review corrections) |
| X13 connected sweep | `TW:110-127`, `TW:140-141` | `const onConnectedRef = useLatest(() => {` / `if (state === 'connected') onConnectedRef.current();` | 13 invalidates; six are processor-only (rows below) |
| X14 replay | `packages/wallet-sdk/domain/sdk/events.ts:125-131` | `if (event === 'connection.changed' && this.lastConnectionChanged) {` | `connection.changed` replays synchronously inside `on()` |
| X15 sync dispatch | `events.ts:161-173` | `for (const handler of [...set]) {` | `emit` dispatches synchronously |
| X16 long timeout | `packages/utils/src/timeout.ts:3`, `:17`, `:30` | `const maxSetTimeoutDelay = 2 ** 31 - 1;` / `export function setLongTimeout(` / `Math.max(remaining, 0)` | past deadlines fire on the next tick |

### A.1 Cashu receive swap — `useProcessCashuReceiveSwapTasks` (`CRS:152`)

| Row | path:line | Anchor | Rule |
|---|---|---|---|
| RS1 list query | `CRS:111`, `CRS:117-118` | `function usePendingCashuReceiveSwaps() {` / `queryFn: () => receiveSwapRepository.getPending(userId),` | SDK `getPending` (`packages/wallet-sdk/domain/receive/cashu-receive-swap-repository.ts:288`) filters `state: 'PENDING'` (`:292-295`) |
| RS2 query opts | `CRS:119-123` | `staleTime: Number.POSITIVE_INFINITY,` … `throwOnError: true,` / `select: selectReceiveSwapsWithOnlineAccount,` | `refetchOnWindowFocus: 'always'`, `refetchOnReconnect: 'always'` |
| RS3 cache key | `CRS:46-48` | `class PendingCashuReceiveSwapsCache {` / `'pending-cashu-receive-swaps'` | keyed by `tokenHash` (`CRS:52` `get(tokenHash`) |
| RS4 version gate | `CRS:65-75` | `d.tokenHash === receiveSwap.tokenHash && d.version < receiveSwap.version` | `update` only replaces an existing entry |
| RS5 `.created` | `CRS:138-139` | `'cashu-receive-swap.created': ({ swap }) => {` → `pendingSwapsCache.add(swap);` | append, no dedupe |
| RS6 `.updated` | `CRS:141-147` | `const isSwapStillPending = swap.state === 'PENDING';` | update or remove (remove not version-gated) |
| RS7 sweep | `TW:118` | `pendingCashuReceiveSwapsCache.invalidate();` | processor-only |
| RS8 online filter | `CRS:114`, `CRS:123` | `useSelectItemsWithOnlineAccount();` | X9 |
| RS9 trigger | `CRS:180-193` | `queryKey: ['complete-cashu-receive-swap', swap.tokenHash],` … `gcTime: 0,` `staleTime: Number.POSITIVE_INFINITY,` `retry: 0,` | fires once per swap while it is in the filtered list; re-fires if it leaves and returns |
| RS10 action `completeSwap` | `CRS:158-178` | guard `const swap = pendingSwapsCache.get(tokenHash); if (!swap) {`; `getCashuAccount(swap.accountId)`; `receiveSwapService.completeSwap(account, swap)` | `retry: 3,` (`CRS:170`), `throwOnError: true,` (`CRS:171`); scope `` `receive-swap-${swap.tokenHash}` `` (`CRS:185`); no `onSuccess`; error log `'Error finalizing receive swap'` `{ cause, tokenHash }` |
| RS11 service | `packages/wallet-sdk/domain/receive/cashu-receive-swap-service.ts:148` | `async completeSwap(` | `(account: CashuAccount, receiveSwap)` → `{ swap, account, addedProofs }`; COMPLETED is a no-op; `TOKEN_ALREADY_CLAIMED` fails the swap |

### A.2 Cashu send swap — `useProcessCashuSendSwapTasks` (`CSS:396`)

| Row | path:line | Anchor | Rule |
|---|---|---|---|
| SS1 list query | `CSS:197`, `CSS:203-204` | `export function useUnresolvedCashuSendSwaps()` / `queryFn: () => cashuSendSwapRepository.getUnresolved(userId),` | SDK `getUnresolved` (`packages/wallet-sdk/domain/send/cashu-send-swap-repository.ts:262`) filters DRAFT, PENDING |
| SS2 query opts | `CSS:205-209` | `throwOnError: true,` (`CSS:208`) / `select: selectSendSwapsWithOnlineAccount,` | staleTime ∞, focus/reconnect `'always'` |
| SS3 split | `CSS:217-221` | `if (swap.state === 'DRAFT') {` / `} else if (swap.state === 'PENDING') {` | |
| SS4 caches | `CSS:82-84`, `CSS:52-57` | `class UnresolvedCashuSendSwapsCache {` / `class CashuSendSwapCache {` | the second is UI (share page) |
| SS5 version gates | `CSS:100`, `CSS:77` | `d.id === swap.id && d.version < swap.version ? swap : d,` / `(curr) => (curr && curr.version < swap.version ? swap : undefined),` | |
| SS6 handlers | `CSS:374-394` | `export function useCashuSendSwapChangeHandlers(): WalletChangeHandlers<` | `.created` adds (`CSS:381-382`); `.updated` does `cashuSendSwapCache.updateIfExists(swap);` then update/remove (`CSS:385-391`) |
| SS7 sweep | `TW:121` (processor-only), `TW:120` (UI, stays) | `unresolvedCashuSendSwapsCache.invalidate();` / `cashuSendSwapCache.invalidate();` | |
| SS8 DRAFT trigger | `CSS:457-467` | `queryKey: ['trigger-send-swap', swap.id],` … `retry: 0,` | once per draft id while listed |
| SS9 proof tracker | `CSS:331-370` | `function useOnProofStateChange({ swaps, onSpent }: OnProofStateChangeProps) {` | groups PENDING swaps by `getCashuAccount(...).mintUrl`; subscribe mutation `retry: 5,` (`CSS:341`), log `'Failed to subscribe to proof state updates'` `{ cause, mintUrl }` (`CSS:343`); never unsubscribes |
| SS10 proof manager | `PSM:26`, `PSM:42-48`, `PSM:84`, `PSM:101-104`, `PSM:135-144` | `async subscribe({` / `if (isSubset(idsSet, mintSubscription.ids)) {` / `wallet.on.proofStateUpdates(` / `webSocketConnection?.onClose` / `const allProofsSpent = swap.proofsToSend.every(` | logs via `console.*` (`PSM:44`, `:60`, `:66`, `:88`, `:103`, `:140`) |
| SS11 action `swapForProofsToSend` | `CSS:402-424` | guard `draft.find((s) => s.id === swapId)` (`CSS:404`); `cashuSendSwapService.swapForProofsToSend({ swap, account, })` (`CSS:412`) | `retry: 3,` `throwOnError: true,` (`CSS:417-418`); scope `` `send-swap-${swap.id}` `` (`CSS:461`); log `'Error swapping for proofs to send'` `{ cause, swapId }` |
| SS12 action `completeSwap` | `CSS:427-447` | guard `pending.find((s) => s.id === swapId)` (`CSS:429`); `cashuSendSwapService.complete(swap);` (`CSS:436`) | `retry: 3,` `throwOnError: true,` (`CSS:438-439`); scope `` `send-swap-${swap.id}` `` (`CSS:454`); `onSuccess` `cashuSendSwapCache.invalidate();` (`CSS:441`); log `'Error completing send swap'` `{ cause, swapId }` |
| SS13 services | `packages/wallet-sdk/domain/send/cashu-send-swap-service.ts:186`, `:247` | `async swapForProofsToSend({` / `async complete(swap: CashuSendSwap) {` | both return `void` (repo `complete` returns nothing, `cashu-send-swap-repository.ts:233-245`) |

### A.3 Cashu receive quote — `useProcessCashuReceiveQuoteTasks` (`CRQ:592`)

| Row | path:line | Anchor | Rule |
|---|---|---|---|
| RQ1 list query | `CRQ:304`, `CRQ:311-312` | `const usePendingCashuReceiveQuotes = () => {` / `queryFn: () => cashuReceiveQuoteRepository.getPending(userId),` | SDK `getPending` (`packages/wallet-sdk/domain/receive/cashu-receive-quote-repository.ts:405`) filters UNPAID, PAID (`:413`) |
| RQ2 query opts | `CRQ:313-317` | `refetchOnWindowFocus: 'always',` … `select: selectReceiveQuotesWithOnlineAccount,` | throwOnError true |
| RQ3 pending cache | `CRQ:114-175` | `'pending-cashu-receive-quotes'` (`CRQ:116`); `getByMintQuoteId` (`CRQ:150`); `getByMeltQuoteId` (`CRQ:157-167`) | update version-gated (`CRQ:133-140`) |
| RQ4 UI cache | `CRQ:84-112` | `public static Key = 'cashu-receive-quote';` / `(curr) => (curr && curr.version < quote.version ? quote : undefined),` | drives receive-page navigation |
| RQ5 handlers | `CRQ:281-302` | `'cashu-receive-quote.created': ({ quote }) => {` → `pendingQuotesCache.add(quote);`; `.updated` → `cashuReceiveQuoteCache.updateIfExists(quote);` then `['UNPAID', 'PAID'].includes(quote.state)` update/remove | |
| RQ6 sweep | `TW:117` (processor-only), `TW:116` (UI, stays) | `pendingCashuReceiveQuotesCache.invalidate();` | |
| RQ7 NUT-17 split | `CRQ:344-360`, `CRQ:498-525` | `account.wallet.getMintInfo().isSupported(17)` (`CRQ:348`) / `usePartitionQuotesByStateCheckType` | websocket when the mint supports `bolt11_mint_quote`, else polling |
| RQ8 mint websocket | `CRQ:424-448`, `MINTM:22-103` | `useTrackMintQuotesWithWebSocket` / `wallet.on.mintQuoteUpdates(` (`MINTM:72`) | subscribe `retry: 5,` (`CRQ:435`), log `'Error subscribing to mint quote updates'` `{ mintUrl, cause }`; subset reuse (`MINTM:37-49`); close drops the entry (`MINTM:90-93`); never unsubscribed |
| RQ9 mint expiry timer | `CRQ:462-495` | `const quoteTimeout = setLongTimeout(async () => {` (`CRQ:478`) | websocket path, UNPAID only; then `withRetry({ ... retry: 5 })` over `checkMintQuoteBolt11` (`CRQ:450-460`, `retry: 5,` at `CRQ:457`); log `'Error checking mint quote upon expiration'` `{ cause }` |
| RQ10 polling | `CRQ:370-414` | `queryKey: ['mint-quote', quote.quoteId]` / `retry: false,` (`CRQ:399`) / `refetchInterval: (query: Query) => {` (`CRQ:400`) / `return 60 * 1000;` (`CRQ:406`) / `return 10 * 1000;` (`CRQ:409`) / `refetchIntervalInBackground: true,` (`CRQ:411`) | the queryFn catches every error and logs `'Error checking mint quote'` `{ cause, quoteId }` (`CRQ:390`), so the 60 s on-429 branch is unreachable |
| RQ11 mint state map | `CRQ:537-576` | `const useOnMintQuoteStateChange = ({` | unknown quote → warn `'No related receive quote found for the mint quote'` (`CRQ:555`); debug `` `Mint quote state changed: ${mintQuote.state}` `` `{ receiveQuoteId, unit }`; UNPAID past expiry → expire; PAID → complete; ISSUED → complete |
| RQ12 melt tracker | `CRQ:788-835`, `MELT:30-151`, `MELTM:22-127` | `useOnMeltQuoteStateChange({` | CASHU_TOKEN quotes only (`CRQ:323-342`); default manager instance (`MELT:39-41`); subscribe `retry: 5,` (`MELT:99`), log `'Error subscribing to melt quote updates'` `{ mintUrl, cause }`; expiry timer per quote (`MELT:125-151`), log `'Error checking melt quote upon expiration'` `{ cause }`; debug `` `Melt quote state changed: ${meltQuote.state}` `` (`MELT:55`) |
| RQ13 melt dispatch | `CRQ:797-834` | `if (receiveQuote.tokenReceiveData.meltInitiated) {` | UNPAID: initiated → fail `'Cashu token melt failed.'`, else initiateMelt; PENDING → markMeltInitiated; expired (timer path only, `MELT:67-68`) → expire |
| RQ14 action `completeReceiveQuote` | `CRQ:603-635` | guard `pendingQuotesCache.get(quoteId)`; `getCashuAccount(quote.accountId)`; `cashuReceiveQuoteService.completeReceive(account, quote)` | `retry: 3,` `throwOnError: true,` (`CRQ:613-614`); scope `` `cashu-receive-quote-${quoteId}` `` (`CRQ:769`, `:778`); `onSuccess`: `transactionsCache.invalidateTransaction(data.quote.transactionId);` `cashuReceiveQuoteCache.updateIfExists(data.quote);` `pendingQuotesCache.update(data.quote);` (`CRQ:624-626`); log `'Complete cashu receive quote error'` `{ cause, receiveQuoteId }` |
| RQ15 action `expireReceiveQuote` | `CRQ:637-654` | `cashuReceiveQuoteService.expire(quote)` | `retry: 3,` `throwOnError: true,` (`CRQ:646-647`); scope `:783`, `:832`; log `'Expire cashu receive quote error'` |
| RQ16 action `failReceiveQuote` | `CRQ:656-676` | `cashuReceiveQuoteService.fail(quote, reason)` | `retry: 3,` `throwOnError: true,` (`CRQ:668-669`); scope `:734`, `:807`; log `'Fail cashu receive quote error'` |
| RQ17 action `initiateMelt` | `CRQ:678-743` | `if (quote?.type !== 'CASHU_TOKEN') {`; source wallet from X11, else `getInitializedCashuWallet(...)` and `throw new NetworkError('Source mint is offline')` (`CRQ:702`); `sourceWallet.meltProofsIdempotent(` | `retry: (failureCount, error) => {` (`CRQ:717`): `MintOperationError` → false, else `failureCount < 3`; throwOnError unset; scope `:811`; onError: `MintOperationError` → warn `'Failed to initiate melt.'` and fail with `error.message` under `` `cashu-receive-quote-${quoteId}` `` (`CRQ:734`); else error `'Initiate melt error'` |
| RQ18 action `markMeltInitiated` | `CRQ:745-763` | `cashuReceiveQuoteService.markMeltInitiated(quote)` | `retry: 3,` (`CRQ:756`); throwOnError unset; scope `:822`; log `'Mark melt initiated error'` |
| RQ19 services | `packages/wallet-sdk/domain/receive/cashu-receive-quote-service.ts:130`, `:156`, `:179`, `:199` | `async markMeltInitiated(` / `async expire(quote: CashuReceiveQuote): Promise<void> {` / `async fail(quote: CashuReceiveQuote, reason: string): Promise<void> {` / `async completeReceive(` | `completeReceive` reserves counters in the DB (`processPayment`, `:240-261`) and mints deterministic outputs (`:263-293`), so a retry by any leader recovers the same proofs |

### A.4 Cashu send quote — `useProcessCashuSendQuoteTasks` (`CSQ:251`)

| Row | path:line | Anchor | Rule |
|---|---|---|---|
| SQ1 list query | `CSQ:191`, `CSQ:197-198` | `function useUnresolvedCashuSendQuotes()` / `queryFn: () => cashuSendQuoteRepository.getUnresolved(userId),` | SDK `getUnresolved` (`packages/wallet-sdk/domain/send/cashu-send-quote-repository.ts:427`) filters UNPAID, PENDING |
| SQ2 query opts | `CSQ:199-203` | `refetchOnWindowFocus: 'always',` … `select: selectSendQuotesWithOnlineAccount,` | throwOnError true (`CSQ:202`) |
| SQ3 melt inputs | `CSQ:209-227` | `function usePendingMeltQuotes()` | `{ id: q.quoteId, mintUrl, currency, expiryInMs, inputAmount: sumProofs(q.proofs) }`; missing account throws `` `Cashu account not found for send quote: ${q.id}` `` (`CSQ:217`) |
| SQ4 cache + handlers | `CSQ:53`, `CSQ:232-249` | `public static Key = 'unresolved-cashu-send-quotes';` / `if (['UNPAID', 'PENDING'].includes(quote.state)) {` | version gate `CSQ:82`; no UI reader |
| SQ5 sweep | `TW:119` | `unresolvedCashuSendQuotesCache.invalidate();` | processor-only |
| SQ6 melt tracker | `CSQ:258-260`, `CSQ:428-500` | `() => new MeltQuoteSubscriptionManager(),` / `useOnMeltQuoteStateChange({` | its own manager; no polling, no 429 handling; expiry timer per quote (RQ12 shape); PAID path refetches the quote when change is expected and missing (`MELT:73-90`, nutshell#788) |
| SQ7 melt dispatch | `CSQ:438-500` | `if (sendQuote.state === 'UNPAID') {` (`CSQ:448`) | UNPAID → initiateSend; PENDING → markPending; expired → expire; PAID → complete; each first `getByMeltQuoteId` |
| SQ8 action `failSendQuote` | `CSQ:262-304` | `cashuSendService.failSendQuote(` (`CSQ:278`) | `retry: 3,` `throwOnError: true,` (`CSQ:288-289`); **no scope** (called from `initiateSend` onError, `CSQ:339`); `onSuccess` `subscriptionManager.removeQuoteFromSubscription(data);` (`CSQ:296`); log `'Failed to mark payment as failed'` `{ cause, sendQuoteId }` |
| SQ9 action `initiateSend` | `CSQ:307-347` | `cashuSendService.initiateSend(account, sendQuote, meltQuote);` (`CSQ:324`) | `retry` predicate (`CSQ:326`): `MintOperationError` → false, else `failureCount < 3`; `throwOnError: (error) => !(error instanceof MintOperationError),` (`CSQ:332`); scope `` `initiate-cashu-send-quote-${sendQuote.id}` `` (`CSQ:457`); onError: warn `'Failed to initiate send.'` + `failSendQuote`, else error `'Initiate send error'` |
| SQ10 action `markSendQuoteAsPending` | `CSQ:352-375` | `cashuSendService.markSendQuoteAsPending(sendQuote)` | `retry: 3,` (`CSQ:363`); scope `` `cashu-send-quote-${sendQuote.id}` `` (`CSQ:471`); `onSuccess` `unresolvedSendQuotesCache.update(quote);`; log `'Mark send quote as pending error'` |
| SQ11 action `expireSendQuote` | `CSQ:378-396` | `cashuSendService.expireSendQuote(sendQuote)` | `retry: 3,` (`CSQ:389`); scope `CSQ:483`; log `'Expire send quote error'` |
| SQ12 action `completeSendQuote` | `CSQ:399-425` | `cashuSendService.completeSendQuote(account, sendQuote, meltQuote)` | `retry: 3,` (`CSQ:418`); scope `CSQ:499`; log `'Complete send quote error'` (meta key `sendQuoteId` carries the variables object on master) |
| SQ13 scope split | `CSQ:457` vs `CSQ:471` | `` `initiate-cashu-send-quote-${sendQuote.id}` `` / `` `cashu-send-quote-${sendQuote.id}` `` | deliberate: the melt call can block until the payment settles, and PENDING/PAID updates must run meanwhile |
| SQ14 services | `packages/wallet-sdk/domain/send/cashu-send-quote-service.ts:336`, `:374`, `:394`, `:471`, `:513` | `async initiateSend(` / `async markSendQuoteAsPending(quote: CashuSendQuote) {` / `async completeSendQuote(` / `async failSendQuote(` / `async expireSendQuote(quote: CashuSendQuote): Promise<void> {` | `initiateSend` uses `meltProofsIdempotent`; complete and fail return the quote |

### A.5 Spark receive quote — `useProcessSparkReceiveQuoteTasks` (`SRQ:459`)

| Row | path:line | Anchor | Rule |
|---|---|---|---|
| PR1 list query | `SRQ:231`, `SRQ:237-238` | `queryFn: () => sparkReceiveQuoteRepository.getPending(userId),` | SDK `getPending` (`packages/wallet-sdk/domain/receive/spark-receive-quote-repository.ts:270`) filters UNPAID (`:278`) |
| PR2 query opts | `SRQ:239-243` | `select: selectWithOnlineAccount,` | throwOnError true |
| PR3 cache + handlers | `SRQ:143`, `SRQ:211-227` | `'pending-spark-receive-quotes'` / `'spark-receive-quote.created': ({ quote }) => {` | `.updated` keeps `sparkReceiveQuoteCache.updateIfExists(quote);` (`SRQ:219`, UI) |
| PR4 sweep | `TW:124` (processor-only), `TW:123` (UI, stays) | `pendingSparkReceiveQuotesCache.invalidate();` | |
| PR5 Breez tracker | `SRQ:346-453` | `account.wallet.addEventListener({` (`SRQ:407`) | per spark account; `paymentSucceeded` → match `htlcDetails.paymentHash` → complete; `synced` → expire every quote past `expiresAt` (`SRQ:411-414`); no-preimage error `'Receive payment succeeded but no preimage'` `{ paymentId, quoteId }`; `sparkDebugLog('Receive payment detected as completed', …)` |
| PR6 initial check | `SRQ:423-436` | `.getPaymentByInvoice({ invoice: quote.paymentRequest })` | `completed` → same handler; error `'Error checking initial receive payment'` `{ cause, accountId, quoteId }`; re-run for every quote on every list change (`SRQ:452`) |
| PR7 melt tracker | `SRQ:249-267`, `SRQ:664-711` | `usePendingMeltQuotes` / `useOnMeltQuoteStateChange({` | as RQ12/RQ13, no `onPaid` |
| PR8 action `completeReceiveQuote` | `SRQ:468-515` | `sparkReceiveQuoteService.complete(quote, paymentPreimage, sparkTransferId)` | `retry: 3,` `throwOnError: true,` (`SRQ:489-490`); `onSuccess`: debug `'Receive quote completed'` `{ quoteId, accountId, transactionId }`, `transactionsCache.invalidateTransaction(...)`, `sparkReceiveQuoteCache.updateIfExists(...)`, `pendingQuotesCache.remove(...)` (`SRQ:505-507`); log `'Complete spark receive quote error'` |
| PR9 action `expireReceiveQuote` | `SRQ:518-533` | `sparkReceiveQuoteService.expire(quote)` | `retry: 3,` (`SRQ:527`); log `'Expire spark receive quote error'` |
| PR10 action `failReceiveQuote` | `SRQ:537-555` | `sparkReceiveQuoteService.fail(quote, reason)` | `retry: 3,` (`SRQ:549`); log `'Fail spark receive quote error'` |
| PR11 action `initiateMelt` | `SRQ:559-621` | `sourceWallet.meltProofsIdempotent(` | predicate retry (`SRQ:598`); onError `MintOperationError` → warn `'Failed to initiate melt.'` + fail under `` `cashu-receive-quote-${quoteId}` `` (`SRQ:615`, wrong prefix); else `'Initiate melt error'` |
| PR12 action `markMeltInitiated` | `SRQ:626-642` | `sparkReceiveQuoteService.markMeltInitiated(quote)` | `retry: 3,` (`SRQ:637`); throwOnError unset; log `'Mark melt initiated error'` |
| PR13 scope strings | `SRQ:654`, `:659` vs `:683`, `:687`, `:698`, `:708` vs `:615` | `` `spark-receive-quote-${quoteId}` `` / `` `spark-receive-quote${receiveQuote.id}` `` / `` `cashu-receive-quote-${quoteId}` `` | three distinct scopes per quote: the Breez path (complete, expire) does not serialize with the melt path (fail, initiateMelt, markMeltInitiated, expire), and `expire` runs under two scopes depending on its trigger |
| PR14 services | `packages/wallet-sdk/domain/receive/spark-receive-quote-service.ts:99`, `:127`, `:152`, `:173` | `async complete(` / `async expire(quote: SparkReceiveQuote): Promise<void> {` / `async fail(` / `async markMeltInitiated(` | `complete` returns the quote |

### A.6 Spark send quote — `useProcessSparkSendQuoteTasks` (`SSQ:394`)

| Row | path:line | Anchor | Rule |
|---|---|---|---|
| PS1 list query | `SSQ:120`, `SSQ:126-127` | `queryFn: () => sparkSendQuoteRepository.getUnresolved(userId),` | SDK `getUnresolved` (`packages/wallet-sdk/domain/send/spark-send-quote-repository.ts:289`) filters UNPAID, PENDING (`:297`) |
| PS2 query opts | `SSQ:128-132` | `select: selectWithOnlineAccount,` | throwOnError true |
| PS3 cache + handlers | `SSQ:47`, `SSQ:102-117` | `'unresolved-spark-send-quotes'` / `quote.state === 'UNPAID' \|\| quote.state === 'PENDING';` | no UI reader |
| PS4 sweep | `TW:125` | `unresolvedSparkSendQuotesCache.invalidate();` | processor-only |
| PS5 tracker | `SSQ:156-290` | `const lastTriggeredStateRef = useRef<Map<string, SparkSendQuote['state']>>(` (`SSQ:169`) | UNPAID → `onUnpaid` once per state (`SSQ:193-195`); PENDING grouped per spark account; Breez `paymentSucceeded` / `paymentFailed` matched by `sparkTransferId` (`SSQ:210-214`); reason `'Lightning invoice expired.'` / `'Lightning payment failed.'` (`SSQ:243-245`); no-preimage error `'Payment succeeded but no preimage'` `{ paymentId }` |
| PS6 initial check | `SSQ:272-287` | `.getPayment({ paymentId: quote.sparkTransferId })` | completed / failed → same handler; error `'Error checking initial send payment status'` `{ cause, sparkTransferId }` |
| PS7 per-hook gate | `SSQ:513`, `:520`, `:531` | `if (!isInitiatingSend) {` | a trigger is dropped while any mutation of that kind is in flight (for any quote) |
| PS8 action `failSendQuote` | `SSQ:400-429` | `sparkSendQuoteService.fail(quote, reason)` | `retry: 3,` `throwOnError: true,` (`SSQ:417-418`); `onSuccess` remove; log `'Failed to mark spark send quote as failed'` |
| PS9 action `initiateSend` | `SSQ:432-471` | guard `if (cachedQuote?.state !== 'UNPAID') {` (`SSQ:435`); `.initiateSend({ account, sendQuote: quote })` | `DomainError` → `failSendQuote` with `error.message` under `` `spark-send-quote-${quote.id}` `` (`SSQ:447-454`) and return; `retry: 3,` `throwOnError: true,` (`SSQ:460-461`); `onSuccess` update; log `'Initiate spark send quote error'` |
| PS10 action `completeSendQuote` | `SSQ:475-506` | guard `if (!cachedQuote) {` (`SSQ:485`); `sparkSendQuoteService.complete(quote, paymentPreimage)` | `retry: 3,` (`SSQ:491`); `onSuccess` debug `'Send quote completed'` `{ quoteId, accountId }` + remove; log `'Complete spark send quote error'` |
| PS11 scopes | `SSQ:453`, `:515`, `:526`, `:534` | `` `spark-send-quote-${quote.id}` `` | one scope per quote |
| PS12 services | `packages/wallet-sdk/domain/send/spark-send-quote-service.ts:244`, `:340`, `:367` | `async initiateSend({` / `async complete(` / `async fail(quote: SparkSendQuote, reason: string): Promise<SparkSendQuote> {` | `initiateSend` uses `idempotencyKey: sendQuote.id` (`:279-282`); all three return the quote |

### A.7 Retry counting, stated once

TanStack's `retry: 3` means 3 retries, 4 attempts. A predicate gets the
failure count *before* the increment (0, 1, 2, …). The delay before retry
`n + 1` is `min(1000 * 2 ** n, 30_000)`: 1 s, 2 s, 4 s, 8 s, 16 s, 30 s.
`retry: 5` on the tracker subscribe mutations therefore means 6 attempts over
1+2+4+8+16 = 31 s of backoff. `withRetry` from `@agicash/utils` is different
(`packages/utils/src/with-retry.ts:118-120` "`min(DEFAULT_BASE_DELAY * 2 ** attemptIndex`"
with a 500 ms base); master uses it only for the RQ9 expiry re-check, and the
saga keeps it there.

## B. Shared saga runtime (pinned seams)

### B.1 The leader-stint scope (`packages/wallet-sdk/domain/wallet/task-processor-runtime.ts`)

The runtime gains a **second** `RunScopes` controller, `stints`. It holds at
most one live stint (`run-scope.ts:80-82`). The lead loop's controller
(`scopes`) is untouched.

```ts
// task-processor-runtime.ts — additions to TaskProcessorDeps
export type TaskProcessorDeps = {
  // …existing members unchanged (db, getSession, activity, emit, logger,
  // takeLead, randomUUID, clock)…
  /** The wallet event bus the sagas subscribe to and emit on. */
  walletEvents: SagaEventBus;
  /** Loads the user's active accounts for one stint. */
  loadAccounts: (userId: string, signal: AbortSignal) => Promise<Account[]>;
  /** The flows that run while this instance leads. */
  sagas: TaskSaga[];
  /** Test seam; defaults to `Date.now`. */
  now?: () => number;
};
```

Behavior:

- `private readonly stints: RunScopes = createRunScopes(clock)` and
  `private readonly queue = createKeyedSerialQueue()`, both built in the
  constructor. The queue lives on the runtime, **not** on the stint (decision
  C.9).
- `applyLead(lead, clientId)` keeps its body (`task-processor-runtime.ts:246-257`).
  After `this.transition(...)`, it calls `this.beginStint()` when `lead` is
  true and `this.stints.cancel()` when it is false. A renewal that returns the
  same boolean returns early (`:247-249`), so a renewal never restarts a stint.
- `beginStint()`: reads `this.deps.getSession()`; returns when not logged in.
  `const scope = this.stints.renew()`. Builds one `SagaStint` with
  `createSagaStint({ scope, userId: session.user.id, … })` (B.2). Calls
  `saga.start(stint)` for each saga in `deps.sagas` order, each in its own
  `try`/`catch` that logs `logger.error('Task saga failed to start', { saga: saga.name, cause: error })`
  and continues with the next saga.
- `stop()` cancels both controllers synchronously and joins both under one
  bound:

```ts
stop(): Promise<void> {
  this.scopes.cancel();
  this.stints.cancel();
  this.inFlight = false;
  this.transition('stopped');
  this.lastLead = undefined;
  return Promise.all([
    this.scopes.join(STOP_CHECKPOINT_TIMEOUT_MS),
    this.stints.join(STOP_CHECKPOINT_TIMEOUT_MS),
  ]).then(() => undefined);
}
```

The two joins race their bounds concurrently, so `stop()` resolves within
`STOP_CHECKPOINT_TIMEOUT_MS` of its call. **`STOP_CHECKPOINT_TIMEOUT_MS`
stays `5_000`** (`task-processor-runtime.ts:17`). Reason: the bound only
decides how long `dispose()` waits. It never tears a call: abandoned work keeps
running, is fenced by its dead scope, and every action it was performing is
idempotent and resumable by the next leader from the database (C.10). Only
`dispose()` awaits `stop()` (`sdk.ts:285-289`); `onSessionEnded` and the web
effect do not (`sdk.ts:139-142`, `TP:66-68`). A longer bound would only slow
HMR and process exit, with no safety gain.

Session end: `onSessionEnded` already calls `void taskProcessor.stop()` first
(`sdk.ts:139-142` "`if (taskProcessor) { void taskProcessor.stop(); }`"). The
stint is cancelled in that synchronous prefix, before `sessionToken.reset()`
and `events.clear()` (`sdk.ts:151`, `:159`). So no saga continuation can emit
an old user's row to the next user's handlers.

### B.2 The stint handle (`packages/wallet-sdk/domain/wallet/task-saga.ts`, new)

```ts
import type { Account } from '../accounts/account';
import type {
  ActivityMonitor,
  Logger,
  WalletEventMap,
  WalletEvents,
} from '../sdk';
import type { RunScope } from '../../lib/run-scope';
import type { WalletEventMessage } from './realtime-broadcasts';

/** The emitter surface the sagas use: subscribe, and emit contract events. */
export type SagaEventBus = {
  on: WalletEvents['on'];
  emit(message: WalletEventMessage): void;
};

/** One leadership stint, as a saga sees it. Everything it hands out dies with `scope`. */
export type SagaStint = {
  readonly scope: RunScope;
  readonly userId: string;
  readonly activity: ActivityMonitor;
  readonly accounts: StintAccounts;
  readonly queue: KeyedSerialQueue;
  readonly logger: Logger;
  now(): number;
  /** Subscribes for the rest of the stint. */
  on<K extends keyof WalletEventMap>(
    event: K,
    handler: (payload: WalletEventMap[K]) => void,
  ): void;
  /** Emits a contract event (hosts receive it too). A no-op once the stint is dead. */
  emit(message: WalletEventMessage): void;
  /** Runs `handler` on every inactive → active change during the stint. */
  onActivated(handler: () => void): void;
  /** Runs `handler` on every `connection.changed: 'connected'` after the stint began; not on the subscribe-time replay. */
  onReconnected(handler: () => void): void;
};

/** A flow's task processing. Registered SDK-internally; never public. */
export type TaskSaga = {
  readonly name: string;
  /** Starts the flow for one stint. Synchronous; every promise it starts is tracked on `stint.scope`. */
  start(stint: SagaStint): void;
};

export function createSagaStint(deps: {
  scope: RunScope;
  userId: string;
  events: SagaEventBus;
  activity: ActivityMonitor;
  loadAccounts: (userId: string, signal: AbortSignal) => Promise<Account[]>;
  queue: KeyedSerialQueue;
  logger: Logger;
  now: () => number;
}): SagaStint;
```

`createSagaStint` rules:

- `on` registers through `events.on` and `scope.onCleanup(unsubscribe)`.
- `emit` checks `scope.alive` first (the session fence in B.1).
- `onActivated`: one `activity.subscribe` per stint, registered with
  `scope.onCleanup`. It remembers `activity.isActive()` from the last call and
  runs the handlers only on a false → true change. This is
  `refetchOnWindowFocus: 'always'` plus `refetchOnReconnect: 'always'` under
  the single activity bit (18.1 decision 4, "Superseded by the single-flag
  model").
- `onReconnected`: one `events.on('connection.changed', …)` per stint. A local
  `subscribing = true` flag is set around the `on()` call; the replay that
  `on()` dispatches synchronously (row X14) is ignored. Later `'connected'`
  payloads run the handlers. This mirrors the web sweep (X13), which fires on
  every connect.
- The stint also wires its account set: `on('account.created', …)` and
  `on('account.updated', …)` call `accounts.apply(account)`, and
  `onReconnected(() => accounts.markStale())`.

### B.3 Accounts for a stint (`task-saga.ts`)

```ts
/** The user's active accounts for one stint. Loaded on first use. */
export type StintAccounts = {
  /** All active accounts. One `getAllActive` per stint, again after `markStale()`. */
  getAll(): Promise<Account[]>;
  /** The account, or undefined when it is not active. */
  get(id: string): Promise<Account | undefined>;
  /** Like `get`, but throws `Account not found for id: ${id}` or a type mismatch, as master's `getCashuAccount` / `getSparkAccount`. */
  getCashu(id: string): Promise<CashuAccount>;
  getSpark(id: string): Promise<SparkAccount>;
  /** By mint URL and currency, as master's `getCashuAccountByMintUrlAndCurrency`. */
  findCashu(mintUrl: string, currency: Currency): Promise<CashuAccount | undefined>;
  /** Replaces the account when `account.version` is newer; adds an unknown id. */
  apply(account: Account): void;
  /** The next read reloads. */
  markStale(): void;
};
```

- Lazy and single-flight. The load is `loadAccounts(userId, scope.signal)`,
  wired in `sdk.ts` to `(await accounts.getRepository()).getAllActive(userId, { abortSignal })`
  (`packages/wallet-sdk/domain/accounts/account-repository.ts:88`). A stint
  with nothing pending never loads accounts.
- `apply` before the first load is kept and merged (newer version wins) when
  the load lands.
- A failed load rejects every waiting reader and leaves the set unloaded; the
  next read retries. Readers are actions, so the action's retry policy covers
  it (master: a missing account throws inside `mutationFn`, X10).
- Account payloads from `account.updated` are fully mapped by the feed
  (`packages/wallet-sdk/domain/wallet/realtime-broadcasts.ts:131-134` →
  `toAccount`), including `isOnline` and the initialized wallet, so `apply`
  costs nothing extra.

### B.4 The per-flow working set (`task-saga.ts`)

```ts
export type WorkingSet<T> = {
  get(key: string): T | undefined;
  values(): T[];
  /** Applies an event or an action result. Version-gated; drops items that are no longer pending. */
  apply(item: T): void;
};

export function startWorkingSet<T extends { version: number }>(
  stint: SagaStint,
  options: {
    name: string;
    keyOf: (item: T) => string;
    isPending: (item: T) => boolean;
    load: (signal: AbortSignal) => Promise<T[]>;
    /** Runs after every change (load, event, action result). */
    onChange: () => void;
  },
): WorkingSet<T>;
```

Rules (each is a test in Task 0):

1. **Initial load** at `startWorkingSet` (stint start). This is master's list
   query on `TaskProcessor` mount (RS1, SS1, RQ1, SQ1, PR1, PS1).
2. **Reload triggers:** `stint.onActivated` and `stint.onReconnected`. They
   replace master's `refetchOnWindowFocus` / `refetchOnReconnect: 'always'`
   (RS2 …) and the processor-only sweep entries (RS7, SS7, RQ6, SQ5, PR4,
   PS4).
3. **Coalescing:** one load in flight per working set. A trigger during a
   load sets a flag, and exactly one more load runs after it.
4. **Load retry:** query parity, `retry: 3` through `runWithRetry` (B.6). On
   final failure: `logger.warn('Failed to load pending tasks', { saga: name, cause })`
   and keep the current items. Master threw to the error boundary
   (`throwOnError: true`); see decision C.4.
5. **Version gate:** `apply` ignores an item whose `version` is not newer than
   the held one.
6. **Removal:** an item for which `isPending` is false is removed and leaves
   a tombstone `{ key → version }`. A later `apply` with a version at or
   below the tombstone is ignored. This stops a late echo of an earlier
   version (for example PAID after the saga already applied COMPLETED) from
   re-adding a finished item.
7. **`.updated` for an unknown pending item adds it.** Master's `update` only
   replaced existing entries (RS4); see parity table E.
8. **Reconcile on load:** each `apply` stamps the item with a sequence
   number. A load records the sequence at its start. When the load lands,
   the new set is the loaded rows, except that a held item with a newer
   version, or one applied after the load started, wins; tombstones newer
   than a loaded row drop that row. Tombstones are cleared after reconcile.
9. **Fence:** after every await, `if (!stint.scope.alive) return;`. Loads pass
   `stint.scope.signal` (reads are safe to abort).

The saga feeds `apply` from its `.created` / `.updated` subscriptions and from
its own action results (B.8).

### B.5 The per-key serial queue (`task-saga.ts`)

```ts
/** Master's mutation scopes: FIFO per key, distinct keys concurrent. */
export type KeyedSerialQueue = {
  /**
   * Runs `job` after every job enqueued earlier under `key` has settled.
   * Every call runs `job` exactly once, unless `scope` is dead when its turn
   * comes; then it is skipped. `key` undefined runs at once (an unscoped
   * mutation). The run is tracked on `scope`.
   */
  enqueue(key: string | undefined, scope: RunScope, job: () => Promise<void>): void;
};

export function createKeyedSerialQueue(): KeyedSerialQueue;
```

- Implementation: `tails = new Map<string, Promise<void>>()`. A run is
  `previous.then(async () => { if (scope.alive) await job(); })`, with
  rejections swallowed so one failure never blocks the chain. `scope.track(run)`.
  When the run settles and is still the tail, delete the map entry.
- No dedupe. Master enqueues one mutation per trigger and each one runs; the
  guard re-read inside the job makes extra runs no-ops (X6).
- The queue outlives stints (C.9): a new stint's job on key K waits for the
  previous stint's job on K that is still in flight. On master the same
  happens because the scope queue lives in the tab's `MutationCache`.

### B.6 The retry helper (`task-saga.ts`)

```ts
/** TanStack's `retry`: a retry count, or a predicate over (failures so far, error). */
export type RetryPolicy =
  | number
  | ((failureCount: number, error: unknown) => boolean);

export type ActionOutcome<T> =
  | { status: 'succeeded'; value: T }
  | { status: 'failed'; error: unknown }
  | { status: 'abandoned' };

export const RETRY_MAX_DELAY_MS = 30_000;

/**
 * Runs `attempt` with TanStack mutation retry semantics: a retry n+1 waits
 * `min(1000 * 2 ** n, 30_000)` ms. Abandons (never rejects) when the scope dies
 * or when the host is inactive after a backoff; the next trigger starts afresh.
 */
export async function runWithRetry<T>(
  stint: Pick<SagaStint, 'scope' | 'activity'>,
  attempt: () => Promise<T>,
  retry: RetryPolicy,
): Promise<ActionOutcome<T>>;
```

Loop: `failureCount = 0`. Before each attempt, a dead scope → `abandoned`.
On a throw: dead scope → `abandoned`; `shouldRetry` false → `failed` with that
error; else `await scope.delay(min(1000 * 2 ** failureCount, 30_000))`,
`failureCount += 1`; then a dead scope or `!activity.isActive()` →
`abandoned`. The first attempt does **not** check `isActive()`: master's first
mutation attempt runs on a hidden leader (18.1 decision 1, "Hidden leader …
keeps processing"); only the continuation after a backoff is gated (X8).

**Abort choice per step.** One rule, applied in every saga:

- **Reads** (`getPending`, `getUnresolved`, `getAllActive`) get
  `stint.scope.signal`. Aborting a read loses nothing.
- **Money-moving or state-writing calls** (every service method in section A,
  `meltProofsIdempotent`, Breez calls) get **no** signal. They run to
  completion even when the stint dies. The saga checks `scope.alive` between
  steps and does not start the next one. This is master's behavior:
  unmounting `TaskProcessor` does not cancel an in-flight `useMutation`.
  Tearing them would be unsafe for two reasons: a mint may already have
  executed a melt or a swap whose result is written by the same service
  method, and `completeReceive` writes the minted proofs in the step after
  the mint call (RQ19). Letting the call finish keeps those writes together.
  Resuming is still safe because each call is idempotent: counters are
  reserved in the DB and outputs are deterministic (RQ19),
  `meltProofsIdempotent` (SQ14), Breez `idempotencyKey: sendQuote.id`
  (PS12), and every state RPC is a no-op on its target state.

### B.7 Actions (`task-saga.ts`)

```ts
export type SagaAction<T> = {
  /** Master's mutation scope id; undefined for an unscoped mutation. */
  key: string | undefined;
  retry: RetryPolicy;
  /** One attempt. Re-reads its guard from the working set; returns undefined when the guard fails. */
  attempt: () => Promise<T | undefined>;
  onSuccess?: (value: T) => void;
  /** Master's onError: the log line, plus any follow-up action. */
  onError: (error: unknown) => void;
};

export function runAction<T>(stint: SagaStint, action: SagaAction<T>): void;
```

`runAction` = `stint.queue.enqueue(action.key, stint.scope, async () => { … })`
around `runWithRetry`. After the outcome: a dead scope → return. `succeeded`
with a value → `onSuccess`. `failed` → `onError`. `abandoned` → nothing (the
next trigger restarts it). The guard sits inside `attempt`, so it is re-read
on every attempt, as master's guard inside `mutationFn` was.

### B.8 How hosts still get master's immediate `onSuccess` results

Rule: **when a service returns the row it just wrote, the saga emits the
contract `<entity>.updated` event with it.** The saga's own subscription
applies it to the working set (emit dispatches synchronously, X15). The
realtime echo of the same version follows and is ignored by every
version-gated consumer. No new event, no contract edit.

| Master `onSuccess` row | SDK behavior | Web change |
|---|---|---|
| RQ14 `transactionsCache.invalidateTransaction` + `cashuReceiveQuoteCache.updateIfExists` + `pendingQuotesCache.update` | emit `cashu-receive-quote.updated` with `data.quote` | `.updated` handler: if the UI cache holds an older version and the new state is `COMPLETED`, invalidate the transaction first, then `updateIfExists` (Task 3) |
| RQ18 `markMeltInitiated` (no onSuccess) | emit `cashu-receive-quote.updated` | none |
| PR8 debug log + invalidate + `updateIfExists` + remove | debug log in the saga; emit `spark-receive-quote.updated` | same handler change as RQ14, state `PAID` (Task 5) |
| PR12 `markMeltInitiated` | emit `spark-receive-quote.updated` | none |
| RS10 (no onSuccess) | emit `cashu-receive-swap.updated` with `result.swap` | none (saga-only event after Task 1) |
| SS12 `cashuSendSwapCache.invalidate()` | none: `complete` returns `void` (SS13) | none: the share page updates from the realtime `.updated` echo (`CSS:385` `updateIfExists`), delta E-SS12 |
| SS11 (no onSuccess) | none: `swapForProofsToSend` returns `void` | none |
| SQ8 `removeQuoteFromSubscription` | saga-internal (melt manager); emit `cashu-send-quote.updated` | none |
| SQ10 `unresolvedSendQuotesCache.update` | emit `cashu-send-quote.updated` | none |
| SQ12 (no onSuccess) | emit `cashu-send-quote.updated` | none |
| PS8 / PS9 / PS10 remove / update / debug + remove | debug log in the saga for PS10; emit `spark-send-quote.updated` | none |
| RQ15, RQ16, SQ11, PR9, PR10 (no onSuccess; `void`) | nothing | none |

The web gate for the transaction invalidation needs the version check because
the leader tab sees the same version twice (saga emit, then echo). It reads
the UI cache entry, so it fires only in a tab that tracks that quote (the
receive page or buy checkout). That covers master's leader-tab case, and adds
the follower tab that created the quote, which master left exposed to the
stale-DRAFT race its comment describes (`CRQ:617-623`).

### B.9 Trackers

- **Subscription managers** live in the SDK and log through `Logger`:
  - `packages/wallet-sdk/lib/mint-quote-subscription-manager.ts` (moved from
    `MINTM` in Task 3);
  - `packages/wallet-sdk/lib/melt-quote-subscription-manager.ts` (moved from
    `MELTM` in Task 3);
  - `PSM` stays at `domain/send/proof-state-subscription-manager.ts`. It
    imports `CashuSendSwap` (`PSM:5`), so `lib/` would be an upward import.

  Each constructor takes `logger: Logger`. Every `console.debug` / `console.error`
  becomes `logger.debug` / `logger.error` with the same message and meta. A
  stint builds its own manager instances and registers an `unsubscribeAll()`
  with `scope.onCleanup`. Each manager gains `unsubscribeAll(): void`, which
  calls every stored unsubscribe and clears the map.
- **Tracker helpers** (`packages/wallet-sdk/domain/wallet/quote-trackers.ts`,
  Task 3):

```ts
/** Sleeps until `at` (ms since epoch) in chunks below setTimeout's cap; returns early when the scope dies. */
export async function delayUntil(stint: SagaStint, at: number): Promise<void>;

export type MeltQuoteInput = {
  id: string;
  mintUrl: string;
  currency: Currency;
  expiryInMs: number;
  inputAmount: number;
};

export type MeltQuoteHandlers = {
  getWallet: (mintUrl: string, currency: Currency) => Promise<ExtendedCashuWallet>;
  onUnpaid?: (meltQuote: MeltQuoteBolt11Response) => void;
  onPending?: (meltQuote: MeltQuoteBolt11Response) => void;
  onPaid?: (meltQuote: MeltQuoteBolt11Response) => void;
  onExpired?: (meltQuote: MeltQuoteBolt11Response) => void;
};

/** Master's `useOnMeltQuoteStateChange`, as a stint-bound tracker. Call `sync` after every working-set change. */
export function createMeltQuoteTracker(
  stint: SagaStint,
  manager: MeltQuoteSubscriptionManager,
  handlers: MeltQuoteHandlers,
): { sync(quotes: MeltQuoteInput[]): void };

export type MintQuoteTarget = { quoteId: string; mintUrl: string };

/** Master's websocket / polling split for mint quotes (RQ7–RQ11). */
export function createMintQuoteTracker(
  stint: SagaStint,
  manager: MintQuoteSubscriptionManager,
  handlers: {
    getAccount: (quoteId: string) => Promise<CashuAccount | undefined>;
    onUpdate: (mintQuote: MintQuoteBolt11Response) => void;
  },
): { sync(quotes: CashuReceiveQuote[]): void };
```

  `delayUntil` loops `scope.delay(Math.min(remaining, 2 ** 31 - 1))` until
  `now() >= at` or the scope dies (X16). An expiry timer is armed once per
  quote per stint (`armed: Map<id, token>`); when it fires, it acts only if
  its token is still current and the quote is still in the working set.
  Master re-armed every timer on each list change; the fire times are the
  same.

## C. Resolved decisions

### C.1 PR shape and order

**Decision:** one PR on `master`, eight commits:

| Task | Content |
|---|---|
| 0 | Shared runtime (B.1–B.7), stint wiring in `sdk.ts`, empty saga list. No web change. Behavior-neutral. |
| 1 | Cashu receive swap |
| 2 | Cashu send swap (moves `PSM` usage into the SDK) |
| 3 | Cashu receive quote (moves the mint and melt managers, adds `quote-trackers.ts`) |
| 4 | Cashu send quote |
| 5 | Spark receive quote (deletes the last web melt-tracker consumer) |
| 6 | Spark send quote |
| 7 | Delete `TaskProcessor` and the leader mount; `useTaskProcessor(): void` |

The order goes from fewest trackers to most: one action and no tracker
(swap receive), then the proof-state websocket, then mint + melt trackers,
then melt only, then Breez. Each Breez flow comes after the cashu flows so
the maintainer's mainnet gate runs once over a stable cashu base.

**Rejected:** Task 0 bundled with the receive swap. A Task 0 without a flow
isolates the `stop()` / stint change, so a regression in leader handoff
bisects to the runtime and not to the first flow. **Rejected:** one PR per
flow. The spec asks for live money-path verification for step 18 (`:109`
"Live money-path verification is mandatory here."); one PR lets the
maintainer run that gate once over all six flows while every commit stays
bisectable.

### C.2 Saga home and registration

**Decision:** each saga lives next to its service:
`packages/wallet-sdk/domain/receive/cashu-receive-swap-saga.ts`,
`…/receive/cashu-receive-quote-saga.ts`, `…/receive/spark-receive-quote-saga.ts`,
`…/send/cashu-send-swap-saga.ts`, `…/send/cashu-send-quote-saga.ts`,
`…/send/spark-send-quote-saga.ts`. Shared runtime: `domain/wallet/task-saga.ts`
and `domain/wallet/quote-trackers.ts`. Registration: one SDK-internal list
built by `createTaskSagas` in `packages/wallet-sdk/domain/wallet/task-sagas.ts`.
`sdk.ts` passes `sagas: createTaskSagas(…)` into `createTaskProcessor`. Each
flow task appends one entry to that list; `sdk.ts` changes only in Task 0.

```ts
// packages/wallet-sdk/domain/wallet/task-sagas.ts
export type TaskSagasDeps = {
  db: AgicashDb;
  keys: SessionKeys;
  getAccountRepository: () => Promise<AccountRepository>;
};

/** The task-processing flows, in start order. SDK-internal: never exported from the package. */
export function createTaskSagas(deps: TaskSagasDeps): TaskSaga[];
```

`createTaskSagas` builds repositories and services the same way
`createReceiveApi` and `createSendApi` do (`packages/wallet-sdk/domain/receive/receive-api.ts:54-105`,
`packages/wallet-sdk/domain/send/send-api.ts:49-89`), lazily per call, from
`deps.keys` and `deps.getAccountRepository`. **Rejected:** a register method
on `TaskProcessorApi` (forbidden: 18.1 plan `:11`, `:462`). **Rejected:** all
sagas in `domain/wallet/`. A saga is flow logic and changes with its service.

### C.3 Accounts

**Decision:** the per-stint working set of B.3. It is loaded lazily with one
`getAllActive` on the first read in a stint, kept fresh by version-gated
`account.created` / `account.updated` payloads, and marked stale on
`'connected'`. Each action reads it per attempt, as master's `getCashuAccount`
read the web cache.

Cost versus master, per leadership acquisition, when anything is pending:
**+1** proofs-inclusive `accounts` read, **+3 mint HTTP requests per active
cashu account** (`getInitializedCashuWallet`, `packages/wallet-sdk/lib/cashu.ts:181-187`
"`mint.getInfo()` … `mint.getKeySets()` … `mint.getKeys()`"), and **+1 Breez
`getInfo` per spark account** (`packages/wallet-sdk/lib/spark/wallet.ts:161-176`;
the Breez connection itself is memoized in `sparkWalletPromises`, `:99`).
When nothing is pending, the cost is **0**. After each `'connected'`, the
same cost repeats once, at the next action that needs an account. Master
paid 0 because the web accounts cache was already warm.

**Rejected:** fetch-by-id per action (`AccountRepository.get`, `account-repository.ts:61`).
The conventions allow it for this work (`contract-proposal.md:313-315`), but
each call is a proofs-inclusive read, a decrypt, and 3 mint requests. A
cashu receive quote alone runs up to 3 actions (initiateMelt, markMeltInitiated,
complete), and every retry attempt re-reads. `initiateMelt` also needs a
lookup by mint URL and currency (X11), which an id fetch cannot serve. Its
fallback wallet would lose the account's `authProvider`
(`account-repository.ts:226-238`), and auth-gated mints would fail.
**Rejected:** seeding from the retained `auth.session-started` payload
(`events.ts:100-102`). It is the snapshot at session start; a stint that
begins later would start stale and depend on having heard every account
event since.

**Spec tension, stated:** the spec's "no cache in the SDK" (`design.md:19-29`)
targets host-facing reads ("Reads are `Promise`s"). The stint set is
task-processing state that dies with the stint. It is never read by a host.
It is the same kind of state as the pending working set, which no design can
avoid.

### C.4 Per-task failure policy

**Decision:** a task that exhausts its retries logs master's message and
meta at master's level, stays in the working set, and is retried by the next
trigger (a websocket update, a poll, a reload, or the next stint). A working
set whose load fails after retries warns `'Failed to load pending tasks'`
and keeps its items. **This slice emits no `'error'` transition.** `'error'`
stays reserved in the type, in `transition()` (`task-processor-runtime.ts:163-174`),
and in the web throw (now inside `useTaskProcessor`, Task 7).

A flow wedged past the checkpoint bound does not move to `'error'` either:
`join` abandons it (`run-scope.ts:153-162`), and it is fenced. The 18.1 text
allows an `'error'` transition "if a flow is wedged past the checkpoint
timeout" (`:462`). Using it would turn one slow mint into a wallet-wide
error page, and stop-time is the wrong moment to surface it.

**Delta (named):** master's `throwOnError: true` (RS10, SS11, SS12, RQ14-16,
SQ8-12, PR8-10, PS8-10, and the six list queries) sent the whole wallet UI to
the error boundary after retries. The SDK logs instead. This follows the
contract: "Per-task errors never change state, so they never fire it"
(`events.ts:72-74`) and 18.1 decision e (`:80`). **Rejected:** `'error'` on
the first failed task. It contradicts that contract line, and one bad quote
would block every other flow on every device.

### C.5 Subscription managers and trackers

**Decision:** B.9. Mint and melt managers move to `packages/wallet-sdk/lib/`.
`PSM` stays in `domain/send/` and gains an injected `logger`. React trackers
become stint-bound TS (`quote-trackers.ts` for mint and melt quotes,
saga-local code for proof state and Breez). Long timers use `delayUntil` on
the stint scope. Subscriptions are torn down when the stint ends.

**Rejected:** keeping the managers module-global. Master never unsubscribed
(RQ8, SS9); a leader that lost the lead kept its mint sockets open. A
stint-owned manager closes them. **Rejected:** a generic "tracker" framework.
The three tracker kinds differ (subset reuse, Breez listener ids, a polling
split); helpers per kind are smaller.

### C.6 The spec's host/processing repository split

**Decision:** out of scope; follow-up slice. The spec bullet
(`design.md:110-118`, "**Split the receive/send repos + services along the
host/processing line**") is a refactor of constructors and module
boundaries. This slice moves orchestration and changes no service signature.
Combining them would put two kinds of change in each money-path commit and
make the live gate unable to tell a saga bug from a split bug. After this
slice, the processing verbs have exactly one caller each (a saga) and the web
no longer calls them. That makes the split mechanical. Canary greps in each
task prove the web call sites are gone.

### C.7 Web caches: dead versus still needed

| Cache / hook | After | Reason (consumers, grep at the pin) |
|---|---|---|
| `PendingCashuReceiveSwapsCache`, `usePendingCashuReceiveSwapsCache`, `useCashuReceiveSwapChangeHandlers` | dead (Task 1) | only `TW:20`, `TW:55`, `TW:67`, `TW:118` and the processor |
| `UnresolvedCashuSendSwapsCache`, its hook, `useUnresolvedCashuSendSwaps` | dead (Task 2) | `TW:34`, `TW:70`, `TW:121`, `CSS:378`, `CSS:397` |
| `CashuSendSwapCache` + `.updated` `updateIfExists` + sweep `TW:120` | **kept** | share page: `apps/web-wallet/app/routes/_protected.send.share.$swapId.tsx:16`, `:18`; `useCashuSendSwap` `CSS:228`, `useTrackCashuSendSwap` `CSS:279` |
| `PendingCashuReceiveQuotesCache` + hook | dead (Task 3) | `TW:16`, `TW:66`, `TW:117`, handler `CRQ:284`, processor |
| `CashuReceiveQuoteCache` + `.updated` `updateIfExists` + sweep `TW:116` | **kept** | `useTrackCashuReceiveQuote` → `apps/web-wallet/app/features/receive/receive-cashu.tsx:46`, `apps/web-wallet/app/features/buy/buy-checkout.tsx:225` (navigation on COMPLETED) |
| `UnresolvedCashuSendQuotesCache`, hook, `useCashuSendQuoteChangeHandlers` | dead (Task 4) | `TW:28-29`, `TW:56`, `TW:68`, `TW:119` |
| `PendingSparkReceiveQuotesCache` + hook | dead (Task 5) | `TW:23`, `TW:73`, `TW:124`, handler `SRQ:216` |
| `SparkReceiveQuoteCache` + `.updated` `updateIfExists` + sweep `TW:123` | **kept** | `useTrackSparkReceiveQuote` → `apps/web-wallet/app/features/receive/receive-spark.tsx:50`, `buy-checkout.tsx:255` |
| `UnresolvedSparkSendQuotesCache`, hook, `useSparkSendQuoteChangeHandlers` | dead (Task 6) | `TW:37-38`, `TW:60`, `TW:74`, `TW:125` |
| `useSelectItemsWithOnlineAccount` (`AH:490`) | dead (Task 6) | last consumers `SSQ:123`, `SRQ:234`, `CSQ:194`, `CSS:200`, `CRQ:308`, `CRS:114` |
| `useGetCashuAccountByMintUrlAndCurrency` (`AH:381`) | dead (Task 5) | consumers `CRQ:598`, `CSQ:256`, `SRQ:463` only |
| `useGetSparkAccount` (`AH:402`) | dead (Task 6) | consumers `SRQ:351`, `SSQ:162`, `SSQ:398` only |
| `useCashuReceiveSwapService` (`CRS:41`) | **kept** | `CSS:45` builds the send-swap service, still used by `apps/web-wallet/app/features/transactions/transaction-hooks.ts:233` |
| `useCashuReceiveQuoteRepository`, `useCashuReceiveSwapRepository`, `useCashuSendQuoteRepository`, `useCashuSendSwapRepository` | **kept** | `apps/web-wallet/app/features/transactions/transaction-additional-details.tsx:19-22` |
| `useCashuReceiveQuoteService` (`CRQ:75`), `useCashuSendQuoteService`, `useSparkReceiveQuoteService` (`SRQ:47`), `useSparkReceiveQuoteRepository` (`SRQ:42`), `useSparkSendQuoteService` (`SSQ:38`), `useSparkSendQuoteRepository` (`SSQ:33`) | dead (Tasks 3, 4, 5, 6) | processor-only |
| `MINTM` file | dead (Task 3) | `CRQ:43`, `CRQ:430` only |
| `MELT`, `MELTM` files | dead (Task 5) | `CRQ:42`, `CSQ:28-29`, `SRQ:29`: all processors |

The sweep shrinks from 13 to 7 invalidates: accounts, transactions, cashu
receive quote, cashu send swap, contacts, spark receive quote, user.

Handler-map compile check (X12): `TW` hoists the 19-event union into
`type FeedEvent = …` and adds `type SagaOnlyEvent = …`. The map is
`satisfies WalletChangeHandlers<Exclude<FeedEvent, SagaOnlyEvent>>`. Every
feed event is then either handled or explicitly listed as saga-only, still
checked at compile time. Final `SagaOnlyEvent`: `cashu-receive-swap.created`,
`cashu-receive-swap.updated`, `cashu-send-swap.created`,
`cashu-receive-quote.created`, `cashu-send-quote.created`,
`cashu-send-quote.updated`, `spark-receive-quote.created`,
`spark-send-quote.created`, `spark-send-quote.updated`.

### C.8 `temporary.ts` exports that die

| Export | Line | Dies in | Canary |
|---|---|---|---|
| `ProofStateSubscriptionManager` | `TMP:134` | Task 2 | `grep -rn "ProofStateSubscriptionManager" apps` → no output |
| `CashuReceiveQuoteService` | `TMP:119` | Task 3 | `grep -rn "CashuReceiveQuoteService" apps` → no output |
| `CashuSendQuoteService` | `TMP:126` | Task 4 | `grep -rn "CashuSendQuoteService" apps` → no output |
| `getInitializedCashuWallet` | `TMP:61` | Task 5 | `grep -rn "getInitializedCashuWallet" apps` → no output |
| `SparkReceiveQuoteRepository`, `SparkReceiveQuoteService` | `TMP:116-117` | Task 5 | `grep -rn "SparkReceiveQuoteRepository\|SparkReceiveQuoteService" apps` → no output |
| `SparkSendQuoteRepository`, `SparkSendQuoteService` | `TMP:131-132` | Task 6 | `grep -rn "SparkSendQuoteRepository\|SparkSendQuoteService" apps` → no output |

Kept: `CashuReceiveQuoteRepository`, `CashuReceiveSwapRepository`,
`CashuReceiveSwapService`, `CashuSendQuoteRepository`, `CashuSendSwapRepository`,
`CashuSendSwapService` (UI consumers in C.7), and `sparkDebugLog` via
`TMP:41` (`AH:15`, `apps/web-wallet/app/features/wallet/use-track-spark-account-balances.ts:3`).

### C.9 The serial queue outlives a stint

**Decision:** one `KeyedSerialQueue` per runtime instance. Jobs are fenced by
their own stint's scope. Master's scope queue lives in the tab's
`MutationCache`, so a remounted `TaskProcessor` (lead lost, then regained)
queues behind the old tab's in-flight mutation on the same scope id. A
per-stint queue would let a new stint run `completeReceive` on the same quote
while the old stint's call is still in flight. **Rejected:** per-stint queue.

### C.10 Abandon, not park

**Decision:** B.6. A retry that ends while the host is inactive is abandoned.
The stint's `onActivated` reload re-triggers every pending item. This is the
18.1 rule (`:192`). Master paused the continuation (X8). The observable
difference: master resumed the paused attempt with its retry count, and the
SDK restarts with a fresh budget.

### C.11 Scope strings

**Decision:** keep master's keys, except spark receive. All spark receive
actions use one key, `` `spark-receive-quote-${id}` ``, which replaces the
three strings in PR13. Effect: complete, expire, fail, initiateMelt and
markMeltInitiated on one quote never overlap. Safe because serializing only
removes interleavings, and each attempt re-reads its guard. The cashu send
quote split (SQ13) is kept on purpose. Merging it would block
`markSendQuoteAsPending` and `completeSendQuote` behind a melt that waits for
the payment.

### C.12 Mint-quote polling interval

**Decision:** poll every 10 s, and 60 s after a check that failed with
`HttpResponseError` status 429. Master's 60 s branch is unreachable (RQ10).
The SDK applies the intent. Delta: fewer requests to a mint that is rate
limiting. Polls run while hidden, like `refetchIntervalInBackground: true`.

## D. Tasks

Each task is one commit. File maps list exact paths. Tests use `bun:test`, no
network, no Supabase, no Breez, no mint. Shared test kit:
`packages/wallet-sdk/domain/wallet/task-saga-test-kit.ts` (Task 0, test-only,
imported only by `*.test.ts`):

- `createRecordingClock()`: same shape as `task-processor-runtime.test.ts:62`
  (`function createRecordingClock(): ScopeClock & {`). Timers fire only when
  the test fires them.
- `createFakeActivity(initial)`: same shape as `task-processor-runtime.test.ts:92`.
- `createTestStint(options)`: a real `createSagaStint` over a real
  `WalletEventEmitter(nullLogger)`, the recording clock, a fake activity, a
  recording logger, a settable `now`, and a `loadAccounts` fake that records
  its calls.
- `deferred<T>()`: `{ promise, resolve, reject }`.
- `flush()`: `await` a few microtask turns.

Fixtures use ids like `'quote-1'`, `'swap-1'`, `'account-1'`. Never a real
token, invoice or preimage. Use `'preimage-fixture'`-style placeholders.

### Task 0 — shared runtime and stint wiring (no flow)

**Create**

- `packages/wallet-sdk/domain/wallet/task-saga.ts`: B.2-B.7 exactly.
- `packages/wallet-sdk/domain/wallet/task-saga.test.ts`.
- `packages/wallet-sdk/domain/wallet/task-saga-test-kit.ts`.
- `packages/wallet-sdk/domain/wallet/task-sagas.ts`: `createTaskSagas`
  returning `[]`.

**Modify**

- `packages/wallet-sdk/domain/wallet/task-processor-runtime.ts`: B.1. Import
  `type { Account }`, `type { SagaEventBus, TaskSaga }`, and
  `createKeyedSerialQueue`, `createSagaStint`. Default `now` is
  `() => Date.now()`. Update the class JSDoc paragraph (`:57-74`) with one
  sentence: while leader, the runtime runs the task sagas in a stint scope
  that dies when the lead does.
- `packages/wallet-sdk/domain/wallet/task-processor-runtime.test.ts`: the
  harness (`:120-171`, `function createHarness(options?: {`) passes
  `sagas: options?.sagas ?? []`, a `walletEvents` over a real
  `WalletEventEmitter(nullLogger)`, and a `loadAccounts` fake. The 16
  existing tests stay unchanged.
- `packages/wallet-sdk/domain/sdk/sdk.ts`: move the `createTaskProcessor`
  call (`:181-188`) below `createAccountsApi` (`:194-199`). The `let
  taskProcessor` binding (`:119`) is unchanged, and `onSessionEnded` still
  reads it lazily. Add:

```ts
taskProcessor = createTaskProcessor({
  db,
  getSession: getLiveSession,
  activity: config.activity,
  emit: (payload) => events.emit('task-processor.state-changed', payload),
  logger: config.logger,
  walletEvents: {
    on: (event, handler) => events.on(event, handler),
    emit: (message) => events.emit(message.event, message.payload as never),
  },
  loadAccounts: async (userId, signal) =>
    (await accounts.getRepository()).getAllActive(userId, {
      abortSignal: signal,
    }),
  sagas: createTaskSagas({
    db,
    keys,
    getAccountRepository: accounts.getRepository,
  }),
});
```

The `as never` cast is the form 18.3 pinned for the feed (`sdk.ts:216`
"`emit: (message) => events.emit(message.event, message.payload as never),`").

**Tests** (`task-saga.test.ts` unless noted):

- **(a) FIFO per key.** Enqueue jobs A1, A2, A3 on `'k'` and B1 on `'l'`,
  each a deferred. Only A1 and B1 have started. Resolve A1 → A2 starts, A3
  has not. Reject A2 → A3 starts (a failure does not break the chain).
- **(b) Every enqueue runs once.** The same job function enqueued twice on
  `'k'` is called twice, in order.
- **(c) Dead scope skips; the queue spans stints.** Under stint scope S1,
  enqueue a hung J1 and a queued J2 on `'k'`. Cancel S1. Under S2, enqueue J3
  on `'k'`. J2 and J3 have not started. Resolve J1 → J2 is never called, J3
  starts.
- **(d) Unkeyed runs at once** while a keyed job on any key is pending.
- **(e) `retry: 3` counts and delays.** The attempt always rejects. Attempt
  count goes 1, then the recorded timeout is `1000`; fire → 2 attempts, then
  `2000`; fire → 3, `4000`; fire → 4 attempts. The outcome is
  `{ status: 'failed', error }` with `toBe` the last error. No fifth attempt.
- **(f) Predicate.** Retry predicate records its arguments; it returns
  `failureCount < 1` for a plain error and `false` for an error tagged
  `'fatal'`. The plain error path calls it with `(0, error)` and `(1, error)`.
  The fatal path makes 1 attempt and arms no timer.
- **(g) Cap.** `retry: 6`: the recorded delays are `1000, 2000, 4000, 8000,
  16000, 30000`.
- **(h) Abandon while inactive.** First attempt rejects; set activity
  inactive; fire the `1000` delay → `{ status: 'abandoned' }`, 1 attempt.
- **(i) Abandon on cancel.** Cancel the scope during the backoff → `abandoned`,
  1 attempt, no timer left armed.
- **(j) First attempt ignores activity.** Activity inactive; `runWithRetry`
  calls the attempt once.
- **(k) Working set: version gate, removal, tombstone.** `apply(v2)` then
  `apply(v1)` → still v2. `apply(v3 terminal)` → removed. `apply(v2 pending)`
  → ignored (tombstone). `apply(v4 pending)` → added. `.updated` for an
  unknown pending key adds it.
- **(l) Reconcile.** Start a load (deferred). During it, apply `x@v5` (newer)
  and create `y@v1`. Resolve the load with `[x@v4, z@v1]` → the set is
  `x@v5, y@v1, z@v1`. A second load resolving `[z@v1]` → `x` and `y` are gone
  (applied before that load started).
- **(m) Reload triggers.** `startWorkingSet` loads once. A replayed
  `connection.changed: 'connected'` emitted *before* the stint subscribed
  does not load again. Emit `'connected'` → 2 loads. Activity false → true
  → 3 loads. Activity true → true (no change) → still 3.
- **(n) Coalescing.** Three triggers during one in-flight load → exactly one
  more load after it.
- **(o) Load failure.** The load rejects 4 times (delays `1000, 2000, 4000`)
  → warn `'Failed to load pending tasks'` with `{ saga: 'test', cause }`;
  items unchanged; `onChange` not called.
- **(p) Accounts.** No `loadAccounts` call until the first `get`. Two
  concurrent `get`s → 1 call. `apply(account@v2)` replaces `@v1`; `apply(@v1)`
  after `@v2` is ignored. `markStale()` then `get` → 2 calls. `'connected'`
  marks stale. `getCashu` for a spark id throws.
- **(q) `delayUntil`.** `now` = 0, `at` = `2 ** 31 + 10` → first timeout is
  `2 ** 31 - 1`; fire; second is `11`. `at` in the past → resolves without a
  timer. Cancel mid-wait → resolves early.
- **(r) Emit fence.** After the stint scope is cancelled, `stint.emit(...)`
  dispatches nothing.

`task-processor-runtime.test.ts` additions:

- **(s) Stint on lead.** Two recording sagas. Become leader → each `start`
  was called once with the same stint, `stint.userId === 'user-1'`, and
  `stint.scope.alive`. A renewal `true` → no second `start`. Yield (`false`)
  → `stint.scope.alive` is false and `stint.scope.signal.aborted` is true.
  Lead again → a new stint object (`not.toBe`).
- **(t) `stop()` joins saga work.** A saga tracks a deferred. `const p = stop()`.
  `p` is pending after a flush. Resolve the deferred → `p` resolves; both
  `5000` timers armed by `stop()` have been cancelled.
- **(u) `stop()` bound.** A saga tracks a promise that never settles. `stop()`
  resolves after the test fires the `5000` timers, and `state` is `'stopped'`.
- **(v) A throwing saga.** The first saga's `start` throws → logger error
  `'Task saga failed to start'` with `{ saga: 'first', cause }`; the second
  saga still started.
- **(w) Logged-out lead.** `getSession` flips to logged out between the bid
  and `applyLead` → no stint starts.

**Canary:** `grep -rn "from 'react'\|@tanstack" packages/wallet-sdk/domain/wallet/task-saga.ts packages/wallet-sdk/domain/wallet/task-sagas.ts` → no output.
`grep -rn "console\." packages/wallet-sdk/domain/wallet/task-saga.ts` → no output.
`git diff --stat master -- apps` → empty.

### Task 1 — cashu receive swap

**Create** `packages/wallet-sdk/domain/receive/cashu-receive-swap-saga.ts`,
`packages/wallet-sdk/domain/receive/cashu-receive-swap-saga.test.ts`.

```ts
export type CashuReceiveSwapSagaDeps = {
  getRepository: () => Promise<CashuReceiveSwapRepository>;
  getService: () => Promise<CashuReceiveSwapService>;
};

export function createCashuReceiveSwapSaga(
  deps: CashuReceiveSwapSagaDeps,
): TaskSaga;
```

Behavior (name `'cashu-receive-swap'`):

- Working set: `keyOf: (swap) => swap.tokenHash` (RS3); `isPending: (swap) => swap.state === 'PENDING'`
  (RS6); `load: (signal) => repository.getPending(stint.userId, { abortSignal: signal })`
  (RS1). Subscriptions: `cashu-receive-swap.created` and `.updated` →
  `set.apply(payload.swap)` (RS5, RS6).
- `onChange` → `void sync()` (single-flight, coalesced). `sync`: for each
  swap in the set, `account = await stint.accounts.get(swap.accountId)`; skip
  unless `account?.isOnline` (RS8). For each online swap not in
  `triggered: Set<string>`, add it and run `completeSwap` (RS9). Drop keys
  from `triggered` that are no longer in the set, so a returning swap
  re-fires (RS9 `gcTime: 0`).
- Action `completeSwap` (RS10): key `` `receive-swap-${tokenHash}` ``,
  `retry: 3`; `attempt`: `const swap = set.get(tokenHash); if (!swap) return undefined;`
  `const account = await stint.accounts.getCashu(swap.accountId);`
  `return (await deps.getService()).completeSwap(account, swap);`.
  `onSuccess`: `stint.emit({ event: 'cashu-receive-swap.updated', payload: { swap: result.swap } })`.
  `onError`: `stint.logger.error('Error finalizing receive swap', { cause: error, tokenHash })`.
- `createTaskSagas` appends it, with `getRepository` / `getService` built as
  `receive-api.ts:78-93` builds them.

**Web**

- `CRS`: delete `PendingCashuReceiveSwapsCache` (`:46-90`),
  `usePendingCashuReceiveSwapsCache` (`:92`), `usePendingCashuReceiveSwaps`
  (`:111`), `useCashuReceiveSwapChangeHandlers` (`:132`),
  `useProcessCashuReceiveSwapTasks` (`:152` to the end of the function), and
  the imports they alone used (`useQueries`, `useSuspenseQuery`,
  `useGetCashuAccount`, `useSelectItemsWithOnlineAccount`,
  `WalletChangeHandlers`, if unused after). Keep
  `useCashuReceiveSwapRepository` (`:31`), `useCashuReceiveSwapService`
  (`:41`), `useCreateCashuReceiveSwap` (`:100`).
- `TW`: remove the import (`:18-21`), `cashuReceiveSwapChangeHandlers`
  (`:55`, `:81`), `pendingCashuReceiveSwapsCache` (`:67`, `:118`). Introduce
  `FeedEvent` and `SagaOnlyEvent` (C.7) with `SagaOnlyEvent =
  'cashu-receive-swap.created' | 'cashu-receive-swap.updated'`.
- `TP`: remove `CRS` import (`:5`) and call (`:86`).

**Tests** (`cashu-receive-swap-saga.test.ts`; fake repository and service
objects record calls):

- **(a)** Stint start loads `getPending('user-1', { abortSignal })` once.
- **(b)** Online filter: swaps on an offline and an online account →
  `completeSwap` called for the online one only. An `account.updated` that
  flips the offline account online → called for the other one.
- **(c)** Once per membership: a second `.updated` with a newer PENDING
  version → no second call. `.updated` COMPLETED, then `.created` PENDING with
  a new tokenHash → called for the new one. Same tokenHash after a reload
  where it disappeared and returned → called again.
- **(d)** Retry: `completeSwap` rejects 4 times → 4 calls, delays `1000,
  2000, 4000`, then `logger.error('Error finalizing receive swap', { cause, tokenHash: 'hash-1' })`.
- **(e)** Guard per attempt: first attempt rejects; a `.updated` COMPLETED
  arrives during the backoff; fire the delay → no second service call.
- **(f)** Success emits `cashu-receive-swap.updated` with `result.swap` once;
  the set drops it (terminal); the realtime echo of the same version changes
  nothing.
- **(g)** Lead loss: the stint is cancelled while `completeSwap` is pending →
  no emit after it resolves; the service call was not passed a signal.
- **(h)** Reload on `'connected'` and on activation (2 more `getPending`).

**Canary**

- `grep -rn "useProcessCashuReceiveSwapTasks\|PendingCashuReceiveSwapsCache\|pending-cashu-receive-swaps\|complete-cashu-receive-swap" apps` → no output.
- `grep -n "useProcess" apps/web-wallet/app/features/wallet/task-processing.ts` → five lines.

### Task 2 — cashu send swap

**Create** `packages/wallet-sdk/domain/send/cashu-send-swap-saga.ts` and its
test.

```ts
export type CashuSendSwapSagaDeps = {
  getRepository: () => Promise<CashuSendSwapRepository>;
  getService: () => Promise<CashuSendSwapService>;
  /** Test seam; defaults to `new ProofStateSubscriptionManager(logger)`. */
  createProofStateManager?: (logger: Logger) => ProofStateSubscriptionManager;
};

export function createCashuSendSwapSaga(deps: CashuSendSwapSagaDeps): TaskSaga;
```

**Modify** `PSM`: constructor `constructor(private readonly logger: Logger) {}`;
each `console.debug` / `console.error` → `this.logger.debug` /
`this.logger.error`, same message and meta; add `unsubscribeAll(): void`
(awaits nothing: for each entry, `void entry.subscriptionPromise.then((u) => u(), () => undefined)`,
then clear the map). Do not touch `handleProofStateUpdate` logic.

Behavior (name `'cashu-send-swap'`):

- Working set: key `id`; pending DRAFT or PENDING (SS1, SS6); `load:
  getUnresolved(userId, { abortSignal })`; `.created` / `.updated` → apply.
- `sync` (online filter as Task 1):
  - DRAFT, once per membership (SS8): action `swapForProofsToSend`, key
    `` `send-swap-${id}` ``, `retry: 3`; `attempt` re-reads `set.get(id)` and
    returns undefined unless it is still DRAFT and its account is online
    (master's guard read the filtered draft list, SS11); then
    `getCashu(accountId)` and `service.swapForProofsToSend({ swap, account })`.
    `onError` `'Error swapping for proofs to send'` `{ cause, swapId }`.
  - PENDING: group by `(await stint.accounts.getCashu(swap.accountId)).mintUrl`;
    for each mint, `runWithRetry(stint, () => manager.subscribe({ mintUrl, swaps, onSpent }), 5)`
    tracked on the scope, unkeyed (SS9). On `failed`:
    `logger.error('Failed to subscribe to proof state updates', { cause, mintUrl })`.
    `onSpent(swap)` → action `completeSwap`, key `` `send-swap-${swap.id}` ``,
    `retry: 3`, `attempt` re-reads PENDING, `service.complete(swap)`;
    `onError` `'Error completing send swap'` `{ cause, swapId }`. No emit
    (SS13).
- The manager is created once per stint; `scope.onCleanup(() => manager.unsubscribeAll())`.

**Web**

- `CSS`: delete `UnresolvedCashuSendSwapsCache` (`:82`),
  `useUnresolvedCashuSendSwapsCache` (`:119`), `useUnresolvedCashuSendSwaps`
  (`:197`), `useOnProofStateChange` and its props type (`:331`),
  `useProcessCashuSendSwapTasks` (`:396`), and the
  `ProofStateSubscriptionManager` import. `useCashuSendSwapChangeHandlers`
  (`:374`) becomes:

```ts
export function useCashuSendSwapChangeHandlers(): WalletChangeHandlers<'cashu-send-swap.updated'> {
  const cashuSendSwapCache = useCashuSendSwapCache();
  return {
    'cashu-send-swap.updated': ({ swap }) => {
      cashuSendSwapCache.updateIfExists(swap);
    },
  };
}
```

- `TW`: drop `useUnresolvedCashuSendSwapsCache` (`:34`, `:70`, `:121`); add
  `'cashu-send-swap.created'` to `SagaOnlyEvent`.
- `TP`: remove `:8` and `:88`.
- `TMP:134`: delete the `ProofStateSubscriptionManager` export.

**Tests:** (a) load; (b) DRAFT triggers once per membership, offline account
skipped; (c) DRAFT guard: a `.updated` PENDING before the job runs → no
service call; (d) PENDING subscribes per mint with all swaps of that mint
(two mints → two `subscribe` calls); a newly added PENDING swap on the same
mint → `subscribe` again with the larger list; (e) subscribe rejects 6 times
→ delays `1000…16000`, then the error log with `mintUrl`; (f) `onSpent` →
`complete` on key `send-swap-<id>`; a DRAFT action in flight on the same id
delays it (FIFO); (g) stint end calls `unsubscribeAll` once; (h) retry and
log for both actions. `PSM` itself gets no unit test (it calls
`getCashuWallet` directly); the canary below covers its logger switch.

**Canary**

- `grep -rn "ProofStateSubscriptionManager" apps` → no output.
- `grep -rn "unresolved-cashu-send-swaps\|trigger-send-swap\|useProcessCashuSendSwapTasks" apps` → no output.
- `grep -rn "cashuSendSwapCache.invalidate()" apps` → one hit, in `TW`.
- `grep -n "console\." packages/wallet-sdk/domain/send/proof-state-subscription-manager.ts` → no output.

### Task 3 — cashu receive quote

**Create**

- `packages/wallet-sdk/lib/mint-quote-subscription-manager.ts` (from `MINTM`,
  logger injected, `unsubscribeAll` added).
- `packages/wallet-sdk/lib/melt-quote-subscription-manager.ts` (from `MELTM`,
  same changes; keep `removeQuoteFromSubscription`; the positional debug
  `('Unsubscribing from melt quote updates for mint', mintUrl)` at `MELTM:52`
  becomes `{ mintUrl }`).
- `packages/wallet-sdk/domain/wallet/quote-trackers.ts` (B.9) and its test.
- `packages/wallet-sdk/domain/receive/cashu-receive-quote-saga.ts` and its test.

```ts
export type CashuReceiveQuoteSagaDeps = {
  getRepository: () => Promise<CashuReceiveQuoteRepository>;
  getService: () => Promise<CashuReceiveQuoteService>;
  /** Test seam; defaults to `getInitializedCashuWallet` from lib/cashu. */
  initCashuWallet?: typeof getInitializedCashuWallet;
  /** Test seam; defaults to `getCashuWallet` from @agicash/cashu. */
  getCashuWallet?: (mintUrl: string) => ExtendedCashuWallet;
  /** Test seam; defaults to new managers with the stint logger. */
  createMintManager?: (logger: Logger) => MintQuoteSubscriptionManager;
  createMeltManager?: (logger: Logger) => MeltQuoteSubscriptionManager;
};
```

**Melt tracker** (`createMeltQuoteTracker`, RQ12): `sync(quotes)` groups by
`mintUrl` and calls `runWithRetry(() => manager.subscribe({ mintUrl, quoteIds, onUpdate }), 5)`
per mint; failure logs `'Error subscribing to melt quote updates'`
`{ mintUrl, cause }`. `onUpdate(meltQuote)` → `handle(meltQuote, false)`.
Each quote gets one expiry timer: `delayUntil(stint, quote.expiryInMs)`, then
`(await getWallet(...)).checkMeltQuoteBolt11(quote.id)` → `handle(meltQuote, true)`;
a throw logs `'Error checking melt quote upon expiration'` `{ cause }`.
`handle` (from `MELT:53-94`): debug `` `Melt quote state changed: ${meltQuote.state}` ``;
unknown id → return; UNPAID before expiry → `onUnpaid`; UNPAID at or after
expiry and `handleExpiry` → `onExpired`; PENDING → `onPending`; PAID → when
`inputAmount > meltQuote.amount` and the change is empty, re-check the quote
(nutshell#788) and pass the re-checked quote to `onPaid`, else pass it as is.

**Mint tracker** (`createMintQuoteTracker`, RQ7-RQ11): `sync(quotes)` resolves
each quote's account. The mint supports websockets when
`account.wallet.getMintInfo().isSupported(17)` has a `bolt11` entry for the
account's currency with `bolt11_mint_quote` (`CRQ:344-360`).
- Websocket mints: `runWithRetry(() => manager.subscribe({ mintUrl, quoteIds, onUpdate }), 5)`,
  failure log `'Error subscribing to mint quote updates'` `{ mintUrl, cause }`.
  UNPAID quotes get an expiry timer: `delayUntil(expiresAt)`, then
  `withRetry({ fn: () => account.wallet.checkMintQuoteBolt11(quote.quoteId), retry: 5 })`
  (`@agicash/utils`, RQ9) → `onUpdate`; error `'Error checking mint quote upon expiration'`.
- Polling mints: one loop per quote id (`polling: Set<string>`), tracked:
  `while (scope.alive && quote still in the set)`: check; on success
  `onUpdate`; on error warn `'Error checking mint quote'` `{ cause, quoteId }`;
  then `scope.delay(is429 ? 60_000 : 10_000)` (C.12).

Saga behavior (name `'cashu-receive-quote'`):

- Working set: key `id`; pending UNPAID or PAID (RQ5); `getPending`.
  `.created` / `.updated` → apply.
- `sync`: online items only. Mint tracker over all of them. Melt tracker
  over `type === 'CASHU_TOKEN'`, mapped as `CRQ:323-342`. `getWallet` =
  `(await stint.accounts.findCashu(mintUrl, currency))?.wallet ?? getCashuWallet(mintUrl)`
  (`CRQ:790-795`).
- `processMintQuote` (RQ11): find by `quoteId` in the set; missing → warn
  `'No related receive quote found for the mint quote'`; debug
  `` `Mint quote state changed: ${state}` `` `{ receiveQuoteId, unit }`;
  UNPAID and expired → `expire`; PAID or ISSUED → `complete`.
- Melt handlers (RQ13): `onUnpaid` → `meltInitiated` ? `fail('Cashu token melt failed.')`
  : `initiateMelt`; `onPending` → `markMeltInitiated`; `onExpired` → `expire`.
- Actions, all keyed `` `cashu-receive-quote-${id}` ``:
  - `complete` (RQ14): `retry: 3`; guard `set.get(id)`;
    `service.completeReceive(await accounts.getCashu(quote.accountId), quote)`;
    `onSuccess` emit `cashu-receive-quote.updated` with `result.quote`;
    error `'Complete cashu receive quote error'` `{ cause, receiveQuoteId }`.
  - `expire` (RQ15), `fail` (RQ16): `retry: 3`; logs as master.
  - `initiateMelt` (RQ17): retry predicate `(n, e) => !(e instanceof MintOperationError) && n < 3`;
    source wallet from `findCashu`, else `initCashuWallet({ mintUrl, currency })`
    and `throw new NetworkError('Source mint is offline')` when offline;
    `sourceWallet.meltProofsIdempotent({ quote: meltQuoteId, amount }, tokenProofs, undefined, { type: 'random' })`.
    `onError`: `MintOperationError` → warn `'Failed to initiate melt.'` and
    run `fail` with `error.message` on the same key; else error
    `'Initiate melt error'`.
  - `markMeltInitiated` (RQ18): `retry: 3`; emit `.updated`.

**Web**

- `CRQ`: delete `useCashuReceiveQuoteService` (`:75`),
  `PendingCashuReceiveQuotesCache` (`:114-175`), `usePendingCashuReceiveQuotesCache`
  (`:177`), `usePendingCashuReceiveQuotes` (`:304`), `usePendingMeltQuotes`
  (`:323`), `checkIfMintSupportsWebSocketsForMintQuotes` (`:344`),
  `useTrackMintQuotesWithPolling` (`:370`), `useTrackMintQuotesWithWebSocket`
  (`:424`), `usePartitionQuotesByStateCheckType` (`:498`),
  `useOnMintQuoteStateChange` (`:537`), `useProcessCashuReceiveQuoteTasks`
  (`:592` to its end), and the imports only they used. Add
  `get(quoteId)` to `CashuReceiveQuoteCache`. The handler becomes:

```ts
export function useCashuReceiveQuoteChangeHandlers(): WalletChangeHandlers<'cashu-receive-quote.updated'> {
  const cashuReceiveQuoteCache = useCashuReceiveQuoteCache();
  const transactionsCache = useTransactionsCache();

  return {
    'cashu-receive-quote.updated': ({ quote }) => {
      const tracked = cashuReceiveQuoteCache.get(quote.id);
      if (
        tracked &&
        tracked.version < quote.version &&
        quote.state === 'COMPLETED'
      ) {
        // Updating the quote navigates to the transaction page; refetch the
        // transaction now so the page does not show the cached DRAFT row while
        // the transaction's own realtime update is delayed.
        transactionsCache.invalidateTransaction(quote.transactionId);
      }
      cashuReceiveQuoteCache.updateIfExists(quote);
    },
  };
}
```

- Delete `MINTM`.
- `TW`: drop `usePendingCashuReceiveQuotesCache` (`:16`, `:66`, `:117`); add
  `'cashu-receive-quote.created'` to `SagaOnlyEvent`.
- `TP`: remove `:4` and `:85`.
- `TMP:119`: delete `CashuReceiveQuoteService`.

**Tests** (`quote-trackers.test.ts`): (a) melt subscribe per mint, retry 5
and log; (b) melt UNPAID before expiry → `onUnpaid`; UNPAID from the socket
after expiry → nothing; the expiry timer fires → check → `onExpired`;
(c) PAID with expected change and an empty `change` → one re-check, `onPaid`
gets the re-checked quote; with change present → no re-check; (d) one timer
per quote across repeated `sync`; a quote removed before its timer fires →
no check; (e) mint split: a NUT-17 mint subscribes, a non-NUT-17 mint polls;
(f) poll cadence `10000`, and `60000` after a 429 `HttpResponseError`, back
to `10000` after a success; a poll loop exits when its quote leaves;
(g) expiry recheck uses `withRetry` with `retry: 5`.

(`cashu-receive-quote-saga.test.ts`): (h) mint PAID → `completeReceive`
with the account from `getCashu`; ISSUED → also complete; (i) UNPAID past
expiry → `expire`; (j) two triggers on one quote run FIFO on
`cashu-receive-quote-<id>`; (k) `complete` success emits `.updated`, removes
it from the set, a late PAID echo (older version) does not re-add it;
(l) `initiateMelt` with `MintOperationError` → 1 attempt, warn, then `fail`
on the same key with the error message; a plain error → 4 attempts and the
error log; (m) no source account and an offline mint → `NetworkError`
retried like a plain error; (n) melt PENDING → `markMeltInitiated`, emit;
(o) `meltInitiated` quote UNPAID → `fail('Cashu token melt failed.')`;
(p) stint end unsubscribes both managers and stops polling loops (no check
after cancel); (q) mint state for an unknown quote id → warn.

**Canary**

- `grep -rn "mint-quote-subscription-manager\|useProcessCashuReceiveQuoteTasks\|pending-cashu-receive-quotes\|'mint-quote'" apps` → no output.
- `grep -rn "console\." packages/wallet-sdk/lib/mint-quote-subscription-manager.ts packages/wallet-sdk/lib/melt-quote-subscription-manager.ts packages/wallet-sdk/domain/wallet/quote-trackers.ts` → no output.

### Task 4 — cashu send quote

**Create** `packages/wallet-sdk/domain/send/cashu-send-quote-saga.ts` and its
test. Deps: `getRepository`, `getService`, `getCashuWallet?`, `createMeltManager?`
(seams as Task 3).

Behavior (name `'cashu-send-quote'`):

- Working set: key `id`; pending UNPAID or PENDING; `getUnresolved`.
- `sync`: online items; map each to a `MeltQuoteInput` (SQ3); a missing
  account logs `'Cashu account not found for send quote'` `{ sendQuoteId }`
  as an error and skips that quote (master threw to the boundary). The saga
  owns its melt manager (SQ6); `getWallet` as `CSQ:431-436`.
- Dispatch (SQ7): each handler first finds the quote by `quoteId` (the melt
  id); `onUnpaid` acts only when `quote.state === 'UNPAID'`.
- Actions:
  - `initiateSend`: key `` `initiate-cashu-send-quote-${id}` `` (SQ13);
    predicate `!(e instanceof MintOperationError) && n < 3`;
    `service.initiateSend(account, quote, meltQuote)`. `onError`:
    `MintOperationError` → warn `'Failed to initiate send.'` `{ cause, sendQuoteId }`
    and run `failSendQuote` **unkeyed**; else error `'Initiate send error'`.
  - `failSendQuote`: key `undefined` (SQ8); `retry: 3`;
    `service.failSendQuote(account, quote, reason)`; `onSuccess`:
    `meltManager.removeQuoteFromSubscription({ mintUrl: account.mintUrl, quoteId: failed.quoteId })`
    and emit `cashu-send-quote.updated`; error `'Failed to mark payment as failed'`.
  - `markSendQuoteAsPending`, `expireSendQuote`, `completeSendQuote`: key
    `` `cashu-send-quote-${id}` ``, `retry: 3`, master's logs. Pending and
    complete emit `.updated`. For `completeSendQuote` log meta, use
    `{ cause, sendQuoteId: quote.id }` (master logged the variables object
    under that key; the SDK logs the id).

**Web**

- `CSQ`: delete `UnresolvedCashuSendQuotesCache` (`:53`), its hook,
  `useUnresolvedCashuSendQuotes` (`:191`), `usePendingMeltQuotes` (`:209`),
  `useCashuSendQuoteChangeHandlers` (`:232`), `useProcessCashuSendQuoteTasks`
  (`:251`), `useCashuSendQuoteService`, and the imports of `MELT`, `MELTM`,
  `useGetCashuAccount`, `useGetCashuAccountByMintUrlAndCurrency`,
  `useSelectItemsWithOnlineAccount` when unused after.
- `TW`: drop `useCashuSendQuoteChangeHandlers` and
  `useUnresolvedCashuSendQuotesCache` (`:27-30`, `:56`, `:68`, `:82`, `:119`);
  add both `cashu-send-quote.*` events to `SagaOnlyEvent`.
- `TP`: remove `:7` and `:87`.
- `TMP:126`: delete `CashuSendQuoteService`.

**Tests:** (a) UNPAID socket update → `initiateSend` on the initiate key;
(b) while `initiateSend` is pending, a PENDING update runs
`markSendQuoteAsPending` at once (different key), and a PAID update runs
`completeSendQuote` after it (same key as pending: FIFO); (c)
`MintOperationError` → warn, unkeyed `failSendQuote`, then
`removeQuoteFromSubscription` with `{ mintUrl, quoteId }`; (d) a plain error
→ 4 attempts and `'Initiate send error'`; (e) expiry timer → `expireSendQuote`;
(f) missing account → error log, no tracker for that quote, others proceed;
(g) PAID with change → `completeSendQuote` gets the re-checked melt quote;
(h) emits on pending, complete and fail; none on expire.

**Canary:** `grep -rn "unresolved-cashu-send-quotes\|useProcessCashuSendQuoteTasks\|CashuSendQuoteService" apps` → no output.

### Task 5 — spark receive quote

**Create** `packages/wallet-sdk/domain/receive/spark-receive-quote-saga.ts`
and its test. Deps: `getRepository`, `getService`, `initCashuWallet?`,
`getCashuWallet?`, `createMeltManager?`.

Behavior (name `'spark-receive-quote'`):

- Working set: key `id`; pending UNPAID (PR1, PR3); `getPending`.
- `sync`, online items only:
  - **Breez** (PR5): group by `accountId`. For each spark account not yet
    tracked in this stint, `const id = await account.wallet.addEventListener({ onEvent })`,
    tracked; `scope.onCleanup(() => void account.wallet.removeEventListener(id).catch(…warn 'Failed to remove Spark event listener' { listenerId }))`.
    The listener reads the **current** set on each event, so one listener
    per account serves later quotes. `paymentSucceeded` with lightning
    details → match `htlcDetails.paymentHash`; no preimage → error
    `'Receive payment succeeded but no preimage'` `{ paymentId, quoteId }`;
    else `sparkDebugLog('Receive payment detected as completed', { quoteId, accountId, sparkTransferId })`
    and `complete`. `synced` → `expire` every quote of that account past
    `expiresAt`.
  - **Initial check** (PR6): once per quote per stint (`checked: Set<string>`),
    after the listener is registered: `getPaymentByInvoice({ invoice: quote.paymentRequest })`;
    `completed` → same handler; error `'Error checking initial receive payment'`
    `{ cause, accountId, quoteId }`.
  - **Melt** (PR7): melt tracker over CASHU_TOKEN quotes, no `onPaid`.
- Actions, all keyed `` `spark-receive-quote-${id}` `` (C.11):
  - `complete` (PR8): `retry: 3`; `service.complete(quote, paymentPreimage, sparkTransferId)`;
    `onSuccess`: `logger.debug('Receive quote completed', { quoteId, accountId, transactionId })`,
    emit `spark-receive-quote.updated`.
  - `expire`, `fail`, `markMeltInitiated` (emit), `initiateMelt` (PR11, its
    `fail` follow-up on the same unified key).

**Web**

- `SRQ`: delete `useSparkReceiveQuoteRepository` (`:42`),
  `useSparkReceiveQuoteService` (`:47`), the pending cache (`:143` class and
  hook), `usePendingSparkReceiveQuotes` (`:231`), `usePendingMeltQuotes`
  (`:249`), `useOnSparkReceiveStateChange` (`:346`),
  `useProcessSparkReceiveQuoteTasks` (`:459` to its end). Add `get(quoteId)`
  to `SparkReceiveQuoteCache`. `.updated` handler: same shape as Task 3, with
  `quote.state === 'PAID'` (the spark terminal success state,
  `spark-receive-quote-service.ts:99-110`).
- Delete `MELT` and `MELTM`.
- `AH`: delete `useGetCashuAccountByMintUrlAndCurrency` (`:381-396`).
- `TW`: drop `usePendingSparkReceiveQuotesCache` (`:23`, `:73`, `:124`); add
  `'spark-receive-quote.created'` to `SagaOnlyEvent`.
- `TP`: remove `:6` and `:89`.
- `TMP:61`, `TMP:116-117`: delete the three exports.

**Tests:** (a) one listener per spark account across several quotes and
syncs; (b) `paymentSucceeded` matching a quote → `complete` with
`(quote, 'preimage-fixture', 'transfer-1')`; non-lightning or unmatched →
nothing; no preimage → error log; (c) `synced` → `expire` for expired quotes
only; (d) initial check once per quote: a second sync does not re-check;
(e) complete and a melt-path `fail` on the same quote run FIFO on one key;
(f) emit and debug log on success; (g) stint end removes every listener
once; (h) `initiateMelt` `MintOperationError` → `fail` on
`spark-receive-quote-<id>`; (i) an offline spark account → no listener, no
check.

**Canary**

- `grep -rn "melt-quote-subscription\|useOnMeltQuoteStateChange\|MeltQuoteSubscriptionManager" apps` → no output.
- `grep -rn "useGetCashuAccountByMintUrlAndCurrency\|getInitializedCashuWallet\|SparkReceiveQuoteService" apps` → no output.
- `ls apps/web-wallet/app/lib/cashu` → `animated-qr-code` only.

### Task 6 — spark send quote

**Create** `packages/wallet-sdk/domain/send/spark-send-quote-saga.ts` and its
test. Deps: `getRepository`, `getService`.

Behavior (name `'spark-send-quote'`):

- Working set: key `id`; pending UNPAID or PENDING (PS1, PS3);
  `getUnresolved`.
- `lastTriggered: Map<string, SparkSendQuote['state']>` per stint (PS5);
  entries for quotes that left the set are pruned on each sync.
- `sync`, online items only:
  - UNPAID, once per state → `initiateSend`.
  - PENDING: one Breez listener per spark account (as Task 5, matching
    `sparkTransferId`). `paymentSucceeded` and not yet COMPLETED-triggered →
    preimage from lightning details; missing → error
    `'Payment succeeded but no preimage'` `{ paymentId }`; else mark
    COMPLETED, `sparkDebugLog('Send payment detected as completed', { quoteId, accountId })`,
    `complete`. `paymentFailed` and not yet FAILED-triggered → mark FAILED,
    `fail` with `'Lightning invoice expired.'` when `expiresAt` is past, else
    `'Lightning payment failed.'`.
  - Initial `getPayment({ paymentId: sparkTransferId })` once per PENDING
    quote per stint (PS6).
- Actions, key `` `spark-send-quote-${id}` ``, `retry: 3` each:
  - `initiateSend` (PS9): guard `set.get(id)?.state === 'UNPAID'`;
    `service.initiateSend({ account: await accounts.getSpark(quote.accountId), sendQuote: quote })`;
    a `DomainError` is caught inside `attempt`, runs `fail(error.message)` on
    the same key, and returns undefined (not retried, as master). `onSuccess`
    emit. Error `'Initiate spark send quote error'`.
  - `complete` (PS10): guard presence; `service.complete(quote, preimage)`;
    `onSuccess` `logger.debug('Send quote completed', { quoteId, accountId })`,
    emit.
  - `fail` (PS8): `service.fail(quote, reason)`; emit; error
    `'Failed to mark spark send quote as failed'`.
- No per-hook in-flight gate (PS7); see E.

**Web**

- `SSQ`: delete `useSparkSendQuoteRepository` (`:33`),
  `useSparkSendQuoteService` (`:38`), the unresolved cache (`:47`) and hook,
  `useSparkSendQuoteChangeHandlers` (`:102`), `useUnresolvedSparkSendQuotes`
  (`:120`), `useOnSparkSendStateChange` (`:156`),
  `useProcessSparkSendQuoteTasks` (`:394` to its end).
- `AH`: delete `useSelectItemsWithOnlineAccount` (`:490-502`) and
  `useGetSparkAccount` (`:402-404`) when the canary shows no consumer.
- `TW`: drop the spark-send handlers and cache (`:36-39`, `:60`, `:74`,
  `:86`, `:125`); add both `spark-send-quote.*` events to `SagaOnlyEvent`.
- `TP`: remove `:9` and `:90`. `TaskProcessor` now renders `null` with no
  hooks; Task 7 deletes it.
- `TMP:131-132`: delete.

**Tests:** (a) UNPAID → `initiateSend` once; a newer UNPAID version → not
again; (b) two UNPAID quotes in flight concurrently both initiate (no
per-hook gate); (c) `DomainError` → `fail` with its message on the same key,
one attempt; (d) PENDING `paymentSucceeded` → `complete` once even when the
event repeats; (e) `paymentFailed` with past `expiresAt` → reason
`'Lightning invoice expired.'`; (f) initial `getPayment` `failed` → `fail`;
(g) emits for initiate, complete, fail; (h) listener removal at stint end.

**Canary**

- `grep -rn "useSelectItemsWithOnlineAccount\|useGetSparkAccount\|unresolved-spark-send-quotes\|SparkSendQuoteService" apps` → no output.
- `grep -c "useProcess" apps/web-wallet/app/features/wallet/task-processing.ts` → `0`.

### Task 7 — delete `TaskProcessor` and the leader mount

**Modify** `TP`: delete `TaskProcessor` (`:78-92`, including its JSDoc).
`useTaskProcessor` becomes:

```ts
export function useTaskProcessor(): void {
  const userId = useUser((user) => user.id);
  useEffect(() => {
    sdk.taskProcessor.start();
    return () => {
      void sdk.taskProcessor.stop();
    };
  }, [userId]);
  const { state, error } = useSyncExternalStore(
    subscribeTaskProcessor,
    getTaskProcessorSnapshot,
    () => SERVER_SNAPSHOT,
  );
  if (state === 'error') {
    throw error ?? new Error('Task processor entered error');
  }
}
```

Keep `SERVER_SNAPSHOT`, `cached`, `publish`, `subscribeTaskProcessor`,
`getTaskProcessorSnapshot` (`TP:12-52`) as they are. **Modify** `WT`: import
only `useTaskProcessor` (`:7`); replace `:54-63` with `useTaskProcessor();`
and `return children;` (keep the component's return type valid; wrap in a
fragment if the type requires it).

**Tests:** none new (the hook has no logic beyond the 18.1 snapshot). Run
the web unit tests.

**Canary**

- `grep -rn "TaskProcessor\b" apps --include=*.tsx --include=*.ts | grep -v useTaskProcessor` → no output.
- `grep -rn "state === 'leader'" apps` → no output.

### Gates (every task)

| Gate | Command | Expectation |
|---|---|---|
| Install | `bun install --frozen-lockfile` | exit 0 |
| Lint + format | `bun run fix:all` | exit 0; only the task's file map changed |
| Types | `bun run typecheck` | exit 0 |
| Tests | `bun run test` | green; SDK count grows by the task's lettered tests |
| Build | `bun run build` | exit 0 |

## E. Parity table

| Master row | SDK behavior | Same / delta |
|---|---|---|
| X1-X2 processors mount on leader | sagas start on the transition into `'leader'` | same |
| X6 FIFO per scope id, across remounts | `KeyedSerialQueue` on the runtime (C.9) | same |
| X7 delays 1/2/4 s | `runWithRetry` | same |
| X8 paused retry resumes on focus + online | abandoned; reload on activation re-triggers with a fresh budget (C.10) | **delta**: 18.1 rule |
| X9 online filter via memoized `select` | re-evaluated on every sync, with fresh accounts | **delta**: an account that comes online is picked up at the next sync, not only at the next list change |
| RS1/SS1/RQ1/SQ1/PR1/PS1 list query on mount | load at stint start | same |
| RS2… focus / reconnect refetch `'always'` | reload on inactive → active | same under the single activity bit |
| RS7/SS7/RQ6/SQ5/PR4/PS4 sweep | reload on `'connected'` | same |
| List `throwOnError: true` | retry 3, warn, keep items | **delta** (C.4) |
| RS4… `update` only replaces existing | `.updated` adds an unknown pending item | **delta**: a missed `.created` no longer hides the item until the next reload |
| RQ14 `pendingQuotesCache.update(COMPLETED)` kept the item until the echo | removed at once (terminal), tombstoned | **delta**: no behavior change; guards were no-ops on it |
| RS10, SS11, SS12, RQ14-17, SQ8-12, PR8-12, PS8-10 retries and logs | same counts, delays, messages, meta | same, except SQ12 meta (id instead of variables object) |
| `throwOnError: true` on actions | log only | **delta** (C.4) |
| RS9 / SS8 once per membership | `triggered` set per stint | same |
| RQ8 / SQ6 / PR7 / SS9 subscribe `retry: 5` | `runWithRetry(…, 5)` | same |
| RQ8 / SS9 / MELTM never unsubscribed | unsubscribed at stint end | **delta**: no leaked sockets after losing the lead |
| RQ9 / RQ12 timers re-armed per list change | one per quote per stint | same fire times |
| RQ10 10 s, 429 branch dead | 10 s; 60 s after a 429 | **delta** (C.12) |
| PR6 / PS6 initial checks on every list change | once per quote per stint | **delta**: fewer Breez lookups (local for `getPaymentByInvoice`, `SRQ:422` comment) |
| PR13 three scope strings | one key (C.11) | **delta**: stricter serialization |
| PS7 per-hook in-flight gate drops triggers | per-quote dedupe only | **delta**: a second quote's trigger is no longer dropped while the first one's action runs |
| PR11 fail scope `cashu-receive-quote-${id}` | `spark-receive-quote-${id}` | **delta** (C.11) |
| RQ14 / PR8 eager `invalidateTransaction` on the leader | web `.updated` handler, gated by version on the tracked quote | same on the leader; **delta**: the creating follower tab also refetches |
| SS12 `cashuSendSwapCache.invalidate()` | realtime echo → `updateIfExists` | **delta**: the leader's share page updates on the echo, not on a refetch |
| Master UI error boundary on action failure | none | **delta** (C.4) |

### Network-request parity per flow

Steady state (leader tab, nothing changing): identical for every flow. Same
list reads per reload trigger, same mint sockets, same 10 s polls, same Breez
listeners. Follower tabs: master ran no list query for these caches either
(processors unmounted), so 0 = 0.

At leadership acquisition (`n` = pending items of the flow):

| Flow | Master | SDK |
|---|---|---|
| all | 1 list read per flow (6) | 1 list read per flow (6) |
| all (shared, once per stint) | 0 account reads (web cache) | if any item is pending: +1 `accounts` read, +3 mint requests per cashu account, +1 Breez `getInfo` per spark account (C.3); else 0 |
| cashu receive quote | sockets per NUT-17 mint, 1 poll per quote per 10 s | same |
| spark receive quote | `getPaymentByInvoice` × n, again on every list change | × n once |
| spark send quote | `getPayment` × pending, again on every list change | × pending once |
| cashu send swap | 1 proof-state subscribe per mint | same |

After each `'connected'`: master refetched the 6 lists on the leader (sweep).
The SDK reloads the same 6. Accounts: master's sweep refetched the web
accounts list on every tab. The SDK adds one stint account reload on the
leader at the next action (C.3).

## F. Smoke steps and the maintainer live gate

**Local stack:** `bun run dev`, local Supabase, two browser profiles (A and
B) on the same account. Watch the console; the web logger forwards SDK logs to `console.*`.

Cashu flows on testnut (`https://testnut.cashu.space`, FakeWallet):

1. **Receive swap.** In B (follower), paste a testnut token and claim it to
   the Testnut BTC account. Expect A (leader) to log no `'Error finalizing
   receive swap'`, the claim to complete, and B's balance to update from the
   realtime feed.
2. **Send swap.** In B, create a cashu token for 10 sats. A runs
   `swapForProofsToSend` (DRAFT → PENDING). Claim the token in a third
   (logged-out) window. A's proof-state socket fires and the swap completes;
   B's share page shows "claimed" from the `.updated` echo.
3. **Lightning flows on a non-test mint.** Testnut is in `knownTestMints`
   (`packages/cashu/src/utils.ts:319-321`), so `canReceiveFromLightning` and
   `canSendToLightning` are false for it (`packages/wallet-sdk/domain/accounts/account.ts:105-124`).
   Run a local nutshell with `MINT_BACKEND_BOLT11_SAT=FakeWallet` on
   `http://localhost:3338` and add it as a mint. In B, create a lightning
   receive quote (cashu receive quote). FakeWallet marks it paid. A completes
   it; B navigates to the transaction page and shows it as completed (not
   DRAFT). Then send from that account to a fresh invoice from the same mint
   (cashu send quote): A initiates the melt, marks it pending, completes it.
4. **Leader handoff while work is pending.** In A, create a lightning receive
   quote on the FakeWallet mint and stop the mint before it pays. Hide A
   (switch tabs). Within about 11 s, B logs `Taking lead on task processing`.
   Start the mint again. B completes the quote. A, when shown, logs
   `Yielded lead on task processing` and does not complete it again (no
   second `completeReceive` error, one transaction).
5. **Sign-out during an action.** In A (leader) with a pending poll, sign
   out. The poll stops at once (no further `checkMintQuoteBolt11` requests in
   the network tab).

**Maintainer live gate** (mainnet, real funds, only the maintainer can run):

1. Spark receive: a lightning invoice to the Bitcoin (spark) account, paid
   from an external wallet; the leader completes it; the creating tab
   navigates to a completed transaction.
2. Spark send: pay an external invoice from spark; complete. Then an
   expired invoice: fail with `'Lightning invoice expired.'`.
3. Cashu token into spark (CASHU_TOKEN spark receive): claim a mainnet-mint
   token into spark; the melt runs and completes.
4. Cashu token into a different cashu mint (CASHU_TOKEN cashu receive).
5. Cashu lightning send on a mainnet mint with change (the nutshell#788
   re-check path).
6. Leader handoff mid-send: start a spark send in the follower tab, hide the
   leader; the new leader completes it exactly once.

Skip a step and say so if the maintainer lacks the setup; do not block the
slice on it.

## G. Out of scope, and open questions

**Out of scope**

- The host/processing repository split (C.6), the step-19 `/temporary`
  deletion, `ensureBreezWasm` → `sdk.init()`.
- Any `'error'` transition (C.4).
- `account.balance-changed` and the spark balance listener
  (`apps/web-wallet/app/features/wallet/use-track-spark-account-balances.ts`).
- Changing a service signature, an RPC, or the 5 s / 6 s lead cadence.
- Fixing master quirks that this plan keeps for parity: the tautological
  NUT-17 currency check (`CRQ:355` with `CRQ:510-513`), and
  `failSendQuote` running unkeyed (SQ8).

**Open questions**

None that block. One item to confirm during Task 3 by running it, not by
reading: the TanStack retry pause (X8) and default delay (X7) could not be
read at the pin because `node_modules` is not installed in the planning
checkout. Run `grep -n "canContinue\|defaultRetryDelay" node_modules/@tanstack/query-core/build/modern/retryer.js`
after `bun install`. If the pause ignores focus, C.10's delta shrinks to
"offline only"; no code changes, because the SDK abandons on the one
activity bit either way.

## Self-check

The ten claims I am least sure of, and how I checked each.

1. **TanStack retry delay and pause (X7, X8).** I could not read
   `@tanstack/query-core` (no `node_modules`). Evidence: the 18.1 plan pins
   the same delay formula for the lead query (`:72`, `:129`) and describes
   `retryer` `canContinue` (`:64`, `:66`). The runtime code implements it
   (`task-processor-runtime.ts:232`). Listed as the one open check.
2. **Dynamic mutation scope.** I read the patch
   (`patches/@tanstack%2Fquery-core@5.90.20.patch`): `mutate()` builds the
   mutation with `{ ...this.options, scope: options.scope }` when a scope is
   passed. That is what makes `CRQ:769`-style per-call scope ids serialize.
3. **The spark receive scope mismatch (PR13).** Grepped all `scope: { id`
   lines in `SRQ`: `:654`, `:659` use `spark-receive-quote-`; `:683`, `:687`,
   `:698`, `:708` use `spark-receive-quote` with no hyphen; `:615` uses
   `cashu-receive-quote-`.
4. **The 429 branch is dead (RQ10).** Read via the inventory pass:
   `CRQ:389-395` catches every error and returns null, so the query never
   enters error state and `refetchInterval` (`CRQ:400-410`) never sees a 429.
   Grep confirms `60 * 1000` at `CRQ:406` and `10 * 1000` at `CRQ:409`.
5. **`completeReceive` is safe to let run after lead loss.** Read
   `cashu-receive-quote-service.ts:199-293`: `processPayment` reserves the
   counter in the DB, outputs are deterministic
   (`OutputData.createDeterministicData`), and a COMPLETED quote is a no-op.
6. **Void returns (SS13, RQ15/16).** Read `cashu-send-swap-service.ts:247-257`
   and the repository `complete` (`cashu-send-swap-repository.ts:233-245`):
   no row returned. `expire` / `fail` are `Promise<void>` (`cashu-receive-quote-service.ts:156`,
   `:179`). That is why B.8 has no emit for them.
7. **`connection.changed` replays synchronously inside `on()`.** Read
   `events.ts:111-135`: the replay `dispatch` runs before `on` returns. The
   `subscribing` flag in `onReconnected` relies on this.
8. **Moving `createTaskProcessor` below `createAccountsApi` is safe.** Read
   `sdk.ts:119-188`: `onSessionEnded` reads the `let taskProcessor` binding
   lazily, and nothing between `:181` and `:194` uses `taskProcessor`.
9. **Testnut cannot run the lightning flows.** Read `account.ts:105-124` and
   `checkIsTestMint` (`packages/cashu/src/utils.ts:319-321`). That is why
   smoke step 3 uses a local FakeWallet nutshell. I did not run it; the mint
   setup is a maintainer-environment assumption.
10. **Dead web hooks after Task 5/6.** Grepped consumers of
    `useGetCashuAccountByMintUrlAndCurrency`, `useSelectItemsWithOnlineAccount`
    and `useGetSparkAccount` across `apps/web-wallet/app`. Every hit is inside
    a processor file being deleted. The task canaries re-check this before
    deleting from `AH`.

## Plan-attack corrections (2026-10-19)

An adversarial review of this plan (verdict NOT READY: 1 Critical, 8
Important, 1 Minor, 1 Nit) and an orchestrator pass (O1, O2) led to the
corrections below. **Where this section and older text disagree, this
section wins.** Implementers read it before the task they implement.

### F1 (Critical, re-rated: a pre-existing master defect; parity kept)

B.6 lists "Breez `idempotencyKey: sendQuote.id` (PS12)" as proof that spark
`initiateSend` is safely resumable. That claim is **wrong**. When
`sendPayment` succeeds and `markAsPending` then throws
(`packages/wallet-sdk/domain/send/spark-send-quote-service.ts:277-299`), the
retry's `sendPayment` throws `preimage request already exists`, which the
service maps to `DomainError('Lightning invoice has already been paid.')`
(`:301-304`, `packages/wallet-sdk/lib/spark/errors.ts:26-31`). Master's
mutation then fails the quote (`SSQ:447-454`), and so does this saga (Task 6).
The payment has left the wallet, and the quote ends FAILED.

**Decision:** this slice moves orchestration and keeps service behavior
(C.6), so Task 6 keeps master's behavior exactly: a `DomainError` from
`initiateSend` runs `fail(error.message)` on the same key. Delete the PS12
clause from the B.6 resumability list and add one sentence there: "Spark
`initiateSend` is not resumable after a successful `sendPayment` whose
`markAsPending` failed; master has the same defect (F1); the fix is a
follow-up." The PR lists the follow-up for the maintainer: on
`isInvoiceAlreadyPaidError`, look up the existing payment
(`listPayments` filtered to lightning sends, match
`details.invoice === sendQuote.paymentRequest`) and `markAsPending` with it
instead of failing; it needs a live mainnet test, which this slice cannot run.
Task 6 adds test **(i)**: `initiateSend` rejects with
`DomainError('Lightning invoice has already been paid.')` → one attempt, then
`fail` with that message on `spark-send-quote-<id>` (pins today's behavior so
the follow-up shows up as a deliberate test change).

### F2 (Important) — Breez initial checks must survive a failed check

Tasks 5 and 6: add a quote to `checked` **only after** its
`getPaymentByInvoice` / `getPayment` call resolves (any status). When the
call throws, log master's line (`'Error checking initial receive payment'` /
`'Error checking initial send payment status'`, same meta) and leave the id
out of `checked`, so the next `sync` checks again.

Task 5, `synced`: for each quote of that account whose `expiresAt` is past,
run the initial-check lookup first. `completed` → the same completion
handler (complete, not expire). Not completed, or the lookup throws → expire,
as master. The lookup is local (`SRQ:422` comment), so this adds no network
request. **Named delta (E):** master expired a past-due quote on `synced`
without a lookup, so a payment its listener missed ended EXPIRED; the saga
completes it.

Tests: Task 5 **(j)** a rejected `getPaymentByInvoice`, then a second `sync`
→ called again; **(k)** `synced` for a past-due quote whose lookup returns
`completed` → `complete`, no `expire`; **(l)** `synced` for a past-due quote
whose lookup throws → `expire`. Task 6 **(j)** a rejected `getPayment`, then a
second `sync` → called again.

### F3 (Important) — stop every tracker continuation when the stint dies

- In `quote-trackers.ts` and in every saga, after **every** await (including
  the early return of `delayUntil`, a `withRetry`, a state check, or an
  account read), `if (!stint.scope.alive) return;` before any mint call,
  `onUpdate`, handler dispatch or `runAction`.
- The RQ9 expiry recheck calls
  `withRetry({ fn, retry: 5, signal: stint.scope.signal })`
  (`packages/utils/src/with-retry.ts:56-76` takes `signal`). In its `catch`:
  when the signal is aborted or the scope is dead, return without the
  `'Error checking mint quote upon expiration'` log and without `onUpdate`.
  The melt expiry check follows the same rule.
- Replace the B.1 "Session end" paragraph's last sentence and the B.6
  sign-out reasoning with: "Session end cancels the stint synchronously, then
  resets the token and the session keys at once (`sdk.ts:139-159`). A service
  call already inside a mint or Breez request is not joined (only `dispose()`
  awaits `stop()`), so it may fail its next DB write. Recovery is the next
  session's idempotent resume (DB-reserved counters with deterministic
  outputs, `meltProofsIdempotent`, the restore paths in
  `cashu-receive-quote-service.ts` and `cashu-send-swap-service.ts`). The
  stint fence only guarantees that no **new** step starts and nothing is
  emitted."
- Test (Task 3, `quote-trackers.test.ts`) **(h2)**: cancel the stint while
  an expiry recheck is in its `withRetry` backoff → no further check, no error
  log, no `onUpdate`.

### F4 (Important) — the melt amount is in the cashu unit

Tasks 3 and 5, `initiateMelt`, use master's exact expression
(`CRQ:687`, `CRQ:706-714`):

```ts
const cashuUnit = getCashuUnit(quote.amount.currency);
await sourceWallet.meltProofsIdempotent(
  {
    quote: quote.tokenReceiveData.meltQuoteId,
    amount: quote.amount.toNumber(cashuUnit),
  },
  quote.tokenReceiveData.tokenProofs,
  undefined,
  { type: 'random' },
);
```

Test (Task 3 **(l2)**, Task 5 **(h2)**): the object passed to
`meltProofsIdempotent` has `amount === 1000` for a quote of
`new Money<Currency>({ amount: 1000, currency: 'BTC', unit: 'sat' })`.

### F5 (Important) — no online check inside the send-swap attempt

Task 2, `swapForProofsToSend`: the attempt returns `undefined` only when
`set.get(id)?.state !== 'DRAFT'`. Delete "and its account is online". The
online filter stays in `sync` (X9). Test **(c2)**: the account flips offline
during the backoff → the second attempt still calls `swapForProofsToSend`.

### F6 (Important) — online status is re-evaluated at the next sync (parity)

Keep master's behavior: an `account.updated` alone does not re-run `sync`.
Delete the second sentence of Task 1 test (b) ("An `account.updated` that
flips …"). Replace the E row for X9 with: "the online filter runs on every
`sync` (a list change, an event, a reload); an `account.updated` alone does
not trigger one, as master's `select`." Task 5 test (i) stands.

### F7 (Important) — look quotes up by the mint / melt quote id

Add to `WorkingSet<T>` (B.4):

```ts
/** The first item matching `predicate`, or undefined. */
find(predicate: (item: T) => boolean): T | undefined;
```

Lookups (never `set.get(...)` with a mint or melt id):

- mint socket / poll (Task 3): `set.find((q) => q.quoteId === mintQuote.quote)`;
- cashu receive melt (Task 3) and spark receive melt (Task 5):
  `set.find((q) => q.type === 'CASHU_TOKEN' && q.tokenReceiveData.meltQuoteId === meltQuote.quote)`;
- cashu send melt (Task 4): `set.find((q) => q.quoteId === meltQuote.quote)`.

Fixtures in Task 3 (h), (o), (q) and Task 4 (a) use `id: 'quote-1'` with
`quoteId: 'mint-quote-1'` / `meltQuoteId: 'melt-quote-1'`, and assert that the
service received the row whose `id === 'quote-1'`. Task 0 test (k) adds one
`find` assertion.

### F8 (Important) — `delayUntil` is tested in Task 3

Move test (q) out of Task 0 into Task 3's `quote-trackers.test.ts` as test
**(s)** (Task 0's file map has no `quote-trackers.ts`). Clock steps: `now = 0`; call
`delayUntil(stint, 2 ** 31 + 10)`; assert the armed timeout is
`2 ** 31 - 1`; set `now = 2 ** 31 - 1`; fire; assert the next timeout is
`11`; set `now = 2 ** 31 + 10`; fire; the promise resolves. A past `at`
resolves with no timer armed. Cancelling the scope mid-wait resolves early
and arms nothing more.

### F9 (Important) — `stop()` arms a bound only for a non-empty checkpoint set

`join` arms its timer only when that controller has tracked work
(`packages/wallet-sdk/lib/run-scope.ts:265-272`). Test (t): with only the
saga's deferred tracked, **one** `5000` timer is armed (the stint
controller's), and it is cancelled when the deferred resolves. Test (u): the
same single timer; `stop()` resolves when the test fires it. New test
**(t2)**: also leave the lead loop's `takeLead` promise unsettled → two
`5000` timers are armed, and `stop()` resolves only after both checkpoints
settle (or both timers fire).

### F10 (Minor) — the three-argument debug call in `PSM`

`proof-state-subscription-manager.ts:140`
`console.debug('allProofsSpent', allProofsSpent, { swapId: swap.id })` becomes
`this.logger.debug('allProofsSpent', { allProofsSpent, swapId: swap.id })`.
E notes the meta-shape change. Leave the existing
`delete this.proofUpdates[swap.id]` (`:143`) as it is; the file lints today.

### F11 (Nit) — Task 1 imports

`cashu-receive-swap-hooks.ts` has no `useSuspenseQuery` import. Remove
`useQueries`, and `useQuery` / `useQueryClient` only if nothing else in the
file uses them.

### O1 (Important, orchestrator) — a give-up must re-arm the item

C.4 and C.10 say a failed or abandoned task is "retried by the next trigger
(…a reload…)" and that "the stint's `onActivated` reload re-triggers every
pending item". Both are false as written: a reload re-runs `sync`, but
`sync` skips items already in a saga's once-per dedupe state (`triggered`,
`lastTriggered`, `checked`), and a socket subscription for an unchanged id
set is reused (subset reuse, `MINTM:37-49`, `MELTM:37-49`, `PSM:42-48`), so
no new state message arrives. Master's recovery was its error boundary: the
failure threw, `TaskProcessor` remounted, and fresh subscriptions re-delivered
each quote's current state. Without a fix, a failed `completeReceive` or a
failed `completeSwap` stays pending until the next stint (the next app load
or leadership change).

**Rule (all six sagas):**

1. `SagaAction<T>` gains `onGiveUp?: () => void`. `runAction` calls it after
   `onError` when the outcome is `failed`, and alone when the outcome is
   `abandoned`, in both cases only while the stint scope is alive.
2. Each saga passes `onGiveUp: () => { resetPending = true; }`.
3. Each saga registers `stint.onActivated(resetIfPending)` and
   `stint.onReconnected(resetIfPending)` **before** it calls
   `startWorkingSet`. `resetIfPending`: when `resetPending` is set, clear it
   and run the saga's `reset()`: call `unsubscribeAll()` on its managers (the
   next `subscribe` opens a fresh subscription, and the mint sends each
   quote's current state, NUT-17), invalidate every armed timer token, clear
   `triggered` / `lastTriggered` / `checked`, and remove its Breez listeners.
   The reload that follows (B.4 rule 2) calls `sync`, which re-subscribes,
   re-arms and re-fires from the database state.
4. Polling (Task 3, non-NUT-17 mints) needs no reset: its loop keeps
   checking every 10 s.

Effect: a give-up is retried at the next activation or reconnect, with a
fresh retry budget, from durable state. That is the 18.1 abandon rule applied
to failures too, and it matches master's remount without the error page.
**Delta (E):** master retried a failed action only after the user reloaded
the error page; the saga retries at the next activation or reconnect.

Tests: Task 0 **(x)** `runAction` calls `onGiveUp` once on `failed` (after
`onError`) and once on `abandoned`, and not after the scope is dead. Task 1
**(i)** `completeSwap` fails 4 times; a `'connected'` reload calls it again
for the same swap. Task 3 **(r)** a failed `complete` on a NUT-17 mint; the
next activation unsubscribes and subscribes again for that mint. Task 6
**(k)** a failed `initiateSend`; the next reload initiates again.

### O2 (orchestrator) — smoke step F.3 uses the dev Testnut accounts

Replace smoke step 3. The dev Testnut accounts
(`https://testnut.cashu.space`, `packages/wallet-sdk/domain/user/user-api.ts:45`,
`:55`) create lightning invoices from the receive page;
`canReceiveFromLightning` / `canSendToLightning` gate only cross-mint token
claims (`apps/web-wallet/app/features/receive/receive-cashu-token-hooks.ts:357`).
No local nutshell is needed:

- **3a, cashu receive quote:** in B (follower), receive 21 sats to the
  Testnut BTC account. Testnut's FakeWallet pays the mint quote; A (leader)
  completes it; B navigates to a completed transaction (not DRAFT).
- **3b, cashu send quote:** in A, pay a 25-cent invoice created by the
  Testnut USD account from the Testnut BTC account
  (`/send?accountId=<testnut-btc-id>#<bolt11>`). A different unit forces
  FakeWallet's external settle path. A initiates the melt, marks it pending,
  and completes it.
- **3c, CASHU_TOKEN cashu receive (melt path):** mint a 50-sat token on
  `https://testnut.cashudevkit.org` (a mint that is not in `knownTestMints`)
  and claim it into the Testnut BTC account. The claim creates a CASHU_TOKEN
  receive quote; A initiates the melt at the source mint, marks it
  initiated, and completes the quote.

### Verified after planning (2026-10-19)

The open question in G is closed. `node_modules/@tanstack/query-core/build/modern/retryer.js`
(5.90.20): `defaultRetryDelay(failureCount)` is `Math.min(1e3 * 2 ** failureCount, 3e4)`
with the pre-increment count, and `canContinue` is
`focusManager.isFocused() && (networkMode === 'always' || onlineManager.isOnline()) && canRun()`,
so a paused retry waits for focus **and** online. X7 and X8 stand as
written; C.10 stands with the O1 re-arm. A mutation's first attempt
(`canStart`) needs only online.

