/**
 * SDK-internal cashu **wallet-construction** primitives — Slice 3 (cashu + spark).
 *
 * Building a cashu account's LIVE handle (`ExtendedCashuWallet`) needs a few more
 * `app/lib/cashu` symbols than the Slice-2 balance/url helpers (`./lib-cashu`): the
 * extended wallet class itself, its factory, and the extended mint-info wrapper. They live
 * in `app/lib/cashu/utils.ts` + `protocol-extensions.ts` and are framework-free
 * (`@cashu/cashu-ts` only — no react / @tanstack; verified), so per the build plan (§12,
 * `lib/cashu` is SDK-internal) we re-export the single live source via a relative path —
 * exactly as `./lib-cashu` / `./lib-scan` / `types/money.ts` do — so there is ONE
 * implementation and no web churn. The canonical relocation of `app/lib/cashu/**` INTO the
 * package is a deferred follow-up (out of the build-plan's scope).
 *
 * Split from `./lib-cashu` (the small pure balance/url helpers) on purpose: the wallet
 * factory pulls the heavier `@cashu/cashu-ts` `Wallet`/`Mint` surface, which only the
 * Slice-3 wallet-init path needs.
 *
 * @module
 */

export {
  ExtendedCashuWallet,
  getCashuProtocolUnit,
  getCashuWallet,
} from '../../../../apps/web-wallet/app/lib/cashu/utils';
export { ExtendedMintInfo } from '../../../../apps/web-wallet/app/lib/cashu/protocol-extensions';
/**
 * The cashu-ts `Proof` zod schema — its `.shape.dleq` / `.shape.witness` sub-validators
 * parse the encrypted proof rows' `dleq` / `witness` JSON back to typed cashu-ts values
 * (master `account-repository.decryptCashuProofs`).
 */
export { ProofSchema } from '../../../../apps/web-wallet/app/lib/cashu/types';
