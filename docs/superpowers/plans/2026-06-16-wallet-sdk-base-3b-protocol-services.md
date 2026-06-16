# Wallet SDK — Base Plan 3b: Protocol Services (send/receive repos+services, transactions, contacts, transfers, json-models) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the remaining wallet protocol layer — the cashu/spark send+receive quote/swap repositories and services, the Transaction entity/cursor/details-parser/enums + transaction repository, the Contact entity + repository, the transfer service, and all remaining `agicash-db` json-models — into `@agicash/wallet-sdk`, de-TanStacked and wired into a `createProtocolServices` factory hung off the existing disposable `WalletRuntime`, runnable headless under bun and line-identical across both variant PRs.

**Architecture:** The protocol repos/services are **already React-free and constructor-DI'd** (verified). The only coupling is the bottom-of-file `use*` hook factory + the injected `QueryClient`/`useEncryption`/`useAccountRepository`/`agicashDbClient` those hooks use. This plan uses the same **hybrid extraction** 3a proved: boundary-crossing pure types/zod schemas (entities, json-models, transaction details, contact, the receive cores) are `git mv`'d into the SDK with an app re-export shim (single source of truth, preserves type identity so `account.wallet`/`Transaction`/`CashuSendQuote` stay one type across the boundary); construction-differing repos/services are **copied** into the SDK and de-TanStacked (drop the `use*` hook + its imports, repoint cross-feature imports to SDK paths, keep all business logic byte-for-byte), while the app keeps its TanStack copies untouched until the variant web-migration deletes them. A new `createProtocolServices(foundation, deps)` builds the protocol repos/services and hangs them on `WalletRuntime.protocols`; the `Sdk` already constructs the runtime, so 3b only extends it. No public domain facade is wired (deferred to Plan 4 / variants).

**Tech Stack:** TypeScript (ESM, `moduleResolution: Bundler`, `noEmit`), `bun test`. New SDK dep: `@agicash/bolt11` (workspace:\*). Already present: `@agicash/money|cashu|ecies|utils|opensecret|breez-sdk-spark`, `@cashu/cashu-ts`, `@scure/bip32`, `type-fest`, `jwt-decode`, `zod`. Foundation already landed (3a): `WalletRuntime` (`encryption`, `cashuCryptography`, `mintCache`, `mintAuth`, `sparkWallets`, `accountRepository`, `defaultAccountRepository`, `accountService`), reachable via `sdk[walletRuntimeKey]`; `AgicashDb` + every protocol row type + every RPC function already declared in `internal/db/database.ts`; `isCashuAccount`/`isSparkAccount`; error taxonomy (`SdkError`/`DomainError`/`ConcurrencyError`/`NotFoundError`/`UniqueConstraintError`); `KeyService`; `ExtendedCashuWallet`/`getCashuWallet`; `CashuCryptography` (`BASE_CASHU_LOCKING_DERIVATION_PATH`); `getInitializedCashuWallet`; `MintDataCache`; `AgicashMintAuthProvider`; `SparkWalletManager`; spark `errors`/`stub`; account types + `cashu-proof` in `domains/`; `user-types`.

