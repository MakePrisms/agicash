# Wallet SDK — Base Plan 3a: Foundation (crypto, encryption, wallet runtime, accounts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the SDK-internal **foundation** the protocol services need: a framework-free `Encryption` over `KeyService`, a `CashuCryptography` adapter, the cashu wallet runtime (`ExtendedCashuWallet` + a TanStack-free mint-data cache + `getInitializedCashuWallet`), the spark wallet runtime (`SparkWalletManager` owning Breez `connect()` per network), and the accounts vertical (`Account` types, `AccountRepository`, `AccountService`) wired into a disposable `WalletRuntime` — all runnable headless under bun, line-identical across both variant PRs.

**Architecture:** The app's wallet logic is already React-free at the service/repository layer (constructor DI); the only React/TanStack coupling is the `use*` hook factories, the `*-hooks.ts` cache files, and the `QueryClient` injected into the wallet/mint caching. This plan extracts the foundation with a **hybrid strategy**: boundary-crossing pure types/primitives are `git mv`'d into the SDK with an app re-export shim (single source of truth, preserves type identity — `account.wallet` is an `ExtendedCashuWallet`); construction-differing logic (`AccountRepository`, `AccountService`, wallet-init, cryptography) is **copied** into the SDK and de-TanStacked (the `QueryClient` becomes `KeyService` + a `MintDataCache` + a `SparkWalletManager`), while the app keeps its TanStack copies untouched until the variant web-migration deletes them. No public domain facade is wired here (the 7 hot reads are variant-specific and lifecycle methods need processors — Plan 4 / variants).

**Tech Stack:** TypeScript (ESM, `moduleResolution: Bundler`, `noEmit`), `bun test`. New SDK deps: `@cashu/cashu-ts` (catalog), `type-fest` (direct). Already present: `@agicash/money|cashu|ecies|opensecret|utils`, `@agicash/breez-sdk-spark`, `@scure/bip32`, `@noble/hashes`, `@stablelib/base64`, `jwt-decode`, `zod`.

**Gate (every task):** `bun run typecheck` + `bun run test` from repo root (never `fix:all` — that is biome lint/format only and does NOT typecheck). `tsc` is the catch-all for dangling imports in every form (alias/relative/value/type-only). `bun run test` keeps the existing app suite green (its TanStack wallet code is untouched); no new unit tests are added in this plan (per the chosen minimal-testing scope) beyond a single **documented, non-gated** headless Breez-connect smoke in Task 6.

**Out of scope (later plans):** all protocol repos/services (cashu/spark send+receive quote/swap), transactions, contacts, transfers (**Plan 3b**); change-feed/realtime, the six processors, subscription managers, leader election (**Plan 4**); server-mode `.server.ts` repo/service variants + LN-address routes (**Plan 5**); the public `Sdk.accounts`/`Sdk.cashu`/… domain facade and the web migration that deletes the app's TanStack wallet copies (**variant plans**); scan + rates domains (**later**). The balance-as-a-field domain mapping is left as a feed/variant concern (`getAccountBalance` stays the computation).

---

## Key design decisions (baked into this plan)

1. **`KeyService` already replaces the crypto caching.** Plan 2's `KeyService` (`src/internal/keys.ts`) provides in-memory-cached `getCashuSeed`, `getSparkMnemonic`, `getEncryptionPrivateKey`, `getEncryptionPublicKey`, `getCashuLockingXpub`, `getSparkIdentityPublicKey(network)`, all dropped on `clear()`. So `sparkMnemonicQueryOptions`, `seedQueryOptions`, `xpubQueryOptions`, `encryption*QueryOptions` have **no SDK equivalent to build** — they collapse into `KeyService` calls.
2. **Two genuinely-new infrastructure caches replace the rest of the `QueryClient` usage** (these are NOT the deferred variant "engine seams" — they are plain in-memory infra caches):
   - **`SparkWalletManager`** — one Breez `connect()` per network, cached as a `Promise<BreezSdk>`, disconnected on `dispose()`. Replaces `sparkWalletQueryOptions` + `getInitializedSparkWallet`. **This is where headless `connect()` is validated** (Plan 2 deferred full `connect()` to Plan 3).
   - **`MintDataCache`** — a 1h-TTL in-memory cache of mint info/keysets/keys with in-flight dedupe and evict-on-reject. Replaces `mintInfoQueryOptions`/`allMintKeysetsQueryOptions`/`mintKeysQueryOptions`; `getInitializedCashuWallet` keeps the 10s-timeout→offline-wallet race over it.
3. **Hybrid extraction (treatment per file is explicit in File Structure):**
   - **`git mv` + app re-export shim** (boundary-crossing pure types/primitives, one source of truth): `account.ts`, `cashu-account.ts`, `account-cryptography.ts`, `lib/cashu/utils.ts` (`ExtendedCashuWallet`/`getCashuWallet`), `lib/cashu/mint-validation.ts`.
   - **Partial-move** (mixed pure+React files: extract pure into SDK, app file keeps its hooks and re-exports the pure parts from the SDK): `features/shared/encryption.ts`, `features/shared/cashu.ts`, `features/shared/spark.ts`.
   - **Copy (duplicate) into SDK, app copy untouched** (trivial pure helpers; avoids cross-package churn in the still-TanStack app): `createSparkWalletStub`, the two spark error guards.
   - **Copy + de-TanStack into SDK, app copy untouched** (construction differs): `AccountRepository`, `AccountService`, the default-account read, `getInitialized{Cashu,Spark}Wallet`, `getCashuCryptography`, `agicash-mint-auth-provider`.
4. **No facade, but a disposable `WalletRuntime`.** A `createWalletRuntime(deps)` factory constructs `{ encryption, cashuCryptography, mintCache, mintAuth, sparkWallets, accountRepository, accountService }`. The `Sdk` constructs it after auth and tears down `sparkWallets`/caches on `dispose()`. Public domain methods are deferred; the runtime is exposed only via an internal getter for Plan 3b.
5. **`getMintAuthProvider`/CAT token** becomes a small `AgicashMintAuthProvider` cache class (mirrors `SessionTokenProvider`): `generateThirdPartyToken('agicash-mint')` cached to 5s-before-exp, gated by `isLoggedIn`. Used only for `gift-card`/`offer` accounts.
6. **`sparkStorageDir`** is added to `SdkConfig` (optional, default `'./.spark-data'`) — headless node needs a writable dir; the value passed to `connect()` is preserved verbatim (no per-network sub-dir, matching today).
7. **Minimal testing (chosen):** move + repoint + gate on `typecheck` + existing suite. No new unit tests. One documented (non-gated) headless `connect()` smoke script for the riskiest new runtime. **Deferred follow-up:** characterization tests for the moved state machines (the app never had them).
8. **`lib/spark/wasm.ts` stays in the app** (browser WASM bootstrap). The SDK's spark runtime ports only the stub + error guards; `connect()` resolves to the Node build headless (Plan 2 verified). Web must still `ensureBreezWasm()` before SDK spark ops — a variant-plan web-integration concern, flagged not solved here.
9. **`UserDomain.setDefaultAccount`/`setDefaultCurrency`** (Plan 2 deferrals) are closed here — they wire to the existing `WriteUserRepository.update`. The user-repo `upsert` is **not** changed to return accounts (the RPC already creates the rows; accounts are read via `AccountRepository`); the Plan-2 auth flow is untouched.
10. **Default-account read stays server-safe (redacted, no decryption).** The app's `ReadUserDefaultAccountRepository` returns a `RedactedAccount` (no `proofs`) and never decrypts, because the LN-address routes run in **service-role/server mode with no user encryption key** (Plan 5). The SDK preserves this exactly as a separate `DefaultAccountRepository` (no `Encryption` dep; cashu wallet initialized **without a seed**). It is deliberately NOT folded into `AccountRepository.toAccount` (which decrypts) — that would throw on the server. The spec's `accounts.getDefault: Promise<Account>` is satisfied by a redacted account here; if a client facade later needs proofs on the default account, it can re-read via `accounts.get(id)` (decided in the variant plans).

