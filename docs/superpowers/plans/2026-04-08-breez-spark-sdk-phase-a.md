# Breez Spark SDK Phase A — Production Replacement

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `@buildonspark/spark-sdk@0.7.4` with `@breeztech/breez-sdk-spark` across all client-side Spark operations (wallet init, balance, send, receive). Lightning Address stays on old SDK until Breez exposes `receiverIdentityPubkey`.

**Architecture:** Direct SDK swap using a `getBreezSdk()` accessor pattern. The `Account.wallet` type changes to `BreezSdk`. Balance updates move from 3-second polling to event-driven. Send flow adopts two-step `prepareSendPayment` + `sendPayment` with native `idempotencyKey`. Receive flow uses `receivePayment` + `listPayments` matching. Lightning Address is isolated with its own old-SDK wallet instance.

**Tech Stack:** `@breeztech/breez-sdk-spark@0.12.2-dev3` (WASM), React Router v7, TanStack Query v5

**Branch:** `impl/breez-spark-sdk-migration` (based off `master`)

**Specs:** `docs/superpowers/specs/2026-04-04-breez-spark-sdk-migration-design.md`, `docs/superpowers/specs/2026-04-04-breez-spark-sdk-validation-results.md`

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `app/lib/breez-spark/init.ts` | Breez SDK connect function (from Phase C prototype) |
| `app/lib/breez-spark/events.ts` | Event listener wrapper (from Phase C prototype) |
| `app/lib/breez-spark/types.ts` | Network mapping, type re-exports, `getBreezSdk()` accessor |

### Modified files
| File | Change |
|------|--------|
| `package.json` | Add `@breeztech/breez-sdk-spark` dependency |
| `app/entry.client.tsx` | Production-ready WASM init (remove prototype comment) |
| `app/lib/spark/errors.ts` | Replace `SparkError` with plain `Error` message matching |
| `app/lib/spark/utils.ts` | Replace old SDK imports with Breez equivalents |
| `app/lib/spark/index.ts` | Update re-exports |
| `app/features/accounts/account.ts` | `wallet: SparkWallet` → `wallet: BreezSdk`; local `SparkNetwork` type |
| `app/features/agicash-db/json-models/spark-account-details-db-data.ts` | Export `SparkNetwork` type from Zod schema |
| `app/features/accounts/account-repository.ts` | Import `SparkNetwork` from local type |
| `app/features/user/user-repository.ts` | Import `SparkNetwork` from local type; legacy wallet init for server |
| `app/features/shared/spark.ts` | Full rewrite: Breez `connect()`, event-driven balance, remove zero-balance workaround |
| `app/features/send/spark-send-quote-service.ts` | `prepareSendPayment` + `sendPayment` with `idempotencyKey` |
| `app/features/send/spark-send-quote-hooks.ts` | Replace `getLightningSendRequest` polling with `getPayment` |
| `app/features/receive/spark-receive-quote-core.ts` | `receivePayment` + bolt11 parsing; simplified `SparkReceiveLightningQuote` type |
| `app/features/receive/spark-receive-quote-hooks.ts` | Replace `getLightningReceiveRequest` polling with `listPayments` matching |
| `app/features/receive/spark-receive-quote-service.ts` | Adapt to simplified quote type |
| `app/features/receive/spark-receive-quote-service.server.ts` | Inline old-SDK `createLightningInvoice` for Lightning Address |
| `app/features/receive/claim-cashu-token-service.ts` | Replace receive polling with `listPayments` matching |
| `app/features/receive/lightning-address-service.ts` | Self-contained old-SDK wallet; import from server service |
| `app/routes/_protected.tsx` | Update `sparkIdentityPublicKeyQueryOptions` call (remove `accountNumber`) |

### Deleted files
| File | Reason |
|------|--------|
| `patches/@buildonspark%2Fspark-sdk@0.7.4.patch` | Only added debug logging; not needed by Lightning Address |

### Kept as-is (old SDK)
| File | Reason |
|------|--------|
| `@buildonspark/spark-sdk` in `package.json` | Lightning Address needs it until Breez adds `receiverIdentityPubkey` |

---

## API Mapping Reference

| Old SDK (`@buildonspark/spark-sdk`) | Breez SDK (`@breeztech/breez-sdk-spark`) |
|------|------|
| `SparkWallet` (class) | `BreezSdk` (class) |
| `SparkWallet.initialize({ mnemonicOrSeed, options })` | `connect({ config, seed, storageDir })` |
| `wallet.getBalance()` → `{ satsBalance: { owned, available } }` | `sdk.getInfo({})` → `{ balanceSats, identityPubkey }` |
| `wallet.getIdentityPublicKey()` | `sdk.getInfo({})` → `identityPubkey` |
| `wallet.getLightningSendFeeEstimate({ amountSats, encodedInvoice })` | `sdk.prepareSendPayment({ paymentRequest, amount? })` → `response.paymentMethod.lightningFeeSats` |
| `wallet.payLightningInvoice({ invoice, maxFeeSats, preferSpark, amountSatsToSend })` | `sdk.sendPayment({ prepareResponse, idempotencyKey, options: { type: 'bolt11Invoice', preferSpark: false } })` |
| `wallet.createLightningInvoice({ amountSats, receiverIdentityPubkey, memo })` | `sdk.receivePayment({ paymentMethod: { type: 'bolt11Invoice', description, amountSats } })` |
| `wallet.getLightningReceiveRequest(id)` → status enum | `sdk.listPayments({ typeFilter: ['receive'] })` → match by invoice → `payment.status` |
| `wallet.getLightningSendRequest(id)` → status enum | `sdk.getPayment({ paymentId })` → `payment.status` |
| `wallet.on(SparkWalletEvent.BalanceUpdate, handler)` | `sdk.addEventListener(listener)` with `SdkEvent` types |
| `wallet.setPrivacyEnabled(true)` | `sdk.updateUserSettings({ sparkPrivateModeEnabled: true })` |
| `wallet.getLeaves(true)` | Not needed (debug logging only) |
| `wallet.isOptimizationInProgress()` | `sdk.getLeafOptimizationProgress().isRunning` |
| `wallet.getTransfers(pageSize, offset)` | Not needed (idempotencyKey replaces manual dedup) |
| `SparkError` with `.getContext()` | Plain `Error` — `message.includes('insufficient funds')` |
| `LightningReceiveRequestStatus.TRANSFER_COMPLETED` | `payment.status === 'completed'` |
| `LightningSendRequestStatus.TRANSFER_COMPLETED` | `payment.status === 'completed'` |
| `LightningSendRequestStatus.USER_SWAP_RETURNED` | `payment.status === 'failed'` |
| `NetworkType` (`'MAINNET'`, `'REGTEST'`) | `Network` (`'mainnet'`, `'regtest'`) |
| `CurrencyAmount` (object with `originalUnit`, `originalValue`) | `bigint` (always sats) |
| `DefaultSparkSigner` | `defaultExternalSigner(mnemonic, null, network)` |

---

## Tasks

### Task 1: Add Breez SDK dependency and WASM init

**Files:**
- Modify: `package.json`
- Modify: `app/entry.client.tsx`

- [ ] **Step 1: Add Breez SDK to package.json**

```bash
bun add @breeztech/breez-sdk-spark@0.12.2-dev3
```

- [ ] **Step 2: Update WASM init in entry.client.tsx**

Replace the Phase C prototype WASM init block with a production-ready version.

In `app/entry.client.tsx`, find and replace this block:

```typescript
// Initialize Breez SDK WASM module (prototype validation — remove after Phase C)
{
  const wasmStart = performance.now();
  import('@breeztech/breez-sdk-spark').then((sdk) =>
    sdk.default().then(() => {
      (globalThis as Record<string, unknown>).__BREEZ_WASM_INIT_MS__ =
        Math.round(performance.now() - wasmStart);
      console.log(
        `[Breez] WASM init: ${(globalThis as Record<string, unknown>).__BREEZ_WASM_INIT_MS__}ms`,
      );
    }),
  );
}
```

With:

```typescript
// Initialize Breez SDK WASM module before any SDK usage
import('@breeztech/breez-sdk-spark').then((sdk) => sdk.default());
```

- [ ] **Step 3: Verify**