**Gate (every task):** `bun run typecheck` + `bun run test` from repo root (NEVER `fix:all` — that is biome lint/format only and does NOT typecheck; `tsc` is the catch-all for dangling imports in every form: alias/relative/value/type-only). `bun run test` keeps the existing app + wallet-sdk suites green (the app's TanStack protocol code stays compiling via shims/its own copies). **No new unit tests are added** (the chosen minimal-testing scope — these files have zero unit tests today, nothing to port). The two non-`fix:all`, non-unit validations are: the existing suites (gate) and the **carry-over headless Breez-connect smoke** (run once in Task 0 before any spark protocol code lands — see Task 0).

**Out of scope (later plans), explicitly flagged so nothing is silently dropped:**
- **Token-claim orchestrators** — `claim-cashu-token-service.ts`, `receive-cashu-token-service.ts`, `receive-cashu-token-quote-service.ts`. These power the spec's `CashuReceiveOps.receiveToken`, but each writes directly to TanStack caches (`queryClient.fetchQuery(accountsQueryOptions)`, `setQueryData(UserCache)`) and orchestrates user+accounts+receive — i.e. they are **facade/variant-level** logic, consistent with the locked "defer the public domain facade" decision. **Nothing in 3b's scope depends on them** (the transfer service depends only on the 4 quote services). Deferred to the facade/variant plans. *(If you want `receiveToken` inside the SDK now, see the confirmation note — it would add ~3 de-TanStack tasks.)*
- **Server `.server.ts` variants** — `cashu-receive-quote-{repository,service}.server.ts`, `spark-receive-quote-{repository,service}.server.ts` (asymmetric `encryptToPublicKey`, `create`-only) + `lightning-address-service.ts` — **Plan 5** (server-mode SDK + LN-address routes).
- **Plan 4** — `proof-state-subscription-manager.ts`, the cashu/spark `*-quote-subscription-manager.ts`, the six `useProcess*Tasks`/`*-hooks.ts` cache files + change handlers, leader election, change-feed ingestion.
- **Scan/send-UI helpers** not depended on by in-scope code — `resolve-destination.ts`, `find-matching-offer-or-gift-card-account.ts`, `send/validation.ts`, `receive-cashu-token-models.ts`, the zustand `*-store.ts` files, all `.tsx` components. (The `scan`/`rates` domains are a later plan.)
- **Public domain facade** (`Sdk.cashu`/`Sdk.spark`/`Sdk.transactions`/`Sdk.contacts`/`Sdk.transfers`), the 7 hot reads, balance-as-a-field domain mapping — variant plans. 3b only constructs + internally exposes the protocol services via `WalletRuntime.protocols`.

---

## Key design decisions (baked into this plan)

1. **Repos/services are COPY + de-TanStack; the app keeps its copies.** Verified: every protocol repo/service is constructor-DI'd and React-free; the only React is the trailing `useXRepository`/`useXService` hook factory and the `@tanstack/react-query` + `useEncryption`/`useAccountRepository`/`agicashDbClient`/`useLocationData` imports those hooks consume. De-TanStacking = copy the file, **drop the hook factory and those hook-only imports**, repoint cross-feature imports to SDK paths, keep every method byte-for-byte. The app's `*-repository.ts`/`*-service.ts`/`*-hooks.ts` are **left untouched** (they keep constructing the TanStack versions until the variant web-migration). This duplication is intentional and temporary.
2. **Entities, json-models, transaction details, contact, and the receive cores are `git mv` + app re-export shim** (boundary-crossing pure types/zod/pure-functions). One source of truth in the SDK preserves type identity: the app's kept repos and the SDK's copies both reference the *same* `CashuSendQuote`/`Transaction`/`Contact`. The app file becomes `export * from '@agicash/wallet-sdk/<path>'`.
3. **`WalletRuntime` gains a `protocols` field.** A new `createProtocolServices(foundation, { db, keys, domain })` (in `internal/protocol-services.ts`) builds the 8 repos + 7 services in dependency order and returns a `ProtocolServices` bundle. `createWalletRuntime` calls it and adds `protocols` to the runtime object; `Sdk.create` threads `config.domain`. Protocol services hold **no disposable resources** (they reuse the foundation's `mintCache`/`sparkWallets`, which the foundation already disposes), so `WalletRuntime.dispose` is unchanged. 3b reaches everything via `sdk[walletRuntimeKey].protocols.<x>`.
4. **`createProtocolServices` deps come from the foundation.** Constructor shapes (verified): repos take `(db, encryption)` — cashu **receive** repos additionally take `accountRepository`; contact repo takes `(db, domain)`. Services take their repo(s); `CashuReceiveQuoteService` also takes `cashuCryptography`; `CashuSendSwapService` also takes `cashuReceiveSwapService`; `TransferService` takes the 4 quote services. All of `db`/`encryption`/`accountRepository`/`cashuCryptography` already live on the foundation runtime; `domain` comes from `SdkConfig.domain`.
5. **`@agicash/bolt11` is a new SDK dep** (verified absent). The receive cores (`decodeBolt11`/`parseBolt11Invoice`) and the cashu/spark send services need it.
6. **`derivePublicKey` is extracted into `internal/cashu/cryptography.ts`** (verified: a pure `HDKey.fromExtendedKey(xpub).derive(path).publicKey` → hex helper in `features/shared/cryptography.ts`; the rest of that file is the React `useCryptography` hook). The app's `shared/cryptography.ts` re-exports it from the SDK (partial-move), keeping `useCryptography`.
7. **`measureOperation` is unwrapped** in `spark-receive-quote-core` (verified import of `~/lib/performance`), exactly as 3a dropped `measureOperation` in `getInitializedCashuWallet`. Pure behavior preserved; perf telemetry dropped (app keeps its own copy with telemetry until variant migration).
8. **json-models move behind one SDK barrel.** Verified: every importer uses the `~/features/agicash-db/json-models` barrel, no direct-file imports. So: `git mv` the 7 remaining models + the `account-details-db-data` union into `internal/db/json-models/`, add an `index.ts` barrel + one `exports` entry, and replace the app barrel body with `export * from '@agicash/wallet-sdk/internal/db/json-models'`.
9. **EVERY app-facing SDK deep import needs an explicit `package.json` `exports` entry** (verified 3a lesson — the app's tsc does NOT honor the `"./*"` catch-all). Each `git mv` task adds its entries as it goes; the gate (`tsc`) fails loudly on any omission.
10. **`Cursor` (pagination) keeps its name byte-for-byte** in the copied `transaction-repository.ts`. The spec's `TransactionCursor` is a facade-rename (Plan 4); not done here.
11. **No new disposables, no new key material.** All secrets still flow through `KeyService`/`Encryption` from the foundation; `dispose()` teardown is unchanged.

---

## File Structure

**Created in `packages/wallet-sdk/src/` (final shape after 3b):**

```
domains/
  transaction-enums.ts            # Transaction{Direction,Type,State,Purpose} + schemas        [git mv]
  cashu-send-quote.ts             # CashuSendQuote(+Schema), DestinationDetails(+Schema)        [git mv]
  cashu-send-swap.ts              # CashuSendSwap(+Schema), PendingCashuSendSwap                [git mv]
  spark-send-quote.ts             # SparkSendQuote(+Schema)                                     [git mv]
  cashu-token-melt-data.ts        # CashuTokenMeltData(+Schema)                                 [git mv]
  cashu-receive-quote.ts          # CashuReceiveQuote(+Schema)                                  [git mv]
  cashu-receive-swap.ts           # CashuReceiveSwap(+Schema)                                   [git mv]
  spark-receive-quote.ts          # SparkReceiveQuote(+Schema)                                  [git mv]
  contact.ts                      # Contact(+Schema), isContact                                 [git mv]
  transaction.ts                  # Transaction(+Schema), BaseTransactionSchema                 [git mv]
  transaction-details/            # 6 detail schema+parser files + -types + -parser            [git mv]
internal/
  cashu/
    cryptography.ts               # + derivePublicKey (added to the existing 3a file)           [modify]
    receive-quote-core.ts         # deriveNut20LockingPublicKey/getLightningQuote/computeQuoteExpiry/computeTotalFee  [git mv from receive/cashu-receive-quote-core.ts]
  spark/
    receive-quote-core.ts         # getLightningQuote/computeQuoteExpiry/getAmountAndFee (measureOperation unwrapped)  [git mv from receive/spark-receive-quote-core.ts]
  db/
    json-models/                  # + 7 models + account-details union + index.ts barrel       [git mv]
    cashu-proof-decryption.ts     # toDecryptedCashuProofs                                      [git mv from send/utils.ts]
    cashu-send-quote-repository.ts        [copy + de-TanStack]
    cashu-send-swap-repository.ts          [copy + de-TanStack]
    spark-send-quote-repository.ts         [copy + de-TanStack]
    cashu-receive-quote-repository.ts      [copy + de-TanStack]
    cashu-receive-swap-repository.ts       [copy + de-TanStack]
    spark-receive-quote-repository.ts      [copy + de-TanStack]
    transaction-repository.ts              [copy + de-TanStack] (exports Cursor)
    contact-repository.ts                  [copy + de-TanStack]
  services/
    cashu-receive-swap-service.ts          [copy + de-TanStack]
    cashu-receive-quote-service.ts         [copy + de-TanStack]
    spark-receive-quote-service.ts         [copy + de-TanStack]
    cashu-send-quote-service.ts            [copy + de-TanStack]
    cashu-send-swap-service.ts             [copy + de-TanStack]
    spark-send-quote-service.ts            [copy + de-TanStack]
    transfer-service.ts                    [copy + de-TanStack]
  protocol-services.ts            # ProtocolServices type + createProtocolServices(foundation, deps)   [new]
```

**Modified (SDK):** `package.json` (add `@agicash/bolt11` + ~16 `exports` entries), `src/internal/cashu/cryptography.ts` (+`derivePublicKey`), `src/internal/wallet-runtime.ts` (`protocols` field + thread `domain`), `src/sdk.ts` (pass `config.domain`), `src/index.ts` (barrel: public entity/transaction/contact/transfer types).

**Modified (app) — re-export shims (keep the still-TanStack app compiling unchanged):** each `git mv`'d file's original path becomes `export * from '@agicash/wallet-sdk/<path>'`; `features/agicash-db/json-models/index.ts` → `export * from '@agicash/wallet-sdk/internal/db/json-models'`; `features/shared/cryptography.ts` re-exports `derivePublicKey` from the SDK (keeps `useCryptography`). The app's protocol `*-repository.ts`/`*-service.ts`/`*-hooks.ts`/`*-store.ts`/`.tsx` are **left as-is**.

---

## Task 0: SDK dep (`@agicash/bolt11`) + run the carry-over Breez-connect smoke

**Files:** `packages/wallet-sdk/package.json`

- [ ] **Step 1: Confirm `@agicash/bolt11` is a workspace package.** Run: `grep '"name"' packages/bolt11/package.json` — expect `"@agicash/bolt11"`. Confirm it is NOT yet a wallet-sdk dep: `grep bolt11 packages/wallet-sdk/package.json` (expect no match).

- [ ] **Step 2: Add the dep** to `packages/wallet-sdk/package.json` `dependencies` (alphabetical, after `@agicash/breez-sdk-spark`): `"@agicash/bolt11": "workspace:*",`.

- [ ] **Step 3: Install.** Ask the user before installing (CLAUDE.md autonomy). Run: `bun install`. Expected: lockfile updates the wallet-sdk workspace edge; no version conflicts.

- [ ] **Step 4: Gate.** Run (repo root): `bun run typecheck && bun run test`. Expected: PASS (no code changed).

- [ ] **Step 5: Run the carry-over headless Breez-connect smoke (REQUIRED before any spark protocol code lands).** The script `packages/wallet-sdk/examples/spark-connect-smoke.ts` was written in 3a but never run here (no `VITE_BREEZ_API_KEY` in this worktree). It validates `SparkWalletManager.connect()` headless against regtest — the foundation the Task 6/7/9/10/11 spark code builds on.

  This is the **one step that needs user input**: it requires `VITE_BREEZ_API_KEY` and a reachable local/regtest stack, neither present in this worktree. Run (filling the key):

  ```bash
  VITE_BREEZ_API_KEY=<key> bun packages/wallet-sdk/examples/spark-connect-smoke.ts
  ```

  Expected: logs `{ isOnline: true, balance: <Money|null> }` (or a deliberate offline-stub path with `isOnline: false` if regtest is down — but a `connect()` that throws on a *bad* config is a fail). If the key is unavailable, **flag to the user and pause spark tasks (6/7/9/10/11)**; the cashu + transactions + contacts tasks (1–5, 8, parts of 9–10) are unblocked and can proceed first. Do not silently skip.

- [ ] **Step 6: Commit.**

```bash
git add packages/wallet-sdk/package.json bun.lock
git commit -m "chore(wallet-sdk): add @agicash/bolt11 dep for protocol cores/services"
```

---

## Task 1: Send-cluster entities + transaction enums + proof-decryption util (git mv + shims)

**Files:**
- Move: `apps/web-wallet/app/features/transactions/transaction-enums.ts` → `packages/wallet-sdk/src/domains/transaction-enums.ts`
- Move: `apps/web-wallet/app/features/send/cashu-send-quote.ts` → `packages/wallet-sdk/src/domains/cashu-send-quote.ts`
- Move: `apps/web-wallet/app/features/send/cashu-send-swap.ts` → `packages/wallet-sdk/src/domains/cashu-send-swap.ts`
- Move: `apps/web-wallet/app/features/send/spark-send-quote.ts` → `packages/wallet-sdk/src/domains/spark-send-quote.ts`
- Move: `apps/web-wallet/app/features/send/utils.ts` → `packages/wallet-sdk/src/internal/db/cashu-proof-decryption.ts`
- Modify: the 5 app source files (→ shims), `package.json`, `src/index.ts`

- [ ] **Step 1: Move the files.**
```bash
git mv apps/web-wallet/app/features/transactions/transaction-enums.ts packages/wallet-sdk/src/domains/transaction-enums.ts
git mv apps/web-wallet/app/features/send/cashu-send-quote.ts packages/wallet-sdk/src/domains/cashu-send-quote.ts
git mv apps/web-wallet/app/features/send/cashu-send-swap.ts packages/wallet-sdk/src/domains/cashu-send-swap.ts
git mv apps/web-wallet/app/features/send/spark-send-quote.ts packages/wallet-sdk/src/domains/spark-send-quote.ts
git mv apps/web-wallet/app/features/send/utils.ts packages/wallet-sdk/src/internal/db/cashu-proof-decryption.ts
```

- [ ] **Step 2: Repoint imports inside the moved files.**
  - `cashu-send-quote.ts`: `import { CashuProofSchema } from '~/features/accounts/cashu-account';` → `from './cashu-proof';`
  - `cashu-send-swap.ts`: `import { CashuProofSchema } from '~/features/accounts/cashu-account';` → `from './cashu-proof';`
  - `spark-send-quote.ts`: no relative imports (only `@agicash/money` + `zod/mini`) — no change.
  - `transaction-enums.ts`: no relative imports — no change.
  - `cashu-proof-decryption.ts` (was `send/utils.ts`): repoint `CashuProof` `from '../accounts/cashu-account'` → `from '../../domains/cashu-proof'`; `AgicashDbCashuProof` (and any other db type) `from '../agicash-db/database'` → `from './database'`. Keep `ProofSchema` (`@agicash/cashu`), `zod/mini`. Verify with `grep -nE "from '" packages/wallet-sdk/src/internal/db/cashu-proof-decryption.ts` and repoint anything still alias/relative-to-app.

- [ ] **Step 3: App shims** — replace each moved app file's body:
  - `features/transactions/transaction-enums.ts`: `export * from '@agicash/wallet-sdk/domains/transaction-enums';`
  - `features/send/cashu-send-quote.ts`: `export * from '@agicash/wallet-sdk/domains/cashu-send-quote';`
  - `features/send/cashu-send-swap.ts`: `export * from '@agicash/wallet-sdk/domains/cashu-send-swap';`
  - `features/send/spark-send-quote.ts`: `export * from '@agicash/wallet-sdk/domains/spark-send-quote';`
  - `features/send/utils.ts`: `export * from '@agicash/wallet-sdk/internal/db/cashu-proof-decryption';`

- [ ] **Step 4: `package.json` exports** — add (keep the object sorted):
```jsonc
"./domains/transaction-enums": "./src/domains/transaction-enums.ts",
"./domains/cashu-send-quote": "./src/domains/cashu-send-quote.ts",
"./domains/cashu-send-swap": "./src/domains/cashu-send-swap.ts",
"./domains/spark-send-quote": "./src/domains/spark-send-quote.ts",
"./internal/db/cashu-proof-decryption": "./src/internal/db/cashu-proof-decryption.ts",
```

- [ ] **Step 5: Barrel** — in `src/index.ts` add the public types:
```ts
export type {
  TransactionDirection, TransactionType, TransactionState, TransactionPurpose,
} from './domains/transaction-enums';
export type { CashuSendQuote, DestinationDetails } from './domains/cashu-send-quote';
export type { CashuSendSwap, PendingCashuSendSwap } from './domains/cashu-send-swap';
export type { SparkSendQuote } from './domains/spark-send-quote';
```

- [ ] **Step 6: Grep-verify importers resolve.** `grep -rln "features/send/cashu-send-quote'\|features/send/cashu-send-swap'\|features/send/spark-send-quote'\|features/transactions/transaction-enums'\|features/send/utils'" apps/web-wallet/app | head` — confirm these still point at the shimmed app paths (they resolve transitively to the SDK). No app importer should reference a now-deleted symbol.

- [ ] **Step 7: Gate.** Run (repo root): `bun run typecheck && bun run test`. Expected: PASS — the app's still-TanStack send repos import `./cashu-send-quote`/`./utils` (now shims), the json-model `cashu-lightning-send-db-data` still imports `DestinationDetailsSchema` from `~/features/send/cashu-send-quote` (shim), transaction-details import `transaction-enums` (shim).

- [ ] **Step 8: Commit.**
```bash
git add packages/wallet-sdk/src/domains/transaction-enums.ts packages/wallet-sdk/src/domains/cashu-send-quote.ts packages/wallet-sdk/src/domains/cashu-send-swap.ts packages/wallet-sdk/src/domains/spark-send-quote.ts packages/wallet-sdk/src/internal/db/cashu-proof-decryption.ts packages/wallet-sdk/src/index.ts packages/wallet-sdk/package.json apps/web-wallet/app/features/transactions/transaction-enums.ts apps/web-wallet/app/features/send/cashu-send-quote.ts apps/web-wallet/app/features/send/cashu-send-swap.ts apps/web-wallet/app/features/send/spark-send-quote.ts apps/web-wallet/app/features/send/utils.ts
git commit -m "refactor(wallet-sdk): move send-quote/swap entities + transaction enums + proof-decryption into the SDK"
```

---

## Task 2: Receive-cluster entities + token-melt data (git mv + shims)

**Files:**
- Move: `apps/web-wallet/app/features/receive/cashu-token-melt-data.ts` → `packages/wallet-sdk/src/domains/cashu-token-melt-data.ts`
- Move: `apps/web-wallet/app/features/receive/cashu-receive-quote.ts` → `packages/wallet-sdk/src/domains/cashu-receive-quote.ts`
- Move: `apps/web-wallet/app/features/receive/cashu-receive-swap.ts` → `packages/wallet-sdk/src/domains/cashu-receive-swap.ts`
- Move: `apps/web-wallet/app/features/receive/spark-receive-quote.ts` → `packages/wallet-sdk/src/domains/spark-receive-quote.ts`
- Modify: the 4 app files (→ shims), `package.json`, `src/index.ts`

- [ ] **Step 1: Move the files.**
```bash
git mv apps/web-wallet/app/features/receive/cashu-token-melt-data.ts packages/wallet-sdk/src/domains/cashu-token-melt-data.ts
git mv apps/web-wallet/app/features/receive/cashu-receive-quote.ts packages/wallet-sdk/src/domains/cashu-receive-quote.ts
git mv apps/web-wallet/app/features/receive/cashu-receive-swap.ts packages/wallet-sdk/src/domains/cashu-receive-swap.ts
git mv apps/web-wallet/app/features/receive/spark-receive-quote.ts packages/wallet-sdk/src/domains/spark-receive-quote.ts
```

- [ ] **Step 2: Repoint imports inside the moved files.**
  - `cashu-receive-quote.ts`: `import { CashuTokenMeltDataSchema } from './cashu-token-melt-data';` stays relative (both now in `domains/`) — no change. Verify no `~/features/...` imports remain.
  - `spark-receive-quote.ts`: same `./cashu-token-melt-data` relative import — no change.
  - `cashu-receive-swap.ts` and `cashu-token-melt-data.ts`: imports are `@agicash/cashu` (`ProofSchema`) + `@agicash/money` + `zod/mini` — no change.
  - Run `grep -rnE "from '~|from '\.\./" packages/wallet-sdk/src/domains/cashu-token-melt-data.ts packages/wallet-sdk/src/domains/cashu-receive-quote.ts packages/wallet-sdk/src/domains/cashu-receive-swap.ts packages/wallet-sdk/src/domains/spark-receive-quote.ts` and repoint any app-relative import to its SDK equivalent (e.g. a `cashu-proof` import → `./cashu-proof`).

- [ ] **Step 3: App shims.**
  - `features/receive/cashu-token-melt-data.ts`: `export * from '@agicash/wallet-sdk/domains/cashu-token-melt-data';`
  - `features/receive/cashu-receive-quote.ts`: `export * from '@agicash/wallet-sdk/domains/cashu-receive-quote';`
  - `features/receive/cashu-receive-swap.ts`: `export * from '@agicash/wallet-sdk/domains/cashu-receive-swap';`
  - `features/receive/spark-receive-quote.ts`: `export * from '@agicash/wallet-sdk/domains/spark-receive-quote';`

- [ ] **Step 4: `package.json` exports** — add:
```jsonc
"./domains/cashu-token-melt-data": "./src/domains/cashu-token-melt-data.ts",
"./domains/cashu-receive-quote": "./src/domains/cashu-receive-quote.ts",
"./domains/cashu-receive-swap": "./src/domains/cashu-receive-swap.ts",
"./domains/spark-receive-quote": "./src/domains/spark-receive-quote.ts",
```

- [ ] **Step 5: Barrel** — in `src/index.ts` add:
```ts
export type { CashuTokenMeltData } from './domains/cashu-token-melt-data';
export type { CashuReceiveQuote } from './domains/cashu-receive-quote';
export type { CashuReceiveSwap } from './domains/cashu-receive-swap';
export type { SparkReceiveQuote } from './domains/spark-receive-quote';
```

- [ ] **Step 6: Gate.** Run (repo root): `bun run typecheck && bun run test`. Expected: PASS — the app's still-TanStack receive repos/services + the spark/cashu receive cores import these entities via the shims; `cashu-receive-quote` and `spark-receive-quote` both reference the single `CashuTokenMeltData` identity.

- [ ] **Step 7: Commit.**
```bash
git add packages/wallet-sdk/src/domains/cashu-token-melt-data.ts packages/wallet-sdk/src/domains/cashu-receive-quote.ts packages/wallet-sdk/src/domains/cashu-receive-swap.ts packages/wallet-sdk/src/domains/spark-receive-quote.ts packages/wallet-sdk/src/index.ts packages/wallet-sdk/package.json apps/web-wallet/app/features/receive/cashu-token-melt-data.ts apps/web-wallet/app/features/receive/cashu-receive-quote.ts apps/web-wallet/app/features/receive/cashu-receive-swap.ts apps/web-wallet/app/features/receive/spark-receive-quote.ts
git commit -m "refactor(wallet-sdk): move cashu/spark receive-quote/swap entities + token-melt data into the SDK"
```

---

## Task 3: agicash-db json-models (git mv → SDK barrel + app barrel shim)

**Files:**
- Move: `cashu-lightning-receive-db-data.ts`, `cashu-lightning-send-db-data.ts`, `spark-lightning-receive-db-data.ts`, `spark-lightning-send-db-data.ts`, `cashu-swap-receive-db-data.ts`, `cashu-swap-send-db-data.ts`, `cashu-token-melt-db-data.ts`, `account-details-db-data.ts` from `apps/web-wallet/app/features/agicash-db/json-models/` → `packages/wallet-sdk/src/internal/db/json-models/`
- Create: `packages/wallet-sdk/src/internal/db/json-models/index.ts` (barrel)
- Modify: `apps/web-wallet/app/features/agicash-db/json-models/index.ts` (→ shim), `package.json`

- [ ] **Step 1: Move the 8 files.**
```bash
cd packages/wallet-sdk/src/internal/db/json-models
git -C "$(git rev-parse --show-toplevel)" mv apps/web-wallet/app/features/agicash-db/json-models/cashu-lightning-receive-db-data.ts packages/wallet-sdk/src/internal/db/json-models/cashu-lightning-receive-db-data.ts
# ...repeat for: cashu-lightning-send-db-data, spark-lightning-receive-db-data, spark-lightning-send-db-data,
#                cashu-swap-receive-db-data, cashu-swap-send-db-data, cashu-token-melt-db-data, account-details-db-data
```
(Run each `git mv` from the repo root with full source/dest paths — the inline `cd` is only illustrative.)

- [ ] **Step 2: Repoint imports inside the moved files.**
  - `cashu-lightning-send-db-data.ts`: `import { DestinationDetailsSchema } from '~/features/send/cashu-send-quote';` → `from '../../../domains/cashu-send-quote';` (from `internal/db/json-models/` that is up 3 to `src/`, then `domains/`). **Verify the depth** with the file's own location.
  - `cashu-lightning-receive-db-data.ts` + `spark-lightning-receive-db-data.ts`: keep `import … from './cashu-token-melt-db-data';` (sibling, moved together) — no change.
  - `account-details-db-data.ts`: keep `./cashu-account-details-db-data` + `./spark-account-details-db-data` (already in SDK from 3a) — no change.
  - The rest import only `@agicash/money`, `@agicash/cashu` (`ProofSchema`), `zod/mini` — no change. Verify: `grep -rnE "from '~" packages/wallet-sdk/src/internal/db/json-models` returns nothing.

- [ ] **Step 3: Create the SDK barrel `src/internal/db/json-models/index.ts`:**
```ts
export * from './cashu-account-details-db-data';
export * from './spark-account-details-db-data';
export * from './account-details-db-data';
export * from './cashu-lightning-receive-db-data';
export * from './cashu-lightning-send-db-data';
export * from './spark-lightning-receive-db-data';
export * from './spark-lightning-send-db-data';
export * from './cashu-swap-receive-db-data';
export * from './cashu-swap-send-db-data';
export * from './cashu-token-melt-db-data';
```

- [ ] **Step 4: App barrel shim** — replace `apps/web-wallet/app/features/agicash-db/json-models/index.ts` body with:
```ts
export * from '@agicash/wallet-sdk/internal/db/json-models';
```

- [ ] **Step 5: `package.json` exports** — add one entry:
```jsonc
"./internal/db/json-models": "./src/internal/db/json-models/index.ts",
```

- [ ] **Step 6: Grep-verify no direct-file json-model importers remain.** `grep -rnE "agicash-db/json-models/[a-z]" apps/web-wallet/app` — expect only the 3a account-details shim files (`cashu-account-details-db-data`/`spark-account-details-db-data`, which still exist as 3a shims) and nothing pointing at the now-moved 3b files. If a direct importer of e.g. `account-details-db-data` surfaces, repoint it to the barrel `~/features/agicash-db/json-models`.

- [ ] **Step 7: Gate.** Run (repo root): `bun run typecheck && bun run test`. Expected: PASS — every app importer (`send`/`receive` repos incl. `.server.ts`, transaction-details) reads the app barrel, which now re-exports the SDK barrel; `cashu-lightning-send-db-data`'s `DestinationDetailsSchema` resolves to the moved `domains/cashu-send-quote` (Task 1).

- [ ] **Step 8: Commit.**
```bash
git add packages/wallet-sdk/src/internal/db/json-models packages/wallet-sdk/package.json apps/web-wallet/app/features/agicash-db/json-models/index.ts
git commit -m "refactor(wallet-sdk): move remaining agicash-db json-models into the SDK behind one barrel"
```

---

## Task 4: Transaction details + Transaction entity (git mv + shims)

**Files:**
- Move: the 8 files in `apps/web-wallet/app/features/transactions/transaction-details/` → `packages/wallet-sdk/src/domains/transaction-details/`
- Move: `apps/web-wallet/app/features/transactions/transaction.ts` → `packages/wallet-sdk/src/domains/transaction.ts`
- Modify: app shims (grep-driven), `package.json`, `src/index.ts`

- [ ] **Step 1: Move the directory + entity.**
```bash
git mv apps/web-wallet/app/features/transactions/transaction-details packages/wallet-sdk/src/domains/transaction-details
git mv apps/web-wallet/app/features/transactions/transaction.ts packages/wallet-sdk/src/domains/transaction.ts
```

- [ ] **Step 2: Repoint imports inside the moved files.** From `domains/transaction-details/*` and `domains/transaction.ts`:
  - json-models: `~/features/agicash-db/json-models` → `../../internal/db/json-models` (from `transaction-details/`) and `../internal/db/json-models` (from `transaction.ts`). **Verify depth per file.**
  - `../transaction-enums` (used by detail files + `transaction.ts`) → `../transaction-enums` from `transaction.ts` (sibling in `domains/`) and `../transaction-enums` from `transaction-details/*` (up one to `domains/`). Confirm: detail files currently import `../transaction-enums`; after the dir moves to `domains/transaction-details/`, `../transaction-enums` correctly points at `domains/transaction-enums.ts` (Task 1) — **no change needed**.
  - `cashu-lightning-send-transaction-details.ts`: `import { DestinationDetailsSchema } from '~/features/send/cashu-send-quote';` → `from '../cashu-send-quote';` (now in `domains/`, Task 1).
  - `transaction.ts`: `~/features/accounts/account` (`AccountPurposeSchema`, `AccountTypeSchema`) → `./account-types`; detail schema imports `./transaction-details/...` stay relative (dir moved with it) — no change.
  - `transaction-details-types.ts`: `supabase/database.types` (`Json`) — this is the repo-root generated types. From `domains/transaction-details/` the 3a precedent path is `../../../../../../supabase/database.types` (count levels: `transaction-details`→`domains`→`src`→`wallet-sdk`→`packages`→repo-root). **Verify the exact depth** against how `internal/db/database.ts` imports it (3a used `../../../../../supabase/database.types` from `internal/db/`; `domains/transaction-details/` is one level deeper than `internal/db/`, i.e. same depth as `internal/db/json-models/` — match that). Repoint accordingly.
  - Run `grep -rnE "from '~|supabase/database.types" packages/wallet-sdk/src/domains/transaction-details packages/wallet-sdk/src/domains/transaction.ts` and fix every remaining alias/root import.

- [ ] **Step 3: App shims (grep-driven).** Find which moved paths still have app importers and shim exactly those:
  - `grep -rln "features/transactions/transaction'" apps/web-wallet/app` → for each, the path `~/features/transactions/transaction` must resolve. Recreate `apps/web-wallet/app/features/transactions/transaction.ts` as `export * from '@agicash/wallet-sdk/domains/transaction';`.
  - `grep -rlnE "transaction-details/(transaction-details-parser|transaction-details-types|[a-z-]+-transaction-details)'" apps/web-wallet/app` → for **each** moved detail file that still has an app importer (expected: `transaction-details-parser` + `transaction-details-types`, imported by the app's kept `transaction-repository.ts`; possibly some detail TYPE files imported by `transaction-details.tsx`/`transaction-additional-details.tsx`), recreate the app file as a shim `export * from '@agicash/wallet-sdk/domains/transaction-details/<name>';`. Files with **zero** app importers are fully moved — do not recreate them.

- [ ] **Step 4: `package.json` exports** — add `./domains/transaction` plus one entry **per transaction-details path that got an app shim** in Step 3, e.g.:
```jsonc
"./domains/transaction": "./src/domains/transaction.ts",
"./domains/transaction-details/transaction-details-parser": "./src/domains/transaction-details/transaction-details-parser.ts",
"./domains/transaction-details/transaction-details-types": "./src/domains/transaction-details/transaction-details-types.ts",
// + any detail file shimmed in Step 3
```

- [ ] **Step 5: Barrel** — in `src/index.ts` add:
```ts
export type { Transaction } from './domains/transaction';
export type { TransactionDetails } from './domains/transaction-details/transaction-details-types';
```

- [ ] **Step 6: Gate.** Run (repo root): `bun run typecheck && bun run test`. Expected: PASS — the app's kept `transaction-repository.ts` resolves `./transaction` + `./transaction-details/*` via shims; `transaction-details.tsx`/`transaction-additional-details.tsx` resolve their detail-type imports; `cashu-lightning-send-transaction-details` resolves `DestinationDetailsSchema` from `domains/cashu-send-quote`.

- [ ] **Step 7: Commit.**
```bash
git add packages/wallet-sdk/src/domains/transaction-details packages/wallet-sdk/src/domains/transaction.ts packages/wallet-sdk/src/index.ts packages/wallet-sdk/package.json apps/web-wallet/app/features/transactions/transaction.ts apps/web-wallet/app/features/transactions/transaction-details
git commit -m "refactor(wallet-sdk): move Transaction entity + details parser/schemas into the SDK"
```

---

## Task 5: Receive cores + `derivePublicKey` extraction (git mv / partial-move + shims)

> **New-logic-adjacent task** (the `derivePublicKey` extraction + `measureOperation` unwrap). Assign a dedicated quality-reviewer subagent.

**Files:**
- Move: `apps/web-wallet/app/features/receive/cashu-receive-quote-core.ts` → `packages/wallet-sdk/src/internal/cashu/receive-quote-core.ts`
- Move: `apps/web-wallet/app/features/receive/spark-receive-quote-core.ts` → `packages/wallet-sdk/src/internal/spark/receive-quote-core.ts`
- Modify: `packages/wallet-sdk/src/internal/cashu/cryptography.ts` (+`derivePublicKey`), `apps/web-wallet/app/features/shared/cryptography.ts` (re-export `derivePublicKey`), the 2 app core files (→ shims), `package.json`

- [ ] **Step 1: Add `derivePublicKey` to `src/internal/cashu/cryptography.ts`** (verbatim from `features/shared/cryptography.ts`, which uses `HDKey` already imported there in 3a):
```ts
/**
 * Derives a public key from an xpub and a derivation path.
 * @param xpub base58-check encoded xpub
 * @param derivationPath path to derive from
 * @returns the derived public key as a hex string ('' if the child key has no pubkey)
 */
export function derivePublicKey(xpub: string, derivationPath: string): string {
  const hdKey = HDKey.fromExtendedKey(xpub);
  const childKey = hdKey.derive(derivationPath);
  return childKey.publicKey
    ? Array.from(childKey.publicKey)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    : '';
}
```
  (If `HDKey` is not yet imported in `cryptography.ts`, add `import { HDKey } from '@scure/bip32';`.)

- [ ] **Step 2: Move the cores.**
```bash
git mv apps/web-wallet/app/features/receive/cashu-receive-quote-core.ts packages/wallet-sdk/src/internal/cashu/receive-quote-core.ts
git mv apps/web-wallet/app/features/receive/spark-receive-quote-core.ts packages/wallet-sdk/src/internal/spark/receive-quote-core.ts
```

- [ ] **Step 3: Repoint `cashu/receive-quote-core.ts`** (verified imports):
  - `~/lib/cashu` (`ExtendedCashuWallet`) → `./wallet`
  - `../accounts/account` (`RedactedCashuAccount`) → `../../domains/account-types`
  - `../shared/cashu` (`BASE_CASHU_LOCKING_DERIVATION_PATH`) → `./cryptography`
  - `../shared/cryptography` (`derivePublicKey`) → `./cryptography`
  - `../transactions/transaction-enums` (`TransactionPurpose`) → `../../domains/transaction-enums`
  - `./cashu-receive-quote` (`CashuReceiveQuote`) → `../../domains/cashu-receive-quote`
  - Keep `@agicash/money`, `@cashu/cashu-ts`, `@scure/bip32` (`HARDENED_OFFSET`), `@agicash/bolt11` (`decodeBolt11`), `@agicash/cashu` (`getCashuUnit`).

- [ ] **Step 4: Repoint `spark/receive-quote-core.ts`** + unwrap `measureOperation`:
  - `../accounts/account` (`SparkAccount`) → `../../domains/account-types`
  - `../transactions/transaction-enums` (`TransactionPurpose`) → `../../domains/transaction-enums`
  - **Remove** `import { measureOperation } from '~/lib/performance';` and replace each `measureOperation('<name>', () => <expr>)` (or its `await measureOperation(...)`) wrapper with the bare `<expr>` it wrapped. (Read the file; `measureOperation(label, fn)` calls `fn()` and returns its result — unwrap to a direct call. Keep the awaited Breez calls identical.)
  - Keep `@agicash/breez-sdk-spark`, `@agicash/money`, `@cashu/cashu-ts` (`Proof`), `@agicash/bolt11` (`parseBolt11Invoice`).
  - Verify: `grep -nE "from '~|measureOperation" packages/wallet-sdk/src/internal/spark/receive-quote-core.ts` returns nothing.

- [ ] **Step 5: App shims + partial-move re-export.**
  - `features/receive/cashu-receive-quote-core.ts`: `export * from '@agicash/wallet-sdk/internal/cashu/receive-quote-core';`
  - `features/receive/spark-receive-quote-core.ts`: `export * from '@agicash/wallet-sdk/internal/spark/receive-quote-core';`
  - `features/shared/cryptography.ts`: add `export { derivePublicKey } from '@agicash/wallet-sdk/internal/cashu/cryptography';` and **remove** the local `derivePublicKey` definition (keep `useCryptography` and its imports). Any app importer of `derivePublicKey` from `~/features/shared/cryptography` now resolves through the SDK.

- [ ] **Step 6: `package.json` exports** — add:
```jsonc
"./internal/cashu/cryptography": "./src/internal/cashu/cryptography.ts",
"./internal/cashu/receive-quote-core": "./src/internal/cashu/receive-quote-core.ts",
"./internal/spark/receive-quote-core": "./src/internal/spark/receive-quote-core.ts",
```

- [ ] **Step 7: Grep-verify.** `grep -rln "shared/cryptography'" apps/web-wallet/app` — confirm `derivePublicKey` importers resolve (the app's kept `cashu-receive-quote-core` is now a shim; any *other* importer reads `shared/cryptography`'s re-export). `grep -rln "receive/cashu-receive-quote-core'\|receive/spark-receive-quote-core'" apps/web-wallet/app` — confirm the app's kept receive services/transfer/lightning-address resolve via shims.

- [ ] **Step 8: Gate.** Run (repo root): `bun run typecheck && bun run test`. Expected: PASS.

- [ ] **Step 9: Commit.**
```bash
git add packages/wallet-sdk/src/internal/cashu/cryptography.ts packages/wallet-sdk/src/internal/cashu/receive-quote-core.ts packages/wallet-sdk/src/internal/spark/receive-quote-core.ts packages/wallet-sdk/package.json apps/web-wallet/app/features/receive/cashu-receive-quote-core.ts apps/web-wallet/app/features/receive/spark-receive-quote-core.ts apps/web-wallet/app/features/shared/cryptography.ts
git commit -m "refactor(wallet-sdk): move cashu/spark receive cores + extract derivePublicKey, unwrap measureOperation"
```

---

## Task 6: Cashu + Spark send repositories (copy + de-TanStack)

**Files (create):** `packages/wallet-sdk/src/internal/db/cashu-send-quote-repository.ts`, `…/cashu-send-swap-repository.ts`, `…/spark-send-quote-repository.ts`

For each: **copy** the app file (`apps/web-wallet/app/features/send/<name>.ts`) into the SDK path, then apply the **de-TanStack template** — drop the trailing `useX()` hook factory, drop `@tanstack/react-query` and the `agicashDbClient`/`useEncryption` imports (only the hook used them), repoint the imports below, and keep the class + all methods + the `Create*`/`Options` types **byte-for-byte**.

- [ ] **Step 1: `cashu-send-quote-repository.ts`** — copy, drop hook, repoint:
  - `../accounts/cashu-account` (`CashuProof`) → `../../domains/cashu-proof`
  - `../agicash-db/database` (`AgicashDb`, `AgicashDbCashuSendQuote`, …) → `./database`
  - `../agicash-db/database.client` (`agicashDbClient`) → **DROP**
  - `../agicash-db/json-models` (`CashuLightningSendDbDataSchema`) → `./json-models`
  - `../shared/encryption` (`Encryption`; drop `useEncryption`) → `../crypto/encryption`
  - `../shared/error` (`ConcurrencyError`) → `../../errors`
  - `../transactions/transaction-enums` (`TransactionPurpose`) → `../../domains/transaction-enums`
  - `./cashu-send-quote` → `../../domains/cashu-send-quote`
  - `./utils` (`toDecryptedCashuProofs`) → `./cashu-proof-decryption`
  - Keep `@agicash/money`, `@cashu/cashu-ts`, `@agicash/cashu` (`proofToY`), `@agicash/ecies` (`computeSHA256`), `@agicash/utils` (`AllUnionFieldsRequired`), `zod/mini`.

- [ ] **Step 2: `cashu-send-swap-repository.ts`** — copy, drop hook, repoint (same map as Step 1, plus `./cashu-send-swap` → `../../domains/cashu-send-swap`; `CashuSwapSendDbDataSchema` via `./json-models`).

- [ ] **Step 3: `spark-send-quote-repository.ts`** — copy, drop hook, repoint:
  - `../agicash-db/database` → `./database`; `../agicash-db/database.client` → DROP; `../agicash-db/json-models` (`SparkLightningSendDbDataSchema`) → `./json-models`
  - `../shared/encryption` → `../crypto/encryption`; `../shared/error` (`DomainError`) → `../../errors`
  - `../transactions/transaction-enums` → `../../domains/transaction-enums`; `./spark-send-quote` → `../../domains/spark-send-quote`
  - Keep `@agicash/money`, `@agicash/utils`, `zod/mini`.

- [ ] **Step 4: No `exports` entries** — these repos are SDK-internal (only `protocol-services.ts` imports them; the app keeps its own copies). No barrel change.

- [ ] **Step 5: Gate.** Run (repo root): `bun run typecheck && bun run test`. Expected: PASS — the SDK repos compile against the moved entities/json-models/db types; the app's identically-named copies are untouched.

- [ ] **Step 6: Commit.**
```bash
git add packages/wallet-sdk/src/internal/db/cashu-send-quote-repository.ts packages/wallet-sdk/src/internal/db/cashu-send-swap-repository.ts packages/wallet-sdk/src/internal/db/spark-send-quote-repository.ts
git commit -m "feat(wallet-sdk): cashu/spark send-quote + send-swap repositories (de-TanStacked)"
```

---

## Task 7: Cashu + Spark receive repositories (copy + de-TanStack)

**Files (create):** `packages/wallet-sdk/src/internal/db/cashu-receive-quote-repository.ts`, `…/cashu-receive-swap-repository.ts`, `…/spark-receive-quote-repository.ts`

Same de-TanStack template as Task 6. The cashu receive repos additionally inject `AccountRepository` (already in the SDK at `internal/db/account-repository.ts`).

- [ ] **Step 1: `cashu-receive-quote-repository.ts`** — copy, drop the `useCashuReceiveQuoteRepository` hook + `@tanstack/react-query`, repoint:
  - `../shared/encryption` (`Encryption`; drop `useEncryption`) → `../crypto/encryption`
  - `../accounts/account-repository` (`AccountRepository`; drop `useAccountRepository`) → `./account-repository`
  - `../agicash-db/database` → `./database`; `../agicash-db/database.client` → DROP; `../agicash-db/json-models` (`CashuLightningReceiveDbDataSchema`) → `./json-models`
  - `./cashu-receive-quote` → `../../domains/cashu-receive-quote`; `./cashu-receive-quote-core` (any `RepositoryCreateQuoteParams`/types) → `../cashu/receive-quote-core`
  - `../shared/error` → `../../errors`
  - Keep `@agicash/money`, `@cashu/cashu-ts`, `@agicash/cashu` (`proofToY`), `@agicash/ecies` (`computeSHA256`), `zod/mini`. Verify the full import list with `grep -nE "from '" apps/web-wallet/app/features/receive/cashu-receive-quote-repository.ts` and repoint any not listed.

- [ ] **Step 2: `cashu-receive-swap-repository.ts`** — copy, drop hook, repoint (same map; plus `./cashu-receive-swap` → `../../domains/cashu-receive-swap`; `CashuSwapReceiveDbDataSchema` via `./json-models`; `../shared/cashu` (`getTokenHash`, `tokenToMoney`) → `../cashu/token`; `../shared/error` (`UniqueConstraintError`) → `../../errors`).

- [ ] **Step 3: `spark-receive-quote-repository.ts`** — copy, drop hook, repoint (constructor is `(db, encryption)` only — no `AccountRepository`): `../shared/encryption` → `../crypto/encryption`; `../agicash-db/database` → `./database`; `database.client` → DROP; `../agicash-db/json-models` (`SparkLightningReceiveDbDataSchema`) → `./json-models`; `./spark-receive-quote` → `../../domains/spark-receive-quote`; `./spark-receive-quote-core` types → `../spark/receive-quote-core`; `../shared/error` → `../../errors`.

- [ ] **Step 4: Gate.** Run (repo root): `bun run typecheck && bun run test`. Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add packages/wallet-sdk/src/internal/db/cashu-receive-quote-repository.ts packages/wallet-sdk/src/internal/db/cashu-receive-swap-repository.ts packages/wallet-sdk/src/internal/db/spark-receive-quote-repository.ts
git commit -m "feat(wallet-sdk): cashu/spark receive-quote + receive-swap repositories (de-TanStacked)"
```

---

## Task 8: Transaction repository + Contact entity + Contact repository

**Files:**
- Move: `apps/web-wallet/app/features/contacts/contact.ts` → `packages/wallet-sdk/src/domains/contact.ts` (git mv + shim)
- Create: `packages/wallet-sdk/src/internal/db/transaction-repository.ts`, `…/contact-repository.ts` (copy + de-TanStack)
- Modify: app `contact.ts` (→ shim), `package.json`, `src/index.ts`

- [ ] **Step 1: Move the contact entity.** `git mv apps/web-wallet/app/features/contacts/contact.ts packages/wallet-sdk/src/domains/contact.ts`. It imports only `zod/mini` — no repoint. App shim: `export * from '@agicash/wallet-sdk/domains/contact';`. Add `"./domains/contact": "./src/domains/contact.ts"` to exports, and `export type { Contact } from './domains/contact';` + `export { isContact } from './domains/contact';` to `src/index.ts`.

- [ ] **Step 2: `transaction-repository.ts`** — copy `apps/web-wallet/app/features/transactions/transaction-repository.ts`, drop the `useTransactionRepository` hook + `@tanstack/react-query` + `agicashDbClient` + `useEncryption`, repoint:
  - `../agicash-db/database` (`AgicashDb`, `AgicashDbTransaction`) → `./database`; `database.client` → DROP
  - `../shared/encryption` (`Encryption`; drop `useEncryption`) → `../crypto/encryption`
  - `./transaction` (`Transaction`, `TransactionSchema`, `BaseTransactionSchema`) → `../../domains/transaction`
  - `./transaction-details/transaction-details-parser` → `../../domains/transaction-details/transaction-details-parser`
  - `./transaction-details/transaction-details-types` → `../../domains/transaction-details/transaction-details-types`
  - Keep `zod/mini`. **Keep the `Cursor` type export byte-for-byte** (it stays named `Cursor`). Keep `get`/`list`/`countTransactionsPendingAck`/`acknowledgeTransaction`/`toTransaction` unchanged.

- [ ] **Step 3: `contact-repository.ts`** — copy `apps/web-wallet/app/features/contacts/contact-repository.ts`, drop the `useContactRepository` hook + the `~/hooks/use-location` (`useLocationData`) import (the class already takes `domain` via constructor), repoint:
  - `../agicash-db/database` (`AgicashDb`, `AgicashDbContact`) → `./database`
  - `../user/user` (`UserProfile`) → `../../domains/user-types`
  - `../shared/error` (`DomainError`) → `../../errors`
  - `./contact` (`Contact`, `CreateContact`, `isContact`) → `../../domains/contact`
  - Keep the `(db, domain)` constructor + `get`/`getAll`/`create`/`delete`/`findContactCandidates`/`static toContact` byte-for-byte.

- [ ] **Step 4: Gate.** Run (repo root): `bun run typecheck && bun run test`. Expected: PASS — `transaction-repository` resolves the moved entity/details (Task 4); `contact-repository` resolves the moved `contact` + `UserProfile`.

- [ ] **Step 5: Commit.**
```bash
git add packages/wallet-sdk/src/domains/contact.ts packages/wallet-sdk/src/internal/db/transaction-repository.ts packages/wallet-sdk/src/internal/db/contact-repository.ts packages/wallet-sdk/src/index.ts packages/wallet-sdk/package.json apps/web-wallet/app/features/contacts/contact.ts
git commit -m "feat(wallet-sdk): transaction + contact repositories (de-TanStacked) + move Contact entity"
```

---

## Task 9: Cashu + Spark receive services (copy + de-TanStack)

**Files (create):** `packages/wallet-sdk/src/internal/services/cashu-receive-swap-service.ts`, `…/cashu-receive-quote-service.ts`, `…/spark-receive-quote-service.ts`

De-TanStack template: copy, drop the `useXService` hook + `@tanstack/react-query`, repoint, keep methods byte-for-byte. (Order: swap-service first — `CashuSendSwapService` in Task 10 depends on it.)

- [ ] **Step 1: `cashu-receive-swap-service.ts`** — copy `apps/web-wallet/app/features/receive/cashu-receive-swap-service.ts`, drop hook, repoint:
  - `./cashu-receive-swap-repository` (`CashuReceiveSwapRepository`) → `../db/cashu-receive-swap-repository`
  - `~/lib/cashu` (`ExtendedCashuWallet`, `getCashuWallet`, `OutputData` re-exports) → `../cashu/wallet` (and `@cashu/cashu-ts` for `OutputData` if imported from there)
  - `../shared/cashu` (`tokenToMoney`) → `../cashu/token`
  - `./cashu-receive-swap` → `../../domains/cashu-receive-swap`
  - `../shared/error` → `../../errors`
  - Keep `@agicash/money`, `@agicash/cashu` (`sumProofs`, `areMintUrlsEqual`), `@cashu/cashu-ts`.

- [ ] **Step 2: `cashu-receive-quote-service.ts`** — copy, drop hook, repoint:
  - `../shared/cashu` (`CashuCryptography`; drop `useCashuCryptography`) → `../cashu/cryptography`
  - `./cashu-receive-quote-repository` → `../db/cashu-receive-quote-repository`
  - `./cashu-receive-quote-core` → `../cashu/receive-quote-core`
  - `~/lib/cashu` (`ExtendedCashuWallet`) → `../cashu/wallet`
  - `./cashu-receive-quote` → `../../domains/cashu-receive-quote`
  - Keep `@cashu/cashu-ts` (`splitAmount`, `OutputData`, `MintOperationError`), `@agicash/cashu` (`CashuErrorCodes`, `getCashuUnit`).

- [ ] **Step 3: `spark-receive-quote-service.ts`** — copy, drop hook, repoint:
  - `./spark-receive-quote-repository` → `../db/spark-receive-quote-repository`
  - `./spark-receive-quote-core` (`computeQuoteExpiry`, `getAmountAndFee`, types) → `../spark/receive-quote-core`
  - `./spark-receive-quote` → `../../domains/spark-receive-quote`
  - `../shared/error` → `../../errors`

- [ ] **Step 4: Gate.** Run (repo root): `bun run typecheck && bun run test`. Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add packages/wallet-sdk/src/internal/services/cashu-receive-swap-service.ts packages/wallet-sdk/src/internal/services/cashu-receive-quote-service.ts packages/wallet-sdk/src/internal/services/spark-receive-quote-service.ts
git commit -m "feat(wallet-sdk): cashu/spark receive-quote + receive-swap services (de-TanStacked)"
```

---

## Task 10: Cashu + Spark send services (copy + de-TanStack)

**Files (create):** `packages/wallet-sdk/src/internal/services/cashu-send-quote-service.ts`, `…/cashu-send-swap-service.ts`, `…/spark-send-quote-service.ts`

- [ ] **Step 1: `cashu-send-quote-service.ts`** — copy `apps/web-wallet/app/features/send/cashu-send-quote-service.ts`, drop hook, repoint:
  - `./cashu-send-quote-repository` → `../db/cashu-send-quote-repository`
  - `./cashu-send-quote` → `../../domains/cashu-send-quote`
  - `~/lib/cashu` (`ExtendedCashuWallet`, …) → `../cashu/wallet`
  - `../accounts/account` (`CashuAccount`) → `../../domains/account-types`; `../accounts/cashu-account` (`CashuProof`) → `../../domains/cashu-proof`
  - `../transactions/transaction-enums` → `../../domains/transaction-enums`
  - `../shared/error` → `../../errors`
  - Keep `@agicash/money`, `@agicash/bolt11` (decode/parse), `@agicash/cashu` (`getCashuUnit`, `sumProofs`, `matchBlindSignaturesToOutputData`), `@cashu/cashu-ts`.

- [ ] **Step 2: `cashu-send-swap-service.ts`** — copy, drop hook, repoint (same map) plus the cross-service dep:
  - `./cashu-send-swap-repository` → `../db/cashu-send-swap-repository`
  - `./cashu-send-swap` → `../../domains/cashu-send-swap`
  - `../receive/cashu-receive-swap-service` (`CashuReceiveSwapService`) → `./cashu-receive-swap-service`
  - `../shared/cashu` (`getCashuUnit`/`getCashuProtocolUnit` if imported from there) → `../cashu/wallet` or `@agicash/cashu` as appropriate; `getTokenHash` → `../cashu/token`
  - Keep `@cashu/cashu-ts` (`OutputData`, `splitAmount`).

- [ ] **Step 3: `spark-send-quote-service.ts`** — copy, drop hook, repoint:
  - `./spark-send-quote-repository` → `../db/spark-send-quote-repository`
  - `./spark-send-quote` → `../../domains/spark-send-quote`
  - `../accounts/account` (`SparkAccount`) → `../../domains/account-types`
  - `~/lib/spark/errors` (`isInsufficentBalanceError`, `isInvoiceAlreadyPaidError`) → `../spark/errors`
  - `../transactions/transaction-enums` → `../../domains/transaction-enums`
  - `../shared/error` (`DomainError`) → `../../errors`
  - **Remove** any `~/lib/performance` (`measureOperation`) wrapper (unwrap as in Task 5) if present.
  - Keep `@agicash/money`, `@agicash/bolt11`, `@agicash/breez-sdk-spark`.

- [ ] **Step 4: Gate.** Run (repo root): `bun run typecheck && bun run test`. Expected: PASS.

- [ ] **Step 5: Commit.**
```bash
git add packages/wallet-sdk/src/internal/services/cashu-send-quote-service.ts packages/wallet-sdk/src/internal/services/cashu-send-swap-service.ts packages/wallet-sdk/src/internal/services/spark-send-quote-service.ts
git commit -m "feat(wallet-sdk): cashu/spark send-quote + send-swap services (de-TanStacked)"
```

---

## Task 11: Transfer service (copy + de-TanStack)

> **New-logic-adjacent task** (cross-service orchestrator repoint). Assign a dedicated quality-reviewer subagent to confirm behavior preservation.

**Files (create):** `packages/wallet-sdk/src/internal/services/transfer-service.ts`

- [ ] **Step 1: Copy `transfer-service.ts`** from `apps/web-wallet/app/features/transfer/transfer-service.ts`, drop the `useTransferService` hook + `@tanstack/react-query`, repoint:
  - `../receive/cashu-receive-quote-service` → `./cashu-receive-quote-service`
  - `../receive/cashu-receive-quote-core` (types) → `../cashu/receive-quote-core`
  - `../receive/spark-receive-quote-service` → `./spark-receive-quote-service`
  - `../receive/spark-receive-quote-core` (`getSparkLightningQuote` if used + types) → `../spark/receive-quote-core`
  - `../send/cashu-send-quote-service` (`CashuSendQuoteService`, `CashuLightningQuote`) → `./cashu-send-quote-service`
  - `../send/spark-send-quote-service` (`SparkSendQuoteService`, `SparkLightningQuote`) → `./spark-send-quote-service`
  - `../accounts/account` (`Account`, `CashuAccount`, `SparkAccount`, `canSendToLightning`, `canReceiveFromLightning`) → `../../domains/account-types`
  - `../shared/error` (`DomainError`) → `../../errors`
  - Keep `@agicash/money`. Keep the `(cashuReceiveQuoteService, sparkReceiveQuoteService, cashuSendQuoteService, sparkSendQuoteService)` constructor and `getTransferQuote`/`initiateTransfer` + the `TransferQuote`/`TransferReceiveSide`/`TransferSendSide` types byte-for-byte.

- [ ] **Step 2: Barrel** — in `src/index.ts` add `export type { TransferQuote } from './internal/services/transfer-service';` (the public quote type; the service class stays internal).

- [ ] **Step 3: Gate.** Run (repo root): `bun run typecheck && bun run test`. Expected: PASS — all 4 injected services resolve to their SDK copies (Tasks 9/10); the spark core's `getSparkLightningQuote` resolves (Task 5).

- [ ] **Step 4: Commit.**
```bash
git add packages/wallet-sdk/src/internal/services/transfer-service.ts packages/wallet-sdk/src/index.ts
git commit -m "feat(wallet-sdk): transfer service (de-TanStacked cross-protocol orchestrator)"
```

---

## Task 12: `createProtocolServices` factory + WalletRuntime wiring + Sdk config

> **New-logic task.** Assign a dedicated quality-reviewer subagent. This is the only task that wires construction (constructor order + cross-service deps); `tsc` checks the types but not the ordering, so review the dependency order against the constructor signatures.

**Files:**
- Create: `packages/wallet-sdk/src/internal/protocol-services.ts`
- Modify: `packages/wallet-sdk/src/internal/wallet-runtime.ts`, `packages/wallet-sdk/src/sdk.ts`

- [ ] **Step 1: Create `src/internal/protocol-services.ts`:**
```ts
import type { AgicashDb } from './db/database';
import type { Encryption } from './crypto/encryption';
import type { CashuCryptography } from './cashu/cryptography';
import type { AccountRepository } from './db/account-repository';

import { CashuSendQuoteRepository } from './db/cashu-send-quote-repository';
import { CashuSendSwapRepository } from './db/cashu-send-swap-repository';
import { SparkSendQuoteRepository } from './db/spark-send-quote-repository';
import { CashuReceiveQuoteRepository } from './db/cashu-receive-quote-repository';
import { CashuReceiveSwapRepository } from './db/cashu-receive-swap-repository';
import { SparkReceiveQuoteRepository } from './db/spark-receive-quote-repository';
import { TransactionRepository } from './db/transaction-repository';
import { ContactRepository } from './db/contact-repository';

import { CashuSendQuoteService } from './services/cashu-send-quote-service';
import { CashuSendSwapService } from './services/cashu-send-swap-service';
import { SparkSendQuoteService } from './services/spark-send-quote-service';
import { CashuReceiveQuoteService } from './services/cashu-receive-quote-service';
import { CashuReceiveSwapService } from './services/cashu-receive-swap-service';
import { SparkReceiveQuoteService } from './services/spark-receive-quote-service';
import { TransferService } from './services/transfer-service';

export type ProtocolServices = {
  cashuSendQuoteRepository: CashuSendQuoteRepository;
  cashuSendSwapRepository: CashuSendSwapRepository;
  sparkSendQuoteRepository: SparkSendQuoteRepository;
  cashuReceiveQuoteRepository: CashuReceiveQuoteRepository;
  cashuReceiveSwapRepository: CashuReceiveSwapRepository;
  sparkReceiveQuoteRepository: SparkReceiveQuoteRepository;
  transactionRepository: TransactionRepository;
  contactRepository: ContactRepository;

  cashuSendQuoteService: CashuSendQuoteService;
  cashuSendSwapService: CashuSendSwapService;
  sparkSendQuoteService: SparkSendQuoteService;
  cashuReceiveQuoteService: CashuReceiveQuoteService;
  cashuReceiveSwapService: CashuReceiveSwapService;
  sparkReceiveQuoteService: SparkReceiveQuoteService;
  transferService: TransferService;
};

type Foundation = {
  db: AgicashDb;
  encryption: Encryption;
  cashuCryptography: CashuCryptography;
  accountRepository: AccountRepository;
};

type Deps = {
  /** LN-address domain for contact lud16 composition (SdkConfig.domain). */
  domain: string;
};

/**
 * Builds the protocol repositories + services over the foundation runtime, in
 * dependency order (receive-swap service precedes cashu send-swap service; the
 * four quote services precede the transfer service). Stateless — holds no
 * disposable resources of its own (reuses the foundation's mintCache/sparkWallets,
 * which the WalletRuntime disposes).
 */
export function createProtocolServices(
  foundation: Foundation,
  deps: Deps,
): ProtocolServices {
  const { db, encryption, cashuCryptography, accountRepository } = foundation;

  const cashuSendQuoteRepository = new CashuSendQuoteRepository(db, encryption);
  const cashuSendSwapRepository = new CashuSendSwapRepository(db, encryption);
  const sparkSendQuoteRepository = new SparkSendQuoteRepository(db, encryption);
  const cashuReceiveQuoteRepository = new CashuReceiveQuoteRepository(
    db,
    encryption,
    accountRepository,
  );
  const cashuReceiveSwapRepository = new CashuReceiveSwapRepository(
    db,
    encryption,
    accountRepository,
  );
  const sparkReceiveQuoteRepository = new SparkReceiveQuoteRepository(
    db,
    encryption,
  );
  const transactionRepository = new TransactionRepository(db, encryption);
  const contactRepository = new ContactRepository(db, deps.domain);

  const cashuReceiveSwapService = new CashuReceiveSwapService(
    cashuReceiveSwapRepository,
  );
  const cashuReceiveQuoteService = new CashuReceiveQuoteService(
    cashuCryptography,
    cashuReceiveQuoteRepository,
  );
  const sparkReceiveQuoteService = new SparkReceiveQuoteService(
    sparkReceiveQuoteRepository,
  );
  const cashuSendQuoteService = new CashuSendQuoteService(
    cashuSendQuoteRepository,
  );
  const cashuSendSwapService = new CashuSendSwapService(
    cashuSendSwapRepository,
    cashuReceiveSwapService,
  );
  const sparkSendQuoteService = new SparkSendQuoteService(
    sparkSendQuoteRepository,
  );
  const transferService = new TransferService(
    cashuReceiveQuoteService,
    sparkReceiveQuoteService,
    cashuSendQuoteService,
    sparkSendQuoteService,
  );

  return {
    cashuSendQuoteRepository,
    cashuSendSwapRepository,
    sparkSendQuoteRepository,
    cashuReceiveQuoteRepository,
    cashuReceiveSwapRepository,
    sparkReceiveQuoteRepository,
    transactionRepository,
    contactRepository,
    cashuSendQuoteService,
    cashuSendSwapService,
    sparkSendQuoteService,
    cashuReceiveQuoteService,
    cashuReceiveSwapService,
    sparkReceiveQuoteService,
    transferService,
  };
}
```

> **Verify each constructor signature against the copied SDK file before relying on the wiring above** (read each `*-repository.ts`/`*-service.ts` constructor). The shapes here match the explored app sources: send/spark repos `(db, encryption)`; cashu receive repos `(db, encryption, accountRepository)`; spark receive repo `(db, encryption)`; transaction repo `(db, encryption)`; contact repo `(db, domain)`; `CashuReceiveQuoteService(cashuCryptography, repo)`; `CashuSendSwapService(repo, cashuReceiveSwapService)`; `TransferService(cashuReceiveQuoteService, sparkReceiveQuoteService, cashuSendQuoteService, sparkSendQuoteService)`. Fix any mismatch the copy introduced (e.g. an extra `Options` defaulting param).

- [ ] **Step 2: Wire into `src/internal/wallet-runtime.ts`.** Add `protocols: ProtocolServices` to the `WalletRuntime` type; add `domain: string` to the factory `Deps`; after the foundation objects are built (and `accountRepository`/`encryption`/`cashuCryptography` exist), construct and include `protocols`:
```ts
// imports
import { createProtocolServices, type ProtocolServices } from './protocol-services';

// in WalletRuntime type, add:
  protocols: ProtocolServices;

// in Deps, add:
  domain: string;

// in createWalletRuntime, after accountService is built:
  const protocols = createProtocolServices(
    { db: deps.db, encryption, cashuCryptography, accountRepository },
    { domain: deps.domain },
  );

// add `protocols` to the returned object. dispose() is UNCHANGED
// (protocol services hold no disposable resources).
```

- [ ] **Step 3: Thread `domain` in `src/sdk.ts`.** At the `createWalletRuntime({ … })` call, add `domain: config.domain ?? ''`. (Read the current call; the other deps — `db`, `keys`, `os`, `isLoggedIn`, `breezApiKey`, `sparkStorageDir` — are already passed.) No other `sdk.ts` change; the runtime is still reached via `sdk[walletRuntimeKey]`, now exposing `.protocols`.

> Note: `ContactRepository` with an empty `domain` composes `username@` lud16s; full-featured contact use requires `SdkConfig.domain`. This matches the spec (`domain?: string` is optional, "LN-address domain for contact composition"). Document in the commit body; the variant/facade plans surface it to hosts.

- [ ] **Step 4: Gate.** Run (repo root): `bun run typecheck && bun run test`. Expected: PASS — the factory typechecks against every copied constructor; the runtime exposes `protocols`; the existing wallet-sdk + app suites stay green.

- [ ] **Step 5: Re-run the Breez-connect smoke (final spark validation).** If Task 0 Step 5 could not run (no key then), it MUST run now before this branch is pushed/merged — the spark services (Tasks 7/9/10/11) are now in place. `VITE_BREEZ_API_KEY=<key> bun packages/wallet-sdk/examples/spark-connect-smoke.ts`. If still blocked on the key, flag to the user that spark runtime is unvalidated and must be smoked before merge.

- [ ] **Step 6: Commit.**
```bash
git add packages/wallet-sdk/src/internal/protocol-services.ts packages/wallet-sdk/src/internal/wallet-runtime.ts packages/wallet-sdk/src/sdk.ts
git commit -m "feat(wallet-sdk): createProtocolServices factory wired into WalletRuntime.protocols"
```

---

## Self-Review

**Spec coverage (3b slice of the base spec + the user's explicit scope list):**
- "cashu send+receive quote+swap repos+services" → Tasks 6 (cashu send repos), 7 (cashu receive repos), 9 (cashu receive services), 10 (cashu send services). ✓
- "spark send+receive quote repos+services" → Tasks 6 (spark send repo), 7 (spark receive repo), 9 (spark receive service), 10 (spark send service). ✓
- "the transaction repo (+ Transaction entity / cursor / details-parser / enums)" → Task 1 (enums), Task 4 (entity + details-parser), Task 8 (repo + `Cursor`). ✓
- "the contact repo (+ Contact entity)" → Task 8. ✓
- "the transfer service" → Task 11. ✓
- "the remaining agicash-db json-models" → Task 3 (7 models + the account-details union; the cashu-lightning-send circular dep resolves because `domains/cashu-send-quote` moved in Task 1). ✓
- "reach the foundation via `sdk[walletRuntimeKey]` (extend WalletRuntime or add a protocol-services factory)" → Task 12 (`WalletRuntime.protocols` + `createProtocolServices`). ✓
- Spec `TransactionsDomain.list(cursor)`/`get`/`countPendingAck`/`acknowledge` — backed by the moved `TransactionRepository` (facade deferred). ✓
- Spec `TransfersDomain.createQuote`/`execute` — backed by `TransferService.getTransferQuote`/`initiateTransfer` (facade rename deferred). ✓ (flagged)
- Spec `ContactsDomain.search` — `ContactRepository.findContactCandidates` (RPC `find_contact_candidates`). ✓

**Explicitly flagged, not silently dropped:** token-claim orchestrators (`claim`/`receive-cashu-token`/`receive-cashu-token-quote` services — power `receiveToken`, deferred to facade/variant as cache-coupled orchestrators); `.server.ts` variants + LN-address (Plan 5); subscription managers + processors + hooks/caches (Plan 4); scan/send-UI helpers + zustand stores + `.tsx` (later/UI). See Out-of-scope.

**Placeholder scan:** new code (the factory, `derivePublicKey`) is complete; every move cites exact source→dest + import repoints; every copy cites the source path + the drop-list + the repoint map + "keep byte-for-byte." No "TBD"/"handle errors"/"similar to." ✓

**Type/name consistency:** `ProtocolServices` field names (Task 12) match the constructor wiring; constructor shapes used in the factory match the de-TanStack tasks' stated constructors (repos `(db, encryption)` / cashu-receive `(…, accountRepository)` / contact `(db, domain)`; `CashuReceiveQuoteService(cashuCryptography, repo)`; `CashuSendSwapService(repo, cashuReceiveSwapService)`; `TransferService(4 services)`). `Cursor` kept (not renamed). `Encryption`/`CashuCryptography`/`AccountRepository` types come from the foundation runtime built in 3a. Every `git mv` target has a matching `package.json` exports entry + (for public types) a barrel export. ✓

**Open risks to verify during execution (flagged in-task):** exact `supabase/database.types` relative depth from `domains/transaction-details/` (Task 4); which transaction-details files actually have app importers (grep-driven shimming, Task 4); the full import list of each receive repo before repointing (Task 7); whether any send service wraps `measureOperation` (Task 10); each copied constructor's exact param list before the factory relies on it (Task 12). Each has a verify step at its task.

**Dependency ordering (build order is the task order):** enums/send-entities/util (1) → receive-entities (2) → json-models (3, needs send entities) → transaction details+entity (4, needs json-models + enums + DestinationDetails) → receive cores (5, needs receive entities + enums) → send repos (6) → receive repos (7) → transaction+contact repos (8) → receive services (9) → send services (10, cashu-send-swap needs cashu-receive-swap from 9) → transfer service (11, needs all 4 quote services) → factory wiring (12). The Breez smoke (Task 0 / re-run Task 12) gates spark runtime before merge.

**Deferred follow-ups (tracked, not done):** delete the app's duplicated TanStack repos/services/hooks (variant web-migration); the public domain facade + 7 hot reads + `TransactionCursor` rename + balance-as-field (variant plans); token-claim orchestrators + `receiveToken` (facade/variant); `.server.ts` + LN-address (Plan 5); processors/subscription-managers/change-feed/leader-election (Plan 4); characterization tests for the moved state machines (the app never had them).
