# Spark USD account (USDB) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Spark `currency: 'USD'` account that holds USDB under the hood, with BOLT11 receive/send rails. Two Breez SDK instances per user — one for BTC, one for USD — same mnemonic, different `account_number`. USD wallet auto-converts via Flashnet's `stable_balance` feature.

**Architecture:** Per spec `docs/superpowers/specs/2026-05-21-spark-usdb-design.md`. Two SDK instances per user share the same BIP-85-derived spark mnemonic. BTC wallet uses the implicit-default `account_number`. USD wallet uses `account_number + 1` and is configured with `stable_balance_config` keyed on USDB. Allocation in MVP = self-pay over Lightning; no Convert button.

**Tech Stack:** TypeScript, React Router v7, TanStack Query v5, `@agicash/breez-sdk-spark@0.13.5-1`, Supabase Postgres, vitest (`bun test`).

---

## Task 0: Pre-flight — lock in account_number values

**Why first:** Every subsequent task uses `getSparkAccountNumber(currency)` constants. Those constants depend on what the SDK currently treats as the implicit default for existing BTC users. Get this wrong and every existing user's BTC wallet derives to a stranger.

**Files:**
- Create: `tools/spark-usdb-preflight.ts`
- Modify (after running): `docs/superpowers/specs/2026-05-21-spark-usdb-design.md` (lock in the chosen values in the "Pre-flight verification" section)

- [ ] **Step 1: Create the pre-flight script**

```typescript
// tools/spark-usdb-preflight.ts
//
// One-off pre-flight check for the Spark USD account work.
// 1. Determines what `account_number` the SDK treats as the default
//    (the value existing BTC users are implicitly on).
// 2. Sanity-checks USDB token metadata is reachable on mainnet.
//
// Usage: bun run tools/spark-usdb-preflight.ts
//
// Requires VITE_BREEZ_API_KEY in env; uses a throwaway mnemonic.
import {
  connect,
  defaultConfig,
  generateMnemonic,
} from '@agicash/breez-sdk-spark';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const apiKey = process.env.VITE_BREEZ_API_KEY;
if (!apiKey) throw new Error('VITE_BREEZ_API_KEY required');

const USDB_MAINNET_ID =
  'btkn1xgrvjwey5ngcagvap2dzzvsy4uk8ua9x69k82dwvt5e7ef9drm9qztux87';

async function main() {
  const mnemonic = generateMnemonic();
  console.log(`Throwaway mnemonic: ${mnemonic}`);

  const candidates: (number | undefined)[] = [undefined, 0, 1, 2, 3];
  const pubkeys: Record<string, string> = {};

  for (const accountNumber of candidates) {
    const dir = await mkdtemp(join(tmpdir(), 'spark-preflight-'));
    try {
      const sdk = await connect({
        config: { ...defaultConfig('mainnet'), apiKey },
        seed: { type: 'mnemonic', mnemonic },
        storageDir: dir,
        // @ts-expect-error account_number on ConnectRequest is optional & untyped here
        accountNumber,
      });
      const info = await sdk.getInfo({});
      const label = accountNumber === undefined ? 'undefined' : String(accountNumber);
      pubkeys[label] = info.receiverIdentityPubkey ?? '(no pubkey returned)';
      console.log(`account_number=${label} → ${pubkeys[label]}`);

      if (accountNumber === undefined) {
        // While we're here, sanity-check USDB metadata.
        try {
          const metadata = await sdk.getTokensMetadata({
            identifiers: [USDB_MAINNET_ID],
          });
          console.log('USDB metadata:', JSON.stringify(metadata, null, 2));
        } catch (e) {
          console.error('USDB metadata fetch FAILED:', e);
        }
      }

      await sdk.disconnect();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  console.log('\nSummary:');
  const grouped = new Map<string, string[]>();
  for (const [label, pubkey] of Object.entries(pubkeys)) {
    const existing = grouped.get(pubkey) ?? [];
    existing.push(label);
    grouped.set(pubkey, existing);
  }
  for (const [pubkey, labels] of grouped) {
    console.log(`  ${labels.join(', ')} → ${pubkey}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

```bash
bun run tools/spark-usdb-preflight.ts
```

Expected output: identity pubkeys per `account_number`, plus a "Summary" block showing which numbers map to the same pubkey. Also: USDB metadata JSON with `ticker: "USDB"`, `decimals: 6`, and an `issuerPublicKey`.

- [ ] **Step 3: Record results and lock in constants**

Open `docs/superpowers/specs/2026-05-21-spark-usdb-design.md`. In the "Pre-flight verification" section, replace the "Outcomes" bullets with the concrete observed mapping. Then determine and write down two numeric constants:
- `BTC_ACCOUNT_NUMBER` — the value that matches `account_number=undefined`. Existing users are on this.
- `USD_ACCOUNT_NUMBER` — any candidate that produced a **distinct** pubkey from BTC.

If the only "different" candidate is far from sequential (e.g. only `undefined` and `3` differed), use that. If multiple candidates differ, pick the smallest available.

If USDB metadata fetch failed: stop. Fix `USDB_MAINNET_ID` or network configuration before proceeding.

- [ ] **Step 4: Commit the pre-flight script and updated spec**

```bash
git add tools/spark-usdb-preflight.ts docs/superpowers/specs/2026-05-21-spark-usdb-design.md
git commit -m "chore(spark-usdb): preflight script + lock in account_number values"
```

---

## Task 1: Pure helpers — `app/lib/spark/usdb.ts` (TDD)

**Files:**
- Create: `app/lib/spark/usdb.ts`
- Create: `app/lib/spark/usdb.test.ts`
- Modify: `app/lib/spark/index.ts` (re-export)

- [ ] **Step 1: Write the failing test file**

