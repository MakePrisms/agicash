/**
 * Web `~/lib/cashu` shim.
 *
 * The pure cashu-protocol helpers (proofs, tokens, secrets, mint URL/unit utils, the
 * extended wallet/mint-info wrappers, mint-feature validation, DLEQ blind-signature
 * matching, payment-request + error codes) were relocated INTO `@agicash/wallet-sdk`
 * (`packages/wallet-sdk/src/lib/cashu`). This barrel re-exports them FROM the SDK so the
 * ~40 web call sites that import `~/lib/cashu` keep working unchanged.
 *
 * The web-only React/stateful cashu layer — the mint/melt quote subscription managers
 * and the `useOnMeltQuoteStateChange` hook — stays LOCAL (they import `react` /
 * `@tanstack/react-query` and so cannot move into the framework-free SDK) and is
 * re-exported alongside the SDK pures here.
 */

// --- pure cashu-protocol helpers (now in @agicash/wallet-sdk) ---
export * from '@agicash/wallet-sdk/lib/cashu';

// --- web-only React/stateful cashu layer (local) ---
export * from './melt-quote-subscription';
export * from './melt-quote-subscription-manager';
export * from './mint-quote-subscription-manager';
