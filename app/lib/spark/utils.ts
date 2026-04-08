import {
  type BreezSdk,
  defaultExternalSigner,
} from '@breeztech/breez-sdk-spark';
import { bytesToHex } from '@noble/hashes/utils';
import { Money } from '../money';

export function moneyFromSats(sats: bigint | number): Money<'BTC'> {
  return new Money({ amount: Number(sats), currency: 'BTC', unit: 'sat' });
}

/**
 * Gets the Spark identity public key from a mnemonic using the Breez SDK signer.
 * Returns the same key as the old DefaultSparkSigner (Phase C validation C1).
 * Requires WASM to be initialized.
 */
export async function getSparkIdentityPublicKeyFromMnemonic(
  mnemonic: string,
  network: 'mainnet' | 'regtest',
): Promise<string> {
  const signer = defaultExternalSigner(mnemonic, null, network);
  const publicKeyBytes = signer.identityPublicKey();
  return bytesToHex(new Uint8Array(publicKeyBytes as unknown as ArrayBuffer));
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
