# Spark Integration Plan

Wire Spark wallet support into the agicash CLI. The SDK already has full Spark support (`SparkWallet`, spark send/receive services, quote repos, change handlers, task processors). The CLI just needs to pass the right config and expose the spark services to commands.

## Current State

- `sdk-context.ts` derives `sparkMnemonic` (line 66-77) but does NOT pass `getSparkWalletMnemonic` to `createWalletClient()`
- `SdkContext` type only surfaces cashu services/repos, not spark ones
- `WalletClient` type already has: `sparkSendQuoteService`, `sparkReceiveQuoteService`, `sparkSendQuoteRepo`, `sparkReceiveQuoteRepo`, and all spark task processors/caches
- `balance` command already works with both account types (uses `getAccountBalance()` which handles spark)
- `send`, `pay`, `receive` commands all hardcode `findCashuAccount()` and only use cashu services
- `watch` command already registers spark task processors and event listeners -- no changes needed

## Phase 1: Wire `getSparkWalletMnemonic` into `createWalletClient()`

**File:** `packages/cli/src/sdk-context.ts`

The spark mnemonic is already derived at line 66-77:
```ts
const sparkSeedPath = getSeedPhraseDerivationPath('spark', 12);
// ...
const sparkMnemonic = await keyProvider.getMnemonic({ seed_phrase_derivation_path: sparkSeedPath }).then(({ mnemonic }) => mnemonic);
```

But `createWalletClient()` at line 58-62 does not receive it:
```ts
const wallet = createWalletClient({
  db,
  keyProvider,
  userId,
});
```

**Problem:** `WalletClientConfig` does not have a `getSparkWalletMnemonic` field. The SDK's `createWalletClient()` derives the spark mnemonic internally using the `keyProvider` (see `wallet-client.ts` lines 286-292). So `createWalletClient()` already creates spark services with the mnemonic from the key provider. No config change is needed here.

**However:** The `AccountRepository` constructor (line 294-300 in `wallet-client.ts`) receives `getSparkWalletMnemonic` internally. Since the CLI passes `keyProvider` to `createWalletClient()`, and the wallet client derives the spark mnemonic from the key provider, this is already wired correctly.

**Action:** Verify that `wallet.repos.accountRepo.get()` returns spark accounts with functional `wallet: SparkWallet` instances. If the spark wallet is not online (SDK marks offline wallets as stubs), commands should detect this and report a clear error.

**Estimated effort:** Verification only, no code change needed.

## Phase 2: Expose Spark Services in `SdkContext`

**File:** `packages/cli/src/sdk-context.ts`

Add spark services and repos to the `SdkContext` type and the cached object.

### Changes to `SdkContext` type (line 27-41):

Add these fields:
```ts
export type SdkContext = {
  // ... existing fields ...
  sparkSendQuoteService: WalletClient['services']['sparkSendQuoteService'];
  sparkReceiveQuoteService: WalletClient['services']['sparkReceiveQuoteService'];
  sparkSendQuoteRepo: WalletClient['repos']['sparkSendQuoteRepo'];
  sparkReceiveQuoteRepo: WalletClient['repos']['sparkReceiveQuoteRepo'];
  // ... existing fields ...
};
```

### Changes to the cached object (line 103-119):

Add:
```ts
cached = {
  // ... existing ...
  sparkSendQuoteService: wallet.services.sparkSendQuoteService,
  sparkReceiveQuoteService: wallet.services.sparkReceiveQuoteService,
  sparkSendQuoteRepo: wallet.repos.sparkSendQuoteRepo,
  sparkReceiveQuoteRepo: wallet.repos.sparkReceiveQuoteRepo,
  // ... existing ...
};
```

**Estimated effort:** Small. Additive change, no breakage.

## Phase 3: Add Account Resolution Helpers

Multiple commands duplicate `findCashuAccount()`. Introduce shared helpers that support both account types.

**New file:** `packages/cli/src/commands/account-helpers.ts`

