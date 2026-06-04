/**
 * @agicash/wallet-sdk/lib — framework-free wallet-domain protocol libs.
 *
 * These are leaf utilities (no react / @tanstack / `window`; only external crypto +
 * codec deps) that the SDK relocated out of the web app so the SDK is standalone and
 * the web app imports them FROM the SDK rather than the reverse.
 *
 * - `bolt11` — BOLT11 invoice decode / parse + payee-pubkey recovery.
 * - `ecies` — ECIES (secp256k1 + ChaCha20-Poly1305 + HKDF) encrypt / decrypt.
 *
 * Importable as the `@agicash/wallet-sdk/lib` subpath or via the top-level barrel.
 *
 * @module
 */

export { type DecodedBolt11, decodeBolt11, parseBolt11Invoice } from './bolt11';
export {
  eciesDecrypt,
  eciesDecryptBatch,
  eciesEncrypt,
  eciesEncryptBatch,
} from './ecies';
