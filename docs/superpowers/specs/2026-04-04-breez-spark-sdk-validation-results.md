# Breez Spark SDK Validation Results

## C1: Key Derivation Compatibility

**Result: MATCH** — Same mnemonic produces identical identity public keys from both SDKs. Existing user wallets are portable to the Breez SDK.

## C2: Balance Reliability on Mobile

**Result: PASS (with caveat)** — Balance is stable during optimization (no jumps/drops). However, balance updates are delayed ~45-60s after payments — `getInfo({})` returns stale state until the next `synced` event. The current Spark SDK updates balance faster (via polling) but then jumps during optimization. Investigation pending on whether the delay is a version issue (`0.12.2` vs Glow's `0.12.2-dev3`).

## C3: Event Reliability

**Result: PASS** — Events fire reliably: `synced` every ~60s, `paymentSucceeded`/`paymentPending`/`claimedDeposits` on payments, `optimization` during background optimization. Event-driven balance updates work (no polling needed) but balance in `getInfo` is stale until `synced` fires.

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

TODO

## Integration Notes

- Import from `@breeztech/breez-sdk-spark` (root path, not `/bundler`) — root has conditional exports: Node.js gets CJS entry, browser gets ESM/WASM entry
- WASM init must happen in `entry.client.tsx` (client-only) via dynamic import
- All SDK usage in app code must use dynamic `import()` to avoid SSR module graph issues
- Exclude from `optimizeDeps` in Vite config
