/**
 * SDK-internal account-cryptography helper — Slice 3 (cashu + spark).
 *
 * `getSeedPhraseDerivationPath` builds the BIP-85 derivation path the enclave uses to derive
 * a per-account-type child mnemonic (cashu / spark). It is a pure, dependency-free string
 * helper in `app/features/accounts/account-cryptography.ts`; per the build plan (`lib/*` /
 * the small shared crypto helpers are SDK-internal) we re-export the single live source via a
 * relative path — same pattern as `./lib-cashu` / `types/money.ts` — so the derivation paths
 * stay in lockstep with the app and there is no duplication. The canonical relocation INTO
 * the package is a deferred follow-up.
 *
 * @module
 */

export { getSeedPhraseDerivationPath } from '../../../../apps/web-wallet/app/features/accounts/account-cryptography';