```ts
import type { Account, CashuAccount, SparkAccount } from '@agicash/sdk/features/accounts/account';
import type { SdkContext } from '../sdk-context';

export async function findAccount(
  ctx: SdkContext,
  accountId?: string,
): Promise<Account | undefined> {
  if (accountId) {
    return ctx.accountRepo.get(accountId);
  }
  const accounts = await ctx.accountRepo.getAll(ctx.userId);
  // Prefer spark account for Lightning operations (lower fees, faster)
  return accounts.find((a) => a.type === 'spark') ?? accounts[0];
}

export async function findSparkAccount(
  ctx: SdkContext,
  accountId?: string,
): Promise<SparkAccount | undefined> {
  if (accountId) {
    const account = await ctx.accountRepo.get(accountId);
    return account.type === 'spark' ? account : undefined;
  }
  const accounts = await ctx.accountRepo.getAll(ctx.userId);
  return accounts.find((a): a is SparkAccount => a.type === 'spark');
}

export async function findCashuAccount(
  ctx: SdkContext,
  accountId?: string,
): Promise<CashuAccount | undefined> {
  if (accountId) {
    const account = await ctx.accountRepo.get(accountId);
    return account.type === 'cashu' ? account : undefined;
  }
  const accounts = await ctx.accountRepo.getAll(ctx.userId);
  return accounts.find((a): a is CashuAccount => a.type === 'cashu');
}
```

**Estimated effort:** Small. New file, then update imports in `send.ts`, `pay.ts`, `receive.ts`.

## Phase 4: Update `pay` Command for Spark

**File:** `packages/cli/src/commands/pay.ts`

The `pay` command pays a Lightning invoice. With Spark, this is a direct Lightning payment from the Spark wallet (no cashu melt required).

### Current flow (cashu only):
1. `findCashuAccount()` -- finds cashu account
2. `cashuSendQuoteService.getLightningQuote()` -- gets melt quote from mint
3. `cashuSendQuoteService.createSendQuote()` -- creates quote record
4. Returns quote; `watch` command processes async completion

### New flow (spark path):
1. Resolve account (prefer spark if no `--account` specified, or respect `--account`)
2. If spark account:
   a. `sparkSendQuoteService.getLightningSendQuote({ account, paymentRequest })` -- gets fee estimate
   b. `sparkSendQuoteService.createSendQuote({ userId, account, quote })` -- creates quote
   c. `sparkSendQuoteService.initiateSend({ account, sendQuote })` -- initiates the Lightning payment immediately
   d. Return result with quote state
3. If cashu account: existing flow unchanged

### Key differences:
- `SparkSendQuoteService.getLightningSendQuote()` returns a `SparkLightningQuote` with `estimatedLightningFee`, `estimatedTotalAmount`, `amountRequestedInBtc`
- `SparkSendQuoteService.createSendQuote()` creates the quote in UNPAID state
- `SparkSendQuoteService.initiateSend()` calls `wallet.payLightningInvoice()` and transitions to PENDING
- The spark send quote task processor (in `watch`) handles PENDING -> COMPLETED/FAILED transitions

### Changes to `PayResult`:
Add optional spark-specific fields or make `mint_url` optional (spark has no mint URL).

```ts
export interface PayResult {
  action: string;
  payment?: {
    quote_id: string;
    bolt11: string;
    amount: number;
    fee_estimate: number;  // renamed from fee_reserve for clarity
    currency: string;
    account_id: string;
    account_name: string;
    account_type: 'cashu' | 'spark';  // new
    mint_url?: string;  // optional now (spark has none)
    state: string;
  };
  error?: string;
  code?: string;
}
```

### Implementation:

