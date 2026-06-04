import { describe, expect, mock, test } from 'bun:test';
import { DomainError } from '../errors';
import type { SessionResolver } from '../internal/session';
import type { UserRepository } from '../internal/user-repository';
import { QueryClient } from '../query';
import type { Query } from '../types/query';
import type { User } from '../types/user';
import { UserDomainImpl } from './user';

const currentUser = { id: 'user-1', username: 'alice' } as unknown as User;

/** A fresh QueryClient per test (the SDK-internal one in production). */
function makeClient(): QueryClient {
  return new QueryClient();
}

/** Resolve the first emitted value of a `Query`, then unsubscribe. */
function firstEmit<T>(q: Query<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const off = q.subscribe(
      (data) => {
        off();
        resolve(data);
      },
      (err) => {
        off();
        reject(err);
      },
    );
  });
}

describe('UserDomainImpl.getCurrentUser', () => {
  test('returns a Query whose toPromise() resolves to the session user', async () => {
    const session = {
      getCurrentUser: mock(async () => currentUser),
    } as unknown as SessionResolver;
    const domain = new UserDomainImpl(
      makeClient(),
      session,
      {} as unknown as UserRepository,
    );

    const query = domain.getCurrentUser();
    // It is a Query<User | null>, not a bare Promise.
    expect(typeof query.subscribe).toBe('function');
    expect(typeof query.toPromise).toBe('function');
    expect(typeof query.getSnapshot).toBe('function');

    expect(await query.toPromise()).toBe(currentUser);
    expect(session.getCurrentUser).toHaveBeenCalledTimes(1);
  });

  test('subscribe fires with the resolved user (the underlying session read still works)', async () => {
    const session = {
      getCurrentUser: mock(async () => currentUser),
    } as unknown as SessionResolver;
    const domain = new UserDomainImpl(
      makeClient(),
      session,
      {} as unknown as UserRepository,
    );

    const emitted = await firstEmit(domain.getCurrentUser());
    expect(emitted).toBe(currentUser);
  });

  test('resolves to null when signed out', async () => {
    const session = {
      getCurrentUser: mock(async () => null),
    } as unknown as SessionResolver;
    const domain = new UserDomainImpl(
      makeClient(),
      session,
      {} as unknown as UserRepository,
    );

    expect(await domain.getCurrentUser().toPromise()).toBeNull();
  });

  test('is memoised per key — repeated calls return the SAME Query ref', () => {
    const session = {
      getCurrentUser: mock(async () => currentUser),
    } as unknown as SessionResolver;
    const domain = new UserDomainImpl(
      makeClient(),
      session,
      {} as unknown as UserRepository,
    );

    expect(domain.getCurrentUser()).toBe(domain.getCurrentUser());
  });
});

describe('UserDomainImpl.updateUsername', () => {
  test('resolves the current user id then updates the username (stays a Promise)', async () => {
    const updated = { ...currentUser, username: 'bob' };
    const session = {
      requireCurrentUser: mock(async () => currentUser),
    } as unknown as SessionResolver;
    const users = {
      updateUsername: mock(async () => updated),
    } as unknown as UserRepository;
    const domain = new UserDomainImpl(makeClient(), session, users);

    const result = await domain.updateUsername('bob');

    expect(session.requireCurrentUser).toHaveBeenCalledTimes(1);
    expect(users.updateUsername).toHaveBeenCalledWith('user-1', 'bob');
    expect(result.username).toBe('bob');
  });

  test('propagates a DomainError from the repository (username taken)', async () => {
    const session = {
      requireCurrentUser: mock(async () => currentUser),
    } as unknown as SessionResolver;
    const users = {
      updateUsername: mock(async () => {
        throw new DomainError(
          'This username is already taken',
          'USERNAME_TAKEN',
        );
      }),
    } as unknown as UserRepository;
    const domain = new UserDomainImpl(makeClient(), session, users);

    await expect(domain.updateUsername('taken')).rejects.toBeInstanceOf(
      DomainError,
    );
  });
});
