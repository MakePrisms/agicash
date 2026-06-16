import type { Network } from '@agicash/breez-sdk-spark';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { getSparkIdentityPublicKey } from '../connections/breez';
import {
  CASHU_MNEMONIC_PATH,
  ENCRYPTION_KEY_PATH,
  type KeyProvider,
  SPARK_MNEMONIC_PATH,
} from './keys';

/** BIP-32 path the cashu locking xpub is derived at (NUT-13: 129372 = 🥜). */
export const BASE_CASHU_LOCKING_DERIVATION_PATH = "m/129372'/0'/0'";

/**
 * The extended public key the mint uses to lock cashu quotes to this user.
 * Derived from the cashu BIP-85 child mnemonic → seed → BIP-32 xpub.
 */
export async function deriveCashuLockingXpub(
  keys: KeyProvider,
): Promise<string> {
  const mnemonic = await keys.getChildMnemonic(CASHU_MNEMONIC_PATH);
  const seed = mnemonicToSeedSync(mnemonic);
  const node = HDKey.fromMasterSeed(seed).derive(
    BASE_CASHU_LOCKING_DERIVATION_PATH,
  );
  return node.publicExtendedKey;
}

/** The schnorr public key used to encrypt the user's data at rest. */
export async function deriveEncryptionPublicKey(
  keys: KeyProvider,
): Promise<string> {
  return keys.getPublicKeyHex(ENCRYPTION_KEY_PATH, 'schnorr');
}

/** The Spark identity public key, derived from the spark BIP-85 child mnemonic. */
export async function deriveSparkIdentityPublicKey(
  keys: KeyProvider,
  network: Network,
): Promise<string> {
  const mnemonic = await keys.getChildMnemonic(SPARK_MNEMONIC_PATH);
  return getSparkIdentityPublicKey(mnemonic, network);
}
