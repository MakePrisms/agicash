# Breez Spark SDK Phase A — Production Replacement

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `@buildonspark/spark-sdk@0.7.4` with `@breeztech/breez-sdk-spark` across ALL Spark operations and fully remove the old SDK. Lightning Address spark path throws "not implemented" until we fork the Breez SDK to expose `receiverIdentityPubkey`.

**Architecture:** Direct SDK swap with static imports (Breez package exports handle SSR/client automatically). `Account.wallet` type → `BreezSdk`. Balance, send status, and receive status all move to event-driven via `sdk.addEventListener` (no polling). Send uses `prepareSendPayment` + `sendPayment` with `idempotencyKey`. Lightning Address spark path temporarily disabled (cashu path unaffected).

**Tech Stack:** `@breeztech/breez-sdk-spark@0.12.2` (WASM), React Router v7, TanStack Query v5

**Branch:** `impl/breez-spark-sdk-migration` (based off `master`)

**Specs:** `docs/superpowers/specs/2026-04-04-breez-spark-sdk-migration-design.md`, `docs/superpowers/specs/2026-04-04-breez-spark-sdk-validation-results.md`

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `app/lib/spark/init.ts` | Breez SDK connect function (logging setup) |

### Modified files
| File | Change |
|------|--------|
| `package.json` | Add `@breeztech/breez-sdk-spark`, remove `@buildonspark/spark-sdk` |
| `app/lib/spark/errors.ts` | Replace `SparkError` with plain `Error` message matching |
| `app/lib/spark/utils.ts` | Replace old SDK imports with Breez equivalents; add `moneyFromSats` |
| `app/lib/spark/index.ts` | Update re-exports |
| `app/features/accounts/account.ts` | `wallet: SparkWallet` → `wallet: BreezSdk`; local `SparkNetwork` type |
| `app/features/accounts/account-hooks.ts` | Simplify `updateSparkAccountIfBalanceOrWalletChanged` → `updateSparkAccountBalance` |
| `app/features/agicash-db/json-models/spark-account-details-db-data.ts` | Export `SparkNetwork` type + `toBreezNetwork()` |
| `app/features/accounts/account-repository.ts` | Import `SparkNetwork` from local type |
| `app/features/user/user-repository.ts` | Import `SparkNetwork` from local type; stub wallet for server |
| `app/features/shared/spark.ts` | Full rewrite: Breez `connect()`, event-driven balance, remove zero-balance workaround + polling |
| `app/features/send/spark-send-quote-service.ts` | `prepareSendPayment` (cached) + `sendPayment` with `idempotencyKey` |
| `app/features/send/spark-send-quote-hooks.ts` | Event-driven send status via `addEventListener` (no polling) |
| `app/features/receive/spark-receive-quote-core.ts` | `receivePayment` + bolt11 parsing; simplified `SparkReceiveLightningQuote` type |
| `app/features/receive/spark-receive-quote-hooks.ts` | Event-driven receive status via `addEventListener` (no polling) |
| `app/features/receive/spark-receive-quote-service.ts` | Adapt to simplified quote type |
| `app/features/receive/spark-receive-quote-service.server.ts` | Remove old SDK imports; delegate to core `getLightningQuote` |
| `app/features/receive/claim-cashu-token-service.ts` | Event-driven receive status |
| `app/features/receive/lightning-address-service.ts` | Spark path throws not-implemented; cashu path unchanged |
| `app/routes/_protected.tsx` | WASM init in `clientLoader`; update `sparkIdentityPublicKeyQueryOptions` |

### Deleted files
| File | Reason |
|------|--------|
| `patches/@buildonspark%2Fspark-sdk@0.7.4.patch` | Old SDK removed entirely |

### Removed dependencies
| Package | Reason |
|---------|--------|
| `@buildonspark/spark-sdk` | Fully replaced by `@breeztech/breez-sdk-spark` |

---

## API Mapping Reference

