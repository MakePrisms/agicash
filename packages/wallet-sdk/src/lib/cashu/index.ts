/**
 * @agicash/wallet-sdk/lib/cashu — framework-free cashu-protocol helpers.
 *
 * The pure cashu-protocol domain logic the SDK consumes (proofs, tokens, secrets,
 * mint URL/unit helpers, the extended wallet/mint-info wrappers, mint-feature
 * validation, DLEQ blind-signature matching, payment-request + error codes). These
 * are leaf utilities — only `@cashu/cashu-ts`, `@agicash/lib`, `@noble/*`,
 * `type-fest` and `zod/mini`; NO react / @tanstack / `window` — relocated out of the
 * web app so the SDK is standalone and the web app imports them FROM the SDK.
 *
 * The web-only React/stateful cashu layer (the mint/melt subscription managers and
 * the animated-QR components) stays in `apps/web-wallet/app/lib/cashu` and is
 * re-exported alongside these via the web `~/lib/cashu` shim.
 *
 * @module
 */

export * from './proof';
export * from './secret';
export * from './token';
export * from './utils';
export * from './error-codes';
export * from './payment-request';
export * from './mint-validation';
export * from './blind-signature-matching';
export {
  type AgicashMintExtension,
  type ExtendedMintQuoteBolt11Response,
  ExtendedMintInfo,
  type MintPurpose,
} from './protocol-extensions';
export {
  CASHU_PROTOCOL_UNITS,
  type CashuProtocolUnit,
  type NUT,
  type NUT17WebSocketCommand,
  ProofSchema,
} from './types';
