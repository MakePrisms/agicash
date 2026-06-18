# Wallet SDK Base 6d — Interactive Token-Receive Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the interactive (create-only) token-receive surface on `sdk.cashu.receive` — a claimability pre-check, account selection, and a create-only claim — so the app's `receive-cashu-token.tsx` inline flow (and a headless MCP wallet) can drive token receives through the SDK.

**Architecture:** Three new public methods on the existing `CashuReceiveOps` (`packages/wallet-sdk/src/domains/cashu-receive-ops.ts`), reusing deps already injected for `receiveToken` (Plan 6c). `getClaimableToken` wraps two pure `@agicash/cashu` helpers. `getTokenAccounts` mirrors `receiveToken`'s internal account read + the internal selection services. `createTokenClaim` is the create-only sibling of `receiveToken`: it folds in add-unknown-account, branches same-account `swapService.create` vs cross-account `createCrossAccountReceiveQuotes`, and stops before melt/complete — the 4c background processors finalize. No `sdk.ts` wiring or `Deps` changes; only new methods, public types, barrel re-exports, and tests.

**Tech Stack:** TypeScript, `@agicash/wallet-sdk`, `@cashu/cashu-ts`, `@agicash/cashu`, `bun:test`.

## Global Constraints

- **Gate = `bun run typecheck` + `bun run test`. NEVER run `bun run fix:all`** (it is biome `check --write` = lint/format only, reorders imports across the whole repo and pollutes the tree). This applies to implementers AND reviewers. If any agent runs it, discard with `git checkout -- .` (all task work is committed, so safe).
- **Zero app-file changes.** 6d is SDK-only. The app keeps its existing hooks/services (`receive-cashu-token-hooks.ts`, `receive-cashu-token.tsx`, etc.); they are rewired onto this surface later in the variant web-migration, not here.
- **No new `Deps` fields and no `sdk.ts` wiring changes.** Every dependency the three methods need is already on `CashuReceiveOps.Deps` and already passed at `sdk.ts:217-231` (verified: `accountRepository`, `accountService`, `receiveTokenService`, `receiveTokenQuoteService`, `swapService`, `getUser`, `setDefaultAccount`, `getExchangeRate`).
- **Faithful to the app, with the resolved forks:** create-only method named `createTokenClaim`; it **folds in add-unknown-account** (`accountService.addCashuAccount` when the destination `isUnknown`) but does **NOT** setDefault (the interactive path never setsDefault — only headless `receiveToken` does); `getTokenAccounts` **reads accounts internally**; the claimable-proofs check **is exposed** as `getClaimableToken`.
- **Create-only means create-only:** `createTokenClaim` must NOT call `meltProofsIdempotent`, `tryCompleteSwap`, `tryCompleteReceive`, `completeSwap`, or `completeReceive`. Those are `receiveToken`-only inline-completion steps.
- Tests are `bun:test`. Extend the existing `packages/wallet-sdk/src/domains/cashu-receive-ops.test.ts`; reuse its `makeOps` / `cashuAcct` / `sparkAcct` fixtures.
- Commit message prefix: `feat(wallet-sdk): 6d ...`. Base tip for this plan = `cdc569cc`.
- Model: OPUS implementer + OPUS reviewer for Task 1 (`getClaimableToken` error-mapping + module-mock test) and Task 3 (`createTokenClaim` new logic). Sonnet is fine for Task 2 (mechanical mirror of `receiveToken`) and Task 4 (barrel + sdk.test + exports).

---

## File Structure

- **Modify** `packages/wallet-sdk/src/domains/cashu-receive-ops.ts` — add 3 public methods + 3 exported result types + the imports they need. (Tasks 1, 2, 3.)
- **Modify** `packages/wallet-sdk/src/domains/cashu-receive-ops.test.ts` — add a top-of-file `mock.module('@agicash/cashu', …)` (Task 1) and new `describe` blocks for each method. (Tasks 1, 2, 3.)
- **Modify** `packages/wallet-sdk/src/index.ts` — re-export the 3 new result types + the 3 token-flag model types from the barrel. (Task 4.)
- **Modify** `packages/wallet-sdk/src/sdk.test.ts` — assert the 3 new methods are reachable on `sdk.cashu.receive`. (Task 4.)

