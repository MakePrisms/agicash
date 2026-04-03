# Account Management Rethink

Bring the CLI's account model in line with the web app: defaults stored in Supabase via the User model, all account types (cashu + spark) treated uniformly, and a shared resolution helper used by every command.

## Current Problems

1. **`config.ts` `getDefaultAccount()`** reads `default-btc-account` / `default-usd-account` from a local SQLite config table, but no command ever calls it.
2. **`send.ts` / `pay.ts` / `receive.ts`** each define their own `findCashuAccount()` that grabs the first cashu account, ignoring defaults entirely.
3. **Config only knows about two keys** (`default-btc-account`, `default-usd-account`) stored locally -- these are never read and are disconnected from the Supabase User model where the web app stores defaults.
4. **No spark account awareness** in account selection -- every command filters to `type === 'cashu'` and skips spark accounts.
5. **No way to list all accounts** with their default status, or to set defaults in a way that persists to the User model.

## Web App Model (target parity)

Source: `packages/sdk/src/features/user/user.ts`, `account-service.ts`, `receive-cashu-token-service.ts`

- `User` type has `defaultBtcAccountId`, `defaultUsdAccountId`, `defaultCurrency`.
- `AccountService.isDefaultAccount(user, account)` checks if account.id matches the user's default for that currency.
- `AccountService.getExtendedAccounts(user, accounts)` augments each account with `isDefault` flag and sorts defaults first.
- `UserService.setDefaultAccount(user, account, opts)` writes `defaultBtcAccountId` or `defaultUsdAccountId` to Supabase.
- `canSendToLightning(account)` -- spark: always true. Cashu: `!isTestMint && purpose === 'transactional'`.
- `canReceiveFromLightning(account)` -- spark: always true. Cashu: `!isTestMint`.
- `ReceiveCashuTokenService.getSourceAndDestinationAccounts(token, accounts)` determines which accounts can receive a given token.
- `ReceiveCashuTokenService.getDefaultReceiveAccount(source, destinations, preferredId)` picks the best default.
- `ClaimCashuTokenService` auto-sets the default account on claim.

## How the CLI Accesses the User Model

`sdk-context.ts` already calls `WriteUserRepository.upsert()` during init, which creates/updates the user in Supabase. The `WalletClient` exposes `queries.userQuery()` which returns a `FetchQueryOptions<User>` backed by `ReadUserRepository.get(userId)`. The CLI currently never fetches the User after init.

To read/write defaults:
- **Read**: `ctx.wallet.queryClient.fetchQuery(ctx.wallet.queries.userQuery())` returns `User`.
- **Write**: Construct `WriteUserRepository` (needs the Supabase client and accountRepo) + `UserService`, then call `userService.setDefaultAccount(user, account, { setDefaultCurrency: true })`.

Both `WriteUserRepository` and `UserService` are importable from `@agicash/sdk`. The `WalletClient` does not currently expose them as services, so the CLI will need to construct them or the `WalletClient` type needs extending. Constructing them in the CLI is simpler and avoids SDK changes.

---

## Step 1: Add `resolveAccount()` shared helper

Create `packages/cli/src/resolve-account.ts` -- the single account-resolution function used by all commands.

### Behavior

```
resolveAccount(ctx, opts) -> Account | null
  opts: {
    accountId?: string       // from --account flag
    currency?: 'BTC' | 'USD' // from --currency flag or inferred
    preferType?: 'cashu' | 'spark'  // command-level hint
    requireLightning?: boolean  // filter to canSendToLightning / canReceiveFromLightning
  }
```

Resolution order:
1. If `--account <id>` provided, fetch that account directly via `ctx.accountRepo.get(id)`. Return it (or null if not found).
2. Fetch the User from Supabase: `ctx.wallet.queryClient.fetchQuery(ctx.wallet.queries.userQuery())`.
3. Fetch all accounts: `ctx.accountRepo.getAll(ctx.userId)`.
4. Build extended accounts: `AccountService.getExtendedAccounts(user, accounts)`.
5. Filter by `currency` if specified. Filter by `preferType` if specified.
6. If `requireLightning`, filter further with `canSendToLightning` or `canReceiveFromLightning`.
7. Return the first `isDefault === true` account in the filtered set, or the first account if no default matches, or null.

