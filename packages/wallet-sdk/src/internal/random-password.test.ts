import { describe, expect, test } from 'bun:test';
import { generateRandomPassword } from './random-password';

describe('generateRandomPassword', () => {
  test('respects length', () => {
    expect(generateRandomPassword(32).length).toBe(32);
  });
  test('throws when no charset selected', () => {
    expect(() => generateRandomPassword(8, {})).toThrow();
  });
  test('produces different values across calls', () => {
    expect(generateRandomPassword(32)).not.toBe(generateRandomPassword(32));
  });
});