No `package.json` `exports` change is needed: the barrel (`index.ts`) re-exports via in-package relative paths; consumers import from `@agicash/wallet-sdk`. (Same pattern as the existing `ReceiveTokenResult` re-export.)

---

### Task 1: `getClaimableToken` — claimable-proofs pre-check

Wraps the two pure `@agicash/cashu` helpers (`getUnspentProofsFromToken` — hits the mint; `getClaimableProofs` — pure) into a plain async method, with the app's exact error→reason mapping. Returns the discriminated `{ claimableToken | cannotClaimReason }`; never throws on a mint/offline error (it's a read).

**Files:**
- Modify: `packages/wallet-sdk/src/domains/cashu-receive-ops.ts` (imports + new `ClaimableTokenResult` type + method)
- Test: `packages/wallet-sdk/src/domains/cashu-receive-ops.test.ts` (top-of-file module mock + new describe)

**Interfaces:**
- Consumes: `getUnspentProofsFromToken(token: Token): Promise<Proof[]>`, `getClaimableProofs(proofs: Proof[], pubkeys: string[]): { claimableProofs: Proof[]; cannotClaimReason: null } | { claimableProofs: null; cannotClaimReason: string }` — both from `@agicash/cashu`. `NetworkError`, `Proof`, `Token` from `@cashu/cashu-ts`.
- Produces: `CashuReceiveOps.getClaimableToken(p: { token: Token; cashuPubKey?: string }): Promise<ClaimableTokenResult>` and the exported `ClaimableTokenResult` type.

- [ ] **Step 1: Write the failing test**

At the **very top** of `packages/wallet-sdk/src/domains/cashu-receive-ops.test.ts` (after the existing imports), add the module mock + a mutable holder. ESM `import` statements are hoisted, so `cashu-receive-ops.ts` loads the real `@agicash/cashu` first; `mock.module` then patches the registry/live-bindings. Spreading the real exports keeps `areMintUrlsEqual` (used by the existing `receiveToken` tests via `isClaimingToSameCashuAccount`) intact.

```ts
import * as actualCashu from '@agicash/cashu';
import { NetworkError } from '@cashu/cashu-ts';

// getClaimableToken (Task 1) calls these two @agicash/cashu helpers; swap their
// impls per test. Spread the real module so areMintUrlsEqual etc. stay real for
// the receiveToken tests below.
const cashuStub = {
  getUnspentProofsFromToken: mock(async (_t: unknown): Promise<unknown[]> => []),
  getClaimableProofs: mock((proofs: unknown[], _keys: string[]) => ({
    claimableProofs: proofs,
    cannotClaimReason: null,
  })),
};
mock.module('@agicash/cashu', () => ({
  ...actualCashu,
  getUnspentProofsFromToken: (...a: unknown[]) =>
    (cashuStub.getUnspentProofsFromToken as (...x: unknown[]) => unknown)(...a),
  getClaimableProofs: (...a: unknown[]) =>
    (cashuStub.getClaimableProofs as (...x: unknown[]) => unknown)(...a),
}));
```

Then add a new describe block (anywhere after `makeOps`):

