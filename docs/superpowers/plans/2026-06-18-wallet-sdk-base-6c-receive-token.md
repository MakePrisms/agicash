# Wallet SDK Base Plan 6c — Cashu token-claim orchestrators → `sdk.cashu.receive.receiveToken` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the 3 app token-claim orchestrators (`ReceiveCashuTokenService` + `ReceiveCashuTokenQuoteService` + `ClaimCashuTokenService`) into the SDK as a new `sdk.cashu.receive.receiveToken({ token, claimTo })` method on the existing `CashuReceiveOps`, dropping all TanStack/Sentry coupling and routing rates/user/account reads through the landed SDK surfaces.

**Architecture:** `receiveToken` is the faithful inline port of the app's headless `ClaimCashuTokenService.claimToken` (the `?claimTo=` deep-link auto-claim path). It selects source + destination accounts internally, opportunistically adds the destination account + sets it default, then forks: **same-account** = `cashuReceiveSwapService.create` + inline `completeSwap` (fatal only on terminal `FAILED` swap-state); **cross-account** = `createCrossAccountReceiveQuotes` + `meltProofsIdempotent({type:'random'})` + best-effort `tryCompleteReceive` (spark uses the **verbatim** Breez 10s listener race). Completion is inline best-effort; anything left incomplete is finalized by the background processors. Failures throw `DomainError`; success resolves `{ transactionId, destinationAccount: { id, purpose } }`.

**Tech Stack:** TypeScript (ESNext, moduleResolution Bundler), `bun:test`, `@agicash/wallet-sdk` (the package under edit), `@agicash/cashu`, `@agicash/money`, `@agicash/breez-sdk-spark`, `@cashu/cashu-ts`.

## Global Constraints