Create `app/lib/spark/usdb.test.ts`. Replace `<BTC_ACCOUNT_NUMBER>` and `<USD_ACCOUNT_NUMBER>` below with the values you locked in during Task 0.

```typescript
import { describe, expect, test } from 'bun:test';
import { Money } from '~/lib/money';
import {
  USDB_MAINNET_ID,
  convertUsdbToMoney,
  getSparkAccountNumber,
  getSparkStableBalanceConfig,
} from './usdb';

describe('USDB_MAINNET_ID', () => {
  test('is the canonical mainnet token identifier', () => {
    expect(USDB_MAINNET_ID).toBe(
      'btkn1xgrvjwey5ngcagvap2dzzvsy4uk8ua9x69k82dwvt5e7ef9drm9qztux87',
    );
  });
});

describe('convertUsdbToMoney', () => {
  test('zero balance → $0.00', () => {
    const m = convertUsdbToMoney(0n);
    expect(m.toNumber('usd')).toBe(0);
    expect(m.currency).toBe('USD');
  });

  test('1 USDB (1_000_000 base units) → $1.00', () => {
    const m = convertUsdbToMoney(1_000_000n);
    expect(m.toNumber('usd')).toBe(1);
  });

  test('123.456789 USDB rounds to nearest cent ($123.46)', () => {
    // 123_456_789 base units, 6 decimals, → 123.456789 USD
    // Round half-away-from-zero to cents → 123.46
    const m = convertUsdbToMoney(123_456_789n);
    expect(m.toNumber('cent')).toBe(12346);
  });

  test('exactly half-cent rounds away from zero (0.005 → $0.01)', () => {
    const m = convertUsdbToMoney(5_000n); // 0.005 USD
    expect(m.toNumber('cent')).toBe(1);
  });

  test('very large balance does not lose precision in the cent range', () => {
    // 1,000,000.50 USDB
    const m = convertUsdbToMoney(1_000_000_500_000n);
    expect(m.toNumber('cent')).toBe(100_000_050);
  });
});

describe('getSparkAccountNumber', () => {
  test('BTC → BTC_ACCOUNT_NUMBER', () => {
    expect(getSparkAccountNumber('BTC')).toBe(<BTC_ACCOUNT_NUMBER>);
  });

  test('USD → USD_ACCOUNT_NUMBER', () => {
    expect(getSparkAccountNumber('USD')).toBe(<USD_ACCOUNT_NUMBER>);
  });
});

describe('getSparkStableBalanceConfig', () => {
  test('returns undefined for BTC', () => {
    expect(getSparkStableBalanceConfig('BTC', 'MAINNET')).toBeUndefined();
  });

  test('returns USDB config for USD on MAINNET', () => {
    const cfg = getSparkStableBalanceConfig('USD', 'MAINNET');
    expect(cfg).toEqual({
      tokens: [{ label: 'USDB', tokenIdentifier: USDB_MAINNET_ID }],
      defaultActiveLabel: 'USDB',
      thresholdSats: 0,
    });
  });

  test('returns undefined for USD on REGTEST (no test token configured)', () => {
    expect(getSparkStableBalanceConfig('USD', 'REGTEST')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test, see it fail**

```bash
bun test app/lib/spark/usdb.test.ts
```
Expected: import error — module `./usdb` not found.

- [ ] **Step 3: Implement the module**

Create `app/lib/spark/usdb.ts`. Replace `<BTC_ACCOUNT_NUMBER>` and `<USD_ACCOUNT_NUMBER>` with locked-in values.

```typescript
import type { Config } from '@agicash/breez-sdk-spark';
import { Money } from '~/lib/money';
import type { Currency } from '~/lib/money';
import type { SparkNetwork } from '~/features/agicash-db/json-models/spark-account-details-db-data';

/**
 * Canonical mainnet token identifier for USDB.
 * https://sparkscan.io/token/3206c93b24a4d18ea19d0a9a213204af2c7e74a6d16c7535cc5d33eca4ad1eca?network=mainnet
 */
export const USDB_MAINNET_ID =
  'btkn1xgrvjwey5ngcagvap2dzzvsy4uk8ua9x69k82dwvt5e7ef9drm9qztux87';

/**
 * USDB has 6 decimals on Spark (token base units).
 * USD `Money` has 2 decimals (cents).
 */
const USDB_DECIMALS = 6n;
const CENT_DECIMALS = 2n;
const SCALE_DOWN = 10n ** (USDB_DECIMALS - CENT_DECIMALS); // 10_000

/**
 * Converts a raw USDB token balance (6-decimal `u128` base units) into a
 * `Money<'USD'>` denominated in cents. Half-away-from-zero rounding.
 *
 * Sub-cent precision is intentionally discarded — see
 * `docs/superpowers/specs/2026-05-21-spark-usdb-design.md` "Non-goals".
 */
export function convertUsdbToMoney(rawTokenBalance: bigint): Money<'USD'> {
  const half = SCALE_DOWN / 2n;
  const cents = rawTokenBalance >= 0n
    ? (rawTokenBalance + half) / SCALE_DOWN
    : -((-rawTokenBalance + half) / SCALE_DOWN);
  return new Money({ amount: cents, currency: 'USD', unit: 'cent' });
}

/**
 * Spark `ConnectRequest.account_number` per currency. Constants determined by
 * the Task 0 pre-flight; existing BTC users are on the implicit default value.
 */
export function getSparkAccountNumber(currency: Currency): number {
  switch (currency) {
    case 'BTC':
      return <BTC_ACCOUNT_NUMBER>;
    case 'USD':
      return <USD_ACCOUNT_NUMBER>;
  }
}

