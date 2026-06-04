import { describe, expect, mock, test } from 'bun:test';
import { ContactsDomainImpl } from './contacts';
import type { ContactRepository } from '../internal/contact-repository';
import type { SessionResolver } from '../internal/session';
import { QueryClient } from '../query';
import type { Contact } from '../types/contact';

/** A fresh QueryClient per domain (the SDK-internal one in production). */
function makeClient(): QueryClient {
  return new QueryClient();
}

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

describe('ContactsDomain reads (Query<T>)', () => {
  test('list() returns a Query that resolves to the user contacts', async () => {
    const getAll = mock(async () => [contact]);
    const repo = { getAll } as unknown as ContactRepository;
    const domain = new ContactsDomainImpl(makeClient(), repo, session);

    const query = domain.list();
    expect(typeof query.subscribe).toBe('function');
    expect(typeof query.getSnapshot).toBe('function');
    expect(await query.toPromise()).toEqual([contact]);
    expect(getAll).toHaveBeenCalledWith('u1');
    // Memoised: same stable ref.
    expect(domain.list()).toBe(query);
  });

  test('get(id) returns a Query resolving to the contact', async () => {
    const repo = {
      get: mock(async () => contact),
    } as unknown as ContactRepository;
    const domain = new ContactsDomainImpl(makeClient(), repo, session);

    const query = domain.get('c1');
    expect(typeof query.getSnapshot).toBe('function');
    expect(await query.toPromise()).toBe(contact);
    expect(domain.get('c1')).toBe(query);
  });

  test('get returns null (instead of throwing) when the repository read fails', async () => {
    const repo = {
      get: mock(async () => {
        throw new Error('not found');
      }),
    } as unknown as ContactRepository;
    const domain = new ContactsDomainImpl(makeClient(), repo, session);

    expect(await domain.get('missing').toPromise()).toBeNull();
  });
});

describe('ContactsDomain actions (Promise)', () => {
  test('add creates the contact owned by the current user (params, not full object)', async () => {
    const create = mock(async () => contact);
    const repo = { create } as unknown as ContactRepository;
    const domain = new ContactsDomainImpl(makeClient(), repo, session);

    const result = await domain.add({ username: 'alice' });

    expect(create).toHaveBeenCalledWith({ ownerId: 'u1', username: 'alice' });
    expect(result).toBe(contact);
  });

  test('remove takes the FULL contact and deletes by id', async () => {
    const del = mock(async () => undefined);
    const repo = { delete: del } as unknown as ContactRepository;
    const domain = new ContactsDomainImpl(makeClient(), repo, session);

    await domain.remove(contact);

    expect(del).toHaveBeenCalledWith('c1');
  });

  test('search (one-shot Promise) forwards the query + current user to findContactCandidates', async () => {
    const candidates = [{ id: 'p1', username: 'ali' }];
    const findContactCandidates = mock(async () => candidates);
    const repo = { findContactCandidates } as unknown as ContactRepository;
    const domain = new ContactsDomainImpl(makeClient(), repo, session);

    const result = await domain.search({ query: 'ali' });

    expect(findContactCandidates).toHaveBeenCalledWith('ali', 'u1');
    expect(result).toBe(candidates);
  });
});
