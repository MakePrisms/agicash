import { describe, expect, mock, test } from 'bun:test';
import { ContactsDomainImpl } from './contacts';
import type { ContactRepository } from '../internal/contact-repository';
import type { SessionResolver } from '../internal/session';
import type { Contact } from '../types/contact';

const session = {
  requireCurrentUser: mock(async () => ({ id: 'u1' })),
} as unknown as SessionResolver;

const contact: Contact = {
  id: 'c1',
  createdAt: '2026-01-01T00:00:00.000Z',
  ownerId: 'u1',
  username: 'alice',
  lud16: 'alice@agicash.me',
};

describe('ContactsDomain', () => {
  test('add creates the contact owned by the current user (params, not full object)', async () => {
    const create = mock(async () => contact);
    const repo = { create } as unknown as ContactRepository;
    const domain = new ContactsDomainImpl(repo, session);

    const result = await domain.add({ username: 'alice' });

    expect(create).toHaveBeenCalledWith({ ownerId: 'u1', username: 'alice' });
    expect(result).toBe(contact);
  });

  test('remove takes the FULL contact and deletes by id', async () => {
    const del = mock(async () => undefined);
    const repo = { delete: del } as unknown as ContactRepository;
    const domain = new ContactsDomainImpl(repo, session);

    await domain.remove(contact);

    expect(del).toHaveBeenCalledWith('c1');
  });

  test('get returns null (instead of throwing) when the repository read fails', async () => {
    const repo = {
      get: mock(async () => {
        throw new Error('not found');
      }),
    } as unknown as ContactRepository;
    const domain = new ContactsDomainImpl(repo, session);

    expect(await domain.get('missing')).toBeNull();
  });

  test('search forwards the query + current user to findContactCandidates', async () => {
    const candidates = [{ id: 'p1', username: 'ali' }];
    const findContactCandidates = mock(async () => candidates);
    const repo = { findContactCandidates } as unknown as ContactRepository;
    const domain = new ContactsDomainImpl(repo, session);

    const result = await domain.search({ query: 'ali' });

    expect(findContactCandidates).toHaveBeenCalledWith('ali', 'u1');
    expect(result).toBe(candidates);
  });
});