---

## File Structure

**Created in `packages/wallet-sdk/`:**

```
src/
  domains/
    account-types.ts          # Account, CashuAccount, SparkAccount, ExtendedAccount, RedactedAccount,
                              #   AccountType/Purpose/State + pure helpers (canSendToLightning, getAccountBalance, …)  [git mv from app]
    cashu-proof.ts            # CashuProofSchema, CashuProof, toProof  [git mv from app cashu-account.ts]
  internal/
    key-derivation.ts         # getSeedPhraseDerivationPath (BIP-85)  [git mv from app account-cryptography.ts]
    crypto/
      encryption.ts           # pure ECIES module + Encryption type + getEncryption  [extracted from app shared/encryption.ts]
      create-encryption.ts    # createEncryption(keyService): Encryption  [new]
    cashu/
      wallet.ts               # ExtendedCashuWallet + getCashuWallet  [git mv from app lib/cashu/utils.ts]
      mint-validation.ts      # buildMintValidator + MintBlocklistSchema  [git mv from app lib/cashu/mint-validation.ts]
      token.ts                # tokenToMoney + getTokenHash + getCurrencyAndUnitFromToken  [extracted from app shared/cashu.ts]
      cryptography.ts         # CashuCryptography type + createCashuCryptography + BASE_CASHU_LOCKING_DERIVATION_PATH  [new]
      mint-cache.ts           # MintDataCache (1h TTL)  [new]
      mint-auth-provider.ts   # AgicashMintAuthProvider + getMintAuthProvider  [new]
      init-wallet.ts          # getInitializedCashuWallet (over MintDataCache)  [copy + de-TanStack]
    spark/
      errors.ts               # isInsufficentBalanceError, isInvoiceAlreadyPaidError  [copy]
      stub.ts                 # createSparkWalletStub  [copy]
      wallet-manager.ts       # SparkWalletManager (connect/cache/dispose)  [new; replaces getInitializedSparkWallet]
    db/
      account-repository.ts          # AccountRepository — full client read, decrypts proofs  [copy + de-TanStack]
      default-account-repository.ts  # DefaultAccountRepository -> RedactedAccount, server-safe (NO decryption)  [copy + de-TanStack]
    services/
      account-service.ts      # AccountService  [copy + de-TanStack]
    wallet-runtime.ts         # WalletRuntime type + createWalletRuntime(deps)  [new]
```

**Modified (SDK):** `package.json` (deps), `src/internal/keys.ts` (export `CASHU_SEED_PATH`), `src/config.ts` (`sparkStorageDir?`), `src/domains/user.ts` (`setDefaultAccount`/`setDefaultCurrency`), `src/sdk.ts` (construct + dispose `WalletRuntime`), `src/index.ts` (barrel exports).

**Modified (app) — re-export shims / partial-move re-exports (keep the existing TanStack app compiling unchanged):**
- `features/accounts/account.ts` → `export * from '@agicash/wallet-sdk/domains/account-types';`
- `features/accounts/cashu-account.ts` → `export * from '@agicash/wallet-sdk/domains/cashu-proof';`
- `features/accounts/account-cryptography.ts` → `export * from '@agicash/wallet-sdk/internal/key-derivation';`
- `lib/cashu/index.ts` → repoint `ExtendedCashuWallet`/`getCashuWallet`/`buildMintValidator`/`MintBlocklistSchema` re-exports to the SDK.
- `features/shared/encryption.ts` → re-export the pure surface from the SDK; keep the hooks + queryOptions.
- `features/shared/cashu.ts`, `features/shared/spark.ts` → re-export the moved pure surface from the SDK; keep the React hooks + queryOptions + the TanStack `getInitialized*Wallet` the app still uses.

> The app's `account-repository.ts`, `account-service.ts`, `user-repository.ts` (incl. `ReadUserDefaultAccountRepository`), `agicash-mint-auth-provider.ts`, and `account-hooks.ts` are **left as-is** — they keep constructing the TanStack versions until the variant web-migration. The SDK gets its own de-TanStacked copies. This duplication is intentional and temporary.

---

## Task 0: SDK dependencies + barrel prep

**Files:** `packages/wallet-sdk/package.json`, `packages/wallet-sdk/src/index.ts`

- [ ] **Step 1: Verify versions.** `@cashu/cashu-ts` is already in the root `workspaces.catalog` (added during the cashu lib extraction) — confirm with `grep '@cashu/cashu-ts' package.json`. Find the `type-fest` version already used in the repo: `grep -r '"type-fest"' packages apps --include=package.json`.

- [ ] **Step 2: Add deps to `packages/wallet-sdk/package.json`** (alphabetical within `dependencies`): `"@cashu/cashu-ts": "catalog:"` and `"type-fest": "<version-from-step-1>"`.

- [ ] **Step 3: Install.** Ask the user before installing (CLAUDE.md autonomy). Run: `bun install`. Expected: lockfile updates; no version conflicts (these versions already resolve elsewhere in the workspace).

- [ ] **Step 4: Gate.** Run (repo root): `bun run typecheck && bun run test`. Expected: PASS (no code changed yet).

- [ ] **Step 5: Commit.**

```bash
git add packages/wallet-sdk/package.json bun.lock
git commit -m "chore(wallet-sdk): add @cashu/cashu-ts + type-fest deps for the wallet runtime"
```

---

## Task 1: Encryption — extract pure module + KeyService adapter

**Files:**
- Create: `packages/wallet-sdk/src/internal/crypto/encryption.ts`, `packages/wallet-sdk/src/internal/crypto/create-encryption.ts`
- Modify: `apps/web-wallet/app/features/shared/encryption.ts` (re-export the pure surface), `packages/wallet-sdk/src/index.ts`

- [ ] **Step 1: Create `src/internal/crypto/encryption.ts`** by copying the **pure** part of `apps/web-wallet/app/features/shared/encryption.ts` (lines 47–241): `preprocessData`, `serializeData`, `deserializeData`, `encryptToPublicKey`, `encryptBatchToPublicKey`, `decryptWithPrivateKey`, `decryptBatchWithPrivateKey`, the `Encryption` type, and `getEncryption`. Keep imports: `Money` (`@agicash/money`), `hexToBytes` (`@noble/hashes/utils`), `decode`/`encode` (`@stablelib/base64`), `eciesDecrypt`/`eciesDecryptBatch`/`eciesEncrypt`/`eciesEncryptBatch` (`@agicash/ecies`). **Drop** the React/TanStack imports (`@tanstack/react-query`, `react`) and everything they feed (`encryptionPrivateKeyQueryOptions`, `useEncryptionPrivateKey`, `encryptionPublicKeyQueryOptions`, `useEncryptionPublicKeyHex`, `useEncryption`, the `encryptionKeyDerivationPath` const, and the `@agicash/opensecret` import).

- [ ] **Step 2: Create `src/internal/crypto/create-encryption.ts`:**

```ts
import type { KeyService } from '../keys';
import { type Encryption, getEncryption } from './encryption';

/**
 * Builds an Encryption backed by the in-memory KeyService keys. Each method
 * awaits the (cached) encryption keypair before delegating to the pure ECIES
 * functions, so the first use derives and subsequent uses pay only the cache hit.
 */
export function createEncryption(keys: KeyService): Encryption {
  const resolve = async () =>
    getEncryption(
      await keys.getEncryptionPrivateKey(),
      await keys.getEncryptionPublicKey(),
    );
  return {
    encrypt: async <T>(data: T) => (await resolve()).encrypt(data),
    decrypt: async <T>(data: string) => (await resolve()).decrypt<T>(data),
    encryptBatch: async <T extends readonly unknown[]>(data: T) =>
      (await resolve()).encryptBatch(data),
    decryptBatch: async <T extends readonly unknown[]>(
      data: readonly [...{ [K in keyof T]: string }],
    ) => (await resolve()).decryptBatch<T>(data),
  };
}
```

