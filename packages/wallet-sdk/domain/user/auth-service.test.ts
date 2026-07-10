import { describe, expect, it } from 'bun:test';
import { WalletEventEmitter } from '../../lib/events';
import type { AuthKeyValueStore, AuthStorage } from '../../sdk';
import { AuthService, type OpenSecretAuthApi } from './auth-service';
import { createGuestAccountStorage } from './guest-account-storage';

const createMemoryStore = (): AuthKeyValueStore & {
  data: Map<string, string>;
} => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
};

const createStorage = (): AuthStorage & {
  persistent: ReturnType<typeof createMemoryStore>;
} => ({
  persistent: createMemoryStore(),
  session: createMemoryStore(),
});

const toBase64Url = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

const createJwt = (expSecondsFromNow: number, sub = 'user-1') =>
  `${toBase64Url({ alg: 'none' })}.${toBase64Url({
    sub,
    exp: Math.floor(Date.now() / 1000) + expSecondsFromNow,
  })}.sig`;

const fullUser = {
  id: 'user-1',
  name: null,
  email: 'a@b.c',
  email_verified: true,
  login_method: 'email',
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};

const guestUser = { ...fullUser, email: undefined };

const createOsFake = (
  tokenStore: ReturnType<typeof createMemoryStore>,
  overrides: Partial<OpenSecretAuthApi> = {},
) => {
  const calls: string[] = [];
  // The real Open Secret SDK persists fresh tokens on every login path; the
  // fakes mirror that so a timer re-arm after login reads a live refresh token.
  const login = (id: string) => {
    tokenStore.data.set('access_token', createJwt(600, id));
    tokenStore.data.set('refresh_token', createJwt(3600, id));
    return { id, access_token: 'a', refresh_token: 'r' };
  };
  const os: OpenSecretAuthApi = {
    fetchUser: async () => ({ user: fullUser }),
    signIn: async () => login('user-1'),
    signUp: async () => login('user-1'),
    signUpGuest: async () => login('guest-1'),
    signInGuest: async () => login('guest-1'),
    signOut: async () => undefined,
    verifyEmail: async () => undefined,
    requestNewVerificationCode: async () => undefined,
    convertGuestToUserAccount: async () => undefined,
    initiateGoogleAuth: async () => ({
      auth_url: 'https://accounts.google/x',
      csrf_token: 'c',
    }),
    handleGoogleCallback: async () => login('user-1'),
    ...overrides,
  };
  // wrap every fn to record invocation order
  for (const key of Object.keys(os) as (keyof OpenSecretAuthApi)[]) {
    const original = os[key] as (...args: unknown[]) => unknown;
    // biome-ignore lint/suspicious/noExplicitAny: test instrumentation
    (os as any)[key] = (...args: unknown[]) => {
      calls.push(key);
      return original(...args);
    };
  }
  return { os, calls };
};

const createService = (
  options: {
    os?: Partial<OpenSecretAuthApi>;
    storage?: ReturnType<typeof createStorage>;
    onSessionEnded?: () => void;
  } = {},
) => {
  const storage = options.storage ?? createStorage();
  const { os, calls } = createOsFake(storage.persistent, options.os);
  const events = new WalletEventEmitter();
  const service = new AuthService({
    os,
    storage,
    guestAccountStorage: createGuestAccountStorage(storage.persistent),
    generateGuestPassword: async () => 'generated-pw',
    events,
    onSessionEnded: options.onSessionEnded,
  });
  return { service, storage, calls, events };
};

