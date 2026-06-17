# Wallet SDK Full Migration — Plan-of-Plans (index)

**Design spec:** `docs/superpowers/specs/2026-06-13-wallet-sdk-full-migration-design.md` (read it first).
**Branch:** `sdk-nocache/full-migration` (based on `sdk/pr1-contract`, the PR #1119 contract).

> **Standalone exploration.** This is an independent, single-approach (no-cache,
> one-PR) full-migration design. It is **intentionally separate from** the
> `sdkx/base` two-variant track and must **not** depend on, derive from, or
> modify it. Lib extraction (`@agicash/money` + the rest) **is in scope here** —
> this branch is based on the contract, which does not carry those packages.

## How this is planned & executed

- **One PR**, built as the ordered slices in spec §9 (Phase 0 foundation →
  Phase 1 "dark" SDK domains → Phase 2 web cut-over).
- **One plan document per slice**, written **just-in-time** — each plan is
  authored in a **fresh session** grounded in the *actual* code shapes the
  previous slice established, not guessed up front (we write the SDK fresh; we
  do **not** lift the `sdk/pr2-core` / `sdk/pr3-auth-user` / `sdk-reactive/*`
  prototype code — reference only).
- Per slice: write the plan with `superpowers:writing-plans`, then execute with
  `superpowers:subagent-driven-development`. SDK domain slices (Phase 1) are
  verified by **SDK unit tests alone** — the web is untouched until cut-over.
- **Verification gate** (spec §10) before the PR is "done": unit tests per slice
  (incl. the regression tests for stale-balance `synced` re-read, nutshell-#788
  change refetch, taken-username → `DomainError`, transfer auto-fail), then
  `fix:all` + web unit suite + `test:e2e`, then manual money-path checks.

## Plans

| # | Slice(s) | Produces (testable on its own) | Status |
|---|---|---|---|
| 01 | S1 | `@agicash/money` shared package; app + SDK build on it | ✅ [done](2026-06-13-wallet-sdk-01-money-package.md) (2 commits) |
| 02 | S2 | SDK core shell — config · events · errors+classify · connections · crypto (domains stubbed) | ✅ [done](2026-06-13-wallet-sdk-02-sdk-core-shell.md) (11 commits) — adopted `@agicash/opensecret@1.0.0-rc.0` (catalog bump + `StorageProvider`); framework-free, gate green |
| 03 | S3 | auth + user (+ session resolver, ensure-on-resolve bootstrap) | ✅ [done](2026-06-13-wallet-sdk-03-auth-user.md) (19 commits) — auth + user domains live; gate green (248 tests) |
| 04 | S4 | accounts + scan + exchangeRate (+ live wallet-handle resolution) | ✅ [done](2026-06-13-wallet-sdk-04-accounts-scan-exchange-rate.md) (18 commits) — domains live; protocol libs (bolt11/lnurl/cashu) extracted + `Account.wallet` real; gate green (196 tests) |
| 05 | S5 | cashu ops (send / receive / token-claim) | ✅ [done](2026-06-13-wallet-sdk-05-cashu-ops.md) (18 commits) — 4 repos + 5 services + token-receive helpers + CashuCryptography + cashuMintValidator, wired via `createCashuDomain`; `executeQuote`/`receiveToken` deferred to S7 (`NotImplementedError`); gate green (386 SDK tests, 521 total) |
| 06 | S6 | spark ops (client; server receive *primitive* session-agnostic, server *wiring* → S10) | ✅ [done](2026-06-13-wallet-sdk-06-spark-ops.md) (8 commits) — 2 repos + 2 services + session-agnostic receive-core + `createSparkDomain`, wired via `createSparkDomain(ctx)`; `send.executeQuote` deferred to S7 (`NotImplementedError`); gate green (463 SDK tests, 598 total). 7 of 11 domains real. |
| 07a | S7 (cashu) | cashu orchestrator **primitives** — 3 WS managers · send/receive/swap processors · #788 · cross-account quote + claim service · publish `CashuReceiveSwap` | ✅ [done](2026-06-13-wallet-sdk-07a-cashu-orchestrator.md) (15 commits) — all 13 tasks + 2 review-fix commits; gate green (504 SDK / 639 total); executeQuote/receiveToken still `NotImplementedError` (S9 wires) |
| 07b | S7 (spark) | spark orchestrator **primitives** — send/receive Breez listeners · balance listener (§8 `synced`) · spark processors | not written |
| 08 | S8 | transactions + contacts + transfers | not written |
| 09 | S9 | background (leader election) + realtime forwarder | not written |
| 10 | S10 | `ServerSdk` facade over shared internals | not written |
| 11 | S11–S15 | web cut-over (reads → flip → server routes → cleanup) | not written |

Dependency order is largely forced: 01 → 02 → 03 → {04} → {05, 06} → 07 → 08 →
09 → 10 → 11. Reads (S12) subdivide freely; **S13 (the orchestration flip) is
necessarily atomic** — see spec §9.

> **S7 scope decision (owner, during 07-planning):** S7 is split into **07a (cashu)**
> and **07b (spark)**, and builds **primitives only** — the WS subscription managers,
> the per-state transition handlers (incl. the two §8 regressions), the 6 task
> processors, and the cross-account quote + claim services — each unit-tested OFFLINE
> with injected fakes + synthetic events. The public `cashu.send.executeQuote` /
> `cashu.receive.receiveToken` / `spark.send.executeQuote` stay `NotImplementedError`;
> **S9 wires them** (plus the leader-elected 5s poll loop, subscription start/stop,
> quote-expiry driving, and the `receiveToken` token-decode + account resolution).
> This shifts executeQuote/receiveToken *wiring* from S7→S9 vs spec §9 (which assigned
> them to S7); the regression coverage (#788 in 07a, spark `synced` in 07b) stays in S7.
> Also decided: `receiveToken` returns `CashuReceiveQuote | SparkReceiveQuote |
> CashuReceiveSwap` (the same-mint swap is published; minor §6-style contract amendment).

## Carryover notes (from completed slices)

- **Plan 03 → S9 / Plan 11:** the user-row bootstrap in `session-resolver.ts`
  calls `repo.upsert(...)` directly — it does **not** wrap it in master's
  `withRetry` (2 attempts, skip Zod errors). This is design-defensible (the web
  wraps `getCurrentUser` in a TanStack query that retries, and `classify` maps
  `23505`→`DomainError` / RPC-hint→`ConcurrencyError` for consumer-side retry),
  but make an explicit decision at the cutover: either rely on the web query's
  retry, or add a thin bootstrap retry when S9 wires the background lifecycle.
- **Plan 03 (testing):** bun's `mock.module` is **process-global**. Every SDK
  test file that calls `mock.module` MUST add `afterAll(() => mock.restore())`
  (all-or-nothing — `mock.restore` is global). Modules with direct
  `import { x }` bindings (`open-secret.ts`, `breez.ts`) need a **complete**
  mock or load fails with "Export named X not found" — use the shared
  `openSecretModuleMock` / `breezModuleMock` factories in `internal/test-support.ts`.
  Real module singletons (e.g. breez `wasmInitPromise`) persist across files;
  assertions on global-init behaviour must be pollution-immune.
- **Plan 03 (opensecret rc):** confirmed the rc persists `access_token` /
  `refresh_token` in `storage.persistent`, so the SDK's `isLoggedIn` assumption
  holds — the earlier Plan 11 token-key concern is resolved.

- **Plan 04 → S5/S6/S7 (cashu/spark ops + orchestrator):**
  - The **cashu-protocol lib** is extracted at `internal/lib/cashu` (the
    non-orchestrator subset). Its barrel **excludes** `payment-request` +
    `melt-quote-subscription(-manager)` + `mint-quote-subscription-manager` —
    S5 vendors those (they still live only in `apps/web-wallet/app/lib/cashu`).
    `mint-validation.ts` is vendored but **no validator instance is constructed**
    (S5 wires `cashuMintBlocklist` config + builds `cashuMintValidator`).
  - `Account.wallet` is now the **live** `ExtendedCashuWallet`/`BreezSdk`
    (`types/dependencies.ts` placeholders all wired real). `CashuWalletService`
    (mint-metadata memo) + `SparkWalletService` (connect-once memo) + the
    `MintAuthTokenProvider`/`getMintAuthProvider` live in `internal/connections`
    and are on `SdkConnections`. The spark balance **listener** (the §8 stale-
    balance `synced` re-read) is **still deferred to S7** — only one-shot
    `getInfo()` balance exists today.
  - Domains are built in the `Sdk` constructor from a shared `DomainContext`
    (`{config, connections, emitter}`); `AccountRepository` is constructed there
    with `(supabase, encryption, cashuWallets, sparkWallets, mintAuth, getCashuSeed)`.
    5 of 11 domains real (auth, user, accounts, scan, exchangeRate); cashu/spark/
    transactions/contacts/transfers/background still `notImplementedDomain`.
  - **Gotcha:** `SdkError`/`DomainError` require **`(message, code)`** — the web's
    1-arg `new DomainError(msg)` does NOT compile; every ported throw needs a code.
  - **Test infra:** `internal/test-support.ts` `makeFakeDb` now has an **awaitable
    builder** (`then`) + `insert`/`abortSignal`, so non-`.single()` queries work.
    The cashu/spark wallet services take **injected** connect/fetch fns (DI) — their
    tests use fakes, **no `mock.module`** on cashu-ts/breez. Keep that pattern in S5/S6.
  - **New deps (in `packages/wallet-sdk/package.json`):** `@cashu/cashu-ts@3.6.1`,
    `light-bolt11-decoder@3.2.0`, `@scure/base@1.2.6`, `ky@1.14.3`, `big.js@7.0.1`,
    `zod@4.3.6`, `@stablelib/base64` (catalog).

- **Plan 05 → S7 / S8 / S11 (cashu ops done; what S5 deliberately left for later):**
  - **6 of 11 domains real** (auth, user, accounts, scan, exchangeRate, **cashu**);
    spark/transactions/contacts/transfers/background still `notImplementedDomain`.
    `cashu.send.executeQuote` + `cashu.receive.receiveToken` throw `NotImplementedError`
    (the only two cashu methods stubbed) — **S7 owns** them.
  - **S5 built every per-op primitive** the orchestrator needs (offline-tested with
    fake wallets): `CashuSendQuoteService` (`initiateSend`→`meltProofsIdempotent`,
    `markSendQuoteAsPending`, `completeSendQuote`→deterministic change derivation +
    `matchBlindSignaturesToOutputData`, `failSendQuote`→`checkMeltQuoteBolt11` guard),
    `CashuSendSwapService` (`swapForProofsToSend`, `complete`, `fail`, **`reverse`**),
    `CashuReceiveQuoteService` (`completeReceive`/`processUnpaid`/`processPaid`/
    `mintProofs`→`mintBolt11`), `CashuReceiveSwapService` (`create`/`completeSwap`
    same-mint claim). All 4 repos + the 5 DB-data schemas + shared proof mappers
    (`internal/db/cashu-proofs.ts` `toEncryptedProofData`/`toDecryptedCashuProofs`).
  - **S7 must vendor (NOT yet in the SDK):** the 3 WS subscription managers
    (`melt-quote-subscription[-manager]`, `mint-quote-subscription-manager`,
    `proof-state-subscription-manager`) — still only in `apps/web-wallet/app`. The
    **nutshell-#788 change-refetch** lives in `melt-quote-subscription.ts` and is
    deliberately **absent** from S5 (S7 owns its regression test). The task loop +
    leader election are S9. `payment-request.ts` (NUT-18) not vendored (unused so far).
  - **S7 token-claim:** S5 shipped the same-mint receive-swap primitive +
    `ReceiveCashuTokenService` (source/dest account selection + `buildAccountForMint`
    + the `cashuMintValidator` instance, on `SdkConnections`). **S7 adds** the
    cross-account quote (`createCrossAccountReceiveQuotes` — needs `SparkReceiveQuoteService`
    from S6) + the `ClaimCashuTokenService` melt-then-mint orchestration + the public
    `receiveToken`. `CashuReceiveSwap` is an **internal** type (no public contract type).
  - **S8 transfers:** `CashuSendQuoteService.createSendQuote` + `cashu.send.createLightningQuote`
    thread `purpose?: TransactionPurpose` + `transferId?` (the transfer-service pattern).
  - **`CashuCryptography`** (`internal/connections/cashu-crypto.ts`, on `SdkConnections`
    as `cashuCrypto`): `getSeed`/`getXpub`/`getPrivateKey` derived **locally** from the
    cashu seed via `@scure/bip32` `HDKey` (D3). A unit test asserts xpub-derived pubkey ==
    privkey-derived pubkey at the same NUT-20 index (so locking verifies).
  - **Testing gotcha (bit Task 17):** bun's `mock.module` is process-global and **leaks
    into sibling test files** (it broke 111 sibling tests once). Use **`spyOn` + per-spy
    `mockRestore()`** (the `cashu-domain.test.ts` pattern) or DI'd fakes; never a bare
    `mock.module`. (Reinforces the Plan 03 carryover.)
  - **S11 cut-over polish (small, non-blocking):** re-export `MintBlocklist` +
    `MintBlocklistSchema` from the public barrel (`SdkConfig.cashuMintBlocklist` is the
    parsed `{ mintUrl; unit }[]` shape, **not** `string[]`); the cashu insufficient-balance
    error message formats USD in cents because `getDefaultUnit` isn't exported to the SDK
    money lib.

- **Plan 06 → S7 / S10 (spark ops done; what S6 deliberately left for later):**
  - **7 of 11 domains real** (auth, user, accounts, scan, exchangeRate, cashu, **spark**);
    transactions/contacts/transfers/background still `notImplementedDomain`.
    `spark.send.executeQuote` throws `NotImplementedError` (the only spark method stubbed) — **S7 owns** it.
  - **S6 built every per-op primitive** the orchestrator needs (offline-tested with fake
    wallets): `SparkSendQuoteService` (`getLightningSendQuote`, `createSendQuote`,
    `initiateSend`→`prepareSendPayment`+`sendPayment`+`markAsPending`(PENDING), `complete`,
    `fail`), `SparkReceiveQuoteService` (`createReceiveQuote` for LIGHTNING **and**
    CASHU_TOKEN, `complete`, `expire`, `fail`, `markMeltInitiated`). Both repos
    (`spark-{send,receive}-quote-repository.ts`) + the ported zod schemas
    (`SparkSendQuoteSchema`/`SparkReceiveQuoteSchema`, co-located in the repos with a
    `_SchemaFitsContract` check; the SDK has **no** `AllUnionFieldsRequired`) + the
    session-agnostic `domains/spark/spark-receive-quote-core.ts` (`getLightningQuote`/
    `computeQuoteExpiry`/`getAmountAndFee` + the create-quote param types).
  - **S7 must build/wire (NOT in the SDK yet):** `executeQuote` = wire `initiateSend` +
    register the per-account Breez event listener (`paymentSucceeded`→`complete`,
    `paymentFailed`→`fail`) **and the balance listener with the §8 `synced` re-read** (the
    named §10 regression — **owns its regression test**). Port from
    `app/features/shared/spark.ts:180-230` (`useTrackAndUpdateSparkAccountBalances`) +
    `spark-{send,receive}-quote-hooks.ts` (`useOnSparkSendStateChange`/
    `useOnSparkReceiveStateChange`/`useProcessSpark*Tasks`). The receive `synced`→expiry
    check + the CASHU_TOKEN melt path (`useOnMeltQuoteStateChange`→`initiateMelt`/
    `markMeltInitiated`) are also S7 (the melt path needs the cashu wallet + the WS
    melt-quote subscription manager S7 vendors). The cross-account cashu-token→spark claim
    consumes `SparkReceiveQuoteService.createReceiveQuote({ receiveType:'CASHU_TOKEN', … })`
    (built in S6). The `initLogging` single-global guard already lives in `breez.ts` (S4) —
    nothing to add.
  - **S10 must build (server spark, all deferred per D6-2):** `config.serverSparkMnemonic`;
    a dedicated server `SparkWalletService` instance (`new SparkWalletService((network) =>
    connectBreez({ apiKey, network, storageDir: <server dir>, debugLogging },
    config.serverSparkMnemonic))` — own storageDir, distinct from the user wallet; the class
    needs **no** change, confirmed S6); `SparkReceiveQuoteRepositoryServer` (`encryptToPublicKey`,
    service-role, returns minimal `SparkReceiveQuoteCreated`) + `SparkReceiveQuoteServiceServer`
    (reuses the S6 `getLightningQuote` core with `receiverIdentityPubkey =
    user.sparkIdentityPublicKey`). `encryptToPublicKey` ports from
    `app/features/shared/encryption.ts`. S6's core already has the `receiverIdentityPubkey`
    param (server-readiness proven by a unit test).
  - **Testing note (held):** the bolt11-dependent service paths (`getLightningSendQuote`
    happy/insufficient, the receive core, the domain compose) use **`spyOn` on the SDK's
    own `internal/lib/bolt11` / `internal/lib/lnurl` modules** (never `mock.module`) with a
    far-future stubbed invoice, restored in `afterAll`/`afterEach` — bun's `spyOn` **does**
    redirect direct named imports here (confirmed). All repo tests use real ECIES
    encrypt/decrypt round-trips via `makeFakeDb` + a random-key `EncryptionService`.
  - **DRY note:** the domain `CashuTokenMeltDataSchema` (the parsed `tokenReceiveData`
    shape) was extracted from the cashu receive repo to `internal/db/cashu-token-melt-data.ts`
    (distinct from the DB-shape `cashu-token-melt-db-data.ts`); both the cashu + spark
    receive entity schemas import it.

- **Plan 07a → 07b / S9 (cashu orchestrator primitives done; what's left):**
  - **All cashu orchestration units built + offline-tested** in `internal/orchestrator/` (+ the 3 WS managers in `internal/lib/cashu/`), gate green (504 SDK tests). They are **"dark"**: exported + test-covered but **not imported by `createCashuDomain`** — `cashu.send.executeQuote` / `cashu.receive.receiveToken` still throw `NotImplementedError`. **S9 wires them** (leader-elected 5s poll loop, subscription start/stop, quote-expiry driving, the `receiveToken` token-string decode + account resolution via the S5 `ReceiveCashuTokenService`, and `executeQuote` itself). Established shapes S9 composes: each orchestrator takes a constructor `deps` object with `getAccount: (id)=>Promise<CashuAccount|null>`, the relevant subscription manager(s) (DI'd `getWallet: (mintUrl)=>Promise<ExtendedCashuWallet>`), and the `emitter`. Per-tick entry points: `CashuSendOrchestrator.reconcile(quotes)` + `applyMeltQuoteState`; `CashuSendSwapOrchestrator.processDrafts(swaps)` + `reconcile(pending)`; `CashuReceiveQuoteOrchestrator.reconcileMintQuotes(quotes)` + `reconcileCrossMintMelts(quotes,{initiateMelt})`; `CashuReceiveSwapOrchestrator.processPending(swaps)`. The `{initiateMelt}` handler for cross-mint melts is injected because the actual melt runs on the **source** wallet (S9 resolves it). `ClaimCashuTokenService.claimToken({userId,token,sourceAccount,destinationAccount})` is the `receiveToken` core (returns `CashuReceiveQuote | SparkReceiveQuote | CashuReceiveSwap`); `ReceiveCashuTokenQuoteService` ctor takes an optional 3rd arg `getSparkLightningQuote` (defaults real).
  - **#788 lives in** `cashu-send-orchestrator.ts` `resolvePaidMeltQuote` (regression-tested). **`CashuReceiveSwap` is now public** (`types/cashu.ts` + barrel) and `receiveToken`'s contract return was widened to the 3-way union (owner-approved §6-style amendment).
  - **Deferred bug (M1, → S9):** `CashuReceiveQuoteOrchestrator.applyCrossMintMeltState` emits `receive:failed` unconditionally after `receiveQuoteService.fail()`, which returns `void` and no-ops when already FAILED — so a repeated source-melt `UNPAID`-after-initiated tick **within one subscription window** can double-emit `receive:failed` (the only emit-on-real-transition violation in 07a; all other paths are guarded by a throwing service or a pre-state guard). The S9 loop's fresh-`getUnresolved`-per-tick prevents the cross-tick case. Fix when wiring S9: either gate the emit on a real transition, or normalize `CashuReceiveQuoteService.fail` to **return the updated quote** (like `failSendQuote` does) and gate on the returned state.
  - **07a → 07b (spark) precedent to mirror:** 07b builds the spark orchestration primitives the same way — a `SparkSendOrchestrator` (Breez `paymentSucceeded`→`complete`+`send:completed` / `paymentFailed`→`fail`+`send:failed`; the UNPAID kick via `initiateSend`), a `SparkReceiveOrchestrator` (Breez `paymentSucceeded`→`complete`+`receive:completed`; `synced`→expiry check; the CASHU_TOKEN cross-mint melt completion that **reuses 07a's `MeltQuoteSubscriptionManager` + `applyCrossMintMeltState`-style** logic via `SparkReceiveQuoteService.markMeltInitiated`/`fail`), and the **§8 stale-balance `SparkBalanceListener`** (re-read `getInfo()` on `synced`/payment* events, compare-before-emit `account:updated {op:'updated'}` — the mandated regression). DI the Breez event source (a fake `BreezSdk` whose `addEventListener` captures `onEvent` + controllable `getInfo`) so every transition + the §8 reconcile is offline-testable with synthetic `SdkEvent`s. `createSparkDomain(ctx)` will need an `accountRepository` param added when S9 wires it (executeQuote resolves `account.wallet` from `quote.accountId`); 07b builds the units standalone (no domain wiring), executeQuote stays `NotImplementedError`. Use bun's `mock()` DI'd fakes + real `SdkEventEmitter`; the spark `getLightningQuote`/bolt11 paths use `spyOn` on the SDK's own `internal/lib/bolt11` (confirmed to redirect named imports in S6) **or** DI — prefer DI.

## Starting notes for Plan 01 (`@agicash/money`)

Facts gathered 2026-06-13 (re-verify before writing the plan):
- Source lives at `apps/web-wallet/app/lib/money/` — `index.ts` (barrel),
  `money.ts` (~24 KB, the `Money` class; has a `window.devtoolsFormatters`
  registration guarded by `typeof window === 'undefined'`), `types.ts`
  (`Currency` / `CurrencyUnit` / `UsdUnit` / `BtcUnit`), `money.test.ts`.
- **79** files import `from '~/lib/money'` (the repoint surface). The `~` alias
  is the web app's tsconfig path.
- The SDK currently has a **placeholder** at
  `packages/wallet-sdk/src/types/money.ts` (a `declare class Money` + the
  `Currency`/unit types) re-exported from `packages/wallet-sdk/src/index.ts`.
  Plan 01 replaces the placeholder with a re-export of `@agicash/money` (so the
  same `Money` constructor — and `instanceof` — is shared across the boundary).
- Workspace: root `package.json` `workspaces.packages = ["apps/*", "packages/*"]`
  with a `catalog`. New package goes at `packages/money` (name `@agicash/money`);
  consumers reference it via the workspace protocol. Check how an existing
  cross-package dep is declared before adding (none may exist yet on this branch).
- Verify with `bun run fix:all` + `bun test` after the move; behaviour identical.
