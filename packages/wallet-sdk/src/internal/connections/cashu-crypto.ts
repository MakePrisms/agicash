import { bytesToHex } from '@noble/hashes/utils';
import { HDKey } from '@scure/bip32';
import { SdkError } from '../../errors';

/** Base derivation path for cashu NUT-20 locking keys (master verbatim). */
export const BASE_CASHU_LOCKING_DERIVATION_PATH = "m/129372'/0'/0'";

/**
 * Cashu key material derived from the user's cashu BIP-39 seed. `getXpub` yields a
 * BIP-32 extended public key (for deriving NUT-20 locking public keys without the
 * private key); `getPrivateKey` yields the hex private key at a path (for unlocking
 * at mint time). The SDK derives both locally (D3) from `getCashuSeed`.
 */
export type CashuCryptography = {
  getSeed: () => Promise<Uint8Array>;
  getXpub: (derivationPath?: string) => Promise<string>;
  getPrivateKey: (derivationPath?: string) => Promise<string>;
};

/** Build a {@link CashuCryptography} over the memoized cashu seed. */
export function getCashuCryptography(
  getCashuSeed: () => Promise<Uint8Array>,
): CashuCryptography {
  const root = async () => HDKey.fromMasterSeed(await getCashuSeed());
  return {
    getSeed: getCashuSeed,
    getXpub: async (derivationPath?: string) => {
      const hd = await root();
      return (derivationPath ? hd.derive(derivationPath) : hd)
        .publicExtendedKey;
    },
    getPrivateKey: async (derivationPath?: string) => {
      const hd = await root();
      const child = derivationPath ? hd.derive(derivationPath) : hd;
      if (!child.privateKey) {
        throw new SdkError(
          `No private key for derivation path ${derivationPath ?? '(root)'}`,
          'no_private_key',
        );
      }
      return bytesToHex(child.privateKey);
    },
  };
}
