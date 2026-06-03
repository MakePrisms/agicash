import { describe, expect, mock, test } from 'bun:test';
import { DomainError } from '../errors';
import type { SessionResolver } from '../internal/session';
import type { UserRepository } from '../internal/user-repository';
import type { User } from '../types/user';
import { UserDomainImpl } from './user';

const currentUser = { id: 'user-1', username: 'alice' } as unknown as User;

describe('UserDomainImpl.getCurrentUser', () => {
  test('delegates to the session resolver', async () => {
    const session = {
      getCurrentUser: mock(async () => currentUser),
    } as unknown as SessionResolver;
    const users = {} as unknown as UserRepository;
    const domain = new UserDomainImpl(session, users);

    expect(await domain.getCurrentUser()).toBe(currentUser);
    expect(session.getCurrentUser).toHaveBeenCalledTimes(1);
  });

  test('returns null when signed out', async () => {
    const session = {
      getCurrentUser: mock(async () => null),
    } as unknown as SessionResolver;
    const domain = new UserDomainImpl(session, {} as unknown as UserRepository);

    expect(await domain.getCurrentUser()).toBeNull();
  });
});

describe('UserDomainImpl.updateUsername', () => {
  test('resolves the current user id then updates the username', async () => {
    const updated = { ...currentUser, username: 'bob' };
    const session = {
      requireCurrentUser: mock(async () => currentUser),
    } as unknown as SessionResolver;
    const users = {
      updateUsername: mock(async () => updated),
    } as unknown as UserRepository;
    const domain = new UserDomainImpl(session, users);

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
    const domain = new UserDomainImpl(session, users);

    await expect(domain.updateUsername('taken')).rejects.toBeInstanceOf(
      DomainError,
    );
  });
});