| Old SDK (`@buildonspark/spark-sdk`) | Breez SDK (`@breeztech/breez-sdk-spark`) |
|------|------|
| `SparkWallet` (class) | `BreezSdk` (class) |
| `SparkWallet.initialize({ mnemonicOrSeed, options })` | `connect({ config, seed, storageDir })` |
| `wallet.getBalance()` → `{ satsBalance: { owned, available } }` | `sdk.getInfo({})` → `{ balanceSats, identityPubkey }` (single balance) |
| `wallet.getIdentityPublicKey()` | `sdk.getInfo({})` → `identityPubkey` |
| `wallet.getLightningSendFeeEstimate(...)` | `sdk.prepareSendPayment({ paymentRequest, amount? })` → fee in response |
| `wallet.payLightningInvoice(...)` | `sdk.sendPayment({ prepareResponse, idempotencyKey, options })` |
| `wallet.createLightningInvoice(...)` | `sdk.receivePayment({ paymentMethod: { type: 'bolt11Invoice', ... } })` |
| `wallet.getLightningReceiveRequest(id)` (polling) | `sdk.addEventListener` → `paymentSucceeded` event |
| `wallet.getLightningSendRequest(id)` (polling) | `sdk.addEventListener` → `paymentSucceeded`/`paymentFailed` events |
| `wallet.on(SparkWalletEvent.BalanceUpdate, ...)` | `sdk.addEventListener` → `synced`/`paymentSucceeded` events |
| `wallet.setPrivacyEnabled(true)` | `defaultConfig()` has `privateEnabledDefault` (verify it's `true`) |
| `wallet.getLeaves(true)` | Removed (debug logging only) |
| `wallet.isOptimizationInProgress()` | Removed (not needed) |
| `wallet.getTransfers(pageSize, offset)` | Removed (idempotencyKey replaces manual dedup) |
| `SparkError` with `.getContext()` | Plain `Error` — `message.includes('insufficient funds')` |
| `LightningReceiveRequestStatus.TRANSFER_COMPLETED` | `paymentSucceeded` event |
| `LightningSendRequestStatus.TRANSFER_COMPLETED` | `paymentSucceeded` event |
| `LightningSendRequestStatus.USER_SWAP_RETURNED` | `paymentFailed` event |
| `NetworkType` (`'MAINNET'`, `'REGTEST'`) | `Network` (`'mainnet'`, `'regtest'`) — DB keeps old format, map with `toBreezNetwork()` |
| `CurrencyAmount` (with `originalUnit`, `originalValue`) | `bigint` (always sats) — use `moneyFromSats()` |
| `DefaultSparkSigner` | `defaultExternalSigner(mnemonic, null, network)` |

### Key architectural changes from old SDK

1. **Single balance** — Breez returns one `balanceSats` (no owned/available split). Both `ownedBalance` and `availableBalance` on SparkAccount set to same value.
2. **Event-driven** — All status tracking (balance, send, receive) uses `sdk.addEventListener` with `SdkEvent`. No polling intervals.
3. **Prepare+Send** — Send uses two-step flow. Prepare response cached in service `Map<paymentHash, PrepareResponse>` from quote step; reused in initiate step. Re-prepare only on cache miss (app restart edge case).
4. **Static imports** — Breez package exports have `"node"` and `"default"` conditions. SSR resolves to Node.js entry, client to web entry. No dynamic imports or `.client.ts` needed.
5. **No workarounds** — Zero-balance workaround, `findExistingLightningSendRequest`, wallet reinitialization all removed.

---

## Tasks

### Task 1: Add Breez SDK dependency and WASM init

**Files:**
- Modify: `package.json`
- Modify: `app/routes/_protected.tsx`

- [ ] **Step 1: Add Breez SDK to package.json**

```bash
bun add @breeztech/breez-sdk-spark@0.12.2
```

- [ ] **Step 2: Init WASM in `_protected.tsx` clientLoader**

WASM must be initialized before any Breez SDK calls. Since only logged-in users need the Spark SDK, init it in the `_protected.tsx` clientLoader. The clientLoader only runs on the client and only after the middleware succeeds (no redirect), so it's the perfect place.

In `app/routes/_protected.tsx`, add to the clientLoader (before any spark-related prefetches):

```typescript
import initBreezWasm from '@breeztech/breez-sdk-spark';

// In clientLoader:
await initBreezWasm();
```

Note: this is a static import. The Breez SDK package.json has `"node": "./nodejs/index.js"` and `"default": "./web/index.js"` exports, so Vite resolves to the correct entry for SSR (Node.js) and client (web) automatically. No dynamic imports needed.

- [ ] **Step 3: Verify**

Run: `bun run fix:all`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock app/routes/_protected.tsx
git commit -m "feat: add breez-sdk-spark dependency and WASM init in _protected clientLoader"
```

---

### Task 2: Add Breez init helper to `app/lib/spark/`

**Files:**
- Create: `app/lib/spark/init.ts`

No separate `app/lib/breez-spark/` folder — keep everything in the existing `app/lib/spark/`.

- [ ] **Step 1: Create `app/lib/spark/init.ts`**

```typescript
import {
  type BreezSdk,
  type Config,
  type Network,
  connect,
  defaultConfig,
  initLogging,
} from '@breeztech/breez-sdk-spark';

let loggingInitialized = false;

async function ensureLogging() {
  if (loggingInitialized) return;
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
    loggingInitialized = true;
  }
}

