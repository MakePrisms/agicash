/**
 * SDK-internal LNURL primitive — Slice 3 / PR5b.
 *
 * `createLightningQuote` resolves a Lightning address (LUD-16) to a bolt11 invoice INTERNALLY,
 * using the known amount (the contract folds ln-address → invoice into the quote creation, NOT
 * into `scan.parse`, §3). That resolution is `getInvoiceFromLud16` (LNURL-pay) from
 * `app/lib/lnurl`, which is framework-free (`ky` HTTP only — no react / @tanstack; verified).
 *
 * Re-housing approach (matches `./lib-scan` / `./lib-cashu`): re-export the single live source
 * via a relative path so there is exactly ONE implementation. The canonical relocation of
 * `app/lib/lnurl` INTO the package is a deferred follow-up (out of the build-plan's scope).
 *
 * `getInvoiceFromLud16` returns `LNURLPayResult | LNURLError` — the caller checks `isLNURLError`
 * and throws a {@link DomainError} on the error branch (master's `use-get-invoice-from-lud16`
 * does the same). The `requestDomain` "bypassAmountValidation" optimisation master reads from
 * `useLocationData().domain` is passed in from `SdkConfig` (or omitted) — re-housed off the hook.
 *
 * @module
 */

export {
  type LNURLError,
  type LNURLPayResult,
  getInvoiceFromLud16,
  isLNURLError,
} from '../../../../apps/web-wallet/app/lib/lnurl';
