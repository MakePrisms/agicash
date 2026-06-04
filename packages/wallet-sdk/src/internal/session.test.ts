import { describe, expect, test } from 'bun:test';
import type { SdkEventMap } from '../types/events';
import type { User } from '../types/user';
import { TypedEventEmitter } from './event-emitter';
import type { OpenSecretClient, OpenSecretUser } from './open-secret';
import { SessionResolver } from './session';
import type { SupabaseSessionTokenProvider } from './supabase-session';
import type { UserRepository } from './user-repository';

/** A domain user fixture. */
const domainUser: User = {
  id: 'user-1',
  username: 'alice',
  email: 'alice@example.com',
  isGuest: false,
  emailVerified: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  defaultBtcAccountId: 'btc',
  defaultUsdAccountId: null,
  defaultCurrency: 'BTC',
  cashuLockingXpub: 'xpub',
  encryptionPublicKey: 'enc',
  sparkIdentityPublicKey: 'spark',
  termsAcceptedAt: null,
  giftCardMintTermsAcceptedAt: null,
};

/** An OpenSecret enclave user fixture. */
const osUser: OpenSecretUser = {
  id: 'user-1',
  name: null,
  email: 'alice@example.com',
  email_verified: true,
  login_method: 'email',
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
};

/**
 * Build a {@link SessionResolver} over fakes. `currentOsUser` controls who the enclave
 * reports (null = signed out); the user repo always maps id → {@link domainUser}. Returns
 * the resolver plus the spies (token-cleared count, emitted events).
 */
function makeResolver(currentOsUser: OpenSecretUser | null) {
  let cleared = 0;
  const events = new TypedEventEmitter<SdkEventMap>();
  const openSecret = {
    fetchUser: async () => currentOsUser,
  } as unknown as OpenSecretClient;
  const users = {
    get: async (id: string) => ({ ...domainUser, id }),
  } as unknown as UserRepository;
  const sessionToken = {
    clear: () => {
      cleared += 1;
    },
  } as unknown as SupabaseSessionTokenProvider;

  const resolver = new SessionResolver(openSecret, users, sessionToken, events);
  return { resolver, events, getCleared: () => cleared };
}

describe('SessionResolver.getCurrentUser', () => {
  test('returns null when there is no enclave session', async () => {
    const { resolver } = makeResolver(null);
    expect(await resolver.getCurrentUser()).toBeNull();
  });

  test('resolves the DB user for the signed-in enclave id', async () => {
    const { resolver } = makeResolver(osUser);
    const user = await resolver.getCurrentUser();
    expect(user?.id).toBe('user-1');
    expect(user?.username).toBe('alice');
  });
});

describe('SessionResolver.requireCurrentUser', () => {
  test('throws when signed out', async () => {
    const { resolver } = makeResolver(null);
    await expect(resolver.requireCurrentUser()).rejects.toThrow(
      'No authenticated user',
    );
  });
});

describe('SessionResolver.completeSignIn', () => {
  test('clears the cached token, returns the user, and emits auth:signed-in', async () => {
    const { resolver, events, getCleared } = makeResolver(osUser);
    const received: User[] = [];
    events.on('auth:signed-in', ({ user }) => received.push(user));

    const user = await resolver.completeSignIn();

    expect(getCleared()).toBe(1);
    expect(user.id).toBe('user-1');
    expect(received).toHaveLength(1);
    expect(received[0]?.id).toBe('user-1');
  });
});

describe('SessionResolver.completeSignOut', () => {
  test('clears the cached token and emits auth:signed-out', () => {
    const { resolver, events, getCleared } = makeResolver(osUser);
    let signedOut = 0;
    events.on('auth:signed-out', () => {
      signedOut += 1;
    });

    resolver.completeSignOut();

    expect(getCleared()).toBe(1);
    expect(signedOut).toBe(1);
  });
});
