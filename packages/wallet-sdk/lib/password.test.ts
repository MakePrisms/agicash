import { describe, expect, it } from 'bun:test';
import { generateRandomPassword } from './password';

describe('generateRandomPassword', () => {
  it('generates the requested length', () => {
    const password = generateRandomPassword(32);
    expect(password).toHaveLength(32);
  });

  it('throws when no character set is selected', () => {
    expect(() =>
      generateRandomPassword(16, {
        letters: false,
        numbers: false,
        special: false,
      }),
    ).toThrow();
  });

  it('uses only letters when letters is the sole enabled set', () => {
    const password = generateRandomPassword(128, {
      letters: true,
      numbers: false,
      special: false,
    });
    expect(password).toMatch(/^[a-zA-Z]+$/);
  });

  it('uses only digits when numbers is the sole enabled set', () => {
    const password = generateRandomPassword(128, {
      letters: false,
      numbers: true,
      special: false,
    });
    expect(password).toMatch(/^[0-9]+$/);
  });

  it('uses only special characters when special is the sole enabled set', () => {
    const password = generateRandomPassword(128, {
      letters: false,
      numbers: false,
      special: true,
    });
    expect(password).toMatch(/^[!@#$%^&*()_+~]+$/);
  });

  it('mixes letters and digits when both are enabled', () => {
    const password = generateRandomPassword(128, {
      letters: true,
      numbers: true,
      special: false,
    });
    expect(password).toMatch(/^[a-zA-Z0-9]+$/);
  });
});
