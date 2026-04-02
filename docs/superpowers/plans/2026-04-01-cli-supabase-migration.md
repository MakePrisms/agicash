# CLI SQLite → Supabase Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CLI's local SQLite storage for accounts/proofs/quotes with the SDK's service + repository layer backed by Supabase, so the CLI shares the same data as the web app.

**Architecture:** Create an `sdk-context.ts` module that lazily constructs the SDK dependency chain (AgicashDb → Encryption → Cache → CashuCryptography → Repositories → Services). CLI commands call **services** (not repositories directly) for business logic — the same layer the web app's React hooks call. Auth (`auth guest` or `auth login`) is required before any Supabase-backed command. Local SQLite survives only for OpenSecret tokens (`kv_store`) and CLI config (`config` table).

**Key principle:** The CLI is an orchestration layer (same role as React hooks). It calls existing SDK services and handles CLI-specific I/O. No new business logic in the CLI.

**Tech Stack:** `@agicash/sdk` (services, repositories, encryption, types), `@supabase/supabase-js`, `@agicash/opensecret-sdk`

**Branch:** `agicash-cli` (existing)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/cli/src/sdk-context.ts` | Create | Lazy SDK dependency factory: AgicashDb, Encryption, Cache, CashuCryptography, Repos, Services, userId |
| `packages/cli/src/commands/mint.ts` | Rewrite | Use `AccountService.addCashuAccount()` / `AccountRepository.getAll()` |
| `packages/cli/src/commands/balance.ts` | Rewrite | Use `AccountRepository.getAll()` → `getAccountBalance()` |
| `packages/cli/src/commands/receive.ts` | Rewrite | Use `CashuReceiveQuoteService` + `CashuReceiveSwapService` |
| `packages/cli/src/commands/send.ts` | Rewrite | Use `CashuSendSwapService` |
| `packages/cli/src/commands/pay.ts` | Rewrite | Use `CashuSendQuoteService` |
| `packages/cli/src/main.ts` | Modify | Pass SDK context instead of DB to commands |
| `packages/cli/src/db.ts` | Modify | Remove `accounts`, `cashu_proofs`, `mint_quotes` tables |
| `packages/cli/src/supabase-client.ts` | Modify | Type client as `AgicashDb` using SDK's `Database` type |

---

## Reference: SDK Service Layer

### Service dependency chain
```
KeyProvider (CLI has this)
  → CashuCryptography = getCashuCryptography(keyProvider, cache)
  → Encryption = getEncryption(privateKeyBytes, publicKeyHex)

AgicashDb (Supabase client)
  → AccountRepository(db, encryption, cache, getCashuWalletSeed, getSparkMnemonic)
    → AccountService(accountRepo)
  → CashuReceiveQuoteRepository(db, encryption, accountRepo)
    → CashuReceiveQuoteService(cashuCryptography, cashuReceiveQuoteRepo)
  → CashuReceiveSwapRepository(db, encryption, accountRepo)
    → CashuReceiveSwapService(cashuReceiveSwapRepo)
  → CashuSendQuoteRepository(db, encryption)
    → CashuSendQuoteService(cashuSendQuoteRepo)
  → CashuSendSwapRepository(db, encryption)
    → CashuSendSwapService(cashuSendSwapRepo, cashuReceiveSwapService)