Run: `bun run fix:all`
Expected: No errors related to entry.client.tsx

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock app/entry.client.tsx
git commit -m "feat: add breez-sdk-spark dependency and production WASM init"
```

---

### Task 2: Create Breez adapter layer

**Files:**
- Create: `app/lib/breez-spark/init.ts`
- Create: `app/lib/breez-spark/events.ts`
- Create: `app/lib/breez-spark/types.ts`

- [ ] **Step 1: Create `app/lib/breez-spark/types.ts`**

```typescript
import type {
  BreezSdk,
  Config,
  EventListener,
  Network,
  Payment,
  PaymentDetails,
  PaymentStatus,
  SdkEvent,
} from '@breeztech/breez-sdk-spark';
import type { SparkAccount } from '~/features/accounts/account';

export type {
  BreezSdk,
  Config,
  EventListener,
  Network as BreezNetwork,
  Payment,
  PaymentDetails,
  PaymentStatus,
  SdkEvent,
};

/**
 * Gets the BreezSdk instance from a Spark account.
 *
 * During the migration period, Lightning Address still uses the old SparkWallet
 * on the server side. All CLIENT-SIDE code should use this accessor.
 * Remove this function after Lightning Address migrates to Breez.
 */
export function getBreezSdk(account: SparkAccount): BreezSdk {
  return account.wallet;
}
```

- [ ] **Step 2: Create `app/lib/breez-spark/init.ts`**

```typescript
import type { BreezSdk, Config, Network } from '@breeztech/breez-sdk-spark';

function getBreezApiKey(): string {
  const apiKey = import.meta.env.VITE_BREEZ_API_KEY;
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error('VITE_BREEZ_API_KEY is not set. Add it to your .env file.');
  }
  return apiKey;
}

let loggingInitialized = false;

async function ensureLogging() {
  if (loggingInitialized) return;
  const { initLogging } = await import('@breeztech/breez-sdk-spark');
  try {
    await initLogging(
      {
        log: (entry) =>
          console.log(`[Breez ${entry.level}] ${entry.line}`),
      },
      'debug',
    );
    loggingInitialized = true;
  } catch {
    // Already initialized in this session
    loggingInitialized = true;
  }
}

/**
 * Connects to the Breez SDK and returns a BreezSdk instance.
 * WASM must be initialized first (done in entry.client.tsx).
 *
 * @param mnemonic - BIP39 mnemonic phrase for wallet derivation
 * @param network - 'mainnet' or 'regtest'
 */
export async function connectBreezWallet(
  mnemonic: string,
  network: Network = 'mainnet',
): Promise<BreezSdk> {
  await ensureLogging();
  const { connect, defaultConfig } = await import('@breeztech/breez-sdk-spark');

  const config: Config = {
    ...defaultConfig(network),
    apiKey: getBreezApiKey(),
  };

  return connect({
    config,
    seed: { type: 'mnemonic' as const, mnemonic },
    storageDir: `breez-spark-wallet-${network}`,
  });
}
```

- [ ] **Step 3: Create `app/lib/breez-spark/events.ts`**

```typescript
import type { EventListener, SdkEvent } from '@breeztech/breez-sdk-spark';

export type EventLogEntry = {
  timestamp: Date;
  eventType: SdkEvent['type'];
  data: SdkEvent;
};

export type OnEventCallback = (entry: EventLogEntry) => void;

/**
 * Creates an EventListener compatible with the Breez SDK.
 * Pass the returned listener to `sdk.addEventListener(listener)`.
 *
 * @example
 * const listener = createEventListener((entry) => console.log(entry));
 * const listenerId = await sdk.addEventListener(listener);
 * // later:
 * await sdk.removeEventListener(listenerId);
 */
export function createEventListener(onEvent: OnEventCallback): EventListener {
  return {
    onEvent(e: SdkEvent): void {
      onEvent({
        timestamp: new Date(),
        eventType: e.type,
        data: e,
      });
    },
  };
}
```

- [ ] **Step 4: Verify new files compile**

Run: `bun run fix:all`
Expected: No new errors (these files are additive — nothing imports them yet)

- [ ] **Step 5: Commit**

```bash
git add app/lib/breez-spark/
git commit -m "feat: create Breez SDK adapter layer (init, events, types)"
```

---

### Task 3: Replace SparkNetwork type and error matchers

**Files:**
- Modify: `app/features/agicash-db/json-models/spark-account-details-db-data.ts`
- Modify: `app/lib/spark/errors.ts`

- [ ] **Step 1: Export SparkNetwork type from DB schema**

In `app/features/agicash-db/json-models/spark-account-details-db-data.ts`, add after the existing `SparkAccountDetailsDbData` type export:

```typescript
/**
 * Spark network type derived from the DB schema.
 * This is the canonical representation used throughout the app.
 * Maps to Breez SDK's Network type via toBreezNetwork().
 */
export type SparkNetwork = SparkAccountDetailsDbData['network'];

/**
 * Maps app-level SparkNetwork to Breez SDK's Network type.
 * Only MAINNET and REGTEST are supported.
 */
export function toBreezNetwork(
  network: SparkNetwork,
): 'mainnet' | 'regtest' {
  switch (network) {
    case 'MAINNET':
      return 'mainnet';
    case 'REGTEST':
    case 'LOCAL':
      return 'regtest';
    default:
      throw new Error(
        `Unsupported Spark network for Breez SDK: ${network}`,
      );
  }
}
```

- [ ] **Step 2: Replace error matchers**

Replace the entire contents of `app/lib/spark/errors.ts` with:

```typescript
/**
 * Checks if an error is an insufficient balance error from the Breez SDK.
 * Breez errors are plain Error objects — match on message content.
 *
 * Phase C validation confirmed: message contains "insufficient funds".
 */
export const isInsufficentBalanceError = (error: unknown): error is Error => {
  if (!(error instanceof Error)) return false;
  const lower = error.message.toLowerCase();
  return (
    lower.includes('insufficient funds') ||
    lower.includes('insufficient balance')
  );
};

/**
 * Checks if an error indicates the invoice was already paid.
 * Breez errors are plain Error objects — match on message content.
 *
 * Phase C validation confirmed: message contains "preimage request already exists".
 */
export const isInvoiceAlreadyPaidError = (error: unknown): error is Error => {
  if (!(error instanceof Error)) return false;
  return error.message
    .toLowerCase()
    .includes('preimage request already exists');
};
```

- [ ] **Step 3: Verify**

Run: `bun run fix:all`
Expected: May show errors in files that still import the old SDK types — those are fixed in subsequent tasks.

- [ ] **Step 4: Commit**

```bash
git add app/features/agicash-db/json-models/spark-account-details-db-data.ts app/lib/spark/errors.ts
git commit -m "feat: local SparkNetwork type and Breez error matchers"
```

---

### Task 4: Update Account types and utility functions

**Files:**
- Modify: `app/features/accounts/account.ts`
- Modify: `app/features/accounts/account-repository.ts`
- Modify: `app/features/user/user-repository.ts`
- Modify: `app/lib/spark/utils.ts`
- Modify: `app/lib/spark/index.ts`

- [ ] **Step 1: Update Account types**

In `app/features/accounts/account.ts`:

Replace:
```typescript
import type {
  NetworkType as SparkNetwork,
  SparkWallet,
} from '@buildonspark/spark-sdk';
```

With:
```typescript
import type { BreezSdk } from '@breeztech/breez-sdk-spark';
import type { SparkNetwork } from '../agicash-db/json-models/spark-account-details-db-data';
```

Replace the spark variant's `wallet` type:
```typescript
      wallet: SparkWallet;
```
With:
```typescript
      wallet: BreezSdk;
```

- [ ] **Step 2: Update account-repository.ts**

In `app/features/accounts/account-repository.ts`:

Replace:
```typescript
import type { NetworkType as SparkNetwork } from '@buildonspark/spark-sdk';
```

With:
```typescript
import type { SparkNetwork } from '../agicash-db/json-models/spark-account-details-db-data';
```

- [ ] **Step 3: Update user-repository.ts**

In `app/features/user/user-repository.ts`:

Replace:
```typescript
import type { NetworkType } from '@buildonspark/spark-sdk';
```

With:
```typescript
import type { SparkNetwork } from '../agicash-db/json-models/spark-account-details-db-data';
```

Then replace all usages of `NetworkType` with `SparkNetwork` in the file (the type is used in `getInitializedSparkWallet(network: NetworkType)` — change to `getInitializedSparkWallet(network: SparkNetwork)`).

- [ ] **Step 4: Update utility functions**

Replace the entire contents of `app/lib/spark/utils.ts` with:

```typescript
import type { BreezSdk } from '@breeztech/breez-sdk-spark';
import { bytesToHex } from '@noble/hashes/utils';
import { Money } from '../money';

