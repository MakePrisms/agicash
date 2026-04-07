# Breez Spark SDK Validation Results

## C1: Key Derivation Compatibility

**Result: MATCH** — Same mnemonic produces identical identity public keys from both SDKs. Existing user wallets are portable to the Breez SDK.

## C2: Balance Reliability on Mobile

TODO

## C3: Event Reliability

TODO

## C4: Optimization Behavior

**Result: PASS** — Optimization runs in the background (visible in SDK logs) but balance remains stable throughout. No jumps, no drops to zero, no flickering. This is a major improvement over the current Spark SDK where balance drops to zero or jumps unpredictably during optimization swaps.

## C5: Fee Comparison

**Result: SAME** — Fees observed during manual payment testing are identical between Breez SDK and current Spark SDK. Both use the same Spark protocol and SSP infrastructure, so fee parity is expected.

## C6: Init Performance

TODO

## C7: Error Catalog

TODO

## Integration Notes

- Import from `@breeztech/breez-sdk-spark` (root path, not `/bundler`) — root has conditional exports: Node.js gets CJS entry, browser gets ESM/WASM entry
- WASM init must happen in `entry.client.tsx` (client-only) via dynamic import
- All SDK usage in app code must use dynamic `import()` to avoid SSR module graph issues
- Exclude from `optimizeDeps` in Vite config
