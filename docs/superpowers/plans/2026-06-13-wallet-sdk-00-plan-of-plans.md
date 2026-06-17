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
| 06 | S6 | spark ops (client + server spark wallet) | not written |
| 07 | S7 | orchestrator (executeQuote + #788; receiveToken; balance listener incl. `synced`) | not written |
| 08 | S8 | transactions + contacts + transfers | not written |
| 09 | S9 | background (leader election) + realtime forwarder | not written |
| 10 | S10 | `ServerSdk` facade over shared internals | not written |
| 11 | S11–S15 | web cut-over (reads → flip → server routes → cleanup) | not written |

Dependency order is largely forced: 01 → 02 → 03 → {04} → {05, 06} → 07 → 08 →
09 → 10 → 11. Reads (S12) subdivide freely; **S13 (the orchestration flip) is
necessarily atomic** — see spec §9.

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