/**
 * Returns the `stable_balance_config` for a Spark wallet of the given
 * `(currency, network)`. Returns `undefined` for any combination that should
 * not run the auto-conversion middleware (everything except USD on MAINNET).
 */
export function getSparkStableBalanceConfig(
  currency: Currency,
  network: SparkNetwork,
): Config['stableBalanceConfig'] {
  if (currency === 'USD' && network === 'MAINNET') {
    return {
      tokens: [{ label: 'USDB', tokenIdentifier: USDB_MAINNET_ID }],
      defaultActiveLabel: 'USDB',
      thresholdSats: 0,
    };
  }
  return undefined;
}
```

- [ ] **Step 4: Run the test, see it pass**

```bash
bun test app/lib/spark/usdb.test.ts
```
Expected: all tests pass.

- [ ] **Step 5: Re-export from `app/lib/spark/index.ts`**

Read `app/lib/spark/index.ts` and add the following re-exports next to the existing ones:

```typescript
export {
  USDB_MAINNET_ID,
  convertUsdbToMoney,
  getSparkAccountNumber,
  getSparkStableBalanceConfig,
} from './usdb';
```

- [ ] **Step 6: Run typecheck and lint**

```bash
bun run typecheck && bun run lint:check
```
Both should pass.

If the `Config['stableBalanceConfig']` type access doesn't compile, the SDK might name the field differently. Open `node_modules/@agicash/breez-sdk-spark` and grep for `stableBalance` to find the correct property name; update accordingly.

- [ ] **Step 7: Commit**

```bash
git add app/lib/spark/usdb.ts app/lib/spark/usdb.test.ts app/lib/spark/index.ts
git commit -m "feat(spark): add USDB pure helpers (token id, money conversion, account number, stable_balance config)"
```

---

## Task 2: DB unique index for spark accounts per (user, currency, network)

**Why:** Mirrors `cashu_accounts_user_currency_mint_unique`. Prevents accidental duplicate Spark USD accounts.

**Files:**
- Create: `supabase/migrations/<NEW_TIMESTAMP>_spark_accounts_currency_network_unique.sql`

- [ ] **Step 1: Determine the migration timestamp**

Latest migration timestamp shown in `supabase/migrations/` (e.g. `20260505222417_*`). Use one greater than that for your new file. Format: `YYYYMMDDhhmmss`. Pick a current-day timestamp.

- [ ] **Step 2: Create the migration**

```sql
-- supabase/migrations/<NEW_TIMESTAMP>_spark_accounts_currency_network_unique.sql

-- Mirrors `cashu_accounts_user_currency_mint_unique`: one spark account per
-- (user, currency, network) tuple. Supports the Spark USD (USDB) account work.

create unique index "spark_accounts_user_currency_network_unique"
  on "wallet"."accounts" ("user_id", "currency", (details->>'network'))
  where type = 'spark';
```

- [ ] **Step 3: Apply the migration locally**

```bash
bunx supabase migration up
```
Expected: the new migration applies cleanly.

- [ ] **Step 4: Verify the index exists**

```bash
bunx supabase db diff --use-migra | head -40
```
Expected: no diff — the local DB matches the migrations.

Confirm the index is present:

```bash
bunx supabase db query "select indexname from pg_indexes where schemaname='wallet' and indexname='spark_accounts_user_currency_network_unique';"
```
Expected: one row.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/<NEW_TIMESTAMP>_spark_accounts_currency_network_unique.sql
git commit -m "feat(db): unique index on spark accounts per (user, currency, network)"
```

---

## Task 3: Seed the USD spark account by default — `app/features/user/user-hooks.tsx`

**Files:**
- Modify: `app/features/user/user-hooks.tsx` (around line 79, the `defaultAccounts` declaration)

- [ ] **Step 1: Update `defaultAccounts`**

Replace the entire `export const defaultAccounts = [ ... ] as const;` block with:

```typescript
export const defaultAccounts = [
  {
    type: 'spark',
    currency: 'BTC',
    name: 'Bitcoin',
    network: 'MAINNET',
    isDefault: true,
    purpose: 'transactional',
    expiresAt: null,
  },
  {
    type: 'spark',
    currency: 'USD',
    name: 'Dollars',
    network: 'MAINNET',
    isDefault: true,
    purpose: 'transactional',
    expiresAt: null,
  },
  ...(isDevelopmentMode
    ? ([
        {
          type: 'cashu',
          currency: 'BTC',
          name: 'Testnut BTC',
          mintUrl: 'https://testnut.cashu.space',
          isTestMint: true,
          isDefault: false,
          purpose: 'transactional',
          expiresAt: null,
        },
        {
          type: 'cashu',
          currency: 'USD',
          name: 'Testnut USD',
          mintUrl: 'https://testnut.cashu.space',
          isTestMint: true,
          isDefault: false,
          purpose: 'transactional',
          expiresAt: null,
        },
      ] as const)
    : []),
] as const;
```

Two changes: a new spark USD entry with `isDefault: true`, and the dev-mode cashu USD entry's `isDefault` flipped from `true` to `false` so the Spark USD account wins the USD default in dev.

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```
Expected: pass. The `SparkAccount` discriminated branch in `app/features/accounts/account.ts:62-69` does not restrict `currency`, so widening to USD here is type-compatible.

- [ ] **Step 3: Lint**

```bash
bun run fix:all
```

- [ ] **Step 4: Commit**

```bash
git add app/features/user/user-hooks.tsx
git commit -m "feat(accounts): seed spark USD account by default on user upsert"
```

---

## Task 4: Make Spark SDK init account-aware — `app/features/shared/spark.ts` + `account-repository.ts`

**Files:**
- Modify: `app/features/shared/spark.ts` (the `sparkWalletQueryOptions` and `getInitializedSparkWallet` functions)
- Modify: `app/features/accounts/account-repository.ts` (its `getInitializedSparkWallet` private helper around line 244, and the `sparkStorageDir` constructor field)

- [ ] **Step 1: Update `app/features/shared/spark.ts`**

Replace the body of `sparkWalletQueryOptions` and `getInitializedSparkWallet`:

```typescript
import type { SparkAccount } from '../accounts/account';
import { convertUsdbToMoney, getSparkAccountNumber, getSparkStableBalanceConfig, USDB_MAINNET_ID } from '~/lib/spark';
import * as Sentry from '@sentry/react'; // import path may differ — confirm in app/lib/sentry or root.tsx

