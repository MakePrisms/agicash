/**
 * SDK-internal ECIES primitives — Slice 3 (cashu + spark).
 *
 * A cashu account's stored `proofs` are ENCRYPTED on the DB row (`amount` + `secret`
 * ciphertext); decrypting them needs the same ECIES (`secp256k1` + ChaCha20-Poly1305 +
 * HKDF) implementation master uses in `app/features/shared/encryption.ts`. That impl now
 * lives IN the package at `../lib/ecies` (relocated — leaf + framework-free, `@noble/*`
 * only, no react / @tanstack / `window`; verified). This seam re-exports it as the single
 * source every SDK consumer imports from.
 *
 * The proof-DECRYPT path (PR5a) needs `eciesDecryptBatch`; the send/receive services this
 * slice (PR5b) adds WRITE encrypted rows, so they also need the ENCRYPT primitives
 * (`eciesEncrypt` single + `eciesEncryptBatch`). All three are re-exported single-source.
 *
 * @module
 */

export {
  eciesDecrypt,
  eciesDecryptBatch,
  eciesEncrypt,
  eciesEncryptBatch,
} from '../lib/ecies/ecies';