/**
 * Connects to the Breez SDK and returns a BreezSdk instance.
 * WASM must be initialized first (in _protected.tsx clientLoader).
 */
export async function connectBreezWallet({
  mnemonic,
  network = 'mainnet',
  apiKey,
}: {
  mnemonic: string;
  network?: Network;
  apiKey: string;
}): Promise<BreezSdk> {
  await ensureLogging();

  const config: Config = {
    ...defaultConfig(network),
    apiKey,
  };

  return connect({
    config,
    seed: { type: 'mnemonic' as const, mnemonic },
    storageDir: `breez-spark-wallet-${network}`,
  });
}
```

The caller (`shared/spark.ts`) reads `VITE_BREEZ_API_KEY` from env and passes it in. Env var reading is app-level concern, not lib-level.

- [ ] **Step 2: Verify**

Run: `bun run fix:all`
Expected: No new errors (additive file, nothing imports it yet).

- [ ] **Step 3: Commit**

```bash
git add app/lib/spark/init.ts
git commit -m "feat: add Breez SDK init helper to app/lib/spark"
```

Note: no `events.ts` wrapper — `sdk.addEventListener({ onEvent(e) { ... } })` is simple enough to use inline. The Breez SDK's `EventListener` interface is just `{ onEvent: (e: SdkEvent) => void }`.

---

### Task 3: SparkNetwork type, error matchers, account types, and utils

**Files:**
- Modify: `app/features/agicash-db/json-models/spark-account-details-db-data.ts`
- Modify: `app/lib/spark/errors.ts`
- Modify: `app/lib/spark/utils.ts`
- Modify: `app/lib/spark/index.ts`
- Modify: `app/features/accounts/account.ts`
- Modify: `app/features/accounts/account-repository.ts`
- Modify: `app/features/user/user-repository.ts`

- [ ] **Step 1: Export SparkNetwork type and toBreezNetwork from DB schema**

In `app/features/agicash-db/json-models/spark-account-details-db-data.ts`, add after existing exports:

```typescript
export type SparkNetwork = SparkAccountDetailsDbData['network'];

export function toBreezNetwork(network: SparkNetwork): 'mainnet' | 'regtest' {
  switch (network) {
    case 'MAINNET':
      return 'mainnet';
    case 'REGTEST':
    case 'LOCAL':
      return 'regtest';
    default:
      throw new Error(`Unsupported Spark network for Breez SDK: ${network}`);
  }
}
```

- [ ] **Step 2: Replace error matchers**

Replace entire `app/lib/spark/errors.ts`:

```typescript
/**
 * Checks if an error is an insufficient balance error from the Breez SDK.
 * Phase C validation confirmed: message contains "insufficient funds".
 */
export const isInsufficentBalanceError = (error: unknown): error is Error => {
  if (!(error instanceof Error)) return false;
  const lower = error.message.toLowerCase();
  return lower.includes('insufficient funds') || lower.includes('insufficient balance');
};

