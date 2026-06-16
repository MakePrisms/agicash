import { defaultExternalSigner } from '@agicash/breez-sdk-spark';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import type { OpenSecret } from './opensecret';

export const CASHU_SEED_PATH = "m/83696968'/39'/0'/12'/0'";
const SPARK_MNEMONIC_PATH = "m/83696968'/39'/0'/12'/1'";
const ENCRYPTION_KEY_PATH = "m/10111099'/0'";
// 129372 = UTF-8 for the peanut emoji (NUT-13). DO NOT CHANGE without migrating
// every user's stored cashu_locking_xpub — it would derive different keys.
const CASHU_LOCKING_PATH = "m/129372'/0'/0'";

type Os = Pick<
  OpenSecret,
  'getPrivateKey' | 'getPrivateKeyBytes' | 'getPublicKey'
>;
type SparkNetwork = 'MAINNET' | 'REGTEST';

/** Derives and caches the user's key material in memory. Never persists it.
 * `clear()` (called by Sdk.dispose / signOut) drops every reference. */
export class KeyService {
  private cashuSeed?: Promise<Uint8Array>;
  private sparkMnemonic?: Promise<string>;
  private encryptionPrivateKey?: Promise<Uint8Array>;
  private encryptionPublicKey?: Promise<string>;
  private cashuLockingXpub?: Promise<string>;
  // Keyed by network: a mnemonic derives a DIFFERENT spark identity per network,
  // so a single cache slot would return the wrong key for a second network.
  private readonly sparkIdentityPublicKey = new Map<
    SparkNetwork,
    Promise<string>
  >();

  constructor(private readonly os: Os) {}

  getCashuSeed(): Promise<Uint8Array> {
    this.cashuSeed ??= this.os
      .getPrivateKey({ seed_phrase_derivation_path: CASHU_SEED_PATH })
      .then((r) => mnemonicToSeedSync(r.mnemonic));
    return this.cashuSeed;
  }

  getSparkMnemonic(): Promise<string> {
    this.sparkMnemonic ??= this.os
      .getPrivateKey({ seed_phrase_derivation_path: SPARK_MNEMONIC_PATH })
      .then((r) => r.mnemonic);
    return this.sparkMnemonic;
  }

  getEncryptionPrivateKey(): Promise<Uint8Array> {
    this.encryptionPrivateKey ??= this.os
      .getPrivateKeyBytes({ private_key_derivation_path: ENCRYPTION_KEY_PATH })
      .then((r) => hexToBytes(r.private_key));
    return this.encryptionPrivateKey;
  }

  getEncryptionPublicKey(): Promise<string> {
    this.encryptionPublicKey ??= this.os
      .getPublicKey('schnorr', {
        private_key_derivation_path: ENCRYPTION_KEY_PATH,
      })
      .then((r) => r.public_key);
    return this.encryptionPublicKey;
  }

  getCashuLockingXpub(): Promise<string> {
    this.cashuLockingXpub ??= this.getCashuSeed().then(
      (seed) =>
        HDKey.fromMasterSeed(seed).derive(CASHU_LOCKING_PATH).publicExtendedKey,
    );
    return this.cashuLockingXpub;
  }

  getSparkIdentityPublicKey(network: SparkNetwork): Promise<string> {
    let cached = this.sparkIdentityPublicKey.get(network);
    if (!cached) {
      cached = this.getSparkMnemonic().then((mnemonic) => {
        const signer = defaultExternalSigner(
          mnemonic,
          null,
          network.toLowerCase() as 'mainnet' | 'regtest',
        );
        return bytesToHex(new Uint8Array(signer.identityPublicKey().bytes));
      });
      this.sparkIdentityPublicKey.set(network, cached);
    }
    return cached;
  }

  clear(): void {
    this.cashuSeed = undefined;
    this.sparkMnemonic = undefined;
    this.encryptionPrivateKey = undefined;
    this.encryptionPublicKey = undefined;
    this.cashuLockingXpub = undefined;
    this.sparkIdentityPublicKey.clear();
  }
}