// ... existing imports ...

export const sparkWalletQueryOptions = ({
  network,
  currency,
  mnemonic,
  storageDir,
}: {
  network: SparkNetwork;
  currency: Currency;          // NEW
  mnemonic: string;
  storageDir: string;
}) =>
  queryOptions({
    queryKey: [
      'spark-wallet',
      computeSHA256(mnemonic),
      network,
      currency,                // NEW — distinguishes BTC vs USD wallets
      storageDir,
    ],
    queryFn: async () => {
      const breezNetwork = network.toLowerCase() as 'mainnet' | 'regtest';
      tryInitLogging();

      const stableBalanceConfig = getSparkStableBalanceConfig(currency, network);
      const accountNumber = getSparkAccountNumber(currency);

      const sdk = await measureOperation(
        'BreezSdk.connect',
        () =>
          connect({
            config: {
              ...defaultConfig(breezNetwork),
              apiKey,
              lnurlDomain: undefined,
              privateEnabledDefault: true,
              optimizationConfig: { autoEnabled: true, multiplicity: 2 },
              stableBalanceConfig,  // NEW; undefined for BTC
            },
            seed: { type: 'mnemonic', mnemonic },
            storageDir,
            // @ts-expect-error: account_number is on the underlying ConnectRequest;
            // the wasm types in 0.13.5-1 may not surface it on the JS shim.
            // Verified via Task 0 pre-flight.
            accountNumber,
          }),
        { 'spark.network': network, 'spark.currency': currency },
      );

      return sdk;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });

/**
 * Initializes a Spark wallet for a given account.
 * If Spark is offline or times out, returns a minimal wallet with isOnline: false.
 * Reads BTC balance from `balance_sats`, USD balance from `token_balances[USDB_MAINNET_ID]`.
 */
export async function getInitializedSparkWallet(
  queryClient: QueryClient,
  mnemonic: string,
  network: SparkNetwork,
  currency: Currency,           // NEW
  storageDir: string,
): Promise<{
  wallet: BreezSdk;
  balance: Money | null;
  isOnline: boolean;
}> {
  return measureOperation(
    'getInitializedSparkWallet',
    async () => {
      try {
        const wallet = await queryClient.fetchQuery(
          sparkWalletQueryOptions({ network, currency, mnemonic, storageDir }),
        );

        const info = await measureOperation('BreezSdk.getInfo', () =>
          wallet.getInfo({}),
        );

        let balance: Money;
        if (currency === 'BTC') {
          balance = new Money({
            amount: info.balanceSats,
            currency: 'BTC',
            unit: 'sat',
          }) as Money;
        } else {
          // USD wallet — sanity-check USDB metadata once on first init, then
          // read the USDB token balance. If metadata fetch fails, fall through
          // to the stub.
          await measureOperation('BreezSdk.getTokensMetadata', () =>
            wallet.getTokensMetadata({ identifiers: [USDB_MAINNET_ID] }),
          );
          const raw = info.tokenBalances?.[USDB_MAINNET_ID]?.balance ?? 0n;
          balance = convertUsdbToMoney(BigInt(raw)) as Money;
        }

        return { wallet, balance, isOnline: true };
      } catch (error) {
        Sentry.captureException(error, {
          tags: {
            'spark.network': network,
            'spark.currency': currency,
            'spark.account_number': String(getSparkAccountNumber(currency)),
          },
        });
        console.error('Failed to initialize spark wallet', { cause: error });
        return {
          wallet: createSparkWalletStub(
            'Spark is offline, please try again later.',
          ),
          balance: null,
          isOnline: false,
        };
      }
    },
    { sparkNetwork: network, sparkCurrency: currency },
  );
}
```

Notes for the engineer:
- The exact property name on the wasm-bindgen shim for `account_number` (`accountNumber` vs `account_number`) — verify by reading `node_modules/@agicash/breez-sdk-spark/web/breez_sdk_spark.d.ts` (search for `ConnectRequest`). Same for `stableBalanceConfig` (vs `stable_balance_config`).
- Similarly for `tokenBalances` on `GetInfoResponse` and `tokenIdentifier` on `StableBalanceToken`. Tweak property names if the .d.ts uses snake_case.
- `Sentry.captureException` — match the existing import pattern in this file or any sibling; if Sentry isn't already wired in `spark.ts`, just `console.error` for now (the Sentry tagging story is a follow-up).

- [ ] **Step 2: Update `account-repository.ts`**

Two edits in `app/features/accounts/account-repository.ts`:

(a) The constructor field `sparkStorageDir` (around line 56) becomes a function so each account gets a distinct storage dir. Change the field type from `string` to `(accountId: string) => string`, and update the constructor signature accordingly.

(b) The private helper `getInitializedSparkWallet` (around line 244) now takes the account row's data and passes through `network`, `currency`, and the per-account `storageDir`. Update its call site (around line 213-218) to pass `data`.

```typescript
// Around the constructor field declaration:
private readonly sparkStorageDir: (accountId: string) => string,

// Around line 213-218 inside the spark account branch of toAccount:
if (isSparkAccount(data)) {
  const { network } = data.details;
  const currency = data.currency as Currency;
  const { wallet, balance, isOnline } =
    await this.getInitializedSparkWallet(data.id, network, currency);

  return {
    ...commonData,
    type: 'spark',
    balance,
    network,
    isOnline,
    wallet,
  } as T;
}

// And the private helper around line 244:
private async getInitializedSparkWallet(
  accountId: string,
  network: SparkNetwork,
  currency: Currency,
) {
  const mnemonic = await this.getSparkWalletMnemonic();
  return getInitializedSparkWallet(
    this.queryClient,
    mnemonic,
    network,
    currency,
    this.sparkStorageDir(accountId),
  );
}
```

- [ ] **Step 3: Update the construction site for `sparkStorageDir`**

Search for the place where `AccountRepository` is constructed:

```bash
grep -rn "new AccountRepository\|new WriteAccountRepository\|new ReadAccountRepository" app/
```

In each construction site, change `'./.spark-data'` (or whatever literal the existing arg passes) to a function:

```typescript
(accountId: string) => `./.spark-data/${accountId}`,
```

If the existing code uses a different storage-dir literal, mirror that with the accountId suffix.

- [ ] **Step 4: Update `useTrackAndUpdateSparkAccountBalances`**

In `app/features/shared/spark.ts`, the hook iterates over spark accounts and registers event listeners. It already invalidates the balance cache on `paymentSucceeded`. Verify it works for the USD account too: the same hook handles all spark accounts because it filters by `account.type === 'spark'` (not by currency). No code change should be needed, but read the hook body and confirm. If the hook uses `info.balanceSats` directly to update the cache, replace that with a call to `getInitializedSparkWallet`'s balance logic (or a helper extracted from it) so USD accounts get their USDB-derived balance.

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```
Expected: pass.

- [ ] **Step 6: Lint and fix**

```bash
bun run fix:all
```

- [ ] **Step 7: Local smoke — BTC account still works**

Start the dev stack and log in as an existing test user. Verify the BTC spark account loads with its existing balance. This is the regression-check before exercising the USD path.

```bash
# In one terminal:
bunx supabase start  # if not already running
# In another:
bun run dev
```
Open the app, log in, verify the Bitcoin account shows the same balance as before this change. If the balance is wrong / zero / off, the account_number assignment is wrong — go back to Task 0.

- [ ] **Step 8: Commit**

```bash
git add app/features/shared/spark.ts app/features/accounts/account-repository.ts
# plus any AccountRepository construction sites you touched
git commit -m "feat(spark): make SDK init account-aware (account_number, storage_dir, stable_balance_config per currency)"
```

---

## Task 5: Extend receive DB JSON model with conversion fields — `spark-lightning-receive-db-data.ts`

**Why:** Per spec, on USD-account receive we persist `bolt11AmountSats`, `conversionFee`, `slippageDelta`, `usdbAmountReceived`. BTC-account receives use the existing fields unchanged.

**Files:**
- Modify: `app/features/agicash-db/json-models/spark-lightning-receive-db-data.ts`

- [ ] **Step 1: Add optional fields to the Zod schema**

Replace the schema with:

```typescript
import { z } from 'zod';
import { Money } from '~/lib/money';
import { CashuTokenMeltDbDataSchema } from './cashu-token-melt-db-data';

/**
 * Schema for spark lightning receive db data.
 * Defines the format of the data stored in the jsonb database column.
 */
export const SparkLightningReceiveDbDataSchema = z.object({
  paymentRequest: z.string(),
  amountReceived: z.instanceof(Money),
  description: z.string().optional(),
  paymentPreimage: z.string().optional(),
  cashuTokenMeltData: CashuTokenMeltDbDataSchema.optional(),
  totalFee: z.instanceof(Money),

  /**
   * Sats received over Lightning before the stable_balance conversion runs.
   * Set only on USD-account receives, when the lightning leg has settled.
   */
  bolt11AmountSats: z.instanceof(Money).optional(),
  /**
   * Conversion fee charged by Flashnet for the sats→USDB swap.
   * Set only on USD-account receives, when the conversion has completed.
   */
  conversionFee: z.instanceof(Money).optional(),
  /**
   * Difference between the estimated and actual USDB output (price movement
   * within the configured slippage tolerance).
   * Set only on USD-account receives, when the conversion has completed.
   */
  slippageDelta: z.instanceof(Money).optional(),
  /**
   * USDB amount actually credited after conversion.
   * Set only on USD-account receives, when the conversion has completed.
   * Same as `amountReceived` once both legs are done, but kept separately
   * for accounting clarity vs the lightning-leg sats.
   */
  usdbAmountReceived: z.instanceof(Money).optional(),
});

export type SparkLightningReceiveDbData = z.infer<
  typeof SparkLightningReceiveDbDataSchema
>;
```

All four new fields are `.optional()` — BTC receives won't carry them. No DB migration needed since this is a jsonb shape change.

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```
Expected: pass. Existing call sites only set the original fields, which remain typed the same.

- [ ] **Step 3: Commit**

```bash
git add app/features/agicash-db/json-models/spark-lightning-receive-db-data.ts
git commit -m "feat(db): add conversion fee/slippage fields to spark lightning receive jsonb"
```

---

## Task 6: Receive flow — currency dispatch + conversion-completion wait

**Files (read all first to understand structure):**
- Modify: `app/features/receive/spark-receive-quote-core.ts`
- Modify: `app/features/receive/spark-receive-quote-service.ts` (and `.server.ts` mirror if applicable)
- Modify: `app/features/receive/spark-receive-quote-hooks.ts`
- Modify: `app/features/receive/spark-receive-quote-repository.ts` (and `.server.ts` mirror) — to persist the new fields

- [ ] **Step 1: Read the existing files**

Before editing, read each of the four receive files end-to-end. The conversion-wait logic must integrate with the existing `useOnSparkReceiveStateChange` hook (around `spark-receive-quote-hooks.ts:344-451`) and the existing `getLightningQuote` in `core.ts`. Map out where the current code marks a receive COMPLETED.

- [ ] **Step 2: Parameterize the amount-to-sats conversion in core**

`app/features/receive/spark-receive-quote-core.ts:255` currently hardcodes `currency: 'BTC'` when constructing the receive `Money`. The function builds a `Money` from `invoice.amountMsat` for the BOLT11 the user just generated. For BTC receives this is correct. For USD receives, the BOLT11 still carries an msat amount (Lightning is sats-denominated), but the user's intent was a USD amount that will become USDB after conversion.

Restructure `getLightningQuote` to take the destination account's currency and:
- For BTC accounts: unchanged behavior; quote's `amountToReceive` is the sats `Money<'BTC'>`.
- For USD accounts:
  - Caller passes `amountRequestedInUsd: Money<'USD'>` (the user-entered USD amount).
  - Convert to sats via the existing `useExchangeRate` (passed in through service args; see how cashu-send-quote-service.ts:128-135 does it).
  - Call `SDK.receivePayment({ paymentMethod: { type: 'bolt11Invoice', amountSats: <converted sats>, description, receiverIdentityPubkey: B's pubkey } })`.
  - Store `bolt11AmountSats: Money<'BTC'>(invoiceAmountSats)` on the quote.
  - The quote's user-visible `amountToReceive` is the original `Money<'USD'>`.

- [ ] **Step 3: Service-layer dispatch**

In `app/features/receive/spark-receive-quote-service.ts`:
- `createReceiveQuote` already takes an `account` param. Read the existing signature, then add an `exchangeRate` param (matching the cashu send-quote pattern).
- Before calling `getLightningQuote`, dispatch on `account.currency`:
  - BTC: pass `{ amountSats: amountToReceive }` (existing path).
  - USD: convert the requested USD `Money` to sats via `exchangeRate`, pass `{ amountSats }`, but keep the original USD `Money` as the quote's `amountToReceive`.

If a `.server.ts` mirror exists, apply the same change there.

- [ ] **Step 4: Repository — persist new fields**

In `app/features/receive/spark-receive-quote-repository.ts`, ensure the encrypted jsonb payload includes the new optional fields when present. The schema change in Task 5 is already in place; the repository should pass through whatever is provided.

If there's a method like `markCompleted(quoteId, { paymentPreimage, ... })`, extend its parameter shape to optionally accept `{ conversionFee, slippageDelta, usdbAmountReceived }` and persist them.

- [ ] **Step 5: Hooks — conversion-completion wait**

The most consequential change. In `app/features/receive/spark-receive-quote-hooks.ts`, find `useOnSparkReceiveStateChange` (around line 344) and `useProcessSparkReceiveQuoteTasks` (around line 457).

For a USD account, on `paymentSucceeded`:
- Inspect the event payload to determine the leg: lightning vs conversion. The shape depends on the SDK; verify by reading `node_modules/@agicash/breez-sdk-spark` types. Likely the event carries `payment.details` with a discriminator. Common shapes seen across the SDK: `paymentType: 'lightning' | 'token-conversion'`, or `payment.method: PaymentMethod::Spark | PaymentMethod::Token`, or `payment.conversionDetails` being defined.
- If the leg is lightning: record `bolt11AmountSats` on the quote, leave state PENDING.
- If the leg is conversion AND `conversionDetails.status === 'Completed'`: complete the quote with `usdbAmountReceived`, `conversionFee`, `slippageDelta`.
- If the leg is conversion AND `conversionDetails.status === 'RefundNeeded' | 'Failed'`: log a Sentry exception tagged `spark.usd.conversion_refund_needed`, leave the quote PENDING.

For BTC accounts, the existing single-event path completes the quote.

Pseudocode for the dispatch (drop into the existing `paymentSucceeded` callback):

```typescript
const account = accountsCache.get(accountId);
if (account?.type !== 'spark') return;

if (account.currency === 'BTC') {
  // existing path — complete the quote with paymentPreimage
  return;
}

// USD account — two-leg dispatch
const isConversionLeg = /* SDK-shape-specific check; see node_modules types */;
if (!isConversionLeg) {
  await repo.updatePartial(quoteId, {
    bolt11AmountSats: new Money({ amount: event.amountSats, currency: 'BTC', unit: 'sat' }),
  });
  return;
}

const status = event.conversionDetails?.status;
if (status === 'Completed') {
  await service.complete(quoteId, {
    paymentPreimage: event.preimage,
    conversionFee: new Money({ amount: event.conversionDetails.fee, currency: 'BTC', unit: 'sat' }),
    slippageDelta: /* compute from estimate vs actual */,
    usdbAmountReceived: convertUsdbToMoney(BigInt(event.conversionDetails.to.amount)),
  });
} else if (status === 'RefundNeeded' || status === 'Failed') {
  Sentry.captureException(new Error(`Spark USD conversion failed: ${status}`), {
    tags: { 'spark.usd.conversion_refund_needed': 'true' },
    extra: { quoteId, event },
  });
  // Leave quote PENDING.
}
```

- [ ] **Step 6: Typecheck**

```bash
bun run typecheck
```
If types don't line up because the SDK event shape is different from above, read the d.ts and adjust the dispatch.

- [ ] **Step 7: Lint and fix**

```bash
bun run fix:all
```

- [ ] **Step 8: Local smoke — receive into BTC account regressed?**

Start dev, generate a BOLT11 from the Bitcoin account, pay it from another wallet (or use the e2e helpers). Verify the receive completes as before.

```bash
bun run dev
```

- [ ] **Step 9: Commit**

```bash
git add app/features/receive/
git commit -m "feat(spark-receive): currency dispatch + conversion-completion wait for USD account"
```

---

## Task 7: Extend send DB JSON model with conversion fields — `spark-lightning-send-db-data.ts`

**Files:**
- Modify: `app/features/agicash-db/json-models/spark-lightning-send-db-data.ts`

- [ ] **Step 1: Add optional fields to the Zod schema**

```typescript
import { z } from 'zod';
import { Money } from '~/lib/money';

/**
 * Schema for spark lightning send db data.
 * Defines the format of the data stored in the jsonb database column.
 */
export const SparkLightningSendDbDataSchema = z.object({
  paymentRequest: z.string(),
  amountReceived: z.instanceof(Money),
  estimatedLightningFee: z.instanceof(Money),
  amountSpent: z.instanceof(Money).optional(),
  lightningFee: z.instanceof(Money).optional(),
  paymentPreimage: z.string().optional(),

  /**
   * USDB amount debited from the USD wallet before conversion.
   * Set only for USD-account sends.
   */
  usdbDebited: z.instanceof(Money).optional(),
  /**
   * Sats obtained after USDB → sats conversion (the input to the Lightning payment).
   * Set only for USD-account sends, when the conversion has completed.
   */
  satsAfterConversion: z.instanceof(Money).optional(),
  /**
   * Conversion fee charged by Flashnet for the USDB → sats swap.
   * Set only for USD-account sends, when the conversion has completed.
   */
  conversionFee: z.instanceof(Money).optional(),
  /**
   * Actual slippage realised on the USDB → sats swap.
   * Set only for USD-account sends, when the conversion has completed.
   */
  slippageActual: z.instanceof(Money).optional(),
});

export type SparkLightningSendDbData = z.infer<
  typeof SparkLightningSendDbDataSchema
>;
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add app/features/agicash-db/json-models/spark-lightning-send-db-data.ts
git commit -m "feat(db): add conversion fee/slippage fields to spark lightning send jsonb"
```

---

## Task 8: Send flow — currency dispatch + two-leg wait

**Files (read all first):**
- Modify: `app/features/send/spark-send-quote-service.ts`
- Modify: `app/features/send/spark-send-quote-hooks.ts`
- Modify: `app/features/send/spark-send-quote-repository.ts`

- [ ] **Step 1: Read existing files**

Read end-to-end before editing. Note the four `currency: 'BTC'` hardcodes at `spark-send-quote-service.ts:136, 142, 171, 308`.

- [ ] **Step 2: Replace hardcoded currency with `account.currency`**

In `app/features/send/spark-send-quote-service.ts`, replace each `currency: 'BTC'` literal with `currency: account.currency` (the surrounding code already has `account` in scope at each spot — confirm).

For the `unit` field that often pairs with currency literals (e.g. `unit: 'sat'` for BTC), use a helper to dispatch:
- BTC account: amount unit `'sat'`, fees in sats.
- USD account: user-facing amount unit `'cent'`, but **fees stay in sats** (Lightning + Flashnet fees are inherently sats). The Money type carries both currency and unit independently.

The send-side data model carries fees in sats (`Money<'BTC'>`); the user-facing total in the UI is computed by summing those sats and presenting via the existing USD-localization helper (read `app/lib/money/money.ts` localizedSymbol / formatting for the existing convention).

If a hardcoded `currency: 'BTC'` is genuinely meant to be sats fees (e.g. `lightningFeeReserve`), leave it.

- [ ] **Step 3: Prepare-send accepts USD amounts**

`getLightningSendQuote` (around line 116-202) currently expects sats. For USD source account, accept a USD amount, convert to sats via the same `exchangeRate` plumbing as Cashu (`cashu-send-quote-service.ts:128-135`), call `prepareSendPayment` with the sats amount.

The SDK's `prepareSendPayment` response for a USD wallet will include a `conversionEstimate` object (because `stable_balance_config` is active). Persist:
- `usdbDebited = convertUsdbToMoney(conversionEstimate.amount_in)` (USDB needed to cover the payment)
- `estimatedLightningFee` (existing, in sats)
- A computed total-fee for the UI = `lightning_fee_sats + conversion_fee_sats` summed in sats and localized to USD via the user's exchange rate.

- [ ] **Step 4: Send hooks — wait for both legs on USD**

In `app/features/send/spark-send-quote-hooks.ts`, find `useOnSparkSendStateChange` (around line 148) and `useProcessSparkSendQuoteTasks` (around line 386).

For a USD account on `paymentSucceeded`:
- If conversion leg with `status: 'Completed'`: record `satsAfterConversion`, `conversionFee`, `slippageActual`. Quote stays PENDING.
- If conversion leg with `status: 'RefundNeeded' | 'Failed'`: Sentry tag `spark.usd.dangling_sats` (could be either pre-Lightning or post-Lightning depending on race), leave PENDING.
- If lightning leg success: now mark COMPLETED. Persist `paymentPreimage`, `lightningFee`, `amountSpent`.

Same pseudocode shape as Task 6 Step 5 — adapt for the send direction.

For BTC accounts, the existing single-event completion path is unchanged.

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

- [ ] **Step 6: Lint and fix**

```bash
bun run fix:all
```

- [ ] **Step 7: Local smoke — BTC send still works**

Send a small BOLT11 from the Bitcoin account. Verify it completes as before.

- [ ] **Step 8: Commit**

```bash
git add app/features/send/
git commit -m "feat(spark-send): currency dispatch + two-leg wait for USD account"
```

---

## Task 9: Manual mainnet smoke checklist

**Why:** No automated coverage for payment flows. Verify the feature on real mainnet with tiny amounts before merging.

This is a checklist, not a code task. Run it locally against the dev stack pointing at mainnet Spark.

- [ ] **Step 1: Fresh-login a test user**

Create or sign in as a clean test user. Verify the accounts list shows both:
- "Bitcoin" (`type: 'spark', currency: 'BTC'`)
- "Dollars" (`type: 'spark', currency: 'USD'`)

The "Dollars" account should appear with `isOnline: true` and a $0.00 balance.

- [ ] **Step 2: Receive $1 into the Dollars account**

Tap "Receive" with "Dollars" selected. Enter `$1.00`. Pay the generated BOLT11 from a separate Lightning wallet.

Expected timeline:
- Lightning leg settles in ~1–3s. UI shows "pending."
- Flashnet conversion runs in a few more seconds.
- UI updates to "Received $X.XX USDB" once conversion completes. The exact USDB amount may differ from $1.00 by up to 10 bps slippage; that's expected.

Verify DB row:
```bash
bunx supabase db query "select id, state, details from wallet.spark_lightning_receive_quotes order by created_at desc limit 1;"
```
Confirm `bolt11AmountSats`, `usdbAmountReceived`, `conversionFee` are populated in the encrypted jsonb (or that the decrypted shape includes them when loaded in the app).

- [ ] **Step 3: Send $0.50 from the Dollars account**

Generate a $0.50-equivalent BOLT11 invoice from a separate wallet. Paste it into the agicash send screen with "Dollars" selected as the source. Confirm the fee total displayed in USD looks reasonable.

Hit send. Verify:
- USDB balance decreases by ~$0.50 + fees.
- The receiving wallet shows the sats arrived.
- DB row shows `usdbDebited`, `satsAfterConversion`, `lightningFee`, `conversionFee`.

- [ ] **Step 4: Internal allocation — BTC → USD**

From the Bitcoin account, pay a freshly-generated BOLT11 from the Dollars account (e.g. $1). Verify the USDB balance on Dollars grows accordingly. This is the MVP allocation flow.

- [ ] **Step 5: Internal allocation — USD → BTC**

Reverse: from the Dollars account, pay a freshly-generated BOLT11 from the Bitcoin account. Verify both balances move.

- [ ] **Step 6: Record results**

Add a short "Mainnet smoke 2026-MM-DD" entry to the design doc or a separate `docs/changelogs/` file with screenshots, the actual amounts received vs. requested (so we know real-world slippage), and any anomalies. Commit it.

```bash
git add docs/
git commit -m "docs(spark-usdb): manual mainnet smoke results"
```

---

## Self-review

### Spec coverage

- **Architecture (two SDK instances, account_number 0/1):** Tasks 0, 4.
- **stable_balance_config with USDB and threshold_sats: 0:** Task 1 (`getSparkStableBalanceConfig`), Task 4 (wired in).
- **USDB_MAINNET_ID single source of truth:** Task 1.
- **convertUsdbToMoney boundary helper:** Task 1, used in Task 4 (init) and Task 6 (receive complete).
- **DB unique index per (user, currency, network):** Task 2.
- **Default account seeding for USD:** Task 3.
- **Per-account storage_dir:** Task 4.
- **Receive: lightning-leg-then-conversion-leg wait:** Task 6.
- **Receive fee components in DB:** Task 5, persisted in Task 6.
- **Send: two-leg wait, conversion fee dispatch, USD-source amount handling:** Tasks 7, 8.
- **Send fee components in DB:** Task 7, persisted in Task 8.
- **Sentry tags on failures:** Tasks 4, 6, 8.
- **Failure handling = stay PENDING + Sentry:** Tasks 6, 8.
- **Manual smoke checklist:** Task 9.
- **Unit tests only for pure helpers:** Task 1 (only). No other tests added.
- **Pre-flight gating:** Task 0.
- **USDB metadata sanity check at init:** Task 0 (one-off) + Task 4 (per-init).

### Placeholder scan

The placeholder `<BTC_ACCOUNT_NUMBER>` / `<USD_ACCOUNT_NUMBER>` in Task 1 (helper module and tests) is intentional — these values are determined by the Task 0 pre-flight and substituted before code lands. Marked clearly.

A few Task 6/8 steps cite "the SDK event shape; see `node_modules/.../*.d.ts`" rather than writing the literal property names. This is honest: the exact wasm-bindgen surface for conversion-completion events varies, and inventing names invites bugs. The engineer reads the d.ts, then writes the dispatch.

No "TBD" / "TODO" / "implement later" in the plan.

### Type consistency

Names used across tasks:
- `convertUsdbToMoney` — Task 1 defines, Tasks 4, 6 use.
- `getSparkAccountNumber` — Task 1 defines, Task 4 uses.
- `getSparkStableBalanceConfig` — Task 1 defines, Task 4 uses.
- `USDB_MAINNET_ID` — Task 1 defines, Tasks 4, 6 use.
- `bolt11AmountSats`, `conversionFee`, `slippageDelta`, `usdbAmountReceived` — Task 5 defines on schema, Task 6 persists.
- `usdbDebited`, `satsAfterConversion`, `conversionFee`, `slippageActual` — Task 7 defines, Task 8 persists.
- `getInitializedSparkWallet` signature change — Task 4 defines, all dependents updated in same task.

---

## Known follow-ups (out of scope for this plan)

- Rebase fork to upstream 0.15.0+ to unlock `refundPendingConversions()` and clean up `RefundNeeded` cases.
- Regtest USDB issuance via `getTokenIssuer().createIssuerToken` for local e2e coverage.
- Multi-decimal `Money<'USD'>` to preserve sub-cent USDB precision.
- Convert/Swap UI for explicit allocation.
- Conversion events in transaction history.