/**
 * Checks if an error indicates the invoice was already paid.
 * Phase C validation confirmed: message contains "preimage request already exists".
 */
export const isInvoiceAlreadyPaidError = (error: unknown): error is Error => {
  if (!(error instanceof Error)) return false;
  return error.message.toLowerCase().includes('preimage request already exists');
};
```

- [ ] **Step 3: Replace utility functions**

Replace entire `app/lib/spark/utils.ts`:

```typescript
import type { BreezSdk } from '@breeztech/breez-sdk-spark';
import { bytesToHex } from '@noble/hashes/utils';
import { Money } from '../money';

export function moneyFromSats(sats: bigint | number): Money<'BTC'> {
  return new Money({ amount: Number(sats), currency: 'BTC', unit: 'sat' });
}

/**
 * Gets the Spark identity public key from a mnemonic using the Breez SDK signer.
 * Returns the same key as the old DefaultSparkSigner (Phase C validation C1).
 * Requires WASM to be initialized.
 */
export async function getSparkIdentityPublicKeyFromMnemonic(
  mnemonic: string,
  network: 'mainnet' | 'regtest',
): Promise<string> {
  const { defaultExternalSigner } = await import('@breeztech/breez-sdk-spark');
  const signer = defaultExternalSigner(mnemonic, null, network);
  const publicKeyBytes = signer.identityPublicKey();
  return bytesToHex(new Uint8Array(publicKeyBytes as unknown as ArrayBuffer));
}

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

Note: `getSparkIdentityPublicKeyFromMnemonic` uses a dynamic import because it's called during account setup and we need the WASM-dependent `defaultExternalSigner`. Verify at runtime that the hex output matches the old SDK.

- [ ] **Step 4: Update `app/lib/spark/index.ts`**

```typescript
export { isInsufficentBalanceError, isInvoiceAlreadyPaidError } from './errors';
export { createSparkWalletStub, getSparkIdentityPublicKeyFromMnemonic, moneyFromSats } from './utils';
```

- [ ] **Step 5: Update Account types**

In `app/features/accounts/account.ts`, replace old SDK imports:

```typescript
// Remove:
import type { NetworkType as SparkNetwork, SparkWallet } from '@buildonspark/spark-sdk';

// Add:
import type { BreezSdk } from '@breeztech/breez-sdk-spark';
import type { SparkNetwork } from '../agicash-db/json-models/spark-account-details-db-data';
```

Change the spark variant's wallet type from `wallet: SparkWallet` to `wallet: BreezSdk`.

- [ ] **Step 6: Update account-repository.ts and user-repository.ts imports**

In both files, replace `import type { NetworkType as SparkNetwork } from '@buildonspark/spark-sdk'` with `import type { SparkNetwork } from '../agicash-db/json-models/spark-account-details-db-data'`.

In `user-repository.ts`, also replace `NetworkType` usage with `SparkNetwork`.

- [ ] **Step 7: Commit**

```bash
git add app/features/agicash-db/json-models/spark-account-details-db-data.ts app/lib/spark/ app/features/accounts/account.ts app/features/accounts/account-repository.ts app/features/user/user-repository.ts
git commit -m "feat: replace old SDK types with Breez equivalents across account layer"
```

---

### Task 4: Wallet init, event-driven balance, simplified account cache

**Files:**
- Modify: `app/features/shared/spark.ts`
- Modify: `app/features/accounts/account-hooks.ts` (simplify cache update method)

This task rewrites the core Spark module. Key changes:
- `sparkWalletQueryOptions` uses `connectBreezWallet` instead of `SparkWallet.initialize`
- No `updateUserSettings` call for privacy (verify `defaultConfig` has `privateEnabledDefault: true`)
- `getInitializedSparkWallet` uses `sdk.getInfo()` for single balance
- `useTrackAndUpdateSparkAccountBalances` is fully event-driven (no polling, no zero-balance workaround)
- Balance uses simplified `updateSparkAccountBalance` method (no wallet comparison)

- [ ] **Step 1: Simplify account cache update method**

In `app/features/accounts/account-hooks.ts`, replace `updateSparkAccountIfBalanceOrWalletChanged` with a simpler method that takes a single balance (Breez has no owned/available split):

