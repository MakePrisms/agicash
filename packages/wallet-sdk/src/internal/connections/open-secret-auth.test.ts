import { describe, expect, it } from 'bun:test';
import { inMemoryStorage, jwtWith } from '../test-support';
import { getCurrentUserId } from './open-secret';

describe('getCurrentUserId', () => {
  it('decodes the sub claim from the access token', async () => {
    const storage = inMemoryStorage({
      access_token: jwtWith({ sub: 'user-123' }),
    });
    expect(await getCurrentUserId(storage)).toBe('user-123');
  });
  it('returns null when no access token is present', async () => {
    expect(await getCurrentUserId(inMemoryStorage({}))).toBeNull();
  });
  it('returns null for a malformed token', async () => {
    const storage = inMemoryStorage({ access_token: 'not-a-jwt' });
    expect(await getCurrentUserId(storage)).toBeNull();
  });
  it('returns null for a valid JWT with no sub claim', async () => {
    const storage = inMemoryStorage({ access_token: jwtWith({}) });
    expect(await getCurrentUserId(storage)).toBeNull();
  });
});