- **Branch:** `sdkx/base`. Work only in `packages/wallet-sdk/`. **Zero app-file changes** in 6c — the app keeps its own untouched copies (deleted later in the variant web-migration); 6c is purely additive to the SDK.
- **⛔ NEVER run `bun run fix:all`** (implementers AND reviewers). It is `biome check --write` = lint/format only; it does NOT typecheck and it reorders imports across the whole repo, polluting the working tree (it polluted 82–91 files in prior plans). If any agent runs it, discard the pollution with `git checkout -- .` (all task work is committed, so this is safe).
- **Gate (run after every task, both must pass):** `bun run typecheck` (8 packages, exit 0) **and** `bun run test` (currently 236 pass / 0 fail; must stay 0 fail).
- **Decisions locked (AskUserQuestion 2026-06-18):** (1) **Inline best-effort completion** — faithful port; do **NOT** add `getByTokenHash` or a swap-keyed `awaitTerminal` (the app never awaits a token claim; explicitly de-scoped). (2) **Return `{ transactionId, destinationAccount: Pick<Account,'id'|'purpose'> }`, throw `DomainError` on failure** (matches the *Ops convention; no `{success}` wrapper). (3) **Scope = `receiveToken({token, claimTo})` only** — the selection + cross-account-quote services are ported INTERNAL-only (receiveToken's deps), not publicly exposed; the interactive selector + create-only surface is deferred to the variant migration.
- **DROP everywhere in the port:** `queryClient.fetchQuery`/`setQueryData`, `AccountsCache`/`UserCache` upserts, `Sentry.*`. Keep `console.error`/`console.warn` as-is.
- **`meltProofsIdempotent({type:'random'})` + its 5-line comment are load-bearing — port verbatim, do not "optimize" to deterministic outputs.**
- **`waitForSparkReceiveToComplete` is a sensitive Breez race (register the event listener BEFORE the initial check) — port byte-for-byte, do NOT improve.**
- Domain classes are NOT barrel-exported (accessed via `sdk.cashu.receive.*`); only param/return TYPES are exported from `index.ts`.

---

## File Structure

**Created (all under `packages/wallet-sdk/src/`):**
- `internal/services/receive-cashu-token-models.ts` — `TokenFlags`, `CashuAccountWithTokenFlags`, `ReceiveCashuTokenAccount`, `isClaimingToSameCashuAccount` (internal copy of the app models).
- `internal/services/receive-cashu-token-service.ts` — `ReceiveCashuTokenService` (account selection: `buildAccountForMint` / `getSourceAndDestinationAccounts` / static `getDefaultReceiveAccount`), de-TanStacked onto `mintCache` + an injected validator.
- `internal/services/receive-cashu-token-quote-service.ts` — `ReceiveCashuTokenQuoteService` (`createCrossAccountReceiveQuotes` + the 5-attempt fee-fitting loop) + `CrossAccountReceiveQuotesResult` type.
- `domains/cashu-receive-ops.test.ts` — unit tests for `receiveToken` + the Breez race (create if absent; extend if present).

**Modified (all under `packages/wallet-sdk/src/`):**
- `internal/cashu/mint-validation.ts` — add `buildCashuMintValidator(blocklist?)` helper (encapsulates the protocol-constant NUTs + WS commands).
- `config.ts` — add `cashuMintBlocklist?: MintBlocklist` to `SdkConfig` (host injects; defaults to `[]`).
- `domains/cashu-receive-ops.ts` — extend `Deps`; add `receiveToken` + private `waitForSparkReceiveToComplete` / `tryCompleteSwap` / `tryCompleteReceive` / `trySetDefaultAccount` / `requireUser`; add + export `ReceiveTokenResult`.
- `sdk.ts` — build the validator + the two ported services; pass the new deps + closures (`getUser`/`setDefaultAccount`/`getExchangeRate`) into `CashuReceiveOps`.
- `index.ts` — barrel-export `ReceiveTokenResult`.

**Reachability (verified):** `runtime.accountRepository.getAllActive(userId)` (the exact app account-list read), `runtime.accountService.addCashuAccount` + statics `AccountService.getExtendedAccounts`/`isDefaultAccount`, `runtime.protocols.{cashuReceiveSwapService,cashuReceiveQuoteService,sparkReceiveQuoteService}`, `runtime.mintCache`, `sdk.rates.get`, `sdk.user.get`/`setDefaultAccount` — all in scope in `sdk.ts` `create()` before `cashu` is built (rates@176, user@170, accounts@177, `p`/`walletRuntime`@196, `cashu`@197).

---

## Task 1: Token-receive models + mint-validator helper + config field

**Files:**
- Create: `packages/wallet-sdk/src/internal/services/receive-cashu-token-models.ts`
- Modify: `packages/wallet-sdk/src/internal/cashu/mint-validation.ts` (add `buildCashuMintValidator`)
- Modify: `packages/wallet-sdk/src/config.ts` (add `cashuMintBlocklist?`)
- Test: `packages/wallet-sdk/src/internal/services/receive-cashu-token-models.test.ts`

**Interfaces:**
- Produces:
  - `type TokenFlags = { isSource: boolean; isUnknown: boolean; canReceive: boolean; cannotReceiveReason?: string }`
  - `type CashuAccountWithTokenFlags = ExtendedCashuAccount & TokenFlags`
  - `type ReceiveCashuTokenAccount = (ExtendedCashuAccount | ExtendedSparkAccount) & TokenFlags`
  - `const isClaimingToSameCashuAccount = (a: Account, b: Account): boolean`
  - `const buildCashuMintValidator: (blocklist?: MintBlocklist) => MintValidator` where `MintValidator = ReturnType<typeof buildMintValidator>` (signature `(mintUrl: string, selectedUnit: CashuProtocolUnit, mintInfo: MintInfo, keysets: MintKeyset[]) => string | true`)
  - `SdkConfig.cashuMintBlocklist?: MintBlocklist`

- [ ] **Step 1: Write the failing test for `isClaimingToSameCashuAccount`**

Create `packages/wallet-sdk/src/internal/services/receive-cashu-token-models.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test';
import type { Account } from '../../domains/account-types';
import { isClaimingToSameCashuAccount } from './receive-cashu-token-models';

const cashu = (mintUrl: string, currency: 'BTC' | 'USD' = 'BTC') =>
  ({ type: 'cashu', currency, mintUrl }) as unknown as Account;
const spark = () => ({ type: 'spark', currency: 'BTC' }) as unknown as Account;

describe('isClaimingToSameCashuAccount', () => {
  it('is true for two cashu accounts on the same mint + currency', () => {
    expect(
      isClaimingToSameCashuAccount(
        cashu('https://mint.example/'),
        cashu('https://mint.example'),
      ),
    ).toBe(true); // areMintUrlsEqual normalizes the trailing slash
  });

  it('is false when currencies differ', () => {
    expect(
      isClaimingToSameCashuAccount(
        cashu('https://mint.example', 'BTC'),
        cashu('https://mint.example', 'USD'),
      ),
    ).toBe(false);
  });

  it('is false when mint URLs differ', () => {
    expect(
      isClaimingToSameCashuAccount(
        cashu('https://a.example'),
        cashu('https://b.example'),
      ),
    ).toBe(false);
  });

  it('is false when either account is not cashu', () => {
    expect(
      isClaimingToSameCashuAccount(cashu('https://mint.example'), spark()),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/wallet-sdk && bun test src/internal/services/receive-cashu-token-models.test.ts`
Expected: FAIL — `Cannot find module './receive-cashu-token-models'`.

- [ ] **Step 3: Create the models file**

Create `packages/wallet-sdk/src/internal/services/receive-cashu-token-models.ts` (port of `apps/web-wallet/app/features/receive/receive-cashu-token-models.ts`, account types repointed to `../../domains/account-types`):

```typescript
import { areMintUrlsEqual } from '@agicash/cashu';
import type {
  Account,
  ExtendedCashuAccount,
  ExtendedSparkAccount,
} from '../../domains/account-types';

export type TokenFlags = {
  /** Whether the account is the source account of the cashu token. */
  isSource: boolean;
  /** Whether the user already has the account. */
  isUnknown: boolean;
  /** Whether the account can receive the cashu token. */
  canReceive: boolean;
  /** Why the account cannot receive, if applicable. */
  cannotReceiveReason?: string;
};

export type CashuAccountWithTokenFlags = ExtendedCashuAccount & TokenFlags;

export type ReceiveCashuTokenAccount = (
  | ExtendedCashuAccount
  | ExtendedSparkAccount
) &
  TokenFlags;

export const isClaimingToSameCashuAccount = (
  a: Account,
  b: Account,
): boolean => {
  return (
    a.type === 'cashu' &&
    b.type === 'cashu' &&
    a.currency === b.currency &&
    areMintUrlsEqual(a.mintUrl, b.mintUrl)
  );
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/wallet-sdk && bun test src/internal/services/receive-cashu-token-models.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add `buildCashuMintValidator` to `internal/cashu/mint-validation.ts`**

The app builds its validator in `apps/web-wallet/app/features/shared/cashu.ts:141-145` with hardcoded protocol constants + an env-sourced blocklist. The SDK reads no env, so encapsulate the constants here and accept the blocklist as a parameter. Append to `packages/wallet-sdk/src/internal/cashu/mint-validation.ts`:

```typescript
/** The validator returned by {@link buildMintValidator}. */
export type MintValidator = ReturnType<typeof buildMintValidator>;

/**
 * Builds the Agicash Cashu mint validator with the protocol-required NUTs and
 * WebSocket commands. `blocklist` is supplied by the host (the SDK reads no env;
 * the web app parses `VITE_CASHU_MINT_BLOCKLIST` and passes it via SdkConfig).
 */
export const buildCashuMintValidator = (
  blocklist: MintBlocklist = [],
): MintValidator =>
  buildMintValidator({
    requiredNuts: [4, 5, 7, 8, 9, 10, 11, 12, 17, 20],
    requiredWebSocketCommands: ['bolt11_melt_quote', 'proof_state'],
    blocklist,
  });
```

VERIFY DURING EXEC: `MintBlocklist` is already a type in this file (used by `BuildMintValidatorOptions.blocklist`). If it is not exported, add `export` to its declaration so `config.ts` can reference it. Confirm `buildMintValidator`'s `requiredNuts`/`requiredWebSocketCommands` accept plain arrays (the app uses `as const`; if the param type requires it, add `as const`).

- [ ] **Step 6: Add `cashuMintBlocklist?` to `SdkConfig`**

In `packages/wallet-sdk/src/config.ts`, import the type and add the optional field to `SdkConfig`:

```typescript
import type { MintBlocklist } from './internal/cashu/mint-validation';
```

Add to the `SdkConfig` type (alongside the other optional fields):

```typescript
  /**
   * Mint URL + unit combinations to block when validating an unknown source
   * mint during a token claim. The host parses this (e.g. from
   * `VITE_CASHU_MINT_BLOCKLIST`); the SDK reads no env. Defaults to `[]`.
   */
  cashuMintBlocklist?: MintBlocklist;
```

VERIFY DURING EXEC: read `config.ts` first to match its exact `SdkConfig` shape (object-literal vs interface) and place the field consistently.

- [ ] **Step 7: Run the gate**

Run: `bun run typecheck && cd packages/wallet-sdk && bun test`
Expected: typecheck exit 0; all SDK tests pass (incl. the 4 new model tests).

- [ ] **Step 8: Commit**

```bash
git add packages/wallet-sdk/src/internal/services/receive-cashu-token-models.ts \
        packages/wallet-sdk/src/internal/services/receive-cashu-token-models.test.ts \
        packages/wallet-sdk/src/internal/cashu/mint-validation.ts \
        packages/wallet-sdk/src/config.ts
git commit -m "feat(wallet-sdk): 6c token-receive models + mint-validator helper + config blocklist (base 6c)"
```

---

## Task 2: Port `ReceiveCashuTokenService` (account selection)

**Files:**
- Create: `packages/wallet-sdk/src/internal/services/receive-cashu-token-service.ts`
- Source to copy from: `apps/web-wallet/app/features/receive/receive-cashu-token-service.ts`

**Interfaces:**
- Consumes (Task 1): `CashuAccountWithTokenFlags`, `ReceiveCashuTokenAccount` (models); `MintValidator` (mint-validation). `getInitializedCashuWallet` (`../cashu/init-wallet`), `tokenToMoney` (`../cashu/token`), `MintDataCache` (`../cashu/mint-cache`).
- Produces:
  - `class ReceiveCashuTokenService` with `constructor(deps: { mintCache: MintDataCache; mintValidator: MintValidator })`
  - `buildAccountForMint(mintUrl: string, currency: Currency): Promise<CashuAccountWithTokenFlags>`
  - `getSourceAndDestinationAccounts(token: Token, accounts?: ExtendedAccount[]): Promise<{ sourceAccount: CashuAccountWithTokenFlags; possibleDestinationAccounts: ReceiveCashuTokenAccount[] }>`
  - `static getDefaultReceiveAccount(sourceAccount, possibleDestinationAccounts, preferredReceiveAccountId?): ReceiveCashuTokenAccount | null`

**This is a faithful copy + de-TanStack.** Copy the class body (methods `buildAccountForMint`, `getSourceAndDestinationAccounts`, `getDefaultReceiveAccount`, `augmentNonSourceAccountsWithTokenFlags`, `getPossibleDestinationAccounts`) **byte-for-byte** from the app file (lines 27–237). DROP the `useReceiveCashuTokenService` hook (lines 239–242). Apply the import remap and the two body edits below.

**Import remap (top of file):**

| App import | SDK replacement |
|---|---|
| `import type { Currency } from '@agicash/money';` | unchanged |
| `import type { Token } from '@cashu/cashu-ts';` | unchanged |
| `import { type QueryClient, useQueryClient } from '@tanstack/react-query';` | **DELETE** |
| `import { areMintUrlsEqual, checkIsTestMint, findFirstActiveKeyset, getCashuProtocolUnit, getKeysetExpiry } from '@agicash/cashu';` | unchanged |
| `import { type ExtendedAccount, type ExtendedCashuAccount, canReceiveFromLightning, canSendToLightning } from '../accounts/account';` | `import { type ExtendedAccount, type ExtendedCashuAccount, canReceiveFromLightning, canSendToLightning } from '../../domains/account-types';` |
| `import { cashuMintValidator, getInitializedCashuWallet, tokenToMoney } from '../shared/cashu';` | `import { getInitializedCashuWallet } from '../cashu/init-wallet';` + `import { tokenToMoney } from '../cashu/token';` (drop `cashuMintValidator` — now an injected dep) |
| `import type { CashuAccountWithTokenFlags, ReceiveCashuTokenAccount } from './receive-cashu-token-models';` | `import type { CashuAccountWithTokenFlags, ReceiveCashuTokenAccount } from './receive-cashu-token-models';` (unchanged path — co-located) |
| (new) | `import type { MintDataCache } from '../cashu/mint-cache';` |
| (new) | `import type { MintValidator } from '../cashu/mint-validation';` |

**Constructor edit** — replace `constructor(private readonly queryClient: QueryClient) {}` with:

```typescript
  constructor(
    private readonly deps: {
      mintCache: MintDataCache;
      mintValidator: MintValidator;
    },
  ) {}
```

**`buildAccountForMint` body edit** — two changes inside the otherwise byte-for-byte body:

1. Replace the `getInitializedCashuWallet` call (app lines 41–45):

```typescript
    const { wallet, isOnline } = await getInitializedCashuWallet({
      mintCache: this.deps.mintCache,
      mintUrl,
      currency,
    });
```

(The app passed neither `bip39seed` nor `authProvider`; the SDK helper makes both optional, so the unauthenticated placeholder ports faithfully — do NOT add them.)

2. Replace the validator call (app lines 91–96) — use the injected validator instead of the module-level `cashuMintValidator`:

```typescript
    const validationResult = this.deps.mintValidator(
      mintUrl,
      unit,
      mintInfo,
      wallet.keyChain.getKeysets().map((ks) => ks.toMintKeyset()),
    );
```

Everything else in the class (the `getSourceAndDestinationAccounts` lookup via `areMintUrlsEqual` + `tokenToMoney(token).currency`, the static `getDefaultReceiveAccount` precedence logic, `augmentNonSourceAccountsWithTokenFlags`, `getPossibleDestinationAccounts`) is **unchanged**.

- [ ] **Step 1: Create the file** with the imports + constructor + the copied/edited methods as specified above.

- [ ] **Step 2: Run the gate**

Run: `bun run typecheck && cd packages/wallet-sdk && bun test`
Expected: typecheck exit 0 (this is the real check for a copy — `tsc` catches any dangling import / type mismatch); tests unchanged (no new test — faithful port, exercised via Task 4's `receiveToken` tests, matching the 3a/3b minimal-testing posture for copied services).

- [ ] **Step 3: Commit**

```bash
git add packages/wallet-sdk/src/internal/services/receive-cashu-token-service.ts
git commit -m "feat(wallet-sdk): 6c port ReceiveCashuTokenService onto mintCache + injected validator (base 6c)"
```

---

## Task 3: Port `ReceiveCashuTokenQuoteService` (cross-account quotes)

**Files:**
- Create: `packages/wallet-sdk/src/internal/services/receive-cashu-token-quote-service.ts`
- Source to copy from: `apps/web-wallet/app/features/receive/receive-cashu-token-quote-service.ts`

**Interfaces:**
- Consumes: `CashuReceiveQuoteService` (`../services/cashu-receive-quote-service`), `SparkReceiveQuoteService` (`../services/spark-receive-quote-service`), `getLightningQuote as getSparkLightningQuote` (`../spark/receive-quote-core`), `tokenToMoney` (`../cashu/token`), `isClaimingToSameCashuAccount` (Task 1 models), `DomainError` (`../../errors`).
- Produces:
  - `class ReceiveCashuTokenQuoteService` with `constructor(private readonly cashuReceiveQuoteService: CashuReceiveQuoteService, private readonly sparkLightningReceiveService: SparkReceiveQuoteService)`
  - `createCrossAccountReceiveQuotes(props: CreateCrossAccountReceiveQuotesProps): Promise<CrossAccountReceiveQuotesResult>` where `CreateCrossAccountReceiveQuotesProps = { userId: string; token: Token; destinationAccount: Account; sourceAccount: CashuAccount; exchangeRate: string }`
  - `export type CrossAccountReceiveQuotesResult` (the discriminated union on `destinationType: 'cashu' | 'spark'` carrying `cashuMeltQuote`, `lightningReceiveQuote`, and `cashuReceiveQuote | sparkReceiveQuote`)

**This is a faithful copy + de-TanStack.** Copy the `LightningReceiveQuote` type, `CreateCrossAccountReceiveQuotesProps` type, the exported `CrossAccountReceiveQuotesResult` type, and the class body (`createCrossAccountReceiveQuotes`, `getCrossMintQuotesWithinTargetAmount`, `getLightningQuoteForDestinationAccount`) **byte-for-byte** from the app file (lines 27–311). DROP the `useReceiveCashuTokenQuoteService` hook (lines 313–320). Apply only the import remap below — **no body edits** (the 5-attempt fee-fitting loop, the `getFeesForProofs`/`subtract`/`convert` arithmetic, and the cashu-vs-spark quote creation are unchanged).

**Import remap (top of file):**

| App import | SDK replacement |
|---|---|
| `import { Money } from '@agicash/money';` | unchanged |
| `import type { MeltQuoteBolt11Response, Token } from '@cashu/cashu-ts';` | unchanged |
| `import { getCashuUnit } from '@agicash/cashu';` | unchanged |
| `import type { Account, AccountType, CashuAccount, SparkAccount } from '../accounts/account';` | `import type { Account, AccountType, CashuAccount, SparkAccount } from '../../domains/account-types';` |
| `import { tokenToMoney } from '../shared/cashu';` | `import { tokenToMoney } from '../cashu/token';` |
| `import { DomainError } from '../shared/error';` | `import { DomainError } from '../../errors';` |
| `import type { CashuReceiveQuote } from './cashu-receive-quote';` | `import type { CashuReceiveQuote } from '../../domains/cashu-receive-quote';` |
| `import type { CashuReceiveLightningQuote } from './cashu-receive-quote-core';` | `import type { CashuReceiveLightningQuote } from '../cashu/receive-quote-core';` |
| `import { type CashuReceiveQuoteService, useCashuReceiveQuoteService } from './cashu-receive-quote-service';` | `import type { CashuReceiveQuoteService } from './cashu-receive-quote-service';` (drop the hook) |
| `import { isClaimingToSameCashuAccount } from './receive-cashu-token-models';` | unchanged path (co-located) |
| `import type { SparkReceiveQuote } from './spark-receive-quote';` | `import type { SparkReceiveQuote } from '../../domains/spark-receive-quote';` |
| `import type { SparkReceiveLightningQuote } from './spark-receive-quote-core';` | `import type { SparkReceiveLightningQuote } from '../spark/receive-quote-core';` |
| `import { getLightningQuote as getSparkLightningQuote } from './spark-receive-quote-core';` | `import { getLightningQuote as getSparkLightningQuote } from '../spark/receive-quote-core';` |
| `import { type SparkReceiveQuoteService, useSparkReceiveQuoteService } from './spark-receive-quote-service';` | `import type { SparkReceiveQuoteService } from './spark-receive-quote-service';` (drop the hook) |

VERIFY DURING EXEC: confirm the exact SDK paths for `cashu-receive-quote` (domain entity), `cashu/receive-quote-core`, `spark-receive-quote`, `spark/receive-quote-core`, and the two service files by reading the importer in `domains/cashu-receive-ops.ts` (which already imports `CashuReceiveLightningQuote` from `../internal/cashu/receive-quote-core` and `CashuReceiveQuoteService` from `../internal/services/cashu-receive-quote-service`) — match those paths exactly.

- [ ] **Step 1: Create the file** with the remapped imports + the three copied types + the copied class (hook dropped).

- [ ] **Step 2: Run the gate**

Run: `bun run typecheck && cd packages/wallet-sdk && bun test`
Expected: typecheck exit 0; tests unchanged (no new test — faithful port).

- [ ] **Step 3: Commit**

```bash
git add packages/wallet-sdk/src/internal/services/receive-cashu-token-quote-service.ts
git commit -m "feat(wallet-sdk): 6c port ReceiveCashuTokenQuoteService cross-account quotes (base 6c)"
```

---

## Task 4: Add `receiveToken` to `CashuReceiveOps` (orchestration + Breez race) + tests

**Files:**
- Modify: `packages/wallet-sdk/src/domains/cashu-receive-ops.ts`
- Test: `packages/wallet-sdk/src/domains/cashu-receive-ops.test.ts` (create or extend)
- Source for the orchestration logic: `apps/web-wallet/app/features/receive/claim-cashu-token-service.ts`

**Interfaces:**
- Consumes: Task 2 `ReceiveCashuTokenService`, Task 3 `ReceiveCashuTokenQuoteService` + `CrossAccountReceiveQuotesResult`, Task 1 `isClaimingToSameCashuAccount`. The landed `CashuReceiveSwapService` (`create`/`completeSwap`), `SparkReceiveQuoteService` (`complete`), `AccountRepository` (`getAllActive`), `AccountService` (static `getExtendedAccounts`/`isDefaultAccount` + `addCashuAccount`), `CashuReceiveQuoteService` (`completeReceive`, already `deps.service`).
- Produces:
  - `export type ReceiveTokenResult = { transactionId: string; destinationAccount: Pick<Account, 'id' | 'purpose'> }`
  - `CashuReceiveOps.receiveToken(p: { token: Token; claimTo: 'cashu' | 'spark' }): Promise<ReceiveTokenResult>` (throws `DomainError` on failure)

### Behavior contract (the faithful inline port of `claimToken`/`handleClaim`)

1. `user = await this.requireUser()` (fetch full current `User`; throw if none).
2. `accounts = await this.deps.accountRepository.getAllActive(user.id)` (replaces `queryClient.fetchQuery(accountsQueryOptions)` — same read).
3. `extendedAccounts = AccountService.getExtendedAccounts(user, accounts)`; `preferredReceiveAccountId = claimTo === 'spark' ? extendedAccounts.find(a => a.type === 'spark')?.id : undefined`.
4. `{ sourceAccount, possibleDestinationAccounts } = await this.deps.receiveTokenService.getSourceAndDestinationAccounts(token, extendedAccounts)`.
5. `let receiveAccount = ReceiveCashuTokenService.getDefaultReceiveAccount(sourceAccount, possibleDestinationAccounts, preferredReceiveAccountId)`.
6. `if (!receiveAccount) throw new DomainError('Token from this mint cannot be claimed')` (was a `{success:false}` return).
7. If `receiveAccount.isUnknown && receiveAccount.type === 'cashu'`: `addedAccount = await this.deps.accountService.addCashuAccount({ userId: user.id, account: receiveAccount })`; `receiveAccount = { ...receiveAccount, ...addedAccount }`. **DROP** `accountsCache.upsert`.
8. If `receiveAccount.currency !== user.defaultCurrency || !AccountService.isDefaultAccount(user, receiveAccount)`: `await this.trySetDefaultAccount(receiveAccount)` (best-effort; swallows). **DROP** `setQueryData([UserCache.Key], ...)`.
9. Fork on `isClaimingToSameCashuAccount(receiveAccount, sourceAccount)`:
   - **SAME-ACCOUNT:** `{ swap, account } = await this.deps.swapService.create({ userId: user.id, token, account: receiveAccount as CashuAccount })`; `transactionId = swap.transactionId`. **DROP** `accountsCache.upsert`. `result = await this.tryCompleteSwap(account, swap)`; `if (!result.success && result.swap?.state === 'FAILED') throw new DomainError(result.swap.failureReason)` (was a `{success:false}` return). On success, **DROP** the upsert.
   - **CROSS-ACCOUNT:** `exchangeRate = await this.deps.getExchangeRate(\`${sourceAccount.currency}-${receiveAccount.currency}\` as Ticker)`; `quotes = await this.deps.receiveTokenQuoteService.createCrossAccountReceiveQuotes({ userId: user.id, token, sourceAccount, destinationAccount: receiveAccount, exchangeRate })`; `transactionId = quotes.lightningReceiveQuote.transactionId`. Then **verbatim** melt (comment included): `await sourceAccount.wallet.meltProofsIdempotent(quotes.cashuMeltQuote, token.proofs, undefined, { type: 'random' })`. Then `await this.tryCompleteReceive(quotes)` (best-effort — never short-circuits; **DROP** the success upsert).
10. `return { transactionId, destinationAccount: { id: receiveAccount.id, purpose: receiveAccount.purpose } }`.

No outer try/catch (the app's `claimToken` wrapper that mapped `DomainError`→`{success:false}` and unknown→`Sentry`+`{success:false}` is removed — `DomainError` and unknown errors both propagate per the locked return-contract decision).

- [ ] **Step 1: Write the failing tests**

Create (or extend) `packages/wallet-sdk/src/domains/cashu-receive-ops.test.ts`. Use a fake-deps builder so each test overrides only what it exercises. This embeds the fixture pattern + 7 representative cases; cover the listed behavior with these.

```typescript
import { describe, expect, it, mock } from 'bun:test';
import { DomainError } from '../errors';
import { EventBus } from '../internal/event-bus';
import type { SdkCoreEventMap } from '../events';
import { CashuReceiveOps } from './cashu-receive-ops';

// --- fakes -----------------------------------------------------------------
const USER = { id: 'user-1', defaultCurrency: 'BTC' } as any;

const cashuAcct = (over: Record<string, unknown> = {}) =>
  ({
    id: 'acc-cashu',
    type: 'cashu',
    purpose: 'send',
    currency: 'BTC',
    mintUrl: 'https://mint.a/',
    isDefault: true,
    isUnknown: false,
    isSource: true,
    canReceive: true,
    wallet: {
      meltProofsIdempotent: mock(async () => undefined),
    },
    ...over,
  }) as any;

const sparkAcct = (over: Record<string, unknown> = {}) =>
  ({ id: 'acc-spark', type: 'spark', purpose: 'send', currency: 'BTC', canReceive: true, ...over }) as any;

const makeOps = (over: Partial<Record<string, any>> = {}) => {
  const events = new EventBus<SdkCoreEventMap>();
  const source = cashuAcct();
  const deps: any = {
    service: { completeReceive: mock(async () => ({ account: cashuAcct() })) },
    repository: { get: mock(async () => null) },
    events,
    getCurrentUserId: mock(async () => USER.id),
    swapService: {
      create: mock(async () => ({
        swap: { transactionId: 'tx-swap', state: 'PENDING', tokenHash: 'h' },
        account: cashuAcct(),
      })),
      completeSwap: mock(async () => ({
        swap: { state: 'COMPLETED' },
        account: cashuAcct(),
      })),
    },
    sparkReceiveQuoteService: { complete: mock(async () => undefined) },
    accountRepository: { getAllActive: mock(async () => [source]) },
    accountService: { addCashuAccount: mock(async () => cashuAcct({ id: 'acc-added' })) },
    receiveTokenService: {
      getSourceAndDestinationAccounts: mock(async () => ({
        sourceAccount: source,
        possibleDestinationAccounts: [source],
      })),
    },
    receiveTokenQuoteService: {
      createCrossAccountReceiveQuotes: mock(async () => ({
        destinationType: 'cashu',
        destinationAccount: cashuAcct({ id: 'acc-dest', mintUrl: 'https://mint.b/' }),
        cashuReceiveQuote: { id: 'q', transactionId: 'tx-cross' },
        cashuMeltQuote: { quote: 'mq', amount: 1 },
        lightningReceiveQuote: { transactionId: 'tx-cross' },
      })),
    },
    getUser: mock(async () => USER),
    setDefaultAccount: mock(async () => USER),
    getExchangeRate: mock(async () => '1'),
    ...over,
  };
  return { ops: new CashuReceiveOps(deps), deps, source };
};

// --- tests -----------------------------------------------------------------
describe('CashuReceiveOps.receiveToken', () => {
  it('same-account: creates swap, completes inline, returns the swap transactionId', async () => {
    const { ops, deps } = makeOps();
    const result = await ops.receiveToken({
      token: { mint: 'https://mint.a/', proofs: [] } as any,
      claimTo: 'cashu',
    });
    expect(result.transactionId).toBe('tx-swap');
    expect(result.destinationAccount).toEqual({ id: 'acc-cashu', purpose: 'send' });
    expect(deps.swapService.create).toHaveBeenCalledTimes(1);
    expect(deps.swapService.completeSwap).toHaveBeenCalledTimes(1);
  });

  it('same-account: throws DomainError when completeSwap returns terminal FAILED', async () => {
    const { ops } = makeOps({
      swapService: {
        create: mock(async () => ({ swap: { transactionId: 'tx', state: 'PENDING' }, account: cashuAcct() })),
        completeSwap: mock(async () => ({ swap: { state: 'FAILED', failureReason: 'boom' }, account: cashuAcct() })),
      },
    });
    await expect(
      ops.receiveToken({ token: { mint: 'https://mint.a/', proofs: [] } as any, claimTo: 'cashu' }),
    ).rejects.toThrow('boom');
  });

  it('same-account: tolerates a THROWN completeSwap error (background finalizes) and still resolves', async () => {
    const { ops } = makeOps({
      swapService: {
        create: mock(async () => ({ swap: { transactionId: 'tx-ok', state: 'PENDING' }, account: cashuAcct() })),
        completeSwap: mock(async () => { throw new Error('network'); }),
      },
    });
    const result = await ops.receiveToken({
      token: { mint: 'https://mint.a/', proofs: [] } as any,
      claimTo: 'cashu',
    });
    expect(result.transactionId).toBe('tx-ok');
  });

  it('throws DomainError when no receive account is available', async () => {
    const { ops } = makeOps({
      receiveTokenService: {
        getSourceAndDestinationAccounts: mock(async () => ({
          sourceAccount: cashuAcct({ canReceive: false }),
          possibleDestinationAccounts: [],
        })),
      },
    });
    await expect(
      ops.receiveToken({ token: { mint: 'https://x/', proofs: [] } as any, claimTo: 'cashu' }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('cross-account cashu: melts then completes the receive, returns the quote transactionId', async () => {
    const source = cashuAcct({ mintUrl: 'https://mint.a/' });
    const dest = cashuAcct({ id: 'acc-dest', mintUrl: 'https://mint.b/', isSource: false });
    const { ops, deps } = makeOps({
      receiveTokenService: {
        getSourceAndDestinationAccounts: mock(async () => ({
          sourceAccount: source,
          possibleDestinationAccounts: [source, dest],
        })),
      },
      accountRepository: { getAllActive: mock(async () => [source, dest]) },
    });
    const result = await ops.receiveToken({
      token: { mint: 'https://mint.a/', proofs: [] } as any,
      claimTo: 'cashu',
    });
    expect(result.transactionId).toBe('tx-cross');
    expect(source.wallet.meltProofsIdempotent).toHaveBeenCalledTimes(1);
    // best-effort complete on the quote service (deps.service.completeReceive)
    expect(deps.service.completeReceive).toHaveBeenCalledTimes(1);
  });

  it('cross-account: propagates a melt failure (the non-swallowed step)', async () => {
    const source = cashuAcct({ mintUrl: 'https://mint.a/', wallet: { meltProofsIdempotent: mock(async () => { throw new Error('melt-failed'); }) } });
    const dest = cashuAcct({ id: 'acc-dest', mintUrl: 'https://mint.b/' });
    const { ops } = makeOps({
      receiveTokenService: {
        getSourceAndDestinationAccounts: mock(async () => ({ sourceAccount: source, possibleDestinationAccounts: [source, dest] })),
      },
    });
    await expect(
      ops.receiveToken({ token: { mint: 'https://mint.a/', proofs: [] } as any, claimTo: 'cashu' }),
    ).rejects.toThrow('melt-failed');
  });

  it('cross-account spark: resolves the Breez race via paymentSucceeded, then completes the spark quote', async () => {
    const source = cashuAcct({ mintUrl: 'https://mint.a/' });
    let captured: ((e: any) => void) | undefined;
    const sparkDest = sparkAcct({
      id: 'acc-spark-dest',
      wallet: {
        addEventListener: mock(async (l: { onEvent: (e: any) => void }) => { captured = l.onEvent; return 'lid'; }),
        removeEventListener: mock(async () => true),
        getPaymentByInvoice: mock(async () => ({ payment: undefined })),
      },
    });
    const completeSpark = mock(async () => undefined);
    const { ops } = makeOps({
      receiveTokenService: {
        getSourceAndDestinationAccounts: mock(async () => ({ sourceAccount: source, possibleDestinationAccounts: [source, sparkDest] })),
      },
      sparkReceiveQuoteService: { complete: completeSpark },
      receiveTokenQuoteService: {
        createCrossAccountReceiveQuotes: mock(async () => ({
          destinationType: 'spark',
          destinationAccount: sparkDest,
          sparkReceiveQuote: { id: 'sq', transactionId: 'tx-spark', paymentHash: 'ph', paymentRequest: 'lnbc', sparkId: 's' },
          cashuMeltQuote: { quote: 'mq', amount: 1 },
          lightningReceiveQuote: { transactionId: 'tx-spark' },
        })),
      },
    });
    const promise = ops.receiveToken({ token: { mint: 'https://mint.a/', proofs: [] } as any, claimTo: 'spark' });
    // let the listener register, then fire the matching event
    await new Promise((r) => setTimeout(r, 5));
    captured?.({ type: 'paymentSucceeded', payment: { id: 'spark-tx', details: { type: 'lightning', htlcDetails: { paymentHash: 'ph', preimage: 'pre' } } } });
    const result = await promise;
    expect(result.transactionId).toBe('tx-spark');
    expect(completeSpark).toHaveBeenCalledWith(expect.anything(), 'pre', 'spark-tx');
  });
});
```

Also add a test asserting the **set-default best-effort tolerance** (when `setDefaultAccount` throws, the flow still resolves):

```typescript
  it('set-default failure is non-fatal', async () => {
    const { ops } = makeOps({ setDefaultAccount: mock(async () => { throw new Error('db'); }) });
    const result = await ops.receiveToken({ token: { mint: 'https://mint.a/', proofs: [] } as any, claimTo: 'cashu' });
    expect(result.transactionId).toBe('tx-swap');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/wallet-sdk && bun test src/domains/cashu-receive-ops.test.ts`
Expected: FAIL — `receiveToken` is not a function on `CashuReceiveOps`.

- [ ] **Step 3: Extend the `Deps` type and add the imports in `cashu-receive-ops.ts`**

Add these imports (verify exact paths against the existing file's import style):

```typescript
import type { Payment } from '@agicash/breez-sdk-spark';
import type { Token } from '@cashu/cashu-ts';
import { AccountService } from '../internal/services/account-service';
import type { AccountRepository } from '../internal/db/account-repository';
import type { CashuReceiveSwapService } from '../internal/services/cashu-receive-swap-service';
import type { SparkReceiveQuoteService } from '../internal/services/spark-receive-quote-service';
import { ReceiveCashuTokenService } from '../internal/services/receive-cashu-token-service';
import type {
  CrossAccountReceiveQuotesResult,
  ReceiveCashuTokenQuoteService,
} from '../internal/services/receive-cashu-token-quote-service';
import { isClaimingToSameCashuAccount } from '../internal/services/receive-cashu-token-models';
import type { Account, CashuAccount, SparkAccount } from './account-types';
import type { CashuReceiveSwap } from './cashu-receive-swap';
import type { SparkReceiveQuote } from './spark-receive-quote';
import type { Rate, Ticker } from './rates';
import type { User } from '<USER TYPE PATH>'; // VERIFY: where UserDomain imports `User` from (likely '../internal/db/user-repository' or './user'); match it.
```

VERIFY DURING EXEC: read the top of `domains/user.ts` to find the `User` import path and reuse it verbatim. Confirm `Rate` and `Ticker` are exported from `domains/rates.ts` (used by `RatesDomain.get`); if `Ticker` lives elsewhere (e.g. an internal rates module), import from there.

Extend `Deps`:

```typescript
type Deps = {
  service: CashuReceiveQuoteService;
  repository: CashuReceiveQuoteRepository;
  events: EventBus<SdkCoreEventMap>;
  getCurrentUserId: () => Promise<string | null>;
  // 6c — receiveToken orchestration:
  swapService: CashuReceiveSwapService;
  sparkReceiveQuoteService: SparkReceiveQuoteService;
  accountRepository: AccountRepository;
  accountService: AccountService;
  receiveTokenService: ReceiveCashuTokenService;
  receiveTokenQuoteService: ReceiveCashuTokenQuoteService;
  getUser: () => Promise<User | null>;
  setDefaultAccount: (params: {
    account: Account;
    setDefaultCurrency?: boolean;
  }) => Promise<User>;
  getExchangeRate: (ticker: Ticker) => Promise<Rate>;
};
```

- [ ] **Step 4: Add `ReceiveTokenResult` + `receiveToken` + the private helpers**

Add the exported result type (near the top, after the existing imports):

```typescript
export type ReceiveTokenResult = {
  transactionId: string;
  destinationAccount: Pick<Account, 'id' | 'purpose'>;
};
```

Add the public method to the `CashuReceiveOps` class:

```typescript
  /**
   * Claims a cashu token: selects source + destination accounts, opportunistically
   * adds + defaults the destination, then completes inline (same-account swap, or
   * cross-account melt+receive). Best-effort completion — anything left is finalized
   * by the background processors. Throws `DomainError` on a non-recoverable failure.
   */
  async receiveToken(p: {
    token: Token;
    claimTo: 'cashu' | 'spark';
  }): Promise<ReceiveTokenResult> {
    const { token, claimTo } = p;
    const user = await this.requireUser();

    const accounts = await this.deps.accountRepository.getAllActive(user.id);
    const extendedAccounts = AccountService.getExtendedAccounts(user, accounts);
    const preferredReceiveAccountId =
      claimTo === 'spark'
        ? extendedAccounts.find((a) => a.type === 'spark')?.id
        : undefined;

    const { sourceAccount, possibleDestinationAccounts } =
      await this.deps.receiveTokenService.getSourceAndDestinationAccounts(
        token,
        extendedAccounts,
      );

    let receiveAccount = ReceiveCashuTokenService.getDefaultReceiveAccount(
      sourceAccount,
      possibleDestinationAccounts,
      preferredReceiveAccountId,
    );

    if (!receiveAccount) {
      throw new DomainError('Token from this mint cannot be claimed');
    }

    if (receiveAccount.isUnknown && receiveAccount.type === 'cashu') {
      const addedAccount = await this.deps.accountService.addCashuAccount({
        userId: user.id,
        account: receiveAccount,
      });
      receiveAccount = { ...receiveAccount, ...addedAccount };
    }

    if (
      receiveAccount.currency !== user.defaultCurrency ||
      !AccountService.isDefaultAccount(user, receiveAccount)
    ) {
      // Best-effort: failing to set the default account must not fail the claim.
      await this.trySetDefaultAccount(receiveAccount);
    }

    let transactionId: string;

    if (isClaimingToSameCashuAccount(receiveAccount, sourceAccount)) {
      const { swap, account } = await this.deps.swapService.create({
        userId: user.id,
        token,
        account: receiveAccount as CashuAccount,
      });
      transactionId = swap.transactionId;

      // Fail the claim only on a terminal FAILED swap state; a thrown (recoverable)
      // completion error is swallowed so the background processor can retry.
      const result = await this.tryCompleteSwap(account, swap);
      if (!result.success && result.swap?.state === 'FAILED') {
        throw new DomainError(result.swap.failureReason);
      }
    } else {
      const exchangeRate = await this.deps.getExchangeRate(
        `${sourceAccount.currency}-${receiveAccount.currency}` as Ticker,
      );
      const quotes =
        await this.deps.receiveTokenQuoteService.createCrossAccountReceiveQuotes(
          {
            userId: user.id,
            token,
            sourceAccount,
            destinationAccount: receiveAccount,
            exchangeRate,
          },
        );
      transactionId = quotes.lightningReceiveQuote.transactionId;

      await sourceAccount.wallet.meltProofsIdempotent(
        quotes.cashuMeltQuote,
        token.proofs,
        undefined,
        // Use random outputs for change to avoid counter collisions with the
        // source account's persisted keyset counter. The change is currently
        // discarded (see CashuTokenMeltData), so deterministic recovery is
        // unused. If we ever start keeping change here, switch to a reserved
        // deterministic counter persisted on the receive quote.
        { type: 'random' },
      );

      // Best-effort: failure here is left for the background processor to retry.
      await this.tryCompleteReceive(quotes);
    }

    return {
      transactionId,
      destinationAccount: {
        id: receiveAccount.id,
        purpose: receiveAccount.purpose,
      },
    };
  }

  private async requireUser(): Promise<User> {
    const user = await this.deps.getUser();
    if (!user) throw new Error('No authenticated user');
    return user;
  }

  private async trySetDefaultAccount(account: Account): Promise<void> {
    try {
      await this.deps.setDefaultAccount({ account, setDefaultCurrency: true });
    } catch (error) {
      console.error('Failed to set default account while claiming the token', {
        cause: error,
        accountId: account.id,
      });
    }
  }

  private async tryCompleteSwap(
    account: CashuAccount,
    receiveSwap: CashuReceiveSwap,
  ): Promise<
    | { success: true; swap: CashuReceiveSwap; account: CashuAccount }
    | { success: false; swap?: CashuReceiveSwap }
  > {
    try {
      const { swap: updatedSwap, account: updatedAccount } =
        await this.deps.swapService.completeSwap(account, receiveSwap);

      if (updatedSwap.state === 'FAILED') {
        return { success: false, swap: updatedSwap };
      }

      return { success: true, swap: updatedSwap, account: updatedAccount };
    } catch (error) {
      console.error('Failed to complete the swap while claiming the token', {
        cause: error,
        tokenHash: receiveSwap.tokenHash,
        accountId: account.id,
      });
      return { success: false };
    }
  }

  private async tryCompleteReceive(
    quotes: CrossAccountReceiveQuotesResult,
  ): Promise<{ success: true; account?: CashuAccount } | { success: false }> {
    try {
      if (quotes.destinationType === 'cashu') {
        const { account: updatedAccount } =
          await this.deps.service.completeReceive(
            quotes.destinationAccount,
            quotes.cashuReceiveQuote,
          );
        return { success: true, account: updatedAccount };
      }

      if (quotes.destinationType === 'spark') {
        const { sparkTransferId, paymentPreimage } =
          await this.waitForSparkReceiveToComplete(
            quotes.destinationAccount,
            quotes.sparkReceiveQuote,
          );
        await this.deps.sparkReceiveQuoteService.complete(
          quotes.sparkReceiveQuote,
          paymentPreimage,
          sparkTransferId,
        );
        return { success: true };
      }
    } catch (error) {
      console.error('Failed to complete the receive while claiming the token', {
        cause: error,
        destinationType: quotes.destinationType,
        accountId: quotes.destinationAccount.id,
        receiveQuoteId:
          quotes.destinationType === 'cashu'
            ? quotes.cashuReceiveQuote.id
            : quotes.sparkReceiveQuote.id,
      });
    }

    return { success: false };
  }
```

VERIFY DURING EXEC: `tryCompleteReceive` uses `this.deps.service.completeReceive` (the existing `CashuReceiveQuoteService` dep). Confirm `completeReceive(account, quote)` returns `{ account, ... }` (it returns `{ quote, account, addedProofs }`).

- [ ] **Step 5: Add `waitForSparkReceiveToComplete` VERBATIM**

Copy this byte-for-byte from `apps/web-wallet/app/features/receive/claim-cashu-token-service.ts:305-396` as a private method on `CashuReceiveOps` (it references only `account.wallet`, `Payment`, `SparkAccount`, `SparkReceiveQuote` — all imported in Step 3). **Do not modify it.**

```typescript
  /**
   * Waits for a Spark lightning receive to complete using event-driven detection.
   * Registers a Breez SDK event listener and does an initial status check to
   * catch payments that arrived before the listener was registered.
   * @throws Error if the payment does not complete within the timeout.
   */
  private waitForSparkReceiveToComplete(
    account: SparkAccount,
    quote: SparkReceiveQuote,
  ): Promise<{ sparkTransferId: string; paymentPreimage: string }> {
    const timeoutMs = 10_000;

    return new Promise((resolve, reject) => {
      let listenerId: string | undefined;
      let resolved = false;

      const cleanup = () => {
        if (listenerId)
          account.wallet.removeEventListener(listenerId).catch(() => {
            console.warn('Failed to remove Spark event listener', {
              listenerId,
            });
          });
      };

      const timeoutId = setTimeout(() => {
        resolved = true;
        cleanup();
        reject(
          new Error(
            `Spark receive request ${quote.sparkId} timed out after ${timeoutMs / 1000} seconds`,
          ),
        );
      }, timeoutMs);

      const handlePayment = (payment: Payment) => {
        if (resolved) return;
        const details = payment.details;
        if (details?.type !== 'lightning') return;
        if (details.htlcDetails.paymentHash !== quote.paymentHash) return;

        resolved = true;
        clearTimeout(timeoutId);
        cleanup();

        const preimage = details.htlcDetails.preimage;
        if (!preimage) {
          reject(new Error('Payment preimage missing'));
          return;
        }

        resolve({
          sparkTransferId: payment.id,
          paymentPreimage: preimage,
        });
      };

      // Register event listener before initial check to avoid race conditions
      account.wallet
        .addEventListener({
          onEvent(event) {
            if (event.type === 'paymentSucceeded') {
              handlePayment(event.payment);
            }
          },
        })
        .then((id) => {
          listenerId = id;
          if (resolved) {
            account.wallet.removeEventListener(id).catch(() => {
              console.warn('Failed to remove Spark event listener', {
                listenerId,
              });
            });
          }
        });

      // Initial status check — local lookup, no network call
      account.wallet
        .getPaymentByInvoice({ invoice: quote.paymentRequest })
        .then((response) => {
          if (response.payment && response.payment.status === 'completed') {
            handlePayment(response.payment);
          }
        })
        .catch((error) => {
          console.error('Error checking initial receive payment', {
            cause: error,
          });
        });
    });
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd packages/wallet-sdk && bun test src/domains/cashu-receive-ops.test.ts`
Expected: PASS (8 tests). If the spark race test is flaky on the 5ms wait, increase to 10–20ms — the listener registration is a resolved-promise microtask, so a short macrotask delay is sufficient.

- [ ] **Step 7: Run the full gate**

Run: `bun run typecheck && cd packages/wallet-sdk && bun test`
Expected: typecheck exit 0; all SDK tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/wallet-sdk/src/domains/cashu-receive-ops.ts \
        packages/wallet-sdk/src/domains/cashu-receive-ops.test.ts
git commit -m "feat(wallet-sdk): 6c CashuReceiveOps.receiveToken (inline claim + verbatim Breez race) (base 6c)"
```

---

## Task 5: Wire `receiveToken` deps in `sdk.ts` + barrel `ReceiveTokenResult` + sdk.test

**Files:**
- Modify: `packages/wallet-sdk/src/sdk.ts`
- Modify: `packages/wallet-sdk/src/index.ts`
- Test: `packages/wallet-sdk/src/sdk.test.ts` (extend)

**Interfaces:**
- Consumes: Task 4 `CashuReceiveOps` (extended `Deps`), `ReceiveTokenResult`; Task 2 `ReceiveCashuTokenService`; Task 3 `ReceiveCashuTokenQuoteService`; Task 1 `buildCashuMintValidator`.

- [ ] **Step 1: Add imports to `sdk.ts`**

```typescript
import { ReceiveCashuTokenService } from './internal/services/receive-cashu-token-service';
import { ReceiveCashuTokenQuoteService } from './internal/services/receive-cashu-token-quote-service';
import { buildCashuMintValidator } from './internal/cashu/mint-validation';
```

- [ ] **Step 2: Build the validator + the two ported services, then extend the `CashuReceiveOps` construction**

In `sdk.ts` `create()`, immediately before the `const cashu = {` block (currently line ~197, after `const p = walletRuntime.protocols;`), add:

```typescript
    const receiveTokenService = new ReceiveCashuTokenService({
      mintCache: walletRuntime.mintCache,
      mintValidator: buildCashuMintValidator(config.cashuMintBlocklist),
    });
    const receiveTokenQuoteService = new ReceiveCashuTokenQuoteService(
      p.cashuReceiveQuoteService,
      p.sparkReceiveQuoteService,
    );
```

Replace the existing `receive: new CashuReceiveOps({ ... })` (lines 206–211) with the extended deps (the closures reference `rates`@176 and `user`@170, both already in scope):

```typescript
      receive: new CashuReceiveOps({
        service: p.cashuReceiveQuoteService,
        repository: p.cashuReceiveQuoteRepository,
        events,
        getCurrentUserId,
        swapService: p.cashuReceiveSwapService,
        sparkReceiveQuoteService: p.sparkReceiveQuoteService,
        accountRepository: walletRuntime.accountRepository,
        accountService: walletRuntime.accountService,
        receiveTokenService,
        receiveTokenQuoteService,
        getUser: () => user.get(),
        setDefaultAccount: (params) => user.setDefaultAccount(params),
        getExchangeRate: (ticker) => rates.get(ticker),
      }),
```

VERIFY DURING EXEC: confirm `walletRuntime.accountService` exists on the runtime (it does — `wallet-runtime.ts`); and `p.cashuReceiveSwapService` / `p.sparkReceiveQuoteService` are on `ProtocolServices` (they are).

- [ ] **Step 3: Barrel-export `ReceiveTokenResult`**

In `packages/wallet-sdk/src/index.ts`, alongside the other `domains/*` type exports (e.g. near `TerminalResult`), add:

```typescript
export type { ReceiveTokenResult } from './domains/cashu-receive-ops';
```

- [ ] **Step 4: Extend `sdk.test.ts`**

Add an assertion that the method is wired (match the existing sdk.test structure for how an `Sdk` instance is built with fakes):

```typescript
  it('exposes sdk.cashu.receive.receiveToken', () => {
    expect(typeof sdk.cashu.receive.receiveToken).toBe('function');
  });
```

VERIFY DURING EXEC: read `sdk.test.ts` to reuse its existing `sdk` fixture / construction helper; do not build a new harness.

- [ ] **Step 5: Run the full gate**

Run: `bun run typecheck && cd packages/wallet-sdk && bun test`
Expected: typecheck exit 0; all SDK tests pass (incl. the new wiring assertion).

- [ ] **Step 6: Commit**

```bash
git add packages/wallet-sdk/src/sdk.ts packages/wallet-sdk/src/index.ts packages/wallet-sdk/src/sdk.test.ts
git commit -m "feat(wallet-sdk): 6c wire sdk.cashu.receive.receiveToken + barrel ReceiveTokenResult (base 6c)"
```

---

## Task 6: Holistic review

**Files:** none (review only).

- [ ] **Step 1: Whole-6c review (OPUS reviewer subagent)**

Dispatch an OPUS quality-reviewer over the full 6c diff (`git diff e1233035..HEAD -- packages/wallet-sdk` — i.e. the commits since the 6b-ops tip `980b2a8f`; compute the actual base with `git merge-base` if unsure). The reviewer must verify, **without running `fix:all`**:
- **Behavior parity** with `claim-cashu-token-service.ts`: same-account FAILED-only fatal gate; cross-account melt is the only non-swallowed step; `tryCompleteReceive`/`trySetDefaultAccount` swallow + log; `meltProofsIdempotent({type:'random'})` + comment verbatim; the Breez race ported byte-for-byte (listener registered before the initial `getPaymentByInvoice` check; matches `details.type==='lightning'` + `htlcDetails.paymentHash`; rejects on missing preimage; 10s timeout).
- **Decisions honored:** throw-on-failure (no `{success}` wrapper); returns `{transactionId, destinationAccount:{id,purpose}}`; NO `getByTokenHash`/swap-`awaitTerminal` added; selection + quote services internal-only (not barrel-exported, not on `ProtocolServices`).
- **Boundary airtight:** no TanStack (`queryClient`/`*Cache`), no Sentry, no env reads; the only public surface added is `sdk.cashu.receive.receiveToken` + the `ReceiveTokenResult` type; zero app-file changes (`git diff` touches only `packages/wallet-sdk`).
- **Rates orientation:** `getExchangeRate(\`${source}-${dest}\`)` matches how `createCrossAccountReceiveQuotes` consumes the rate (`amountToMelt.convert(destCurrency, exchangeRate)`).
- **Gate:** `bun run typecheck` exit 0; `bun run test` 0 fail.

- [ ] **Step 2: Address any Critical/Important findings**, re-run the gate, commit fixes.

- [ ] **Step 3: Final gate + summary**

Run: `bun run typecheck && bun run test`
Record the final tip + test count in the ledger (`.git/worktrees/sdk-extraction-fable/sdd/progress.md`).

---

## Self-Review (author checklist — completed)

**Spec coverage:** All 3 app orchestrators accounted for — `ReceiveCashuTokenService` (Task 2), `ReceiveCashuTokenQuoteService` (Task 3), `ClaimCashuTokenService.claimToken` orchestration → `CashuReceiveOps.receiveToken` (Task 4). Models (Task 1). Wiring + barrel (Task 5). The Breez race is ported verbatim (Task 4 Step 5). `cashu-token-melt-data` is already in the SDK (memory's "must port" was refuted) — no task needed.

**Placeholder scan:** The two service ports (Tasks 2–3) are "copy from named source + apply this exact import table + these exact body edits" — a precise port recipe (the established 3a/3b pattern), not a placeholder. All new logic (Task 4) is embedded in full. The four `VERIFY DURING EXEC` notes (the `User` import path, `Rate`/`Ticker` export location, `MintBlocklist` export, the `SdkConfig` shape) are genuine "read this file to confirm the exact path" checks, not unresolved design — each names the file to read and the expected answer.

**Type consistency:** `receiveToken` returns `ReceiveTokenResult` (defined Task 4, exported Task 5). `Deps` additions (Task 4) match the `sdk.ts` construction (Task 5) field-for-field. `CrossAccountReceiveQuotesResult` (Task 3) is consumed by `tryCompleteReceive` (Task 4). `MintValidator`/`buildCashuMintValidator` (Task 1) consumed by `ReceiveCashuTokenService` (Task 2) + `sdk.ts` (Task 5). `isClaimingToSameCashuAccount`/`CashuAccountWithTokenFlags`/`ReceiveCashuTokenAccount` (Task 1) consumed by Tasks 2–4.
