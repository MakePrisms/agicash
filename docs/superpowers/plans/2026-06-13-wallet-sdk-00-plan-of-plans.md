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
| 07b | S7 (spark) | spark orchestrator **primitives** — send/receive Breez listeners · balance listener (§8 `synced`) · spark processors | ✅ [done](2026-06-13-wallet-sdk-07b-spark-orchestrator.md) (8 commits) — all 6 tasks + 2 review-fix commits; `SparkBalanceListener` (§8 `synced` regression) + `SparkSendOrchestrator` + `SparkReceiveOrchestrator` (incl. CASHU_TOKEN cross-mint melt reusing `MeltQuoteSubscriptionManager`); gate green (535 SDK / 670 total, 31 spark-orchestrator tests); dark — `spark.send.executeQuote` still `NotImplementedError` (S9 wires) |
| 08 | S8 | transactions + contacts + transfers | ✅ [done](2026-06-13-wallet-sdk-08-transactions-contacts-transfers.md) (10 tasks, all reviewed clean, gate green — 570 SDK tests, 8 commits); §10 "transfer receive-auto-fails-on-send-failure" regression landed in Task 7; `SdkConfig.lud16Domain` added (now required) |
| 09 | S9 | background (leader election) + realtime forwarder + wiring dark executeQuote/receiveToken | ✅ [done](2026-06-13-wallet-sdk-09-background.md) (12 tasks, all reviewed clean, gate green — 599 SDK tests, 12 commits); all 3 dark S7 entry points (cashu/spark `send.executeQuote`, `cashu.receive.receiveToken`) now LIVE; 07a M1 double-emit fixed; `createSparkDomain` gained `accountRepository`; `background` is the 11th live domain (built but NOT started in prod until S13) |
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
- **Plan 07b → S9 (spark orchestrator primitives done; what's left):**
  - **All spark orchestration units built + offline-tested** in `internal/orchestrator/` (`spark-balance-listener.ts`, `spark-send-orchestrator.ts`, `spark-receive-orchestrator.ts`), gate green (535 SDK / 670 total; 31 spark-orchestrator tests). They are **"dark"**: exported + test-covered but **not imported by `createSparkDomain`** — `spark.send.executeQuote` still throws `NotImplementedError`, `sdk.ts`/`spark-domain.ts` untouched on this branch. No barrel (`internal/orchestrator/` has none); S9 imports each unit by direct path.
  - **Established shapes S9 composes** (mirror 07a's constructor-`deps`-object + per-tick entry points): `SparkBalanceListener({emitter}).register(account) → cleanup` (long-lived per ONLINE spark account: re-reads `getInfo()` on `synced`/payment*/`claimedDeposits`, compare-before-emit `account:updated {op:'updated'}`, **per-account serialized** so the last event's read wins — §8 hardening beyond the web source). `SparkSendOrchestrator({sendQuoteService,getAccount,emitter})`: `initiateSend(account, quote)` (UNPAID kick → `send:pending`; DomainError → fail + `send:failed`), `applyPaymentEvent(quote, payment, type)`, and `reconcile(sendQuotes) → cleanup` (kicks UNPAID, one Breez listener per account routing `payment.id↔sparkTransferId`, initial `getPayment` recovery, per-reconcile `triggered` Set dedupe). `SparkReceiveOrchestrator({receiveQuoteService,getAccount,meltSubscriptionManager,emitter})`: `applyPaymentSucceeded`/`applyExpiry`, `reconcile(receiveQuotes) → cleanup` (one listener per account; `paymentSucceeded` routed by `paymentHash`, `synced`→expiry sweep, `getPaymentByInvoice` recovery), and `reconcileCrossMintMelts(receiveQuotes, {initiateMelt}) → void` (CASHU_TOKEN melt via the **reused** `MeltQuoteSubscriptionManager`; `initiateMelt` is INJECTED — the melt runs on the SOURCE cashu wallet S9 resolves).
  - **S9 wiring TODO:** (a) `createSparkDomain` gains an `accountRepository` param so `executeQuote(quote)` resolves the `SparkAccount` from `quote.accountId` then calls `SparkSendOrchestrator.initiateSend(account, quote)` (foreground may prefer `sendQuoteService.initiateSend` directly to surface `fee_changed`/`insufficient_balance` to the UI instead of failing the quote — decide at wiring time). (b) The leader-elected 5s poll loop calls each `reconcile`/`reconcileCrossMintMelts` per tick and **must call the prior tick's returned cleanup before re-reconciling** (spark has no self-cleaning subscription manager for the Breez listener — re-subscribe-each-tick + the initial `getPayment`/`getPaymentByInvoice` recovery covers the gap). (c) `SparkBalanceListener.register` only for `isOnline` spark accounts (offline `getInitialized` returns a Proxy stub whose every method throws — `addEventListener` would throw). (d) provide `reconcileCrossMintMelts`' `{initiateMelt}` (melt on the source wallet), mirroring 07a's cashu cross-mint injection.
  - **M1-class double-emit: FIXED in 07b** (unlike 07a's deferred M1). Spark's void-returning `receive.expire`/`receive.fail` can't gate on a returned state, so each `reconcile`/`reconcileCrossMintMelts` carries a per-call `triggered: Set<string>` keyed `${quoteId}:${terminalMarker}` that collapses duplicate event deliveries (listener-vs-recovery; repeated `synced`; repeated source-melt `UNPAID`-after-initiated) to one emit. Cross-tick retries stay possible via fresh snapshots. **Carry this `triggered`-set pattern into the analogous 07a M1 fix when wiring S9.**
  - **Minor follow-ups (non-blocking, recorded for review triage):** thin happy-path event-payload assertions on a few send/receive tests; no multi-account `reconcile` test; T2's `applyPaymentEvent` else-branch treats any non-`paymentSucceeded` as failure (TS-safe on the closed union). None affect correctness.

## Starting notes for Plan 08 (S8: transactions + contacts + transfers)

Facts gathered 2026-06-18 (re-verify against current code before writing the plan; built **dark** — not imported by the web, verified by SDK unit tests alone, per spec §9/§10):

- **Contracts + entity types already exist** (PR1119); S8 builds the **implementations + repos + the deferred internal DB-data parsers** (decision 7-ii), not the public types. Interfaces in `domains.ts`: `TransactionsDomain` (`list({accountId?,cursor?,pageSize?}) → {transactions, nextCursor}` · `get(id)` · `countPendingAck()` · `acknowledge(transaction)` — full object), `ContactsDomain` (`list()` · `get(id)` · `add({username})→Contact` · `remove(contact)` — full object · `search({query})→UserProfile[]`, min 3 chars, excludes existing), `TransfersDomain` (`createQuote({sourceAccount,destinationAccount,amount})→TransferQuote` ephemeral · `executeQuote(quote)→TransferResult{transferId,sendTransactionId,receiveTransactionId}`). Entity types already exported from `src/index.ts`: `Transaction`/`BaseTransaction`/`TransactionCursor{stateSortOrder,createdAt,id}`/`TransactionDetails` family, `Contact`/`UserProfile`, `TransferQuote`/`TransferLeg`/`TransferResult`.
- **No repos exist yet** — `internal/repositories/` has only account/user/cashu*/spark* (8). S8 creates `transaction-repository`, `contact-repository` (and the transfer logic; transfers are NOT a stored entity — a transfer = two `Transaction`s, a SEND debit + RECEIVE credit, linked by `transferId`, reached via `tx.details.transferId` when `tx.purpose === 'TRANSFER'`).
- **Transaction repo is READ-MOSTLY:** rows are created/updated server-side as side effects of the cashu/spark quote DB RPCs (`create/complete/fail/expire_*_quote`) — the SDK never inserts transaction rows. Port from `apps/web-wallet/app/features/transactions/{transaction.ts, transaction-repository.ts, transaction-hooks.ts}`: `get`, `list` (rpc `list_transactions`, cursor `{stateSortOrder(PENDING=2 else 1),createdAt,id}`, pageSize 25), `countTransactionsPendingAck`, `acknowledgeTransaction`, `toTransaction` (decrypt `encrypted_transaction_details` → `TransactionDetailsParser` → schema parse). Version guard: emit `transaction:updated` only on a real transition; payload carries `transaction.version` for consumer ordering (the same emit-on-real-transition discipline as 07b's `triggered`-set / the deferred 07a M1 fix).
- **Contacts:** there is **no** `contact-service.ts` — CRUD lives in `ContactRepository` + hooks (`apps/web-wallet/app/features/contacts/{contact.ts,contact-repository.ts,contact-hooks.ts}`): `get`, `getAll` (limit 150, order username asc), `create` (DB hint `LIMIT_REACHED` → `DomainError`), `delete`, `findContactCandidates` (rpc, <3 chars → `[]`), `toContact` (**`lud16` is derived `${username}@${domain}`, not stored** — domain from config). `Contact` has **no `version` column** (CREATE/DELETE only → op-type + refetch, not version caching). Events: `contact:created {contact}` / `contact:deleted {contactId}` (asymmetric — deleted carries only the id).
- **Transfers (`transfer-service.ts` + `transfer-hooks.ts`):** `createQuote` builds the **receive side first** (cashu mint-quote or spark lightning-quote) → extracts its `paymentRequest` → builds the **send side** quoting that invoice; `totalFees = send.estimatedTotalFee + receive.fee`; nothing persisted. `executeQuote`: `transferId = crypto.randomUUID()`, persist receive quote **then** send quote, **both** tagged `purpose:'TRANSFER'` + the same `transferId` (Plan 05 already threads `purpose?`/`transferId?` through `createSendQuote`/`createLightningQuote` on all four quote services). **§10 regression S8 OWNS — "transfer receive-auto-fails-on-send-failure":** it is an **initiation-time compensating action only** (`initiateTransfer`: if persisting the send throws, `fail` the already-persisted receive quote in a try/catch that logs-and-rethrows the original error). There is **NO DB trigger and NO runtime linkage** — do not invent one; the regression test is about the initiation path. `TransferLeg{account,fee}` is deliberately slimmer than master's internal `TransferSendSide`/`TransferReceiveSide` (which carry the live `lightningQuote`) — keep the internal sides SDK-internal.
- **NO `transfer:*` events** (decision 5) — `executeQuote` emits nothing aggregate; the two legs' own `transaction:created`/`:updated` events are correlated consumer-side by `transferId`.
- **Assembly (`sdk.ts`):** `transactions`/`contacts`/`transfers` are currently **class-field initializers** `= notImplementedDomain<T>(name)` (lines ~55-64). S8 must drop the initializers to bare `readonly x: XDomain;` and assign them **in the constructor** (where `ctx` + the shared `accountRepository` exist), via `createTransactionsDomain(ctx)` / `createContactsDomain(ctx)` / `createTransfersDomain(ctx, accountRepository)` (transfers needs account/quote services). `DomainContext = {config, connections, emitter}`; emit via `ctx.emitter.emit(...)`; user-scoped methods resolve `getCurrentUserId(ctx.config.storage)` → `new SdkError('No active session','NOT_AUTHENTICATED')` if null (mirror `accounts-domain.ts`). Update the `sdk.ts` top comment + class JSDoc as each lands; keep the `notImplementedDomain` import for `background`.
- **Drifts to reconcile (documented in the SDK types):** `Contact.createdAt` is `Date` + `UserProfile` has `lud16` (contract) vs master's `string` + `Pick<User,'id'|'username'>`; `Transaction.*At` are ISO `string` but `Contact.createdAt` is `Date`. SDK follows the contract — the port must bridge.
- **Conventions (carry):** `SdkError`/`DomainError` `(message, code)`; `NotImplementedError(method)`; **never bare `mock.module`** (DI'd fakes or `spyOn`+`afterAll(mock.restore)`); repos unit-tested against a mocked Supabase client with **real ECIES encrypt/decrypt round-trips** (`makeFakeDb` + random-key `EncryptionService`, the S5/S6 pattern); per-task gate `bun run typecheck` + `bun run test`; bun/bunx only; one commit per task.

## Plan 08 → S9 / S11 (transactions/contacts/transfers done)

- **(a)** `transaction:created` + broad `transaction:updated` (server-written rows) are the **S9 realtime forwarder's job** — S8 only emits `transaction:updated` from `acknowledge` (real pending→acknowledged transition, re-reads the row for the incremented version). Until S9 lands, the web cut-over reads still work via TanStack refetch.
- **(b)** S9's forwarder must **NOT double-drive** `contact:created`/`contact:deleted` — S8 emits them **synchronously** from `add`/`remove` (Decision D5). The forwarder must gate on the event source (SDK-initiated vs. server-written) or skip contacts entirely. Note: a live DB trigger `broadcast_contacts_changes_trigger` (fires on insert/delete on `wallet.contacts`) ALREADY EXISTS — S9's realtime forwarder MUST gate contacts by event source, or it will double-drive `contact:created`/`contact:deleted` alongside S8's synchronous emits.
- **(c)** `transfers.executeQuote` **re-derives fresh quotes** from the slim `TransferQuote` (Decision D3 — re-quote drift vs. the preview is accepted, since the slim quote carries no live lightning quotes and the SDK is stateless per call). If fee-stable execution is later required, a contract change would be needed to carry the live quote objects. Note: this D3 re-derive widens a PRE-EXISTING orphaned-mint-invoice window — if the send-side re-derive throws after the receive invoice is minted, that unpersisted invoice is orphaned and simply expires. This is not a regression introduced by S8, but the S9 LN-kickoff owner should be aware.
- **(d)** `SdkConfig.lud16Domain` is now **REQUIRED** — S11 (web entry) and S10 (server config) must supply it. `ContactRepository` and the `lud16` derivation depend on it at construction time.
- **(e)** `transfers` persists paired quotes ONLY; the actual LN payment kickoff is the **S9 background orchestrator** (the send `executeQuote` it relies on is still `NotImplementedError`, wired in S9).
- **(f)** The internal `z.infer<typeof TransactionSchema>` and the public `Transaction` have **no compile-time assignability link** (TS won't reduce union-of-intersections `extends`); the runtime `TransactionSchema.parse` in `toTransaction` is the safety net. Do not attempt a static `satisfies`/`extends` guard.

## Plan 09 → S10 / S11 (background + forwarder + executeQuote/receiveToken wiring done)

- **(S13 — necessarily atomic)** The web calls `sdk.background.start()` on sign-in / `stop()` on sign-out, and **in the same step deletes** its `TaskProcessor` + `useTakeTaskProcessingLead` + `useTrackWalletChanges` + all `*ChangeHandlers` + the realtime manager wiring. Never run the web processor and `sdk.background` together (dual leaders / dual realtime owners → double melt/mint — spec §8). The web supplies `config.clientId` (stable per client/tab) or accepts the SDK's per-instance `crypto.randomUUID()`. `background.start/stop` are auth-lifecycle only (no connectivity seam — D10).
- **(S11/S13 bridge)** The realtime forwarder drives **only** `transaction:created`/`:updated`, `account:updated {op}`, `user:updated` (maps the broadcast row payload directly via `toTransaction`/`toAccount`/`toUser` — no re-read). It **does NOT** forward `contact:*` (S8's `add`/`remove` emit those synchronously; the contacts cache is a naive append with no version → forwarding would double-drive) nor the `CASHU_*`/`SPARK_*` quote/swap broadcasts (the orchestrators emit `send:*`/`receive:*` on real transitions). So `useSdkEventBridge` must map `contact:created`/`:deleted` from the **mutation** emits; cross-device contact sync relies on the kept `refetchOnReconnect`/`refetchOnWindowFocus`.
- **(known limitation, documented D7)** `background.stop()` halts the poll + forwarder + spark balance/listener thunks but does **not** proactively close cashu-ts WS sockets — the cashu orchestrators discard the managers' unsubscribe thunks; the managers self-clean on socket close and dedupe (`isSubset`) on the next start. Managers + orchestrators are built **once** in `createBackgroundDomain` (persist across start/stop). Acceptable; revisit only if WS teardown-on-stop becomes required.
- **(S10 ServerSdk)** `ServerSdk` has **no** background loop (request-scoped server mode: no leader election, no realtime forwarder, no balance listeners). It reuses the shared services/repos but **not** `createBackgroundDomain`.
- **(executeQuote semantics, D1)** `cashu/spark.send.executeQuote(quote)` is the **foreground kick** — it calls the per-op service directly so `DomainError` (`fee_changed`/`insufficient_balance`/`invalid_state`) surfaces to the UI; the background loop completes the quote via WS/Breez. Double-initiate vs the loop is guarded by `meltProofsIdempotent` + the service state-guards. (Spark `executeQuote` re-emits `send:pending` on an idempotent already-PENDING call — harmless, the consumer refresh is idempotent.) If a tighter guarantee is wanted, S11 could have the UI rely solely on the background loop for the kick — decide at cut-over.
- **(user-row bootstrap, resolves Plan 03 carryover)** No explicit bootstrap retry was needed: `take_lead` (FK → `users.id`) fails until the user row exists; the runner logs + retries on the next 5s tick, so a fresh signup naturally becomes leader once the row is provisioned.
- **(forwarder hardening, non-blocking)** Two Minors recorded: a latent concurrent `stop()`+`start()` race in `WalletChangesForwarder` (callers are sequential today); `stop()` does not clear the realtime manager's in-memory `channels`/`resubscribeQueue`/retry-timeouts (it removes the channel via the manager's ref-counted `removeChannel`). Harden if multi-start/stop churn appears.

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
