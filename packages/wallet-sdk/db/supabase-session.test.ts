import { describe, expect, it } from 'bun:test';
import { createSupabaseSessionTokenGetter } from './supabase-session';

const toBase64Url = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

const createToken = (expSecondsFromNow: number) =>
  `${toBase64Url({ alg: 'none' })}.${toBase64Url({
    exp: Math.floor(Date.now() / 1000) + expSecondsFromNow,
  })}.sig`;

describe('createSupabaseSessionTokenGetter', () => {
  it('returns null and skips token generation when logged out', async () => {
    let generated = 0;
    const { getToken } = createSupabaseSessionTokenGetter({
      isLoggedIn: () => false,
      generateToken: async () => {
        generated += 1;
        return { token: createToken(3600) };
      },
    });

    expect(await getToken()).toBeNull();
    expect(generated).toBe(0);
  });

  it('memoizes the token until close to expiry', async () => {
    let generated = 0;
    const { getToken } = createSupabaseSessionTokenGetter({
      isLoggedIn: () => true,
      generateToken: async () => {
        generated += 1;
        return { token: createToken(3600) };
      },
    });

    const first = await getToken();
    const second = await getToken();

    expect(first).toBe(second as string);
    expect(generated).toBe(1);
  });

  it('re-generates once the cached token is within 5s of expiry', async () => {
    let generated = 0;
    const { getToken } = createSupabaseSessionTokenGetter({
      isLoggedIn: () => true,
      generateToken: async () => {
        generated += 1;
        // expires in 3s → refreshAt is already in the past
        return { token: createToken(3) };
      },
    });

    await getToken();
    await getToken();

    expect(generated).toBe(2);
  });

  it('shares one in-flight request between concurrent callers', async () => {
    let generated = 0;
    const { getToken } = createSupabaseSessionTokenGetter({
      isLoggedIn: () => true,
      generateToken: async () => {
        generated += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { token: createToken(3600) };
      },
    });

    await Promise.all([getToken(), getToken(), getToken()]);

    expect(generated).toBe(1);
  });

  it('drops the cache when the session ends', async () => {
    let loggedIn = true;
    let generated = 0;
    const { getToken } = createSupabaseSessionTokenGetter({
      isLoggedIn: () => loggedIn,
      generateToken: async () => {
        generated += 1;
        return { token: createToken(3600) };
      },
    });

    await getToken();
    loggedIn = false;
    expect(await getToken()).toBeNull();
    loggedIn = true;
    await getToken();

    expect(generated).toBe(2);
  });

  it('reset drops the cached token so the next session cannot reuse it', async () => {
    let generated = 0;
    const source = createSupabaseSessionTokenGetter({
      isLoggedIn: () => true,
      generateToken: async () => {
        generated += 1;
        return { token: createToken(3600) };
      },
    });

    await source.getToken();
    source.reset();
    await source.getToken();

    expect(generated).toBe(2);
  });

  it('does not cache a token that resolves after reset', async () => {
    let generated = 0;
    let release: (() => void) | undefined;
    const source = createSupabaseSessionTokenGetter({
      isLoggedIn: () => true,
      generateToken: async () => {
        generated += 1;
        if (generated === 1) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return { token: createToken(3600) };
      },
    });

    const firstCall = source.getToken();
    // session ends while the first exchange is still in flight
    source.reset();
    release?.();
    await firstCall;

    await source.getToken();

    // the stale in-flight token was not cached; the new session exchanged fresh
    expect(generated).toBe(2);
  });
});