### File changes

**New file: `packages/cli/src/resolve-account.ts`**

```ts
import {
  AccountService,
  type Account,
  type AccountType,
  type Currency,
  canSendToLightning,
  canReceiveFromLightning,
} from '@agicash/sdk';
// exact import paths TBD based on SDK barrel exports
import type { SdkContext } from './sdk-context';

export type ResolveAccountOpts = {
  accountId?: string;
  currency?: Currency;
  preferType?: AccountType;
  requireCanSendLightning?: boolean;
  requireCanReceiveLightning?: boolean;
};

export async function resolveAccount(
  ctx: SdkContext,
  opts: ResolveAccountOpts = {},
): Promise<Account | null> {
  // Explicit --account flag takes priority
  if (opts.accountId) {
    try {
      return await ctx.accountRepo.get(opts.accountId);
    } catch {
      return null;
    }
  }

  // Fetch user + accounts for default resolution
  const user = await ctx.wallet.queryClient.fetchQuery(
    ctx.wallet.queries.userQuery(),
  );
  const accounts = await ctx.accountRepo.getAll(ctx.userId);
  const extended = AccountService.getExtendedAccounts(user, accounts);

  let candidates = extended;

  if (opts.currency) {
    candidates = candidates.filter((a) => a.currency === opts.currency);
  }
  if (opts.preferType) {
    const typed = candidates.filter((a) => a.type === opts.preferType);
    if (typed.length > 0) candidates = typed;
  }
  if (opts.requireCanSendLightning) {
    candidates = candidates.filter((a) => canSendToLightning(a));
  }
  if (opts.requireCanReceiveLightning) {
    candidates = candidates.filter((a) => canReceiveFromLightning(a));
  }

  // Prefer default, fall back to first
  return candidates.find((a) => a.isDefault) ?? candidates[0] ?? null;
}
```

### SdkContext change

`SdkContext` needs the `wallet` object exposed. It currently is -- `sdk-context.ts` line 29: `wallet: WalletClient`. Already available.

---

## Step 2: New `account` command

Create `packages/cli/src/commands/account.ts` and wire it into `main.ts`.

### Subcommands

#### `agicash account list`

- Fetch User + all accounts via `resolveAccount` helpers (reuse the user/accounts fetch pattern).
- Call `AccountService.getExtendedAccounts(user, accounts)`.
- For each, compute balance using `getAccountBalance(account)`.
- Output columns: `id`, `name`, `type` (cashu/spark), `currency`, `balance`, `unit`, `default` (boolean), `mint_url` (cashu only), `purpose`, `is_test_mint` (cashu only).

#### `agicash account default <id>`

- Fetch the account by id.
- Fetch the User.
- Construct `WriteUserRepository` and `UserService`:
  ```ts
  const supabase = getSupabaseClient();
  const writeUserRepo = new WriteUserRepository(supabase, ctx.accountRepo);
  const userService = new UserService(writeUserRepo);
  await userService.setDefaultAccount(user, account, { setDefaultCurrency: true });
  ```
- Return the updated user defaults.

#### `agicash account info <id>`

- Fetch the account by id.
- Fetch the User to determine default status.
- Return detailed info: everything from `account list` plus `canSendToLightning`, `canReceiveFromLightning`, `proof_count` (cashu), `keyset_count` (cashu), `network` (spark), `owned_balance` / `available_balance` (spark).

### File changes

**New file: `packages/cli/src/commands/account.ts`**

Implement `handleAccountCommand(args, ctx)` dispatching to `list`, `default`, `info` subcommands. Import `AccountService`, `UserService`, `WriteUserRepository`, `getAccountBalance`, `canSendToLightning`, `canReceiveFromLightning` from SDK. Import `getSupabaseClient` from `../supabase-client`.

**Edit: `packages/cli/src/main.ts`**

