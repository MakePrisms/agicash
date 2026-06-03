/**
 * SDK-internal scan/decode primitives — Slice 2 (accounts + scan).
 *
 * `scan.parse` (= master `classifyInput`) decodes a raw string via three small,
 * framework-free `app/lib/*` modules: `parseBolt11Invoice` (BOLT11), `extractCashuToken`
 * (cashu), and `buildLightningAddressFormatValidator` (Lightning-address format). The
 * build plan makes `lib/bolt11` / `lib/cashu` / `lib/lnurl` **SDK-internal** (§12 — they
 * are not part of the public surface; only `scan.parse`'s typed result is).
 *
 * Re-housing approach (matches `types/money.ts`): re-export the single live source from
 * `apps/web-wallet/app/lib/*` via a relative path so there is exactly ONE implementation
 * (no duplication, no web churn). The canonical relocation of these files INTO the package
 * is a deliberately-deferred follow-up (out of the SDK build-plan's scope); until then this
 * module is the SDK-internal seam every scan consumer imports from. None of these three
 * functions transitively pulls react / @tanstack (verified) — the framework-free constraint
 * holds.
 *
 * The functions imported here are the *format/decode* primitives only. The NETWORK side of
 * LNURL (`getInvoiceFromLud16`, ln-address → invoice) is NOT a scan concern — it folds into
 * `createLightningQuote` (Slice 3/PR5), where the amount is known (§3).
 *
 * @module
 */

export {
  type DecodedBolt11,
  parseBolt11Invoice,
} from '../../../../apps/web-wallet/app/lib/bolt11';
export { extractCashuToken } from '../../../../apps/web-wallet/app/lib/cashu/token';
export { buildLightningAddressFormatValidator } from '../../../../apps/web-wallet/app/lib/lnurl';