```typescript
  updateSparkAccountBalance({
    accountId,
    balance,
  }: {
    accountId: string;
    balance: Money;
  }) {
    this.queryClient.setQueryData([AccountsCache.Key], (curr: Account[]) =>
      curr.map((x) => {
        if (x.id !== accountId || x.type !== 'spark') return x;

        const currentBalance = x.ownedBalance ?? Money.zero(x.currency);
        if (currentBalance.equals(balance)) return x;

        sparkDebugLog('Balance updated', {
          accountId,
          prev: currentBalance.toString(),
          new: balance.toString(),
        });

        return { ...x, ownedBalance: balance, availableBalance: balance };
      }),
    );
  }
```

Remove the old `updateSparkAccountIfBalanceOrWalletChanged` method and any dead code it referenced (wallet comparison, `hasDifferentBalance`, etc).

- [ ] **Step 2: Rewrite `app/features/shared/spark.ts`**

Replace the entire file. Key points:
- `sparkWalletQueryOptions`: calls `connectBreezWallet({ mnemonic, network, apiKey })` where `apiKey` is read from `VITE_BREEZ_API_KEY` in this file. No privacy call (verify `privateEnabledDefault` is `true`).
- `sparkIdentityPublicKeyQueryOptions`: no `accountNumber` param (Breez handles it)
- `getInitializedSparkWallet`: uses `sdk.getInfo()`, sets `ownedBalance = availableBalance = moneyFromSats(balanceSats)`
- `useTrackAndUpdateSparkAccountBalances`: registers `addEventListener` per wallet, updates balance on `paymentSucceeded`/`paymentPending`/`synced` events via `sdk.getInfo()`, calls `accountCache.updateSparkAccountBalance({ accountId, balance })`, no `useQueries`/`refetchInterval`

The event handler (inline — Breez `EventListener` is just `{ onEvent: (e: SdkEvent) => void }`):

```typescript
const listenerId = await sdk.addEventListener({
  onEvent(event) {
    sparkDebugLog('Breez event', { accountId: account.id, type: event.type });

    if (event.type === 'paymentSucceeded' || event.type === 'paymentPending' || event.type === 'synced') {
      sdk.getInfo({}).then((info) => {
        const balance = moneyFromSats(info.balanceSats);
        accountCache.updateSparkAccountBalance({
          accountId: account.id,
          balance,
        });
      });
    }
  },
});
```

Remove entirely:
- `getLeafDenominations` function (used `SparkProto.TreeNode`)
- `sparkBalanceQueryKey` (no more polling queries)
- Zero-balance workaround (`verifiedZeroBalanceAccounts`)
- All `useQueries` with `refetchInterval: 3000`
- Import of `SparkProto` type

- [ ] **Step 3: Commit**

```bash
git add app/features/shared/spark.ts app/features/accounts/account-hooks.ts
git commit -m "feat: event-driven balance tracking with Breez SDK, remove polling"
```

---

### Task 5: Send flow migration

**Files:**
- Modify: `app/features/send/spark-send-quote-service.ts`
- Modify: `app/features/send/spark-send-quote-hooks.ts`

Key changes:
- `getLightningSendQuote`: calls `prepareSendPayment`, caches response in `Map<string, PrepareSendPaymentResponse>`
- `initiateSend`: uses cached prepare response, calls `sendPayment` with `idempotencyKey`. Re-prepares only on cache miss.
- Error handling: plain `Error` message matching (no `SparkError`, no `findExistingLightningSendRequest`)
- `useOnSparkSendStateChange`: event-driven via `addEventListener` instead of 1s polling interval

- [ ] **Step 1: Rewrite spark-send-quote-service.ts**