```ts
export async function handlePayCommand(
  args: ParsedArgs,
  ctx: SdkContext,
): Promise<PayResult> {
  // ... bolt11 validation unchanged ...

  const accountId = args.flags.account as string | undefined;
  const account = await findAccount(ctx, accountId);

  if (!account) {
    return { action: 'error', error: 'No accounts configured.', code: 'NO_ACCOUNT' };
  }

  if (account.type === 'spark') {
    return handleSparkPay(bolt11, account, ctx);
  }
  return handleCashuPay(bolt11, account, ctx);
}

async function handleSparkPay(bolt11: string, account: SparkAccount, ctx: SdkContext): Promise<PayResult> {
  const quote = await ctx.sparkSendQuoteService.getLightningSendQuote({
    account,
    paymentRequest: bolt11,
  });
  const sendQuote = await ctx.sparkSendQuoteService.createSendQuote({
    userId: ctx.userId,
    account,
    quote,
  });
  // Initiate immediately -- the task processor handles completion
  await ctx.sparkSendQuoteService.initiateSend({ account, sendQuote });

  return {
    action: 'created',
    payment: {
      quote_id: sendQuote.id,
      bolt11,
      amount: quote.amountRequestedInBtc.toNumber('sat'),
      fee_estimate: quote.estimatedLightningFee.toNumber('sat'),
      currency: account.currency,
      account_id: account.id,
      account_name: account.name,
      account_type: 'spark',
      state: 'pending',
    },
  };
}
```

**Estimated effort:** Medium. New spark path alongside existing cashu path.

## Phase 5: Update `send` Command for Spark

**File:** `packages/cli/src/commands/send.ts`

The `send` command creates ecash tokens. This is inherently a cashu operation -- Spark does not produce cashu tokens.

### Decision: Keep `send` as cashu-only

The `send` command produces a cashu token string. Spark has no equivalent concept. If a user wants to send sats from Spark, they use `pay` with a Lightning invoice.

**Action:** Improve the error message when only a spark account exists:
```ts
error: 'No cashu accounts configured. The send command creates ecash tokens which requires a cashu account. Run: agicash mint add <url>'
```

**Estimated effort:** Minimal. Error message update only.

## Phase 6: Update `receive` Command for Spark

**File:** `packages/cli/src/commands/receive.ts`

The `receive` command has three modes:
1. `receive <amount>` -- create a Lightning invoice to receive sats
2. `receive <cashu-token>` -- claim a cashu token
3. `receive list` / `receive --check` -- check pending quotes

### Mode 1: `receive <amount>` with Spark

Spark receive creates a Lightning invoice via `SparkWallet.createLightningInvoice()`.

### Current cashu flow:
1. `cashuReceiveQuoteService.getLightningQuote({ wallet, amount })` -- creates mint quote
2. `cashuReceiveQuoteService.createReceiveQuote()` -- stores quote

### New spark flow:
1. Import `getLightningQuote` from `@agicash/sdk/features/receive/spark-receive-quote-core`
2. Call `getLightningQuote({ wallet: account.wallet, amount })` to get `SparkReceiveLightningQuote`
3. Call `sparkReceiveQuoteService.createReceiveQuote({ userId, account, lightningQuote, receiveType: 'LIGHTNING' })` to store the quote
4. Return the invoice from `lightningQuote.invoice.encodedInvoice`

### Changes to `handleReceiveLightning`:

```ts
async function handleReceiveLightning(amount: number, args: ParsedArgs, ctx: SdkContext): Promise<ReceiveResult> {
  const accountId = args.flags.account as string | undefined;

  // Try spark first for Lightning receive (more efficient), fall back to cashu
  const account = await findAccount(ctx, accountId);
  if (!account) {
    return { action: 'error', error: 'No accounts configured.', code: 'NO_ACCOUNT' };
  }

  if (account.type === 'spark') {
    return handleSparkReceiveLightning(amount, account, ctx);
  }
  return handleCashuReceiveLightning(amount, account, ctx);
}
```

### Mode 2: `receive <cashu-token>` -- remains cashu-only

Receiving a cashu token always targets a cashu account (need the same mint). No change.

### Mode 3: `receive list` and `receive --check`

These currently only check cashu receive quotes. Should also check spark receive quotes.

**Changes to `handleListQuotes`:**
- Also call `sparkReceiveQuoteRepo.getPending(ctx.userId)` (need to verify this method exists on the repo)
- Combine results, adding a `type: 'cashu' | 'spark'` field

