import { describe, expect, test } from 'bun:test';
import { type Token, getDecodedToken, getEncodedToken } from '@cashu/cashu-ts';
import { extractCashuToken, getTokenHash, tokenToMoney } from './token';

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

const USD_TOKEN: Token = {
  mint: 'https://mint.example.com',
  proofs: [
    {
      id: '009a1f293253e41e',
      amount: 100,
      secret: 'usd-secret-1',
      C: '02698c4e2b5f9534cd0687d87513c759790cf829aa5739184a3e3735471fbda904',
    },
    {
      id: '009a1f293253e41e',
      amount: 50,
      secret: 'usd-secret-2',
      C: '02698c4e2b5f9534cd0687d87513c759790cf829aa5739184a3e3735471fbda905',
    },
  ],
  unit: 'usd',
};

describe('tokenToMoney', () => {
  test('returns BTC Money in sat for a sat token', () => {
    const money = tokenToMoney(V1_TOKEN);
    expect(money.currency).toBe('BTC');
    expect(money.amount('sat').toNumber()).toBe(1);
  });

  test('returns USD Money in cent for a usd token', () => {
    const money = tokenToMoney(USD_TOKEN);
    expect(money.currency).toBe('USD');
    expect(money.amount('cent').toNumber()).toBe(150);
  });

  test('throws for an unrecognised token unit', () => {
    const badToken = { ...V1_TOKEN, unit: 'eur' };
    expect(() => tokenToMoney(badToken as Token)).toThrow(
      'Invalid token unit eur',
    );
  });
});

describe('getTokenHash', () => {
  test('returns a 64-char lowercase hex string for a token string', async () => {
    const hash = await getTokenHash(V1_ENCODED_A);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('same input produces same hash (deterministic)', async () => {
    const hash1 = await getTokenHash(V1_ENCODED_A);
    const hash2 = await getTokenHash(V1_ENCODED_A);
    expect(hash1).toBe(hash2);
  });

  test('accepts a Token object and returns the same hash as the encoded string', async () => {
    // encodeToken uses the cashu-ts default version; match it here
    const encoded = getEncodedToken({
      ...V1_TOKEN,
      proofs: V1_TOKEN.proofs.map((p) => ({ ...p })),
    });
    const hashFromString = await getTokenHash(encoded);
    const hashFromObject = await getTokenHash(V1_TOKEN);
    expect(hashFromObject).toHaveLength(64);
    expect(hashFromObject).toBe(hashFromString);
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
