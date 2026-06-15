import { bytesToHex } from '@noble/hashes/utils';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { describe, expect, mock, test } from 'bun:test';
import type { OpenSecret } from './opensecret';
import { KeyService } from './keys';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const fakeOs = () =>
  ({
    getPrivateKey: mock(async () => ({ mnemonic: MNEMONIC })),
    getPrivateKeyBytes: mock(async () => ({ private_key: '00'.repeat(32) })),
    getPublicKey: mock(async () => ({ public_key: 'deadbeef' })),
  }) as unknown as Pick<
    OpenSecret,
    'getPrivateKey' | 'getPrivateKeyBytes' | 'getPublicKey'
  > & {
    getPrivateKey: ReturnType<typeof mock>;
    getPrivateKeyBytes: ReturnType<typeof mock>;
  };

describe('KeyService', () => {
  test('cashu seed = mnemonicToSeedSync of the OS mnemonic', async () => {
    const keys = new KeyService(fakeOs());
    expect(bytesToHex(await keys.getCashuSeed())).toBe(
      bytesToHex(mnemonicToSeedSync(MNEMONIC)),
    );
  });

  test('cashu locking xpub matches HDKey derivation', async () => {
    const keys = new KeyService(fakeOs());
    const expected = HDKey.fromMasterSeed(mnemonicToSeedSync(MNEMONIC)).derive(
      "m/129372'/0'/0'",
    ).publicExtendedKey;
    expect(await keys.getCashuLockingXpub()).toBe(expected);
  });

  test('encryption private key = hexToBytes of OS bytes', async () => {
    const keys = new KeyService(fakeOs());
    const pk = await keys.getEncryptionPrivateKey();
    expect(bytesToHex(pk)).toBe('00'.repeat(32));
  });

  test('derivations are cached (one OS call for cashu seed)', async () => {
    const os = fakeOs();
    const keys = new KeyService(os);
    await keys.getCashuSeed();
    await keys.getCashuSeed();
    expect(os.getPrivateKey).toHaveBeenCalledTimes(1);
  });

  test('clear() drops cached material (next read re-derives)', async () => {
    const os = fakeOs();
    const keys = new KeyService(os);
    await keys.getEncryptionPrivateKey();
    keys.clear();
    await keys.getEncryptionPrivateKey();
    expect(os.getPrivateKeyBytes).toHaveBeenCalledTimes(2);
  });

  test('spark identity public key derives via Breez signer (Node build, headless)', async () => {
    const keys = new KeyService(fakeOs());
    const pub = await keys.getSparkIdentityPublicKey('MAINNET');
    expect(pub).toMatch(/^[0-9a-f]{66}$/); // 33-byte compressed pubkey hex
  });

  test('spark identity is cached per network (mainnet != regtest)', async () => {
    const keys = new KeyService(fakeOs());
    const mainnet = await keys.getSparkIdentityPublicKey('MAINNET');
    const regtest = await keys.getSparkIdentityPublicKey('REGTEST');
    // a mnemonic derives a different identity key per network
    expect(mainnet).not.toBe(regtest);
    // each network returns its own cached value on repeat
    expect(await keys.getSparkIdentityPublicKey('MAINNET')).toBe(mainnet);
    expect(await keys.getSparkIdentityPublicKey('REGTEST')).toBe(regtest);
  });
});