```ts
describe('CashuReceiveOps.getClaimableToken', () => {
  const TOKEN = { mint: 'https://mint.a/', unit: 'sat', proofs: [{ id: 'p1' }] } as any;

  it('returns the token narrowed to claimable proofs', async () => {
    cashuStub.getUnspentProofsFromToken = mock(async () => [{ id: 'p1' }] as any);
    cashuStub.getClaimableProofs = mock(() => ({
      claimableProofs: [{ id: 'p1' }] as any,
      cannotClaimReason: null,
    }));
    const { ops } = makeOps();
    const result = await ops.getClaimableToken({ token: TOKEN });
    expect(result.cannotClaimReason).toBeNull();
    expect(result.claimableToken).toEqual({ ...TOKEN, proofs: [{ id: 'p1' }] });
  });

  it('returns a reason (no throw) when the mint is offline', async () => {
    cashuStub.getUnspentProofsFromToken = mock(async () => {
      throw new NetworkError('down');
    });
    const { ops } = makeOps();
    const result = await ops.getClaimableToken({ token: TOKEN });
    expect(result.claimableToken).toBeNull();
    expect(result.cannotClaimReason).toBe('The mint that issued this ecash is offline');
  });

  it('returns "already been spent" when no proofs are unspent', async () => {
    cashuStub.getUnspentProofsFromToken = mock(async () => []);
    const { ops } = makeOps();
    const result = await ops.getClaimableToken({ token: TOKEN });
    expect(result.cannotClaimReason).toBe('This ecash has already been spent');
  });

  it('returns the not-claimable reason from getClaimableProofs', async () => {
    cashuStub.getUnspentProofsFromToken = mock(async () => [{ id: 'p1' }] as any);
    cashuStub.getClaimableProofs = mock(() => ({
      claimableProofs: null,
      cannotClaimReason: 'You do not have permission to claim this ecash',
    }));
    const { ops } = makeOps();
    const result = await ops.getClaimableToken({ token: TOKEN });
    expect(result.claimableToken).toBeNull();
    expect(result.cannotClaimReason).toBe('You do not have permission to claim this ecash');
  });

  it('maps an unknown error to a generic reason', async () => {
    cashuStub.getUnspentProofsFromToken = mock(async () => {
      throw new Error('boom');
    });
    const { ops } = makeOps();
    const result = await ops.getClaimableToken({ token: TOKEN });
    expect(result.cannotClaimReason).toBe('An error occurred while checking the token');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/wallet-sdk/src/domains/cashu-receive-ops.test.ts -t "getClaimableToken"`
Expected: FAIL — `ops.getClaimableToken is not a function`.

- [ ] **Step 3: Add imports + the method**

In `packages/wallet-sdk/src/domains/cashu-receive-ops.ts`, change the `@cashu/cashu-ts` import (currently `import type { Token } from '@cashu/cashu-ts';`) to add the value import + `Proof`, and add the `@agicash/cashu` import:

```ts
import { NetworkError } from '@cashu/cashu-ts';
import type { Proof, Token } from '@cashu/cashu-ts';
import { getClaimableProofs, getUnspentProofsFromToken } from '@agicash/cashu';
```

Add the exported result type next to `ReceiveTokenResult` (after line 56):

```ts
export type ClaimableTokenResult =
  | { claimableToken: Token; cannotClaimReason: null }
  | { claimableToken: null; cannotClaimReason: string };
```

Add the method to the class (place it just before `receiveToken`, after `get`):

```ts
/**
 * Checks which proofs in a token are unspent at the mint and claimable by this
 * user, returning the token narrowed to claimable proofs — or a reason it cannot
 * be claimed. Does not throw on a mint/offline error; the reason is returned.
 * @param p.cashuPubKey - The user's cashu locking pubkey, for P2PK-locked proofs.
 */
async getClaimableToken(p: {
  token: Token;
  cashuPubKey?: string;
}): Promise<ClaimableTokenResult> {
  let unspentProofs: Proof[];
  try {
    unspentProofs = await getUnspentProofsFromToken(p.token);
  } catch (error) {
    if (error instanceof NetworkError) {
      return {
        claimableToken: null,
        cannotClaimReason: 'The mint that issued this ecash is offline',
      };
    }
    return {
      claimableToken: null,
      cannotClaimReason: 'An error occurred while checking the token',
    };
  }

  if (unspentProofs.length === 0) {
    return {
      claimableToken: null,
      cannotClaimReason: 'This ecash has already been spent',
    };
  }

  const { claimableProofs, cannotClaimReason } = getClaimableProofs(
    unspentProofs,
    p.cashuPubKey ? [p.cashuPubKey] : [],
  );

  return claimableProofs
    ? { claimableToken: { ...p.token, proofs: claimableProofs }, cannotClaimReason: null }
    : { claimableToken: null, cannotClaimReason };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/wallet-sdk/src/domains/cashu-receive-ops.test.ts`
