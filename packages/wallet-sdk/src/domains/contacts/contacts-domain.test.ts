import { describe, expect, it, mock } from 'bun:test';
import type { Contact } from '../../types/contact';
import { SdkEventEmitter } from '../../internal/event-emitter';
import type { SdkEventMap } from '../../events';
import { inMemoryStorage, jwtWith } from '../../internal/test-support';
import type { DomainContext } from '../context';
import { createContactsDomain } from './contacts-domain';

const contact = (over: Partial<Contact> = {}): Contact => ({
  id: 'c1',
  ownerId: 'u1',
  username: 'alice',
  lud16: 'alice@agi.cash',
  createdAt: new Date('2024-01-01T00:00:00Z'),
  ...over,
});

function setup(repo: Record<string, unknown>) {
  // Fake repo injected directly — no mock.module needed.
  const emitter = new SdkEventEmitter<SdkEventMap>();
  const created: Contact[] = [];
  const deleted: string[] = [];
  emitter.on('contact:created', (e) => created.push(e.contact));
  emitter.on('contact:deleted', (e) => deleted.push(e.contactId));
  const storage = inMemoryStorage({ access_token: jwtWith({ sub: 'u1' }) });
  const ctx = {
    config: { storage, lud16Domain: 'agi.cash' },
    connections: { supabase: {} },
    emitter,
  } as unknown as DomainContext;
  return { emitter, created, deleted, ctx };
}

describe('createContactsDomain', () => {
  it('add creates the contact and emits contact:created', async () => {
    const c = contact();
    const repo = { create: mock(async () => c) };
    const { created, ctx } = setup(repo);
    const domain = createContactsDomain(ctx, repo as never);

    const result = await domain.add({ username: 'alice' });
    expect(repo.create).toHaveBeenCalledWith({
      ownerId: 'u1',
      username: 'alice',
    });
    expect(result).toBe(c);
    expect(created).toEqual([c]);
  });

  it('remove deletes and emits contact:deleted with only the id', async () => {
    const repo = { delete: mock(async () => undefined) };
    const { deleted, ctx } = setup(repo);
    const domain = createContactsDomain(ctx, repo as never);

    await domain.remove(contact({ id: 'c9' }));
    expect(repo.delete).toHaveBeenCalledWith('c9');
    expect(deleted).toEqual(['c9']);
  });

  it('search delegates to findContactCandidates with the resolved user id', async () => {
    const repo = {
      findContactCandidates: mock(async () => [
        { id: 'u2', username: 'carol', lud16: 'carol@agi.cash' },
      ]),
    };
    const { ctx } = setup(repo);
    const domain = createContactsDomain(ctx, repo as never);

    const profiles = await domain.search({ query: 'car' });
    expect(repo.findContactCandidates).toHaveBeenCalledWith('car', 'u1');
    expect(profiles[0]?.lud16).toBe('carol@agi.cash');
  });

  it('list resolves the user id; get delegates by id', async () => {
    const repo = {
      getAll: mock(async () => [contact()]),
      get: mock(async () => null),
    };
    const { ctx } = setup(repo);
    const domain = createContactsDomain(ctx, repo as never);

    await domain.list();
    expect(repo.getAll).toHaveBeenCalledWith('u1');
    expect(await domain.get('x')).toBeNull();
  });
});