- [ ] **Step 3: Repoint the app's `features/shared/encryption.ts`** — replace the pure definitions (lines 47–241) with a re-export from the SDK, keeping the React hooks + queryOptions intact:

```ts
// at the top, replace the pure-fn block with:
export {
  type Encryption,
  getEncryption,
  encryptToPublicKey,
  encryptBatchToPublicKey,
  decryptWithPrivateKey,
  decryptBatchWithPrivateKey,
} from '@agicash/wallet-sdk/internal/crypto/encryption';
```

Keep `encryptionPrivateKeyQueryOptions`, `useEncryptionPrivateKey`, `encryptionPublicKeyQueryOptions`, `useEncryptionPublicKeyHex`, and `useEncryption` (the latter still calls the now-imported `getEncryption`). Remove the now-duplicated pure imports the hooks don't use.

- [ ] **Step 4: Barrel.** In `src/index.ts` add: `export { type Encryption, getEncryption } from './internal/crypto/encryption';` (only the public surface; `createEncryption` stays internal).

- [ ] **Step 5: Gate.** Run (repo root): `bun run typecheck && bun run test`. Expected: PASS — the app's `useEncryption`/`encryptToPublicKey` importers (`encryptToPublicKey` is used by `spark-receive-quote-repository.server.ts`) still resolve via the re-export; `Money` round-trips through `deserializeData` unchanged.

- [ ] **Step 6: Commit.**

```bash
git add packages/wallet-sdk/src/internal/crypto packages/wallet-sdk/src/index.ts apps/web-wallet/app/features/shared/encryption.ts
git commit -m "feat(wallet-sdk): extract pure ECIES encryption + KeyService-backed Encryption"
```

---

## Task 2: Account types (git mv + shims)

**Files:**
- Move: `apps/web-wallet/app/features/accounts/account.ts` → `packages/wallet-sdk/src/domains/account-types.ts`
- Move: `apps/web-wallet/app/features/accounts/cashu-account.ts` → `packages/wallet-sdk/src/domains/cashu-proof.ts`
- Move: `apps/web-wallet/app/features/accounts/account-cryptography.ts` → `packages/wallet-sdk/src/internal/key-derivation.ts`
- Modify: the three app files become re-export shims; `src/index.ts`

- [ ] **Step 1: Move `cashu-account.ts`.** `git mv apps/web-wallet/app/features/accounts/cashu-account.ts packages/wallet-sdk/src/domains/cashu-proof.ts`. Its imports (`Proof` from `@cashu/cashu-ts`, `z` from `zod/mini`, `ProofSchema` from `@agicash/cashu`) are all SDK-available — no changes needed.

- [ ] **Step 2: Move `account-cryptography.ts`.** `git mv apps/web-wallet/app/features/accounts/account-cryptography.ts packages/wallet-sdk/src/internal/key-derivation.ts`. It has no relative imports — no changes.

