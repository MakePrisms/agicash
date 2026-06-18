import { afterEach, describe, expect, it } from 'bun:test';
import { generateRandomPassword } from './password';

afterEach(() => {
  (globalThis as { getMockPassword?: unknown }).getMockPassword = undefined;
});

describe('generateRandomPassword', () => {
  it('generates a password of the requested length', async () => {
    expect(await generateRandomPassword(32)).toHaveLength(32);
  });

  it('restricts the charset to the selected sets', async () => {
    const password = await generateRandomPassword(64, { numbers: true });
    expect(password).toMatch(/^[0-9]+$/);
  });

  it('throws when no character set is selected', async () => {
    await expect(generateRandomPassword(10, {})).rejects.toThrow();
  });

  it('uses the e2e getMockPassword seam when present', async () => {
    (
      globalThis as { getMockPassword?: () => Promise<string | null> }
    ).getMockPassword = () => Promise.resolve('mocked-password');
    expect(await generateRandomPassword(32)).toBe('mocked-password');
  });
});
