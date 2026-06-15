import { describe, expect, mock, test } from 'bun:test';
import { UserDomain } from './user';

const USER = { id: 'u1', isGuest: false, email: 'a@b.c', username: 'alice' };

const makeDomain = (over: {
  get?: ReturnType<typeof mock>;
  update?: ReturnType<typeof mock>;
  userId?: string | null;
}) =>
  new UserDomain({
    readUserRepo: { get: over.get ?? mock(async () => USER) },
    writeUserRepo: { update: over.update ?? mock(async () => USER) },
    getCurrentUserId: async () => over.userId ?? null,
  } as unknown as ConstructorParameters<typeof UserDomain>[0]);

describe('UserDomain', () => {
  test('get returns null when signed out', async () => {
    expect(await makeDomain({ userId: null }).get()).toBeNull();
  });

  test('get reads the current user when signed in', async () => {
    const get = mock(async () => USER);
    const domain = makeDomain({ get, userId: 'u1' });
    expect((await domain.get())?.id).toBe('u1');
    expect(get).toHaveBeenCalledWith('u1');
  });

  test('updateUsername delegates to repo.update', async () => {
    const update = mock(async () => ({ ...USER, username: 'bob' }));
    const domain = makeDomain({ update, userId: 'u1' });
    const result = await domain.updateUsername('bob');
    expect(result.username).toBe('bob');
    expect(update).toHaveBeenCalledWith('u1', { username: 'bob' });
  });

  test('acceptTerms sets termsAcceptedAt and requires a user', async () => {
    const update = mock(async () => USER);
    const domain = makeDomain({ update, userId: 'u1' });
    await domain.acceptTerms();
    const call = update.mock.calls[0] as unknown as [
      string,
      { termsAcceptedAt?: string },
    ];
    expect(call[0]).toBe('u1');
    expect(typeof call[1].termsAcceptedAt).toBe('string');
    // throws when signed out
    await expect(
      makeDomain({ update, userId: null }).updateUsername('x'),
    ).rejects.toThrow();
  });
});
