/**
 * SDK-internal scan/decode primitives — Slice 2 (accounts + scan).
 *
 * `scan.parse` (= master `classifyInput`) decodes a raw string via three small,
 * framework-free `app/lib/*` modules: `parseBolt11Invoice` (BOLT11), `extractCashuToken`
 * (cashu), and `buildLightningAddressFormatValidator` (Lightning-address format). The
 * build plan makes `lib/bolt11` / `lib/cashu` / `lib/lnurl` **SDK-internal** (§12 — they
 * are not part of the public surface; only `scan.parse`'s typed result is).
 *
 * `bolt11`, `cashu` and `lnurl` all now live IN the package at `../lib/*` (relocated out of
 * the web app — leaf + framework-free: `light-bolt11-decoder` / `@noble/*` / `@scure/base`
 * for bolt11, `@cashu/cashu-ts` for cashu, `ky` for lnurl). This seam re-exports the
 * format/decode primitives from those in-package modules. None of these three functions
 * transitively pulls react / @tanstack (verified) — the framework-free constraint holds.
 *
 * The functions imported here are the *format/decode* primitives only. The NETWORK side of
 * LNURL (`getInvoiceFromLud16`, ln-address → invoice) is NOT a scan concern — it folds into
 * `createLightningQuote` (Slice 3/PR5), where the amount is known (§3).
 *
 * @module
 */

export {
  type DecodedBolt11,
  decodeBolt11,
  parseBolt11Invoice,
} from '../lib/bolt11';
export { extractCashuToken } from '../lib/cashu/token';
export { buildLightningAddressFormatValidator } from '../lib/lnurl';
