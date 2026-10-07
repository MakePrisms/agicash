# Wallet SDK Cashu Send Swap Slice (Step 14) Implementation Plan

> **Orchestration note:** like steps 10–13, this slice ships as **one whole-slice contribution job**, after an adversarial review of this plan. A separate implementer forks the repo at the base of `sdk/cashu-send-swap-slice` (`b06a3b7`, the head of the still-open step-13 PR `sdk/cashu-send-quote-slice`), reads this plan and the referenced code in the fork, and delivers everything together on a branch descending from that base: the two send-to-token methods on the existing `createSendApi` factory, the `getAccountRepository` wiring, the service options param, the updated unimplemented-member tests, and the web hook flip. The orchestrator then integrates locally and runs the gates from the Verification summary. Adversarial review of the integrated diff follows. The job text stays task-only; this document is the full spec. All `path:line` citations are valid at the pinned base (`b06a3b7`).

**Goal:** Implement `send.cashu.getSwapQuote` and `send.cashu.createSwap` from the SDK contract (send-to-ecash-token). The step-13 `createSendApi` factory already exists (`domain/send/send-api.ts`); this slice replaces the two throwing getters on `cashu` (`send-api.ts:76–81`) with the host verbs. Flip the web cashu-token quote preview and the confirm (create swap) hooks from `@agicash/wallet-sdk/temporary` to `sdk.send.cashu.*`. After this slice, `send.cashu` is fully implemented; `spark` (step 15) and `resolveDestination` stay throwing getters.

**Architecture:** This is step 14 of the 19-step no-cache extraction (spec `docs/superpowers/specs/2026-06-24-wallet-sdk-no-cache-production-design.md`, step list `:68–116`, step 14 at `:92`). The already-moved `domain/send/cashu-send-swap-service.ts` gets its two host-initiated verbs exposed through the existing `createSendApi`. The factory already mirrors `createReceiveApi` (`domain/receive/receive-api.ts:45–262`) for the quote half; this slice adds swap seams the same way step 10 added `createSwap` to receive (`receive-api.ts:169–179`). `sdk.ts` already assigns `readonly send` (`sdk.ts:57`, `:187–191`); the only wiring change is passing `getAccountRepository: accounts.getRepository` so the default swap-service builder can construct the `CashuReceiveSwapService` that `CashuSendSwapService`'s constructor requires (`cashu-send-swap-service.ts:36–39`) without splitting the class (step 18, `production-design.md:100–107`). The cashu send-swap **background lifecycle** (`swapForProofsToSend`, `complete`, `fail`, and `reverse` in `useProcessCashuSendSwapTasks` / `useReverseTransaction`) stays on `/temporary` until step 18. That is the same boundary style as steps 9–13.

**Tech stack:** TypeScript, bun workspaces, bun:test, Supabase (postgrest-js), TanStack Query v5 (web side only).

## Global constraints

