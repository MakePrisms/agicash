# Wallet SDK Receive Cashu Token Slice (Step 12) Implementation Plan

> **Orchestration note:** like steps 10 and 11, this slice ships as **one whole-slice contribution job**. A separate implementer forks the repo at the base of a new `sdk/receive-cashu-token-slice` branch (off `master`), reads this plan and the referenced code in the fork, and delivers the SDK namespace extension + tests + web flip + canary prune together on a branch descending from the base. The orchestrator then integrates locally and runs the gates from the Verification summary; adversarial review of the integrated diff follows. Job text stays task-only; this document is the full spec.

**Goal:** Implement the `receive.cashuToken` sub-namespace of the SDK contract (`createQuotes` + `claim`) and flip the web cross-account token-quote creation and the protected token-route auto-claim from `@agicash/wallet-sdk/temporary` to `sdk.receive.cashuToken.*`.

**Architecture:** Step 12 of the 19-step no-cache extraction (spec: `docs/superpowers/specs/2026-06-24-wallet-sdk-no-cache-production-design.md`, step list line 90). The already-moved `domain/receive` token-claim code (`receive-cashu-token-quote-service.ts`, `claim-cashu-token-service.ts`, `receive-cashu-token-service.ts`, `receive-cashu-token-models.ts`, `cashu-token-melt-data.ts`) gets its two host-initiated verbs exposed through the step-9 `createReceiveApi` factory — replacing the `receive-api.ts` throwing `get cashuToken()` getter (`NotImplementedError('receive.cashuToken')` at `receive-api.ts:200–202`), which is the seam this slice fills. `sdk.ts` needs no change: the `receive` namespace was wired in step 9 (`sdk.ts:182–187`); the factory's return object just grows. This is a **money-path slice**: the web background processors that complete CASHU_TOKEN quotes (`useProcessCashuReceiveQuoteTasks` melt + `completeReceive`, `useProcessSparkReceiveQuoteTasks` melt + `complete`) keep using `/temporary` until step 18 — the same boundary style as steps 9–11. Same-mint interactive claim already goes through `sdk.receive.cashu.createSwap` (step 10) and is not re-bound here.

**Tech stack:** TypeScript, bun workspaces, bun:test, Supabase (postgrest-js), TanStack Query v5 (web side only).

## Global constraints