**Changes to `handleCheckQuote`:**
- Try cashu repo first; if not found, try spark repo
- Spark quotes are completed by the task processor, so checking just returns current state

**Estimated effort:** Medium. New spark receive path, updates to list/check.

## Phase 7: Update Help Text

**File:** `packages/cli/src/main.ts`

Update `HELP_TEXT` to reflect that `pay` and `receive` work with spark accounts:

```ts
commands: {
  // ...
  'pay <invoice>': 'Pay a Lightning invoice. Uses spark account by default, or --account <id> for a specific account',
  'receive <amount>': 'Create a Lightning invoice to receive sats. Uses spark account by default, or --account <id>',
  // ...
}
```

## Phase 8: Update `balance` Output for Spark

**File:** `packages/cli/src/commands/balance.ts`

Currently works, but `proofCount` is hardcoded to 0 for non-cashu accounts. The balance display could also show spark-specific info.

**Minimal changes:**
- Show `ownedBalance` vs `availableBalance` distinction for spark accounts (locked funds in pending transfers)
- The `proofCount` field is cashu-specific; consider renaming to something generic or omitting for spark

```ts
return {
  id: account.id,
  name: account.name,
  type: account.type,
  currency: account.currency,
  mintUrl: account.type === 'cashu' ? account.mintUrl : null,
  balance: balanceNumber,
  proofCount: account.type === 'cashu' ? account.proofs.length : 0,
  // New: show available vs owned for spark (pending transfers lock funds)
  availableBalance: account.type === 'spark' && account.availableBalance
    ? account.availableBalance.toNumber(getCashuUnit(account.currency))
    : undefined,
};
```

**Estimated effort:** Small. Additive fields.

## Implementation Order

| Step | Phase | Effort | Dependencies |
|------|-------|--------|-------------|
| 1 | Phase 1: Verify spark mnemonic wiring | Verify only | None |
| 2 | Phase 2: Expose spark services in SdkContext | Small | None |
| 3 | Phase 3: Account resolution helpers | Small | None |
| 4 | Phase 4: Update `pay` for spark | Medium | Phase 2, 3 |
| 5 | Phase 6: Update `receive` for spark | Medium | Phase 2, 3 |
| 6 | Phase 5: Update `send` error messages | Minimal | None |
| 7 | Phase 7: Update help text | Minimal | Phase 4, 5, 6 |
| 8 | Phase 8: Update `balance` output | Small | None |

Phases 1-3 can be done in a single commit. Phase 4 and 6 are the main work.

## Testing Approach

### Unit verification (no running services):
1. Check `SdkContext` types compile with new spark fields
2. Verify `findAccount()` / `findSparkAccount()` resolve accounts correctly

### Integration testing (requires OpenSecret + Supabase):
1. `agicash auth guest` -- create test account
2. `agicash balance` -- verify spark account appears with type "spark"
3. `agicash pay <testnet-invoice>` -- verify spark pay path (creates quote, initiates send)
4. `agicash receive 100` -- verify spark receive path (creates Lightning invoice)
5. `agicash watch` -- verify spark task processors start and process events
6. `agicash send 10` -- verify clear error when no cashu account exists
7. `agicash receive <cashu-token>` -- verify cashu token receive still works

### Edge cases to test:
- `--account <spark-id>` flag routes to spark path
- `--account <cashu-id>` flag routes to cashu path
- Spark wallet offline (account.isOnline === false) -- should error clearly
- Zero-amount invoices with spark pay
- Expired invoices

## Files Changed Summary

| File | Change Type |
|------|-------------|
| `packages/cli/src/sdk-context.ts` | Modify: add spark services/repos to SdkContext |
| `packages/cli/src/commands/account-helpers.ts` | New: shared account resolution |
| `packages/cli/src/commands/pay.ts` | Modify: add spark pay path |
| `packages/cli/src/commands/receive.ts` | Modify: add spark receive path, update list/check |
| `packages/cli/src/commands/send.ts` | Modify: improve error message |
| `packages/cli/src/commands/balance.ts` | Modify: add availableBalance for spark |
| `packages/cli/src/main.ts` | Modify: update help text |
