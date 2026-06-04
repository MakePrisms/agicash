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
 * The build plan makes `lib/cashu` **SDK-internal** (§12). Re-housing approach (matches
 * `types/money.ts` + `lib-scan.ts`): re-export the single live source from the specific
 * `app/lib/cashu/*` modules via a relative path so there is exactly ONE implementation. We
 * import from the specific modules (`utils` for the URL/unit helpers, `proof` for
 * `sumProofs`) NOT the `lib/cashu` barrel, to avoid pulling the heavier subscription-manager
 * / payment-request surface the barrel re-exports — those are Slice 3. None of the imported
 * functions transitively pulls react / @tanstack (verified).
 *
 * @module
 */

export {
  checkIsTestMint,
  getCashuUnit,
  normalizeMintUrl,
} from '../../../../apps/web-wallet/app/lib/cashu/utils';
export { sumProofs } from '../../../../apps/web-wallet/app/lib/cashu/proof';
