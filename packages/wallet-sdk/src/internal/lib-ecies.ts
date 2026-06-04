/**
 * SDK-internal ECIES primitives — Slice 3 (cashu + spark).
 *
 * A cashu account's stored `proofs` are ENCRYPTED on the DB row (`amount` + `secret`
 * ciphertext); decrypting them needs the same ECIES (`secp256k1` + ChaCha20-Poly1305 +
 * HKDF) implementation master uses in `app/features/shared/encryption.ts`, which lives in
 * `app/lib/ecies`. It is leaf + framework-free (`@noble/*` only — no react / @tanstack /
 * `window`; verified), so per the build plan (`lib/*` SDK-internal) we re-export the single
 * live source via a relative path — exactly as `./lib-cashu` / `types/money.ts` do — so
 * there is ONE implementation and no web churn. The canonical relocation of `app/lib/ecies`
 * INTO the package is a deferred follow-up (out of the build-plan's scope).
 *
 * Only the BATCH decrypt is re-exported: that is the single primitive `./encryption`'s
 * `decryptBatch` (the proof-decrypt path) needs. The other ECIES functions
 * (encrypt/decrypt single, encrypt batch) are not used by Slice 3 and are pulled in by
 * later slices that write encrypted rows.
 *
 * @module
 */

export { eciesDecryptBatch } from '../../../../apps/web-wallet/app/lib/ecies/ecies';
