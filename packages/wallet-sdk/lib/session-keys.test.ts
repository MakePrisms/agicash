import { describe, expect, it } from 'bun:test';
import { BASE_CASHU_LOCKING_DERIVATION_PATH } from './cashu';
import { deriveCashuXpub } from './cryptography';
import { createSessionKeys } from './session-keys';

const seedA = new Uint8Array(64).fill(1);
const seedB = new Uint8Array(64).fill(2);

describe('createSessionKeys', () => {
  it('memoizes each derivation within a session (the reader runs once)', async () => {
    let calls = 0;
    const keys = createSessionKeys({
      readCashuSeed: async () => {
        calls += 1;
        return seedA;
      },
    });

    await Promise.all([
      keys.getCashuSeed(),
      keys.getCashuSeed(),
      keys.getCashuSeed(),
    ]);
    await keys.getCashuSeed();

    expect(calls).toBe(1);
  });

  it('serves the next session fresh keys after reset (a different user never gets the first user keys)', async () => {
    let session: 'a' | 'b' = 'a';
    const keys = createSessionKeys({
      readEncryptionPublicKey: async () =>
        session === 'a' ? 'pub-a' : 'pub-b',
      readCashuSeed: async () => (session === 'a' ? seedA : seedB),
      readSparkMnemonic: async () =>
        session === 'a' ? 'mnemonic a' : 'mnemonic b',
    });

    expect(await keys.getEncryptionPublicKey()).toBe('pub-a');
    expect(await keys.getCashuSeed()).toBe(seedA);
    expect(await keys.getSparkMnemonic()).toBe('mnemonic a');
    expect(await keys.getCashuLockingXpub()).toBe(
      deriveCashuXpub(seedA, BASE_CASHU_LOCKING_DERIVATION_PATH),
    );

    session = 'b';
    keys.reset();

    expect(await keys.getEncryptionPublicKey()).toBe('pub-b');
    expect(await keys.getCashuSeed()).toBe(seedB);
    expect(await keys.getSparkMnemonic()).toBe('mnemonic b');
    expect(await keys.getCashuLockingXpub()).toBe(
      deriveCashuXpub(seedB, BASE_CASHU_LOCKING_DERIVATION_PATH),
    );
  });

  it('does not let a derivation in flight at reset populate the next session', async () => {
    let session: 'a' | 'b' = 'a';
    let releaseA: (value: string) => void = () => undefined;
    const gate = new Promise<string>((resolve) => {
      releaseA = resolve;
    });
    const keys = createSessionKeys({
      readSparkMnemonic: () =>
        session === 'a' ? gate : Promise.resolve('mnemonic b'),
    });

    const inFlight = keys.getSparkMnemonic();
    session = 'b';
    keys.reset();
    releaseA('mnemonic a');

    // The caller that started the fetch under session a still resolves to its
    // own session's value...
    expect(await inFlight).toBe('mnemonic a');
    // ...but that stale resolution must not have populated the cache, so the
    // next read derives session b fresh.
    expect(await keys.getSparkMnemonic()).toBe('mnemonic b');
  });
});
