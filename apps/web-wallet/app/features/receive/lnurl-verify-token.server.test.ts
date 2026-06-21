import { describe, expect, it } from 'bun:test';
import { createLnurlVerifyTokenCodec } from './lnurl-verify-token.server';

// 32-byte symmetric key (64 hex chars) — xchacha20poly1305 requires exactly 32 bytes.
const KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

describe('lnurl verify-token codec', () => {
  it('round-trips a spark ref', () => {
    const codec = createLnurlVerifyTokenCodec(KEY);
    const ref = { type: 'spark', quoteId: 'rr-1' } as const;
    expect(codec.decode(codec.encode(ref))).toEqual(ref);
  });

  it('round-trips a cashu ref (with mintUrl)', () => {
    const codec = createLnurlVerifyTokenCodec(KEY);
    const ref = {
      type: 'cashu',
      quoteId: 'mq-1',
      mintUrl: 'https://mint.test',
    } as const;
    expect(codec.decode(codec.encode(ref))).toEqual(ref);
  });

  it('produces a URL-safe base64url token', () => {
    const codec = createLnurlVerifyTokenCodec(KEY);
    expect(codec.encode({ type: 'spark', quoteId: 'rr-1' })).toMatch(
      /^[A-Za-z0-9_=-]+$/,
    );
  });

  it('throws decoding with the wrong key', () => {
    const a = createLnurlVerifyTokenCodec(KEY);
    const b = createLnurlVerifyTokenCodec(
      'ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100',
    );
    const token = a.encode({ type: 'spark', quoteId: 'rr-1' });
    expect(() => b.decode(token)).toThrow();
  });

  it('throws decoding a malformed token', () => {
    const codec = createLnurlVerifyTokenCodec(KEY);
    expect(() => codec.decode('not-a-valid-token')).toThrow();
  });
});
