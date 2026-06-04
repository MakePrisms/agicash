/**
 * SDK-internal cashu locking-key crypto — Slice 3 / PR5b.
 *
 * The cashu RECEIVE quote flow locks the mint quote with a NUT-20 public key derived from the
 * user's cashu locking xPub (`shared/cashu.ts#BASE_CASHU_LOCKING_DERIVATION_PATH` +
 * `shared/cryptography.ts#derivePublicKey`). Master's `shared/cryptography.ts` imports `react`
 * at module level (`useMemo` for the `useCryptography` hook), so it CANNOT be re-exported
 * single-source without pulling react. `derivePublicKey` itself is a tiny pure `@scure/bip32`
 * HDKey derivation — re-housed VERBATIM here (the canonical relocation, when `shared/*` moves
 * into the package, will collapse this back).
 *
 * @module
 */
import { HDKey } from '@scure/bip32';

/**
 * The base cashu locking derivation path (`shared/cashu.ts`, verbatim). 129372 is UTF-8 for 🥜
 * (NUT-13); coin-type 0, account 0. DO NOT CHANGE without migrating users' stored xPub — it
 * would derive the wrong keys when getting private keys.
 */
export const BASE_CASHU_LOCKING_DERIVATION_PATH = "m/129372'/0'/0'";

/**
 * Derive a public key (hex) from an xPub + a derivation path. Re-housed VERBATIM from
 * `shared/cryptography.ts#derivePublicKey`.
 *
 * @param xpub - the base58-check extended public key.
 * @param derivationPath - the child path to derive.
 * @returns the derived compressed public key as a hex string (empty if derivation fails).
 */
export const derivePublicKey = (
  xpub: string,
  derivationPath: string,
): string => {
  const hdKey = HDKey.fromExtendedKey(xpub);
  const childKey = hdKey.derive(derivationPath);
  return childKey.publicKey
    ? Array.from(childKey.publicKey)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    : '';
};
