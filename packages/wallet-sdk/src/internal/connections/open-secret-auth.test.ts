import { describe, expect, it } from 'bun:test';
import type { SdkConfig } from '../../config';
import { getCurrentUserId } from './open-secret';

function fakeStorage(tokens: Record<string, string>): SdkConfig['storage'] {
  const kv = {
    getItem: (k: string) => tokens[k] ?? null,
    setItem: () => {},
    removeItem: () => {},
  };
  return { persistent: kv, session: kv } as unknown as SdkConfig['storage'];
}
function jwtWithSub(sub: string): string {
  return `h.${btoa(JSON.stringify({ sub })).replace(/=/g, '')}.s`;
}

describe('getCurrentUserId', () => {
  it('decodes the sub claim from the access token', async () => {
    const storage = fakeStorage({ access_token: jwtWithSub('user-123') });
    expect(await getCurrentUserId(storage)).toBe('user-123');
  });
  it('returns null when no access token is present', async () => {
    expect(await getCurrentUserId(fakeStorage({}))).toBeNull();
  });
  it('returns null for a malformed token', async () => {
    const storage = fakeStorage({ access_token: 'not-a-jwt' });
    expect(await getCurrentUserId(storage)).toBeNull();
  });
});
