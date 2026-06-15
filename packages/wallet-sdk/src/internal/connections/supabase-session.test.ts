import { describe, expect, it, jest } from 'bun:test';
import { SupabaseSessionTokenProvider } from './supabase-session';

/** Build a minimal JWT with the given exp (epoch seconds). Format: h.<base64-payload>.s */
function jwtWithExp(expSeconds: number): string {
  return `h.${btoa(JSON.stringify({ exp: expSeconds }))}.s`;
}

const nowSec = () => Math.floor(Date.now() / 1000);

describe('SupabaseSessionTokenProvider', () => {
  it('returns null when isLoggedIn resolves false', async () => {
    const generateToken = jest.fn(async () => jwtWithExp(nowSec() + 3600));
    const isLoggedIn = jest.fn(async () => false);
    const provider = new SupabaseSessionTokenProvider(
      generateToken,
      isLoggedIn,
    );

    const result = await provider.getToken();

    expect(result).toBeNull();
    expect(generateToken).not.toHaveBeenCalled();
  });

  it('fetches and returns a token when logged in', async () => {
    const token = jwtWithExp(nowSec() + 3600);
    const generateToken = jest.fn(async () => token);
    const isLoggedIn = jest.fn(async () => true);
    const provider = new SupabaseSessionTokenProvider(
      generateToken,
      isLoggedIn,
    );

    const result = await provider.getToken();

    expect(result).toBe(token);
    expect(generateToken).toHaveBeenCalledTimes(1);
  });

  it('re-uses the cached token on a second call (generateToken called once)', async () => {
    const token = jwtWithExp(nowSec() + 3600);
    const generateToken = jest.fn(async () => token);
    const isLoggedIn = jest.fn(async () => true);
    const provider = new SupabaseSessionTokenProvider(
      generateToken,
      isLoggedIn,
    );

    const first = await provider.getToken();
    const second = await provider.getToken();

    expect(first).toBe(token);
    expect(second).toBe(token);
    expect(generateToken).toHaveBeenCalledTimes(1);
  });

  it('re-fetches when the cached token is near expiry', async () => {
    // Token expires in 3 seconds — within the 5s staleness window
    const nearExpToken = jwtWithExp(nowSec() + 3);
    const freshToken = jwtWithExp(nowSec() + 3600);
    let callCount = 0;
    const generateToken = jest.fn(async () => {
      callCount++;
      return callCount === 1 ? nearExpToken : freshToken;
    });
    const isLoggedIn = jest.fn(async () => true);
    const provider = new SupabaseSessionTokenProvider(
      generateToken,
      isLoggedIn,
    );

    const first = await provider.getToken();
    expect(first).toBe(nearExpToken);
    expect(generateToken).toHaveBeenCalledTimes(1);

    // Second call: token is near expiry, should re-fetch
    const second = await provider.getToken();
    expect(second).toBe(freshToken);
    expect(generateToken).toHaveBeenCalledTimes(2);
  });
});
