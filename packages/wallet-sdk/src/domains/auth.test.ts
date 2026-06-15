import { describe, expect, mock, test } from 'bun:test';
import sign from 'jwt-encode';
import { inMemoryStorageAdapter } from '../../storage/memory';
import { EventBus } from '../internal/event-bus';
import type { SdkCoreEventMap } from '../events';
import { AuthDomain, type AuthDeps } from './auth';

const USER = {
  id: 'u1',
  isGuest: false,
  email: 'a@b.c',
  username: 'alice',
} as const;
const refreshJwt = (secs: number) =>
  sign({ exp: Math.floor(Date.now() / 1000) + secs, sub: 'u1' }, 's');

function makeAuth(overrides: Partial<AuthDeps> = {}) {
  const events = new EventBus<SdkCoreEventMap>();
  const storage = inMemoryStorageAdapter();
  const os = {
    signIn: mock(async () => {
      await storage.set('refresh_token', refreshJwt(3600));
      return { id: 'u1' };
    }),
    signUp: mock(async () => {
      await storage.set('refresh_token', refreshJwt(3600));
      return { id: 'u1' };
    }),
    signInGuest: mock(async () => {
      await storage.set('refresh_token', refreshJwt(3600));
      return { id: 'g1' };
    }),
    signUpGuest: mock(async () => {
      await storage.set('refresh_token', refreshJwt(3600));
      return { id: 'g1' };
    }),
    convertGuestToUserAccount: mock(async () => {}),
    signOut: mock(async () => {
      await storage.remove('refresh_token');
    }),
    fetchUser: mock(async () => ({
      user: { id: 'u1', email: 'a@b.c', email_verified: true },
    })),
    initiateGoogleAuth: mock(async () => ({ auth_url: 'https://x/y?state=z' })),
    handleGoogleCallback: mock(async () => ({ id: 'u1' })),
    changePassword: mock(async () => {}),
    requestNewVerificationCode: mock(async () => {}),
    verifyEmail: mock(async () => {}),
    requestPasswordReset: mock(async () => {}),
    confirmPasswordReset: mock(async () => {}),
  };
  const keys = {
    getEncryptionPublicKey: mock(async () => 'enc'),
    getCashuLockingXpub: mock(async () => 'xpub'),
    getSparkIdentityPublicKey: mock(async () => 'spark'),
    clear: mock(() => {}),
  };
  const writeUserRepo = { upsert: mock(async () => ({ ...USER })) };
  const sessionToken = { clear: mock(() => {}) };
  const storageSession = { clearSession: mock(async () => {}) };
  const deps = {
    os,
    keys,
    events,
    storage,
    writeUserRepo,
    sessionToken,
    storageSession,
    network: 'MAINNET',
    includeTestAccounts: false,
    ...overrides,
  } as unknown as AuthDeps;
  const auth = new AuthDomain(deps);
  return {
    auth,
    events,
    os,
    keys,
    writeUserRepo,
    sessionToken,
    storageSession,
    storage,
  };
}

describe('AuthDomain', () => {
  test('signIn reconciles a User and emits auth:signed-in', async () => {
    const { auth, events, writeUserRepo } = makeAuth();
    const seen: unknown[] = [];
    events.on('auth:signed-in', (p) => seen.push(p));
    const user = await auth.signIn({ email: 'a@b.c', password: 'pw' });
    expect(user.id).toBe('u1');
    expect(writeUserRepo.upsert).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([{ user }]);
    auth.cancelSessionExpiry();
  });

  test('signInGuest creates + stores credentials when none exist', async () => {
    const { auth, os, storage } = makeAuth();
    await auth.signInGuest();
    expect(os.signUpGuest).toHaveBeenCalledTimes(1);
    expect(os.signInGuest).not.toHaveBeenCalled();
    const stored = await storage.get('agicash.guest-account');
    expect(stored && JSON.parse(stored).id).toBe('g1');
    auth.cancelSessionExpiry();
  });

  test('signInGuest restores existing credentials', async () => {
    const { auth, os, storage } = makeAuth();
    await storage.set(
      'agicash.guest-account',
      JSON.stringify({ id: 'g9', password: 'pw' }),
    );
    await auth.signInGuest();
    expect(os.signInGuest).toHaveBeenCalledTimes(1);
    expect(os.signUpGuest).not.toHaveBeenCalled();
    auth.cancelSessionExpiry();
  });

  test('signOut clears secrets and emits auth:signed-out', async () => {
    const { auth, events, keys, sessionToken, storageSession } = makeAuth();
    await auth.signIn({ email: 'a@b.c', password: 'pw' });
    let signedOut = false;
    events.on('auth:signed-out', () => {
      signedOut = true;
    });
    await auth.signOut();
    expect(keys.clear).toHaveBeenCalled();
    expect(sessionToken.clear).toHaveBeenCalled();
    expect(storageSession.clearSession).toHaveBeenCalled();
    expect(signedOut).toBe(true);
  });

  test('upgradeGuest converts and clears guest credentials', async () => {
    const { auth, os, storage } = makeAuth();
    await storage.set(
      'agicash.guest-account',
      JSON.stringify({ id: 'g9', password: 'pw' }),
    );
    await auth.upgradeGuest({ email: 'a@b.c', password: 'pw' });
    expect(os.convertGuestToUserAccount).toHaveBeenCalledTimes(1);
    expect(await storage.get('agicash.guest-account')).toBeUndefined();
    auth.cancelSessionExpiry();
  });

  test('guest session expiry silently re-authenticates (no event)', async () => {
    const { auth, os, events, storage } = makeAuth();
    await storage.set(
      'agicash.guest-account',
      JSON.stringify({ id: 'g9', password: 'pw' }),
    );
    // refresh token already within the 5s skew window -> timer fires immediately
    await storage.set('refresh_token', refreshJwt(0));
    let expired = false;
    events.on('auth:session-expired', () => {
      expired = true;
    });
    await auth.initialize();
    await new Promise((r) => setTimeout(r, 20));
    expect(os.signInGuest).toHaveBeenCalled();
    expect(expired).toBe(false);
    auth.cancelSessionExpiry();
  });

  test('full-user session expiry tears down and emits auth:session-expired', async () => {
    const { auth, os, events, storage } = makeAuth();
    // no guest credentials -> full-user expiry path
    await storage.set('refresh_token', refreshJwt(0));
    let expired = false;
    events.on('auth:session-expired', () => {
      expired = true;
    });
    await auth.initialize();
    await new Promise((r) => setTimeout(r, 20));
    expect(os.signOut).toHaveBeenCalled();
    expect(expired).toBe(true);
    auth.cancelSessionExpiry();
  });
});
