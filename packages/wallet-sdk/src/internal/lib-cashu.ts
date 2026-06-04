/**
 * SDK-internal cashu helpers — Slice 2 (accounts + scan).
 *
 * The account domain needs a few small, framework-free cashu utilities:
 *  - `sumProofs` / `getCashuUnit` — to compute a cashu account's balance from its proofs
 *    (`getBalance`, mirroring master `getAccountBalance` in `accounts/account.ts`);
 *  - `normalizeMintUrl` / `checkIsTestMint` — for `add` (canonicalise the mint URL +
 *    detect a test mint, mirroring master `account-service.addCashuAccount` +
 *    `account-repository.create`).
 *
 * The pure cashu helpers now live IN the package at `../lib/cashu` (relocated out of the
 * web app — framework-free: `@cashu/cashu-ts` / `@agicash/lib` / `@noble/*` / `zod/mini`,
 * no react / @tanstack; verified). This seam re-exports them from the specific modules
 * (`utils` for the URL/unit helpers, `proof` for `sumProofs`) so SDK consumers import them
 * single-source. The web-only React subscription managers are NOT here — they stay in
 * `apps/web-wallet/app/lib/cashu` behind the web `~/lib/cashu` shim.
 *
 * @module
 */

export {
  checkIsTestMint,
  getCashuUnit,
  normalizeMintUrl,
} from '../lib/cashu/utils';
export { sumProofs } from '../lib/cashu/proof';
