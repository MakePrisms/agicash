import { describe, expect, test } from 'bun:test';
import { type Token, getEncodedToken } from '@cashu/cashu-ts';
import { extractCashuToken, extractCashuTokenString } from './token';

// A real v1 cashuA token (v1 keyset ID starts with "00")
const V1_TOKEN: Token = {
  mint: 'https://mint.example.com',
  proofs: [
    {
      id: '009a1f293253e41e',
      amount: 1,
      secret: 'test-secret-1',
      C: '02698c4e2b5f9534cd0687d87513c759790cf829aa5739184a3e3735471fbda904',
    },
  ],
  unit: 'sat',
};

const V1_ENCODED_A = getEncodedToken(V1_TOKEN, { version: 3 });
const V1_ENCODED_B = getEncodedToken(V1_TOKEN, { version: 4 });

describe('extractCashuTokenString', () => {
  test('extracts a valid cashuA token string from content', () => {
    const result = extractCashuTokenString(`check this out: ${V1_ENCODED_A}`);
    expect(result).toBe(V1_ENCODED_A);
  });

  test('extracts a valid cashuB token string from content', () => {
    const result = extractCashuTokenString(`here: ${V1_ENCODED_B}`);
    expect(result).toBe(V1_ENCODED_B);
  });

  test('returns null for content with no token', () => {
    expect(extractCashuTokenString('hello world')).toBeNull();
  });

  test('returns null for malformed token that matches regex but fails metadata parse', () => {
    expect(extractCashuTokenString('cashuBinvaliddata')).toBeNull();
  });

  test('extracts token from URL with hash', () => {
    const result = extractCashuTokenString(`#${V1_ENCODED_B}`);
    expect(result).toBe(V1_ENCODED_B);
  });
});

// V2 keyset ID tests — exercise the fetcher fallback path.
// We construct tokens with a fake v2 keyset ID (prefix "01", 66 hex chars).
// getDecodedToken(token) will fail for these, triggering the fetcher.
const V2_KEYSET_ID = `01${'a'.repeat(64)}`; // 66 chars, v2 format

const V2_TOKEN: Token = {
  mint: 'https://v2mint.example.com',
  proofs: [
    {
      id: V2_KEYSET_ID,
      amount: 1,
      secret: 'test-secret-v2',
      C: '02698c4e2b5f9534cd0687d87513c759790cf829aa5739184a3e3735471fbda904',
    },
  ],
  unit: 'sat',
};

// cashuA preserves full keyset IDs in the JSON
const V2_ENCODED_A = getEncodedToken(V2_TOKEN, { version: 3 });
// cashuB truncates v2 keyset IDs to 16 chars (short ID)
const V2_ENCODED_B = getEncodedToken(V2_TOKEN, { version: 4 });

describe('extractCashuToken', () => {
  test('decodes a v1 token without fetching', async () => {
    const fetcher = async (_mintUrl: string) => {
      throw new Error('should not be called for v1');
    };
    const token = await extractCashuToken(V1_ENCODED_A, fetcher);
    expect(token).not.toBeNull();
    expect(token?.mint).toBe('https://mint.example.com');
    expect(token?.proofs[0].id).toBe('009a1f293253e41e');
  });

  test('decodes a v1 cashuB token without fetching', async () => {
    const fetcher = async (_mintUrl: string) => {
      throw new Error('should not be called for v1');
    };
    const token = await extractCashuToken(V1_ENCODED_B, fetcher);
    expect(token).not.toBeNull();
    expect(token?.mint).toBe('https://mint.example.com');
  });

  test('returns null for invalid content', async () => {
    const fetcher = async (_mintUrl: string) => [];
    const token = await extractCashuToken('not a token', fetcher);
    expect(token).toBeNull();
  });

  test('decodes a v2 token by fetching keyset IDs', async () => {
    const fetcher = async (mintUrl: string) => {
      expect(mintUrl).toBe('https://v2mint.example.com');
      return [V2_KEYSET_ID];
    };
    const token = await extractCashuToken(V2_ENCODED_B, fetcher);
    expect(token).not.toBeNull();
    expect(token?.proofs[0].id).toBe(V2_KEYSET_ID);
  });

  test('decodes v2 cashuA token with fetcher providing full keyset ID', async () => {
    const fetcher = async (mintUrl: string) => {
      expect(mintUrl).toBe('https://v2mint.example.com');
      return [V2_KEYSET_ID];
    };
    const token = await extractCashuToken(V2_ENCODED_A, fetcher);
    expect(token).not.toBeNull();
    expect(token?.mint).toBe('https://v2mint.example.com');
    expect(token?.proofs[0].id).toBe(V2_KEYSET_ID);
  });

  test('returns null for v2 token when fetcher returns no matching keysets', async () => {
    const fetcher = async (_mintUrl: string) => ['00deadbeefcafe00'];
    const token = await extractCashuToken(V2_ENCODED_A, fetcher);
    expect(token).toBeNull();
  });
});

describe('extractCashuToken v2 round-trip', () => {
  test('decode v2 → encode (truncates) → decode with fetcher → same token', async () => {
    const fetcher = async (_mintUrl: string) => [V2_KEYSET_ID];
    const original = await extractCashuToken(V2_ENCODED_A, fetcher);
    expect(original).not.toBeNull();

    // Re-encode: getEncodedToken truncates v2 IDs to 16 chars (cashuB format)
    // biome-ignore lint/style/noNonNullAssertion: guarded by toBeNull above
    const reEncoded = getEncodedToken(original!);

    // Decode the re-encoded token — needs fetcher to resolve short IDs
    const roundTripped = await extractCashuToken(reEncoded, fetcher);
    expect(roundTripped).not.toBeNull();
    expect(roundTripped?.mint).toBe(original?.mint);
    expect(roundTripped?.proofs[0].id).toBe(V2_KEYSET_ID);
    expect(roundTripped?.proofs[0].amount).toBe(original?.proofs[0].amount);
  });
});