Key structural changes from old version:
- Remove all `@buildonspark/spark-sdk` imports
- Add `private prepareCache = new Map<string, PrepareSendPaymentResponse>()`
- `getLightningSendQuote`: call `sdk.prepareSendPayment(...)`, extract fee from `response.paymentMethod.lightningFeeSats` (+ `sparkTransferFeeSats`), cache response keyed by `paymentHash`
- `initiateSend`: look up `prepareCache.get(sendQuote.paymentHash)`, fall back to fresh `prepareSendPayment` on miss. Call `sdk.sendPayment({ prepareResponse, idempotencyKey: sendQuote.id, options: { type: 'bolt11Invoice', preferSpark: false } })`. Use `payment.id` for `sparkSendRequestId` and `sparkTransferId`. Use `moneyFromSats(payment.fees)` for fee.
- Remove `payLightningInvoice` private method entirely
- Remove `findExistingLightningSendRequest` private method entirely
- Error handling: `isInsufficentBalanceError` and `isInvoiceAlreadyPaidError` from `~/lib/spark` (they now match plain Error)

Use `account.wallet` directly — it's typed as `BreezSdk`.

- [ ] **Step 2: Rewrite send status tracking in spark-send-quote-hooks.ts — event-driven**

Remove: `import { LightningSendRequestStatus } from '@buildonspark/spark-sdk/types'`

Replace `useOnSparkSendStateChange` internals. Instead of `setInterval` polling with `getLightningSendRequest`:

1. For each PENDING quote's account, register an event listener on `account.wallet`
2. On `paymentSucceeded` event: check if `payment.id === quote.sparkId`. If match, extract `preimage` from `payment.details.htlcDetails.preimage`, call `onCompleted`.
3. On `paymentFailed` event: check if `payment.id === quote.sparkId`. If match, call `onFailed`.
4. After registering listener, do initial status check via `sdk.getPayment({ paymentId: quote.sparkId })` to catch events that fired before registration.
5. Clean up listeners on unmount.

For UNPAID quotes: keep the existing `onUnpaid` callback logic (no change needed — it triggers `initiateSend`).

- [ ] **Step 3: Commit**

```bash
git add app/features/send/spark-send-quote-service.ts app/features/send/spark-send-quote-hooks.ts
git commit -m "feat: migrate send flow to Breez SDK (event-driven, cached prepare)"
```

---

### Task 6: Receive flow migration

**Files:**
- Modify: `app/features/receive/spark-receive-quote-core.ts`
- Modify: `app/features/receive/spark-receive-quote-service.ts`
- Modify: `app/features/receive/spark-receive-quote-hooks.ts`
- Modify: `app/features/receive/claim-cashu-token-service.ts`

Key changes:
- `getLightningQuote`: calls `sdk.receivePayment(...)`, parses bolt11 for paymentHash/expiry
- `SparkReceiveLightningQuote` simplified: `invoice.amount` is `Money<'BTC'>` (not `CurrencyAmount`), no `network`/`status`/`typename` fields
- Status tracking: event-driven via `addEventListener` (no `getLightningReceiveRequest` polling)

- [ ] **Step 1: Rewrite spark-receive-quote-core.ts**

Remove all `@buildonspark/spark-sdk` imports. Key changes:
- `GetLightningQuoteParams.wallet` typed as `BreezSdk` (no `receiverIdentityPubkey` param — only used by Lightning Address which is disabled)
- `getLightningQuote`: calls `wallet.receivePayment({ paymentMethod: { type: 'bolt11Invoice', description, amountSats } })`. Parse response `paymentRequest` with `parseBolt11Invoice` to get `paymentHash`, `expiresAt`, `amountMsat`. Build `SparkReceiveLightningQuote` from parsed data.
- `SparkReceiveLightningQuote.id` = `paymentHash` (tracking key)
- `SparkReceiveLightningQuote.invoice.amount` = `Money<'BTC'>` (from parsed msat)
- `SparkReceiveLightningQuote.fee` = `Money<'BTC'>` from `response.fee`
- `getAmountAndFee`: use `params.lightningQuote.invoice.amount` directly (no `moneyFromSparkAmount`)

- [ ] **Step 2: Update spark-receive-quote-service.ts**

Minimal changes — adapt to simplified quote type. The `createReceiveQuote` method extracts fields from `lightningQuote` the same way. Verify types align with the new `SparkReceiveLightningQuote`.

- [ ] **Step 3: Rewrite receive status tracking in spark-receive-quote-hooks.ts — event-driven**

