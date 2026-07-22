import { describe, expect, it } from 'bun:test';
import { DisposedError, InstanceAlreadyUsedError } from '../../lib/error';
import { nullLogger } from '../../lib/logger';
import type { AuthKeyValueStore, AuthStorage } from '../sdk';
import { WalletEventEmitter } from '../sdk/events';
import { AuthService, type OpenSecretAuthApi } from './auth-service';

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
    // The real SDK swallows the network logout failure and clears its token
    // keys unconditionally.
    signOut: async () => {
      tokenStore.data.delete('access_token');
      tokenStore.data.delete('refresh_token');
    },
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
    // Wires requestDispose to teardown so sign-out is terminal, mirroring how
    // AgicashSdk wires it to full instance disposal.
    disposeOnRequest?: boolean;
  } = {},
) => {
  const storage = options.storage ?? createStorage();
  const { os, calls } = createOsFake(storage.persistent, options.os);
  const events = new WalletEventEmitter(nullLogger);
  const service = new AuthService({
    os,
    storage,
    generateGuestPassword: async () => 'generated-pw',
    events,
    onSessionEnded: options.onSessionEnded,
    // Referenced lazily: requestDispose only fires on a later signOut, by which
    // point `service` is assigned.
    requestDispose: options.disposeOnRequest
      ? () => service.teardown()
      : undefined,
    logger: nullLogger,
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

    it('does not clobber a session an auth action established while the restore fetch was in flight', async () => {
      let releaseRestoreFetch = (): void => undefined;
      const restoreFetchGate = new Promise<void>((resolve) => {
        releaseRestoreFetch = resolve;
      });
      const actionUser = { ...fullUser, id: 'user-action' };
      let fetchCalls = 0;
      const { service, storage } = createService({
        os: {
          fetchUser: async () => {
            fetchCalls += 1;
            if (fetchCalls === 1) {
              await restoreFetchGate;
              return { user: fullUser };
            }
            return { user: actionUser };
          },
        },
      });
      storage.persistent.data.set('access_token', createJwt(600));
      storage.persistent.data.set('refresh_token', createJwt(3600));

      const restore = service.restoreSession();
      // Flush microtasks so the restore's gated fetchUser is in flight first.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await service.signIn('action@b.c', 'pw');
      releaseRestoreFetch();
      await restore;

      expect(service.getSession()).toEqual({
        isLoggedIn: true,
        user: actionUser,
      });
      service.teardown();
    });

    it('does not resurrect a session signed out while the restore fetch was in flight', async () => {
      let releaseRestoreFetch = (): void => undefined;
      const restoreFetchGate = new Promise<void>((resolve) => {
        releaseRestoreFetch = resolve;
      });
      const { service, storage } = createService({
        os: {
          fetchUser: async () => {
            await restoreFetchGate;
            return { user: fullUser };
          },
        },
      });
      storage.persistent.data.set('access_token', createJwt(600));
      storage.persistent.data.set('refresh_token', createJwt(3600));

      const restore = service.restoreSession();
      // Flush microtasks so the restore's gated fetchUser is in flight first.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await service.signOut();
      releaseRestoreFetch();
      await restore;

      // The sign-out aborted the restore's session scope, so its late apply is
      // fenced out rather than resurrecting the signed-out session.
      expect(service.getSession().isLoggedIn).toBe(false);
      service.teardown();
    });

    it('does not repeat the user fetch when an auth action already established the session', async () => {
      const { service, calls } = createService();

      await service.signIn('a@b.c', 'pw');
      await service.restoreSession();

      expect(calls.filter((c) => c === 'fetchUser')).toHaveLength(1);
      service.teardown();
    });

    it('does not fence out a newer restore when an older one fails late', async () => {
      let fetchCalls = 0;
      let releaseFirstFetch = (): void => undefined;
      const firstFetchGate = new Promise<void>((resolve) => {
        releaseFirstFetch = resolve;
      });
      let releaseThirdFetch = (): void => undefined;
      const thirdFetchGate = new Promise<void>((resolve) => {
        releaseThirdFetch = resolve;
      });
      const { service, storage } = createService({
        os: {
          fetchUser: async () => {
            fetchCalls += 1;
            if (fetchCalls === 1) {
              // restore A: fails only after restore B is in flight
              await firstFetchGate;
              throw new Error('slow network failure');
            }
            if (fetchCalls === 2) {
              // the auth action's snapshot refresh: ends the session, un-memoizes A
              throw new Error('auth action fetch failed');
            }
            // restore B
            await thirdFetchGate;
            return { user: fullUser };
          },
        },
      });
      storage.persistent.data.set('access_token', createJwt(600));
      storage.persistent.data.set('refresh_token', createJwt(3600));

      const restoreA = service.restoreSession();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await service.signIn('a@b.c', 'pw');
      const restoreB = service.restoreSession();
      await new Promise((resolve) => setTimeout(resolve, 0));
      releaseFirstFetch();
      await expect(restoreA).rejects.toThrow('slow network failure');
      releaseThirdFetch();
      await restoreB;

      // A's late failure neither aborted B's scope (which would fence its
      // apply out) nor clobbered B's memo
      expect(service.getSession().isLoggedIn).toBe(true);
      await service.restoreSession();
      expect(fetchCalls).toBe(3);
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

    it('fences an in-flight restore that resolves after teardown', async () => {
      let releaseRestoreFetch = (): void => undefined;
      const restoreFetchGate = new Promise<void>((resolve) => {
        releaseRestoreFetch = resolve;
      });
      let sessionEndedCount = 0;
      const { service, storage, events } = createService({
        os: {
          fetchUser: async () => {
            await restoreFetchGate;
            return { user: fullUser };
          },
        },
        onSessionEnded: () => {
          sessionEndedCount += 1;
        },
      });
      storage.persistent.data.set('access_token', createJwt(600));
      storage.persistent.data.set('refresh_token', createJwt(3600));
      const expired: unknown[] = [];
      events.on('auth.session-expired', (payload) => expired.push(payload));

      const restore = service.restoreSession();
      // Flush microtasks so the gated fetchUser is in flight before teardown.
      await new Promise((resolve) => setTimeout(resolve, 0));
      service.teardown();
      releaseRestoreFetch();
      await restore;
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Disposal aborts the session scope, so the late apply is skipped: the
      // disposed instance never becomes logged-in, arms a timer, or runs
      // onSessionEnded (which clears process-wide caches a successor may own).
      expect(service.getSession().isLoggedIn).toBe(false);
      expect(expired).toHaveLength(0);
      expect(sessionEndedCount).toBe(0);
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

    it('undoes the guest sign-up when persisting the credentials fails', async () => {
      const storage = createStorage();
      const write = storage.persistent.setItem;
      storage.persistent.setItem = (key, value) => {
        if (key === 'guestAccount') {
          throw new Error('quota exceeded');
        }
        write(key, value);
      };
      const { service, calls } = createService({
        storage,
        os: { fetchUser: async () => ({ user: guestUser }) },
      });

      await expect(service.signUpGuest()).rejects.toThrow('quota exceeded');

      // no live session on unpersistable credentials — it would strand the
      // account (and any funds) at its first expiry
      expect(calls).toContain('signOut');
      expect(service.getSession().isLoggedIn).toBe(false);
      expect(storage.persistent.data.has('refresh_token')).toBe(false);
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

    it('disposes the instance so it cannot be reused for another identity', async () => {
      const { service } = createService({ disposeOnRequest: true });

      await service.signIn('a@b.c', 'pw');
      await service.signOut();

      // sign-out is terminal under instance-per-identity: the disposed instance
      // rejects every further call, so the host builds a fresh instance.
      await expect(service.signIn('b@b.c', 'pw')).rejects.toBeInstanceOf(
        DisposedError,
      );
      expect(service.getSession().isLoggedIn).toBe(false);
    });

    it('clears per-session caches before disposing', async () => {
      let sessionEnded = false;
      const { service } = createService({
        disposeOnRequest: true,
        onSessionEnded: () => {
          sessionEnded = true;
        },
      });

      await service.signIn('a@b.c', 'pw');
      await service.signOut();

      // dispose alone skips onSessionEnded (it protects a successor's caches),
      // so sign-out must run the cache wipe itself before disposing.
      expect(sessionEnded).toBe(true);
    });

    it('keeps caches warm when the same user re-applies via guest extension', async () => {
      let sessionEndedCount = 0;
      const { service, storage, events } = createService({
        os: { fetchUser: async () => ({ user: guestUser }) },
        onSessionEnded: () => {
          sessionEndedCount += 1;
        },
      });
      storage.persistent.data.set(
        'guestAccount',
        JSON.stringify({ id: 'guest-1', password: 'pw' }),
      );
      storage.persistent.data.set('access_token', createJwt(600));
      storage.persistent.data.set('refresh_token', createJwt(4));
      const refreshed: unknown[] = [];
      events.on('auth.session-refreshed', (payload) => refreshed.push(payload));

      await service.restoreSession();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // the extension re-signs-in the SAME guest, so no cross-user wipe fires
      expect(refreshed).toHaveLength(1);
      expect(sessionEndedCount).toBe(0);
      service.teardown();
    });
  });

  describe('instance-per-identity', () => {
    it('refuses a second sign-in once an identity is established', async () => {
      const { service, calls } = createService();

      await service.signIn('a@b.c', 'pw');
      await expect(service.signIn('b@b.c', 'pw')).rejects.toBeInstanceOf(
        InstanceAlreadyUsedError,
      );

      // the guard fires before Open Secret is touched, so a second identity's
      // tokens are never written onto this instance
      expect(calls.filter((c) => c === 'signIn')).toHaveLength(1);
      service.teardown();
    });

    it('refuses signUp and signUpGuest once an identity is established', async () => {
      const { service } = createService();

      await service.signIn('a@b.c', 'pw');

      await expect(service.signUp('c@b.c', 'pw')).rejects.toBeInstanceOf(
        InstanceAlreadyUsedError,
      );
      await expect(service.signUpGuest()).rejects.toBeInstanceOf(
        InstanceAlreadyUsedError,
      );
      service.teardown();
    });

    it('does not use up the instance when a sign-in fails before establishing', async () => {
      let failOnce = true;
      const { service } = createService({
        os: {
          signIn: async () => {
            if (failOnce) {
              failOnce = false;
              throw new Error('bad credentials');
            }
            return { id: 'user-1', access_token: 'a', refresh_token: 'r' };
          },
        },
      });

      await expect(service.signIn('a@b.c', 'wrong')).rejects.toThrow(
        'bad credentials',
      );
      // the failed attempt established no identity, so the retry is allowed
      await service.signIn('a@b.c', 'right');

      expect(service.getSession().isLoggedIn).toBe(true);
      service.teardown();
    });

    it('ends the session instead of re-keying when a refresh resolves to a different user', async () => {
      let fetchCalls = 0;
      let sessionEnded = false;
      const { service, storage, events } = createService({
        os: {
          fetchUser: async () => {
            fetchCalls += 1;
            // restore establishes the guest; the post-extension refresh then
            // resolves to a different identity
            return {
              user:
                fetchCalls === 1
                  ? guestUser
                  : { ...fullUser, id: 'someone-else' },
            };
          },
        },
        onSessionEnded: () => {
          sessionEnded = true;
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

      // the different identity is refused rather than adopted: the session ends,
      // the per-session caches are wiped, and the host is told to rebuild
      expect(service.getSession().isLoggedIn).toBe(false);
      expect(expired).toHaveLength(1);
      expect(sessionEnded).toBe(true);
    });

    it('refuses a foreign identity on a used instance even after the session goes anonymous, and revokes its tokens', async () => {
      let fetchCalls = 0;
      const { service, storage, events } = createService({
        os: {
          fetchUser: async () => ({
            user: { ...fullUser, id: fetchCalls++ === 0 ? 'user-a' : 'user-b' },
          }),
        },
      });
      const expired: unknown[] = [];
      events.on('auth.session-expired', (payload) => expired.push(payload));

      await service.signIn('a@b.c', 'pw'); // binds the instance to user-a
      await service.signOut(); // session goes anonymous; instance still bound to user-a

      // completeGoogleAuth is unguarded: it writes fresh tokens then applies a
      // DIFFERENT user (user-b) over the bound instance.
      await service.completeGoogleAuth({ code: 'c', state: 's' });

      // user-b is refused rather than adopted, and its tokens revoked — a rebuild
      // cannot restore it, so the instance never serves a second identity.
      expect(service.getSession().isLoggedIn).toBe(false);
      expect(storage.persistent.data.has('refresh_token')).toBe(false);
      expect(expired.length).toBeGreaterThan(0);
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
      // the timer fires on the next macrotask
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

    // A sign-out that lands while the guest extension's re-sign-in is in
    // flight must not resurrect the session: the handler compensates by
    // clearing the fresh tokens again (PR #1166 review, finding 1).
    it('does not resurrect a session that was signed out while a guest extension was in flight', async () => {
      let releaseSignInGuest = (): void => undefined;
      const signInGuestGate = new Promise<void>((resolve) => {
        releaseSignInGuest = resolve;
      });
      const storage = createStorage();
      const { service, calls, events } = createService({
        storage,
        os: {
          fetchUser: async () => ({ user: guestUser }),
          signInGuest: async () => {
            // The extension's fresh tokens land only once the gate opens —
            // i.e. after the concurrent sign-out already cleared storage.
            await signInGuestGate;
            storage.persistent.data.set(
              'access_token',
              createJwt(600, 'guest-1'),
            );
            storage.persistent.data.set(
              'refresh_token',
              createJwt(3600, 'guest-1'),
            );
            return { id: 'guest-1', access_token: 'a', refresh_token: 'r' };
          },
        },
      });
      storage.persistent.data.set(
        'guestAccount',
        JSON.stringify({ id: 'guest-1', password: 'pw' }),
      );
      storage.persistent.data.set('access_token', createJwt(600));
      storage.persistent.data.set('refresh_token', createJwt(4));
      const refreshed: unknown[] = [];
      events.on('auth.session-refreshed', (payload) => refreshed.push(payload));
      const expired: unknown[] = [];
      events.on('auth.session-expired', (payload) => expired.push(payload));

      await service.restoreSession();
      // let the expiry timer fire and park the extension on the gated sign-in
      await new Promise((resolve) => setTimeout(resolve, 10));
      await service.signOut();
      releaseSignInGuest();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(service.getSession().isLoggedIn).toBe(false);
      expect(refreshed).toHaveLength(0);
      expect(expired).toHaveLength(0);
      // the extension's freshly written tokens were cleared again instead of
      // being left to resurrect the signed-out session on the next boot
      expect(storage.persistent.data.has('refresh_token')).toBe(false);
      expect(calls.filter((c) => c === 'fetchUser')).toHaveLength(1);
    });

    // A sign-out that lands after the first scope check, while the extension's
    // own apply is in flight, must not resurrect the ended session — the apply
    // is scope-guarded (PR #1166 review, round-3c H3).
    it('does not resurrect a signed-out session while the post-extension apply is in flight', async () => {
      let fetchCalls = 0;
      let releaseExtensionFetch = (): void => undefined;
      const extensionFetchGate = new Promise<void>((resolve) => {
        releaseExtensionFetch = resolve;
      });
      const storage = createStorage();
      const { service, events } = createService({
        storage,
        os: {
          fetchUser: async () => {
            fetchCalls += 1;
            // Hold the post-extension refresh apply so a sign-out can race it.
            if (fetchCalls === 2) {
              await extensionFetchGate;
            }
            return { user: guestUser };
          },
          signInGuest: async () => {
            storage.persistent.data.set(
              'access_token',
              createJwt(600, 'guest-1'),
            );
            storage.persistent.data.set(
              'refresh_token',
              createJwt(3600, 'guest-1'),
            );
            return { id: 'guest-1', access_token: 'a', refresh_token: 'r' };
          },
        },
      });
      storage.persistent.data.set(
        'guestAccount',
        JSON.stringify({ id: 'guest-1', password: 'pw' }),
      );
      storage.persistent.data.set('access_token', createJwt(600));
      storage.persistent.data.set('refresh_token', createJwt(4));
      const refreshed: unknown[] = [];
      events.on('auth.session-refreshed', (payload) => refreshed.push(payload));
      const expired: unknown[] = [];
      events.on('auth.session-expired', (payload) => expired.push(payload));

      await service.restoreSession();
      // let the timer fire and park the extension on the gated post-apply fetch
      await new Promise((resolve) => setTimeout(resolve, 10));
      await service.signOut();
      releaseExtensionFetch();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // the scoped extension apply is skipped, so the sign-out stands
      expect(service.getSession().isLoggedIn).toBe(false);
      expect(refreshed).toHaveLength(0);
      expect(expired).toHaveLength(0);
      expect(storage.persistent.data.has('refresh_token')).toBe(false);
    });

    // The SDK-lifecycle variant: teardown() lands mid-handler, so the death
    // path bails before signing out — tokens survive for a successor instance
    // (PR #1166 review, finding 1).
    it('stops an in-flight expiry handler at teardown without clearing tokens', async () => {
      let gateReads = false;
      let releaseTokenRead = (): void => undefined;
      const readGate = new Promise<void>((resolve) => {
        releaseTokenRead = resolve;
      });
      const storage = createStorage();
      const readValue = storage.persistent.getItem;
      storage.persistent.getItem = async (key) => {
        if (gateReads) {
          await readGate;
        }
        return readValue(key);
      };
      const { service, calls, events } = createService({ storage });
      storage.persistent.data.set('access_token', createJwt(600));
      storage.persistent.data.set('refresh_token', createJwt(4));
      const expired: unknown[] = [];
      events.on('auth.session-expired', (payload) => expired.push(payload));

      await service.restoreSession();
      // gate the handler's token re-read so teardown lands mid-handler
      gateReads = true;
      await new Promise((resolve) => setTimeout(resolve, 10));
      service.teardown();
      releaseTokenRead();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(calls).not.toContain('signOut');
      expect(expired).toHaveLength(0);
      // teardown is not logout: tokens survive for a successor instance
      expect(storage.persistent.data.has('refresh_token')).toBe(true);
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

  describe('dispose', () => {
    it('throws when an action is invoked after teardown', async () => {
      const { service } = createService();
      service.teardown();

      await expect(service.signIn('a@b.c', 'pw')).rejects.toBeInstanceOf(
        DisposedError,
      );
      await expect(service.restoreSession()).rejects.toBeInstanceOf(
        DisposedError,
      );
    });
  });
});
