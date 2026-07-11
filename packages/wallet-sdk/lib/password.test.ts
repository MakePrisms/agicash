import { describe, expect, it } from 'bun:test';
import { generateRandomPassword } from './password';

describe('generateRandomPassword', () => {
  it('generates the requested length', async () => {
    const password = await generateRandomPassword(32);
    expect(password).toHaveLength(32);
  });
});
