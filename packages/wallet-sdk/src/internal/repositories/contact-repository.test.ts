import { describe, expect, it } from 'bun:test';
import { DomainError } from '../../errors';
import { makeFakeDb } from '../test-support';
import { ContactRepository } from './contact-repository';

const DOMAIN = 'agi.cash';
const dbContact = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  owner_id: 'u1',
  username: 'alice',
  created_at: '2024-01-01T00:00:00Z',
  ...over,
});

describe('ContactRepository', () => {
  it('toContact derives lud16 + Date createdAt; coalesces a null username', () => {
    const ok = ContactRepository.toContact(dbContact() as never, DOMAIN);
    expect(ok.lud16).toBe('alice@agi.cash');
    expect(ok.createdAt).toBeInstanceOf(Date);

    const nullName = ContactRepository.toContact(
      dbContact({ username: null }) as never,
      DOMAIN,
    );
    expect(nullName.username).toBe('');
    expect(nullName.lud16).toBe('@agi.cash'); // master bug fixed (not 'null@agi.cash')
  });

  it('get returns null when absent', async () => {
    const repo = new ContactRepository(
      makeFakeDb({ selectResult: { data: null, error: null } }),
      DOMAIN,
    );
    expect(await repo.get('missing')).toBeNull();
  });

  it('getAll maps rows to contacts', async () => {
    const repo = new ContactRepository(
      makeFakeDb({ selectResult: { data: [dbContact()], error: null } }),
      DOMAIN,
    );
    const all = await repo.getAll('u1');
    expect(all).toHaveLength(1);
    expect(all[0]?.lud16).toBe('alice@agi.cash');
  });

  it('create maps the LIMIT_REACHED hint to a DomainError', async () => {
    const repo = new ContactRepository(
      makeFakeDb({
        selectResult: {
          data: null,
          error: {
            hint: 'LIMIT_REACHED',
            message: 'Too many',
            details: 'max 150',
          },
        },
      }),
      DOMAIN,
    );
    await expect(
      repo.create({ ownerId: 'u1', username: 'bob' }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('create returns the created contact on success', async () => {
    const repo = new ContactRepository(
      makeFakeDb({
        selectResult: { data: dbContact({ username: 'bob' }), error: null },
      }),
      DOMAIN,
    );
    const created = await repo.create({ ownerId: 'u1', username: 'bob' });
    expect(created.username).toBe('bob');
  });

  it('findContactCandidates short-circuits to [] for queries under 3 chars', async () => {
    const repo = new ContactRepository(makeFakeDb({}), DOMAIN);
    expect(await repo.findContactCandidates('ab', 'u1')).toEqual([]);
  });

  it('findContactCandidates maps RPC rows to UserProfile with lud16', async () => {
    const repo = new ContactRepository(
      makeFakeDb({
        rpcResult: { data: [{ id: 'u2', username: 'carol' }], error: null },
      }),
      DOMAIN,
    );
    const profiles = await repo.findContactCandidates('car', 'u1');
    expect(profiles).toEqual([
      { id: 'u2', username: 'carol', lud16: 'carol@agi.cash' },
    ]);
  });
});
