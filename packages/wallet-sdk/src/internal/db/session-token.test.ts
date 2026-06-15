import { describe, expect, mock, test } from 'bun:test';
import sign from 'jwt-encode';
import { SessionTokenProvider } from './session-token';

const jwtWithExp = (secsFromNow: number) =>
  sign({ exp: Math.floor(Date.now() / 1000) + secsFromNow }, 'test');

describe('SessionTokenProvider', () => {
  test('returns null when not logged in (no network call)', async () => {
    const generateThirdPartyToken = mock(async () => ({ token: 'x' }));
    const p = new SessionTokenProvider(
      { generateThirdPartyToken } as unknown as Pick<
        import('../opensecret').OpenSecret,
        'generateThirdPartyToken'
      >,
      async () => false,
    );
    expect(await p.getToken()).toBeNull();
    expect(generateThirdPartyToken).not.toHaveBeenCalled();
  });

  test('fetches once and caches until near expiry', async () => {
    const token = jwtWithExp(3600);
    const generateThirdPartyToken = mock(async () => ({ token }));
    const p = new SessionTokenProvider(
      { generateThirdPartyToken } as unknown as Pick<
        import('../opensecret').OpenSecret,
        'generateThirdPartyToken'
      >,
      async () => true,
    );
    expect(await p.getToken()).toBe(token);
    expect(await p.getToken()).toBe(token);
    expect(generateThirdPartyToken).toHaveBeenCalledTimes(1);
  });

  test('refetches when cached token is within 5s of expiry', async () => {
    const generateThirdPartyToken = mock(async () => ({
      token: jwtWithExp(3),
    }));
    const p = new SessionTokenProvider(
      { generateThirdPartyToken } as unknown as Pick<
        import('../opensecret').OpenSecret,
        'generateThirdPartyToken'
      >,
      async () => true,
    );
    await p.getToken();
    await p.getToken();
    expect(generateThirdPartyToken).toHaveBeenCalledTimes(2);
  });

  test('clear() forces a refetch', async () => {
    const generateThirdPartyToken = mock(async () => ({
      token: jwtWithExp(3600),
    }));
    const p = new SessionTokenProvider(
      { generateThirdPartyToken } as unknown as Pick<
        import('../opensecret').OpenSecret,
        'generateThirdPartyToken'
      >,
      async () => true,
    );
    await p.getToken();
    p.clear();
    await p.getToken();
    expect(generateThirdPartyToken).toHaveBeenCalledTimes(2);
  });
});