describe('AuthService', () => {
  it('starts anonymous', () => {
    const { service } = createService();
    expect(service.getSession()).toEqual({ isLoggedIn: false });
  });

  describe('restoreSession', () => {
    it('stays anonymous without stored tokens and does not call fetchUser', async () => {
      const { service, calls } = createService();
      await service.restoreSession();
      expect(service.getSession().isLoggedIn).toBe(false);
      expect(calls).not.toContain('fetchUser');
    });

    it('restores a session from stored tokens', async () => {
      const { service, storage } = createService();
      storage.persistent.data.set('access_token', createJwt(600));
      storage.persistent.data.set('refresh_token', createJwt(3600));

      await service.restoreSession();

      expect(service.getSession()).toEqual({
        isLoggedIn: true,
        user: fullUser,
      });
      service.teardown();
    });

    it('rejects when tokens exist but the user fetch fails, then recovers on retry', async () => {
      let sessionEnded = false;
      let failFetch = true;
      const { service, storage } = createService({
        os: {
          fetchUser: async () => {
            if (failFetch) {
              throw new Error('network');
            }
            return { user: fullUser };
          },
        },
        onSessionEnded: () => {
          sessionEnded = true;
        },
      });
      storage.persistent.data.set('access_token', createJwt(600));
      storage.persistent.data.set('refresh_token', createJwt(3600));

      await expect(service.restoreSession()).rejects.toThrow('network');
      // per-session caches were torn down with the failed restore
      expect(sessionEnded).toBe(true);
      expect(service.getSession().isLoggedIn).toBe(false);

      // the rejection is not memoized — a retry can succeed
      failFetch = false;
      await service.restoreSession();

      expect(service.getSession().isLoggedIn).toBe(true);
      service.teardown();
    });

    it('stays anonymous when the stored refresh token is undecodable', async () => {
      const { service, storage, calls } = createService();
      storage.persistent.data.set('access_token', createJwt(600));
      storage.persistent.data.set('refresh_token', 'not-a-jwt');

      await service.restoreSession();

      expect(service.getSession().isLoggedIn).toBe(false);
      expect(calls).not.toContain('fetchUser');
    });

    it('does not clobber a session a verb established while the restore fetch was in flight', async () => {
      let releaseRestoreFetch = (): void => undefined;
      const restoreFetchGate = new Promise<void>((resolve) => {
        releaseRestoreFetch = resolve;
      });
      const verbUser = { ...fullUser, id: 'user-verb' };
      let fetchCalls = 0;
      const { service, storage } = createService({
        os: {
          fetchUser: async () => {
            fetchCalls += 1;
            if (fetchCalls === 1) {
              await restoreFetchGate;
              return { user: fullUser };
            }
            return { user: verbUser };
          },
        },
      });
      storage.persistent.data.set('access_token', createJwt(600));
      storage.persistent.data.set('refresh_token', createJwt(3600));

      const restore = service.restoreSession();
      // Flush microtasks so the restore's gated fetchUser is in flight first.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await service.signIn('verb@b.c', 'pw');
      releaseRestoreFetch();
      await restore;

      expect(service.getSession()).toEqual({
        isLoggedIn: true,
        user: verbUser,
      });
      service.teardown();
    });

    it('is single-flight', async () => {
      const { service, storage, calls } = createService();
      storage.persistent.data.set('access_token', createJwt(600));
      storage.persistent.data.set('refresh_token', createJwt(3600));

      await Promise.all([service.restoreSession(), service.restoreSession()]);

      expect(calls.filter((c) => c === 'fetchUser')).toHaveLength(1);
      service.teardown();
    });
  });

  describe('signUpGuest', () => {
    it('creates a new guest account and stores the credentials', async () => {
      const { service, storage, calls } = createService({
        os: { fetchUser: async () => ({ user: guestUser }) },
      });

      await service.signUpGuest();

      expect(calls).toContain('signUpGuest');
      expect(
        JSON.parse(storage.persistent.data.get('guestAccount') ?? ''),
      ).toEqual({
        id: 'guest-1',
        password: 'generated-pw',
      });
      expect(service.getSession().isLoggedIn).toBe(true);
      service.teardown();
    });

    it('re-signs-in the stored guest account instead of creating a new one', async () => {
      const { service, storage, calls } = createService({
        os: { fetchUser: async () => ({ user: guestUser }) },
      });
      storage.persistent.data.set(
        'guestAccount',
        JSON.stringify({ id: 'guest-1', password: 'stored-pw' }),
      );

      await service.signUpGuest();

      expect(calls).toContain('signInGuest');
      expect(calls).not.toContain('signUpGuest');
      service.teardown();
    });
  });

  describe('signOut', () => {
    it('clears the session, keeps guest credentials, and runs onSessionEnded', async () => {
      let sessionEnded = false;
      const { service, storage } = createService({
        onSessionEnded: () => {
          sessionEnded = true;
        },
      });
      storage.persistent.data.set('access_token', createJwt(600));
      storage.persistent.data.set('refresh_token', createJwt(3600));
      storage.persistent.data.set(
        'guestAccount',
        JSON.stringify({ id: 'guest-1', password: 'pw' }),
      );
      await service.restoreSession();

      await service.signOut();

      expect(service.getSession().isLoggedIn).toBe(false);
      expect(sessionEnded).toBe(true);
      expect(storage.persistent.data.has('guestAccount')).toBe(true);
    });

    it('wipes per-session caches again when a different user signs in after sign-out', async () => {
      let sessionEndedCount = 0;
      const userIds = ['user-a', 'user-b'];
      let fetchCalls = 0;
      const { service } = createService({
        os: {
          fetchUser: async () => ({
            user: { ...fullUser, id: userIds[Math.min(fetchCalls++, 1)] },
          }),
        },
        onSessionEnded: () => {
          sessionEndedCount += 1;
        },
      });

      await service.signIn('a@b.c', 'pw');
      await service.signOut(); // ends user-a's session → 1
      await service.signIn('b@b.c', 'pw'); // different user → wiped again → 2

      expect(sessionEndedCount).toBe(2);
      service.teardown();
    });
  });

  describe('convertGuestToFullAccount', () => {
    it('clears the stored guest credentials', async () => {
      const { service, storage } = createService();
      storage.persistent.data.set(
        'guestAccount',
        JSON.stringify({ id: 'guest-1', password: 'pw' }),
      );
      storage.persistent.data.set('refresh_token', createJwt(3600));

      await service.convertGuestToFullAccount('a@b.c', 'pw2');

      expect(storage.persistent.data.has('guestAccount')).toBe(false);
      service.teardown();
    });
  });

  describe('session expiry', () => {
    it('emits auth.session-expired and ends the session for a full account', async () => {
      let sessionEnded = false;
      const { service, storage, events } = createService({
        onSessionEnded: () => {
          sessionEnded = true;
        },
      });
      // refresh token expiring "now" (exp-5s already past) → timer fires immediately
      storage.persistent.data.set('access_token', createJwt(600));
      storage.persistent.data.set('refresh_token', createJwt(4));
      const expired: unknown[] = [];
      events.on('auth.session-expired', (payload) => expired.push(payload));

      await service.restoreSession();
      // the 1ms-floored timer fires on the next macrotask
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(expired).toHaveLength(1);
      expect(service.getSession().isLoggedIn).toBe(false);
      expect(sessionEnded).toBe(true);
    });

    it('auto-extends a guest session instead of expiring it', async () => {
      const { service, storage, calls, events } = createService({
        os: { fetchUser: async () => ({ user: guestUser }) },
      });
      storage.persistent.data.set(
        'guestAccount',
        JSON.stringify({ id: 'guest-1', password: 'pw' }),
      );
      storage.persistent.data.set('access_token', createJwt(600));
      storage.persistent.data.set('refresh_token', createJwt(4));
      const expired: unknown[] = [];
      events.on('auth.session-expired', (payload) => expired.push(payload));
      const refreshed: unknown[] = [];
      events.on('auth.session-refreshed', (payload) => refreshed.push(payload));

      await service.restoreSession();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(calls).toContain('signInGuest');
      expect(expired).toHaveLength(0);
      // the host is told about the refresh it didn't initiate
      expect(refreshed).toHaveLength(1);
      expect(service.getSession().isLoggedIn).toBe(true);
      service.teardown();
    });

    it('re-arms instead of expiring when the stored refresh token was rotated forward', async () => {
      const { service, storage, events } = createService();
      storage.persistent.data.set('access_token', createJwt(600));
      // (exp - 5s) is ~100ms away, so the timer fires shortly after restore
      storage.persistent.data.set('refresh_token', createJwt(5.1));
      const expired: unknown[] = [];
      events.on('auth.session-expired', (payload) => expired.push(payload));

      await service.restoreSession();
      // the Open Secret SDK rotates the refresh token during its internal
      // refresh flow; simulate a rotation landing before the timer fires
      storage.persistent.data.set('refresh_token', createJwt(3600));
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(expired).toHaveLength(0);
      expect(service.getSession().isLoggedIn).toBe(true);
      service.teardown();
    });

    it('ends the session when the extension cannot restore the guest user', async () => {
      let fetchCalls = 0;
      const { service, storage, events } = createService({
        os: {
          fetchUser: async () => {
            fetchCalls += 1;
            // restore succeeds; the post-extend fetch fails
            if (fetchCalls > 1) {
              throw new Error('network');
            }
            return { user: guestUser };
          },
        },
      });
      storage.persistent.data.set(
        'guestAccount',
        JSON.stringify({ id: 'guest-1', password: 'pw' }),
      );
      storage.persistent.data.set('access_token', createJwt(600));
      storage.persistent.data.set('refresh_token', createJwt(4));
      const expired: unknown[] = [];
      events.on('auth.session-expired', (payload) => expired.push(payload));

      await service.restoreSession();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // no wedged half-session: the death path ran and told the host
      expect(expired).toHaveLength(1);
      expect(service.getSession().isLoggedIn).toBe(false);
    });
  });

  it('initiateGoogleAuth returns the raw auth url', async () => {
    const { service } = createService();
    expect(await service.initiateGoogleAuth()).toEqual({
      authUrl: 'https://accounts.google/x',
    });
  });

  it('completeGoogleAuth establishes the session', async () => {
    const { service, calls } = createService();

    await service.completeGoogleAuth({ code: 'auth-code', state: 'state' });

    expect(calls).toContain('handleGoogleCallback');
    expect(service.getSession()).toEqual({ isLoggedIn: true, user: fullUser });
    service.teardown();
  });
});
