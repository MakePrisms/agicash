import { afterEach, describe, expect, mock, test } from 'bun:test';

// Mock the ECIES primitives so these unit tests exercise the key-caching + (de)serialisation
// logic WITHOUT real crypto:
//  - `eciesDecryptBatch` echoes back a UTF-8 encoding of whatever the test queued (the base64-
//    `decode` of the input is ignored). The queued plaintexts are the JSON strings master's
//    `preprocessData` would have produced.
//  - `eciesDecrypt` (single) shifts one queued plaintext.
//  - `eciesEncrypt` / `eciesEncryptBatch` echo the UTF-8 plaintext bytes straight back (so an
//    encrypt → `decode(encode(x))` round-trip recovers the serialised JSON the encrypt path
//    produced — letting the encrypt half be asserted against its own serialisation).
const decryptedQueue: string[][] = [];
mock.module('./lib-ecies', () => ({
  eciesDecryptBatch: (data: Uint8Array[]) => {
    const next = decryptedQueue.shift();
    if (!next) {
      throw new Error('no queued decrypt result');
    }
    const enc = new TextEncoder();
    return data.map((_, i) => enc.encode(next[i]));
  },
  eciesDecrypt: (_data: Uint8Array) => {
    const next = decryptedQueue.shift();
    if (!next) {
      throw new Error('no queued decrypt result');
    }
    return new TextEncoder().encode(next[0]);
  },
  eciesEncrypt: (data: Uint8Array) => data,
  eciesEncryptBatch: (data: Uint8Array[]) => data,
}));

const { createEncryption, getEncryption } = await import('./encryption');

/** A valid base64 ciphertext placeholder — its decoded bytes are ignored by the decrypt mock. */
const CT = btoa('placeholder-ciphertext');
/** Decode an encrypt-mock result (base64 of the serialised plaintext bytes) back to a string. */
const decodeEncrypted = (b64: string) => new TextDecoder().decode(decode(b64));
const { decode } = await import('@stablelib/base64');

afterEach(() => {
  decryptedQueue.length = 0;
});

const key32 = new Uint8Array(32).fill(7);
const pubHex = '02'.repeat(33);

describe('getEncryption.decryptBatch', () => {
  test('deserialises a number + a string proof field (master amount/secret)', async () => {
    decryptedQueue.push(['42', JSON.stringify('deadbeef')]);
    const enc = getEncryption(key32, pubHex);

    const [amount, secret] = await enc.decryptBatch([CT, CT]);

    expect(amount).toBe(42);
    expect(secret).toBe('deadbeef');
  });

  test('rehydrates type-tagged Date / undefined / non-finite number', async () => {
    decryptedQueue.push([
      JSON.stringify({ __type: 'Date', value: '2026-01-02T03:04:05.000Z' }),
      JSON.stringify({ __type: 'undefined' }),
      JSON.stringify({ __type: 'number', value: 'Infinity' }),
    ]);
    const enc = getEncryption(key32, pubHex);

    const [date, undef, inf] = await enc.decryptBatch([CT, CT, CT]);

    expect(date).toBeInstanceOf(Date);
    expect((date as Date).toISOString()).toBe('2026-01-02T03:04:05.000Z');
    expect(undef).toBeUndefined();
    expect(inf).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('getEncryption.encrypt (serialisation)', () => {
  test('encrypt serialises an object to type-preserving JSON', async () => {
    const enc = getEncryption(key32, pubHex);

    const encrypted = await enc.encrypt({ a: 1, b: 'x' });

    // The encrypt mock echoes the serialised bytes; recover them and assert master's shape.
    expect(JSON.parse(decodeEncrypted(encrypted))).toEqual({ a: 1, b: 'x' });
  });

  test('encryptBatch preserves order + tags non-finite numbers', async () => {
    const enc = getEncryption(key32, pubHex);

    const [first, second] = await enc.encryptBatch([
      Number.POSITIVE_INFINITY,
      'second',
    ]);

    expect(JSON.parse(decodeEncrypted(first))).toEqual({
      __type: 'number',
      value: 'Infinity',
    });
    expect(JSON.parse(decodeEncrypted(second))).toBe('second');
  });

  test('encrypt → decrypt round-trips a string field', async () => {
    const enc = getEncryption(key32, pubHex);

    const encrypted = await enc.encrypt('roundtrip');
    // Feed the serialised plaintext (what the encrypt mock produced) into the decrypt queue.
    decryptedQueue.push([decodeEncrypted(encrypted)]);
    const decrypted = await enc.decrypt(CT);

    expect(decrypted).toBe('roundtrip');
  });
});

describe('createEncryption', () => {
  test('fetches the keys lazily + only once across calls', async () => {
    let privFetches = 0;
    let pubFetches = 0;
    const enc = createEncryption(
      async () => {
        privFetches++;
        return '07'.repeat(32); // hex → 32 bytes of 0x07
      },
      async () => {
        pubFetches++;
        return pubHex;
      },
    );

    // No fetch until the first decrypt.
    expect(privFetches).toBe(0);
    expect(pubFetches).toBe(0);

    decryptedQueue.push(['1']);
    await enc.decryptBatch([CT]);
    decryptedQueue.push(['2']);
    await enc.decryptBatch([CT]);

    expect(privFetches).toBe(1);
    expect(pubFetches).toBe(1);
  });

  test('concurrent first-callers share a single key fetch', async () => {
    let privFetches = 0;
    const enc = createEncryption(
      async () => {
        privFetches++;
        return '07'.repeat(32);
      },
      async () => pubHex,
    );

    decryptedQueue.push(['1']);
    decryptedQueue.push(['2']);
    await Promise.all([enc.decryptBatch([CT]), enc.decryptBatch([CT])]);

    expect(privFetches).toBe(1);
  });
});