- **Param precedent (binding, set by the #1176 review):** contract methods take the caller-supplied full domain objects (`token`, `sourceAccount`, `destinationAccount`, `accounts`, `user`), never an id the SDK re-fetches. Fetch-by-id is reserved for paths with no caller state (background/orchestrator work, server routes). A flipped web flow must issue no additional network requests versus master. Binding text: production design → "Corollary (foreground parity)" (`docs/superpowers/specs/2026-06-24-wallet-sdk-no-cache-production-design.md:31–37`); contract proposal → "Conventions across all namespaces" (`docs/superpowers/specs/2026-07-02-wallet-sdk-contract-proposal.md:297–316`). The merged step-9/10/11 `receive-api.ts` / `domain/sdk/receive.ts` are authoritative — the step-9 *plan*'s `accountId` text predates the review.
- **No host/processing split.** Do not split any receive/send repo or service into host and processing halves — the spec assigns that to step 18 explicitly ("Split the receive/send repos + services along the host/processing line", step-18 bullet at production-design.md:100–107). This slice wraps the bundled classes as they are; `completeSwap` / `completeReceive` / `complete` / `markMeltInitiated` / `fail` just never appear on the contract. They may still run *inside* `claim` (master's loader already calls them in-band; see decision 11).
- The SDK stays React-agnostic: `packages/wallet-sdk` never imports `react` or `@tanstack/react-query`.
- **No SDK event emission.** `domain/sdk/events.ts` is untouched. Token-claim has no dedicated event names; quote/swap `created`/`updated` stay type-only until the step-18 realtime feed.
- No DB schema, RPC, dependency, or migration changes. The RPCs (`create_cashu_receive_quote`, `create_spark_receive_quote`, `create_cashu_receive_swap`, `complete_cashu_receive_swap`, `complete_cashu_receive_quote`, `complete_spark_receive_quote`) and the `accounts` insert are used unchanged.
- Session fences follow the merged `receive-api.ts` template (`cashu.createQuote` at `receive-api.ts:116–134`, `cashu.createSwap` at `:143–154`, `spark.createQuote` at `:172–189`): `requireUserId()` → capture `sessionSignal()` → await the service builder → re-check → call with `{ abortSignal: signal }` → re-check. A result is never returned for an ended session.
- **Canary rule for `temporary.ts`:** prune ONLY the re-exports this flip makes dead, verified by repo-wide grep. List is decision 12. Do not prune pre-existing dead re-exports.
- Do not touch other domains' `/temporary` imports — only the files listed in this plan. Laggard consumers with their own future slices stay untouched (decision 10).
- Root `packages/wallet-sdk/index.ts` is untouched: `export * from './domain/sdk'` (line 10) carries the four new param/result types; `CrossAccountReceiveQuotesResult` (index.ts:99), `CashuAccountWithTokenFlags` / `ReceiveCashuTokenAccount` (index.ts:95–98), `Account` / `User`, and `CashuTokenMeltData` (index.ts:85) are already exported at the root. The `receive` namespace was wired in step 9 (`sdk.ts:182`); the factory's return object just grows. **`domain/sdk/sdk.ts`, `domain/sdk/index.ts`, and `domain/sdk/sdk.test.ts` are untouched** — step 11 already fulfilled the `Sdk.init()` WASM obligation (`sdk.ts:208–212`). The contract-proposal doc is untouched (its `cashuToken` sketch at line 152 is representative only; "exact param types settle in each slice PR" per its own text at line 173).
- **`.server.ts` twins are untouched** (step 17's `ServerSdk`).
- **Background/processing verbs never appear on the contract.** The public `cashuToken` verbs this slice lands are `receive.cashuToken.createQuotes(params)` and `receive.cashuToken.claim(params)`. The placeholder member `getQuote` at `domain/sdk/receive.ts:45–47` is a step-4 sketch name for an operation that persists, so this slice **renames it to `createQuotes`** (contract proposal `:302–306`: `get*` = stateless preview, `create*` = persists, "a slice never re-decides which is which"). Nothing calls the placeholder yet (`receive.ts:106–109` are `unknown`; the getter throws), so the rename costs nothing. The four param/result types currently sit as `unknown` placeholders at `receive.ts:106–109`.
- Package manager: `bun` / `bunx` only. Base branch: `master`. Work branch: `sdk/receive-cashu-token-slice`.

## Resolved design decisions

1. **Slice scope = the two host-initiated token-claim verbs, not the page-load account-discovery class and not the processors.** Evidence: repo-wide grep shows exactly two web host-side entry points this slice must flip — (a) `useCreateCrossAccountReceiveQuotes` (`receive-cashu-token-hooks.ts:271–305`), called from the **cross-account branch** of `receive-cashu-token.tsx:176–184`; (b) the protected route `clientLoader` (`_protected.receive.cashu_.token.tsx:162–173`) which builds `ClaimCashuTokenService` via `getServices()` (`:46–97`) and calls `claimToken` when `?claimTo=` is present. The same-mint interactive branch already calls `sdk.receive.cashu.createSwap` (`cashu-receive-swap-hooks.ts:100–108`, flipped in step 10). Neighbors stay put: spark receive quote = step 11 (done), cashu/spark sends = steps 13–15, transfer = step 16, LNURL server = step 17, processors = step 18. Step 10's neighbor note assigned "cross-account token claim (`createCrossAccountReceiveQuotes` in `receive-cashu-token-hooks.ts` + the token route) = step 12" (`docs/superpowers/plans/2026-08-18-wallet-sdk-cashu-receive-swap-slice.md` decision 1).

2. **`createQuotes` wraps `ReceiveCashuTokenQuoteService.createCrossAccountReceiveQuotes` and returns that persist result; account candidates are inputs to `createQuotes` plus an internal of `claim`, not a third verb.** The contract-proposal `cashuToken` sketch (`2026-07-02-wallet-sdk-contract-proposal.md:152–155`) names this member `getQuote`, but it is representative only (`:173`: exact shapes settle per slice). The binding `get*`/`create*` convention (`:302–306`) says `get*` is a stateless preview and `create*` persists — and `createCrossAccountReceiveQuotes` **does** persist: the cashu branch calls `cashuReceiveQuoteService.createReceiveQuote` (`receive-cashu-token-quote-service.ts:137–151`) which RPCs `create_cashu_receive_quote`; the spark branch calls `sparkLightningReceiveService.createReceiveQuote` (`:168–181`) which RPCs `create_spark_receive_quote`. So the verb is **`createQuotes`** — plural because it persists a receive quote plus its melt quote (`CrossAccountReceiveQuotesResult`) — matching steps 9–11 (`createQuote` / `createSwap` for persist) and keeping `getQuote(id)` a plain read everywhere on `ReceiveApi` (`receive.ts:30`, `:42`). The contract-proposal doc stays untouched (representative sketch). Rejected alternatives:

   - Keeping the sketch name `getQuote` for a persisting call as a "pinned-verb exception" — that is exactly the re-decision the convention forbids, it would make `getQuote` mean two things on one `ReceiveApi`, and a shipped exception becomes precedent for the send slices 13–16.
   - `claim` is taken by the loader orchestrator (decision 3). Folding persist-quotes into `claim` would make the interactive Claim button run `claimToken`'s `tryCompleteSwap` / `meltProofsIdempotent` / `tryCompleteReceive` (`claim-cashu-token-service.ts:125–180`) and **add** mint HTTP versus master's UI path, which only persists quotes and lets the processor melt (`cashu-receive-quote-hooks.ts:686–723`, `spark-receive-quote-hooks.ts:595`). That violates foreground parity.
   - Splitting fee-fitting HTTP (`getCrossMintQuotesWithinTargetAmount`, `:201–269`) from persist would be a new two-step protocol; the mint/melt quotes would race expiry between `createQuotes` and `claim`. Do not split.

   **How account candidates fit** (`buildAccountForMint` at `receive-cashu-token-service.ts:36–107`, `getSourceAndDestinationAccounts` at `:115–160`, `createSparkWalletStub` at `lib/spark/wallet.ts:39`):

   - **Inputs to `createQuotes`:** the interactive UI has already resolved source + destination on page load (`useReceiveCashuTokenAccounts` → `getSourceAndDestinationAccounts` at `receive-cashu-token-hooks.ts:201–214`; `:68–90` is `useCashuTokenSourceAccountQuery`). It passes those objects in (`CreateCrossAccountReceiveQuotesProps` at `:254–264`). The SDK does not re-resolve and does not re-fetch accounts.
   - **Internal to `claim`:** `claimToken` already calls `getSourceAndDestinationAccounts` + `getDefaultReceiveAccount` + maybe `buildAccountForMint` (`claim-cashu-token-service.ts:91–107`) against the **caller-supplied** `accounts` array. Same mint HTTP as master when the mint is unknown; zero account-table reads.
   - **Logged-out placeholders stay host-side on `/temporary`:** `useReceiveCashuTokenAccountPlaceholders` (`receive-cashu-token-hooks.ts:370–392`) calls `buildAccountForMint` (mint HTTP, no DB, no session) and `createSparkWalletStub` (local Proxy, **zero** Breez). The public page has no session, so it cannot call `createQuotes`/`claim` (`requireUserId`). `ReceiveCashuTokenService` therefore stays exported from `/temporary`. `createSparkWalletStub` stays on `export * from './lib/spark'` (temporary.ts:41). Not a contract verb.

3. **`claim` wraps `ClaimCashuTokenService.claimToken`. Params are the caller-supplied token + `claimTo` selector + accounts array + user object; the SDK builds the service graph internally.** Master's loader (`_protected.receive.cashu_.token.tsx:162–173`) already holds `user` (`getUserFromCacheOrThrow`, `:163`), `accounts` (`queryClient.fetchQuery(accountsQueryOptions())`, `:166` — TanStack cache, usually warm from the protected layout's `sdk.accounts.list()`), `token` (decoded in the same loader), and `claimTo`. Passing those objects adds zero reads versus an in-SDK `accounts.list()` / `user.get()` which would re-select proofs-inclusive rows and re-init wallets (the exact #1176 failure mode). `userId` for writes still comes from `requireUserId()` as the session fence; `params.user` is the cached `User` `claimToken` needs for `getExtendedAccounts` (`claim-cashu-token-service.ts:85`, `user-service.ts:28–38`). They are the same session identity the layout already loaded.

   What the SDK builds internally (mirroring `getServices()` at `_protected.receive.cashu_.token.tsx:46–97` and step-9/11 wiring):

   - `CashuCryptography` from session keys — already assembled in the factory (`receive-api.ts:49–54`); reused via existing `getService()`. `getPrivateKey` is only reachable through `completeReceive` (`cashu-receive-quote-service.ts:310`), which `claim` may invoke in-band on the cashu-destination complete path (master already does; decision 11) and which `createQuotes` never invokes.
   - `getAccountRepository: accounts.getRepository` bridge — already on `Deps` (`receive-api.ts:23–24`), wired in `sdk.ts:186`. Feeds `AccountService` for the unknown-mint `addCashuAccount` (`claim-cashu-token-service.ts:110–117`) and the quote/swap repositories (already).
   - Spark services — already on the factory (`getSparkService`, `receive-api.ts:97–100`). `sdk.init()` WASM is already fulfilled (step 11, `sdk.ts:208–212`); spark destination uses `account.wallet` from the caller-supplied object (no SDK wallet fetch).
   - Exchange rate — factory default builder passes `(ticker) => exchangeRateService.getRate(ticker)` (`domain/exchange-rate/exchange-rate-service.ts:80–82`, already a root export via `index.ts:13`). Same-currency tickers short-circuit to `'1'` with zero HTTP (`exchange-rate-service.ts:28–29`). Guest smoke paths are BTC token → cashu testnut or BTC spark, so FX is local. `exchangeRateService` has **no cache** (`exchange-rate-service.ts:39–54`, `:80–82`: module singleton, one provider GET per call), while master's loader passed `(ticker) => getExchangeRate(queryClient, ticker)` (`_protected.receive.cashu_.token.tsx:93`), a TanStack wrapper. `claimToken` resolves the destination before it needs the rate (`claim-cashu-token-service.ts:91–101`, then `:147–149`), so the loader cannot pre-supply the rate without duplicating `getSourceAndDestinationAccounts`. Consequence: on a **cross-currency** `?claimTo=` auto-claim with a warm TanStack FX cache the flipped path can issue one extra provider GET versus master. Same-currency (every guest/testnut smoke path) is `'1'` with zero HTTP on both sides. This is a documented parity delta of the slice (see accounting table E); do not "fix" it with a react-query getter (SDK stays React-agnostic) and do not move FX resolution into `createQuotes` — there the hook's cached rate is the parity-preserving input.

   `claimTo` stays the `'cashu' | 'spark'` selector (`claim-cashu-token-service.ts:56`, `getClaimTo` at `_protected.receive.cashu_.token.tsx:130–137`). The SDK does **not** take a destination account on `claim`: the loader never selected one — `claimToken` resolves it via `getDefaultReceiveAccount` + the spark-preferred id when `claimTo === 'spark'` (`claim-cashu-token-service.ts:86–101`). Passing a destination the loader does not hold would invent a host-side resolution the current loader does not do.

   `requireUserId()` is the session fence; the persisted user id is `params.user.id` (`claim-cashu-token-service.ts:112`, `:126`, `:153`) because `getExtendedAccounts` needs the wallet `User` with its default-account ids, which the session's `AuthUser` (`domain/sdk/auth.ts:26–30`) does not carry. Do not replace `user` with a `userId`. Master's loader has the same implicit trust; no `params.user.id === session user` runtime check is added (parity).

4. **`ClaimCashuTokenResult` is master's `ClaimTokenResult` verbatim, so the route can apply cache upserts with no extra reads.** Evidence: `claim-cashu-token-service.ts:21–29` returns `{ success: true, receiveAccount, changedAccounts } | { success: false, message, error? }`. The route (`_protected.receive.cashu_.token.tsx:175–186`) upserts `result.changedAccounts` into `AccountsCache` and passes `result.receiveAccount` to `trySetReceiveAccountAsDefault` (`:105–128`, already `sdk.user.setDefaultAccount` — web-only UX, stays in the route). Failure uses `result.message` + optional `result.error` (`:187–198`). Exporting any narrower shape would force the route to re-read accounts. `ClaimTokenResult` stays a local type in the service file (importing the contract type from `domain/sdk/receive.ts` would cycle); the API returns the service result, which is structurally the contract type.

5. **`receive-api.ts` grows additively.** Two new optional test seams on `Deps` (`createTokenQuoteService?`, `createClaimService?`) next to the existing quote/swap/spark seams, two lazy default builders, and a plain `cashuToken` property replacing the throwing getter. Existing `cashu` / `spark` methods, `cryptography` const, fences, and seams stay byte-identical. The token-quote default builder is `new ReceiveCashuTokenQuoteService(await getService(), await getSparkService())` — same pair `getServices()` / `useReceiveCashuTokenQuoteService` already assemble (`_protected.receive.cashu_.token.tsx:82–85`, `receive-cashu-token-hooks.ts:37–44`). The claim default builder is `new ClaimCashuTokenService(new AccountService(await deps.getAccountRepository()), await getSwapService(), await getService(), await getSparkService(), new ReceiveCashuTokenService(), await getTokenQuoteService(), (ticker) => exchangeRateService.getRate(ticker))` — same graph as `getServices()` (`:54–94`) with session keys instead of the query-client seed/mnemonic/encryption getters.

6. **`createCrossAccountReceiveQuotes` and `claimToken` each gain an optional `options?: { abortSignal?: AbortSignal }` last param**, matching steps 9–11 (`cashu-receive-quote-service.ts:59–61`, `cashu-receive-swap-service.ts:54`, `spark-receive-quote-service.ts:33`). Threaded to the writes that already accept it: both `createReceiveQuote` calls inside `createCrossAccountReceiveQuotes` (`receive-cashu-token-quote-service.ts:139, 169`); `accountService.addCashuAccount` (`account-service.ts:14–34` already takes `options`), `receiveSwapService.create`, and `createCrossAccountReceiveQuotes` inside `claimToken`. Backward-compatible: today's only callers are the web hook this slice replaces and `claimToken` itself (in-package, updated in the same PR to pass `options` through). Mint HTTP (`createLockedMintQuote`, `createMeltQuoteBolt11`, `getInitializedCashuWallet`, `meltProofsIdempotent`) and Breez (`receivePayment`, `waitForSparkReceiveToComplete`) cannot be aborted — pre/post signal checks only, same stance as step-9's mint HTTP and step-11's Breez call. `completeSwap` / `completeReceive` / spark `complete` signatures are unchanged (processing verbs; step 18 decides their threading).

7. **Session fences follow the merged step-9/10/11 template.** Both methods call `requireUserId()` because both persist (`p_user_id` on the quote/swap rows; `accounts.user_id` on add). `createQuotes` and `claim` are never invoked logged-out (public page uses placeholders; see decision 2). A result is never returned for an ended session.

8. **The `cashuToken` getter stops throwing and returns the implemented sub-namespace.** This deletes `NotImplementedError('receive.cashuToken')` from `receive-api.ts:200–202`. After this slice, `NotImplementedError` is unused in `receive-api.ts` — delete `NotImplementedError` from the `../../lib/error` import at `receive-api.ts:4–8` (keep `NoSessionError`, `SessionEndedError`).

9. **Web flip = the cross-account hook plus the route loader. `getServices()` disappears entirely. `receive-cashu-token.tsx` is untouched.**

   - **Route** (`_protected.receive.cashu_.token.tsx`): delete `getServices` (`:46–97`) and every import that existed only to build it (`AccountRepository`, `AccountService`, `CashuReceiveQuoteRepository`/`Service`, `CashuReceiveSwapRepository`/`Service`, `ClaimCashuTokenService`, `ReceiveCashuTokenQuoteService`, `ReceiveCashuTokenService`, `SparkReceiveQuoteRepository`/`Service`, `getCashuCryptography` + `seedQueryOptions`, `encryptionQueryOptions`, `sparkMnemonicQueryOptions`, `agicashDbClient`, `breezApiKey`, and `getExchangeRate` from `~/hooks/use-exchange-rate` (`:40`, used only at `:93`) — biome `noUnusedImports` is an error). The `claimTo` branch (`:162–173`) becomes `sdk.receive.cashuToken.claim({ token, claimTo, accounts, user })`. Cache apply, default-account nicety, gift-card redirect, toasts, `decodeCashuToken` (still `/temporary` — also used by `_public.receive-cashu-token.tsx:2`), and `sdk` (already imported at `:37`) stay. This is the step-9/10/11 hook-body flip applied to a route loader: the host stops constructing the service graph.
   - **Hooks** (`receive-cashu-token-hooks.ts`): `useCreateCrossAccountReceiveQuotes` (`:271–305`) keeps fetching the rate via `useGetExchangeRate` (caller-supplied `exchangeRate` string — param precedent, zero extra FX vs master) and calls `sdk.receive.cashuToken.createQuotes({ token, sourceAccount, destinationAccount, exchangeRate })`. Delete `useUser` (only used at `:272` in this file), `useReceiveCashuTokenQuoteService` (`:37–44`), and the `useCashuReceiveQuoteService` / `useSparkReceiveQuoteService` imports that existed only to build it. `CreateCrossAccountReceiveQuotesProps` and the mutation's retry/`DomainError` behavior stay. Add `import { sdk } from '~/features/shared/sdk.client';` (same as `cashu-receive-swap-hooks.ts:17` / `cashu-receive-quote-hooks.ts:42`).
   - **`receive-cashu-token.tsx` is byte-identical.** Same-mint still goes through `useCreateCashuReceiveSwap` → `sdk.receive.cashu.createSwap`. Cross-account still goes through `useCreateCrossAccountReceiveQuotes` (hook body flipped; `CreateProps` unchanged, so the call at `:176–184` does not move). Public `PublicReceiveCashuToken` is unchanged.
   - **Pure helpers stay on `/temporary` — none of them are root-exported today** (grep of `packages/wallet-sdk/index.ts` finds zero matches). Do not add them to `index.ts` this slice (precedent: steps 10–11 leave `index.ts` untouched; the contract proposal lists `tokenToMoney` / `decodeCashuToken` as eventual root exports at `:466–467`, not this PR). Live `/temporary` importers after this flip:
     - `tokenToMoney` — `receive-cashu-token.tsx:12`, `receive-cashu-token-hooks.ts:15`
     - `isClaimingToSameCashuAccount` — `receive-cashu-token.tsx:11` (temporary.ts:122)
     - `getAccountHomePath` — `receive-cashu-token.tsx:10` plus send/receive/buy surfaces (temporary.ts:96)
     - `accountRequiresGiftCardTermsAcceptance` — `receive-cashu-token.tsx:9` (temporary.ts:92)
     - `canSendToLightning` — `receive-cashu-token-hooks.ts:13` (temporary.ts:94)
     - `decodeCashuToken` — both token routes
     - `createSparkWalletStub` — `receive-cashu-token-hooks.ts:14` (via `export * from './lib/spark'`)
     - `ReceiveCashuTokenService` — page-load + placeholders (temporary.ts:125)

10. **Step-18 boundary (stays on `/temporary`):** `useCashuReceiveQuoteService` / `useSparkReceiveQuoteService` / their repository hooks, `useProcessCashuReceiveQuoteTasks` (CASHU_TOKEN melt: `initiateMelt` from `cashu-receive-quote-hooks.ts:686`; `completeReceive` mutation `:611–619`; `markMeltInitiated`), `useProcessSparkReceiveQuoteTasks` (CASHU_TOKEN melt at `spark-receive-quote-hooks.ts:595`), change handlers, pending-quote reads. `useReceiveCashuTokenService`, `useCashuTokenSourceAccountQuery`, `useReceiveCashuTokenAccounts`, `useReceiveCashuTokenAccountPlaceholders`, `useCashuTokenWithClaimableProofs` (mint `getUnspentProofsFromToken` via `@agicash/cashu`, not an SDK verb). `_public.receive-cashu-token.tsx`. `transaction-additional-details.tsx`. `task-processing.ts`. `use-track-wallet-changes.ts`. In-package `claimToken` still calls `createCrossAccountReceiveQuotes` directly (not through the API) — same process, no double fence.

11. **The `claimTo=spark` melt path is in scope inside `claim`, and out of scope as a processor verb.** Evidence: `claimToken`'s cross-account else-branch (`claim-cashu-token-service.ts:146–180`) always melts in-band (`sourceAccount.wallet.meltProofsIdempotent`, `:161–171`) and, for spark destinations, `waitForSparkReceiveToComplete` + `sparkReceiveQuoteService.complete` (`:229–240`). Master's loader auto-claim therefore already performs the cashu→spark Lightning payment in the foreground; wrapping `claimToken` preserves that. `CashuTokenMeltData` (`cashu-token-melt-data.ts:10–49`) is the persisted melt payload on CASHU_TOKEN quotes (`cashu-receive-quote.ts:101`, `spark-receive-quote.ts:92`) — used unchanged, file untouched. The **interactive** spark dest path does *not* melt in the mutation (only `createCrossAccountReceiveQuotes`); the processor melts later. That processor stays on `/temporary` until step 18 (decision 10). Do not add `markMeltInitiated` / `complete` to `cashuToken`.

12. **Canary prunes exactly two `/temporary` re-exports, both made dead by this flip:** `ReceiveCashuTokenQuoteService` (temporary.ts:123) and `ClaimCashuTokenService` (temporary.ts:124). After the hook + route edits, repo-wide grep must find zero importers outside `packages/wallet-sdk` internals (today: the route and `receive-cashu-token-hooks.ts` only). Re-verify before deleting. Do **not** prune `ReceiveCashuTokenService` (hooks still construct it), `isClaimingToSameCashuAccount`, `CashuTokenMeltDataSchema` (temporary.ts:110 — zero web importers already, pre-existing dead, step-19 cleanup), or any quote/swap/spark service class (processors).

13. **No SDK events, no `sdk.ts` / `index.ts` / `sdk.test.ts` / `.server.ts` changes** (see Global constraints). `cashu-token-melt-data.ts`, `receive-cashu-token-models.ts`, and `receive-cashu-token-service.ts` are untouched.

## Pinned seams (authoritative for the implementation)

Contract (`packages/wallet-sdk/domain/sdk/receive.ts`) — rename the `cashuToken` member (lines 44–49) to:

```ts
  cashuToken: {
    createQuotes(
      params: CreateReceiveCashuTokenQuotesParams,
    ): Promise<ReceiveCashuTokenQuotes>;
    claim(params: ClaimCashuTokenParams): Promise<ClaimCashuTokenResult>;
  };
```

and replace the four step-12 placeholder lines (106–109) with:

```ts
export type CreateReceiveCashuTokenQuotesParams = {
  /** The cashu token to receive. */
  token: Token;
  /**
   * The account to claim the token from. May be a placeholder account if the
   * token is from a mint the user does not yet have.
   */
  sourceAccount: CashuAccount;
  /** The account to claim the token to. */
  destinationAccount: Account;
  /** The exchange rate to use for cross-currency quotes, as a decimal string. */
  exchangeRate: string;
};

export type ReceiveCashuTokenQuotes = CrossAccountReceiveQuotesResult;

export type ClaimCashuTokenParams = {
  /** The cashu token to claim. */
  token: Token;
  /** Whether to claim the token to a cashu or spark account. */
  claimTo: 'cashu' | 'spark';
  /** The user's accounts, already loaded by the caller. */
  accounts: Account[];
  /**
   * The current user (for default-account flags). Must be the session user;
   * `requireUserId()` still gates the write.
   */
  user: User;
};

export type ClaimCashuTokenResult =
  | {
      success: true;
      /** The account the token was claimed into. */
      receiveAccount: Account;
      /** Accounts created or updated while claiming, for the caller to write into its cache. */
      changedAccounts: Account[];
    }
  | { success: false; message: string; error?: unknown };
```

Import changes on line 3: `import type { Account, CashuAccount, SparkAccount } from '../accounts/account';`. Add `import type { User } from '../user/user';` and `import type { CrossAccountReceiveQuotesResult } from '../receive/receive-cashu-token-quote-service';`. Everything else in the file stays byte-identical. (`SparkAccount` remains imported because the spark param types in the same file still need it.)

API factory (`packages/wallet-sdk/domain/receive/receive-api.ts`) — add to `Deps` after the spark seams:

```ts
/** Test seam; defaults to building the token-quote service from the cashu + spark services. */
createTokenQuoteService?: () => Promise<ReceiveCashuTokenQuoteService>;
/** Test seam; defaults to building the claim service from accounts + swap + cashu + spark + token-quote. */
createClaimService?: () => Promise<ClaimCashuTokenService>;
```

add builders next to the existing `getSparkService`:

```ts
const getTokenQuoteService =
  deps.createTokenQuoteService ??
  (async (): Promise<ReceiveCashuTokenQuoteService> =>
    new ReceiveCashuTokenQuoteService(
      await getService(),
      await getSparkService(),
    ));

const getClaimService =
  deps.createClaimService ??
  (async (): Promise<ClaimCashuTokenService> =>
    new ClaimCashuTokenService(
      new AccountService(await deps.getAccountRepository()),
      await getSwapService(),
      await getService(),
      await getSparkService(),
      new ReceiveCashuTokenService(),
      await getTokenQuoteService(),
      (ticker) => exchangeRateService.getRate(ticker),
    ));
```

and replace the throwing `get cashuToken()` getter (lines 200–202) with a plain `cashuToken` property after `spark` (fence order pinned):

```ts
cashuToken: {
  createQuotes: async (params) => {
    const userId = requireUserId();
    const signal = deps.keys.sessionSignal();
    const service = await getTokenQuoteService();
    if (signal.aborted) throw new SessionEndedError();
    const result = await service.createCrossAccountReceiveQuotes(
      {
        userId,
        token: params.token,
        sourceAccount: params.sourceAccount,
        destinationAccount: params.destinationAccount,
        exchangeRate: params.exchangeRate,
      },
      { abortSignal: signal },
    );
    if (signal.aborted) throw new SessionEndedError();
    return result;
  },
  claim: async (params) => {
    requireUserId();
    const signal = deps.keys.sessionSignal();
    const service = await getClaimService();
    if (signal.aborted) throw new SessionEndedError();
    const result = await service.claimToken(
      params.user,
      params.token,
      params.claimTo,
      params.accounts,
      { abortSignal: signal },
    );
    if (signal.aborted) throw new SessionEndedError();
    return result;
  },
},
```

New imports: `AccountService` from `../accounts/account-service`; `ClaimCashuTokenService` from `./claim-cashu-token-service`; `ReceiveCashuTokenQuoteService` from `./receive-cashu-token-quote-service`; `ReceiveCashuTokenService` from `./receive-cashu-token-service`; `exchangeRateService` from `../exchange-rate`. Delete the unused `NotImplementedError` import. The `cashu` / `spark` objects, `cryptography` const, and all existing seams/methods are byte-identical.

Service changes (`packages/wallet-sdk/domain/receive/receive-cashu-token-quote-service.ts`):

```ts
async createCrossAccountReceiveQuotes(
  {
    userId,
    token,
    sourceAccount,
    destinationAccount,
    exchangeRate,
  }: CreateCrossAccountReceiveQuotesProps,
  options?: { abortSignal?: AbortSignal },
): Promise<CrossAccountReceiveQuotesResult>
```

with both `this.cashuReceiveQuoteService.createReceiveQuote(...)` (line 139) and `this.sparkLightningReceiveService.createReceiveQuote(...)` (line 169) gaining `options` as the second argument. Nothing else in the file changes. `getCrossMintQuotesWithinTargetAmount` / `getLightningQuoteForDestinationAccount` stay private and do not take `abortSignal` (mint HTTP / Breez cannot abort).

Service changes (`packages/wallet-sdk/domain/receive/claim-cashu-token-service.ts`):

```ts
async claimToken(
  user: User,
  token: Token,
  claimTo: 'cashu' | 'spark',
  accounts: Account[],
  options?: { abortSignal?: AbortSignal },
): Promise<ClaimTokenResult>
```

`handleClaim` takes the same `options` and threads them to `this.accountService.addCashuAccount({ ... }, options)`, `this.receiveSwapService.create({ ... }, options)`, and `this.receiveCashuTokenQuoteService.createCrossAccountReceiveQuotes({ ... }, options)`. `tryCompleteSwap` / `tryCompleteReceive` / `waitForSparkReceiveToComplete` / `meltProofsIdempotent` signatures are unchanged. The local `ClaimTokenResult` type stays; it is structurally `ClaimCashuTokenResult`.

Web flip (`apps/web-wallet/app/features/receive/receive-cashu-token-hooks.ts`):

1. Add `import { sdk } from '~/features/shared/sdk.client';`.
2. Delete `ReceiveCashuTokenQuoteService` from the `/temporary` import block (lines 9–16); keep `DomainError`, `ReceiveCashuTokenService`, `canSendToLightning`, `createSparkWalletStub`, `tokenToMoney`. Delete the `useCashuReceiveQuoteService` / `useSparkReceiveQuoteService` imports (lines 30–31) and the `useUser` import (line 29).
3. Delete the `useReceiveCashuTokenQuoteService` function (lines 37–44).
4. Replace the body of `useCreateCrossAccountReceiveQuotes` with:

```ts
export function useCreateCrossAccountReceiveQuotes() {
  const getExchangeRate = useGetExchangeRate();

  return useMutation({
    mutationFn: async ({
      token,
      destinationAccount,
      sourceAccount,
    }: CreateCrossAccountReceiveQuotesProps) => {
      const tokenCurrency = tokenToMoney(token).currency;
      const accountCurrency = destinationAccount.currency;
      const exchangeRate = await getExchangeRate(
        `${tokenCurrency}-${accountCurrency}`,
      );

      return await sdk.receive.cashuToken.createQuotes({
        token,
        sourceAccount,
        destinationAccount,
        exchangeRate,
      });
    },
    retry: (failureCount, error) => {
      if (error instanceof DomainError) {
        return false;
      }
      return failureCount < 1;
    },
  });
}
```

No other hook, helper, placeholder, or import in the file changes. `useReceiveCashuTokenService`, `useCashuTokenSourceAccountQuery`, `useReceiveCashuTokenAccounts`, `useBuildCashuAccountPlaceholder`, `useReceiveCashuTokenAccountPlaceholders`, `useCashuTokenWithClaimableProofs`, and `getSparkAccountPlaceholder` stay byte-identical.

Web flip (`apps/web-wallet/app/routes/_protected.receive.cashu_.token.tsx`):

1. Delete `getServices` (lines 46–97) entirely.
2. Replace the `/temporary` import block (lines 4–17) with `import { decodeCashuToken } from '@agicash/wallet-sdk/temporary';`.
3. Delete the now-unused imports that existed only for `getServices`: `agicashDbClient`, `getCashuCryptography`, `seedQueryOptions`, `encryptionQueryOptions`, `sparkMnemonicQueryOptions`, `breezApiKey`, `getExchangeRate` (line 40).
4. In `clientLoader`, replace the `getServices` + `claimToken` call (`:162–173`) with:

```ts
const result = await sdk.receive.cashuToken.claim({
  token,
  claimTo,
  accounts,
  user,
});
```

`sdk` is already imported (`:37`). `user` / `accounts` / `token` / `claimTo` locals stay. Cache apply, `trySetReceiveAccountAsDefault`, toasts, gift-card redirect, `clientLoader.hydrate`, and the default export stay byte-identical.

## File map

- Modify: `packages/wallet-sdk/temporary.ts` (canary prune, decision 12)
- Modify: `packages/wallet-sdk/domain/sdk/receive.ts` (four param/result types, decision 2–4)
- Modify: `packages/wallet-sdk/domain/receive/receive-api.ts` (`cashuToken` sub-namespace + seams, decisions 5–8)
- Modify: `packages/wallet-sdk/domain/receive/receive-cashu-token-quote-service.ts` (options param, decision 6)
- Modify: `packages/wallet-sdk/domain/receive/claim-cashu-token-service.ts` (options param, decision 6)
- Modify: `packages/wallet-sdk/domain/receive/receive-api.test.ts` (new `cashuToken` coverage; delete the throwing-getter test)
- Modify: `apps/web-wallet/app/features/receive/receive-cashu-token-hooks.ts` (web flip, decision 9)
- Modify: `apps/web-wallet/app/routes/_protected.receive.cashu_.token.tsx` (loader flip, decision 9)
- Untouched on purpose: root `packages/wallet-sdk/index.ts`, `domain/sdk/sdk.ts`, `domain/sdk/index.ts`, `domain/sdk/sdk.test.ts`, `domain/sdk/events.ts`, `receive-cashu-token-service.ts`, `receive-cashu-token-models.ts`, `cashu-token-melt-data.ts`, all quote/swap/spark `*-repository.ts` / `*-service.ts` / `*.server.ts` files, `lightning-address-service.ts`, `transfer-service.ts`, `receive-cashu-token.tsx`, `_public.receive-cashu-token.tsx`, `cashu-receive-quote-hooks.ts`, `cashu-receive-swap-hooks.ts`, `spark-receive-quote-hooks.ts`, `task-processing.ts`, `use-track-wallet-changes.ts`, `sdk.client.ts`, `entry.client.tsx`, `_protected.tsx`, all RPCs and migrations.

## Task specs

**Task 0 (local, orchestrator): branch + plan commit.** The plan commit on this document is the pinned base. The implementation job branches `sdk/receive-cashu-token-slice` off `master` and appends its delivery branch onto it.

**Task 1 (contribution, single implementer): the whole slice.** Edit exactly the eight files in the file map, applying the pinned seams verbatim. Working order and requirements:

1. **Canary prune.** Re-verify with a repo-wide grep that no file outside `packages/wallet-sdk` imports `ReceiveCashuTokenQuoteService` or `ClaimCashuTokenService` from `@agicash/wallet-sdk/temporary` (the only current importers are the two web files this task edits — do the prune *after* the web flip, or confirm the ordering on the same branch so the intermediate commit never breaks). Then delete those two `export { ... }` lines from `temporary.ts`. Do **not** touch `ReceiveCashuTokenService`, `isClaimingToSameCashuAccount`, `CashuTokenMeltDataSchema`, or any quote/swap/spark export.
2. **Contract + factory + services.** Apply the pinned seams. Read the merged step-9/10/11 files first — `domain/sdk/receive.ts`, `domain/receive/receive-api.ts`, `domain/receive/cashu-receive-quote-service.ts` (its `createReceiveQuote` options param is the exact pattern) — and match their structure, naming, and JSDoc style. In-package `claimToken` → `createCrossAccountReceiveQuotes` still compiles (same PR updates both signatures). No other in-package caller of either method exists.
3. **Tests.** Extend `receive-api.test.ts` in its existing harness style (fake `getSession`, real `createSessionKeys` with controllable session scope, seam injection). Extend the `makeApi` helper (`receive-api.test.ts:211–238`) with optional `tokenQuoteService` / `claimService` entries wired to the two new seams, typed like the suite's existing fakes (`as unknown as ReceiveCashuTokenQuoteService`, `:228–237`), not `Partial<Class>`. **`makeApi` always injects `createService`**, so any test that needs a DEFAULT builder (cases j and k) calls `createReceiveApi` directly and omits the seam it wants defaulted — the pattern of the default-cryptography test (`:863–870`). Fixtures to add: `makeUser(): User` (the wallet `User` from `domain/user/user.ts` with `id`, `defaultBtcAccountId`, `defaultUsdAccountId`; a cast is fine — `AuthUser` at `:33–42` is the Open Secret user and does not fit), `makeMeltQuote()` (`{ quote, amount, fee_reserve, expiry }`; `expiry` is required by `:127–129`), `makeCrossAccountQuotes()` (the cashu-destination member of `CrossAccountReceiveQuotesResult` — read `receive-cashu-token-quote-service.ts:61–79` for the exact shape), and `makeClaimSuccess()` (`{ success: true, receiveAccount: cashuDomain(), changedAccounts: [] }`). Delete the existing `cashuToken` describe (`receive-api.test.ts:1369–1374`) that asserts the throwing getter, and its now-unused `NotImplementedError` import. Exact test list:

   - **`cashuToken.createQuotes`:**
     (a) throws `NoSessionError` without a session, before any repository/service construction (assert the `createTokenQuoteService` / `createClaimService` / `createService` / `createSparkService` / `getAccountRepository` seams were never invoked);
     (b) happy path param passthrough: passes exactly `{ userId, token, sourceAccount, destinationAccount, exchangeRate }` to `createCrossAccountReceiveQuotes` with `{ abortSignal }` as the second argument, and returns the service result verbatim;
     (c) rejects with `SessionEndedError` when the session ends during service construction (mid-fence) and the service is never called;
     (d) rejects with `SessionEndedError` when the session ends after the service call resolves (post-op fence);
     (e) a service rejection (e.g. `DomainError('Token amount is too small to cover cashu fees.')`) propagates unchanged.
   - **`cashuToken.claim`:**
     (f) throws `NoSessionError` without a session, before any construction (same seam-never-invoked assertion as (a));
     (g) happy path param passthrough (`user` = `makeUser()`, a wallet `User`, not the session `AuthUser`): passes exactly `(user, token, claimTo, accounts)` positionally plus `{ abortSignal }` as the fifth argument, and returns the service result verbatim (including a `{ success: false, message }` result — `claimToken` does not throw `DomainError`, it returns it; `claim-cashu-token-service.ts:61–74`);
     (h) rejects with `SessionEndedError` when the session ends during service construction (mid-fence) and the service is never called;
     (i) rejects with `SessionEndedError` when the session ends after the service call resolves (post-op fence), including when the service returned `{ success: true, ... }` — no result for an ended session.
   - **`session fences` additions:**
     (j) abort-signal identity through the real default token-quote service (mirrors step-10's `threads the session signal through the default swap service` test): call `createReceiveApi` directly with the **default** `createTokenQuoteService` (omit that seam) and an injected `createService` returning a fake cashu receive-quote service `{ getLightningQuote, createReceiveQuote }` whose `getLightningQuote` returns a fixture lightning quote and whose `createReceiveQuote` records its second argument as `writeOptions`. `sourceAccount` is a cashu account whose `wallet` implements **both** `getFeesForProofs` (return `0`; called at `receive-cashu-token-quote-service.ts:106` before the loop) and `createMeltQuoteBolt11` returning `makeMeltQuote()` whose `amount + fee_reserve` fits the token so the fee-fit loop (`:224`) exits on attempt 1. `destinationAccount` is a cashu account with a **different** `mintUrl` than the token's mint (same-mint throws `'Must melt token to a different account than source'`, `:102–104`). Assert `expect(writeOptions?.abortSignal).toBe(keys.sessionSignal())` — this locks the new service-to-`createReceiveQuote` `options` hop, which case (b)'s fake token-quote service cannot see.
     (k) **crypto/seed non-access (createQuotes, spark destination):** call `createReceiveApi` directly **without** `createService` (so `getService()` constructs the real `CashuReceiveQuoteService` with the factory `cryptography` const) and **without** `createTokenQuoteService`, with `createSessionKeys({ readCashuSeed: async () => { throw new Error('cashu seed must not be read'); } })`. `destinationAccount` is a **spark** account whose `wallet.receivePayment` is stubbed exactly like the existing spark preview test (`:898–933`: valid `fixtureInvoice` + `lightningReceiveDetails`) — the spark branch calls the **core** `getSparkLightningQuote({ wallet: destinationAccount.wallet, amount })` (`receive-cashu-token-quote-service.ts:283–287`), NOT `SparkReceiveQuoteService.getLightningQuote`, so a fake spark service does nothing for the preview; inject `createSparkService` only with a `createReceiveQuote` that resolves. Source wallet (`getFeesForProofs` + `createMeltQuoteBolt11`) as in (j). Assert the call resolves and the seed error is never thrown. This locks that `createQuotes` never calls `cryptography.getSeed` / `getXpub` / `getPrivateKey` on the spark path — `getPrivateKey` is `completeReceive`-only (`cashu-receive-quote-service.ts:310`) and `getXpub` is cashu-destination `getLightningQuote`-only (`:45–47`). A claim-path seed read is expected on cashu-destination `tryCompleteReceive` and is not asserted against.
   - Existing `cashu` / `spark` tests stay green unmodified.

4. **Web flip.** Apply the pinned hook and route edits. The flipped hook must not reference `useUser`, `useReceiveCashuTokenQuoteService`, `useCashuReceiveQuoteService`, or `useSparkReceiveQuoteService`. The flipped route must not reference `getServices`, `ClaimCashuTokenService`, `ReceiveCashuTokenQuoteService`, `agicashDbClient`, or the seed/encryption/mnemonic query options. Every other export in `receive-cashu-token-hooks.ts` stays byte-identical (page-load account discovery and placeholders are the remaining `/temporary` boundary). `receive-cashu-token.tsx` is not edited.

Gates in the implementer's fork, all mandatory: `bun install`; `bun run fix:all` exit 0; `bun run typecheck` exit 0; `cd packages/wallet-sdk && bun test` green (existing suites + the new `cashuToken` coverage); `cd apps/web-wallet && bun test` green. The changed-file set of the delivered branch must equal the eight-file list exactly (the orchestrator verifies with `git archive` + `diff -rq`).

**Task 2 (local, orchestrator): integration, gates, smoke.** Merge the delivery onto the work branch, re-run all gates at the repo root, then browser-smoke against the local stack (see Verification summary). Confirm the network tab against the Foreground parity accounting table: the flipped flow adds zero requests versus master.

**Task 3 (marketplace): adversarial review** of the integrated diff against this plan. Focus prompts: foreground parity (no added requests — accounts/user/token/source/destination/exchangeRate all caller-supplied; no in-SDK `accounts.get`/`list`), fence order vs the step-9/10/11 template, the step-18 boundary (no processor/change-handler/pending-read drift, no host/processing split, `complete*` not on the contract), the `createQuotes` verb (decision 2 — persist stays a `create*` verb; do not "fix" it by splitting fee-fit HTTP from persist or by folding persist into `claim`), backward compatibility of the two service signatures for the in-package `claimToken` → `createCrossAccountReceiveQuotes` hop, `getServices()` fully gone, canary-prune safety (`ReceiveCashuTokenQuoteService` + `ClaimCashuTokenService` only; `ReceiveCashuTokenService` left in place), and spark-melt-inside-`claim` vs processor-melt-out-of-scope (decision 11). Findings route back through the orchestrator; only confirmed findings trigger a fix cycle.

## Verification summary

| Gate | Command | Expectation |
|---|---|---|
| Lint/format + write | `bun run fix:all` | exit 0 |
| Types (all pkgs) | `bun run typecheck` | exit 0 |
| SDK unit tests | `cd packages/wallet-sdk && bun test` | green (existing suites + new `cashuToken` coverage) |
| Web unit tests | `cd apps/web-wallet && bun test` | green |
| Smoke | manual, browser, local stack | see below |

**Smoke plan** (local stack, guest + testnut):

1. Logged-out, open `/receive/cashu/token` with a testnut token in the URL hash (`#cashuA...` / `#cashuB...` from `https://testnut.cashu.space`). Public page shows the token amount. Test mints cannot melt (`canSendToLightning` is false — `account.ts:106–114`), so `useReceiveCashuTokenAccountPlaceholders` (`receive-cashu-token-hooks.ts:374–380`) exposes **only** the cashu source placeholder (no spark option). This path does **not** call `sdk.receive.cashuToken.*` (no session). Confirm no console errors.
2. Claim as Guest (or sign up / log in and land on the protected page without `claimTo`). Protected page load shows the quotes UI (amount + destination). In development, provisioning adds extra Testnut BTC/USD cashu accounts (`user-api.ts:39–62`; spark remains the default BTC account at `:29–38`), so a testnut token's source is that **existing** cashu account (`isUnknown: false`). Because the source cannot send to Lightning, `getDefaultReceiveAccount` (`receive-cashu-token-service.ts:177–179`) forces the source itself — same-mint, no spark dest.
3. **Claim to an existing cashu account** — click Claim on that testnut source. Same-mint path: `sdk.receive.cashu.createSwap` (already step 10). Network tab: one `create_cashu_receive_swap` RPC, no extra account reads versus master. Web processor completes the swap through `/temporary`; balance credited; transaction appears.
4. **Claim to a newly added account** — from the protected page, receive a token whose mint is **not** in the user's accounts (not testnut, not a provisioned mint). Selector shows the unknown source ("Add Mint and Claim"). Confirming persists the mint via `sdk.accounts.cashu.add` (already step 6, `receive-cashu-token.tsx:157–159` → `addAndSetReceiveAccount`) then same-mint `createSwap` if the destination is that new cashu account. Network tab: one `accounts` insert + one `create_cashu_receive_swap`; no extra account *reads* versus master.
5. Guest auto-claim with `?claimTo=cashu` (public page Claim as Guest; for a testnut token the only selectable placeholder is cashu): loader calls `sdk.receive.cashuToken.claim`. `claimToken` still forces the testnut source (`getDefaultReceiveAccount` short-circuit), so this is the same-mint branch (create swap + `tryCompleteSwap` in-band). Balance credited on the post-redirect home page. No extra requests versus master's `getServices()` + `claimToken` (see accounting table).

**Paths that need a real Lightning payment and cannot be run locally:**

- Cross-mint cashu destination (token mint ≠ destination mint, **non-test** source so `canSendToLightning` is true): `createQuotes` / `claim` persist a `CASHU_TOKEN` cashu receive quote and melt the source proofs to pay the destination mint invoice. Completing the receive requires that Lightning payment to land. A local stack cannot settle it without a mint pair whose Lightning actually pays.
- Interactive spark destination / `claimTo=spark` on a **non-test** token: `createQuotes` / `claim` persist a `CASHU_TOKEN` spark receive quote (`create_spark_receive_quote`) and (in `claim` only) melt to the Breez invoice. Completing requires the source mint to pay that invoice on Lightning. A testnut token **cannot** reach this path — `getDefaultReceiveAccount` / the public placeholder selector both refuse Lightning dests for test mints. Quotes for a real mint can still be *created* (RPC + Breez `receivePayment` + source `createMeltQuoteBolt11`); do not expect the spark balance to credit on a local stack.

No console errors on any runnable path.

## Foreground parity accounting

Rule: the flipped flow adds **zero** network requests versus master. Counts below are for the request *kinds* the token receive page load + claim actually issue. Same-currency FX is `'1'` locally (`exchange-rate-service.ts:28–29`) and is listed as 0 HTTP.

`getInitializedCashuWallet` is 3 mint HTTP (`getInfo` / `getKeySets` / `getKeys` — `lib/cashu.ts:182–186`). `decodeCashuToken` is 1 mint HTTP (`GET /v1/keysets` — `lib/cashu.ts:148`). `getUnspentProofsFromToken` is 1 mint HTTP (proof-state check). Cashu dest lightning quote is 1 mint HTTP (`wallet.createLockedMintQuote` — `cashu-receive-quote-core.ts:268`). Source melt quote is 1 mint HTTP (`wallet.createMeltQuoteBolt11` — `receive-cashu-token-quote-service.ts:246–247`). Fee-fitting retries up to 5 times (`:224`); typically 1–2. Spark dest lightning quote is 1 Breez `receivePayment` (`spark-receive-quote-core.ts:237`).

### A. Protected page load (`/receive/cashu/token#token=...`, no `claimTo`)

| Request | Master | Flipped | Notes |
|---|---|---|---|
| Mint `GET /v1/keysets` (`decodeCashuToken`) | 1 | 1 | Loader, still `/temporary`. |
| Supabase `accounts` select (`sdk.accounts.list` via `accountsQueryOptions`) | 0 if cache warm (protected layout), else 1 | same | Caller-supplied into hooks; SDK is not invoked for this. |
| Mint info/keysets/keys (`buildAccountForMint` via `getSourceAndDestinationAccounts`) | 0 if mint already in `accounts`, else 3 | same | Still `ReceiveCashuTokenService` on `/temporary`. |
| Mint proof-state (`useCashuTokenWithClaimableProofs`) | 1 | 1 | Still `@agicash/cashu`, not an SDK verb. |
| FX (amount conversion display) | 0 or 1 mempool | same | Unchanged `MoneyWithConvertedAmount`. |
| Breez | 0 | 0 | Spark placeholder is `createSparkWalletStub` (local). |
| **Net added** | | **0** | Page-load hooks are not flipped. |

### B. Interactive claim — same mint (existing cashu account)

| Request | Master | Flipped | Notes |
|---|---|---|---|
| RPC `create_cashu_receive_swap` | 1 | 1 | Already `sdk.receive.cashu.createSwap` (step 10). This slice does not touch it. |
| Mint complete-swap HTTP | 0 in the mutation | 0 | Processor completes via `/temporary`. |
| **Net added** | | **0** | |

### C. Interactive claim — cross-account cashu destination

| Request | Master | Flipped | Notes |
|---|---|---|---|
| FX `useGetExchangeRate` | 0 if same-currency `'1'`, else 1 | same | Still fetched in the hook **before** `createQuotes`; passed as `exchangeRate: string`. |
| Dest mint locked-mint-quote HTTP | 1 per fee-fit attempt (≤5) | same | Inside `createCrossAccountReceiveQuotes`, now via `sdk.receive.cashuToken.createQuotes`. |
| Source mint melt-quote HTTP | 1 per fee-fit attempt (≤5) | same | Same function. |
| RPC `create_cashu_receive_quote` | 1 | 1 | Persist. |
| Mint melt HTTP (`meltProofsIdempotent`) | 0 in the mutation | 0 | Processor melts (`cashu-receive-quote-hooks.ts:714`). |
| Account re-fetch | 0 | 0 | Caller passes `sourceAccount` + `destinationAccount`. |
| **Net added** | | **0** | |

### D. Interactive claim — spark destination

| Request | Master | Flipped | Notes |
|---|---|---|---|
| FX | 0 if BTC-BTC, else 1 | same | Hook-supplied string. |
| Breez `receivePayment` | 1 per fee-fit attempt | same | `getLightningQuote` in the token-quote service (`receive-cashu-token-quote-service.ts:284–287`). |
| Source mint melt-quote HTTP | 1 per fee-fit attempt | same | |
| RPC `create_spark_receive_quote` | 1 | 1 | |
| Mint melt HTTP | 0 in the mutation | 0 | Processor melts (`spark-receive-quote-hooks.ts:595`). |
| **Net added** | | **0** | Cannot *complete* locally (Lightning); creation request set is identical. |

### E. Loader auto-claim (`?claimTo=cashu\|spark`) — guest signup handoff

Master builds the service graph in `getServices()` from `agicashDbClient` + query-client seed/mnemonic/encryption (`_protected.receive.cashu_.token.tsx:46–97`). The SDK session keys (`domain/sdk/session-keys.ts`) memoize encryption, the cashu seed, the spark mnemonic and their derivations, so those getters are covered and flipping to `sdk.receive.cashuToken.claim` **drops** the second graph. Two things are **not** memoized SDK-side: (1) `cryptography.getPrivateKey` is the raw `getCashuPrivateKey` (`receive-api.ts:49–54` → `lib/cashu.ts:90–98`, one Open Secret call per invocation) whereas the web's `getCashuCryptography` memoizes it in TanStack (`cashu-query-options.ts:47–56`); only `completeReceive` (`cashu-receive-quote-service.ts:310–312`) reaches it, i.e. the cross-cashu in-band complete inside `claim` — the same-mint guest row (`tryCompleteSwap`, `claim-cashu-token-service.ts:125–137`) never touches it; (2) FX has no SDK cache (decision 3). In-band melt inside `claim` matches master exactly (`claim-cashu-token-service.ts:161–171`; spark complete `:229–240`; `getPaymentByInvoice` `:335–336`).

| Request | Master | Flipped | Notes |
|---|---|---|---|
| Mint `GET /v1/keysets` (`decodeCashuToken`) | 1 | 1 | Unchanged. |
| Supabase `accounts` select (`accountsQueryOptions`) | 0 if warm from provision, else 1 | same | Caller passes `accounts` into `claim`. SDK does not `accounts.list()`. |
| User read | 0 | 0 | `getUserFromCacheOrThrow`; passed as `user`. |
| Mint info/keysets/keys (unknown source mint) | 0 if source already in `accounts` (testnut guest → 0), else 3 | same | Inside `claimToken` → `getSourceAndDestinationAccounts`. |
| Supabase `accounts` insert (unknown dest cashu) | 0 or 1 | same | `AccountService.addCashuAccount` via accounts bridge, not `sdk.accounts.get`. |
| Same-mint: RPC `create_cashu_receive_swap` + mint swap HTTP + RPC `complete_cashu_receive_swap` | 1 + 1 + 1 | same | `claimToken` in-band `tryCompleteSwap`. Testnut guest `claimTo=cashu` is this row. |
| Cross cashu: FX + mint-quote HTTP + melt-quote HTTP + RPC `create_cashu_receive_quote` + melt HTTP + complete-receive mint HTTP + RPC `complete_cashu_receive_quote` | same set | same set, plus: FX +1 provider GET only if cross-currency **and** TanStack was warm; `getPrivateKey` Open Secret reads inside `completeReceive` are per-call SDK-side (memoized in web TanStack on master) | In-band `createCrossAccountReceiveQuotes` + `meltProofsIdempotent` + `tryCompleteReceive`. Needs real Lightning; not a runnable smoke row. |
| Cross spark (`claimTo=spark`): FX (0 if BTC-BTC) + Breez `receivePayment` + melt-quote HTTP + RPC `create_spark_receive_quote` + melt HTTP + Breez `getPaymentByInvoice` (local, `claim-cashu-token-service.ts:335–336`) + RPC `complete_spark_receive_quote` | same set | same set, plus FX +1 provider GET only if cross-currency **and** TanStack was warm | In-band spark complete. Needs real Lightning to finish; not a runnable smoke row. |
| Extra `accounts.get` / `accounts.list` inside the SDK | 0 | 0 | Param precedent. |
| **Net added** | | **0 on every runnable smoke path** (same-currency, same-mint / testnut). Documented deltas exist only on cross-currency FX and on cross-cashu `completeReceive` private-key reads — both unreachable with test mints. | |

`trySetReceiveAccountAsDefault` after a successful claim (`sdk.user.setDefaultAccount`) is unchanged web-only UX, same request both sides, not part of the SDK slice.

## Out of scope

- **Background processing (step 18):** `useProcessCashuReceiveQuoteTasks` CASHU_TOKEN melt / `completeReceive` / `markMeltInitiated`, `useProcessSparkReceiveQuoteTasks` CASHU_TOKEN melt / `complete`, change handlers, pending-quote reads, `useCashuReceiveQuoteService` / `useSparkReceiveQuoteService` (still consumed by those processors). Same-mint swap completion stays on `/temporary` as of step 10.
- **The receive/send repo+service host/processing split** — deferred to step 18 by the spec; this slice wraps the bundled classes as they are.
- **Page-load account discovery and public placeholders** — `ReceiveCashuTokenService`, `useCashuTokenSourceAccountQuery`, `useReceiveCashuTokenAccounts`, `useReceiveCashuTokenAccountPlaceholders`, `useCashuTokenWithClaimableProofs`, `createSparkWalletStub`. Stay on `/temporary` until a later cleanup (step 19) or a dedicated preview verb; this slice has no third contract method to hang them on (decision 2).
- **`receive-cashu-token.tsx`** — param/result shapes of `useCreateCrossAccountReceiveQuotes` and `useCreateCashuReceiveSwap` are unchanged, so the component is not edited.
- **`_public.receive-cashu-token.tsx`** and `decodeCashuToken` — public route has no session.
- **`sdk.send`, `sdk.transfer`, `sdk.featureFlags`, `sdk.taskProcessor`** — later slices (13–16, 18).
- **`.server.ts` twins** and `lightning-address-service.ts` — step 17's `ServerSdk`.
- **SDK events** — step 18 realtime feed; `events.ts` untouched.
- **Root exports (`packages/wallet-sdk/index.ts`)** — the four new types ride `export * from './domain/sdk'`; `tokenToMoney` / `decodeCashuToken` / `isClaimingToSameCashuAccount` / `getAccountHomePath` / `accountRequiresGiftCardTermsAcceptance` / `canSendToLightning` stay on `/temporary` (not yet root-exported; not this slice).
- **`domain/sdk/sdk.ts` / `init()` WASM** — fulfilled in step 11; spark destination reuses `account.wallet`.
- **`cashu-token-melt-data.ts` / `receive-cashu-token-models.ts` / `receive-cashu-token-service.ts`** — consumed in-package; no signature change required.
- **Pre-existing dead `/temporary` re-exports** — `CashuTokenMeltDataSchema` has zero `/temporary` importers but this flip does not make it dead; leave for step 19.
- **No DB schema, RPC, or dependency changes;** no migrations; no `db:generate-types`.

## Plan-attack corrections (2026-09-21)

Two cross-model plan-attack jobs reviewed the first version of this plan against the fork. Applied here:

- grok-4.6 (cursor harness) — Critical 1: the persisting `cashuToken` verb is renamed `getQuote` → `createQuotes` (`get*` = preview, `create*` = persists; no "pinned-verb exception"). Critical 2: tests (j)/(k) rewritten to the real harness — the spark preview goes through the **core** `getSparkLightningQuote` with `destinationAccount.wallet`, `makeApi` always injects `createService`, source wallets need `getFeesForProofs` + `createMeltQuoteBolt11` with `expiry`, destination mint must differ, and a wallet `User` fixture is needed. Important 3: FX stays caller-supplied on `createQuotes` and SDK-internal on `claim`; the cross-currency auto-claim cache-miss delta is documented (table E). Important 4: table E no longer claims `getPrivateKey` is memoized SDK-side. Important 5: `getExchangeRate` added to the route prune list; test-file `NotImplementedError` import deletion. Important 6: fixtures (`makeUser`, `makeMeltQuote`) and fake typing (`as unknown as`) pinned. Minor 7: `NotImplementedError` import is at `receive-api.ts:4–8`. Minor 8: `requireUserId()` fence vs `params.user.id` write clarified. Nit 9: three citations tightened.
