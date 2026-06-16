import { describe, expect, test } from 'bun:test';
import { type Token, getDecodedToken, getEncodedToken } from '@cashu/cashu-ts';
import { extractCashuToken } from './token';

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

describe('extractCashuToken', () => {
  test('extracts a valid cashuA token with metadata from content', () => {
    const result = extractCashuToken(`check this out: ${V1_ENCODED_A}`);
    expect(result?.encoded).toBe(V1_ENCODED_A);
    expect(result?.metadata.mint).toBe('https://mint.example.com');
  });

  test('extracts a valid cashuB token from content', () => {
    expect(extractCashuToken(`here: ${V1_ENCODED_B}`)?.encoded).toBe(
      V1_ENCODED_B,
    );
  });

  test('returns null for content with no token', () => {
    expect(extractCashuToken('hello world')).toBeNull();
  });

  test('returns null for malformed token that matches regex but fails metadata parse', () => {
    expect(extractCashuToken('cashuBinvaliddata')).toBeNull();
  });

  test('extracts token from URL with hash', () => {
    expect(extractCashuToken(`#${V1_ENCODED_B}`)?.encoded).toBe(V1_ENCODED_B);
  });
});

// V2 keyset ID tests — verify getDecodedToken resolves v2 keyset IDs correctly.
// We construct tokens with a fake v2 keyset ID (prefix "01", 66 hex chars).
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

describe('getDecodedToken with v2 keyset IDs', () => {
  test('decodes a v2 cashuB token with keyset IDs', () => {
    const token = getDecodedToken(V2_ENCODED_B, [V2_KEYSET_ID]);
    expect(token.proofs[0].id).toBe(V2_KEYSET_ID);
  });

  test('decodes a v2 cashuA token with keyset IDs', () => {
    const token = getDecodedToken(V2_ENCODED_A, [V2_KEYSET_ID]);
    expect(token.mint).toBe('https://v2mint.example.com');
    expect(token.proofs[0].id).toBe(V2_KEYSET_ID);
  });

  test('throws for v2 token with non-matching keyset IDs', () => {
    expect(() => getDecodedToken(V2_ENCODED_A, ['00deadbeefcafe00'])).toThrow();
  });

  test('v2 round-trip: decode → encode (truncates) → decode with keyset IDs', () => {
    const original = getDecodedToken(V2_ENCODED_A, [V2_KEYSET_ID]);

    // Re-encode: getEncodedToken truncates v2 IDs to 16 chars (cashuB format)
    const reEncoded = getEncodedToken(original);

    // Decode the re-encoded token — needs keyset IDs to resolve short IDs
    const roundTripped = getDecodedToken(reEncoded, [V2_KEYSET_ID]);
    expect(roundTripped.mint).toBe(original.mint);
    expect(roundTripped.proofs[0].id).toBe(V2_KEYSET_ID);
    expect(roundTripped.proofs[0].amount).toBe(original.proofs[0].amount);
  });
});
