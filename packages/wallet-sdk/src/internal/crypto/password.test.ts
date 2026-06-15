import { describe, expect, it } from 'bun:test';
import { generateRandomPassword } from './password';

describe('generateRandomPassword', () => {
  it('returns the default length of 24', () => {
    expect(generateRandomPassword()).toHaveLength(24);
  });

  it('returns the requested length', () => {
    expect(generateRandomPassword(16)).toHaveLength(16);
    expect(generateRandomPassword(32)).toHaveLength(32);
  });

  it('two calls produce different results', () => {
    const a = generateRandomPassword();
    const b = generateRandomPassword();
    expect(a).not.toBe(b);
  });
});
