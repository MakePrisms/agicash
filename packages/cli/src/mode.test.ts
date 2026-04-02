import { afterEach, describe, expect, test } from 'bun:test';
import { detectMode } from './mode';

describe('detectMode', () => {
  const originalEnv = { ...process.env };
  const managedKeys = [
    'OPENSECRET_CLIENT_ID',
    'AGICASH_MNEMONIC',
    'AGICASH_RELEASE_OPENSECRET_CLIENT_ID',
  ] as const;

  afterEach(() => {
    for (const key of managedKeys) {
      delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  test('returns opensecret when OPENSECRET_CLIENT_ID is set', () => {
    process.env.OPENSECRET_CLIENT_ID = 'test-client-id';
    expect(detectMode()).toBe('opensecret');
  });

  test('returns opensecret when release defaults provide OPENSECRET_CLIENT_ID', () => {
    process.env.AGICASH_RELEASE_OPENSECRET_CLIENT_ID = 'release-client-id';
    expect(detectMode()).toBe('opensecret');
  });

  test('throws when AGICASH_MNEMONIC is set', () => {
    process.env.AGICASH_MNEMONIC =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    expect(() => detectMode()).toThrow(
      'Local mnemonic mode is not supported in v0.0.1. Use agicash auth login or agicash auth guest.',
    );
  });

  test('throws when OpenSecret is not configured', () => {
    expect(() => detectMode()).toThrow(
      'OpenSecret is not configured. Set OPENSECRET_CLIENT_ID in ~/.agicash/.env, ./.env, or the shell environment.',
    );
  });
});
