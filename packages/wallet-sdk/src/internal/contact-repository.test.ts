import { describe, expect, mock, test } from 'bun:test';
import { ContactRepository } from './contact-repository';
import type { AgicashDbContact } from './db-contact';
import type { WalletSupabaseClient } from './supabase-client';

// -- Fakes ----------------------------------------------------------------------------------

/** Terminal result shape every builder call resolves to. */
type Result = { data: unknown; error: unknown };

/**
 * A fake Supabase client. The fluent `from(...).select/eq/limit/order/insert/delete/...` chain is
 * a no-op thenable that resolves to `fromResult`; the terminal `single()` resolves to it too. The
 * `rpc(name, args)` records its call and resolves to `rpcResult`. Only the methods the contact
 * repository touches are implemented.
 */
function fakeDb(
  fromResult: Result,
  rpcResult: Result = { data: [], error: null },
) {
  const rpcCalls: Array<{ fn: string; args: unknown }> = [];
  const chain: Record<string, unknown> & PromiseLike<Result> = {
    select: () => chain,
    insert: () => chain,
    delete: () => chain,
    eq: () => chain,
    limit: () => chain,
    order: () => chain,
    abortSignal: () => chain,
    single: async () => fromResult,
    // biome-ignore lint/suspicious/noThenProperty: intentionally mocking the thenable Supabase query builder.
    then: (onFulfilled, onRejected) =>
      Promise.resolve(fromResult).then(onFulfilled, onRejected),
  };
  const rpcChain: Record<string, unknown> & PromiseLike<Result> = {
    abortSignal: () => rpcChain,
    // biome-ignore lint/suspicious/noThenProperty: intentionally mocking the thenable Supabase rpc builder.
    then: (onFulfilled, onRejected) =>
      Promise.resolve(rpcResult).then(onFulfilled, onRejected),
  };
  const db = {
    from: () => chain,
    rpc: mock((fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return rpcChain;
    }),
  } as unknown as WalletSupabaseClient;
  return { db, rpcCalls };
}

const row: AgicashDbContact = {
  id: 'c1',
  created_at: '2026-02-02T00:00:00.000Z',
  owner_id: 'u1',
  username: 'alice',
};

// -- toContact / CONTACT DRIFT ----------------------------------------------------------------

describe('ContactRepository.toContact (CONTACT DRIFT — master shape)', () => {
  test('createdAt is the ISO string off the row + lud16 is computed `${username}@${domain}`', () => {
    const contact = ContactRepository.toContact(row, 'agicash.me');

    expect(contact).toEqual({
      id: 'c1',
      createdAt: '2026-02-02T00:00:00.000Z', // string, NOT a Date
      ownerId: 'u1',
      username: 'alice',
      lud16: 'alice@agicash.me', // computed at runtime, not stored
    });
    // createdAt must be a string per the master-verbatim reconciliation.
    expect(typeof contact.createdAt).toBe('string');
  });

  test('a null username coalesces to an empty username', () => {
    const contact = ContactRepository.toContact(
      { ...row, username: null },
      'agicash.me',
    );
    expect(contact.username).toBe('');
  });
});

// -- getAll / lud16 over a list ---------------------------------------------------------------

describe('ContactRepository.getAll', () => {
  test('maps each row to a domain contact with a computed lud16', async () => {
    const rows: AgicashDbContact[] = [
      row,
      {
        id: 'c2',
        created_at: '2026-02-03T00:00:00.000Z',
        owner_id: 'u1',
        username: 'bob',
      },
    ];
    const { db } = fakeDb({ data: rows, error: null });
    const repo = new ContactRepository(db, 'agicash.me');

    const contacts = await repo.getAll('u1');

    expect(contacts.map((c) => c.lud16)).toEqual([
      'alice@agicash.me',
      'bob@agicash.me',
    ]);
  });
});

// -- search (findContactCandidates) -----------------------------------------------------------

describe('ContactRepository.findContactCandidates (search)', () => {
  test('returns [] WITHOUT hitting the RPC for a query under 3 chars (incl. after trim)', async () => {
    const { db, rpcCalls } = fakeDb({ data: null, error: null });
    const repo = new ContactRepository(db, 'agicash.me');

    expect(await repo.findContactCandidates('ab', 'u1')).toEqual([]);
    expect(await repo.findContactCandidates('  a ', 'u1')).toEqual([]);
    // The min-3 guard short-circuits before the RPC.
    expect(rpcCalls).toHaveLength(0);
  });

  test('calls find_contact_candidates with the TRIMMED query + current user (server excludes existing)', async () => {
    const candidates = [
      { id: 'p1', username: 'alice' },
      { id: 'p2', username: 'alistair' },
    ];
    const { db, rpcCalls } = fakeDb(
      { data: null, error: null },
      { data: candidates, error: null },
    );
    const repo = new ContactRepository(db, 'agicash.me');

    const result = await repo.findContactCandidates('  ali  ', 'u1');

    // The RPC (which excludes the user's existing contacts) is called with the trimmed query.
    expect(rpcCalls).toEqual([
      {
        fn: 'find_contact_candidates',
        args: { partial_username: 'ali', current_user_id: 'u1' },
      },
    ]);
    // Returns the (already-excluded) candidates verbatim — UserProfiles carry NO lud16.
    expect(result).toEqual(candidates);
    expect(result[0]).not.toHaveProperty('lud16');
  });

  test('throws when the search RPC errors', async () => {
    const { db } = fakeDb(
      { data: null, error: null },
      { data: null, error: { message: 'boom' } },
    );
    const repo = new ContactRepository(db, 'agicash.me');

    await expect(repo.findContactCandidates('alice', 'u1')).rejects.toThrow(
      'Failed to search users',
    );
  });
});