/**
 * Creates a Money<'BTC'> from a sats amount (bigint or number).
 * Replaces the old moneyFromSparkAmount which took CurrencyAmount objects.
 */
export function moneyFromSats(sats: bigint | number): Money<'BTC'> {
  return new Money({
    amount: Number(sats),
    currency: 'BTC',
    unit: 'sat',
  });
}

/**
 * Gets the Spark identity public key from a mnemonic using the Breez SDK signer.
 * Returns the same key as the old DefaultSparkSigner — confirmed by Phase C validation (C1).
 *
 * Requires WASM to be initialized (client-side only).
 */
export async function getSparkIdentityPublicKeyFromMnemonic(
  mnemonic: string,
  network: 'mainnet' | 'regtest',
): Promise<string> {
  const { defaultExternalSigner } = await import(
    '@breeztech/breez-sdk-spark'
  );
  const signer = defaultExternalSigner(mnemonic, null, network);
  const publicKeyBytes = signer.identityPublicKey();
  // PublicKeyBytes from WASM is Uint8Array-like
  return bytesToHex(new Uint8Array(publicKeyBytes as unknown as ArrayBuffer));
}

/**
 * Creates a BreezSdk stub that throws when any method is called.
 * Used for offline wallets where Spark is unreachable.
 */
export function createSparkWalletStub(reason: string): BreezSdk {
  return new Proxy({} as BreezSdk, {
    get(_target, prop) {
      if (typeof prop === 'string') {
        return () => {
          console.error(`Cannot call ${prop} on Spark wallet stub`);
          throw new Error(reason);
        };
      }
      return undefined;
    },
  });
}
```

- [ ] **Step 5: Update `app/lib/spark/index.ts`**

Replace the entire contents with:

```typescript
export { isInsufficentBalanceError, isInvoiceAlreadyPaidError } from './errors';
export {
  createSparkWalletStub,
  getSparkIdentityPublicKeyFromMnemonic,
  moneyFromSats,
} from './utils';
```

- [ ] **Step 6: Commit** (fix:all will still fail — downstream consumers not yet updated)

```bash
git add app/features/accounts/account.ts app/features/accounts/account-repository.ts app/features/user/user-repository.ts app/lib/spark/utils.ts app/lib/spark/index.ts
git commit -m "feat: update Account types and utils for Breez SDK"
```

---

### Task 5: Wallet init and event-driven balance

**Files:**
- Modify: `app/features/shared/spark.ts`
- Modify: `app/routes/_protected.tsx` (if needed)

- [ ] **Step 1: Rewrite `app/features/shared/spark.ts`**

Replace the entire file contents with:

```typescript
import { getPrivateKey as getMnemonic } from '@agicash/opensecret';
import type { BreezSdk, SdkEvent } from '@breeztech/breez-sdk-spark';
import {
  type QueryClient,
  queryOptions,
  useQueryClient,
} from '@tanstack/react-query';
import { useRef } from 'react';
import { useEffectNoStrictMode } from '~/hooks/use-effect-no-strict-mode';
import { type Currency, Money } from '~/lib/money';
import { connectBreezWallet } from '~/lib/breez-spark/init';
import { createEventListener } from '~/lib/breez-spark/events';
import { measureOperation } from '~/lib/performance';
import { computeSHA256 } from '~/lib/sha256';
import {
  createSparkWalletStub,
  getSparkIdentityPublicKeyFromMnemonic,
  moneyFromSats,
} from '~/lib/spark';
import {
  type SparkNetwork,
  toBreezNetwork,
} from '../agicash-db/json-models/spark-account-details-db-data';
import { getSeedPhraseDerivationPath } from '../accounts/account-cryptography';
import { useAccounts, useAccountsCache } from '../accounts/account-hooks';
import { getDefaultUnit } from './currencies';
import { getFeatureFlag } from './feature-flags';

export function sparkDebugLog(
  message: string,
  data?: Record<string, unknown>,
) {
  if (getFeatureFlag('DEBUG_LOGGING_SPARK')) {
    console.debug(`[Spark] ${message}`, data ?? '');
  }
}

const seedDerivationPath = getSeedPhraseDerivationPath('spark', 12);