Expected: PASS — the 5 new `getClaimableToken` tests AND all existing `receiveToken` tests (the module mock spread keeps `areMintUrlsEqual` real).

Then: `bun run typecheck`
Expected: 8 packages, exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/wallet-sdk/src/domains/cashu-receive-ops.ts packages/wallet-sdk/src/domains/cashu-receive-ops.test.ts
git commit -m "feat(wallet-sdk): 6d getClaimableToken (claimable-proofs pre-check)"
```

---

### Task 2: `getTokenAccounts` — source/destination/default selection

Mirrors `receiveToken`'s internal account read (`cashu-receive-ops.ts:136-153`) but takes `preferredReceiveAccountId` directly instead of deriving it from `claimTo`, and returns the selection triple instead of claiming. Reads accounts internally (fork c). Surfaces `defaultReceiveAccount: null` when the token cannot be claimed (it's a read — the caller decides; unlike `receiveToken`, it does not throw).

**Files:**
- Modify: `packages/wallet-sdk/src/domains/cashu-receive-ops.ts` (model-type import + `GetTokenAccountsResult` type + method)
- Test: `packages/wallet-sdk/src/domains/cashu-receive-ops.test.ts` (new describe)

**Interfaces:**
- Consumes: `this.requireUser()`, `this.deps.accountRepository.getAllActive(userId)`, `AccountService.getExtendedAccounts(user, accounts)`, `this.deps.receiveTokenService.getSourceAndDestinationAccounts(token, extendedAccounts)`, `ReceiveCashuTokenService.getDefaultReceiveAccount(source, possibleDest, preferredReceiveAccountId?)` — all already imported/injected. The model types `CashuAccountWithTokenFlags` / `ReceiveCashuTokenAccount` from `../internal/services/receive-cashu-token-models`.
- Produces: `CashuReceiveOps.getTokenAccounts(p: { token: Token; preferredReceiveAccountId?: string }): Promise<GetTokenAccountsResult>` and the exported `GetTokenAccountsResult` type.

- [ ] **Step 1: Write the failing test**

Add a new describe block to `cashu-receive-ops.test.ts`:

```ts
describe('CashuReceiveOps.getTokenAccounts', () => {
  const TOKEN = { mint: 'https://mint.a/', proofs: [] } as any;

  it('returns source, possible destinations, and the default receive account', async () => {
    const source = cashuAcct(); // isDefault:true, canReceive:true, mint.a
    const { ops, deps } = makeOps({
      receiveTokenService: {
        getSourceAndDestinationAccounts: mock(async () => ({
          sourceAccount: source,
          possibleDestinationAccounts: [source],
        })),
      },
    });
    const result = await ops.getTokenAccounts({ token: TOKEN });
    expect(result.sourceAccount).toBe(source);
    expect(result.possibleDestinationAccounts).toEqual([source]);
    expect(result.defaultReceiveAccount?.id).toBe('acc-cashu');
    expect(deps.accountRepository.getAllActive).toHaveBeenCalledWith('user-1');
  });

  it('returns a null default when the token cannot be claimed', async () => {
    const { ops } = makeOps({
      receiveTokenService: {
        getSourceAndDestinationAccounts: mock(async () => ({
          sourceAccount: cashuAcct({ canReceive: false }),
          possibleDestinationAccounts: [],
        })),
      },
    });
    const result = await ops.getTokenAccounts({ token: { mint: 'https://x/', proofs: [] } as any });
    expect(result.defaultReceiveAccount).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/wallet-sdk/src/domains/cashu-receive-ops.test.ts -t "getTokenAccounts"`
Expected: FAIL — `ops.getTokenAccounts is not a function`.

- [ ] **Step 3: Add the model-type import, the result type, and the method**

In `cashu-receive-ops.ts`, add the model type import (the value `isClaimingToSameCashuAccount` is already imported from this module at line 13; add a separate `import type` line for the types):

```ts
import type {
  CashuAccountWithTokenFlags,
  ReceiveCashuTokenAccount,
} from '../internal/services/receive-cashu-token-models';
```

Add the exported result type (next to `ClaimableTokenResult`):

```ts
export type GetTokenAccountsResult = {
  sourceAccount: CashuAccountWithTokenFlags;
  possibleDestinationAccounts: ReceiveCashuTokenAccount[];
  defaultReceiveAccount: ReceiveCashuTokenAccount | null;
};
```

Add the method (place it after `getClaimableToken`, before `receiveToken`):

```ts
/**
 * Selects the token's source account, the accounts it can be received into, and
 * the default selection — the read behind an interactive token-receive screen.
 * Reads the user's accounts internally. `defaultReceiveAccount` is null when the
 * token cannot be claimed into any account.
 */
async getTokenAccounts(p: {
  token: Token;
  preferredReceiveAccountId?: string;
}): Promise<GetTokenAccountsResult> {
  const user = await this.requireUser();
  const accounts = await this.deps.accountRepository.getAllActive(user.id);
  const extendedAccounts = AccountService.getExtendedAccounts(user, accounts);

  const { sourceAccount, possibleDestinationAccounts } =
    await this.deps.receiveTokenService.getSourceAndDestinationAccounts(
      p.token,
      extendedAccounts,
    );

  const defaultReceiveAccount = ReceiveCashuTokenService.getDefaultReceiveAccount(
    sourceAccount,
    possibleDestinationAccounts,
    p.preferredReceiveAccountId,
  );

  return { sourceAccount, possibleDestinationAccounts, defaultReceiveAccount };
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test packages/wallet-sdk/src/domains/cashu-receive-ops.test.ts`
Expected: PASS (new + existing).
Run: `bun run typecheck`
Expected: 8 packages, exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/wallet-sdk/src/domains/cashu-receive-ops.ts packages/wallet-sdk/src/domains/cashu-receive-ops.test.ts
git commit -m "feat(wallet-sdk): 6d getTokenAccounts (source/destination/default selection)"
```

---

### Task 3: `createTokenClaim` — create-only claim (the heart)

The create-only sibling of `receiveToken`. Faithful port of the app's inline `claimTokenMutation` (`receive-cashu-token.tsx:147-207`): fold in add-unknown-account (no setDefault), branch on `isClaimingToSameCashuAccount`, return `{ transactionId, account }`. **Stops before melt/complete** — the 4c background processors finalize.

**Files:**
- Modify: `packages/wallet-sdk/src/domains/cashu-receive-ops.ts` (`CreateTokenClaimResult` type + method)
- Test: `packages/wallet-sdk/src/domains/cashu-receive-ops.test.ts` (new describe)

**Interfaces:**
- Consumes: `this.requireUser()`, `this.deps.accountService.addCashuAccount({ userId, account })`, `isClaimingToSameCashuAccount(a, b)`, `this.deps.swapService.create({ userId, token, account })` → `{ swap: { transactionId }; account }`, `this.deps.getExchangeRate(ticker)`, `this.deps.receiveTokenQuoteService.createCrossAccountReceiveQuotes({ userId, token, sourceAccount, destinationAccount, exchangeRate })` → `{ lightningReceiveQuote: { transactionId } }`. Param types `CashuAccountWithTokenFlags` / `ReceiveCashuTokenAccount` (added in Task 2). `Account`, `CashuAccount`, `Ticker` already imported.
- Produces: `CashuReceiveOps.createTokenClaim(p: { token: Token; sourceAccount: CashuAccountWithTokenFlags; destinationAccount: ReceiveCashuTokenAccount }): Promise<CreateTokenClaimResult>` and the exported `CreateTokenClaimResult` type.

- [ ] **Step 1: Write the failing test**

Add a new describe block to `cashu-receive-ops.test.ts`:

```ts
describe('CashuReceiveOps.createTokenClaim', () => {
  const TOKEN = { mint: 'https://mint.a/', proofs: [] } as any;

  it('same-account: creates the swap and returns its transactionId, without completing', async () => {
    const source = cashuAcct({ mintUrl: 'https://mint.a/' });
    const dest = cashuAcct({ id: 'acc-cashu', mintUrl: 'https://mint.a/', isUnknown: false });
    const { ops, deps } = makeOps();
    const result = await ops.createTokenClaim({
      token: TOKEN,
      sourceAccount: source,
      destinationAccount: dest as any,
    });
    expect(result.transactionId).toBe('tx-swap');
    expect(result.account).toBe(dest);
    expect(deps.swapService.create).toHaveBeenCalledTimes(1);
    // create-only: no completion, no melt, no setDefault.
    expect(deps.swapService.completeSwap).not.toHaveBeenCalled();
    expect(source.wallet.meltProofsIdempotent).not.toHaveBeenCalled();
    expect(deps.setDefaultAccount).not.toHaveBeenCalled();
  });

  it('cross-account: creates the quotes and returns the quote transactionId, without melting', async () => {
    const source = cashuAcct({ mintUrl: 'https://mint.a/' });
    const dest = cashuAcct({ id: 'acc-dest', mintUrl: 'https://mint.b/', isUnknown: false });
    const { ops, deps } = makeOps();
    const result = await ops.createTokenClaim({
      token: TOKEN,
      sourceAccount: source,
      destinationAccount: dest as any,
    });
    expect(result.transactionId).toBe('tx-cross');
    expect(result.account).toBe(dest);
    expect(deps.receiveTokenQuoteService.createCrossAccountReceiveQuotes).toHaveBeenCalledTimes(1);
    expect(source.wallet.meltProofsIdempotent).not.toHaveBeenCalled();
    expect(deps.service.completeReceive).not.toHaveBeenCalled();
  });

  it('adds an unknown destination account first, then claims to it', async () => {
    const source = cashuAcct({ mintUrl: 'https://mint.a/' });
    // unknown cashu account on the SAME mint -> after add, same-account branch.
    const dest = cashuAcct({ id: 'acc-placeholder', mintUrl: 'https://mint.a/', isUnknown: true });
    const { ops, deps } = makeOps(); // addCashuAccount mock returns cashuAcct({ id: 'acc-added' }) (mint.a)
    const result = await ops.createTokenClaim({
      token: TOKEN,
      sourceAccount: source,
      destinationAccount: dest as any,
    });
    expect(deps.accountService.addCashuAccount).toHaveBeenCalledTimes(1);
    expect(result.account.id).toBe('acc-added');
    expect(result.transactionId).toBe('tx-swap');
    expect(deps.setDefaultAccount).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/wallet-sdk/src/domains/cashu-receive-ops.test.ts -t "createTokenClaim"`
Expected: FAIL — `ops.createTokenClaim is not a function`.

- [ ] **Step 3: Add the result type + the method**

In `cashu-receive-ops.ts`, add the exported result type (next to the others):

```ts
export type CreateTokenClaimResult = {
  transactionId: string;
  account: Account;
};
```

Add the method (place it after `getTokenAccounts`, before `receiveToken`):

```ts
/**
 * Create-only token claim: adds the destination account if unknown, then persists
 * either a same-account swap or cross-account receive quotes and returns the
 * transaction id. Does NOT melt or complete — the background processors finalize.
 * Does NOT set a default account (matches the interactive app path). Inputs are the
 * already-selected accounts from `getTokenAccounts`.
 */
async createTokenClaim(p: {
  token: Token;
  sourceAccount: CashuAccountWithTokenFlags;
  destinationAccount: ReceiveCashuTokenAccount;
}): Promise<CreateTokenClaimResult> {
  const user = await this.requireUser();

  let account: Account = p.destinationAccount;
  if (p.destinationAccount.isUnknown && p.destinationAccount.type === 'cashu') {
    account = await this.deps.accountService.addCashuAccount({
      userId: user.id,
      account: p.destinationAccount,
    });
  }

  if (isClaimingToSameCashuAccount(account, p.sourceAccount)) {
    const { swap } = await this.deps.swapService.create({
      userId: user.id,
      token: p.token,
      account: account as CashuAccount,
    });
    return { transactionId: swap.transactionId, account };
  }

  const exchangeRate = await this.deps.getExchangeRate(
    `${p.sourceAccount.currency}-${account.currency}` as Ticker,
  );
  const quotes =
    await this.deps.receiveTokenQuoteService.createCrossAccountReceiveQuotes({
      userId: user.id,
      token: p.token,
      sourceAccount: p.sourceAccount,
      destinationAccount: account,
      exchangeRate,
    });
  return { transactionId: quotes.lightningReceiveQuote.transactionId, account };
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `bun test packages/wallet-sdk/src/domains/cashu-receive-ops.test.ts`
Expected: PASS (new + existing).
Run: `bun run typecheck`
Expected: 8 packages, exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/wallet-sdk/src/domains/cashu-receive-ops.ts packages/wallet-sdk/src/domains/cashu-receive-ops.test.ts
git commit -m "feat(wallet-sdk): 6d createTokenClaim (create-only interactive claim)"
```

---

### Task 4: Barrel exports + sdk.test surface assertions + holistic

Make the new return types + token-flag model types public, and assert the methods are reachable on the wired `sdk.cashu.receive`.

**Files:**
- Modify: `packages/wallet-sdk/src/index.ts`
- Modify: `packages/wallet-sdk/src/sdk.test.ts`

**Interfaces:**
- Consumes: the 3 result types from `./domains/cashu-receive-ops` (Tasks 1–3); the 3 model types from `./internal/services/receive-cashu-token-models`.
- Produces: public barrel exports `GetTokenAccountsResult`, `CreateTokenClaimResult`, `ClaimableTokenResult`, `TokenFlags`, `CashuAccountWithTokenFlags`, `ReceiveCashuTokenAccount`.

- [ ] **Step 1: Add the barrel re-exports**

In `packages/wallet-sdk/src/index.ts`, replace the line:

```ts
export type { ReceiveTokenResult } from './domains/cashu-receive-ops';
```

with:

```ts
export type {
  ReceiveTokenResult,
  GetTokenAccountsResult,
  CreateTokenClaimResult,
  ClaimableTokenResult,
} from './domains/cashu-receive-ops';
export type {
  TokenFlags,
  CashuAccountWithTokenFlags,
  ReceiveCashuTokenAccount,
} from './internal/services/receive-cashu-token-models';
```

Then verify `ExtendedSparkAccount` is barrel-exported (it is a constituent of `ReceiveCashuTokenAccount`; `ExtendedCashuAccount` is already exported). Run:

```bash
grep -n "ExtendedSparkAccount\|ExtendedCashuAccount" packages/wallet-sdk/src/index.ts
```

If `ExtendedSparkAccount` is absent, add it alongside the existing `ExtendedCashuAccount` export (same source module). Type aliases are usable without their constituents being exported, so this is ergonomic completeness, not a compile requirement.

- [ ] **Step 2: Add sdk.test surface assertions**

Read `packages/wallet-sdk/src/sdk.test.ts` first to match its construction pattern (how it builds an `sdk` and asserts `sdk.cashu.receive.receiveToken`). Find the existing assertion for `sdk.cashu.receive` methods and add, alongside it, in the same style:

```ts
expect(typeof sdk.cashu.receive.getClaimableToken).toBe('function');
expect(typeof sdk.cashu.receive.getTokenAccounts).toBe('function');
expect(typeof sdk.cashu.receive.createTokenClaim).toBe('function');
```

(If `sdk.test.ts` has no existing `sdk.cashu.receive` method-presence assertion to extend, add a focused `it('exposes the interactive token-receive surface', …)` inside the existing `describe` that constructs the sdk, using that file's existing sdk-construction helper — do not invent a new harness.)

- [ ] **Step 3: Run the full gate**

Run: `bun run typecheck`
Expected: 8 packages, exit 0.
Run: `bun run test`
Expected: full suite exit 0; wallet-sdk count = previous (116) + 10 new (5 getClaimableToken + 2 getTokenAccounts + 3 createTokenClaim) = **126 pass / 0 fail** (sdk.test assertions add to existing tests, not new test count unless a new `it` was added). Total suite green.

- [ ] **Step 4: Commit**

```bash
git add packages/wallet-sdk/src/index.ts packages/wallet-sdk/src/sdk.test.ts
git commit -m "feat(wallet-sdk): 6d barrel-export token-receive types + sdk.test surface"
```

- [ ] **Step 5: Holistic review (OPUS reviewer)**

Dispatch an OPUS quality-reviewer over the whole 6d diff (`git diff cdc569cc..HEAD -- packages/wallet-sdk`). Verify:
- **Boundary:** only `getClaimableToken` / `getTokenAccounts` / `createTokenClaim` + their result types are public; no `Deps`/`sdk.ts` changes; no app-file changes; no TanStack/Sentry/env reads.
- **Create-only:** `createTokenClaim` calls neither `meltProofsIdempotent`, `completeSwap`, `completeReceive`, `tryCompleteSwap`, `tryCompleteReceive`, nor `setDefaultAccount`.
- **Faithful forks:** add-unknown-account folded in (no setDefault); accounts read internally; `getClaimableToken` returns reasons (no throw) and matches the app's three reason strings byte-for-byte.
- **Module mock:** the `mock.module('@agicash/cashu', …)` spread leaves `areMintUrlsEqual` real (existing `receiveToken` tests still pass) — confirm by the green full suite, not by inspection alone.
- Reviewer must NOT run `fix:all`; if pollution appears, `git checkout -- .`.

---

## Self-Review

**1. Spec coverage (the 4 resolved forks):**
- (a) create-only method named `createTokenClaim` → Task 3. ✓
- (b) fold in add-unknown-account, NO setDefault → Task 3 method body + the `not.toHaveBeenCalled()` assertions on `setDefaultAccount`. ✓
- (c) `getTokenAccounts` reads accounts internally → Task 2 (`getAllActive` + `getExtendedAccounts`, asserted via `getAllActive` call). ✓
- (d) expose the claimable-proofs check → Task 1 `getClaimableToken`. ✓
- Public surface + types reachable → Task 4. ✓

**2. Placeholder scan:** none — every code/test step shows full code; commands have expected output.

**3. Type consistency:** `ClaimableTokenResult` (T1), `GetTokenAccountsResult` (T2), `CreateTokenClaimResult` (T3) are defined once in `cashu-receive-ops.ts` and re-exported by the same names in T4. Method names `getClaimableToken` / `getTokenAccounts` / `createTokenClaim` are identical across tasks, tests, barrel, and sdk.test. `Rate = string`, so the cross-account `exchangeRate` argument type matches the service's `exchangeRate: string` param (same as `receiveToken`). The `account: Account` annotation in `createTokenClaim` is satisfied by both `ReceiveCashuTokenAccount` (subtype of `Account`) and `addCashuAccount`'s `CashuAccount` return.

## Deferred — NOT in 6d (carry to the variant phase)

- Rewiring the app's `receive-cashu-token.tsx` / hooks onto this surface — variant web-migration.
- The 4c leader-lifecycle hardening + the 6b `getDefault`/`suggestFor` forward-carries — folded into BOTH variants A & B.
- `ScanDomain` — its own later plan.
