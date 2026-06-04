/**
 * SDK-internal spark error-classification primitives — Slice 3 / PR5c (spark send + receive).
 *
 * The spark send service distinguishes two Breez `sendPayment` failure modes — an
 * already-paid invoice (`isInvoiceAlreadyPaidError`) and an insufficient-balance error
 * (`isInsufficentBalanceError`) — to surface a precise {@link DomainError} instead of the
 * raw Breez message. Master imports these from the `~/lib/spark` barrel.
 *
 * Re-housing approach (matches `./lib-scan` / `./lib-cashu` / `./lib-lnurl`): re-export the
 * single live source via a relative path so there is exactly ONE implementation (no
 * duplication, no web churn).
 *
 * **IMPORTANT — import from the SPECIFIC `lib/spark/errors` module, NOT the `lib/spark`
 * barrel.** The barrel (`app/lib/spark/index.ts`) re-exports `./wasm`, whose top-level
 * `import initBreezWasm from '@agicash/breez-sdk-spark'` pulls the native/WASM package at
 * module-eval — exactly what the framework-free + no-WASM-in-tests constraint forbids. These
 * two error helpers live in `app/lib/spark/errors.ts`, which is pure (`instanceof Error` + a
 * lower-cased message substring check) and pulls nothing. (Same discipline `lib-cashu-quotes`
 * uses to avoid the mint-WS subscription managers in the `lib/cashu` barrel.)
 *
 * @module
 */

export {
  isInsufficentBalanceError,
  isInvoiceAlreadyPaidError,
} from '../../../../apps/web-wallet/app/lib/spark/errors';
