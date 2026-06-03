import { describe, expect, test } from 'bun:test';
import { computeSHA256, generateRandomPassword } from './crypto';

describe('generateRandomPassword', () => {
  test('returns a string of the requested length', () => {
    expect(generateRandomPassword(32)).toHaveLength(32);
    expect(generateRandomPassword(20)).toHaveLength(20);
  });

  test('defaults to length 24', () => {
    expect(generateRandomPassword()).toHaveLength(24);
  });

  test('produces a different value each call (random)', () => {
    const a = generateRandomPassword(32);
    const b = generateRandomPassword(32);
    expect(a).not.toBe(b);
  });

  test('only uses the allowed character set', () => {
    const allowed = /^[a-zA-Z0-9!@#$%^&*()_+~]+$/;
    expect(generateRandomPassword(200)).toMatch(allowed);
  });
});

describe('computeSHA256', () => {
  test('returns the known SHA-256 hex digest of "abc"', async () => {
    // canonical SHA-256("abc")
    expect(await computeSHA256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  test('returns the digest of the empty string', async () => {
    expect(await computeSHA256('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  test('is a 64-char lowercase hex string', async () => {
    const digest = await computeSHA256('hello world');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
