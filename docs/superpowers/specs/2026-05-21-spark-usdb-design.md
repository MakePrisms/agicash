# Spark USD account (USDB)

## Problem

Today every agicash user gets one Spark account (`currency: 'BTC'`) plus, in dev mode, Cashu accounts. There is no native way for a user to hold a USD balance backed by anything other than Cashu USD mint ecash. USDB — a USD-pegged stablecoin native to Spark, issued by Brale, backed 1:1 by T-bills, with auto-rewards paid daily in BTC — is supported by our `@agicash/breez-sdk-spark@0.13.5-1` fork via the SDK's `stable_balance` feature. We want users to hold both BTC and USD on Spark and choose their allocation.

## Approach: one user, two Spark wallets

Each user gets two Spark accounts — `(type:'spark', currency:'BTC')` and `(type:'spark', currency:'USD')` — seeded on user upsert. Both share the same BIP-85-derived spark mnemonic. They differ at the SDK layer by `KeySetConfig.accountNumber`: BTC stays on the existing implicit default (`accountNumber = 1`, preserving every existing user's wallet); USD uses the next index up (`accountNumber = 2`). Both values are locked in the pre-flight section below. Note: `ConnectRequest` exposes no `accountNumber` field — this parameter must flow through `SdkBuilder.withKeySet({ keySetType: 'default', useAddressIndex: false, accountNumber })` or `defaultExternalSigner(..., keySetConfig) + connectWithSigner(...)`.

The USD wallet is configured with `stable_balance_config.tokens = [{ label:"USDB", token_identifier: USDB_MAINNET_ID }]`, `default_active_label: "USDB"`, `threshold_sats: 0`. Every Lightning sat received on the USD wallet auto-converts to USDB via Flashnet; every Lightning send from the USD wallet auto-converts USDB→sats first. The BTC wallet has no `stable_balance_config`.

User-driven allocation in MVP = self-pay over Lightning. To move BTC→USD: receive into USD, pay from BTC. No dedicated Convert button.

## Non-goals (MVP)

- A "Convert" / "Swap" button. Allocation = self-pay.
- Failed-conversion recovery UI. `RefundNeeded` cases log to Sentry and stay PENDING.
- USDB on regtest. Mainnet-only until a test-token issuance flow is added.
- Multi-decimal USD `Money`. Sub-cent USDB amounts round to cents at the SDK boundary.
- Generating Spark invoices for direct USDB transfer. Receive surface is BOLT11 only; the wallet's Spark address still passively receives, but the UI does not expose Spark invoice generation.
- Upstream SDK rebase. Stay on `0.13.5-1`; `refundPendingConversions()` (only in 0.15.0) is deferred.

## USDB facts (locked)

- **Mainnet token identifier:** `btkn1xgrvjwey5ngcagvap2dzzvsy4uk8ua9x69k82dwvt5e7ef9drm9qztux87`
- **Decimals:** 6
- **Issuer:** Brale (FinCEN-registered, multi-state MTL, SOC 2 Type II)
- **Network:** Spark mainnet only
- **Backing:** 1:1 US T-bills + cash equivalents
- **Sources:** Flashnet USDB docs, Sparkscan, Breez `docs/breez-sdk/src/guide/stable_balance.md`

## Pre-flight verification (run before any code lands)

Two one-off checks in `tools/spark-usdb-preflight.ts`, run by an engineer; findings baked in below and locked.

### P1. account_number invariant — LOCKED

Ran `tools/spark-usdb-preflight.ts` against `@agicash/breez-sdk-spark@0.13.5-1` on mainnet. The script opens five SDK instances on the same throwaway mnemonic — one via `connect()` (implicit default) and four via `SdkBuilder.new(...).withKeySet({ keySetType: 'default', useAddressIndex: false, accountNumber }).withDefaultStorage(...).build()` for `accountNumber ∈ {0, 1, 2, 3}` — then compares `getInfo().identityPubkey`.

Important SDK quirk discovered while building the script: **`ConnectRequest` has no `accountNumber` field**. Passing one there is silently ignored and every instance lands on the implicit default. To exercise `accountNumber` you must use `SdkBuilder.withKeySet(...)`, `defaultExternalSigner(..., keySetConfig)`, or `connectWithSigner` with that signer.

Observed mapping (mainnet, 2026-05-21):

```
account_number=undefined → 03306d04c5f275a71219150429428a3931a7d551abf455a8a493527985c8efb4aa
account_number=0         → 02caf557cc3dd4ffebfcdda12863be9416e75fa7f813f4f1887a7193694e28c346
account_number=1         → 03306d04c5f275a71219150429428a3931a7d551abf455a8a493527985c8efb4aa
account_number=2         → 0365982a7a0a7951215b4590fa30241b10ad91427dfd050777db510b3d9df35f82
account_number=3         → 021f8c31a029994fd2ce43495cee73fb38ea850a90eff9c28e7983565c401db8d7

Groups:
  1, undefined → 03306d04…
  0            → 02caf557…
  2            → 0365982a…
  3            → 021f8c31…
```

So `undefined == 1`: existing BTC users derive their identity at `account_number = 1`. Each of `0`, `2`, `3` is distinct.

**Locked constants** (used everywhere the SDK is initialised):

```
BTC_ACCOUNT_NUMBER = 1   // implicit default; existing users are here. Pass explicitly going forward.
USD_ACCOUNT_NUMBER = 2   // smallest numeric value distinct from BTC, and the next sequential index — matches the "default + 1" rule.
```

Note: although `accountNumber: 0` produced a distinct pubkey, picking `0` would be confusing (numerically lower than the BTC default) and `2` is the smallest *sequentially-greater* distinct value, which is what every prior outcome bullet in this section assumed. Stick with `2`.

### P2. USDB metadata reachable — LOCKED

Called `getTokensMetadata({ tokenIdentifiers: [USDB_MAINNET_ID] })` (the actual SDK request field is `tokenIdentifiers`, not `identifiers`). Returned, mainnet, 2026-05-21:

```json
{
  "identifier": "btkn1xgrvjwey5ngcagvap2dzzvsy4uk8ua9x69k82dwvt5e7ef9drm9qztux87",
  "issuerPublicKey": "024137d3a0a67d26254a0c87260a80e9ea3430945d4c9520d3f549f019171252a7",
  "name": "Bitcoin USD",
  "ticker": "USDB",
  "decimals": 6,
  "maxSupply": "0",
  "isFreezable": true
}
```

`ticker === "USDB"` ✓, `decimals === 6` ✓. Issuer pubkey matches the Brale-controlled key. Metadata path is healthy.

## Architecture

```
opensecret master seed
        │
        ▼
BIP-85 path ('spark', 12) → one mnemonic (unchanged from today)
        │
        ├─► SDK instance "BTC"
        │    account_number: <implicit default; verified by P1>
        │    config: defaultConfig(network)
        │            (no stable_balance_config)
        │    storage_dir: spark-<btcAccountId>
        │    balance source: getInfo().balance_sats
        │
        └─► SDK instance "USD"
             account_number: <implicit default + 1>
             config: defaultConfig(network) +
                     stable_balance_config: {
                       tokens: [{ label: "USDB", token_identifier: USDB_MAINNET_ID }],
                       default_active_label: "USDB",
                       threshold_sats: 0 }
             storage_dir: spark-<usdAccountId>
             balance source: getInfo().token_balances[USDB_MAINNET_ID].balance
```

Both instances live in browser memory concurrently. Existing `useTrackAndUpdateSparkAccountBalances` extends to track both.

## Components

Mirror the Cashu multi-currency idioms throughout (currency as wallet-init input, `amount: Money` carrying currency on quotes, separate fee components in DB with computed total, prevent-cross-currency-at-boundary, single accounts cache filtered by ID + currency).

### SDK init layer — `app/features/shared/spark.ts`

`getInitializedSparkWallet(account)` becomes account-aware. The function reads `account.currency` and `account.id` and:

- Derives `account_number` via a new pure helper `getSparkAccountNumber(currency: Currency): number`.
- Derives `storageDir` per account ID: `spark-${accountId}`.
- Derives `stable_balance_config` via a new pure helper `getSparkStableBalanceConfig(currency, network)` — `undefined` for BTC, populated for USD.
- After `connect()` and `getInfo()`, dispatches on `account.currency`:
  - BTC: balance = `Money({ amount: info.balance_sats, currency: 'BTC', unit: 'sat' })`.
  - USD: balance = `convertUsdbToMoney(info.token_balances[USDB_MAINNET_ID]?.balance ?? 0n)`.
- On init, the USD branch also sanity-checks `getTokensMetadata({ identifiers: [USDB_MAINNET_ID] })`. If the call fails or returns no metadata, fall through to `createSparkWalletStub()` and `isOnline: false`, mirroring the existing offline-spark pattern. Sentry captures the underlying error.

### Pure helpers — `app/lib/spark/usdb.ts` (new)

Colocated with `app/lib/cashu/*` precedent. Pure functions, unit-tested per the existing `app/lib/*` pattern:

- `USDB_MAINNET_ID: string` — single source of truth.
- `convertUsdbToMoney(rawTokenBalance: bigint): Money<'USD'>` — divides the 6-decimal `u128` token amount down to cents (rounding half-away-from-zero). Sub-cent amounts round to nearest cent; rounding direction documented inline.
- `getSparkAccountNumber(currency: Currency): number` — BTC → implicit-default (likely 1), USD → default+1 (likely 2). Exact values determined by P1.
- `getSparkStableBalanceConfig(currency: Currency, network: SparkNetwork): StableBalanceConfig | undefined`.

### Account type — `app/features/accounts/account.ts`

`SparkAccount` widens from `currency: 'BTC'` to `currency: 'BTC' | 'USD'`. Carries through `account-repository.ts` and SDK selection.

### Account schema — `app/features/agicash-db/json-models/spark-account-details-db-data.ts`

Unchanged. Currency lives on the parent account row, not in spark details. Spark details stays `{ network }`.

### DB unique index — new migration

Mirror the existing Cashu pattern (`cashu_accounts_user_currency_mint_unique`):

```sql
create unique index "spark_accounts_user_currency_network_unique"
  on "wallet"."accounts" ("user_id", "currency", details->>'network')
  where type = 'spark';
```

Prevents a user from accidentally getting two Spark USD accounts.

### Default account seeding — `app/features/user/user-hooks.tsx:79`

Add to `defaultAccounts`:

```ts
{ type:'spark', currency:'USD', name:'Dollars', network:'MAINNET',
  isDefault: true, purpose:'transactional', expiresAt: null }
```

The `upsert_user_with_accounts` RPC seeds it for new and existing users on the next `_protected.tsx` `ensureUserData` run. In dev mode the existing `cashu USD (Testnut USD)` entry's `isDefault` flips to `false` so the Spark USD account wins the USD default. The DB constraint `users_default_currency_has_account` continues to hold.

### Receive quote stack — `app/features/receive/spark-receive-quote-*.ts`

No new files. Touches:

- `getLightningQuote()` selects the SDK instance per account (existing pattern; just works when a second spark account exists).
- New conversion-completion wait. After `receivePayment()` returns the BOLT11 and the Lightning leg's `paymentSucceeded` fires on a USD account, the hook keeps the quote in PENDING and waits for the conversion-leg event (a second `paymentSucceeded` carrying `conversion_details.status === 'Completed'`, or equivalent — exact event shape pinned down in the plan). Only then mark COMPLETED. For BTC accounts, `paymentSucceeded` completes the quote in one step (unchanged).
- Persisted fields gain (under the receive quote DB JSON model): `bolt11AmountSats: Money<'BTC'>`, `conversionFee: Money<'BTC'>`, `slippageDelta: Money<'BTC'>`, `usdbAmountReceived: Money<'USD'>`. Total visible to user is just the final `Money<'USD'>` received.

### Send quote stack — `app/features/send/spark-send-quote-*.ts`

No new files. Touches:

- `prepareSendPayment()` on the USD account returns a `conversion_estimate` (the SDK auto-fills `conversion_options` from `stable_balance_config`). The hook surfaces total fee = `conversion_fee + lightning_fee` (both natively sats, summed as `Money<'BTC'>`, displayed by the existing `Money` USD-localization helper using the live exchange rate). DB persists components separately as `Money<'BTC'>`. Mirrors Cashu's `lightningFeeReserve` / `cashuSendFee` / computed total pattern.
- `sendPayment()` runs two legs (conversion + Lightning). The hook marks COMPLETED only after both succeed.
- New persisted fields: `usdbDebited: Money<'USD'>`, `satsAfterConversion: Money<'BTC'>`, `lightningFee: Money<'BTC'>`, `conversionFee: Money<'BTC'>`, `slippageActual: Money<'BTC'>`.

### UI

- Accounts list naturally picks up the new USD spark account; the existing `useAccounts({ currency })` filter already isolates by currency.
- Receive and send screens already iterate over accounts; the new USD spark account flows in for free. Name shown: "Dollars."
- No new screens or components.

## Data flow

### A. First login or next protected-route navigation (existing user gets USD account)

```
User navigates to any /_protected/* route
  → _protected.tsx ensureUserData()
     → writeUserRepository.upsert(defaultAccounts)
        → upsert_user_with_accounts RPC:
            inserts (type:'spark', currency:'USD') if not present
            sets user.default_usd_account_id = new row's id
  → useAccounts re-fetches → Spark USD account appears
  → useTrackAndUpdateSparkAccountBalances sees a new spark account
     → getInitializedSparkWallet(usdAccount)
        → connect({
            seed: { type:'mnemonic', mnemonic },
            account_number: getSparkAccountNumber('USD'),
            storageDir: 'spark-<usdAccount.id>',
            config: { …defaultConfig(network),
                      stable_balance_config: getSparkStableBalanceConfig('USD', network) } })
        → sanity-check getTokensMetadata([USDB_MAINNET_ID])
        → SDK B online, balance = token_balances[USDB_MAINNET_ID] (likely 0)
        → registers paymentSucceeded / paymentPending / paymentFailed listeners
```

### B. Receive into USD account

```
User picks "Dollars" as receive account, enters $5 USD
  → useCreateSparkReceiveQuote
     → SDK B.receivePayment({
         paymentMethod: { type:'bolt11Invoice',
                          amountSats: <$5 via exchange rate>,
                          description,
                          receiverIdentityPubkey: B's pubkey } })
     → bolt11 returned, displayed; quote persisted, state = UNPAID

Payer pays the bolt11 →
  → SDK B fires paymentSucceeded { paymentType:'lightning', amount_sats }
     hook DOES NOT mark the receive completed yet (USD branch)
     records lightning-leg-settled on the quote (sub-state)

Flashnet conversion runs (seconds later) →
  → SDK B fires paymentSucceeded { paymentType:'token-conversion',
                                   conversion_details: { from:{sats}, to:{usdb}, fee, status:'Completed' } }
     hook marks quote COMPLETED:
       persists bolt11AmountSats, conversionFee, slippageDelta, usdbAmountReceived
       invalidates account balance cache
     UI shows "Received $X.XX USDB" as a single event
```

For a BTC account, the Lightning `paymentSucceeded` completes the quote in one step. The dual-event handling is USD-only.

### C. Send from USD account

```
User picks "Dollars" as send source, pastes bolt11
  → useCreateSparkLightningSendQuote
     → SDK B.prepareSendPayment({ paymentRequest: bolt11, amount: <invoice amount sats> })
        SDK B detects sats balance insufficient,
        auto-fills conversion_options from stable_balance_config,
        returns prepareResponse with conversion_estimate and lightning_fee
  → UI shows total = conversion_fee + lightning_fee (in USD)
    DB stores components

User confirms →
  → SDK B.sendPayment({ prepareResponse, idempotencyKey })
     Conversion leg succeeds → paymentSucceeded { paymentType:'token-conversion', Completed }
     Lightning leg succeeds  → paymentSucceeded { paymentType:'lightning' }
     hook marks COMPLETED only after both
     persists usdbDebited, satsAfterConversion, lightningFee, conversionFee, slippageActual
```

### Allocation

Composition of B and C. To move BTC→USD: generate USD-account BOLT11, pay it from BTC account. Reverse for USD→BTC. No new code paths, no new state machines.

## Error handling

### Currency mismatch — prevented at boundary

The account row's `currency` is the source of truth; SDK selection is derived from it inside `getInitializedSparkWallet`. App code never calls SDK methods with a mismatched currency context. The DB unique index `spark_accounts_user_currency_network_unique` prevents accidental duplicates.

### USDB metadata unreachable at init

`getTokensMetadata` failure → stub wallet + `isOnline: false`, mirroring existing offline-spark fallback at `spark.ts:168`. UI shows the offline state.

### Insufficient balance on send

SDK returns a typed error from `prepareSendPayment` when neither sats nor convertible USDB cover the destination. Mapped to the existing `InsufficientBalanceError` used by the Cashu send path.

### Lightning leg fails after conversion succeeded (send from USD)

USDB has been debited and converted; dangling sats now sit in the USD wallet's `balance_sats`. Quote → FAILED, user sees failure. Sentry alert tagged `spark.usd.dangling_sats`. Dangling sats persist until subsequent USD-account receive consumes them via threshold logic or a manual operator intervention.

### Conversion leg fails on receive (`RefundNeeded`)

Sats arrived, Flashnet retried internally for ~120s, then flagged `RefundNeeded`. Log to Sentry with `paymentId`, sats amount, status. Quote stays PENDING. No app-side recovery in MVP. Sentry tag `spark.usd.conversion_refund_needed`. The future 0.15.0 rebase unlocks `refundPendingConversions()` for automated recovery.

### Stale balance from event races

Cashu pattern: `staleTime: Number.POSITIVE_INFINITY` + explicit invalidation on event. Mirror exactly. `useTrackAndUpdateSparkAccountBalances` invalidates on both the Lightning `paymentSucceeded` and the conversion-leg `paymentSucceeded`.

### Wrong account in receive/send UI

Already prevented by `useAccounts({ currency })` filter in the picker. Once the USD spark account exists with `currency: 'USD'`, it appears in the USD picker only.

### SDK-level errors (network, auth, panic)

Existing `tracing-subscriber` + Sentry instrumentation captures these. New tag `spark.account_number` distinguishes which wallet emitted the error.

## Testing

The project's existing test coverage is: pure-function unit tests under `app/lib/*` (vitest via `bun test`) and Playwright e2e for auth flows only. No tests for spark code, hooks, services, repositories. We do not introduce new test categories.

### Pre-flight scripts in `tools/` (run-once, not regression tests)

- **P1.** `account_number` invariant — see above.
- **P2.** USDB metadata reachability — see above.

### Unit tests for new pure helpers

Only because they live under `app/lib/spark/`, matching the existing `app/lib/cashu/*.test.ts` and `app/lib/money/money.test.ts` precedent:

- `convertUsdbToMoney` — round-trip, sub-cent rounding edge cases.
- `getSparkAccountNumber` — currency → number mapping.
- `getSparkStableBalanceConfig` — undefined for BTC, populated for USD with the right token id.

### Manual smoke checklist (pre-merge, ~5 min)

Real mainnet, tiny amounts:

1. Fresh-login a test user; verify both "Bitcoin" and "Dollars" spark accounts present.
2. Generate USD-account BOLT11, pay $1 from a separate wallet, verify "Received $1.00 USDB" after conversion settles.
3. Send $0.50 BOLT11 from USD account to a separate wallet, verify USDB debited.
4. Internal allocation: generate USD-account BOLT11, pay from BTC account, verify USDB shows up.

## Known limitations

- **No `refundPendingConversions()`.** `RefundNeeded` cases stuck until manually addressed. Future SDK rebase fixes this.
- **USDB on mainnet only.** No regtest test path yet.
- **Sub-cent rounding.** USDB has 6 decimals; we round to cents at the SDK boundary. Tiny rounding loss accepted.
- **Dangling sats on partial send failure.** Sats can sit in USD wallet's `balance_sats` if Lightning fails after conversion. Sentry alert; no automated recovery.

## Future work (out of scope)

- Convert/swap UI for explicit allocation.
- Failed-conversion recovery (depends on `refundPendingConversions()` from upstream 0.15.0+).
- Transaction history that surfaces conversion events.
- USDB on regtest (issue a test token via `getTokenIssuer().createIssuerToken`).
- Allocation preferences ("always keep $X in sats").
- Multi-decimal `Money<'USD'>` to preserve full USDB precision.