- Add import: `import { handleAccountCommand } from './commands/account';`
- Add case `'account'` in the switch statement (after `'mint'`), following the same pattern as other SDK commands:
  ```ts
  case 'account': {
    getConfiguredDb();
    const result = await withSdkContext(outputOptions, (ctx) =>
      handleAccountCommand(parsed, ctx),
    );
    if (result.action === 'error') {
      printError(result.error ?? '', result.code ?? '', outputOptions);
      process.exit(1);
    }
    printOutput(result, outputOptions);
    break;
  }
  ```
- Update `HELP_TEXT.commands` to add:
  ```
  'account list': 'List all accounts (cashu + spark) with balances and defaults',
  'account default <id>': 'Set an account as the default for its currency',
  'account info <id>': 'Show detailed account info',
  ```

---

## Step 3: Update `send` command

Currently `send` only creates ecash tokens from cashu accounts. The `resolveAccount()` helper lets it pick the right account.

### File changes

**Edit: `packages/cli/src/commands/send.ts`**

1. Replace the local `findCashuAccount()` function with an import of `resolveAccount`.
2. In `handleSendCommand`:
   ```ts
   const account = await resolveAccount(ctx, {
     accountId: args.flags.account as string | undefined,
     currency: (args.flags.currency as string)?.toUpperCase() as Currency | undefined,
     preferType: 'cashu', // send creates ecash tokens, so prefer cashu
   });
   ```
