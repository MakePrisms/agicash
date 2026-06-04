/**
 * Cashu NUT error codes — re-exported from the in-package canonical `../lib/cashu/error-codes`.
 *
 * The canonical `CashuErrorCodes` enum now lives in the package at `lib/cashu/error-codes.ts`
 * (relocated out of the web app). This module kept its own VERBATIM copy while the source was
 * in the web app; now that they are co-located, it re-exports the single source so the prior
 * internal consumers (`classify.ts` + the cashu services) keep their `./cashu-error-codes`
 * import path unchanged. NOT part of the public barrel.
 */

export { CashuErrorCodes } from '../lib/cashu/error-codes';
