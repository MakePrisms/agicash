import { type BreezSdk, defaultExternalSigner } from '@agicash/breez-sdk-spark';
import { bytesToHex } from '@noble/hashes/utils';

/**
 * Gets the Spark identity public key from a mnemonic using the Breez SDK signer.
 * @param mnemonic - BIP39 mnemonic phrase.
 * @param network - The Breez SDK network ('mainnet' or 'regtest').
 * @returns Hex-encoded compressed public key.
 */
export function getSparkIdentityPublicKeyFromMnemonic(
  mnemonic: string,
  network: 'mainnet' | 'regtest',
): string {
  const signer = defaultExternalSigner(mnemonic, null, network);
  const publicKey = signer.identityPublicKey();
  return bytesToHex(new Uint8Array(publicKey.bytes));
}

export function createSparkWalletStub(reason: string): BreezSdk {
  return new Proxy({} as BreezSdk, {
    get(_target, prop) {
      if (typeof prop === 'string') {
        return () => {
          console.error(`Cannot call ${prop} on Spark wallet stub`);
          throw new Error(reason);
        };
      }
      return undefined;
    },
  });
}
