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
  return {
    getSeed: () => keys.getCashuSeed(),
    getXpub: async (derivationPath) => {
      const hd = HDKey.fromMasterSeed(await keys.getCashuSeed());
      return derivationPath
        ? hd.derive(derivationPath).publicExtendedKey
        : hd.publicExtendedKey;
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