```

### Command → Service mapping

| CLI Command | SDK Service | Methods |
|---|---|---|
| `mint add` | `AccountService` | `.addCashuAccount({ userId, account })` |
| `mint list` | `AccountRepository` | `.getAll(userId)` (simple CRUD, repo is fine) |
| `balance` | `AccountRepository` | `.getAll(userId)` → `getAccountBalance()` |
| `receive <amount>` | `CashuReceiveQuoteService` | `.getLightningQuote()` → `.createReceiveQuote()` → `.completeReceive()` |
| `receive <token>` | `CashuReceiveSwapService` | `.create()` → `.completeSwap()` |
| `send <amount>` | `CashuSendSwapService` | `.getQuote()` → `.create()` → `.swapForProofsToSend()` → `.complete()` |
| `pay <bolt11>` | `CashuSendQuoteService` | `.getLightningQuote()` → `.createSendQuote()` → `.initiateSend()` → `.completeSendQuote()` |

### Key derivation paths (must match web app exactly)
```
Encryption: m/10111099'/0'  ("enc" in ASCII)
Cashu seed: m/83696968'/39'/0'/12'/0'  (BIP-85, cashu index 0)
Spark seed: m/83696968'/39'/0'/12'/1'  (BIP-85, spark index 1)
```

---

### Task 1: Create SDK Context Module

**Files:**
- Create: `packages/cli/src/sdk-context.ts`
- Modify: `packages/cli/src/supabase-client.ts`

The SDK context lazily creates the full dependency chain and caches it.

- [ ] **Step 1: Update supabase-client.ts to use SDK's Database type**

Replace the `any` generics with the SDK's `Database` type:
```typescript
import type { Database } from '@agicash/sdk/db/database';
// ...
cachedClient = createClient<Database, 'wallet', 'wallet'>(env.url, env.anonKey, { ... });
```

- [ ] **Step 2: Create sdk-context.ts**

```typescript
// packages/cli/src/sdk-context.ts
import { hexToBytes } from '@noble/hashes/utils';
import { fetchUser, isConfigured } from '@agicash/opensecret-sdk';
import { AccountRepository } from '@agicash/sdk/features/accounts/account-repository';
import { AccountService } from '@agicash/sdk/features/accounts/account-service';
import { getSeedPhraseDerivationPath } from '@agicash/sdk/features/accounts/account-cryptography';
import { CashuReceiveQuoteRepository } from '@agicash/sdk/features/receive/cashu-receive-quote-repository';
import { CashuReceiveQuoteService } from '@agicash/sdk/features/receive/cashu-receive-quote-service';
import { CashuReceiveSwapRepository } from '@agicash/sdk/features/receive/cashu-receive-swap-repository';
import { CashuReceiveSwapService } from '@agicash/sdk/features/receive/cashu-receive-swap-service';
import { CashuSendQuoteRepository } from '@agicash/sdk/features/send/cashu-send-quote-repository';
import { CashuSendQuoteService } from '@agicash/sdk/features/send/cashu-send-quote-service';
import { CashuSendSwapRepository } from '@agicash/sdk/features/send/cashu-send-swap-repository';
import { CashuSendSwapService } from '@agicash/sdk/features/send/cashu-send-swap-service';
import { TransactionRepository } from '@agicash/sdk/features/transactions/transaction-repository';
import { getEncryption } from '@agicash/sdk/features/shared/encryption';
import { getCashuCryptography } from '@agicash/sdk/features/shared/cashu';
import type { Cache } from '@agicash/sdk/interfaces/cache';
import { mnemonicToSeedSync } from '@scure/bip39';
import { getKeyProvider } from './key-provider';
import { getSupabaseClient } from './supabase-client';

export type SdkContext = {
  userId: string;
  // Services (business logic — CLI calls these)
  accountService: AccountService;
  cashuReceiveQuoteService: CashuReceiveQuoteService;
  cashuReceiveSwapService: CashuReceiveSwapService;
  cashuSendQuoteService: CashuSendQuoteService;
  cashuSendSwapService: CashuSendSwapService;
  // Repos exposed for simple CRUD (balance, list)
  accountRepo: AccountRepository;
  transactionRepo: TransactionRepository;
  // Shared
  cache: Cache;
};

const cache: Cache = {
  fetchQuery: async ({ queryFn }) => queryFn(),
};

let cached: SdkContext | null = null;