export const sparkMnemonicQueryOptions = () =>
  queryOptions({
    queryKey: ['spark-mnemonic'],
    queryFn: async () => {
      const response = await getMnemonic({
        seed_phrase_derivation_path: seedDerivationPath,
      });
      return response.mnemonic;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });

export const sparkIdentityPublicKeyQueryOptions = ({
  queryClient,
  network,
}: {
  queryClient: QueryClient;
  network: SparkNetwork;
}) =>
  queryOptions({
    queryKey: ['spark-identity-public-key'],
    queryFn: async () => {
      const mnemonic = await queryClient.fetchQuery(
        sparkMnemonicQueryOptions(),
      );
      return await getSparkIdentityPublicKeyFromMnemonic(
        mnemonic,
        toBreezNetwork(network),
      );
    },
  });

export const sparkWalletQueryOptions = ({
  network,
  mnemonic,
}: { network: SparkNetwork; mnemonic: string }) =>
  queryOptions({
    queryKey: ['spark-wallet', computeSHA256(mnemonic), network],
    queryFn: async () => {
      const breezNetwork = toBreezNetwork(network);
      const sdk = await measureOperation(
        'BreezSdk.connect',
        () => connectBreezWallet(mnemonic, breezNetwork),
        { 'spark.network': network },
      );

      await sdk.updateUserSettings({ sparkPrivateModeEnabled: true });

      return sdk;
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });

export function sparkBalanceQueryKey(accountId: string) {
  return ['spark-balance', accountId];
}

/**
 * Event-driven balance tracker for Spark accounts.
 *
 * Registers a Breez SDK event listener on each Spark account wallet.
 * On paymentSucceeded/paymentPending/synced events, fetches fresh balance
 * from getInfo() and updates the accounts cache.
 *
 * Replaces the old 3-second polling approach.
 * Phase C validation confirmed events fire reliably and balance updates
 * immediately on paymentSucceeded events.
 */
export function useTrackAndUpdateSparkAccountBalances() {
  const { data: sparkAccounts } = useAccounts({ type: 'spark' });
  const accountCache = useAccountsCache();
  const queryClient = useQueryClient();
  const listenerIdsRef = useRef<Map<string, string>>(new Map());

  useEffectNoStrictMode(() => {
    const registrations: Array<{
      accountId: string;
      sdk: BreezSdk;
      listenerId: string;
    }> = [];

    const registerListeners = async () => {
      for (const account of sparkAccounts) {
        if (!account.isOnline) continue;

        // Skip if already registered
        if (listenerIdsRef.current.has(account.id)) continue;

        const sdk = account.wallet;

        const updateBalance = async (reason: string) => {
          try {
            const info = await sdk.getInfo({});
            const newBalance = new Money({
              amount: info.balanceSats,
              currency: account.currency as Currency,
              unit: getDefaultUnit(account.currency),
            });

            sparkDebugLog('Event-driven balance update', {
              accountId: account.id,
              reason,
              balanceSats: info.balanceSats,
              prevOwned: account.ownedBalance?.toString() ?? 'null',
              newBalance: newBalance.toString(),
            });

            accountCache.updateSparkAccountIfBalanceOrWalletChanged({
              ...account,
              ownedBalance: newBalance,
              availableBalance: newBalance,
            });
          } catch (error) {
            console.error('Failed to update balance after event', {
              cause: error,
              accountId: account.id,
              reason,
            });
          }
        };

        const listener = createEventListener((entry) => {
          sparkDebugLog('Breez event', {
            accountId: account.id,
            type: entry.eventType,
          });

          if (
            entry.eventType === 'paymentSucceeded' ||
            entry.eventType === 'paymentPending' ||
            entry.eventType === 'synced'
          ) {
            updateBalance(entry.eventType);
          }
        });

        try {
          const listenerId = await sdk.addEventListener(listener);
          listenerIdsRef.current.set(account.id, listenerId);
          registrations.push({ accountId: account.id, sdk, listenerId });

          sparkDebugLog('Registered Breez event listener', {
            accountId: account.id,
            listenerId,
          });

          // Fetch initial balance
          await updateBalance('initial');
        } catch (error) {
          console.error('Failed to register Breez event listener', {
            cause: error,
            accountId: account.id,
          });
        }
      }
    };

    registerListeners();

    return () => {
      for (const { accountId, sdk, listenerId } of registrations) {
        sdk.removeEventListener(listenerId).catch((error) => {
          console.error('Failed to remove Breez event listener', {
            cause: error,
            accountId,
          });
        });
        listenerIdsRef.current.delete(accountId);
      }
    };
  }, [sparkAccounts]);
}

/**
 * Initializes a Spark wallet with offline handling.
 * If Breez SDK is unreachable or times out, returns a stub wallet.
 */
export async function getInitializedSparkWallet(
  queryClient: QueryClient,
  mnemonic: string,
  network: SparkNetwork,
): Promise<{
  wallet: BreezSdk;
  ownedBalance: Money | null;
  availableBalance: Money | null;
  isOnline: boolean;
}> {
  return measureOperation(
    'getInitializedSparkWallet',
    async () => {
      try {
        const sdk = await queryClient.fetchQuery(
          sparkWalletQueryOptions({ network, mnemonic }),
        );
        const info = await measureOperation('BreezSdk.getInfo', () =>
          sdk.getInfo({}),
        );

        const balance = moneyFromSats(info.balanceSats);
        return {
          wallet: sdk,
          ownedBalance: balance as Money,
          availableBalance: balance as Money,
          isOnline: true,
        };
      } catch (error) {
        console.error('Failed to initialize Breez wallet', { cause: error });
        return {
          wallet: createSparkWalletStub(
            'Spark is offline, please try again later.',
          ),
          ownedBalance: null,
          availableBalance: null,
          isOnline: false,
        };
      }
    },
    { sparkNetwork: network },
  );
}
```

- [ ] **Step 2: Update `_protected.tsx` if needed**

In `app/routes/_protected.tsx`, find the `sparkIdentityPublicKeyQueryOptions` call and remove the `accountNumber` parameter if present — the Breez signer handles account number internally.

The call should look like:
```typescript
sparkIdentityPublicKeyQueryOptions({ queryClient, network: 'MAINNET' }),
```

(no `accountNumber` parameter)

- [ ] **Step 3: Commit**

```bash
git add app/features/shared/spark.ts app/routes/_protected.tsx
git commit -m "feat: Breez wallet init and event-driven balance updates"
```

---

### Task 6: Send flow migration

**Files:**
- Modify: `app/features/send/spark-send-quote-service.ts`
- Modify: `app/features/send/spark-send-quote-hooks.ts`

- [ ] **Step 1: Rewrite spark-send-quote-service.ts**

Replace the entire file contents with:

```typescript
import type { BreezSdk } from '@breeztech/breez-sdk-spark';
import { parseBolt11Invoice } from '~/lib/bolt11';
import { getBreezSdk } from '~/lib/breez-spark/types';
import { Money } from '~/lib/money';
import { measureOperation } from '~/lib/performance';
import { isInsufficentBalanceError, isInvoiceAlreadyPaidError, moneyFromSats } from '~/lib/spark';
import type { SparkAccount } from '../accounts/account';
import { DomainError } from '../shared/error';
import type { TransactionPurpose } from '../transactions/transaction-enums';
import type { SparkSendQuote } from './spark-send-quote';
import {
  type SparkSendQuoteRepository,
  useSparkSendQuoteRepository,
} from './spark-send-quote-repository';

export type SparkLightningQuote = {
  /**
   * The payment request to pay.
   */
  paymentRequest: string;
  /**
   * Payment hash of the lightning invoice.
   */
  paymentHash: string;
  /**
   * The amount requested.
   */
  amountRequested: Money;
  /**
   * The amount requested in BTC.
   */
  amountRequestedInBtc: Money<'BTC'>;
  /**
   * The amount that the receiver will receive.
   */
  amountToReceive: Money;
  /**
   * The estimated fee.
   */
  estimatedLightningFee: Money<'BTC'>;
  /**
   * The estimated total fee (lightning fee).
   */
  estimatedTotalFee: Money;
  /**
   * Estimated total amount of the send (amount to receive + estimated lightning fee).
   */
  estimatedTotalAmount: Money;
  /**
   * Whether the payment request has an amount encoded in the invoice.
   */
  paymentRequestIsAmountless: boolean;
  /**
   * The expiry date of the lightning invoice.
   */
  expiresAt: Date | null;
};

type GetSparkSendQuoteOptions = {
  account: SparkAccount;
  paymentRequest: string;
  amount?: Money<'BTC'>;
};

type CreateSendQuoteParams = {
  userId: string;
  account: SparkAccount;
  quote: SparkLightningQuote;
  purpose?: TransactionPurpose;
  transferId?: string;
};

type InitiateSendParams = {
  account: SparkAccount;
  sendQuote: SparkSendQuote;
};

export class SparkSendQuoteService {
  constructor(private readonly repository: SparkSendQuoteRepository) {}

  /**
   * Estimates the fee for paying a Lightning invoice using Breez SDK's prepareSendPayment.
   */
  async getLightningSendQuote({
    account,
    amount,
    paymentRequest,
  }: GetSparkSendQuoteOptions): Promise<SparkLightningQuote> {
    const bolt11ValidationResult = parseBolt11Invoice(paymentRequest);
    if (!bolt11ValidationResult.valid) {
      throw new DomainError('Invalid lightning invoice');
    }
    const invoice = bolt11ValidationResult.decoded;
    const expiresAt = invoice.expiryUnixMs
      ? new Date(invoice.expiryUnixMs)
      : null;

    if (expiresAt && expiresAt < new Date()) {
      throw new DomainError('Lightning invoice has expired');
    }

    let amountRequestedInBtc = new Money({
      amount: 0,
      currency: 'BTC',
    });

    if (invoice.amountMsat) {
      amountRequestedInBtc = new Money({
        amount: invoice.amountMsat,
        currency: 'BTC',
        unit: 'msat',
      });
    } else if (amount) {
      amountRequestedInBtc = amount;
    } else {
      throw new Error('Unknown send amount');
    }

    const sdk = getBreezSdk(account);

    const prepareResponse = await measureOperation(
      'BreezSdk.prepareSendPayment',
      () =>
        sdk.prepareSendPayment({
          paymentRequest,
          amount: invoice.amountMsat
            ? undefined
            : BigInt(amountRequestedInBtc.toNumber('sat')),
        }),
    );

    let estimatedLightningFeeSats = 0;
    if (prepareResponse.paymentMethod.type === 'bolt11Invoice') {
      estimatedLightningFeeSats =
        prepareResponse.paymentMethod.lightningFeeSats +
        (prepareResponse.paymentMethod.sparkTransferFeeSats ?? 0);
    }

    const estimatedLightningFee = new Money({
      amount: estimatedLightningFeeSats,
      currency: 'BTC',
      unit: 'sat',
    });

    const estimatedTotalAmount = amountRequestedInBtc.add(
      estimatedLightningFee,
    ) as Money;

    const ownedBalance = account.ownedBalance ?? Money.zero(account.currency);
    const availableBalance =
      account.availableBalance ?? Money.zero(account.currency);

    if (availableBalance.lessThan(estimatedTotalAmount)) {
      const estimatedTotalFormatted = estimatedTotalAmount.toLocaleString({
        unit: 'sat',
      });
      const hasSufficientOwned =
        ownedBalance.greaterThanOrEqual(estimatedTotalAmount);

      if (hasSufficientOwned) {
        const availableFormatted = availableBalance.toLocaleString({
          unit: 'sat',
        });
        throw new DomainError(
          `Insufficient balance. Estimated total including fee is ${estimatedTotalFormatted} but the available balance is ${availableFormatted} because some of your funds are locked in a pending transfer.`,
        );
      }

      throw new DomainError(
        `Insufficient balance. Estimated total including fee is ${estimatedTotalFormatted}.`,
      );
    }

    return {
      paymentRequest,
      paymentHash: invoice.paymentHash,
      amountRequested: amountRequestedInBtc as Money,
      amountRequestedInBtc,
      amountToReceive: amountRequestedInBtc as Money,
      estimatedLightningFee,
      estimatedTotalFee: estimatedLightningFee as Money,
      estimatedTotalAmount,
      paymentRequestIsAmountless: invoice.amountMsat === undefined,
      expiresAt,
    };
  }

  /**
   * Creates a send quote in UNPAID state.
   */
  async createSendQuote({
    userId,
    account,
    quote,
    purpose,
    transferId,
  }: CreateSendQuoteParams): Promise<SparkSendQuote> {
    if (quote.expiresAt && quote.expiresAt < new Date()) {
      throw new DomainError('Lightning invoice has expired');
    }

    const ownedBalance = account.ownedBalance ?? Money.zero(account.currency);
    const availableBalance =
      account.availableBalance ?? Money.zero(account.currency);

    if (availableBalance.lessThan(quote.estimatedTotalAmount)) {
      const estimatedTotalFormatted = quote.estimatedTotalAmount.toLocaleString(
        { unit: 'sat' },
      );
      const hasSufficientOwned = ownedBalance.greaterThanOrEqual(
        quote.estimatedTotalAmount,
      );

      if (hasSufficientOwned) {
        const availableFormatted = availableBalance.toLocaleString({
          unit: 'sat',
        });
        throw new DomainError(
          `Insufficient balance. Estimated total including fee is ${estimatedTotalFormatted} but the available balance is ${availableFormatted} because some of your funds are locked in a pending transfer.`,
        );
      }

      throw new DomainError(
        `Insufficient balance. Estimated total including fee is ${estimatedTotalFormatted}.`,
      );
    }

    return this.repository.create({
      userId,
      accountId: account.id,
      amount: quote.amountRequestedInBtc as Money,
      estimatedFee: quote.estimatedLightningFee as Money,
      paymentRequest: quote.paymentRequest,
      paymentHash: quote.paymentHash,
      paymentRequestIsAmountless: quote.paymentRequestIsAmountless,
      expiresAt: quote.expiresAt,
      purpose,
      transferId,
    });
  }

  /**
   * Initiates the lightning payment for an UNPAID quote using Breez SDK's
   * two-step flow: prepareSendPayment → sendPayment with idempotencyKey.
   */
  async initiateSend({
    account,
    sendQuote,
  }: InitiateSendParams): Promise<SparkSendQuote> {
    if (sendQuote.state === 'PENDING') {
      return sendQuote;
    }

    if (sendQuote.state !== 'UNPAID') {
      throw new Error(
        `Cannot initiate send for quote that is not UNPAID. Current state: ${sendQuote.state}`,
      );
    }

    const sdk = getBreezSdk(account);

    try {
      // Fresh prepare — fees may differ slightly from the estimate shown to user
      const prepareResponse = await measureOperation(
        'BreezSdk.prepareSendPayment',
        () =>
          sdk.prepareSendPayment({
            paymentRequest: sendQuote.paymentRequest,
            amount: sendQuote.paymentRequestIsAmountless
              ? BigInt(sendQuote.amount.toNumber('sat'))
              : undefined,
          }),
      );

      const sendResponse = await measureOperation(
        'BreezSdk.sendPayment',
        () =>
          sdk.sendPayment({
            prepareResponse,
            idempotencyKey: sendQuote.id,
            options: {
              type: 'bolt11Invoice' as const,
              preferSpark: false,
            },
          }),
      );

      const payment = sendResponse.payment;
      const fee = moneyFromSats(payment.fees);

      return this.repository.markAsPending({
        quote: sendQuote,
        sparkSendRequestId: payment.id,
        sparkTransferId: payment.id,
        fee,
      });
    } catch (error) {
      if (isInsufficentBalanceError(error)) {
        throw new DomainError(
          'Insufficient balance. Your balance may have changed since the quote was created.',
        );
      }

      if (isInvoiceAlreadyPaidError(error)) {
        throw new DomainError('Lightning invoice has already been paid.');
      }

      throw error;
    }
  }

  async get(quoteId: string): Promise<SparkSendQuote | null> {
    return this.repository.get(quoteId);
  }

  async complete(
    quote: SparkSendQuote,
    paymentPreimage: string,
  ): Promise<SparkSendQuote> {
    if (quote.state === 'COMPLETED') {
      return quote;
    }

    if (quote.state !== 'PENDING') {
      throw new Error(
        `Cannot complete quote that is not pending. State: ${quote.state}`,
      );
    }

    return this.repository.complete({
      quote,
      paymentPreimage,
    });
  }

  async fail(quote: SparkSendQuote, reason: string): Promise<SparkSendQuote> {
    if (quote.state === 'FAILED') {
      return quote;
    }

    if (quote.state !== 'PENDING' && quote.state !== 'UNPAID') {
      throw new Error(
        `Cannot fail quote that is not unpaid or pending. State: ${quote.state}`,
      );
    }

    return this.repository.fail(quote.id, reason);
  }
}

export function useSparkSendQuoteService() {
  const repository = useSparkSendQuoteRepository();
  return new SparkSendQuoteService(repository);
}
```

- [ ] **Step 2: Update spark-send-quote-hooks.ts**

Replace the import at the top:
```typescript
import { LightningSendRequestStatus } from '@buildonspark/spark-sdk/types';
```
With: (remove it entirely — no replacement needed)

In the `checkQuoteStatus` function inside `useOnSparkSendStateChange`, replace the `getLightningSendRequest` polling block. Find this code (approximately lines 186-232):

```typescript
      const sendRequest = await measureOperation(
        'SparkWallet.getLightningSendRequest',
        () => account.wallet.getLightningSendRequest(quote.sparkId),
        { sendRequestId: quote.sparkId },
      );

      if (!sendRequest) {
        return;
      }

      if (
        sendRequest.status === LightningSendRequestStatus.TRANSFER_COMPLETED &&
        lastTriggeredStateRef.current.get(quoteId) !== 'COMPLETED'
      ) {
        if (!sendRequest.paymentPreimage) {
          throw new Error(
            'Payment preimage is required when send request has TRANSFER_COMPLETED status.',
          );
        }

        lastTriggeredStateRef.current.set(quoteId, 'COMPLETED');

        sparkDebugLog('Send payment detected as completed', {
          quoteId: quote.id,
          accountId: quote.accountId,
        });
        onCompletedRef.current(quote, {
          paymentPreimage: sendRequest.paymentPreimage,
        });
        return;
      }

      if (
        sendRequest.status === LightningSendRequestStatus.USER_SWAP_RETURNED &&
        lastTriggeredStateRef.current.get(quoteId) !== 'FAILED'
      ) {
        lastTriggeredStateRef.current.set(quoteId, 'FAILED');

        const now = new Date();
        const message =
          quote.expiresAt && new Date(quote.expiresAt) < now
            ? 'Lightning invoice expired.'
            : 'Lightning payment failed.';

        onFailedRef.current(quote, message);
      }
```

Replace with:

```typescript
      const sdk = account.wallet;
      const { payment } = await measureOperation(
        'BreezSdk.getPayment',
        () => sdk.getPayment({ paymentId: quote.sparkId }),
        { paymentId: quote.sparkId },
      );

      if (!payment) {
        return;
      }

      if (
        payment.status === 'completed' &&
        lastTriggeredStateRef.current.get(quoteId) !== 'COMPLETED'
      ) {
        const preimage =
          payment.details?.type === 'lightning'
            ? payment.details.htlcDetails.preimage
            : undefined;

        if (!preimage) {
          throw new Error(
            'Payment preimage is required when payment status is completed.',
          );
        }

        lastTriggeredStateRef.current.set(quoteId, 'COMPLETED');

        sparkDebugLog('Send payment detected as completed', {
          quoteId: quote.id,
          accountId: quote.accountId,
        });
        onCompletedRef.current(quote, {
          paymentPreimage: preimage,
        });
        return;
      }

      if (
        payment.status === 'failed' &&
        lastTriggeredStateRef.current.get(quoteId) !== 'FAILED'
      ) {
        lastTriggeredStateRef.current.set(quoteId, 'FAILED');

        const now = new Date();
        const message =
          quote.expiresAt && new Date(quote.expiresAt) < now
            ? 'Lightning invoice expired.'
            : 'Lightning payment failed.';

        onFailedRef.current(quote, message);
      }
```

Also add the import for `getBreezSdk` if `account.wallet` needs it. Since `Account.wallet` is now typed as `BreezSdk`, direct access works — no cast needed.

- [ ] **Step 3: Commit**

```bash
git add app/features/send/spark-send-quote-service.ts app/features/send/spark-send-quote-hooks.ts
git commit -m "feat: migrate send flow to Breez SDK (prepareSendPayment + sendPayment)"
```

---

### Task 7: Receive flow migration

**Files:**
- Modify: `app/features/receive/spark-receive-quote-core.ts`
- Modify: `app/features/receive/spark-receive-quote-hooks.ts`
- Modify: `app/features/receive/spark-receive-quote-service.ts`
- Modify: `app/features/receive/claim-cashu-token-service.ts`

- [ ] **Step 1: Rewrite spark-receive-quote-core.ts**

Replace the entire file contents with:

```typescript
import type { BreezSdk } from '@breeztech/breez-sdk-spark';
import type { Proof } from '@cashu/cashu-ts';
import { parseBolt11Invoice } from '~/lib/bolt11';
import { Money } from '~/lib/money';
import { measureOperation } from '~/lib/performance';
import type { SparkAccount } from '../accounts/account';
import type { TransactionPurpose } from '../transactions/transaction-enums';

export type SparkReceiveLightningQuote = {
  /**
   * Tracking ID for this receive. Stores the payment hash from the bolt11 invoice.
   * Used to match against Breez SDK payments for status checking.
   */
  id: string;
  createdAt: string;
  updatedAt: string;
  invoice: {
    encodedInvoice: string;
    paymentHash: string;
    amount: Money<'BTC'>;
    createdAt: string;
    expiresAt: string;
    memo?: string;
  };
  /** Fee charged by Breez for creating the invoice (usually 0 for receives). */
  fee: Money<'BTC'>;
  /** Only populated when creating invoices on behalf of another user (Lightning Address). */
  receiverIdentityPublicKey?: string;
};

export type GetLightningQuoteParams = {
  /**
   * The Breez SDK instance to create the invoice with.
   */
  wallet: BreezSdk;
  /**
   * The amount to receive.
   */
  amount: Money;
  /**
   * Description to include in the Lightning invoice memo.
   */
  description?: string;
};

export type CreateQuoteBaseParams = {
  userId: string;
  account: SparkAccount;
  lightningQuote: SparkReceiveLightningQuote;
  purpose?: TransactionPurpose;
  transferId?: string;
} & (
  | {
      receiveType: 'LIGHTNING';
    }
  | {
      receiveType: 'CASHU_TOKEN';
      tokenAmount: Money;
      sourceMintUrl: string;
      tokenProofs: Proof[];
      meltQuoteId: string;
      meltQuoteExpiresAt: string;
      cashuReceiveFee: Money;
      lightningFeeReserve: Money;
    }
);

export type RepositoryCreateQuoteParams = {
  userId: string;
  accountId: string;
  amount: Money;
  paymentRequest: string;
  paymentHash: string;
  expiresAt: string;
  description?: string;
  sparkId: string;
  receiverIdentityPubkey?: string;
  totalFee: Money;
  purpose?: TransactionPurpose;
  transferId?: string;
} & (
  | {
      receiveType: 'LIGHTNING';
    }
  | {
      receiveType: 'CASHU_TOKEN';
      meltData: {
        tokenMintUrl: string;
        meltQuoteId: string;
        tokenAmount: Money;
        tokenProofs: Proof[];
        cashuReceiveFee: Money;
        lightningFeeReserve: Money;
      };
    }
);

/**
 * Creates a Lightning invoice via Breez SDK and returns a quote.
 * Parses the bolt11 invoice to extract payment hash, expiry, and amount.
 */
export async function getLightningQuote({
  wallet,
  amount,
  description,
}: GetLightningQuoteParams): Promise<SparkReceiveLightningQuote> {
  const response = await measureOperation(
    'BreezSdk.receivePayment',
    () =>
      wallet.receivePayment({
        paymentMethod: {
          type: 'bolt11Invoice' as const,
          description: description ?? '',
          amountSats: amount.toNumber('sat'),
        },
      }),
  );

  const bolt11Result = parseBolt11Invoice(response.paymentRequest);
  if (!bolt11Result.valid) {
    throw new Error('Breez SDK returned an invalid bolt11 invoice');
  }
  const decoded = bolt11Result.decoded;

  const now = new Date().toISOString();
  const invoiceAmount = new Money({
    amount: decoded.amountMsat ?? amount.toNumber('msat'),
    currency: 'BTC',
    unit: 'msat',
  });

  const expiresAt = decoded.expiryUnixMs
    ? new Date(decoded.expiryUnixMs).toISOString()
    : new Date(Date.now() + 3600_000).toISOString(); // Default 1 hour

  return {
    id: decoded.paymentHash,
    createdAt: now,
    updatedAt: now,
    invoice: {
      encodedInvoice: response.paymentRequest,
      paymentHash: decoded.paymentHash,
      amount: invoiceAmount,
      createdAt: now,
      expiresAt,
      memo: decoded.description ?? description,
    },
    fee: new Money({ amount: Number(response.fee), currency: 'BTC', unit: 'sat' }),
    receiverIdentityPublicKey: undefined,
  };
}

/**
 * Computes the expiry date for a quote.
 */
export function computeQuoteExpiry(params: CreateQuoteBaseParams): string {
  if (params.receiveType === 'LIGHTNING') {
    return params.lightningQuote.invoice.expiresAt;
  }

  return new Date(
    Math.min(
      new Date(params.lightningQuote.invoice.expiresAt).getTime(),
      new Date(params.meltQuoteExpiresAt).getTime(),
    ),
  ).toISOString();
}

/**
 * Gets the amount and total fee for a receive quote.
 */
export function getAmountAndFee(params: CreateQuoteBaseParams): {
  amount: Money;
  totalFee: Money;
} {
  const amount = params.lightningQuote.invoice.amount;

  if (params.receiveType === 'LIGHTNING') {
    return { amount, totalFee: params.lightningQuote.fee as Money };
  }

  return {
    amount,
    totalFee: params.cashuReceiveFee.add(params.lightningFeeReserve),
  };
}
```

- [ ] **Step 2: Update spark-receive-quote-service.ts**

In `app/features/receive/spark-receive-quote-service.ts`, update `createReceiveQuote` to use the simplified quote type. Replace the `baseParams` construction:

```typescript
    const baseParams = {
      userId,
      accountId: account.id,
      amount,
      paymentRequest: lightningQuote.invoice.encodedInvoice,
      paymentHash: lightningQuote.invoice.paymentHash,
      description: lightningQuote.invoice.memo,
      expiresAt,
      sparkId: lightningQuote.id,
      receiverIdentityPubkey: lightningQuote.receiverIdentityPublicKey,
      totalFee,
      purpose,
      transferId,
    };
```

This should still work since `lightningQuote.id` is now the payment hash and the field names match. Verify the types align.

- [ ] **Step 3: Update receive status polling in spark-receive-quote-hooks.ts**

Replace the import:
```typescript
import { LightningReceiveRequestStatus } from '@buildonspark/spark-sdk/types';
```
With: (remove it entirely)

In the `checkQuoteStatus` function inside `useOnSparkReceiveStateChange`, replace the `getLightningReceiveRequest` polling block. Find this code:

```typescript
      const receiveRequest = await measureOperation(
        'SparkWallet.getLightningReceiveRequest',
        () => account.wallet.getLightningReceiveRequest(quote.sparkId),
        { receiveRequestId: quote.sparkId },
      );

      if (!receiveRequest) {
        return;
      }

      if (
        receiveRequest.status ===
        LightningReceiveRequestStatus.TRANSFER_COMPLETED
      ) {
        if (!receiveRequest.paymentPreimage) {
          throw new Error(
            'Payment preimage is required when receive request has TRANSFER_COMPLETED status.',
          );
        }
        if (!receiveRequest.transfer?.sparkId) {
          throw new Error(
            'Spark transfer ID is required when receive request has TRANSFER_COMPLETED status.',
          );
        }
        sparkDebugLog('Receive payment detected as completed', {
          quoteId: quote.id,
          accountId: quote.accountId,
          sparkTransferId: receiveRequest.transfer.sparkId,
        });
        onCompletedRef.current(quote.id, {
          sparkTransferId: receiveRequest.transfer.sparkId,
          paymentPreimage: receiveRequest.paymentPreimage,
        });
        return;
      }

      const expiresAt = new Date(receiveRequest.invoice.expiresAt);
      const now = new Date();

      if (now > expiresAt) {
        onExpiredRef.current(quote.id);
      }
```

Replace with:

```typescript
      const sdk = account.wallet;
      const { payments } = await measureOperation(
        'BreezSdk.listPayments',
        () =>
          sdk.listPayments({
            typeFilter: ['receive'],
            paymentDetailsFilter: [{ type: 'lightning' }],
            limit: 20,
            sortAscending: false,
          }),
        { paymentHash: quote.paymentHash },
      );

      const payment = payments.find(
        (p) =>
          p.details?.type === 'lightning' &&
          p.details.invoice === quote.paymentRequest,
      );

      if (!payment) {
        // Check if invoice has expired
        const expiresAt = new Date(quote.expiresAt);
        if (new Date() > expiresAt) {
          onExpiredRef.current(quote.id);
        }
        return;
      }

      if (payment.status === 'completed') {
        const preimage =
          payment.details?.type === 'lightning'
            ? payment.details.htlcDetails.preimage
            : undefined;
        if (!preimage) {
          throw new Error(
            'Payment preimage is required when payment status is completed.',
          );
        }

        sparkDebugLog('Receive payment detected as completed', {
          quoteId: quote.id,
          accountId: quote.accountId,
          breezPaymentId: payment.id,
        });
        onCompletedRef.current(quote.id, {
          sparkTransferId: payment.id,
          paymentPreimage: preimage,
        });
        return;
      }

      // Check expiry for pending payments
      const expiresAt = new Date(quote.expiresAt);
      if (new Date() > expiresAt) {
        onExpiredRef.current(quote.id);
      }
```

Also add the `receiverIdentityPubkey` parameter removal from `useCreateSparkReceiveQuote`'s `CreateProps` type and the `getLightningQuote` call — remove the `receiverIdentityPubkey` parameter since the Breez `getLightningQuote` no longer accepts it.

Find:
```typescript
      const lightningQuote = await getLightningQuote({
        wallet: account.wallet,
        amount,
        receiverIdentityPubkey,
        description,
      });
```
Replace with:
```typescript
      const lightningQuote = await getLightningQuote({
        wallet: account.wallet,
        amount,
        description,
      });
```

Remove the `receiverIdentityPubkey` field from the `CreateProps` type definition too.

- [ ] **Step 4: Update claim-cashu-token-service.ts**

Replace the import:
```typescript
import { LightningReceiveRequestStatus } from '@buildonspark/spark-sdk/types';
```
With: (remove it entirely)

In the `waitForSparkReceiveToComplete` method, replace the `getLightningReceiveRequest` polling with `listPayments` matching. Find:

```typescript
      const checkReceiveRequest = async () => {
        try {
          const receiveRequest = await measureOperation(
            'SparkWallet.getLightningReceiveRequest',
            () => wallet.getLightningReceiveRequest(quote.sparkId),
            { receiveRequestId: quote.sparkId },
          );

          if (
            receiveRequest?.status ===
            LightningReceiveRequestStatus.TRANSFER_COMPLETED
          ) {
            clearTimeout(timeoutId);
            if (intervalId) clearInterval(intervalId);

            if (!receiveRequest.paymentPreimage) {
              reject(
                new Error(
                  'Payment preimage is required when receive request has TRANSFER_COMPLETED status.',
                ),
              );
              return;
            }
            if (!receiveRequest.transfer?.sparkId) {
              reject(
                new Error(
                  'Spark transfer ID is required when receive request has TRANSFER_COMPLETED status.',
                ),
              );
              return;
            }

            resolve({
              sparkTransferId: receiveRequest.transfer.sparkId,
              paymentPreimage: receiveRequest.paymentPreimage,
            });
          }
```

Replace with:

```typescript
      const checkReceiveRequest = async () => {
        try {
          const { payments } = await measureOperation(
            'BreezSdk.listPayments',
            () =>
              wallet.listPayments({
                typeFilter: ['receive'],
                paymentDetailsFilter: [{ type: 'lightning' }],
                limit: 10,
                sortAscending: false,
              }),
            { paymentRequest: quote.paymentRequest },
          );

          const payment = payments.find(
            (p) =>
              p.details?.type === 'lightning' &&
              p.details.invoice === quote.paymentRequest,
          );

          if (payment?.status === 'completed') {
            clearTimeout(timeoutId);
            if (intervalId) clearInterval(intervalId);

            const preimage =
              payment.details?.type === 'lightning'
                ? payment.details.htlcDetails.preimage
                : undefined;

            if (!preimage) {
              reject(
                new Error(
                  'Payment preimage is required when payment status is completed.',
                ),
              );
              return;
            }

            resolve({
              sparkTransferId: payment.id,
              paymentPreimage: preimage,
            });
          }
```

Note: the `wallet` variable in this method is `account.wallet` which is now typed as `BreezSdk`. The `listPayments` method is available on `BreezSdk`.

- [ ] **Step 5: Commit**

```bash
git add app/features/receive/spark-receive-quote-core.ts app/features/receive/spark-receive-quote-hooks.ts app/features/receive/spark-receive-quote-service.ts app/features/receive/claim-cashu-token-service.ts
git commit -m "feat: migrate receive flow to Breez SDK (receivePayment + listPayments)"
```

---

### Task 8: Isolate Lightning Address on old SDK

**Files:**
- Modify: `app/features/receive/spark-receive-quote-service.server.ts`
- Modify: `app/features/receive/lightning-address-service.ts`
- Modify: `app/features/user/user-repository.ts`

The Lightning Address service needs to keep using the old `@buildonspark/spark-sdk` because Breez SDK does not yet expose `receiverIdentityPubkey` for delegated invoices.

- [ ] **Step 1: Update spark-receive-quote-service.server.ts to use old SDK directly**

Replace the entire file contents. The server service now inlines the old SDK's `createLightningInvoice` call instead of delegating to the core `getLightningQuote` (which now uses Breez):

```typescript
import {
  type SparkWallet,
  SparkWallet as SparkWalletClass,
} from '@buildonspark/spark-sdk';
import type { CurrencyAmount } from '@buildonspark/spark-sdk/types';
import { Money } from '~/lib/money';
import { measureOperation } from '~/lib/performance';
import {
  type CreateQuoteBaseParams,
  type SparkReceiveLightningQuote,
  computeQuoteExpiry,
} from './spark-receive-quote-core';
import type {
  SparkReceiveQuoteCreated,
  SparkReceiveQuoteRepositoryServer,
} from './spark-receive-quote-repository.server';

/**
 * Parameters for creating a Lightning invoice using the legacy Spark SDK.
 * Used only by Lightning Address service.
 */
export type LegacyGetLightningQuoteParams = {
  wallet: SparkWallet;
  amount: Money;
  receiverIdentityPubkey?: string;
  description?: string;
};

function moneyFromLegacyCurrencyAmount(amount: CurrencyAmount): Money<'BTC'> {
  return new Money({
    amount: amount.originalValue,
    currency: 'BTC',
    unit: 'sat',
  });
}

type CreateQuoteParams = CreateQuoteBaseParams & {
  userEncryptionPublicKey: string;
};

/**
 * Server-side service for creating spark receive quotes.
 * Uses the LEGACY @buildonspark/spark-sdk for Lightning Address support
 * (delegated invoices with receiverIdentityPubkey).
 *
 * TODO: Migrate to Breez SDK when they expose receiverIdentityPubkey.
 */
export class SparkReceiveQuoteServiceServer {
  constructor(private readonly repository: SparkReceiveQuoteRepositoryServer) {}

  /**
   * Creates a Lightning invoice using the legacy Spark SDK.
   * This is the only method that still uses the old SDK.
   */
  async getLightningQuote(
    params: LegacyGetLightningQuoteParams,
  ): Promise<SparkReceiveLightningQuote> {
    const { wallet, amount, receiverIdentityPubkey, description } = params;

    const response = await measureOperation(
      'LegacySparkWallet.createLightningInvoice',
      () =>
        wallet.createLightningInvoice({
          amountSats: amount.toNumber('sat'),
          includeSparkAddress: false,
          receiverIdentityPubkey,
          memo: description,
        }),
    );

    const invoiceAmount = moneyFromLegacyCurrencyAmount(
      response.invoice.amount,
    );

    return {
      id: response.id,
      createdAt: response.createdAt,
      updatedAt: response.updatedAt,
      invoice: {
        encodedInvoice: response.invoice.encodedInvoice,
        paymentHash: response.invoice.paymentHash,
        amount: invoiceAmount,
        createdAt: response.invoice.createdAt,
        expiresAt: response.invoice.expiresAt,
        memo: response.invoice.memo ?? undefined,
      },
      fee: Money.zero('BTC') as Money<'BTC'>,
      receiverIdentityPublicKey:
        response.receiverIdentityPublicKey ?? undefined,
    };
  }

  async createReceiveQuote(
    params: CreateQuoteParams,
  ): Promise<SparkReceiveQuoteCreated> {
    const { userEncryptionPublicKey, userId, account, lightningQuote } = params;
    const expiresAt = computeQuoteExpiry(params);
    const amount = lightningQuote.invoice.amount;
    const totalFee = lightningQuote.fee as Money;

    const baseParams = {
      userId,
      accountId: account.id,
      amount,
      paymentRequest: lightningQuote.invoice.encodedInvoice,
      paymentHash: lightningQuote.invoice.paymentHash,
      description: lightningQuote.invoice.memo,
      expiresAt,
      sparkId: lightningQuote.id,
      receiverIdentityPubkey: lightningQuote.receiverIdentityPublicKey,
      totalFee,
    };

    if (params.receiveType === 'CASHU_TOKEN') {
      return this.repository.create({
        ...baseParams,
        userEncryptionPublicKey,
        receiveType: 'CASHU_TOKEN',
        meltData: {
          tokenMintUrl: params.sourceMintUrl,
          tokenAmount: params.tokenAmount,
          tokenProofs: params.tokenProofs,
          meltQuoteId: params.meltQuoteId,
          cashuReceiveFee: params.cashuReceiveFee,
          lightningFeeReserve: params.lightningFeeReserve,
        },
      });
    }

    return this.repository.create({
      ...baseParams,
      userEncryptionPublicKey,
      receiveType: 'LIGHTNING',
    });
  }
}
```

- [ ] **Step 2: Update lightning-address-service.ts for self-contained old SDK wallet**

Replace the imports at the top. Change:
```typescript
import { LightningReceiveRequestStatus } from '@buildonspark/spark-sdk/types';
```
To:
```typescript
import {
  type SparkWallet,
  SparkWallet as SparkWalletClass,
} from '@buildonspark/spark-sdk';
import { LightningReceiveRequestStatus } from '@buildonspark/spark-sdk/types';
```

Remove the import of `sparkWalletQueryOptions` from `../shared/spark`:
```typescript
import { sparkWalletQueryOptions } from '../shared/spark';
```

Add a private method to the `LightningAddressService` class for creating a legacy wallet:

```typescript
  /**
   * Creates a legacy SparkWallet using the old SDK.
   * Used for Lightning Address operations that need receiverIdentityPubkey.
   * TODO: Replace with Breez SDK when they expose receiverIdentityPubkey.
   */
  private async getLegacySparkWallet(): Promise<SparkWallet> {
    const { wallet } = await SparkWalletClass.initialize({
      mnemonicOrSeed: sparkMnemonic,
      options: { network: 'MAINNET' },
    });
    return wallet;
  }
```

Note: `sparkMnemonic` is already defined at the module level in the file.

In `handleSparkLnurlpVerify`, replace:
```typescript
    const wallet = await this.queryClient.fetchQuery(
      sparkWalletQueryOptions({ network: 'MAINNET', mnemonic: sparkMnemonic }),
    );
```
With:
```typescript
    const wallet = await this.getLegacySparkWallet();
```

In `handleLnurlpCallback` for the spark path, pass the legacy wallet to the server service. Replace:
```typescript
      const lightningQuote = await sparkReceiveQuoteService.getLightningQuote({
        wallet: account.wallet,
        amount: amountToReceive,
        receiverIdentityPubkey: user.sparkIdentityPublicKey,
      });
```
With:
```typescript
      const legacyWallet = await this.getLegacySparkWallet();
      const lightningQuote = await sparkReceiveQuoteService.getLightningQuote({
        wallet: legacyWallet,
        amount: amountToReceive,
        receiverIdentityPubkey: user.sparkIdentityPublicKey,
      });
```

- [ ] **Step 3: Update ReadUserDefaultAccountRepository for server-side spark accounts**

In `app/features/user/user-repository.ts`, the `ReadUserDefaultAccountRepository.toAccount()` method currently calls `getInitializedSparkWallet()` which now uses Breez. Since Lightning Address no longer uses `account.wallet` for spark operations (it uses `getLegacySparkWallet()` instead), we can return a stub wallet.

In the `toAccount` method, find the spark account branch:
```typescript
    if (isSparkAccount(data)) {
      const { network } = data.details;
      const { wallet, ownedBalance, availableBalance, isOnline } =
        await this.getInitializedSparkWallet(network);

      return {
        ...commonData,
        type: 'spark',
        ownedBalance,
        availableBalance,
        network,
        isOnline,
        wallet,
      };
    }
```

Replace with:
```typescript
    if (isSparkAccount(data)) {
      const { network } = data.details;
      // Lightning Address uses its own legacy wallet — account.wallet is unused.
      // Return a stub to avoid initializing Breez SDK on the server.
      const { createSparkWalletStub } = await import('~/lib/spark/utils');
      return {
        ...commonData,
        type: 'spark',
        ownedBalance: null,
        availableBalance: null,
        network,
        isOnline: true,
        wallet: createSparkWalletStub(
          'Server-side stub — use getLegacySparkWallet() for Lightning Address operations',
        ),
      };
    }
```

Also remove the now-unused `getInitializedSparkWallet` private method and its imports from `../shared/spark` if they're no longer needed in this file.

- [ ] **Step 4: Commit**

```bash
git add app/features/receive/spark-receive-quote-service.server.ts app/features/receive/lightning-address-service.ts app/features/user/user-repository.ts
git commit -m "feat: isolate Lightning Address on legacy Spark SDK"
```

---

### Task 9: Cleanup and verification

**Files:**
- Delete: `patches/@buildonspark%2Fspark-sdk@0.7.4.patch`
- Modify: `package.json` (remove patchedDependencies entry)

- [ ] **Step 1: Remove the old SDK patch**

The patch only added debug logging to the old SDK's `LeafManager`. Lightning Address doesn't need it.

```bash
rm "patches/@buildonspark%2Fspark-sdk@0.7.4.patch"
```

In `package.json`, remove the `patchedDependencies` entry:
```json
  "patchedDependencies": {
    "@buildonspark/spark-sdk@0.7.4": "patches/@buildonspark%2Fspark-sdk@0.7.4.patch"
  }
```

Run `bun install` to apply the unpatched dependency.

- [ ] **Step 2: Run full verification**

```bash
bun run fix:all
```

Expected: All lint, format, and type checks pass.

Fix any remaining type errors. Common issues to check:
- Files importing `moneyFromSparkAmount` → change to `moneyFromSats` or remove
- Files importing `SparkWallet` type from old SDK → change to `BreezSdk`
- Files importing `SparkError` from old SDK → remove (error matchers no longer need it)
- Files referencing `SparkWalletEvent` → remove (events are handled via Breez `addEventListener`)

- [ ] **Step 3: Verify no stale old SDK imports remain (except Lightning Address)**

Run this grep and verify only Lightning Address files and the server service import from the old SDK:

```bash
rg "@buildonspark/spark-sdk" app/ --files-with-matches
```

Expected output (only these files should remain):
- `app/features/receive/lightning-address-service.ts`
- `app/features/receive/spark-receive-quote-service.server.ts`

Any other file still importing from `@buildonspark/spark-sdk` is a bug — fix it.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove old SDK patch, fix remaining type errors"
```

- [ ] **Step 5: Final smoke test**

Run the dev server and verify basic functionality:
```bash
bun run dev
```

Check:
- App loads without errors
- Wallet initializes (check console for `[Breez]` logs)
- Balance shows correctly
- WASM init completes

---

## Deferred: Lightning Address Migration

The Lightning Address service (`lightning-address-service.ts`) stays on `@buildonspark/spark-sdk` until the Breez team exposes `receiverIdentityPubkey` in the JS SDK. Track this with Breez.

When available:
1. Update `spark-receive-quote-service.server.ts` to use Breez SDK's equivalent API
2. Remove `getLegacySparkWallet()` from `lightning-address-service.ts`
3. Remove `@buildonspark/spark-sdk` from `package.json`
4. Delete the legacy code

## Risk Notes

- **`defaultExternalSigner().identityPublicKey()` return type** — The `PublicKeyBytes` type is opaque from WASM. The `bytesToHex(new Uint8Array(...))` conversion in `utils.ts` should work based on Phase C validation, but verify the output matches the old SDK's result at runtime. If the conversion fails, try `bytesToHex(publicKeyBytes)` directly or `Array.from(publicKeyBytes)`.
- **`listPayments` for receive matching** — If matching by `details.invoice === paymentRequest` doesn't work (e.g., Breez normalizes the invoice), fall back to matching by `details.htlcDetails.paymentHash === quote.paymentHash`.
- **Balance: owned vs available** — Breez SDK returns a single `balanceSats`. We set `ownedBalance = availableBalance`. This means the "funds locked in pending transfer" UI warning will never trigger. If this is important, we may need to track pending sends ourselves.