Remove: `import { LightningReceiveRequestStatus } from '@buildonspark/spark-sdk/types'`

Replace `useOnSparkReceiveStateChange` internals. Instead of interval-based polling with `getLightningReceiveRequest`:

1. For each pending quote's account, register an event listener on `account.wallet`
2. On `paymentSucceeded` event with `payment.details?.type === 'lightning'`: match by `payment.details.htlcDetails.paymentHash === quote.paymentHash`. If match, extract `preimage`, call `onCompleted` with `sparkTransferId: payment.id`.
3. After registering listener, do initial status check via `sdk.listPayments({ typeFilter: ['receive'], limit: 20, sortAscending: false })` and match by `details.invoice === quote.paymentRequest`.
4. For expiry: check `quote.expiresAt` on each `synced` event or use a simple timeout.
5. Clean up listeners on unmount.

Remove `receiverIdentityPubkey` from `useCreateSparkReceiveQuote`'s `CreateProps` type and `getLightningQuote` call.

- [ ] **Step 4: Update claim-cashu-token-service.ts — event-driven**

Remove: `import { LightningReceiveRequestStatus } from '@buildonspark/spark-sdk/types'`

In `waitForSparkReceiveToComplete`, replace polling with event listener. Same pattern:
1. Register listener on wallet
2. On `paymentSucceeded` → match by `paymentHash` or `paymentRequest` → resolve
3. Initial check via `listPayments` matching
4. Keep the timeout for error handling

- [ ] **Step 5: Commit**

```bash
git add app/features/receive/spark-receive-quote-core.ts app/features/receive/spark-receive-quote-service.ts app/features/receive/spark-receive-quote-hooks.ts app/features/receive/claim-cashu-token-service.ts
git commit -m "feat: migrate receive flow to Breez SDK (event-driven)"
```

---

### Task 7: Disable Lightning Address spark path and remove old SDK

**Files:**
- Modify: `app/features/receive/spark-receive-quote-service.server.ts`
- Modify: `app/features/receive/lightning-address-service.ts`
- Modify: `app/features/user/user-repository.ts`
- Modify: `package.json`
- Delete: `patches/@buildonspark%2Fspark-sdk@0.7.4.patch`

- [ ] **Step 1: Update spark-receive-quote-service.server.ts**

Remove all `@buildonspark/spark-sdk` imports. The server service delegates to core `getLightningQuote` (which uses Breez). Since `getLightningQuote` no longer accepts `receiverIdentityPubkey`, Lightning Address spark path must not call it.

Keep the `createReceiveQuote` method working (it only uses the quote type, not the SDK directly). Update types to match simplified `SparkReceiveLightningQuote`.

- [ ] **Step 2: Update lightning-address-service.ts — spark path throws not-implemented**

Remove ALL `@buildonspark/spark-sdk` imports. Remove `sparkWalletQueryOptions` import.

In `handleLnurlpCallback`, replace the spark account branch with:

```typescript
      // TODO: Spark Lightning Address requires receiverIdentityPubkey for delegated invoices.
      // Breez SDK does not expose this param yet.
      // To unblock: fork @breeztech/breez-sdk-spark and add receiverIdentityPubkey to bolt11Invoice receive.
      // See: docs/superpowers/specs/2026-04-04-breez-spark-sdk-migration-design.md (A6)
      throw new Error(
        'Spark Lightning Address is not yet supported with the Breez SDK. ' +
          'Breez needs to expose receiverIdentityPubkey for delegated invoices.',
      );
```

Replace `handleSparkLnurlpVerify` with:

```typescript
  private async handleSparkLnurlpVerify(
    _receiveRequestId: string,
  ): Promise<LNURLVerifyResult> {
    // TODO: Implement with Breez SDK once receiverIdentityPubkey is supported.
    return {
      status: 'ERROR',
      reason: 'Spark Lightning Address verification is not yet supported with the Breez SDK.',
    };
  }
```

- [ ] **Step 3: Update ReadUserDefaultAccountRepository — stub wallet for server**

In `app/features/user/user-repository.ts`, replace the spark branch in `toAccount`:

```typescript
    if (isSparkAccount(data)) {
      const { network } = data.details;
      const { createSparkWalletStub } = await import('~/lib/spark/utils');
      return {
        ...commonData,
        type: 'spark',
        ownedBalance: null,
        availableBalance: null,
        network,
        isOnline: true,
        wallet: createSparkWalletStub(
          'Server-side stub — Spark Lightning Address not yet supported with Breez SDK',
        ),
      };
    }
```

Remove the unused `getInitializedSparkWallet` private method and clean up unused imports.

- [ ] **Step 4: Remove old SDK entirely**

```bash
rm "patches/@buildonspark%2Fspark-sdk@0.7.4.patch"
bun remove @buildonspark/spark-sdk
```

Remove `patchedDependencies` section from `package.json` if present.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: disable Lightning Address spark path, remove @buildonspark/spark-sdk"
```

---

### Task 8: Final verification and dead code cleanup

- [ ] **Step 1: Run full type/lint check**

```bash
bun run fix:all
```

Fix any remaining errors. Common issues:
- Files importing `moneyFromSparkAmount` → change to `moneyFromSats`
- Files importing any type from `@buildonspark/spark-sdk` → find Breez equivalent or remove
- Files referencing `SparkWalletEvent` → remove
- Unused imports from removed workarounds

- [ ] **Step 2: Verify zero old SDK imports**

```bash
rg "@buildonspark/spark-sdk" app/ --files-with-matches
```

Expected: **No results.**

- [ ] **Step 3: Clean up dead code**

Search for and remove:
- `sparkBalanceQueryKey` if still exported (polling is gone)
- `getLeafDenominations` function
- `verifiedZeroBalanceAccounts` ref
- `findExistingLightningSendRequest` method
- Any `SparkProto` imports
- Any `SparkWalletEvent` references
- Old `updateSparkAccountIfBalanceOrWalletChanged` if not yet removed
- Unused `moneyFromSparkAmount` references

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove dead code and fix remaining type errors"
```

- [ ] **Step 5: Smoke test**

```bash
bun run dev
```

Check:
- App loads without errors
- Wallet initializes (check console for `[Breez]` logs)
- Balance shows correctly
- WASM init completes in `_protected` clientLoader

---

## Follow-up: Lightning Address Spark Support

Lightning Address spark path is disabled. To re-enable:

1. **Fork `@breeztech/breez-sdk-spark`** and expose `receiverIdentityPubkey` parameter on the `bolt11Invoice` receive payment method
2. Update `spark-receive-quote-core.ts` `getLightningQuote` to accept optional `receiverIdentityPubkey`
3. Update `lightning-address-service.ts` spark path to call `getLightningQuote` with the pubkey
4. Implement `handleSparkLnurlpVerify` using event-driven or `listPayments` matching
5. Run `/lnurl-test` to validate

## Follow-up: Prepare response persistence

Currently the `PrepareSendPaymentResponse` is cached in-memory in the service. If the app restarts with a dangling UNPAID quote, the prepare response is lost and we re-prepare. To eliminate this:

1. Store the fields needed to reconstruct `PrepareSendPaymentResponse` in the DB alongside the send quote
2. Reconstruct the response from stored fields in `initiateSend` instead of re-preparing
3. This avoids any extra API call and makes the flow fully deterministic

## Risk Notes

- **`defaultExternalSigner().identityPublicKey()` return type** — `PublicKeyBytes` is opaque from WASM. The `bytesToHex(new Uint8Array(...))` conversion should work (Phase C validation), but verify at runtime. Fallback: `bytesToHex(publicKeyBytes)` directly.
- **Event ordering** — Events might fire before listener registration. Mitigated by initial status check after registering each listener.
- **Single balance** — Breez SDK returns one `balanceSats`. The "funds locked in pending transfer" UI warning will never trigger. Acceptable since Breez handles optimization internally.
- **`privateEnabledDefault`** — Verify `defaultConfig('mainnet').privateEnabledDefault === true` at runtime. If false, add `sdk.updateUserSettings({ sparkPrivateModeEnabled: true })` after connect.
