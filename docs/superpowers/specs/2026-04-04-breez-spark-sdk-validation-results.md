# Breez Spark SDK Validation Results

## C1: Key Derivation Compatibility

**Result: MATCH** — Same mnemonic produces identical identity public keys from both SDKs. Existing user wallets are portable to the Breez SDK.

## C2: Balance Reliability on Mobile

**Result: PASS** — Balance updates immediately on `paymentSucceeded` events when running Breez SDK alone. Earlier testing showed ~45-60s delays, but that was caused by running both Spark and Breez SDKs in parallel on the same wallet — the two SDKs interfered with each other. With a fresh wallet on Breez-only, balance is reliable and stable during optimization (no jumps/drops).

## C3: Event Reliability

**Result: PASS** — Events fire reliably: `synced` every ~60s, `paymentSucceeded`/`paymentPending`/`claimedDeposits` on payments, `optimization` during background optimization. Event-driven balance updates work — `getInfo({})` returns current balance immediately on `paymentSucceeded`. No polling needed.

## C4: Optimization Behavior

**Result: PASS** — Optimization runs in the background (visible in SDK logs) but balance remains stable throughout. No jumps, no drops to zero, no flickering. Major improvement over current Spark SDK.

## C5: Fee Comparison

**Result: SAME** — Fees are identical between Breez SDK and current Spark SDK. Both use the same Spark protocol.

## C6: Init Performance

**Result: PASS** — Significantly faster than current Spark SDK.

| Measurement | Time |
|---|---|
| WASM module load (page load, non-blocking) | ~240ms |
| Cold connect + getInfo | ~78ms |
| Warm connect + getInfo | ~18ms |
| getInfo alone | 2–4ms |

Current Spark SDK `getInitializedSparkWallet` (init + getBalance): 200ms–few seconds. Breez equivalent (connect + getInfo): **78ms cold**. WASM loads during login screen so it doesn't block the home page.

## C7: Error Catalog

**Result: WORKABLE** — All errors are plain `Error` (no typed subclasses). Must match on message strings.

| Scenario | Constructor | Message match |
|---|---|---|
| Insufficient balance | `Error` | `insufficient funds` |
| Already paid invoice | `Error` | `preimage request already exists` |

**Key difference from current Spark SDK:** Spark SDK's `SparkError` has `getContext()` returning structured data (e.g., `{ expected, value, field }` for insufficient balance). Breez SDK errors are plain `Error` with flat message strings — no typed subclasses, no structured context.

**Mitigations:**
- **Insufficient balance:** Total cost is already known from `prepareSendPayment` response (amount + fees) before `sendPayment` is called. Use that instead of extracting from the error.
- **Already paid:** Same underlying gRPC error as current SDK (`preimage request already exists`). Match with `message.includes('preimage request already exists')` — same pattern as current `isInvoiceAlreadyPaidError`.

## C8: Send Payment Idempotency

**Result: PASS** — `SendPaymentRequest` and `LnurlPayRequest` both have an optional `idempotencyKey` field. Pass a unique key (e.g., payment hash) and the SDK handles deduplication natively. This is an improvement over the current Spark SDK which has no idempotency support — we had to catch errors and call `findExistingLightningSendRequest` to recover the request ID for duplicate sends.

## Integration Notes

- Import from `@agicash/breez-sdk-spark` (our fork, published with Node ESM entry so no dynamic `import()` is needed to avoid SSR module graph issues)
- WASM init happens inside the `_protected` route middleware — only logged-in users pay that cost
- Exclude from `optimizeDeps` in Vite config
