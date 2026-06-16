import { HDKey } from '@scure/bip32';
import type { KeyService } from '../keys';
import { CASHU_SEED_PATH } from '../keys';
import type { OpenSecret } from '../opensecret';

// 129372 is UTF-8 for the peanut emoji (NUT-13). DO NOT CHANGE without migrating
// every user's stored cashu_locking_xpub — it would derive different keys.
export const BASE_CASHU_LOCKING_DERIVATION_PATH = "m/129372'/0'/0'";

export type CashuCryptography = {
  getSeed: () => Promise<Uint8Array>;
  getXpub: (derivationPath?: string) => Promise<string>;
  getPrivateKey: (derivationPath?: string) => Promise<string>;
};

/**
 * Mirrors the app's getCashuCryptography over the SDK's in-memory KeyService and
 * the Open Secret port: getSeed/getXpub are seed-derived (cached by KeyService);
 * getPrivateKey derives a private key (hex) at a path relative to the cashu seed.
 */
export function createCashuCryptography(
  keys: KeyService,
  os: Pick<OpenSecret, 'getPrivateKeyBytes'>,
): CashuCryptography {
  // Memoize derived xpubs per path — the app cached these permanently via React
  // Query (staleTime: Infinity); without this each call re-derives the HD key.
  const xpubCache = new Map<string, Promise<string>>();

  return {
    getSeed: () => keys.getCashuSeed(),
    getXpub: (derivationPath) => {
      const cacheKey = derivationPath ?? '';
      let cached = xpubCache.get(cacheKey);
      if (!cached) {
        cached = keys.getCashuSeed().then((seed) => {
          const hd = HDKey.fromMasterSeed(seed);
          return derivationPath
            ? hd.derive(derivationPath).publicExtendedKey
            : hd.publicExtendedKey;
        });
        xpubCache.set(cacheKey, cached);
      }
      return cached;
    },
    getPrivateKey: async (derivationPath) => {
      const { private_key } = await os.getPrivateKeyBytes({
        seed_phrase_derivation_path: CASHU_SEED_PATH,
        private_key_derivation_path: derivationPath,
      });
      return private_key;
    },
  };
}

/**
 * Derives a public key from an xpub and a derivation path.
 * @param xpub base58-check encoded xpub
 * @param derivationPath path to derive from
 * @returns the derived public key as a hex string ('' if the child key has no pubkey)
 */
export function derivePublicKey(xpub: string, derivationPath: string): string {
  const hdKey = HDKey.fromExtendedKey(xpub);
  const childKey = hdKey.derive(derivationPath);
  return childKey.publicKey
    ? Array.from(childKey.publicKey)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    : '';
}
