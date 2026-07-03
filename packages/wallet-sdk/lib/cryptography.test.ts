import { describe, expect, test } from 'bun:test';
import { hexToBytes } from '@noble/hashes/utils';
import { deriveCashuXpub } from './cryptography';

// BIP-32 test vector 1 (seed 000102030405060708090a0b0c0d0e0f).
const SEED = hexToBytes('000102030405060708090a0b0c0d0e0f');
const MASTER_XPUB =
  'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8';

describe('deriveCashuXpub', () => {
  test('returns the master xpub when no derivation path is given', () => {
    expect(deriveCashuXpub(SEED)).toBe(MASTER_XPUB);
  });

  test('derives a distinct child xpub for a derivation path', () => {
    const child = deriveCashuXpub(SEED, "m/0'");
    expect(child).toMatch(/^xpub/);
    expect(child).not.toBe(MASTER_XPUB);
  });
});
