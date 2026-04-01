import { afterEach, describe, expect, test } from 'bun:test';
import { detectMode } from './mode';

describe('detectMode', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore original env after each test
    process.env.OPENSECRET_CLIENT_ID = undefined;
    process.env.AGICASH_MNEMONIC = undefined;
    Object.assign(process.env, originalEnv);
  });

  test('returns opensecret when OPENSECRET_CLIENT_ID is set', () => {
    process.env.OPENSECRET_CLIENT_ID = 'test-client-id';
    process.env.AGICASH_MNEMONIC = undefined;
    expect(detectMode()).toBe('opensecret');
  });

  test('returns local when AGICASH_MNEMONIC is set', () => {
    process.env.OPENSECRET_CLIENT_ID = undefined;
    process.env.AGICASH_MNEMONIC =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    expect(detectMode()).toBe('local');
  });

  test('throws when both are set', () => {
    process.env.OPENSECRET_CLIENT_ID = 'test-client-id';
    process.env.AGICASH_MNEMONIC =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    expect(() => detectMode()).toThrow(
      'Ambiguous config: set OPENSECRET_CLIENT_ID or AGICASH_MNEMONIC, not both',
    );
  });

  test('throws when neither is set', () => {
    process.env.OPENSECRET_CLIENT_ID = undefined;
    process.env.AGICASH_MNEMONIC = undefined;
    expect(() => detectMode()).toThrow(
      'No wallet configured. Set OPENSECRET_CLIENT_ID (cloud) or AGICASH_MNEMONIC (local) in .env',
    );
  });
});
