# Replace Spark SDK with Breez Spark SDK

## Problem

The current `@buildonspark/spark-sdk@0.7.4` has persistent reliability issues, especially on mobile:

- **Balance stuck/stale after transactions** — send or receive completes and appears in history, but balance doesn't update until app reload
- **Balance drops to zero** — occasional false zero balances requiring reload (workaround: wallet reinit on suspected zero)
- **Balance jumps during optimization** — auto-optimization swaps are visible to users as balance fluctuations
- **Owned balance buggier than available** — Spark introduced owned/available split to hide optimization, but owned balance gets stuck even more often
- **Slow wallet initialization** — `SparkWallet.initialize()` is sometimes very slow
- **Unreliable real-time events** — forced polling for balance updates (3s interval), send status, and receive status
- **SDK requires patching** — custom debug logging patch applied to diagnose issues

## Solution

Replace `@buildonspark/spark-sdk` with `@breeztech/breez-sdk-spark` (Breez's Spark SDK). Breez acts as an alternative SSP for the same Spark protocol, offering:

- Event-driven architecture (`Synced`, `PaymentSucceeded/Pending/Failed`, `Optimization`)
- Built-in optimization management with explicit control (`start/cancel/get_progress`)
- Two-step send flow with fee preview (`prepare_send_payment` -> `send_payment`)
- WASM for browser, Node.js v22+ for server
- IndexedDB persistence on web (faster re-init)
- Pre-flight health check (`get_spark_status()`)

## Approach: Prototype (Phase C) then Replace (Phase A)

Prototype first to validate key compatibility, mobile reliability, and event quality. Then do a direct production replacement. No adapter layer — the existing service/hooks/core separation makes direct replacement tractable.

---

## Phase C: Prototype Validation

### C1. Key Derivation Compatibility (Dealbreaker Check)

Install `@breeztech/breez-sdk-spark` alongside current SDK. Write a test script that derives identity public key from a test mnemonic using both SDKs. Compare outputs.

**If keys differ: stop and reassess.** This would mean existing user wallets are not portable, requiring a fund-transfer migration or making the switch infeasible.

Current derivation path:
- `DefaultSparkSigner.mnemonicToSeed(mnemonic)`
- `DefaultSparkSigner.createSparkWalletFromSeed(seed, network, accountNumber)`
- Account number: 0 for REGTEST, 1 for other networks

Breez derivation:
- `Seed.Mnemonic(mnemonic, passphrase: undefined)`
- Passed to `connect({ config, seed })`

### C2. Balance Reliability on Mobile

Build a minimal test page that initializes a Breez wallet and displays balance. Test on mobile devices:
- Make receives via another wallet, verify balance updates without reload
- Make sends, verify balance reflects the change
- Test the exact scenarios that fail today with the current SDK

### C3. Event Reliability

Subscribe to all Breez events and verify on mobile:
- `Synced` — fires reliably after wallet sync
- `PaymentSucceeded` / `PaymentPending` / `PaymentFailed` — fires for sends and receives
- `Optimization` — fires during optimization

Compare latency vs current 3-second polling. Determine if events can fully replace polling for balance, send status, and receive status.

### C4. Optimization Behavior

Verify:
- Does balance stay stable during auto-optimization? (no jumps visible to user)
- Can you send during optimization?
- Does the SDK automatically cancel/pause optimization when a send is initiated?
- If not automatic, test manual `cancel_leaf_optimization` -> send flow

### C5. Fee Comparison

Use `prepare_send_payment()` to get fee quotes for Lightning sends at various amounts. Compare with current `getLightningSendFeeEstimate()` results. Document any significant differences — Breez SSP fees may differ from current SSP.

### C6. Init Performance

Measure `connect()` time vs current `SparkWallet.initialize()`:
- Cold start (first load, no IndexedDB state)
- Warm start (subsequent loads with IndexedDB cache)
- Mobile vs desktop

### C7. Error Catalog

During all C-phase testing, catalog the errors Breez SDK throws:
- Insufficient balance — type, message, structure
- Invoice already paid
- Timeout / network errors
- Offline behavior

This informs the error mapping in Phase A.

---

## Phase A: Production Replacement

Proceeds only after Phase C validates the SDK.

### A1. Core Spark Layer

**Files:** `app/lib/spark/utils.ts`, `app/lib/spark/errors.ts`, `app/features/shared/spark.ts`

- Replace `SparkWallet.initialize()` with Breez `connect({ config, seed })`
- Replace `DefaultSparkSigner` key derivation with Breez `Seed.Mnemonic`
- Add `await init()` WASM initialization step
- Configure with Breez API key and network
- Map Breez error types to existing error guards (`isInsufficientBalanceError`, `isInvoiceAlreadyPaidError`) — mapping determined by C7 findings
- Remove zero-balance workaround and wallet reinit logic
- Remove debug logging patch (`patches/@buildonspark%2Fspark-sdk@0.7.4.patch`)
- Remove `sparkDebugLog` / `__SPARK_SDK_DEBUG__` flag
- Evaluate offline fallback (`createSparkWalletStub`) — determine if Breez handles offline differently

### A2. Event-Driven Balance Updates

**Files:** `app/features/shared/spark.ts`

- Replace 3-second polling (`refetchInterval: 3000`) with Breez event subscriptions
- On `Synced` and `PaymentSucceeded` events: invalidate `sparkBalanceQueryKey`
- Remove `useTrackAndUpdateSparkAccountBalances` polling logic
- Remove zero-balance recovery / wallet reinit workaround

### A3. Optimization

No explicit optimization management needed — Breez SDK handles auto-optimization internally. The `Optimization` event can be used for logging/debugging if needed. Explicit `start/cancel/get_progress` methods are available as fallback if auto behavior proves insufficient.

### A4. Send Flow

**Files:** `app/features/send/spark-send-quote-service.ts`, `spark-send-quote-hooks.ts`, `spark-send-quote-repository.ts`, `spark-send-quote.ts`

- Replace `wallet.getLightningSendFeeEstimate()` + `wallet.payLightningInvoice()` with Breez two-step: `sdk.prepare_send_payment()` -> `sdk.send_payment()`
- Fee estimation now comes from the prepare step (no separate call)
- Replace send status polling with `PaymentSucceeded` / `PaymentFailed` events
- Map Breez payment states to existing quote states (UNPAID -> PENDING -> COMPLETED/FAILED)

### A5. Receive Flow

**Files:** `app/features/receive/spark-receive-quote-core.ts`, `spark-receive-quote-service.ts`, `spark-receive-quote-hooks.ts`, `spark-receive-quote-repository.ts`, `spark-receive-quote-repository.server.ts`, `spark-receive-quote-service.server.ts`

- Replace `wallet.createLightningInvoice()` with `sdk.receivePayment({ type: 'bolt11Invoice' })`
- Replace receive status polling with `PaymentPending` / `PaymentSucceeded` events
- Update `SparkReceiveLightningQuote` type to match Breez response shape

### A6. Lightning Address (Open Question)

**Depends on Breez's answer about delegated invoice creation.**

Current flow: server wallet (from `LNURL_SERVER_SPARK_MNEMONIC`) creates invoices with `receiverIdentityPubkey` pointing to the user's wallet. The server also routes to Cashu accounts for users whose default account is Cashu.

**Files:** `app/features/receive/lightning-address-service.ts`, related route handlers

Scenarios:

1. **Breez supports `receiverIdentityPubkey` equivalent:** Update `lightning-address-service.ts` to use Breez SDK server-side (Node.js). Cashu path stays unchanged.

2. **Breez doesn't support delegated invoices:** Options:
   - Keep `@buildonspark/spark-sdk` server-side only for Lightning Address invoice creation
   - Explore Breez's built-in `register_lightning_address` for Spark accounts only (Cashu path still needs custom server logic)
   - Rearchitect to have client create invoices and register them server-side (adds complexity)

3. **Breez's built-in Lightning Address:** Cannot fully replace custom implementation because the server must also handle Cashu account routing. Could be used for Spark-only accounts if the custom server handles Cashu accounts, but this creates two code paths.

**Action:** Clarify with Breez before Phase A begins. Decision here does not block Phase C or A1-A5.

### A7. Cleanup

- Remove `@buildonspark/spark-sdk` from `package.json` (unless kept for A6 scenario 2)
- Remove patch file `patches/@buildonspark%2Fspark-sdk@0.7.4.patch`
- Remove `createSparkWalletStub` if Breez handles offline differently
- Update `SparkWallet` type references throughout to Breez SDK equivalents
- Update `SparkAccount` type in `app/features/accounts/account.ts`
- Update `spark-account-details-db-data.ts` if network enum differs
- Run `bun run fix:all`, full test pass

---

## Files Affected

### Phase C (new files only, no production changes)
- `package.json` — add `@breeztech/breez-sdk-spark`
- Test page / script for validation (temporary)

### Phase A (production changes)

**Core:**
- `app/lib/spark/utils.ts`
- `app/lib/spark/errors.ts`
- `app/lib/spark/index.ts`
- `app/features/shared/spark.ts`

**Accounts:**
- `app/features/accounts/account.ts`
- `app/features/accounts/account-repository.ts`
- `app/features/agicash-db/json-models/spark-account-details-db-data.ts`

**Send:**
- `app/features/send/spark-send-quote-service.ts`
- `app/features/send/spark-send-quote-hooks.ts`
- `app/features/send/spark-send-quote-repository.ts`
- `app/features/send/spark-send-quote.ts`

**Receive:**
- `app/features/receive/spark-receive-quote-core.ts`
- `app/features/receive/spark-receive-quote-service.ts`
- `app/features/receive/spark-receive-quote-hooks.ts`
- `app/features/receive/spark-receive-quote-repository.ts`
- `app/features/receive/spark-receive-quote-repository.server.ts`
- `app/features/receive/spark-receive-quote-service.server.ts`
- `app/features/receive/spark-receive-quote.ts`

**Lightning Address (pending):**
- `app/features/receive/lightning-address-service.ts`

**User:**
- `app/features/user/user-repository.ts`

**Cleanup:**
- `package.json`
- `patches/@buildonspark%2Fspark-sdk@0.7.4.patch` (delete)

---

## Open Questions

1. **Lightning Address delegated invoices** — Does Breez SDK support creating invoices with a `receiverIdentityPubkey` equivalent? Clarify with Breez.

2. **Breez fee structure** — How do Breez SSP fees compare to current SSP? Phase C5 will answer this empirically.

3. **Optimization UX** — Does Breez auto-optimization fully hide balance jumps? Does it auto-cancel when user initiates a send? Phase C4 will answer this.

4. **TypeScript types** — Verify `@breeztech/breez-sdk-spark` ships `.d.ts` files after install.

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Key derivation incompatibility | Dealbreaker — users can't access existing funds | Phase C1 verification before any production work |
| Breez events unreliable on mobile too | Main motivation for switch invalidated | Phase C2/C3 validation on actual mobile devices |
| No delegated invoice support | Lightning Address server needs dual-SDK or rearchitecture | Clarify with Breez early; fallback: keep old SDK server-side |
| Breez SSP fees significantly higher | Users pay more per transaction | Phase C5 fee comparison before committing |
| WASM bundle size increase | Slower initial load | Measure during Phase C, evaluate lazy loading |
| Breez SDK maturity | Newer SDK may have its own bugs | Phase C validates core flows before production use |
