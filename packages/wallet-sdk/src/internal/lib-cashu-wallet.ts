/**
 * SDK-internal cashu **wallet-construction** primitives — Slice 3 (cashu + spark).
 *
 * Building a cashu account's LIVE handle (`ExtendedCashuWallet`) needs a few more
 * cashu symbols than the Slice-2 balance/url helpers (`./lib-cashu`): the extended wallet
 * class itself, its factory, and the extended mint-info wrapper. They now live IN the
 * package at `../lib/cashu/utils.ts` + `protocol-extensions.ts` (relocated out of the web
 * app — framework-free: `@cashu/cashu-ts` only, no react / @tanstack; verified). This seam
 * re-exports them from those modules so SDK consumers import them single-source.
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
} from '../lib/cashu/utils';
export { ExtendedMintInfo } from '../lib/cashu/protocol-extensions';
/**
 * The cashu-ts `Proof` zod schema — its `.shape.dleq` / `.shape.witness` sub-validators
 * parse the encrypted proof rows' `dleq` / `witness` JSON back to typed cashu-ts values
 * (master `account-repository.decryptCashuProofs`).
 */
export { ProofSchema } from '../lib/cashu/types';