export async function getSdkContext(): Promise<SdkContext> {
  if (cached) return cached;

  if (!isConfigured()) {
    throw new Error(
      'Not configured. Set OPENSECRET_CLIENT_ID and SUPABASE_URL in .env',
    );
  }

  const { user } = await fetchUser();
  const userId = user.id;
  const db = getSupabaseClient();
  const keyProvider = getKeyProvider();

  // Encryption
  const encryptionKeyPath = "m/10111099'/0'";
  const [{ private_key }, { public_key }] = await Promise.all([
    keyProvider.getPrivateKeyBytes({ private_key_derivation_path: encryptionKeyPath }),
    keyProvider.getPublicKey('schnorr', { private_key_derivation_path: encryptionKeyPath }),
  ]);
  const encryption = getEncryption(hexToBytes(private_key), public_key);

  // CashuCryptography (needed by receive quote service)
  const cashuCrypto = getCashuCryptography(keyProvider, cache);

  // Seed/mnemonic factories for AccountRepository
  const cashuSeedPath = getSeedPhraseDerivationPath('cashu', 12);
  const getCashuWalletSeed = async () => {
    const { mnemonic } = await keyProvider.getMnemonic({ seed_phrase_derivation_path: cashuSeedPath });
    return mnemonicToSeedSync(mnemonic);
  };
  const sparkSeedPath = getSeedPhraseDerivationPath('spark', 12);
  const getSparkWalletMnemonic = async () => {
    const { mnemonic } = await keyProvider.getMnemonic({ seed_phrase_derivation_path: sparkSeedPath });
    return mnemonic;
  };

  // Repositories
  const accountRepo = new AccountRepository(db, encryption, cache, getCashuWalletSeed, getSparkWalletMnemonic);
  const cashuReceiveQuoteRepo = new CashuReceiveQuoteRepository(db, encryption, accountRepo);
  const cashuReceiveSwapRepo = new CashuReceiveSwapRepository(db, encryption, accountRepo);
  const cashuSendQuoteRepo = new CashuSendQuoteRepository(db, encryption);
  const cashuSendSwapRepo = new CashuSendSwapRepository(db, encryption);
  const transactionRepo = new TransactionRepository(db, encryption);

  // Services
  const accountService = new AccountService(accountRepo);
  const cashuReceiveQuoteService = new CashuReceiveQuoteService(cashuCrypto, cashuReceiveQuoteRepo);
  const cashuReceiveSwapService = new CashuReceiveSwapService(cashuReceiveSwapRepo);
  const cashuSendQuoteService = new CashuSendQuoteService(cashuSendQuoteRepo);
  const cashuSendSwapService = new CashuSendSwapService(cashuSendSwapRepo, cashuReceiveSwapService);

  cached = {
    userId,
    accountService,
    cashuReceiveQuoteService,
    cashuReceiveSwapService,
    cashuSendQuoteService,
    cashuSendSwapService,
    accountRepo,
    transactionRepo,
    cache,
  };

  return cached;
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/claude/agicash && bunx tsc --noEmit --project packages/cli/tsconfig.json 2>&1 | grep -v TS6059`

Fix any import path or type mismatches. The worker MUST read the actual SDK source to resolve any issues — do not guess at types.

- [ ] **Step 4: Commit**

```bash
cd /Users/claude/agicash
git add packages/cli/src/sdk-context.ts packages/cli/src/supabase-client.ts
git commit -m "feat(cli): add SDK context with services and repository factory"
```

---

### Task 2: Migrate `mint` and `balance` Commands

**Files:**
- Rewrite: `packages/cli/src/commands/mint.ts`
- Rewrite: `packages/cli/src/commands/balance.ts`
- Modify: `packages/cli/src/main.ts`

These are simple CRUD commands — `mint add` uses `AccountService.addCashuAccount()`, `mint list` and `balance` use `AccountRepository.getAll()`.

- [ ] **Step 1: Read the AccountService source**

The worker MUST read `packages/sdk/src/features/accounts/account-service.ts` to understand `addCashuAccount()` params exactly. Also read the `Account` and `CashuAccount` types from `packages/sdk/src/features/accounts/account.ts`.

- [ ] **Step 2: Rewrite mint.ts**

Change `handleMintCommand(args, db)` → `handleMintCommand(args, ctx: SdkContext)`.

For `mint add`: call `ctx.accountService.addCashuAccount({ userId: ctx.userId, account: { name, type: 'cashu', currency, purpose: 'transactional', mintUrl, keysetCounters: {} } })`.

For `mint list`: call `ctx.accountRepo.getAll(ctx.userId)`, filter for cashu, map to output shape.

Keep the mint reachability check (CashuMint.getInfo()) before creating the account.

- [ ] **Step 3: Rewrite balance.ts**

Change `handleBalanceCommand(db)` → `handleBalanceCommand(ctx: SdkContext): Promise<BalanceResult>`.

Call `ctx.accountRepo.getAll(ctx.userId)`, use `getAccountBalance()` from `@agicash/sdk/features/accounts/account` to get each account's balance.

- [ ] **Step 4: Update main.ts**

Add a shared `requireSdkContext()` helper to main.ts that wraps `getSdkContext()` with a user-friendly auth error. Update `mint`, `balance` cases to use it.

```typescript
import { getSdkContext, type SdkContext } from './sdk-context';

async function requireSdkContext(outputOptions: OutputOptions): Promise<SdkContext> {
  try {
    return await getSdkContext();
  } catch (err) {
    printError(
      `Auth required. Run: agicash auth guest\n${err instanceof Error ? err.message : ''}`,
      'AUTH_REQUIRED',
      outputOptions,
    );
    process.exit(1);
  }
}
```

- [ ] **Step 5: Verify it compiles and tests pass**

Run: `cd /Users/claude/agicash && bunx tsc --noEmit --project packages/cli/tsconfig.json 2>&1 | grep -v TS6059`
Run: `cd /Users/claude/agicash/packages/cli && bun test`

- [ ] **Step 6: Commit**

```bash
cd /Users/claude/agicash
git add packages/cli/src/commands/mint.ts packages/cli/src/commands/balance.ts packages/cli/src/main.ts
git commit -m "feat(cli): migrate mint and balance commands to SDK services"
```

---

### Task 3: Migrate `receive` Command

**Files:**
- Rewrite: `packages/cli/src/commands/receive.ts`
- Modify: `packages/cli/src/main.ts`

This is the most complex migration. Three paths:
1. `receive <amount>` — Lightning receive via `CashuReceiveQuoteService`
2. `receive <token>` — Token claim via `CashuReceiveSwapService`
3. `receive list` / `--check-all` — Query pending quotes

- [ ] **Step 1: Read the service sources**

The worker MUST read these files thoroughly before writing any code:
- `packages/sdk/src/features/receive/cashu-receive-quote-service.ts` — full file
- `packages/sdk/src/features/receive/cashu-receive-swap-service.ts` — full file
- `packages/sdk/src/features/shared/cashu.ts` — `getInitializedCashuWallet()` function

Understand the exact flow: getLightningQuote → createReceiveQuote → (wait for payment) → completeReceive.

- [ ] **Step 2: Rewrite receive.ts**

**Lightning receive (`receive <amount>`):**
1. Get account via `ctx.accountRepo.get(accountId)` or first cashu account from `getAll`
2. Account must be a `CashuAccount` with an initialized wallet
3. Call `ctx.cashuReceiveQuoteService.getLightningQuote({ wallet: account.wallet, amount: Money.fromSats(amount) })`
4. Call `ctx.cashuReceiveQuoteService.createReceiveQuote({ userId, account, lightningQuote, receiveType: 'LIGHTNING' })`
5. If `--wait`: poll via `wallet.checkMintQuoteBolt11()`, then `ctx.cashuReceiveQuoteService.completeReceive(account, quote)`

**Token receive (`receive <token>`):**
1. Parse token with `getDecodedToken()`
2. Find account for the token's mint
3. Call `ctx.cashuReceiveSwapService.create({ userId, token, account })`
4. Call `ctx.cashuReceiveSwapService.completeSwap(account, swap)`

**List/check-all:** Use `ctx.cashuReceiveQuoteRepo` (exposed via `ctx.accountRepo` or add to context if needed) or query pending quotes from Supabase directly.

Note: `receive list` and `--check-all` may need the `CashuReceiveQuoteRepository` exposed on the context. Add it to `SdkContext` if needed.

- [ ] **Step 3: Update main.ts receive case**

- [ ] **Step 4: Verify and test**

- [ ] **Step 5: Commit**

```bash
cd /Users/claude/agicash
git add packages/cli/src/commands/receive.ts packages/cli/src/main.ts packages/cli/src/sdk-context.ts
git commit -m "feat(cli): migrate receive command to SDK services"
```

---

### Task 4: Migrate `send` and `pay` Commands

**Files:**
- Rewrite: `packages/cli/src/commands/send.ts`
- Rewrite: `packages/cli/src/commands/pay.ts`
- Modify: `packages/cli/src/main.ts`

- [ ] **Step 1: Read the service sources**

The worker MUST read:
- `packages/sdk/src/features/send/cashu-send-swap-service.ts` — for `send` (ecash tokens)
- `packages/sdk/src/features/send/cashu-send-quote-service.ts` — for `pay` (Lightning)

- [ ] **Step 2: Rewrite send.ts**

**Send ecash (`send <amount>`):**
1. Get cashu account
2. `ctx.cashuSendSwapService.getQuote({ account, amount: Money.fromSats(amount), senderPaysFee: true })`
3. `ctx.cashuSendSwapService.create({ userId, account, amount, senderPaysFee: true })`
4. `ctx.cashuSendSwapService.swapForProofsToSend({ account, swap })`
5. Encode token from swap's `proofsToSend`
6. `ctx.cashuSendSwapService.complete(swap)`
7. Return the cashu token string

- [ ] **Step 3: Rewrite pay.ts**

**Pay Lightning (`pay <bolt11>`):**
1. Get cashu account
2. `ctx.cashuSendQuoteService.getLightningQuote({ account, paymentRequest: bolt11 })`
3. `ctx.cashuSendQuoteService.createSendQuote({ userId, account, sendQuote: lightningQuote })`
4. `ctx.cashuSendQuoteService.initiateSend(account, sendQuote, meltQuote)`
5. `ctx.cashuSendQuoteService.completeSendQuote(account, sendQuote, meltQuote)`

- [ ] **Step 4: Update main.ts send/pay cases**

- [ ] **Step 5: Verify and test**

- [ ] **Step 6: Commit**

```bash
cd /Users/claude/agicash
git add packages/cli/src/commands/send.ts packages/cli/src/commands/pay.ts packages/cli/src/main.ts
git commit -m "feat(cli): migrate send and pay commands to SDK services"
```

---

### Task 5: Clean Up Local SQLite and Unused Files

**Files:**
- Modify: `packages/cli/src/db.ts`
- Delete: `packages/cli/src/wallet-factory.ts`, `packages/cli/src/counter-store.ts`
- Clean up: unused imports across all command files

- [ ] **Step 1: Remove unused SQLite tables from db.ts**

Keep only `config` and `kv_store` tables in `migrate()`. Remove `accounts`, `cashu_proofs`, `mint_quotes`.

- [ ] **Step 2: Delete wallet-factory.ts and counter-store.ts**

These are replaced by the SDK's wallet initialization (`getInitializedCashuWallet`) and repository-managed counters.

- [ ] **Step 3: Clean up imports**

Remove all `bun:sqlite` imports from command files. Remove `withTransaction` usage. Only `auth.ts`, `config.ts`, and `main.ts` should import from `db.ts`.

- [ ] **Step 4: Run full test suite**

Run: `cd /Users/claude/agicash/packages/cli && bun test`

Update or remove tests that relied on local SQLite tables for accounts/proofs. The auth and supabase-client tests should still pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/claude/agicash
git add -A packages/cli/src/
git commit -m "chore(cli): remove SQLite tables and files replaced by SDK"
```

---

### Task 6: Smoke Test

Manual E2E verification.

- [ ] **Step 1:** `rm -f ~/.agicash/agicash.db` (clean slate)
- [ ] **Step 2:** `bun run dev auth guest --pretty` → guest account created
- [ ] **Step 3:** `bun run dev mint add https://testnut.cashu.space --pretty` → account in Supabase
- [ ] **Step 4:** `bun run dev balance --pretty` → shows 0 balance
- [ ] **Step 5:** `bun run dev receive 21 --wait --pretty` → invoice, mint, proofs in Supabase
- [ ] **Step 6:** `bun run dev send 10 --pretty` → ecash token
- [ ] **Step 7:** `bun run dev balance --pretty` → reflects send
- [ ] **Step 8:** Verify account + proofs visible in Supabase (via MCP or web app)

---

## Critical Rule

**Do NOT modify SDK service or repository files.** The CLI consumes the SDK as-is. If a service method doesn't fit the CLI's needs, flag it and ask before changing anything in `packages/sdk/`.

## Out of Scope

1. Spark account support — cashu accounts only for now
2. Offline mode / SQLite fallback — commands fail with clear auth error
3. Transaction history command — repo wired up but no `transactions` command
4. Cross-mint token receives — same-mint only for now (skip ReceiveCashuTokenQuoteService)
