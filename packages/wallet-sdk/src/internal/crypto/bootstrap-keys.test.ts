import { afterAll, describe, expect, it, mock } from 'bun:test';

mock.module('@agicash/breez-sdk-spark', () => ({
  default: async () => {},
  connect: async () => ({}),
  defaultConfig: () => ({}),
  initLogging: async () => {},
  defaultExternalSigner: () => ({
    identityPublicKey: () => ({ bytes: new Uint8Array([9, 9, 9]) }),
  }),
}));

// bun's mock.module is process-global; restore after this file so its
// @agicash/breez-sdk-spark mock can't bleed into breez.test.ts (or vice versa).
afterAll(() => mock.restore());

const {
  BASE_CASHU_LOCKING_DERIVATION_PATH,
  deriveCashuLockingXpub,
  deriveEncryptionPublicKey,
  deriveSparkIdentityPublicKey,
} = await import('./bootstrap-keys');
import type { KeyProvider } from './keys';

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

function stubKeys(overrides: Partial<KeyProvider> = {}): KeyProvider {
  return {
    getChildMnemonic: async () => TEST_MNEMONIC,
    getPrivateKeyBytes: async () => new Uint8Array(32),
    getPublicKeyHex: async () => `02${'11'.repeat(32)}`,
    ...overrides,
  };
}

describe('bootstrap-keys', () => {
  it('uses the canonical cashu locking derivation path', () => {
    expect(BASE_CASHU_LOCKING_DERIVATION_PATH).toBe("m/129372'/0'/0'");
  });

  it('derives a deterministic cashu locking xpub from the child mnemonic', async () => {
    const a = await deriveCashuLockingXpub(stubKeys());
    const b = await deriveCashuLockingXpub(stubKeys());
    expect(a).toBe(b);
    expect(a.startsWith('xpub')).toBe(true);
  });

  it('passes the cashu BIP-85 path to the key provider', async () => {
    let seen = '';
    await deriveCashuLockingXpub(
      stubKeys({
        getChildMnemonic: async (p) => {
          seen = p;
          return TEST_MNEMONIC;
        },
      }),
    );
    expect(seen).toBe("m/83696968'/39'/0'/12'/0'");
  });

  it('derives the encryption public key via getPublicKeyHex(schnorr)', async () => {
    let seenPath = '';
    let seenAlgo = '';
    const pub = await deriveEncryptionPublicKey(
      stubKeys({
        getPublicKeyHex: async (path, algo) => {
          seenPath = path;
          seenAlgo = algo;
          return 'ENC_PUB';
        },
      }),
    );
    expect(pub).toBe('ENC_PUB');
    expect(seenPath).toBe("m/10111099'/0'");
    expect(seenAlgo).toBe('schnorr');
  });

  it('derives the spark identity pubkey from the spark BIP-85 child mnemonic', async () => {
    let seen = '';
    const hex = await deriveSparkIdentityPublicKey(
      stubKeys({
        getChildMnemonic: async (p) => {
          seen = p;
          return TEST_MNEMONIC;
        },
      }),
      'mainnet',
    );
    expect(seen).toBe("m/83696968'/39'/0'/12'/1'");
    expect(hex).toBe('090909');
  });
});
