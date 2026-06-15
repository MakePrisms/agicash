import { describe, expect, it } from 'bun:test';
import { sha256Hex } from './sha256';

describe('sha256Hex', () => {
  it('matches the known SHA-256 vector for "abc"', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('returns lowercase hex', async () => {
    const result = await sha256Hex('test');
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  it('returns a 64-character string', async () => {
    const result = await sha256Hex('hello world');
    expect(result).toHaveLength(64);
  });
});
