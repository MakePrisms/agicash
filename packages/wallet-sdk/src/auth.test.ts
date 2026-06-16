import { afterEach, describe, expect, it } from 'bun:test';
import { configure, resetConfig } from '@agicash/opensecret';
import { isLoggedIn } from './auth';

// Locks the headless-auth contract added with the opensecret 1.0 bump: the auth
// layer reads its tokens through the configured StorageProvider (not window),
// and requires that provider's getItem to be synchronous.

type TokenData = Record<string, string>;

const makeJwt = (payload: Record<string, unknown>): string => {
  const b64 = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`;
};

const configureWithTokens = (
  tokens: TokenData,
  options?: { asyncStore?: boolean },
) => {
  const noopScope = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };
  configure({
    apiUrl: 'https://opensecret.test',
    clientId: 'test-client',
    storage: {
      persistent: {
        getItem: (key: string) => {
          const value = tokens[key] ?? null;
          return options?.asyncStore ? Promise.resolve(value) : value;
        },
        setItem: (key: string, value: string) => {
          tokens[key] = value;
        },
        removeItem: (key: string) => {
          delete tokens[key];
        },
      },
      session: noopScope,
    },
  });
};

const nowInSeconds = () => Math.floor(Date.now() / 1000);

afterEach(() => {
  resetConfig();
});

describe('isLoggedIn reads through the configured StorageProvider', () => {
  it('is true with an access token and an unexpired refresh token', async () => {
    configureWithTokens({
      access_token: makeJwt({ exp: nowInSeconds() + 3600, aud: 'access' }),
      refresh_token: makeJwt({ exp: nowInSeconds() + 3600, aud: 'refresh' }),
    });
    expect(await isLoggedIn()).toBe(true);
  });

  it('is false when the tokens are absent', async () => {
    configureWithTokens({});
    expect(await isLoggedIn()).toBe(false);
  });

  it('is false when the refresh token has expired', async () => {
    configureWithTokens({
      access_token: makeJwt({ exp: nowInSeconds() + 3600, aud: 'access' }),
      refresh_token: makeJwt({ exp: nowInSeconds() - 10, aud: 'refresh' }),
    });
    expect(await isLoggedIn()).toBe(false);
  });

  it('supports an asynchronous persistent store (headless hosts)', async () => {
    configureWithTokens(
      {
        access_token: makeJwt({ exp: nowInSeconds() + 3600, aud: 'access' }),
        refresh_token: makeJwt({ exp: nowInSeconds() + 3600, aud: 'refresh' }),
      },
      { asyncStore: true },
    );
    expect(await isLoggedIn()).toBe(true);
  });
});
