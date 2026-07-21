import { describe, expect, it } from 'bun:test';
import { BASE_CASHU_LOCKING_DERIVATION_PATH } from '../../lib/cashu';
import { deriveCashuXpub } from '../../lib/cryptography';
import { DisposedError, SessionEndedError } from '../../lib/error';
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

  it('rejects an in-flight derivation whose session ended, and serves the next session fresh', async () => {
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

    // The caller that started under session a must not receive a's key once a
    // has ended — it rejects rather than resolving the stale value...
    await expect(inFlight).rejects.toBeInstanceOf(SessionEndedError);
    // ...and the stale resolution did not populate the cache, so the next read
    // derives session b fresh.
    expect(await keys.getSparkMnemonic()).toBe('mnemonic b');
  });

  it('rejects getEncryption when the session ends between its two derivations', async () => {
    let releasePublicKey: (value: string) => void = () => undefined;
    const publicKeyGate = new Promise<string>((resolve) => {
      releasePublicKey = resolve;
    });
    const keys = createSessionKeys({
      readEncryptionPrivateKey: async () => new Uint8Array(32).fill(7),
      readEncryptionPublicKey: () => publicKeyGate,
    });

    const pending = keys.getEncryption();
    keys.reset();
    releasePublicKey('public-key-a');

    // A reset between the private- and public-key derivations would otherwise
    // pair session a's private key with a later session's public key; the
    // composite rejects instead of returning a mismatched pair.
    await expect(pending).rejects.toBeInstanceOf(SessionEndedError);
  });

  it('rejects every getter terminally after dispose, so a retained handle cannot serve a disposed instance', async () => {
    const keys = createSessionKeys({
      readCashuSeed: async () => seedA,
      readSparkMnemonic: async () => 'mnemonic a',
    });
    // Warm a memo: a plain reset would let this cached value keep resolving.
    expect(await keys.getCashuSeed()).toBe(seedA);

    keys.dispose();

    await expect(keys.getCashuSeed()).rejects.toBeInstanceOf(DisposedError);
    await expect(keys.getSparkMnemonic()).rejects.toBeInstanceOf(DisposedError);
    await expect(keys.getEncryption()).rejects.toBeInstanceOf(DisposedError);
  });

  it('rejects a derivation in flight when dispose lands', async () => {
    let releaseSeed: (value: Uint8Array) => void = () => undefined;
    const gate = new Promise<Uint8Array>((resolve) => {
      releaseSeed = resolve;
    });
    const keys = createSessionKeys({ readCashuSeed: () => gate });

    const inFlight = keys.getCashuSeed();
    keys.dispose();
    releaseSeed(seedA);

    await expect(inFlight).rejects.toBeInstanceOf(DisposedError);
  });

  it('exposes a session signal that aborts on reset and on dispose', () => {
    const keys = createSessionKeys();

    const firstSession = keys.sessionSignal();
    expect(firstSession.aborted).toBe(false);

    keys.reset();
    expect(firstSession.aborted).toBe(true);

    const secondSession = keys.sessionSignal();
    expect(secondSession.aborted).toBe(false);

    keys.dispose();
    expect(secondSession.aborted).toBe(true);
  });

  it('rejects a getter reentered from a synchronous abort listener during reset', async () => {
    const keys = createSessionKeys({ readCashuSeed: async () => seedA });
    expect(await keys.getCashuSeed()).toBe(seedA);

    let reentered: Promise<Uint8Array> | undefined;
    keys.sessionSignal().addEventListener('abort', () => {
      // reset() aborts the signal before it clears the memos; a getter reached
      // from this synchronous listener must not hand back the ended session's
      // cached key.
      reentered = keys.getCashuSeed();
    });

    keys.reset();

    expect(reentered).toBeDefined();
    await expect(reentered).rejects.toBeInstanceOf(SessionEndedError);
  });

  it('revokes a retained encryption handle once its session is disposed', async () => {
    const privateKey = new Uint8Array(32);
    privateKey[31] = 1;
    const publicKey =
      '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
    const keys = createSessionKeys({
      readEncryptionPrivateKey: async () => privateKey,
      readEncryptionPublicKey: async () => publicKey,
    });
    const encryption = await keys.getEncryption();
    // Works while the session is live.
    const ciphertext = await encryption.encrypt({ owner: 'a' });
    expect(await encryption.decrypt<{ owner: string }>(ciphertext)).toEqual({
      owner: 'a',
    });

    keys.dispose();

    // A handle retained across dispose can't keep operating on the dead
    // session's keys.
    await expect(encryption.encrypt({ owner: 'a' })).rejects.toBeInstanceOf(
      DisposedError,
    );
    await expect(encryption.decrypt(ciphertext)).rejects.toBeInstanceOf(
      DisposedError,
    );
  });
});
