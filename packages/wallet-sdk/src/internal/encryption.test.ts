import { afterEach, describe, expect, mock, test } from 'bun:test';

// Mock the ECIES primitive so these unit tests exercise the key-caching + (de)serialisation
// logic WITHOUT real crypto: `eciesDecryptBatch` echoes back a UTF-8 encoding of whatever the
// test queued (the base64-`decode` of the input is ignored). The queued plaintexts are the
// JSON strings master's `preprocessData` would have produced.
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
}));

const { createEncryption, getEncryption } = await import('./encryption');

/** A valid base64 ciphertext placeholder — its decoded bytes are ignored by the mock. */
const CT = btoa('placeholder-ciphertext');

afterEach(() => {
  decryptedQueue.length = 0;
});

const key32 = new Uint8Array(32).fill(7);

describe('getEncryption.decryptBatch', () => {
  test('deserialises a number + a string proof field (master amount/secret)', async () => {
    decryptedQueue.push(['42', JSON.stringify('deadbeef')]);
    const enc = getEncryption(key32);

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
    const enc = getEncryption(key32);

    const [date, undef, inf] = await enc.decryptBatch([CT, CT, CT]);

    expect(date).toBeInstanceOf(Date);
    expect((date as Date).toISOString()).toBe('2026-01-02T03:04:05.000Z');
    expect(undef).toBeUndefined();
    expect(inf).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('createEncryption', () => {
  test('fetches the key lazily + only once across calls', async () => {
    let fetches = 0;
    const enc = createEncryption(async () => {
      fetches++;
      return '07'.repeat(32); // hex → 32 bytes of 0x07
    });

    // No fetch until the first decrypt.
    expect(fetches).toBe(0);

    decryptedQueue.push(['1']);
    await enc.decryptBatch([CT]);
    decryptedQueue.push(['2']);
    await enc.decryptBatch([CT]);

    expect(fetches).toBe(1);
  });

  test('concurrent first-callers share a single key fetch', async () => {
    let fetches = 0;
    const enc = createEncryption(async () => {
      fetches++;
      return '07'.repeat(32);
    });

    decryptedQueue.push(['1']);
    decryptedQueue.push(['2']);
    await Promise.all([enc.decryptBatch([CT]), enc.decryptBatch([CT])]);

    expect(fetches).toBe(1);
  });
});
