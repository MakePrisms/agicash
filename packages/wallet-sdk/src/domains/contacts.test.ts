import { describe, expect, mock, test } from 'bun:test';
import type { Contact } from './contact';
import { ContactsDomain } from './contacts';

const CONTACT: Contact = {
  id: 'c1',
  createdAt: '2024-01-01T00:00:00Z',
  ownerId: 'u1',
  username: 'alice',
  lud16: 'alice@example.com',
};

const makeDomain = (over: {
  getAll?: ReturnType<typeof mock>;
  userId?: string | null;
}) =>
  new ContactsDomain({
    contactRepository: {
      getAll: over.getAll ?? mock(async () => [CONTACT]),
      get: mock(async () => CONTACT),
      create: mock(async () => CONTACT),
      delete: mock(async () => undefined),
      findContactCandidates: mock(async () => []),
    } as unknown as ConstructorParameters<
      typeof ContactsDomain
    >[0]['contactRepository'],
    getCurrentUserId: async () =>
      over.userId !== undefined ? over.userId : 'u1',
  });

describe('ContactsDomain.list', () => {
  test('returns contacts from repo.getAll for the current user', async () => {
    const getAll = mock(async () => [CONTACT]);
    const domain = makeDomain({ getAll, userId: 'u1' });
    const result = await domain.list();
    expect(result).toEqual([CONTACT]);
    expect(getAll).toHaveBeenCalledWith('u1');
  });

  test('throws "No authenticated user" when signed out', async () => {
    await expect(makeDomain({ userId: null }).list()).rejects.toThrow(
      'No authenticated user',
    );
  });
});
