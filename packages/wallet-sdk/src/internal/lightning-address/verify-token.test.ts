import { describe, expect, test } from 'bun:test';
import { decodeVerifyToken, encodeVerifyToken } from './verify-token';

const key = new Uint8Array(32).fill(7);

describe('verify-token codec', () => {
  test('round-trips a cashu payload', () => {
    const payload = {
      type: 'cashu' as const,
      quoteId: 'quote-123',
      mintUrl: 'https://mint.example.com',
    };
    const token = encodeVerifyToken(payload, key);
    expect(typeof token).toBe('string');
    expect(decodeVerifyToken(token, key)).toEqual(payload);
  });

  test('round-trips a spark payload', () => {
    const payload = { type: 'spark' as const, quoteId: 'spark-req-456' };
    const token = encodeVerifyToken(payload, key);
    expect(decodeVerifyToken(token, key)).toEqual(payload);
  });

  test('rejects a token decrypted with the wrong key', () => {
    const token = encodeVerifyToken({ type: 'spark', quoteId: 'x' }, key);
    const wrongKey = new Uint8Array(32).fill(9);
    expect(() => decodeVerifyToken(token, wrongKey)).toThrow();
  });

  test('rejects a garbage / tampered token', () => {
    expect(() => decodeVerifyToken('not-a-valid-token', key)).toThrow();
  });
});