- [ ] **Step 3: Move `account.ts`.** `git mv apps/web-wallet/app/features/accounts/account.ts packages/wallet-sdk/src/domains/account-types.ts`. Fix its three relative/alias imports:
  - `import type { ExtendedCashuWallet } from '~/lib/cashu';` → `import type { ExtendedCashuWallet } from '../internal/cashu/wallet';`
  - `import type { SparkNetwork } from '../agicash-db/json-models/spark-account-details-db-data';` → `import type { SparkNetwork } from '../internal/db/json-models/spark-account-details-db-data';`
  - `import type { CashuProof } from './cashu-account';` → `import type { CashuProof } from './cashu-proof';`

  (The `internal/cashu/wallet` target is created in Task 3. tsc will flag the dangling import until then; that is expected mid-task and resolved at the Task 3 gate. To keep this task's gate green, do Task 3 before re-running the gate, or temporarily land Task 3's `wallet.ts` first. Recommended: execute Task 3 immediately after Task 2's moves, sharing one gate — see Step 6.)

- [ ] **Step 4: App shims.** Replace each moved app file's body:
  - `apps/web-wallet/app/features/accounts/account.ts`: `export * from '@agicash/wallet-sdk/domains/account-types';`
  - `apps/web-wallet/app/features/accounts/cashu-account.ts`: `export * from '@agicash/wallet-sdk/domains/cashu-proof';`
  - `apps/web-wallet/app/features/accounts/account-cryptography.ts`: `export * from '@agicash/wallet-sdk/internal/key-derivation';`

- [ ] **Step 5: Barrel.** In `src/index.ts` add: `export type { Account, CashuAccount, SparkAccount, ExtendedAccount, ExtendedCashuAccount, ExtendedSparkAccount, RedactedAccount, RedactedCashuAccount, AccountType, AccountPurpose, AccountState } from './domains/account-types';` and `export { canSendToLightning, canReceiveFromLightning, getAccountBalance, accountRequiresGiftCardTermsAcceptance, getAccountHomePath } from './domains/account-types';` and `export type { CashuProof } from './domains/cashu-proof';`.

- [ ] **Step 6: Gate (combined with Task 3).** Because `account-types.ts` now imports `../internal/cashu/wallet`, run the gate only after Task 3 lands `wallet.ts`. Verify no app importer breaks: `grep -rn "features/accounts/account'" apps/web-wallet/app | head` and confirm they resolve through the shim. Run (repo root): `bun run typecheck && bun run test`.

- [ ] **Step 7: Commit** (after Task 3 if combining, otherwise stage these moves and commit with Task 3):

```bash
git add packages/wallet-sdk/src/domains/account-types.ts packages/wallet-sdk/src/domains/cashu-proof.ts packages/wallet-sdk/src/internal/key-derivation.ts apps/web-wallet/app/features/accounts/account.ts apps/web-wallet/app/features/accounts/cashu-account.ts apps/web-wallet/app/features/accounts/account-cryptography.ts packages/wallet-sdk/src/index.ts
git commit -m "refactor(wallet-sdk): move Account types + CashuProof + key-derivation into the SDK"
```

---

## Task 3: Cashu wallet primitives (git mv) + token utils

**Files:**
- Move: `apps/web-wallet/app/lib/cashu/utils.ts` → `packages/wallet-sdk/src/internal/cashu/wallet.ts`
- Move: `apps/web-wallet/app/lib/cashu/mint-validation.ts` → `packages/wallet-sdk/src/internal/cashu/mint-validation.ts`
- Create: `packages/wallet-sdk/src/internal/cashu/token.ts`
- Modify: `apps/web-wallet/app/lib/cashu/index.ts`, `apps/web-wallet/app/features/shared/cashu.ts` (re-export token utils), `src/index.ts`

- [ ] **Step 1: Move `utils.ts`.** `git mv apps/web-wallet/app/lib/cashu/utils.ts packages/wallet-sdk/src/internal/cashu/wallet.ts`. All its imports (`@cashu/cashu-ts`, `type-fest`, `@agicash/cashu`, `@agicash/money`) are SDK-available — no changes.

- [ ] **Step 2: Move `mint-validation.ts`.** `git mv apps/web-wallet/app/lib/cashu/mint-validation.ts packages/wallet-sdk/src/internal/cashu/mint-validation.ts`. Imports (`@cashu/cashu-ts`, `zod/mini`, `@agicash/cashu`) are SDK-available — no changes.

- [ ] **Step 3: Create `src/internal/cashu/token.ts`** by extracting the pure token helpers from `apps/web-wallet/app/features/shared/cashu.ts` (lines 53–75, 159–164): `getCurrencyAndUnitFromToken`, `tokenToMoney`, `getTokenHash`. Imports: `Currency`/`CurrencyUnit`/`Money` (`@agicash/money`), `encodeToken`/`sumProofs` + `type Token` (`@agicash/cashu` / `@cashu/cashu-ts`), `computeSHA256` (`@agicash/ecies`). Match the app source exactly.

- [ ] **Step 4: Repoint the app's `lib/cashu/index.ts`:**

```ts
export {
  ExtendedCashuWallet,
  getCashuWallet,
} from '@agicash/wallet-sdk/internal/cashu/wallet';
export * from './melt-quote-subscription';
export * from './melt-quote-subscription-manager';
export * from './mint-quote-subscription-manager';
export {
  buildMintValidator,
  MintBlocklistSchema,
} from '@agicash/wallet-sdk/internal/cashu/mint-validation';
```

  Then grep for any direct (non-index) importers of the moved files: `grep -rn "lib/cashu/utils\|lib/cashu/mint-validation" apps/web-wallet/app` — repoint any to `~/lib/cashu` or the SDK path.

- [ ] **Step 5: Repoint `features/shared/cashu.ts` token utils.** In `apps/web-wallet/app/features/shared/cashu.ts`, remove the local `getCurrencyAndUnitFromToken`/`tokenToMoney`/`getTokenHash` definitions and re-export them: `export { tokenToMoney, getTokenHash } from '@agicash/wallet-sdk/internal/cashu/token';`. (The `cashuMintValidator` instance, `decodeCashuToken`, and the mint query options stay in the app for now — they read `import.meta.env` and feed UI/scan.)

- [ ] **Step 6: Barrel.** In `src/index.ts` add: `export { ExtendedCashuWallet, getCashuWallet } from './internal/cashu/wallet';` and `export { tokenToMoney, getTokenHash } from './internal/cashu/token';`.

- [ ] **Step 7: Gate.** Run (repo root): `bun run typecheck && bun run test`. Expected: PASS — `account-types.ts`'s `../internal/cashu/wallet` import now resolves; the ~39 app importers of `~/lib/cashu` (`ExtendedCashuWallet`/`getCashuWallet`) resolve via the repointed index; `account.wallet` keeps a single `ExtendedCashuWallet` identity.

- [ ] **Step 8: Commit** (combine with Task 2's staged moves if executed together):

```bash
git add packages/wallet-sdk/src/internal/cashu/wallet.ts packages/wallet-sdk/src/internal/cashu/mint-validation.ts packages/wallet-sdk/src/internal/cashu/token.ts apps/web-wallet/app/lib/cashu/index.ts apps/web-wallet/app/features/shared/cashu.ts packages/wallet-sdk/src/index.ts
git commit -m "refactor(wallet-sdk): move ExtendedCashuWallet + mint-validation + token utils into the SDK"
```

---

## Task 4: Cashu cryptography adapter

**Files:**
- Create: `packages/wallet-sdk/src/internal/cashu/cryptography.ts`
- Modify: `packages/wallet-sdk/src/internal/keys.ts` (export `CASHU_SEED_PATH`)

- [ ] **Step 1: Export the cashu seed path** from `src/internal/keys.ts` — change `const CASHU_SEED_PATH = "m/83696968'/39'/0'/12'/0'";` to `export const CASHU_SEED_PATH = "m/83696968'/39'/0'/12'/0'";` (so the adapter reuses the single source of truth instead of duplicating the path).

- [ ] **Step 2: Create `src/internal/cashu/cryptography.ts`:**

```ts
import { HDKey } from '@scure/bip32';
import type { KeyService } from '../keys';
import { CASHU_SEED_PATH } from '../keys';
import type { OpenSecret } from '../opensecret';

// 129372 is UTF-8 for the peanut emoji (NUT-13). DO NOT CHANGE without migrating
// every user's stored cashu_locking_xpub — it would derive different keys.
export const BASE_CASHU_LOCKING_DERIVATION_PATH = "m/129372'/0'/0'";

export type CashuCryptography = {
  getSeed: () => Promise<Uint8Array>;
  getXpub: (derivationPath?: string) => Promise<string>;
  getPrivateKey: (derivationPath?: string) => Promise<string>;
};

/**
 * Mirrors the app's getCashuCryptography over the SDK's in-memory KeyService and
 * the Open Secret port: getSeed/getXpub are seed-derived (cached by KeyService);
 * getPrivateKey derives a private key (hex) at a path relative to the cashu seed.
 */
export function createCashuCryptography(
  keys: KeyService,
  os: Pick<OpenSecret, 'getPrivateKeyBytes'>,
): CashuCryptography {
  return {
    getSeed: () => keys.getCashuSeed(),
    getXpub: async (derivationPath) => {
      const hd = HDKey.fromMasterSeed(await keys.getCashuSeed());
      return derivationPath
        ? hd.derive(derivationPath).publicExtendedKey
        : hd.publicExtendedKey;
    },
    getPrivateKey: async (derivationPath) => {
      const { private_key } = await os.getPrivateKeyBytes({
        seed_phrase_derivation_path: CASHU_SEED_PATH,
        private_key_derivation_path: derivationPath,
      });
      return private_key;
    },
  };
}
```

  This matches the app exactly: `privateKeyQueryOptions` used the cashu seed path + the optional `private_key_derivation_path`; `xpubQueryOptions` derived the xpub from the cashu seed. `getXpub(BASE_CASHU_LOCKING_DERIVATION_PATH)` returns the same value as `KeyService.getCashuLockingXpub()`.

- [ ] **Step 3: Gate.** Run (repo root): `bun run typecheck && bun run test`. Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add packages/wallet-sdk/src/internal/cashu/cryptography.ts packages/wallet-sdk/src/internal/keys.ts
git commit -m "feat(wallet-sdk): CashuCryptography adapter over KeyService + OS port"
```

---

## Task 5: Mint-data cache + cashu wallet init + mint auth provider

**Files:**
- Create: `packages/wallet-sdk/src/internal/cashu/mint-cache.ts`, `packages/wallet-sdk/src/internal/cashu/mint-auth-provider.ts`, `packages/wallet-sdk/src/internal/cashu/init-wallet.ts`

- [ ] **Step 1: Create `src/internal/cashu/mint-cache.ts`:**

```ts
import {
  type GetKeysResponse,
  type GetKeysetsResponse,
  Mint,
} from '@cashu/cashu-ts';
import { ExtendedMintInfo } from '@agicash/cashu';

const ONE_HOUR_MS = 1000 * 60 * 60;

type Entry<T> = { value: Promise<T>; expiresAt: number };

/**
 * In-memory TTL cache (1h) of mint info / keysets / keys, replacing the app's
 * mintInfoQueryOptions / allMintKeysetsQueryOptions / mintKeysQueryOptions.
 * Concurrent callers share one in-flight request; a rejected fetch is evicted so
 * the next call retries.
 */
export class MintDataCache {
  private readonly info = new Map<string, Entry<ExtendedMintInfo>>();
  private readonly keysets = new Map<string, Entry<GetKeysetsResponse>>();
  private readonly keys = new Map<string, Entry<GetKeysResponse>>();

  getMintInfo(mintUrl: string): Promise<ExtendedMintInfo> {
    return this.cached(
      this.info,
      mintUrl,
      async () => new ExtendedMintInfo(await new Mint(mintUrl).getInfo()),
    );
  }

  getAllKeysets(mintUrl: string): Promise<GetKeysetsResponse> {
    return this.cached(this.keysets, mintUrl, () =>
      new Mint(mintUrl).getKeySets(),
    );
  }

  getKeys(mintUrl: string): Promise<GetKeysResponse> {
    return this.cached(this.keys, mintUrl, () => new Mint(mintUrl).getKeys());
  }

  private cached<T>(
    store: Map<string, Entry<T>>,
    key: string,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    const now = Date.now();
    const hit = store.get(key);
    if (hit && hit.expiresAt > now) return hit.value;
    const value = fetcher().catch((error) => {
      store.delete(key);
      throw error;
    });
    store.set(key, { value, expiresAt: now + ONE_HOUR_MS });
    return value;
  }

  clear(): void {
    this.info.clear();
    this.keysets.clear();
    this.keys.clear();
  }
}
```

> Verify `Mint`, `GetKeysResponse`, `GetKeysetsResponse`, and `ExtendedMintInfo`'s constructor against `node_modules/@cashu/cashu-ts` and `@agicash/cashu` before relying on them (the app uses `new ExtendedMintInfo(await new Mint(mintUrl).getInfo())` and `new ExtendedMintInfo(<info>.cache)` in different spots — confirm the constructor accepts a `MintInfo`).

- [ ] **Step 2: Create `src/internal/cashu/mint-auth-provider.ts`:**

```ts
import type { AuthProvider } from '@cashu/cashu-ts';
import { jwtDecode } from 'jwt-decode';
import type { AccountPurpose } from '../../domains/account-types';
import type { OpenSecret } from '../opensecret';

/**
 * Caches the agicash-mint CAT (Open Secret third-party token, audience
 * 'agicash-mint') until 5s before its JWT expiry, mirroring SessionTokenProvider.
 * Gift-card / offer mints require NUT-21 Clear Auth; transactional mints do not.
 */
export class AgicashMintAuthProvider {
  private cached: { token: string; expiresAtMs: number } | null = null;

  constructor(
    private readonly os: Pick<OpenSecret, 'generateThirdPartyToken'>,
    private readonly isLoggedIn: () => Promise<boolean>,
  ) {}

  private ensureCAT = async (): Promise<string | undefined> => {
    if (this.cached && this.cached.expiresAtMs > Date.now()) {
      return this.cached.token;
    }
    if (!(await this.isLoggedIn())) return undefined;
    const { token } = await this.os.generateThirdPartyToken('agicash-mint');
    const { exp } = jwtDecode<{ exp?: number }>(token);
    this.cached = { token, expiresAtMs: ((exp ?? 0) - 5) * 1000 };
    return token;
  };

  toAuthProvider(): AuthProvider {
    return {
      getCAT: () => {
        throw new Error('Not implemented: use ensureCAT');
      },
      setCAT: () => {
        throw new Error('Not implemented: use ensureCAT');
      },
      ensureCAT: this.ensureCAT,
      getBlindAuthToken: async () => {
        throw new Error('Blind auth is not supported');
      },
    };
  }

  clear(): void {
    this.cached = null;
  }
}

/** Returns the agicash mint AuthProvider for gift-card/offer accounts, else undefined. */
export function getMintAuthProvider(
  purpose: AccountPurpose | undefined,
  agicashAuth: AgicashMintAuthProvider,
): AuthProvider | undefined {
  return purpose === 'gift-card' || purpose === 'offer'
    ? agicashAuth.toAuthProvider()
    : undefined;
}
```

> Verify `generateThirdPartyToken` accepts the `'agicash-mint'` audience argument in `node_modules/@agicash/opensecret/dist/index.d.ts` (Plan 2's `SessionTokenProvider` calls it with no argument for the default Supabase audience).

- [ ] **Step 3: Create `src/internal/cashu/init-wallet.ts`** — copy `getInitializedCashuWallet` from `apps/web-wallet/app/features/shared/cashu.ts` (lines 265–355), de-TanStacked over `MintDataCache`:

```ts
import {
  type AuthProvider,
  type GetKeysResponse,
  type GetKeysetsResponse,
  KeyChain,
  NetworkError,
} from '@cashu/cashu-ts';
import { type Currency, getCashuProtocolUnit, getCashuUnit } from '@agicash/cashu';
import type { ExtendedMintInfo } from '@agicash/cashu';
import { type ExtendedCashuWallet, getCashuWallet } from './wallet';
import type { MintDataCache } from './mint-cache';

const MINT_TIMEOUT_MS = 10_000;

/**
 * Initializes a Cashu wallet with offline handling. If the mint is offline or
 * times out (10s), returns a minimal offline wallet (isOnline:false); otherwise
 * loads mint info + active keyset keys into the wallet cache.
 */
export async function getInitializedCashuWallet({
  mintCache,
  mintUrl,
  currency,
  bip39seed,
  authProvider,
}: {
  mintCache: MintDataCache;
  mintUrl: string;
  currency: Currency;
  bip39seed?: Uint8Array;
  authProvider?: AuthProvider;
}): Promise<{ wallet: ExtendedCashuWallet; isOnline: boolean }> {
  let mintInfo: ExtendedMintInfo;
  let allMintKeysets: GetKeysetsResponse;
  let mintActiveKeys: GetKeysResponse;

  try {
    [mintInfo, allMintKeysets, mintActiveKeys] = await Promise.race([
      Promise.all([
        mintCache.getMintInfo(mintUrl),
        mintCache.getAllKeysets(mintUrl),
        mintCache.getKeys(mintUrl),
      ]),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new NetworkError('Mint request timed out')),
          MINT_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (error) {
    if (error instanceof NetworkError) {
      const wallet = getCashuWallet(mintUrl, {
        unit: getCashuUnit(currency),
        bip39seed: bip39seed ?? undefined,
        authProvider,
      });
      return { wallet, isOnline: false };
    }
    throw error;
  }

  const unitKeysets = allMintKeysets.keysets.filter(
    (ks) => ks.unit === getCashuProtocolUnit(currency),
  );
  const activeKeyset = unitKeysets.find((ks) => ks.active);
  if (!activeKeyset) {
    throw new Error(`No active keyset found for ${currency} on ${mintUrl}`);
  }

  const activeKeysForUnit = mintActiveKeys.keysets.find(
    (ks) => ks.id === activeKeyset.id,
  );
  if (!activeKeysForUnit) {
    throw new Error(
      `Got active keyset ${activeKeyset.id} from ${mintUrl} but could not find keys for it`,
    );
  }

  const wallet = getCashuWallet(mintUrl, {
    unit: getCashuUnit(currency),
    bip39seed: bip39seed ?? undefined,
    authProvider,
  });
  const keyChainCache = KeyChain.mintToCacheDTO(
    wallet.unit,
    mintUrl,
    unitKeysets,
    [activeKeysForUnit],
  );
  wallet.loadMintFromCache(mintInfo.cache, keyChainCache);
  return { wallet, isOnline: true };
}
```

> Behavior note vs the app: the `measureOperation` perf wrapper is dropped, and the timeout no longer calls `queryClient.cancelQueries` — the in-flight mint fetches are simply abandoned by the race and their results still populate the cache for the next call (equivalent or better; document in the commit body).

- [ ] **Step 4: Gate.** Run (repo root): `bun run typecheck && bun run test`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/wallet-sdk/src/internal/cashu/mint-cache.ts packages/wallet-sdk/src/internal/cashu/mint-auth-provider.ts packages/wallet-sdk/src/internal/cashu/init-wallet.ts
git commit -m "feat(wallet-sdk): TanStack-free mint-data cache + cashu wallet init + mint auth provider"
```

---

## Task 6: Spark wallet runtime (SparkWalletManager) + headless connect smoke

**Files:**
- Create: `packages/wallet-sdk/src/internal/spark/errors.ts`, `packages/wallet-sdk/src/internal/spark/stub.ts`, `packages/wallet-sdk/src/internal/spark/wallet-manager.ts`
- Modify: `packages/wallet-sdk/src/config.ts` (`sparkStorageDir?`)
- (Optional, non-gated) Create: a headless connect smoke script under `packages/wallet-sdk/examples/` or `scripts/`

- [ ] **Step 1: Copy `src/internal/spark/errors.ts`** verbatim from `apps/web-wallet/app/lib/spark/errors.ts` (`isInsufficentBalanceError`, `isInvoiceAlreadyPaidError` — both pure, ~18 lines). The app keeps its copy (used by its still-TanStack spark send code until the variant migration).

- [ ] **Step 2: Copy `src/internal/spark/stub.ts`** verbatim from `apps/web-wallet/app/lib/spark/utils.ts` — only the `createSparkWalletStub` function (the `BreezSdk` Proxy that throws on any method call). Import `type { BreezSdk } from '@agicash/breez-sdk-spark'`. Do **not** copy `getSparkIdentityPublicKeyFromMnemonic` (already in `KeyService`).

- [ ] **Step 3: Add `sparkStorageDir`** to `SdkConfig` in `src/config.ts`:

```ts
  /** Writable directory for the Breez SDK's local state. Web/browser ignores it
   * (in-memory/IndexedDB); headless node needs a real path. Default './.spark-data'. */
  sparkStorageDir?: string;
```

- [ ] **Step 4: Create `src/internal/spark/wallet-manager.ts`:**

```ts
import {
  type BreezSdk,
  connect,
  defaultConfig,
  initLogging,
} from '@agicash/breez-sdk-spark';
import { Money } from '@agicash/money';
import type { SparkNetwork } from '../db/json-models/spark-account-details-db-data';
import type { KeyService } from '../keys';
import { createSparkWalletStub } from './stub';

// Breez's initLogging delegates to Rust's tracing crate, which enforces a single
// global subscriber per process — calling it twice always errors. Track status so
// we only attempt init once, regardless of outcome.
let loggingStatus: 'initializing' | 'initialized' | 'failed' | undefined;
function tryInitLogging() {
  if (loggingStatus !== undefined) return;
  loggingStatus = 'initializing';
  initLogging({ log() {} })
    .then(() => {
      loggingStatus = 'initialized';
    })
    .catch((error) => {
      loggingStatus = 'failed';
      console.warn('Failed to initialize Breez SDK logging', error);
    });
}

/**
 * Owns the connected Breez SDK wallet per network — one connect() each, cached as
 * a Promise — replacing the app's sparkWalletQueryOptions singleton. getWallet()
 * mirrors getInitializedSparkWallet (balance via getInfo, offline stub on failure).
 * dispose() disconnects the wallets and clears the cache.
 */
export class SparkWalletManager {
  private readonly wallets = new Map<SparkNetwork, Promise<BreezSdk>>();

  constructor(
    private readonly keys: KeyService,
    private readonly apiKey: string,
    private readonly storageDir: string,
  ) {}

  private connect(network: SparkNetwork): Promise<BreezSdk> {
    let cached = this.wallets.get(network);
    if (!cached) {
      cached = this.keys.getSparkMnemonic().then((mnemonic) => {
        tryInitLogging();
        const breezNetwork = network.toLowerCase() as 'mainnet' | 'regtest';
        return connect({
          config: {
            ...defaultConfig(breezNetwork),
            apiKey: this.apiKey,
            lnurlDomain: undefined,
            privateEnabledDefault: true,
            optimizationConfig: { autoEnabled: true, multiplicity: 2 },
          },
          seed: { type: 'mnemonic', mnemonic },
          storageDir: this.storageDir,
        });
      });
      this.wallets.set(network, cached);
    }
    return cached;
  }

  async getWallet(network: SparkNetwork): Promise<{
    wallet: BreezSdk;
    balance: Money | null;
    isOnline: boolean;
  }> {
    try {
      const wallet = await this.connect(network);
      const info = await wallet.getInfo({});
      const balance = new Money({
        amount: info.balanceSats,
        currency: 'BTC',
        unit: 'sat',
      }) as Money;
      return { wallet, balance, isOnline: true };
    } catch (error) {
      console.error('Failed to initialize spark wallet', { cause: error });
      // Drop the rejected promise so a later call retries the connect.
      this.wallets.delete(network);
      return {
        wallet: createSparkWalletStub(
          'Spark is offline, please try again later.',
        ),
        balance: null,
        isOnline: false,
      };
    }
  }

  async dispose(): Promise<void> {
    const wallets = [...this.wallets.values()];
    this.wallets.clear();
    await Promise.allSettled(
      wallets.map(async (p) => {
        const wallet = await p;
        await wallet.disconnect();
      }),
    );
  }
}
```

> Verify `BreezSdk.disconnect()` exists in `node_modules/@agicash/breez-sdk-spark` types (the app never disconnected — it cached forever via `gcTime: Infinity`). If the method is named differently or absent, adjust `dispose()` accordingly (it is best-effort teardown). `defaultConfig`, `connect`, `initLogging` signatures match the app's `shared/spark.ts` usage — confirm before relying.

- [ ] **Step 5: Headless connect smoke (documented, NOT gated).** Write a tiny script (e.g. `packages/wallet-sdk/examples/spark-connect-smoke.ts`) that builds a `KeyService` with a fake OS port returning a fixed BIP39 mnemonic, constructs `new SparkWalletManager(keys, breezApiKey, './.spark-data-smoke')`, calls `getWallet('REGTEST')`, and logs `{ isOnline, balance }`. Document how to run it (`VITE_BREEZ_API_KEY=… bun packages/wallet-sdk/examples/spark-connect-smoke.ts`). This closes Plan 2's "full `connect()` validated in Plan 3" item. It is a manual smoke, not part of the CI gate (per the minimal-testing scope).

- [ ] **Step 6: Gate.** Run (repo root): `bun run typecheck && bun run test`. Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add packages/wallet-sdk/src/internal/spark packages/wallet-sdk/src/config.ts packages/wallet-sdk/examples
git commit -m "feat(wallet-sdk): SparkWalletManager (Breez connect per network, disposable) + headless smoke"
```

---

## Task 7: AccountRepository + DefaultAccountRepository (copy + de-TanStack)

**Files:**
- Create: `packages/wallet-sdk/src/internal/db/account-repository.ts`
- Create: `packages/wallet-sdk/src/internal/db/default-account-repository.ts`

- [ ] **Step 1: Create `src/internal/db/account-repository.ts`** by copying `apps/web-wallet/app/features/accounts/account-repository.ts` (the `AccountRepository` class + the `AccountOmit`/`AccountInput`/`Options` types), with these changes:
  - **Drop** the `useAccountRepository` hook (lines 290–304) and the `@tanstack/react-query` import.
  - **Constructor** — replace `(db, encryption, queryClient, getCashuWalletSeed, getSparkWalletMnemonic, sparkStorageDir)` with:

```ts
  constructor(
    private readonly db: AgicashDb,
    private readonly encryption: Encryption,
    private readonly keys: KeyService,
    private readonly mintCache: MintDataCache,
    private readonly mintAuth: AgicashMintAuthProvider,
    private readonly sparkWallets: SparkWalletManager,
  ) {}
```

  - **`private getInitializedCashuWallet(mintUrl, currency, purpose)`** — replace the body with:

```ts
    return getInitializedCashuWallet({
      mintCache: this.mintCache,
      mintUrl,
      currency,
      bip39seed: await this.keys.getCashuSeed(),
      authProvider: getMintAuthProvider(purpose, this.mintAuth),
    });
```

  - **`private getInitializedSparkWallet(network)`** — replace the body with: `return this.sparkWallets.getWallet(network);`
  - **Imports** (SDK paths): `AgicashDb`/`AgicashDbAccountWithProofs`/`isCashuAccount`/`isSparkAccount` from `./database`; `CashuAccountDetailsDbDataSchema`/`SparkAccountDetailsDbDataSchema`/`SparkNetwork` from `./json-models/...`; `Encryption` from `../crypto/encryption`; `DomainError` from `../../errors`; `Account`/`AccountPurpose`/`CashuAccount` from `../../domains/account-types`; `CashuProof` from `../../domains/cashu-proof`; `KeyService` from `../keys`; `MintDataCache` from `../cashu/mint-cache`; `{ AgicashMintAuthProvider, getMintAuthProvider }` from `../cashu/mint-auth-provider`; `getInitializedCashuWallet` from `../cashu/init-wallet`; `SparkWalletManager` from `../spark/wallet-manager`; `normalizeMintUrl`/`ProofSchema` from `@agicash/cashu`; `Currency` from `@agicash/money`; `DistributedOmit` from `type-fest`; `z` from `zod/mini`.
  - Keep `get`, `getAllActive`, `create`, `toAccount`, `decryptCashuProofs` byte-for-byte (only the two private wallet-init helpers and the constructor change).

- [ ] **Step 2: Create `src/internal/db/default-account-repository.ts`** by copying the app's `ReadUserDefaultAccountRepository` (`apps/web-wallet/app/features/user/user-repository.ts` lines 206–314), de-TanStacked and **kept server-safe**. It returns `RedactedAccount` (no `proofs`), **never decrypts** (no `Encryption` dependency), and initializes the cashu wallet **without a bip39 seed** — exactly why this read works in service-role/server mode (Plan 5) where the user's encryption key is unavailable. This is a distinct concern from `AccountRepository` (full client read), so it is a separate class, not a method on `AccountRepository`.

```ts
import { type Currency } from '@agicash/money';
import {
  type AgicashDb,
  type AgicashDbAccount,
  isCashuAccount,
  isSparkAccount,
} from './database';
import type { RedactedAccount } from '../../domains/account-types';
import type { MintDataCache } from '../cashu/mint-cache';
import {
  type AgicashMintAuthProvider,
  getMintAuthProvider,
} from '../cashu/mint-auth-provider';
import { getInitializedCashuWallet } from '../cashu/init-wallet';
import type { SparkWalletManager } from '../spark/wallet-manager';

type Options = { abortSignal?: AbortSignal };

/**
 * Reads the user's default account WITHOUT decrypting proofs (returns
 * RedactedAccount). Server-safe: no Encryption dependency and the cashu wallet is
 * initialized without a seed, so it runs in service-role mode where the user's
 * keys are unavailable (used by LN-address routes in Plan 5). Mirrors the app's
 * ReadUserDefaultAccountRepository.
 */
export class DefaultAccountRepository {
  constructor(
    private readonly db: AgicashDb,
    private readonly mintCache: MintDataCache,
    private readonly mintAuth: AgicashMintAuthProvider,
    private readonly sparkWallets: SparkWalletManager,
  ) {}

  async getDefault(
    userId: string,
    currency?: Currency,
    options?: Options,
  ): Promise<RedactedAccount> {
    const query = this.db
      .from('users')
      .select('*, accounts:accounts!user_id(*, cashu_proofs(*))')
      .eq('id', userId)
      .eq('accounts.cashu_proofs.state', 'UNSPENT');
    if (options?.abortSignal) query.abortSignal(options.abortSignal);

    const { data, error } = await query.single();
    if (error) {
      throw new Error('Failed to get default account', { cause: error });
    }

    const accountCurrency = currency ?? data.default_currency;
    const defaultAccountId =
      accountCurrency === 'BTC'
        ? data.default_btc_account_id
        : data.default_usd_account_id;
    const account = data.accounts.find((a) => a.id === defaultAccountId);
    if (!account) throw new Error('No default account found for user');
    return this.toAccount(account);
  }

  private async toAccount(data: AgicashDbAccount): Promise<RedactedAccount> {
    const commonData = {
      id: data.id,
      name: data.name,
      currency: data.currency,
      purpose: data.purpose,
      state: data.state,
      createdAt: data.created_at,
      version: data.version,
      expiresAt: data.expires_at,
    };

    if (isCashuAccount(data)) {
      const details = data.details;
      const { wallet, isOnline } = await getInitializedCashuWallet({
        mintCache: this.mintCache,
        mintUrl: details.mint_url,
        currency: data.currency,
        // No bip39seed: server has no user keys, and the default-account lookup
        // only needs mint info, not proof derivation.
        authProvider: getMintAuthProvider(data.purpose, this.mintAuth),
      });
      return {
        ...commonData,
        isOnline,
        type: 'cashu',
        mintUrl: details.mint_url,
        isTestMint: details.is_test_mint,
        keysetCounters: details.keyset_counters,
        wallet,
      };
    }

    if (isSparkAccount(data)) {
      const { network } = data.details;
      const { wallet, balance, isOnline } =
        await this.sparkWallets.getWallet(network);
      return { ...commonData, type: 'spark', balance, network, isOnline, wallet };
    }

    throw new Error('Invalid account type');
  }
}
```

> Verify the `users → accounts!user_id(*, cashu_proofs(*))` embedded-select typing against the generated DB types and the app's source (lines 219–253). If the `single()` row's `accounts` element type isn't directly assignable to `AgicashDbAccount`, mirror the app's cast. Server-safe caveat: `getMintAuthProvider` returns `undefined` for transactional accounts (the only kind LN-address default lookups hit), so the no-OS-session server path never calls `generateThirdPartyToken`; gift-card/offer default lookups in server mode are out of scope (Plan 5 refines server construction).

- [ ] **Step 3: Gate.** Run (repo root): `bun run typecheck && bun run test`. Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add packages/wallet-sdk/src/internal/db/account-repository.ts packages/wallet-sdk/src/internal/db/default-account-repository.ts
git commit -m "feat(wallet-sdk): AccountRepository (full client read) + server-safe DefaultAccountRepository"
```

---

## Task 8: AccountService (copy + de-TanStack)

**Files:**
- Create: `packages/wallet-sdk/src/internal/services/account-service.ts`

- [ ] **Step 1: Create `src/internal/services/account-service.ts`** by copying `apps/web-wallet/app/features/accounts/account-service.ts`, with these changes:
  - **Drop** the `useAccountService` hook and the `@tanstack/react-query` import.
  - **Constructor** — replace `(accountRepository, queryClient)` with `(accountRepository: AccountRepository, mintCache: MintDataCache)`.
  - **`addCashuAccount`** offer branch — replace `const { keysets } = await this.queryClient.fetchQuery(allMintKeysetsQueryOptions(account.mintUrl));` with `const { keysets } = await this.mintCache.getAllKeysets(account.mintUrl);`.
  - **Imports** (SDK paths): `checkIsTestMint`/`findFirstActiveKeyset`/`getKeysetExpiry` from `@agicash/cashu`; `User` from `../../domains/user-types`; `Account`/`CashuAccount`/`ExtendedAccount` from `../../domains/account-types`; `AccountRepository` from `../db/account-repository`; `MintDataCache` from `../cashu/mint-cache`; `DistributedOmit` from `type-fest`.
  - Keep the static `isDefaultAccount`/`getExtendedAccounts` and `addCashuAccount` body otherwise unchanged.

- [ ] **Step 2: Gate.** Run (repo root): `bun run typecheck && bun run test`. Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add packages/wallet-sdk/src/internal/services/account-service.ts
git commit -m "feat(wallet-sdk): AccountService (de-TanStacked offer-keyset lookup via mint cache)"
```

---

## Task 9: WalletRuntime factory + Sdk wiring + UserDomain defaults

**Files:**
- Create: `packages/wallet-sdk/src/internal/wallet-runtime.ts`
- Modify: `packages/wallet-sdk/src/sdk.ts`, `packages/wallet-sdk/src/domains/user.ts`

- [ ] **Step 1: Create `src/internal/wallet-runtime.ts`:**

```ts
import type { AgicashDb } from './db/database';
import { AccountRepository } from './db/account-repository';
import { DefaultAccountRepository } from './db/default-account-repository';
import { AccountService } from './services/account-service';
import { MintDataCache } from './cashu/mint-cache';
import { AgicashMintAuthProvider } from './cashu/mint-auth-provider';
import { createCashuCryptography, type CashuCryptography } from './cashu/cryptography';
import { SparkWalletManager } from './spark/wallet-manager';
import { createEncryption } from './crypto/create-encryption';
import type { Encryption } from './crypto/encryption';
import type { KeyService } from './keys';
import type { OpenSecret } from './opensecret';

export type WalletRuntime = {
  encryption: Encryption;
  cashuCryptography: CashuCryptography;
  mintCache: MintDataCache;
  mintAuth: AgicashMintAuthProvider;
  sparkWallets: SparkWalletManager;
  accountRepository: AccountRepository;
  defaultAccountRepository: DefaultAccountRepository;
  accountService: AccountService;
  dispose(): Promise<void>;
};

type Deps = {
  db: AgicashDb;
  keys: KeyService;
  os: OpenSecret;
  isLoggedIn: () => Promise<boolean>;
  breezApiKey: string;
  sparkStorageDir: string;
};

/**
 * Constructs the SDK-internal wallet runtime (encryption, cashu/spark runtimes,
 * account repo/service). No public domain facade is wired here — the protocol
 * services (Plan 3b) and the variant facades read from this runtime. dispose()
 * disconnects spark wallets and clears the mint/auth caches.
 */
export function createWalletRuntime(deps: Deps): WalletRuntime {
  const encryption = createEncryption(deps.keys);
  const cashuCryptography = createCashuCryptography(deps.keys, deps.os);
  const mintCache = new MintDataCache();
  const mintAuth = new AgicashMintAuthProvider(deps.os, deps.isLoggedIn);
  const sparkWallets = new SparkWalletManager(
    deps.keys,
    deps.breezApiKey,
    deps.sparkStorageDir,
  );
  const accountRepository = new AccountRepository(
    deps.db,
    encryption,
    deps.keys,
    mintCache,
    mintAuth,
    sparkWallets,
  );
  const defaultAccountRepository = new DefaultAccountRepository(
    deps.db,
    mintCache,
    mintAuth,
    sparkWallets,
  );
  const accountService = new AccountService(accountRepository, mintCache);

  return {
    encryption,
    cashuCryptography,
    mintCache,
    mintAuth,
    sparkWallets,
    accountRepository,
    defaultAccountRepository,
    accountService,
    dispose: async () => {
      mintAuth.clear();
      mintCache.clear();
      await sparkWallets.dispose();
    },
  };
}
```

- [ ] **Step 2: Wire into `src/sdk.ts`.** Read the current `sdk.ts` first to match its construction style (it already builds `KeyService`, the OS port, the db client, the `isLoggedIn` predicate, and `SdkConfig`). Construct the runtime once the dependencies exist, store it on a private field, and tear it down in `dispose()`:
  - Add `private walletRuntime: WalletRuntime` (constructed in `create`/the private constructor using `createWalletRuntime({ db, keys, os, isLoggedIn, breezApiKey: config.breezApiKey ?? '', sparkStorageDir: config.sparkStorageDir ?? './.spark-data' })`).
  - In `dispose()`, call `await this.walletRuntime.dispose();` alongside the existing `keys.clear()` / session teardown.
  - Add an internal accessor (e.g. a `package-private` getter or an exported-for-tests symbol) so Plan 3b can reach the runtime; do **not** add public domain methods.

> If `config.breezApiKey` is required for any non-spark path, keep the `?? ''` fallback — `SparkWalletManager` only reads it inside `connect()`, which a headless cashu-only flow never triggers. Confirm `sdk.ts` constructs `KeyService` and the OS port before the runtime (reorder if needed).

- [ ] **Step 3: Close the Plan-2 UserDomain deferrals** in `src/domains/user.ts`. Add `Account`/`Currency` imports and two methods wired to the existing `writeUserRepo.update`:

```ts
  async setDefaultAccount(account: Account): Promise<User> {
    const id = await this.requireUserId();
    return this.deps.writeUserRepo.update(
      id,
      account.currency === 'BTC'
        ? { defaultBtcAccountId: account.id }
        : { defaultUsdAccountId: account.id },
    );
  }

  async setDefaultCurrency(currency: Currency): Promise<User> {
    const id = await this.requireUserId();
    return this.deps.writeUserRepo.update(id, { defaultCurrency: currency });
  }
```

  Update the class JSDoc (drop the "deferred to a later plan" note). `setDefaultCurrency` can reject with `UniqueConstraintError`/a DB-constraint error if no default account exists for that currency — preserved from `update`'s existing behavior; no extra handling added.

- [ ] **Step 4: Gate.** Run (repo root): `bun run typecheck && bun run test`. Expected: PASS — the runtime is constructed and disposed; `setDefaultAccount`/`setDefaultCurrency` typecheck against `WriteUserRepository.update`.

- [ ] **Step 5: Commit.**

```bash
git add packages/wallet-sdk/src/internal/wallet-runtime.ts packages/wallet-sdk/src/sdk.ts packages/wallet-sdk/src/domains/user.ts
git commit -m "feat(wallet-sdk): WalletRuntime factory wired into Sdk + UserDomain default account/currency"
```

---

## Self-Review

**Spec coverage (3a slice of the base spec):**
- Lib extraction "wallet-runtime cashu (subscription managers, ExtendedCashuWallet factory, blind-signature matching, mint validation) moves into the SDK" → `ExtendedCashuWallet`/`getCashuWallet` (Task 3), `mint-validation` (Task 3), `MintDataCache`+`getInitializedCashuWallet` (Task 5). Subscription managers + blind-signature matching are processor/3b-scope (services use `matchBlindSignaturesToOutputData` from `@agicash/cashu` directly — already a lib export). ✓
- "Account carries its balance as a field (computed at read/feed time)" → `getAccountBalance` moved (Task 2); the field-on-Account mapping is explicitly deferred to the feed/variant layer (decision 7 / out-of-scope). ✓ (flagged, not silently dropped)
- Auth & secrets seam — key derivation already in `KeyService` (Plan 2); this plan only consumes it. ✓
- Server-mode `.server.ts` variants → Plan 5 (out of scope). ✓

**Placeholder scan:** new components have full code; moves cite exact source line ranges + exact import repoints. No "TBD"/"handle errors"/"similar to" left. ✓

**Type consistency:** `Encryption` (Task 1) consumed by `AccountRepository` (Task 7) and `WalletRuntime` (Task 9); `MintDataCache`/`AgicashMintAuthProvider`/`SparkWalletManager` constructor shapes used identically in `AccountRepository` (Task 7) and `createWalletRuntime` (Task 9); `getMintAuthProvider(purpose, agicashAuth)` signature (Task 5) matches the call in `AccountRepository.getInitializedCashuWallet` (Task 7); `getInitializedCashuWallet({ mintCache, … })` param object (Task 5) matches its caller (Task 7); `CASHU_SEED_PATH` exported once (Task 4) and imported by the cryptography adapter. ✓

**Open risks to verify during execution (flagged in-task):** `ExtendedMintInfo` constructor accepting `MintInfo`; `generateThirdPartyToken('agicash-mint')` audience arg; `BreezSdk.disconnect()` existence; the `users→accounts` embedded-select typing for `getDefault`. Each has a "verify before relying" note at its task.

**Deferred follow-ups (tracked, not done):** characterization tests for the moved state machines; the balance-as-field domain mapping; deleting the app's duplicated TanStack wallet copies (variant web-migration); relocating `cashuMintValidator`/`decodeCashuToken` (scan domain, later).