3. After resolution, verify `account.type === 'cashu'`. If spark, return an error: `"Send (ecash token) requires a cashu account. Use pay for Lightning payments from spark."` (Spark send-to-Lightning is the `pay` command's job.)
4. Remove the local `findCashuAccount()` function entirely.
5. Update the error message for no-account to mention `agicash account list` alongside `agicash mint add`.

---

## Step 4: Update `pay` command

Currently `pay` only works with cashu accounts (melt proofs to pay Lightning). With `resolveAccount()` it can prefer spark for Lightning payments.

### File changes

**Edit: `packages/cli/src/commands/pay.ts`**

1. Replace local `findCashuAccount()` with `resolveAccount`:
   ```ts
   const account = await resolveAccount(ctx, {
     accountId: args.flags.account as string | undefined,
     preferType: 'spark', // spark is more natural for Lightning payments
     requireCanSendLightning: true,
   });
   ```
2. Branch on account type:
   - **Cashu**: keep existing melt flow (create send quote via `cashuSendQuoteService`).
   - **Spark**: use `ctx.wallet.services.sparkSendQuoteService` to create a Lightning payment. This is new functionality -- check SDK's `SparkSendQuoteService` API for the right method. The web app already has this flow.
3. Validate with `canSendToLightning(account)` after resolution -- if false, return error explaining why (test mint, gift-card purpose, etc.).
4. Remove the local `findCashuAccount()` function.

### Spark send support (new)

Check how the web app creates spark Lightning sends. The SDK has `SparkSendQuoteService` exposed at `ctx.wallet.services.sparkSendQuoteService`. Add a `handleSparkPay(account, bolt11, ctx)` helper inside `pay.ts` that:
- Creates a spark send quote
- Returns the quote details in the same `PayResult` shape

This requires reading `packages/sdk/src/features/send/spark-send-quote-service.ts` for the API.

### SdkContext change

**Edit: `packages/cli/src/sdk-context.ts`**

Add `sparkSendQuoteService` and `sparkReceiveQuoteService` to the `SdkContext` type and the cached object:
```ts
sparkSendQuoteService: WalletClient['services']['sparkSendQuoteService'];
sparkReceiveQuoteService: WalletClient['services']['sparkReceiveQuoteService'];
```

---

## Step 5: Update `receive` command

The receive command needs to handle three flows: Lightning receive, ecash token receive (same-mint), and ecash token receive (cross-mint via melt+mint).

### File changes

**Edit: `packages/cli/src/commands/receive.ts`**

1. **Lightning receive (`handleReceiveLightning`)**: Replace local `findCashuAccount()` with:
   ```ts
   const account = await resolveAccount(ctx, {
     accountId: args.flags.account as string | undefined,
     requireCanReceiveLightning: true,
   });
   ```
   This now works with both cashu and spark accounts. For spark accounts, use `ctx.wallet.services.sparkReceiveQuoteService` to create the invoice instead of the cashu receive quote service.

2. **Token receive (`handleReceiveToken`)**: Use the SDK's `ReceiveCashuTokenService.getSourceAndDestinationAccounts()` to determine selectable accounts:
   ```ts
   const user = await ctx.wallet.queryClient.fetchQuery(
     ctx.wallet.queries.userQuery(),
   );
   const accounts = await ctx.accountRepo.getAll(ctx.userId);
   const extended = AccountService.getExtendedAccounts(user, accounts);
   const { sourceAccount, possibleDestinationAccounts } =
     await ctx.receiveCashuTokenService.getSourceAndDestinationAccounts(token, extended);
   ```
   Then use `ReceiveCashuTokenService.getDefaultReceiveAccount()` to pick the default, or use `--account` flag to override.

   If the chosen destination is different from the source (cross-account), the CLI needs to handle the melt+mint flow. This is what `ClaimCashuTokenService.claimToken()` does in the web app. For now, the simplest approach is to expose `ClaimCashuTokenService` or replicate its logic.

3. Remove all three local `findCashuAccount*` functions.

### New SdkContext dependency

The `ReceiveCashuTokenService` needs a `Cache`, a `getFeatureFlag` function, and a `MintValidator`. These are web-app concerns. For the CLI:
- `getFeatureFlag`: return `false` for all flags (no gated features in CLI).
- `MintValidator`: return `true` (accept all mints the SDK accepts).
- `Cache`: use `queryClientAsCache(ctx.wallet.queryClient)`.

Alternatively, construct `ReceiveCashuTokenService` in `sdk-context.ts` and expose it on `SdkContext`.

**Edit: `packages/cli/src/sdk-context.ts`**

Add to `SdkContext`:
```ts
receiveCashuTokenService: ReceiveCashuTokenService;
```

Construct it during init:
```ts
import { ReceiveCashuTokenService } from '@agicash/sdk/features/receive/receive-cashu-token-service';

const receiveCashuTokenService = new ReceiveCashuTokenService(
  cache,
  () => false,  // no feature flags in CLI
  () => true,   // accept all mints
);
```

---

## Step 6: Extend `decode` command

Add `selectable_accounts` to decode output for cashu tokens, making it agent-friendly (decode, pick account, receive).

### File changes

**Edit: `packages/cli/src/commands/decode.ts`**

1. Make `handleDecodeCommand` accept `SdkContext | undefined` as a second parameter (it currently takes only `args`). Pass `undefined` when called without auth (it is in `MODE_BYPASS_COMMANDS`).
2. For cashu token decoding, when `ctx` is available:
   - Fetch user + accounts + extended accounts.
   - Call `receiveCashuTokenService.getSourceAndDestinationAccounts(token, extended)`.
   - Call `ReceiveCashuTokenService.getDefaultReceiveAccount(source, destinations)`.
   - Add to the output `data`:
     ```ts
     selectable_accounts: possibleDestinationAccounts.map(a => ({
       id: a.id,
       name: a.name,
       type: a.type,
       currency: a.currency,
       is_default: a.isDefault,
       can_receive: a.canReceive,
     })),
     default_receive_account_id: defaultReceiveAccount?.id ?? null,
     ```
3. When `ctx` is not available (no auth), skip the selectable_accounts field -- just return the basic decode output as today.

**Edit: `packages/cli/src/main.ts`**

Update the `decode` case to conditionally pass SdkContext:
```ts
case 'decode': {
  let ctx: SdkContext | undefined;
  try {
    getConfiguredDb();
    ctx = await getSdkContext();
  } catch {
    // No auth -- decode works without it, just without selectable_accounts
  }
  const result = await handleDecodeCommand(parsed, ctx);
  if (ctx) await cleanupSdkContext(ctx);
  // ... rest unchanged
}
```

---

## Step 7: Remove/migrate old config approach

### What to remove

- **`config.ts` `getDefaultAccount()`**: Dead code. No caller. Delete the function.
- **`config set` valid keys**: Remove `default-btc-account` and `default-usd-account` from the `validKeys` array -- defaults are now managed via `agicash account default <id>` which writes to Supabase.
- **Keep `config` command itself**: It is still useful for other future config keys. But with no valid keys remaining, it becomes a no-op for now. Either:
  - (a) Remove the `config` command entirely and delete `config.ts`. Update `main.ts` and `HELP_TEXT`.
  - (b) Keep it as a skeleton for future local config keys (e.g., `default-output-format`, `default-currency`).

  Recommendation: **(a) Remove it.** Add it back when there are real local config keys. The SQLite `config` table can remain in the DB schema (harmless), but the command surface should not advertise features that do nothing.

### What to add to help text

Update `HELP_TEXT` in `main.ts`:
- Remove `config`, `config get`, `config set`, `config list` entries.
- Add `account list`, `account default <id>`, `account info <id>` entries (already done in Step 2).

### File changes

**Delete or gut: `packages/cli/src/commands/config.ts`**

If keeping the file: remove `getDefaultAccount()`, remove the `default-btc-account` / `default-usd-account` entries from `validKeys`. If removing entirely: delete the file.

**Edit: `packages/cli/src/main.ts`**

- Remove `import { handleConfigCommand } from './commands/config';`
- Remove the `case 'config':` block from the switch.
- Remove config entries from `HELP_TEXT.commands`.

**Edit: `packages/cli/src/db.ts`** (if it creates the config table)

Leave the config table creation in place -- removing it could break existing installs. Just stop using it.

---

## Implementation Order

| Phase | Steps | Unblocks |
|-------|-------|----------|
| **A** | Step 1 (resolveAccount helper) + Step 2 (account command) | Everything else |
| **B** | Step 3 (send) + Step 4 (pay) + Step 7 (remove config) | Can ship independently |
| **C** | Step 5 (receive) | Needs ReceiveCashuTokenService in SdkContext |
| **D** | Step 6 (decode) | Needs Phase C for receiveCashuTokenService |

Phase A is the foundation. Phases B, C, D can proceed in parallel after A, though C and D share the `receiveCashuTokenService` dependency on SdkContext.

## Files Changed Summary

| File | Action | Step |
|------|--------|------|
| `packages/cli/src/resolve-account.ts` | **Create** | 1 |
| `packages/cli/src/commands/account.ts` | **Create** | 2 |
| `packages/cli/src/main.ts` | Edit (add account cmd, remove config cmd, update help) | 2, 6, 7 |
| `packages/cli/src/commands/send.ts` | Edit (use resolveAccount, remove findCashuAccount) | 3 |
| `packages/cli/src/commands/pay.ts` | Edit (use resolveAccount, add spark pay, remove findCashuAccount) | 4 |
| `packages/cli/src/sdk-context.ts` | Edit (add sparkSendQuoteService, sparkReceiveQuoteService, receiveCashuTokenService) | 4, 5 |
| `packages/cli/src/commands/receive.ts` | Edit (use resolveAccount, use getSourceAndDestinationAccounts, remove findCashuAccount*) | 5 |
| `packages/cli/src/commands/decode.ts` | Edit (accept SdkContext, add selectable_accounts) | 6 |
| `packages/cli/src/commands/config.ts` | **Delete** (or gut) | 7 |

## Open Questions

1. **Spark send in pay command**: Need to read `SparkSendQuoteService` API to know exact method signature. The web app's send flow likely goes through task processors -- should the CLI do the same, or call the service directly and let `watch` handle completion?

2. **Cross-account token receive**: The full `ClaimCashuTokenService` flow is complex (melt on source mint, mint on destination). Should the CLI replicate this, or expose `ClaimCashuTokenService` as a convenience? The service has many dependencies (cache, repos, services, exchange rate fetcher). Constructing it in the CLI is viable but verbose.

3. **`balance` command**: Currently shows all accounts but does not indicate defaults. Should it also call `getExtendedAccounts()` and show the `default` flag? Low effort, high value -- worth doing alongside Phase A.

4. **`mint list` vs `account list`**: With `account list` showing all accounts, `mint list` becomes redundant (it only shows cashu accounts). Keep `mint list` as an alias/filter (`account list --type cashu`) or deprecate it?