- **Param precedent (binding, set by the #1176 review):** contract methods take the full domain objects the caller supplies (`account: CashuAccount`). They never take an id the SDK re-fetches. Fetch-by-id is reserved for paths with no caller state. A flipped web flow must issue no additional network requests versus master. Binding text: production design "Corollary (foreground parity)" (`2026-06-24-wallet-sdk-no-cache-production-design.md:31–37`) and contract proposal "Conventions across all namespaces" (`2026-07-02-wallet-sdk-contract-proposal.md:297–325`). The merged `receive-api.ts` / `domain/sdk/receive.ts` and the step-13 `send-api.ts` / `domain/sdk/send.ts` are authoritative.
- **`userId` is implicit** (`contract-proposal.md:299–301`): no public param carries it. `createSwap` takes it from `requireUserId()`.
- **`get*` = stateless preview, `create*` = persists** (`contract-proposal.md:302–306`). `getSwapQuote` does no DB write (it is local proof/fee math, `cashu-send-swap-service.ts:45–89`). `createSwap` persists (`create_cashu_send_swap` RPC, `cashu-send-swap-repository.ts:137`). The verbs are already right; this slice does not rename them.
- **Completion verbs never appear on the public surface** (`contract-proposal.md:317–321`). `swapForProofsToSend` / `complete` / `fail` / `reverse` (`cashu-send-swap-service.ts:180–290`) are not exposed.
- **No host/processing split.** Do not split `CashuSendSwapRepository` / `CashuSendSwapService` (or the receive-swap classes this constructor depends on) into host and processing halves. The spec gives that to step 18 (`production-design.md:100–107`). This slice wraps the bundled classes as they are, including constructing a `CashuReceiveSwapService` the host verbs never call.
- The SDK stays React-agnostic: `packages/wallet-sdk` never imports `react` or `@tanstack/react-query`.
- **No SDK event emission.** `domain/sdk/events.ts` is untouched.
- No DB schema, RPC, dependency, or migration changes. `create_cashu_send_swap` is used unchanged. No `bun add`, and no `db:generate-types`.
- Session fences follow the merged `receive-api.ts` / step-13 `send-api.ts` template (decision 7).
- **Canary rule for `temporary.ts`:** prune only the re-exports this flip makes dead, verified by repo-wide grep. This flip makes **none** dead (decision 10), so `temporary.ts` is untouched. Do not prune pre-existing dead re-exports (e.g. `CashuSendSwapSchema` at `temporary.ts:127` is already unused by the web).
- Do not touch other domains' `/temporary` imports. Only the files in the File map change.
- Root `packages/wallet-sdk/index.ts` is untouched. `export * from './domain/sdk'` (`index.ts:10`) re-exports `domain/sdk/index.ts`, which does `export * from './send'` (`domain/sdk/index.ts:26`), so the three filled param/result types ship automatically. `CashuAccount`, `CashuSendSwap`, `PendingCashuSendSwap`, and `CashuSwapQuote` are already root-exported (`index.ts:35`, `:113–116`).
- **`.server.ts` twins are untouched** (step 17). The send-swap domain has none today.
- Package manager: `bun` / `bunx` only. Base branch: `sdk/cashu-send-quote-slice` at `b06a3b7`. Work branch: `sdk/cashu-send-swap-slice` (stacked on step 13).

## Resolved design decisions

1. **Slice scope = the two web host entry points into `CashuSendSwapService`, and nothing else.** A repo-wide grep for `getQuote` / `create` / `useCashuSendSwapService` / `useCashuSendSwapRepository` on the send-swap path finds these callers:
   - (a) `useCreateCashuSendSwapQuote` (`cashu-send-swap-hooks.ts:133–152`). It calls `cashuSendSwapService.getQuote` (`:146`): the **preview**, despite the hook name. It is consumed as `getCashuSwapQuote` via `send-provider.tsx:34` → `createSendStore` (`send-provider.tsx:50`) → `send-store.ts:343–346`. The store type is `{ account, amount, senderPaysFee? }` (`send-store.ts:157–161`); the call omits `senderPaysFee`.
   - (b) `useCreateCashuSendSwap` (`cashu-send-swap-hooks.ts:155–199`). It calls `cashuSendSwapService.create` (`:178`) and is consumed only by `send-confirmation.tsx:304–335` (`CreateCashuTokenConfirmation`; mutate at `:332–335`). The confirm route picks this component for `sendType === 'CASHU_TOKEN'` (`routes/_protected.send.confirm.tsx:61–68`).
   - The only other `CashuSendSwapService` method callers stay on `/temporary`:
     - `useCashuSendSwapService` (`cashu-send-swap-hooks.ts:44–50`) is still used by `useProcessCashuSendSwapTasks` (`:419`, `swapForProofsToSend` at `:433`, `complete` at `:457`; step 18) and by `useReverseTransaction` (`features/transactions/transaction-hooks.ts:226`, `reverse` at `:246`).
     - `useCashuSendSwapRepository` (`:39–41`) stays: unresolved reads (`:203`, `:209`), `useCashuSendSwap` (`:233–239`), `useTrackCashuSendSwap` (`:294`, `:298`), and change handlers (`:382`, `:392`). Also `transaction-additional-details.tsx:119` and `transaction-hooks.ts:228` (`getByTransactionId`).
   - There is **no in-package caller** of `CashuSendSwapService.create` or `getQuote`. The receive-swap `create` that send-swap `reverse` calls (`cashu-send-swap-service.ts:280`) is a different class and stays in-package (step 18).
   - Neighbors stay put: spark send = step 15 (`useInitiateSparkSendQuote`, `useCreateSparkLightningSendQuote`), transfer = step 16, `resolveDestination` = unowned (step-13 decision 5).

2. **`GetCashuSwapQuoteParams` = `{ account: CashuAccount, amount: Money, senderPaysFee?: boolean }`.** Evidence:
   - These are the fields the only caller types (`send-store.ts:157–161`) and the fields the service reads (`getQuote`, `cashu-send-swap-service.ts:45–55`), minus making `senderPaysFee` required (decision 3).
   - **`account`:** the full object. The service needs `account.wallet`, `account.proofs`, and `account.currency` (`:57–71`). No in-SDK `accounts.get`, which would cost a proofs-inclusive row read plus a wallet init (`contract-proposal.md:307–316`; `account-repository.ts:61–80`, `lib/cashu.ts:182–186`).
   - **`amount: Money`:** the amount the user entered. The store passes `amountToSend` (`send-store.ts:345`).
   - **`senderPaysFee` is on the public param as optional.** Who passes it today: only the two web hooks, both defaulting `senderPaysFee = true` in the destructuring (`cashu-send-swap-hooks.ts:140`, `:171`). The store type allows it (`send-store.ts:160`) but the only call omits it (`:343–346`). The service requires a boolean (`:55`, `:108`) and uses it as `includeFeesInSendAmount` (`:71`, `:129`, `:296`). `false` is not implemented: `prepareProofsAndFee` throws `'Sender must pay fees - this feature is not yet implemented'` (`:303–306`). This is not a dead input in the step-13 `exchangeRate` sense (step-13 decision 3): the service *reads* it on every returning path. Omitting the field from the contract would hardcode `true` and hide a real service input. Making it required would force every host to know the default. Optional-with-default is the current web surface.
   - **The default `true` lives in the API layer** (`params.senderPaysFee ?? true` when calling the service) so every host gets the same default. The flipped hooks keep `senderPaysFee = true` in their destructuring so `send-store.ts:157–161` and the confirm mutate (`send-confirmation.tsx:332–335`, which also omits it) stay byte-identical. *Rejected:* omitting `senderPaysFee` (it is a live service input). *Rejected:* required `senderPaysFee` (no caller passes it today). *Rejected:* defaulting only in the hook (a non-web host would then hit the service's required boolean).

3. **`CreateCashuSwapParams` mirrors the service (`{ account, amount, senderPaysFee? }`), not a preview-pairing `{ account, swapQuote }`.** Evidence:
   - `create` (`cashu-send-swap-service.ts:95–109`) takes `{ userId, account, amount, senderPaysFee }` and **never reads a `CashuSwapQuote`**. It recomputes fees from the current proofs via `prepareProofsAndFee` (`:125–130`) — the same helper `getQuote` uses (`:67–72`).
   - The only confirm caller already passes `amount: quote.amountRequested`, not the quote object (`send-confirmation.tsx:332–335`). The displayed `quote.totalFee` / `quote.totalAmount` (`:330`, `:352–357`) are preview numbers; create is allowed to recompute if proofs changed.
   - Step 13 paired `createQuote` with `lightningQuote` because `createSendQuote` *reads* the quote (`cashu-send-quote-service.ts:242`, `:301`, `:306–310`: melt quote id, amounts, expiry). Pairing here would imply the quoted fee is locked in, which the service does not honor. On a `ConcurrencyError` retry (decision 11) proofs may have changed, so a locked quote would be stale anyway — and master already recomputes.
   - `userId` stays implicit (decision 2 / `contract-proposal.md:299–301`). `senderPaysFee` follows decision 2.
   - *Rejected:* `{ account, swapQuote: CashuSwapQuote }`. It copies step 13's `get*` → `create*` pairing onto a service that ignores the quote, and it would make a host think the confirmation-page fee is the persisted fee.

4. **`CreateCashuSwapResult` is `{ swap: CashuSendSwap }` at runtime. Not a bare `CashuSendSwap`, not `{ transactionId }`.** The contract placeholder is `unknown` (`send.ts:63`); the proposal sketches `createSwap(params): Promise<…>` (`contract-proposal.md:164`) and this slice fills the ellipsis.
   - **The `{ transactionId }` rule does not cover swaps.** "Observing an initiated payment" (`contract-proposal.md:326–341`) is about lightning send: `createQuote` returns `{ transactionId }` (`contract-proposal.md:162`, `:168`; shipped in step 13, `send.ts:21–23`) and completion is observed via events. That section's "send returns only an id — the asymmetry is intentional" sentence is about that lightning observation idiom. `createSwap` is the undecided `Promise<…>` on the next line (`:164`).
   - **The web needs the full `CashuSendSwap`.** `useCreateCashuSendSwap`'s `onSuccess` seeds `cashuSendSwapCache.add(swap)` (`cashu-send-swap-hooks.ts:194–196`) and then calls the caller's `onSuccess(swap)` (`:196`). The only caller navigates to `/send/share/${swap.id}` (`send-confirmation.tsx:306–313`). The share route reads `useCashuSendSwap(params.swapId)` (`routes/_protected.send.share.$swapId.tsx:16`), whose `queryFn` is `cashuSendSwapRepository.get(id)` (`cashu-send-swap-hooks.ts:236–243`) keyed `[CashuSendSwapCache.Key, id]` (`:237`) with `staleTime: Number.POSITIVE_INFINITY` (`:251`). Master's `cache.add` (`:62–66`) writes that same key, so the share page is a cache hit and `queryFn` does not run on landing. `useAccount` (`:256`) is a TanStack accounts-cache read (`account-hooks.ts:355–375`), zero network.
   - **A `{ transactionId }` result would add a fetch versus master.** The share route is `/send/share/${swap.id}`, not a transaction id. Without the swap object the hook cannot seed the cache; `useCashuSendSwap` would run `repository.get` (a `cashu_send_swaps` select, `cashu-send-swap-repository.ts:284–302`). That is an added request. Changing the route to a transaction id is out of scope (it would touch `send-confirmation.tsx` and the share route, which this slice leaves byte-identical).
   - **Wrapper vs bare.** Receive `createSwap` returns `{ swap: CashuReceiveSwap, account: CashuAccount }` (`receive.ts:81–86`) because *that* service returns both (the receive RPC updates the keyset counter). Send `create` returns `Promise<CashuSendSwap>` (`cashu-send-swap-service.ts:109`); the RPC updates the account version (`20260420152512_denormalize_account_on_transactions.sql:661–664`, `:685–697`) but the service does not return the account, and the web does not read an updated account from the mutation result (it relies on `ACCOUNT_UPDATED` → `accountCache.upsert`, `account-hooks.ts:130–134`). A bare `CashuSendSwap` would match the service return and make the hook a thinner wrap. The named `CreateCashuSwapResult` placeholder (`send.ts:26`, `:63`) and the receive-swap envelope both point at an object wrapper: `{ swap }` can grow later without breaking, and `#1164` can still narrow fields inside `swap` (the standing note at `send.ts:8–10`). The API wraps: `return { swap }`. The hook unwraps so `onSuccess` stays `(swap: CashuSendSwap) => void` and `send-confirmation.tsx` / the share route stay byte-identical.
   - *Rejected:* bare `CashuSendSwap` (it works, but it burns the named result type as an alias and makes adding fields a breaking change). *Rejected:* `{ transactionId }` (parity violation + wrong identifier for the share route). *Rejected:* `{ swap, account }` (the service does not return `account`; inventing a second accounts-cache write would be new behavior).

5. **`resolveDestination` and `spark` stay throwing getters.** No change from step-13 decision 5 / 6. After this slice `cashu` has no throwing members. Spreading `{ ...sdk.send.cashu }` becomes safe; nothing spreads namespaces (grep `sdk.send` in `apps/` → still no matches beyond the step-13 quote hooks).

6. **Unimplemented members after this slice: `spark` and `resolveDestination` only.** Step-13 tests **n**, **o**, and **p** currently assert `getSwapQuote` / `createSwap` throw (`send-api.test.ts:544–551`, `:580–581`; `sdk.test.ts:91–92`). This slice edits those three tests in place (exact edits in Task 1): they assert the two swap methods are functions, and they still assert `spark` / `resolveDestination` / `sdk.transfer` throw `NotImplementedError`. Messages stay `'send.resolveDestination is not implemented yet.'` / `'send.spark is not implemented yet.'` (`lib/error.ts:65–69`). *Rejected:* async methods that reject (step-13 decision 6).

7. **Session fences follow the merged receive / step-13 template.**
   - **`getSwapQuote` (preview)** matches `send-api.ts:47–58` / `receive-api.ts:130–141`: **no `requireUserId()`**, capture `deps.keys.sessionSignal()` → `await getSwapService()` → re-check → service call → re-check. The preview persists nothing (`getQuote` returns a plain object, `cashu-send-swap-service.ts:81–89`; the repository is unused). There is no mint HTTP to abort either (decision 12), so pre/post checks are the only fence. The service takes no options here.
   - **`createSwap`** matches `send-api.ts:59–75` / `receive-api.ts:169–179`: `requireUserId()` → capture `sessionSignal()` → `await getSwapService()` → re-check → `create({ userId, account, amount, senderPaysFee }, { abortSignal: signal })` → re-check → return `{ swap }`. A result is never returned for an ended session.

8. **`CashuSendSwapService.create` gains `options?: { abortSignal?: AbortSignal }` as a second positional param, forwarded to `cashuSendSwapRepository.create(..., options)`.**
   - The repository already accepts and applies it (`cashu-send-swap-repository.ts:93–109`, `:149–150`).
   - This matches steps 9–13 (step-13 `createSendQuote` at `cashu-send-quote-service.ts:240`; step-10 receive-swap `create` already has options).
   - Compatibility: the only caller of `CashuSendSwapService.create` is the web hook this slice flips (`cashu-send-swap-hooks.ts:178`). There is no in-package caller. `getQuote` gets no options param (nothing in it can abort). `swapForProofsToSend` / `complete` / `fail` / `reverse` signatures are unchanged (background verbs; step 18).
   - `reverse` still calls `cashuReceiveSwapService.create({...})` with one argument (`cashu-send-swap-service.ts:280`). That service already accepts optional `options` (step 10); one-argument calls keep compiling.

9. **Factory deps: add `getAccountRepository` (required) plus two swap test seams. `sdk.ts` wires `accounts.getRepository`. No cashu crypto, no class split.**
   - `CashuSendSwapRepository` takes `(db, encryption)` (`cashu-send-swap-repository.ts:88–91`) — **no** `AccountRepository`. The web builds it the same way (`cashu-send-swap-hooks.ts:39–41`).
   - `CashuSendSwapService` takes `(cashuSendSwapRepository, cashuReceiveSwapService)` (`cashu-send-swap-service.ts:36–39`). The receive-swap service is used **only** by `reverse` (`:268`, call at `:280`). Host verbs never call it.
   - `CashuReceiveSwapService` takes only the repository (`cashu-receive-swap-service.ts:20–23`). `CashuReceiveSwapRepository` takes `(db, encryption, accountRepository)` (`cashu-receive-swap-repository.ts:62–66`). Receive already builds that stack through `deps.getAccountRepository` (`receive-api.ts:79–93`).
   - **Do not split the class** (step 18, `production-design.md:100–107`). The default `getSwapService` builder constructs a real `CashuReceiveSwapService` the same way receive does, even though `getQuote` / `create` never call `reverse`.
   - **Cost of `accounts.getRepository`:** it is **not** a memoized singleton. Each call (`accounts-api.ts:35–46`) awaits `keys.getEncryption()` (memoized per session, `session-keys.ts:25–27`, `:200–262`) and constructs `new AccountRepository(db, encryption, keys.getCashuSeed, keys.getSparkMnemonic, sparkConfig)` (`:39–45`). The constructor (`account-repository.ts:48–54`) stores the seed/mnemonic getters as function refs and does **not** invoke them. No `db.from`, no mint HTTP. Host verbs never call `reverse`, so `CashuReceiveSwapRepository` methods never run, so `AccountRepository.get` (the proofs-inclusive read + `getInitializedCashuWallet` that *would* be three mint HTTP requests, `account-repository.ts:61–80`, `:226–232`, `lib/cashu.ts:182–186`) never runs on these paths. Encryption is already warm from session start: `user.provision` awaits `getAccountRepository()` (`user-api.ts:118–129`), whose builder calls `getEncryption` (`accounts-api.ts:38`), before `auth.session-started` seeds the accounts cache (`features/user/session-started.ts:15–20`). Master already constructs `new CashuReceiveSwapService` on every `useCashuSendSwapService()` render (`cashu-send-swap-hooks.ts:44–50`); the flipped path constructs it once per lazy `getSwapService()` call. Net added I/O: **0**.
   - `Deps` therefore grows: required `getAccountRepository`, optional `createSwapRepository?` / `createSwapService?` next to the existing quote seams (`send-api.ts:16–19`). Quote seams stay byte-identical.
   - `sdk.ts` changes the `createSendApi` call (`:187–191`) to pass `getAccountRepository: accounts.getRepository`, matching `createReceiveApi` (`:181–186`).

10. **Canary: no `/temporary` re-export becomes dead. `temporary.ts` is untouched.**
    - The flip removes the web hooks' calls to `CashuSendSwapService.getQuote` / `create`, but every re-export they used is still imported elsewhere:
      - `CashuSendSwapService` (`temporary.ts:129`) by `cashu-send-swap-hooks.ts:13` (still used at `:44–50` for the processor and reverse).
      - `CashuSendSwapRepository` (`temporary.ts:128`) by `cashu-send-swap-hooks.ts:12` (still used at `:39`).
      - `ConcurrencyError` / `DomainError` by the same file (the flipped create hook's `retry` still uses them).
    - `CashuSendSwapSchema` (`temporary.ts:127`) has no web importer today; it was already unused outside the package. Do **not** prune it (pre-existing; step-19 cleanup).
    - Run a repo-wide grep before delivering to confirm. Do **not** prune anything else.

11. **Web flip: two hook bodies in `cashu-send-swap-hooks.ts`. `send-confirmation.tsx`, `send-provider.tsx`, `send-store.ts`, and `routes/_protected.send.share.$swapId.tsx` are byte-identical.**
    - **`useCreateCashuSendSwap` keeps `accountId` + the per-attempt cache lookup inside `mutationFn`.** Same exception as step-13 decision 11, and the chain is the same shape:
      - The hook retries `ConcurrencyError` **forever** (`cashu-send-swap-hooks.ts:185–187`).
      - `create_cashu_send_swap` raises `CONCURRENCY_ERROR` when it cannot reserve every requested proof for this account (`packages/wallet-sdk/db/supabase/migrations/20260420152512_denormalize_account_on_transactions.sql:754–772`): the reserved-proof count must equal `array_length(p_input_proofs, 1)`. Stale proofs (a proof no longer `UNSPENT`) are the normal web cause; missing or duplicate ids can also produce the count mismatch.
      - `CashuSendSwapRepository.create` maps `error.hint === 'CONCURRENCY_ERROR'` to `ConcurrencyError` (`cashu-send-swap-repository.ts:156–158`).
      - Master recovers because `getCashuAccount(accountId)` re-reads the TanStack accounts cache on **every attempt** (`cashu-send-swap-hooks.ts:177`). Between attempts, the winning RPC's `update wallet.accounts … version = version + 1` (`20260420152512_denormalize_account_on_transactions.sql:661–664`, `:685–697`) fires the deferred `broadcast_accounts_changes_trigger` (`20260112150000_initial_db.sql:3606`); the web's `ACCOUNT_UPDATED` handler upserts the cache (`account-hooks.ts:130–134`). TanStack's default mutation `retryDelay` (exponential from 1 s, capped at 30 s; `new QueryClient()` at `features/shared/query-client.ts:6` sets no override) gives the broadcast time to land, and each retry re-invokes `mutationFn(variables)`, so `getCashuAccount(accountId)` re-reads. The lookup is a pure cache read (`useGetAccount`, `account-hooks.ts:355–375`, `useGetCashuAccount` at `:381–383`): zero network.
      - If the hook took the caller's `account` as a mutation variable, every retry would re-send the same stale proofs and loop. Step 10's receive-swap mutation had no such retry (`retry` absent, default 0), so its `account` prop precedent does not carry over. Step 13 already made this call for lightning send; the swap RPC is a sibling of `create_cashu_send_quote` (same reservation-count check at `:416–432` of the same migration).
      - `send-confirmation.tsx:332–335` therefore does not change. *Rejected:* `account` prop (it breaks ConcurrencyError recovery).
    - `useCreateCashuSendSwap` drops `useUser` (userId is implicit; `useUser` stays imported for `useUnresolvedCashuSendSwaps` at `:204`) and `useCashuSendSwapService` (the function stays defined for the processor and reverse). It unwraps `{ swap }` before `cashuSendSwapCache.add` and `onSuccess(swap)`.
    - `useCreateCashuSendSwapQuote` drops `useCashuSendSwapService`. Its mutation has **no `retry` option** today (`:136–152`); TanStack Query v5's mutation default is 0 retries. **Leave it with no `retry` option.** Adding the step-13 preview predicate (`failureCount < 1` for ordinary errors) would *add* a retry versus master. `SessionEndedError` is therefore not retried on the preview (0 retries). Do not invent a predicate the preview never had.
    - **The create hook never retries `SessionEndedError`.** The SDK fences introduce this error on the create path, and its contract is "never retry the same operation — it would run under a session that no longer owns it" (`packages/wallet-sdk/lib/error.ts:50–56`). Master's retry predicate falls through to `failureCount < 1` for it (`cashu-send-swap-hooks.ts:185–193`), and TanStack re-invokes `mutationFn(variables)` on retry, so after a quick same-user re-login the retry would persist the old send-to-token intent under the new session. The retry predicate therefore returns `false` for `SessionEndedError` first. Every other retry behavior (ConcurrencyError → forever, DomainError → no retry, one ordinary retry) is unchanged. `SessionEndedError` is imported from the package root (`packages/wallet-sdk/index.ts:14–21`), not `/temporary`. The receive hooks flipped in steps 9–12 and the send-swap preview (no retry) are out of scope for this fix (see Out of scope).
    - Imports: add `import { sdk } from '~/features/shared/sdk.client';` (same form as `cashu-send-quote-hooks.ts:31`) and `import { SessionEndedError } from '@agicash/wallet-sdk';` (a value import next to the existing type import from `@agicash/wallet-sdk`, the same split `cashu-send-quote-hooks.ts:3–9` uses). Keep every other import: `useUser` (`:204`), `useGetCashuAccount` (`:164`, `:340`, `:420`), `CashuSendSwapService`/`Repository`, `ConcurrencyError`, `DomainError`, `Money`.
    - Everything else in the file is byte-identical: `useCashuSendSwapService`, `useCashuSendSwapRepository`, the two cache classes, `useUnresolvedCashuSendSwaps`, `useCashuSendSwap`, `useTrackCashuSendSwap`, `useOnProofStateChange`, `useCashuSendSwapChangeHandlers`, `useProcessCashuSendSwapTasks`.

12. **Seed / crypto non-access: `getQuote` and `create` never read `wallet.seed` or `keys.getCashuSeed`. Test (ac) locks this for the create path.**
    - `getQuote` (`cashu-send-swap-service.ts:45–89`) calls only `prepareProofsAndFee` (`:67–72`). That helper uses `wallet.selectProofsToSend`, `wallet.getFeesForProofs`, and `wallet.getFeesEstimateToReceiveAtLeast` (`:325–367`). All three are in-memory on the caller-supplied wallet: `getFeesEstimateToReceiveAtLeast` reads `this.keyChain.getCheapestKeyset()` and `splitAmount` (`packages/cashu/src/utils.ts:221–231`). No mint HTTP, no seed.
    - `create` (`:95–178`) calls `prepareProofsAndFee`, then either `getTokenHash` (local `encodeToken` + `computeSHA256`, `lib/cashu.ts:100–105`) when proofs are exact (`:138–144`) or `wallet.getKeyset()` + `splitAmount` (`:146–153`) when they are not. `wallet.getKeyset()` is an in-memory read of the already-initialized wallet the host passed (wallet init's three mint HTTP requests happen at account-cache construction, `lib/cashu.ts:182–186`, not on this path). No `wallet.seed`. No `keys.getCashuSeed`.
    - `wallet.seed` is read only by `swapForProofsToSend` (`:200`, `:212`), which also calls `wallet.keyChain.ensureKeysetKeys` (`:193`) — that is the processor, step 18.
    - `keys.getEncryption()` is the only key material read (repository encrypt, `cashu-send-swap-repository.ts:130`), and it is memoized and warm (decision 9).

13. **No `index.ts` / `events.ts` / `temporary.ts` / `.server.ts` changes.** See Global constraints. `domain/sdk/index.ts` is untouched (it already re-exports `./send`, `:26`).

## Pinned seams (authoritative for the implementation)

### Contract (`packages/wallet-sdk/domain/sdk/send.ts`)

Replace lines 61–63 with the following. Lines 38–60 (the step-13 quote types) and lines 64–65 (the step-15 placeholders) and the `SendApi` type stay byte-identical. `CashuSwapQuote` is already imported (`send.ts:4`); `CashuSendSwap` is already imported-and-re-exported (`:12`). `CashuAccount` and `Money` are already imported (`:1–2`).

```ts
export type GetCashuSwapQuoteParams = {
  /** The cashu account to send from. */
  account: CashuAccount;
  /** The amount the receiver should get, in the account's currency. */
  amount: Money;
  /**
   * When true (the default), the sender pays the swap fee by including it in
   * the reserved proofs. `false` is not implemented by the service.
   */
  senderPaysFee?: boolean;
};

export type CreateCashuSwapParams = {
  /** The cashu account to send from. */
  account: CashuAccount;
  /** The amount the receiver should get, in the account's currency. */
  amount: Money;
  /**
   * When true (the default), the sender pays the swap fee by including it in
   * the reserved proofs. `false` is not implemented by the service.
   */
  senderPaysFee?: boolean;
};

export type CreateCashuSwapResult = {
  /** The created send swap; the token is produced in the background. */
  swap: CashuSendSwap;
};
```

`CashuSendSwap` is already in scope via `export type { CashuSendSwap } from '../send/cashu-send-swap'` (`send.ts:12`). If the type-only re-export is not locally usable as a value-type (it is; the file already uses `import type` + `export type` for the quote types' neighbors), convert line 12 to the receive.ts line-13 pattern: `import type { CashuSendSwap } from '../send/cashu-send-swap';` + `export type { CashuSendSwap };`. Let `bun run fix:all` order the imports.

### API factory (`packages/wallet-sdk/domain/send/send-api.ts`)

Add to `Deps` (after the existing quote seams at `:16–19`):

```ts
  /** Accounts bridge; feeds the receive-swap repository the send-swap service constructor requires. */
  getAccountRepository: () => Promise<AccountRepository>;
  /** Test seam; defaults to building the swap repository from db + session-keys encryption. */
  createSwapRepository?: () => Promise<CashuSendSwapRepository>;
  /** Test seam; defaults to building the swap service from the swap repository + a receive-swap service. */
  createSwapService?: () => Promise<CashuSendSwapService>;
```

New imports: `import type { AccountRepository } from '../accounts/account-repository';`, `CashuReceiveSwapRepository` / `CashuReceiveSwapService` from `../receive/cashu-receive-swap-repository` / `../receive/cashu-receive-swap-service`, and `CashuSendSwapRepository` / `CashuSendSwapService` from their send-swap files. Biome orders them.

Builders, next to the existing `getRepository` / `getService` (`:32–40`):

```ts
  const getSwapRepository =
    deps.createSwapRepository ??
    (async (): Promise<CashuSendSwapRepository> =>
      new CashuSendSwapRepository(deps.db, await deps.keys.getEncryption()));

  const getReceiveSwapService = async (): Promise<CashuReceiveSwapService> => {
    const encryption = await deps.keys.getEncryption();
    const accountRepository = await deps.getAccountRepository();
    return new CashuReceiveSwapService(
      new CashuReceiveSwapRepository(deps.db, encryption, accountRepository),
    );
  };

  const getSwapService =
    deps.createSwapService ??
    (async (): Promise<CashuSendSwapService> =>
      new CashuSendSwapService(
        await getSwapRepository(),
        await getReceiveSwapService(),
      ));
```

Replace the two throwing getters inside `cashu` (`:76–81`) with:

```ts
      getSwapQuote: async (params) => {
        const signal = deps.keys.sessionSignal();
        const service = await getSwapService();
        if (signal.aborted) throw new SessionEndedError();
        const quote = await service.getQuote({
          account: params.account,
          amount: params.amount,
          senderPaysFee: params.senderPaysFee ?? true,
        });
        if (signal.aborted) throw new SessionEndedError();
        return quote;
      },
      createSwap: async (params) => {
        const userId = requireUserId();
        const signal = deps.keys.sessionSignal();
        const service = await getSwapService();
        if (signal.aborted) throw new SessionEndedError();
        const swap = await service.create(
          {
            userId,
            account: params.account,
            amount: params.amount,
            senderPaysFee: params.senderPaysFee ?? true,
          },
          { abortSignal: signal },
        );
        if (signal.aborted) throw new SessionEndedError();
        return { swap };
      },
```

`resolveDestination` and `spark` stay throwing getters (`:43–45`, `:83–85`). The quote methods stay byte-identical. Do **not** switch the remaining unimplemented members to rejecting methods (decision 6).

`getReceiveSwapService` is an internal default-builder helper, not a `Deps` seam. Tests that need to avoid constructing it inject `createSwapService`. Tests that exercise the default swap service inject `createSwapRepository` and a fake `getAccountRepository` whose methods are never invoked.

### Service change (`packages/wallet-sdk/domain/send/cashu-send-swap-service.ts`)

Change `create` (`:95–109`) to take a second parameter. The first parameter's destructuring and inline type stay byte-identical:

```ts
  async create(
    {
      userId,
      account,
      amount,
      senderPaysFee,
    }: {
      /* …existing field docs and types, unchanged… */
    },
    options?: { abortSignal?: AbortSignal },
  ): Promise<CashuSendSwap> {
```

and pass it through at `:163`:

```ts
    return this.cashuSendSwapRepository.create(
      {
        /* …existing fields, unchanged… */
      },
      options,
    );
```

Nothing else in the file changes. `getQuote`, `swapForProofsToSend`, `complete`, `fail`, and `reverse` stay byte-identical.

### Wiring (`packages/wallet-sdk/domain/sdk/sdk.ts`)

Change the `createSendApi` call (`:187–191`) to:

```ts
    this.send = createSendApi({
      db,
      getSession: getLiveSession,
      keys,
      getAccountRepository: accounts.getRepository,
    });
```

No new import. `accounts` is already in scope (`:155–160`). Leave the class JSDoc (`:45–48`) alone. `createReceiveApi` (`:181–186`) stays byte-identical.

### Web flip (`apps/web-wallet/app/features/send/cashu-send-swap-hooks.ts`)

1. Imports: add `import { SessionEndedError } from '@agicash/wallet-sdk';` next to the existing `@agicash/wallet-sdk` type import (`:2–6`) — the same value/type split `cashu-send-quote-hooks.ts:3–9` uses. Add `import { sdk } from '~/features/shared/sdk.client';`. Keep every other import.
2. Replace `useCreateCashuSendSwapQuote` (`:133–152`) with:

```ts
export function useCreateCashuSendSwapQuote() {
  return useMutation({
    mutationFn: ({
      amount,
      account,
      senderPaysFee = true,
    }: {
      amount: Money;
      account: CashuAccount;
      senderPaysFee?: boolean;
    }) => {
      return sdk.send.cashu.getSwapQuote({
        amount,
        account,
        senderPaysFee,
      });
    },
  });
}
```

No `retry` option (decision 11). The hook default stays so `send-store.ts:157–161` / `:343–346` compile unchanged.

3. Replace `useCreateCashuSendSwap` (`:155–199`) with:

```ts
export function useCreateCashuSendSwap({
  onSuccess,
  onError,
}: {
  onSuccess: (swap: CashuSendSwap) => void;
  onError: (error: Error) => void;
}) {
  const getCashuAccount = useGetCashuAccount();
  const cashuSendSwapCache = useCashuSendSwapCache();

  return useMutation({
    mutationFn: ({
      amount,
      accountId,
      senderPaysFee = true,
    }: {
      amount: Money;
      accountId: string;
      senderPaysFee?: boolean;
    }) => {
      // Read per attempt: a ConcurrencyError retry must reselect proofs from
      // the latest cached account, not the one the first attempt saw.
      const account = getCashuAccount(accountId);
      return sdk.send.cashu
        .createSwap({
          account,
          amount,
          senderPaysFee,
        })
        .then(({ swap }) => swap);
    },
    retry: (failureCount, error) => {
      if (error instanceof SessionEndedError) {
        return false;
      }
      if (error instanceof ConcurrencyError) {
        return true;
      }
      if (error instanceof DomainError) {
        return false;
      }
      return failureCount < 1;
    },
    onSuccess: (swap) => {
      cashuSendSwapCache.add(swap);
      onSuccess(swap);
    },
    onError: onError,
  });
}
```

The comment meets the CLAUDE.md bar: it records a non-obvious constraint (decision 11) that a future "pass the account object" refactor would break. Unwrapping `{ swap }` in `mutationFn` keeps `onSuccess: (swap: CashuSendSwap) => void`, so `send-confirmation.tsx:304–335` compiles unchanged. `send-store.ts:157–161` still matches the preview hook's variables.

## File map

- Modify: `packages/wallet-sdk/domain/sdk/send.ts` (three param/result types; decisions 2–4)
- Modify: `packages/wallet-sdk/domain/send/send-api.ts` (swap methods + deps; decisions 5–9)
- Modify: `packages/wallet-sdk/domain/send/send-api.test.ts` (new swap tests q–ac; update n, o; every `createSendApi` / `makeApi` gains `getAccountRepository`)
- Modify: `packages/wallet-sdk/domain/send/cashu-send-swap-service.ts` (options param; decision 8)
- Modify: `packages/wallet-sdk/domain/sdk/sdk.ts` (wire `getAccountRepository`; decision 9)
- Modify: `packages/wallet-sdk/domain/sdk/sdk.test.ts` (update wiring test p; decision 6)
- Modify: `apps/web-wallet/app/features/send/cashu-send-swap-hooks.ts` (web flip; decision 11)
- **Untouched on purpose:**
  - Package root and contract: `packages/wallet-sdk/index.ts`, `temporary.ts` (decision 10), `domain/sdk/index.ts`, `domain/sdk/events.ts`, `domain/sdk/receive.ts`, `domain/sdk/transfer.ts`.
  - Send domain: `cashu-send-swap-repository.ts`, `cashu-send-swap.ts`, `cashu-send-quote-service.ts`, `cashu-send-quote-repository.ts`, `resolve-destination.ts`, `send-destination.ts`, all `spark-send-quote-*` files.
  - Other domains: `cashu-receive-swap-service.ts`, `cashu-receive-swap-repository.ts`, `receive-api.ts`, `transfer-service.ts`, `accounts-api.ts`.
  - Web: `send-confirmation.tsx`, `send-provider.tsx`, `send-store.ts`, `routes/_protected.send*.tsx` (including `_protected.send.share.$swapId.tsx` and `_protected.send.confirm.tsx`), `share-cashu-token.tsx`, `spark-send-quote-hooks.ts`, `cashu-send-quote-hooks.ts`, `transfer-service-hooks.ts`, `transaction-hooks.ts`, `transaction-additional-details.tsx`, `sdk.client.ts`.
  - All RPCs and migrations.

## Task specs

**Task 0 (local, orchestrator): branch + plan commit.** The commit that adds this document is the pinned base of the implementation job (`sdk/cashu-send-swap-slice` off `b06a3b7`). The implementation job appends its delivery branch onto it.

**Task 1 (contribution, single implementer): the whole slice.** Edit exactly the seven files in the File map, applying the pinned seams verbatim. Working order:

1. **Read first:** `domain/send/send-api.ts`, `domain/send/send-api.test.ts`, `domain/receive/receive-api.ts`, `domain/receive/receive-api.test.ts` (`cashu.createSwap` at `:516–665` and the default-service abort-signal case at `:822–851`), `domain/sdk/sdk.ts`, `domain/sdk/sdk.test.ts`, `domain/send/cashu-send-swap-service.ts`, `domain/send/cashu-send-swap-repository.ts`. Match their structure, naming, and JSDoc style. Apply the step-13 plan-attack lessons: every nested callback param in a test fixture is annotated (TS7006 under `cashuDomain`'s `Partial<Record<string, unknown>>`; test files are typechecked, `packages/wallet-sdk/tsconfig.json:3`); the create-path fake wallet has a throwing `seed` getter; `SessionEndedError` is never retried by the flipped create hook.
2. **Contract + service + factory + wiring** (pinned seams). Existing quote methods and the step-13 quote tests stay behavior-identical. Confirm there is no in-package `CashuSendSwapService.create` caller that needs a one-argument compile check (there is none; the only caller is the hook this slice flips).
3. **Canary check (no edit):** grep the repo for `CashuSendSwapService`, `CashuSendSwapRepository`, `DomainError`, `ConcurrencyError` importers of `@agicash/wallet-sdk/temporary` after the flip. Each must still have one. Do not edit `temporary.ts`.
4. **Tests.** Extend `send-api.test.ts` in the existing harness style:
   - Fake `getSession` (existing `authUser` / `loggedIn` at `:24–38`).
   - Real `createSessionKeys` from `../sdk/session-keys`, with `keys.reset()` as the session-end trigger.
   - Seam injection. Fakes are typed `as unknown as CashuSendSwapService` / `CashuSendSwapRepository`, as the quote tests already do for the quote types (`:129–132`).
   - **`makeApi` grows.** Add `getAccountRepository: async () => ({}) as unknown as AccountRepository` and optional `swapRepository?` / `swapService?` seams that inject `createSwapRepository` / `createSwapService` (mirror `receive-api.test.ts:257–279`). Every existing `createSendApi({` in this file (the `makeApi` helper at `:125` and the direct calls in tests a, b, e, f, i, m, o) gains the same `getAccountRepository` fake so `Deps` typechecks. Quote tests do not invoke it.
   - Tests that need a **default** swap-service builder call `createSendApi` directly and omit `createSwapService`.

   New fixtures (next to `makeSendQuote`):
   - `makeSwapQuote(): CashuSwapQuote`: `{ amountRequested, amountToSend, totalAmount, totalFee, senderPaysFee: true, cashuReceiveFee, cashuSendFee }` as `Money<'BTC'>` via the existing `sats()` helper (`:80–81`).
   - `makeSendSwap(): CashuSendSwap`: cast, with `id: 'swap-1'`, `transactionId: 'tx-swap-1'`, `accountId: 'acct-cashu'`, `userId: 'user-x'`, `state: 'PENDING'`, non-empty `proofsToSend` / `inputProofs` (so the wrap test can see they ride along inside `swap` and do not leak as sibling keys on the result).

   Exact test list. Quote tests **a–i, k–m** stay; their assertions do not change (only the `getAccountRepository` dep is added to their `createSendApi` calls). There is still no test **j**.

   - **`cashu.getSwapQuote`:**
     - (q) **Passthrough:** calls `service.getQuote` with exactly `{ account, amount, senderPaysFee: true }` when the caller passes `senderPaysFee: true`. Assert with `toEqual` plus `captured.account` `toBe` the given account. Returns the service result verbatim (`toBe`). Build it with a counting `getSession` that returns `{ isLoggedIn: false }`: the call still resolves and `getSession` is called 0 times (decision 7: the preview never reads the session). Annotate the fake `getQuote` callback param (`params: Record<string, unknown>`) — TS7006 otherwise.
     - (r) **Mid-construction fence:** `createSwapService` calls `keys.reset()` before returning a service whose `getQuote` counts calls. Rejects `SessionEndedError`, with 0 service calls (pattern: `send-api.test.ts:181–209`).
     - (s) **Post-op fence:** the service's `getQuote` calls `keys.reset()` and then resolves. Rejects `SessionEndedError` (pattern: `:211–230`).
     - (t) **Error propagation:** a service rejection `new DomainError('Insufficient balance. …')` propagates as the **same instance** (`rejects.toBe(error)`).
     - (u) **Default service, no DB or mint work:** call `createSendApi` directly **without** `createSwapService`, with `createSwapRepository` returning a repository whose `create` increments a counter, and `getAccountRepository` returning `{ get: async () => { getCalls += 1; return null; } }` (annotate `get` if the fake is a method). The account `wallet` is `selectProofsToSend: (proofs: Proof[]) => ({ send: proofs, keep: [] })`, `getFeesForProofs: () => 0`, `getFeesEstimateToReceiveAtLeast: () => 0`, plus a throwing `seed` getter (TS7006: annotate `(proofs: Proof[])`; add `import type { Proof } from '@cashu/cashu-ts'` if not already imported — it is, `:3`). Proofs: one 64-sat proof with `secret: 's1'`. Call `getSwapQuote` with `amount: sats(64)`. Resolves a `CashuSwapQuote` whose `amountRequested` equals that amount and `senderPaysFee` is `true`. `create` counter stays 0. `accountRepository.get` counter stays 0 (construction of `CashuReceiveSwapService` must not read accounts). No mint method is on the fake wallet; if the service reached one the call would throw.

   - **`cashu.createSwap`:**
     - (v) **No session:** with `getSession: () => ({ isLoggedIn: false })`, throws `NoSessionError` before any construction. The `createSwapService`, `createSwapRepository`, and `getAccountRepository` call counters stay 0 (pattern: `receive-api.test.ts:517–550`).
     - (w) **Passthrough + wrap:** passes exactly `{ userId: 'user-x', account, amount, senderPaysFee: true }` (`account` `toBe` the given account, `amount` `toBe` the given `Money`) and `{ abortSignal: keys.sessionSignal() }` as the second argument (`toBe` identity on the signal). The service returns `makeSendSwap()`. Assert the result `toStrictEqual({ swap })`, `result.swap` `toBe` the service return, and `Object.keys(result)` equals `['swap']` (no leaked sibling `proofsToSend` / `id`). Annotate the fake `create` params (`params: Record<string, unknown>`, `options?: { abortSignal?: AbortSignal }`).
     - (x) **Default `senderPaysFee`:** called without `senderPaysFee`, the captured first argument's sorted keys are exactly `['account', 'amount', 'senderPaysFee', 'userId']`, and `senderPaysFee` is `true`. No extra fields.
     - (y) **Mid-construction fence:** `createSwapService` calls `keys.reset()`. Rejects `SessionEndedError`, and `create` is never called.
     - (z) **Post-op fence:** `create` calls `keys.reset()` and then resolves `makeSendSwap()`. Rejects `SessionEndedError`, so no `{ swap }` comes back for an ended session.
     - (aa) **Retry-relevant errors propagate unchanged:** a `ConcurrencyError` from the service rejects as the **same instance**. The web retry policy depends on `instanceof ConcurrencyError` (`cashu-send-swap-hooks.ts:186`).
     - (ab) **`DomainError` identity:** a `DomainError('Insufficient balance. …')` from the service rejects as the **same instance**.
     - (ac) **Abort-signal identity and seed non-access through the real default service.** Call `createSendApi` directly **without** `createSwapService`, with `keys = createSessionKeys({ readCashuSeed: async () => { throw new Error('cashu seed must not be read'); } })`, `getAccountRepository` returning `{ get: async () => { throw new Error('accountRepository.get must not be called'); } }`, and `createSwapRepository` returning `{ create }`. `create` records `(args, options)` and returns `makeSendSwap()`.
       - Account: `cashuDomain` with `proofs: [{ id: 'p1', keysetId: 'ks-1', amount: 64, secret: 's1', unblindedSignature: 'C1' }]` and `wallet: { selectProofsToSend: (proofs: Proof[]) => ({ send: proofs, keep: [] }), getFeesForProofs: () => 0, getFeesEstimateToReceiveAtLeast: () => 0, getKeyset: () => { throw new Error('wallet.getKeyset must not be read on the exact-proofs path'); }, get seed(): Uint8Array { throw new Error('wallet.seed must not be read'); } }`. The `(proofs: Proof[])` annotation is required (TS7006; step-13 plan-attack).
       - Amount: `sats(64)` so `prepareProofsAndFee`'s exact-proofs branch fires (`cashu-send-swap-service.ts:335–341`) and `create` takes the `getTokenHash` path (`:138–144`), not `wallet.getKeyset()` (`:146`).
       - Assert that the call resolves to `{ swap }` with `result.swap` `toBe` the repository return (or `toStrictEqual({ swap: makeSendSwap() })` if the fixture is rebuilt — prefer one fixture instance and `toBe`).
       - Assert `options?.abortSignal` `toBe(keys.sessionSignal())`. This locks the new service → repository hop, which (w)'s fake service cannot see.
       - Assert `args.userId === 'user-x'`, `args.accountId === 'acct-cashu'`, `args.tokenHash` is a non-empty string (local SHA-256 of the encoded token), and `args.keysetId` / `args.outputAmounts` are `undefined` (exact-proofs path).
       - Neither the `readCashuSeed` error, nor the fake wallet's throwing `seed` getter, nor `getKeyset`, nor `accountRepository.get` fires.

   - **Unimplemented members (edit in place):**
     - (n) **Replace** the current assertions on `api.cashu.getSwapQuote` / `api.cashu.createSwap` (`send-api.test.ts:544–551`). Accessing `api.resolveDestination` and `api.spark` each still throws `NotImplementedError` with messages `'send.resolveDestination is not implemented yet.'` and `'send.spark is not implemented yet.'`. `typeof api.cashu.getSwapQuote === 'function'` and the same for `createSwap`. Do **not** call the new functions in this test.
     - (o) **Lazy construction (edit in place):** same counting `createRepository` / `createService` / `createSwapRepository` / `createSwapService` / `getSession` / `getAccountRepository` seams. Construct the api, access `api.cashu`, assert `typeof cashu.getSwapQuote === 'function'` and `typeof cashu.createSwap === 'function'`, and trigger the remaining throwing getters (`api.resolveDestination`, `api.spark`) inside `expect(...).toThrow`. Every counter stays 0, including `getAccountRepository`. Construction does no I/O; `sdk.ts` calls the factory in the constructor, and `AgicashSdk.create` is sync with no I/O (`sdk.ts:196–204`).

   **`sdk.test.ts` (p), edit in place:** keep the `describe('AgicashSdk namespaces')` / `try/finally { await sdk.dispose(); }` structure (`sdk.test.ts:81–97`). Change the test title to `'wires send: cashu quote and swap methods are callable; unlanded send members throw NotImplementedError'`. Assertions:
   - `sdk.send` does not throw, and `sdk.send` `toBe` `sdk.send`.
   - `typeof sdk.send.cashu.getLightningQuote === 'function'`, and the same for `createQuote`, `getSwapQuote`, and `createSwap`.
   - `expect(() => sdk.send.spark).toThrow(NotImplementedError)`, and the same for `sdk.send.resolveDestination` and `sdk.transfer`.
   - **Delete** the two `toThrow` assertions on `sdk.send.cashu.getSwapQuote` / `createSwap` (`:91–92`).

   Existing suites (`receive-api.test.ts`, the other `*-api.test.ts`, the quote half of `send-api.test.ts`, the other `sdk.test.ts` cases) stay green. Do not re-letter tests a–i, k–m.

5. **Web flip** (pinned). The flipped hooks must not reference `useCashuSendSwapService` or `useUser`. Every other hook, the cache classes, the change handlers, and `useProcessCashuSendSwapTasks` stay byte-identical.

**Gates in the implementer's fork, all mandatory:**
- `bun install --frozen-lockfile`
- `bun run fix:all` exits 0, then `git status --porcelain` lists only the seven File-map paths (`fix:all` is a repo-wide `biome check --write`; revert any other file it touched)
- `bun run typecheck` exits 0
- `cd packages/wallet-sdk && bun test` is green: the existing suites plus `send-api.test.ts` a–i, k–o, q–ac and the updated `sdk.test.ts` case p
- `cd apps/web-wallet && bun test` is green

The delivered branch's changed-file set must equal the seven-file list exactly. The orchestrator verifies this with `git archive` + `diff -rq`.

**Task 2 (local, orchestrator): integration, gates, smoke.** Merge the delivery onto the work branch, re-run all gates at the repo root, then run the smoke plan below. Check the network tab against the Foreground parity tables.

**Task 3 (marketplace): adversarial review** of the integrated diff against this plan. Focus prompts:
- Foreground parity (no added requests; `account` / `amount` caller-supplied; no in-SDK `accounts.get` / `list` / `user.get`; share page still a cache hit).
- Fence order versus `send-api.ts:47–75` / `receive-api.ts:130–179`, including **no** `requireUserId()` on the preview.
- `{ swap: CashuSendSwap }` wrap (not `{ transactionId }`, not bare).
- `CreateCashuSwapParams` mirrors the service (`amount`, not `swapQuote`).
- The `accountId`-in-hook exception and the ConcurrencyError reasoning behind it (decision 11).
- The flipped **create** hook returns `false` for `SessionEndedError` before any other retry rule; the preview hook has no `retry` option (decision 11).
- `senderPaysFee` optional with API default `true` (decision 2).
- Default swap-service construction of `CashuReceiveSwapService` via `getAccountRepository` without a host/processing split (decision 9) and without `AccountRepository.get` / seed reads on these paths (decision 12).
- Throwing-getter shape for `spark` / `resolveDestination` only (decision 6); tests n, o, p updated not duplicated.
- No canary prune (decision 10).
- The step-18 boundary: processor, reverse, change handlers, and unresolved reads untouched; completion verbs off the contract.

Findings route back through the orchestrator; only confirmed findings trigger a fix cycle.

## Verification summary

| Gate | Command | Expectation |
|---|---|---|
| Install | `bun install --frozen-lockfile` | exit 0, lockfile unchanged |
| Lint/format + write | `bun run fix:all` | exit 0; `git status --porcelain` lists only the seven File-map paths |
| Types (all pkgs) | `bun run typecheck` | exit 0 |
| SDK unit tests | `cd packages/wallet-sdk && bun test` | green (existing + `send-api.test.ts` a–i, k–o, q–ac + updated `sdk.test.ts` p) |
| Web unit tests | `cd apps/web-wallet && bun test` | green |
| Smoke | manual, browser, local stack | see below |

**Smoke plan** (local stack: `bun run dev`, local Supabase, guest signup):

Background facts:
- Guest signup provisions, in development mode only, **Testnut BTC** and **Testnut USD** cashu accounts on `https://testnut.cashu.space` with `isTestMint: true` (`domain/user/user-api.ts:39–62`), next to the default Spark BTC account (`:29–38`).
- Cashu accounts default to `CASHU_TOKEN` send type (`send-store.ts:21–23`, `:169–171`). No destination is required. The confirm route renders `CreateCashuTokenConfirmation` (`routes/_protected.send.confirm.tsx:61–68`).
- `getQuote` / `create` do **not** call the mint (decision 12). Spendable proofs are still required (`prepareProofsAndFee`, `cashu-send-swap-service.ts:347–358`). Steps 3–4 therefore need a funded testnut account; step 1 provides that.
- After `create`, the swap is `DRAFT` when input proofs must be swapped for the exact send amount, or `PENDING` when proofs are already exact (`20260420152512_denormalize_account_on_transactions.sql:652–657`; domain notes at `cashu-send-swap.ts:11–17`). The share page encodes a token only for `PENDING` / `COMPLETED` (`routes/_protected.send.share.$swapId.tsx:33–40`). The DRAFT → PENDING mint swap is `useProcessCashuSendSwapTasks` (`cashu-send-swap-hooks.ts:417–489`), still `/temporary` (step 18).
- Testnut fee rates are an external property. A non-zero fee means the common path is DRAFT + a processor mint swap; a zero-fee exact-proofs path is PENDING immediately. Both are valid; the share page waits either way.

Steps:

1. **Fund (runnable locally; needs internet to testnut).** Sign up as guest. Receive Lightning into **Testnut BTC** for e.g. 1,000 sat: `sdk.receive.cashu.createQuote`, step 9. Testnut auto-pays the mint quote when `fakewallet_brr` is on (external; if funding does not complete, testnut's config changed — use an already-funded test account or stop the positive smoke). The receive processor (`/temporary`) mints, and the balance shows 1,000 sat.
2. **Token preview (flipped hook a; runnable).** Send → choose **Testnut BTC** (default type is already Cashu token; do not paste an invoice) → enter e.g. 100 sat → Continue. `send-store.ts:343` → `sdk.send.cashu.getSwapQuote`. The confirmation page shows "Recipient gets", "Estimated fee", and total (`send-confirmation.tsx:341–357`).
   - Network: **no** mint HTTP (no `/v1/melt/quote`, no `/v1/swap`, no `/v1/keys`). **No** Supabase request. No Open Secret key read (encryption is already memoized). This is different from the step-13 lightning preview, which does one melt-quote POST.
   - Negative check: enter an amount larger than the balance. Expect the preview to fail with the service `DomainError` (`Insufficient balance. Total amount including fees is …`, `cashu-send-swap-service.ts:355–357`) toasted by the store (`send-store.ts:349–352`). No mint request, no write.
3. **Confirm (flipped hook b; runnable).** Click Confirm. `send-confirmation.tsx:332` → `sdk.send.cashu.createSwap`.
   - Network: exactly one `POST …/rest/v1/rpc/create_cashu_send_swap` to the local Supabase. No `accounts` select and no `users` select. No mint HTTP.
   - The app navigates to `/send/share/<swap.id>` (`send-confirmation.tsx:308`). That proves the `{ swap }` result exposed `swap.id` and that the hook unwrapped it.
4. **Share page landing (runnable; proves no added fetch).** The share route calls `useCashuSendSwap(params.swapId)` (`_protected.send.share.$swapId.tsx:16`).
   - Network on landing: **no** `GET …/cashu_send_swaps?id=eq.…` (cache hit from `cashuSendSwapCache.add`). `useAccount` is a cache read. `refetchOnWindowFocus: 'always'` (`cashu-send-swap-hooks.ts:252`) is master-identical and is not part of landing.
   - If the swap is DRAFT, `ShareCashuToken` renders without a token (`share-cashu-token.tsx:64`, `:33` of the route) until the processor finishes. That wait is step 18, not a new SDK request.
5. **Background swap + token appears (runnable with testnut; still `/temporary`).** For the DRAFT path the processor calls `swapForProofsToSend` (`cashu-send-swap-hooks.ts:433`): one mint `POST https://testnut.cashu.space/v1/swap` (or the cashu-ts equivalent send/swap). The swap becomes PENDING; the share page shows the QR / copyable token (`share-cashu-token.tsx:64–80`). The Testnut BTC balance drops by amount + fees. This step verifies the step-18 boundary is intact, not new SDK code. If the create path was already PENDING (exact proofs), the token is visible immediately and this mint POST is absent — also fine.
6. **Prove the token is claimable (runnable locally).** Copy the encoded token (or the shareable `/receive-cashu-token?…#…` link, `share-cashu-token.tsx:43–52`). In a **second** guest session (incognito or a second browser profile — a same-session self-claim of proofs still reserved/spent on the sender account is the wrong proof): Receive → paste the token → claim into that session's Testnut BTC account (same mint/unit). Step 10's `sdk.receive.cashu.createSwap` (same-account) or step 12's claim path runs. The second session's Testnut BTC balance rises by ~the sent amount minus receive fee. That is the claimability proof. Do **not** use a Spark account as the claim target (cross-rail is step 12 and needs FX).
7. **ConcurrencyError path (optional, runnable):** open the confirm page in two tabs for two token sends that would each select the same proofs. Confirm both quickly. The second either succeeds after retry with re-read proofs or fails with "Insufficient balance". It must **not** spin indefinitely. This exercises decision 11.
8. **Lightning send regression:** Send → Testnut BTC → paste a Testnut **USD** bolt11 (step-13 smoke) → Continue should still show the lightning quote (step-13 hooks are untouched). Do not need to confirm. Spark default-account send preview (step 15) should still work.

**Paths that cannot be run as a full money-path locally:**
- Send-to-token from a **non-test** mint: preview and `createSwap` are runnable against any real mint whose wallet is already initialized in the accounts cache (steps 2–4 apply unchanged: still 0 mint HTTP on those two calls), but the processor swap (step 5) and a third-party claim (step 6) hit that real mint.
- `senderPaysFee: false` is unimplemented (`cashu-send-swap-service.ts:303–306`) and has no UI control.

No console errors on any runnable path.

## Foreground parity accounting

Rule: the flipped flow adds **zero** network requests versus master. Notes for all three tables:
- **Encryption.** `keys.getEncryption()` is memoized per session (`session-keys.ts:200–262`) and warmed at session start: `user.provision` awaits `getAccountRepository()` (`user-api.ts:118–129`), whose builder calls `getEncryption` (`accounts-api.ts:38`), before `auth.session-started` seeds the accounts cache (`features/user/session-started.ts:15–20`). Master's `useEncryption()` is a warm suspense query (`_protected.tsx:88–92` prefetch). Encrypting the payload is local (`cashu-send-swap-repository.ts:130`).
- **`getAccountRepository` / `CashuReceiveSwapService` construction.** Construction only; no `AccountRepository.get`, no seed read, no mint HTTP (decision 9). Master constructs the same receive-swap service in `useCashuSendSwapService` (`cashu-send-swap-hooks.ts:44–50`) on every render of the flipped hooks.
- **Supabase JWT.** During the migration the SDK db client (`sdk.ts:145–149`, cached until 5 s before expiry by `db/supabase-session.ts`) and master's `agicashDbClient` (`features/agicash-db/database.client.ts`) each hold a separate third-party token. With both warm (the normal case: the SDK token is minted at provisioning and refreshed by every flipped read/write since step 5), this flow costs 0 token requests on both sides. If the SDK token has expired while the web token is warm, the flipped confirm costs one token exchange that master would not; the converse case favors the flipped path. This is the cross-cutting two-client cost of the migration period, shared by every flipped write since step 5, not specific to this slice; it ends when steps 18–19 remove the web db client. A shared token-source port is out of scope (Open question 3).

### A. Swap quote preview (`send-store.ts:343` → `getCashuSwapQuote`)

| Request | Master | Flipped | Notes |
|---|---|---|---|
| Mint HTTP (any) | 0 | 0 | `getQuote` is `selectProofsToSend` / `getFeesForProofs` / `getFeesEstimateToReceiveAtLeast` on the caller-supplied wallet (`cashu-send-swap-service.ts:67–72`, `:325–367`; `packages/cashu/src/utils.ts:221–231`). |
| Supabase (any) | 0 | 0 | Preview persists nothing; send-swap repository unused. |
| Open Secret key read | 0 | 0 | Encryption memoized; no seed read (decision 12). `getAccountRepository` constructs only (decision 9). |
| Account / user re-fetch | 0 | 0 | `account` from the store (`send-store.ts:327`, `getSourceAccount`). |
| Retry | 0 | 0 | No `retry` option; TanStack mutation default 0. |
| **Net added** | | **0** | |

### B. Confirm / create swap (`send-confirmation.tsx:332` → `useCreateCashuSendSwap`)

| Request | Master | Flipped | Notes |
|---|---|---|---|
| Supabase RPC `create_cashu_send_swap` | 1 | 1 | Same args: `userId` now from the session instead of `useUser`, both the same identity. |
| Accounts cache lookup | 0 network | 0 network | `getCashuAccount(accountId)` kept per attempt (decision 11). |
| User read | 0 (`useUser` cache) | 0 (session) | |
| Mint HTTP | 0 | 0 | `create` is local proof math + `getTokenHash` / `wallet.getKeyset()`; the mint swap runs later in the processor. |
| Retries on `ConcurrencyError` | 1 RPC per attempt, fresh proofs | same | Recovery preserved. |
| Post-create processor (`swapForProofsToSend`, complete) | unchanged | unchanged | `/temporary`, step 18. |
| **Net added** | | **0** | |

### C. Landing on the share page (`/send/share/$swapId`)

| Request | Master | Flipped | Notes |
|---|---|---|---|
| `GET cashu_send_swaps?id=eq.<id>` | 0 | 0 | `useCashuSendSwap` (`cashu-send-swap-hooks.ts:233–254`) hits `cashuSendSwapCache.add(swap)` (`:62–66`, `:194–196`) via `queryKey [CashuSendSwapCache.Key, id]` and `staleTime: Infinity`. `{ transactionId }` would have made this 1 (decision 4). |
| `useAccount(swap.accountId)` | 0 network | 0 network | Accounts cache (`:256`). |
| Mint HTTP | 0 on landing | 0 on landing | Token encode is local (`share-cashu-token.tsx:43–44`). A later DRAFT→PENDING mint swap is the processor (table B). |
| Window-focus refetch | 1 select (master) | 1 select (flipped) | `refetchOnWindowFocus: 'always'` (`:252`) is unchanged and is not landing. |
| **Net added** | | **0** | |

## Out of scope

- **Background processing (step 18):** `useProcessCashuSendSwapTasks` (`swapForProofsToSend`, `complete`), `useOnProofStateChange`, the change handlers, the unresolved-swaps query, `useCashuSendSwap` / `useTrackCashuSendSwap`, `useReverseTransaction` (`transaction-hooks.ts:219–257`), and `useCashuSendSwapService` / `useCashuSendSwapRepository`.
- **The send/receive repo/service host/processing split:** step 18. This slice constructs a `CashuReceiveSwapService` the host verbs never call rather than splitting `CashuSendSwapService`.
- **`resolveDestination`:** stays throwing; contract shape unresolved (step-13 decision 5, Open question 1).
- **`send.spark.*` (step 15)** and **transfer (step 16).**
- **`senderPaysFee: false`:** the service still throws (`cashu-send-swap-service.ts:303–306`). No UI control. Not this slice.
- **`temporary.ts` pruning:** none made dead (decision 10). `index.ts`, `events.ts`, `.server.ts`: untouched.
- **No DB schema, RPC, dependency, or migration changes.**
- **`SessionEndedError` retries in hooks this slice does not rewrite** (receive hooks from steps 9–12; this slice's preview hook has no `retry` option and is left that way). Follow-up, not this slice.
- **A shared Supabase token source between the web and SDK db clients** (Foreground parity, "Supabase JWT"; Open question 3).
- **`#1164` narrowing** of `CashuSendSwap` fields (proofs, `userId`) that ride along inside `{ swap }` (`send.ts:8–10`).

## Open questions

1. **`resolveDestination` contract shape and owner.** Carried from step 13. The contract has `(input: string) => Promise<DestinationDetails>` (`send.ts:16`), while the implementation takes `string | Contact` plus `{ allowZeroAmountBolt11 }` and returns a `SendDestination` result union. Which step owns reconciling them (15, 19, or a dedicated slice)? This does not block step 14.
2. **Testnut FakeWallet settings** are external. If testnut ever disables brr, smoke step 1 stops completing locally, and steps 2–4 (the two flipped calls plus share landing) then need an already-funded test account, because `getQuote` / `create` check for spendable proofs. A local Nutshell FakeWallet mint would remove the dependency, but that is tooling outside this slice.
3. **Two Supabase token caches during the migration.** The SDK db client and the web `agicashDbClient` each mint and cache their own Open Secret third-party token (Foreground parity, "Supabase JWT"). A flipped write can therefore cost one token exchange that master would not, when only the SDK token has expired. Every slice since step 5 shares this; it disappears when steps 18–19 remove the web db client. Should the maintainer want it closed earlier, the shape is an optional `SdkConfig` token-source port that the web wires to its own cache. Not part of step 14.
