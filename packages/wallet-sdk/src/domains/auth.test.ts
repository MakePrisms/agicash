import { describe, expect, mock, test } from 'bun:test';
import type { GuestAccountStorage } from '../internal/guest-account-storage';
import type { OpenSecretClient } from '../internal/open-secret';
import type { SessionResolver } from '../internal/session';
import type { User } from '../types/user';
import { AuthDomainImpl } from './auth';

/** A signed-in user fixture returned by the (faked) session resolver. */
const signedInUser = { id: 'user-1', username: 'alice' } as unknown as User;

/** A `Promise<void>`-returning mock body (non-empty, to satisfy the no-empty-block lint). */
const resolved = () => Promise.resolve();

/**
 * Build an {@link AuthDomainImpl} over mocked collaborators, exposing the mocks so a test
 * can assert calls. `storedGuest` seeds the guest-credential store.
 */
function makeAuth(storedGuest: { id: string; password: string } | null = null) {
  const openSecret = {
    signIn: mock(resolved),
    signUp: mock(resolved),
    signUpGuest: mock(() => Promise.resolve({ id: 'guest-new' })),
    signInGuest: mock(resolved),
    signOut: mock(resolved),
    refresh: mock(resolved),
    convertGuestToUserAccount: mock(resolved),
    changePassword: mock(resolved),
    requestPasswordReset: mock(resolved),
    initiateGoogleAuth: mock(() =>
      Promise.resolve({ authUrl: 'https://auth/url' }),
    ),
    handleGoogleCallback: mock(resolved),
  } as unknown as OpenSecretClient;

  const session = {
    completeSignIn: mock(() => Promise.resolve(signedInUser)),
    completeSignOut: mock(() => undefined),
  } as unknown as SessionResolver;

  const guestStorage = {
    get: mock(() => Promise.resolve(storedGuest)),
    store: mock(resolved),
    clear: mock(resolved),
  } as unknown as GuestAccountStorage;

  const auth = new AuthDomainImpl(openSecret, session, guestStorage);
  return { auth, openSecret, session, guestStorage };
}

describe('AuthDomainImpl.signIn', () => {
  test('calls OpenSecret.signIn then resolves + returns the user', async () => {
    const { auth, openSecret, session } = makeAuth();

    const user = await auth.signIn({
      email: 'a@b.com',
      password: 'pw',
    });

    expect(openSecret.signIn).toHaveBeenCalledWith('a@b.com', 'pw');
    expect(session.completeSignIn).toHaveBeenCalledTimes(1);
    expect(user).toBe(signedInUser);
  });
});

describe('AuthDomainImpl.signInGuest', () => {
  test('with no stored guest: creates one, stores creds, completes sign-in', async () => {
    const { auth, openSecret, guestStorage } = makeAuth(null);

    await auth.signInGuest();

    expect(openSecret.signUpGuest).toHaveBeenCalledTimes(1);
    // signInGuest (re-sign-in path) must NOT be used when minting a fresh guest
    expect(openSecret.signInGuest).not.toHaveBeenCalled();
    expect(guestStorage.store).toHaveBeenCalledTimes(1);
    const stored = (guestStorage.store as ReturnType<typeof mock>).mock
      .calls[0][0];
    expect(stored.id).toBe('guest-new');
    expect(typeof stored.password).toBe('string');
  });

  test('with a stored guest: re-signs into it, does not mint a new one', async () => {
    const { auth, openSecret, guestStorage } = makeAuth({
      id: 'guest-existing',
      password: 'secret',
    });

    await auth.signInGuest();

    expect(openSecret.signInGuest).toHaveBeenCalledWith(
      'guest-existing',
      'secret',
    );
    expect(openSecret.signUpGuest).not.toHaveBeenCalled();
    expect(guestStorage.store).not.toHaveBeenCalled();
  });
});

describe('AuthDomainImpl.upgradeGuest', () => {
  test('converts the account, clears guest creds, returns the user', async () => {
    const { auth, openSecret, guestStorage } = makeAuth();

    const user = await auth.upgradeGuest({
      email: 'a@b.com',
      password: 'pw',
    });

    expect(openSecret.convertGuestToUserAccount).toHaveBeenCalledWith(
      'a@b.com',
      'pw',
    );
    expect(guestStorage.clear).toHaveBeenCalledTimes(1);
    expect(user).toBe(signedInUser);
  });
});

describe('AuthDomainImpl.signOut', () => {
  test('signs out of the enclave then completes the local sign-out', async () => {
    const { auth, openSecret, session } = makeAuth();

    await auth.signOut();

    expect(openSecret.signOut).toHaveBeenCalledTimes(1);
    expect(session.completeSignOut).toHaveBeenCalledTimes(1);
  });
});

describe('AuthDomainImpl.resetPassword', () => {
  test('sends a hashed secret (not the plaintext email) to OpenSecret', async () => {
    const { auth, openSecret } = makeAuth();

    await auth.resetPassword('a@b.com');

    expect(openSecret.requestPasswordReset).toHaveBeenCalledTimes(1);
    const [email, hashedSecret] = (
      openSecret.requestPasswordReset as ReturnType<typeof mock>
    ).mock.calls[0];
    expect(email).toBe('a@b.com');
    // a SHA-256 hex digest of the generated secret
    expect(hashedSecret).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('AuthDomainImpl.changePassword', () => {
  test('passes current + new passwords through to the enclave', async () => {
    const { auth, openSecret } = makeAuth();

    await auth.changePassword({ current: 'old', new: 'new' });

    expect(openSecret.changePassword).toHaveBeenCalledWith('old', 'new');
  });
});

describe('AuthDomainImpl.beginGoogleSignIn', () => {
  test('returns the enclave auth URL', async () => {
    const { auth } = makeAuth();
    expect(await auth.beginGoogleSignIn()).toEqual({
      authUrl: 'https://auth/url',
    });
  });
});

describe('AuthDomainImpl.completeOAuth', () => {
  test('forwards code/state/inviteCode and resolves the user', async () => {
    const { auth, openSecret, session } = makeAuth();

    const user = await auth.completeOAuth({
      code: 'c',
      state: 's',
      inviteCode: 'inv',
    });

    expect(openSecret.handleGoogleCallback).toHaveBeenCalledWith(
      'c',
      's',
      'inv',
    );
    expect(session.completeSignIn).toHaveBeenCalledTimes(1);
    expect(user).toBe(signedInUser);
  });

  test("defaults inviteCode to '' when omitted", async () => {
    const { auth, openSecret } = makeAuth();

    await auth.completeOAuth({ code: 'c', state: 's' });

    expect(openSecret.handleGoogleCallback).toHaveBeenCalledWith('c', 's', '');
  });
});
