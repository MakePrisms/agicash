import { describe, expect, it, mock } from 'bun:test';
import type { Account } from '../domains/account-types';
import type { Store } from '../internal/engine';
import { createStoreAccounts } from './accounts-surface';

const acct = (id: string, currency = 'BTC', createdAt = '2024-01-01') =>
  ({ id, currency, createdAt, isOnline: true, type: 'cashu' }) as Account;

/** Fake accounts Store: a fixed `toPromise()` resolving to `all`. */
const accountsStore = (all: Account[]): Store<Account[]> =>
  ({
    get: () => all,
    subscribe: () => () => {},
    toPromise: mock(async () => all),
    set: () => {},
  }) as unknown as Store<Account[]>;

describe('createStoreAccounts', () => {
  it('exposes the accounts store as `all`', () => {
    const store = accountsStore([acct('a')]);
    const a = createStoreAccounts({
      base: {} as never,
      accountsStore: store,
      getUser: async () => ({ id: 'u1', defaultCurrency: 'BTC' }) as never,
    });
    expect(a.all).toBe(store);
  });

  it('list() returns the accounts from the store', async () => {
    const a = createStoreAccounts({
      base: {} as never,
      accountsStore: accountsStore([acct('a'), acct('b')]),
      getUser: async () => ({ id: 'u1', defaultCurrency: 'BTC' }) as never,
    });
    expect((await a.list()).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('getDefault falls back to the first account of the currency when the base throws', async () => {
    const base = {
      getDefault: mock(async () => {
        throw new Error('No default account found for currency BTC');
      }),
    } as never;
    const store = accountsStore([
      acct('z', 'USD'),
      acct('a', 'BTC', '2023-01-01'),
      acct('b', 'BTC', '2024-06-01'),
    ]);
    const a = createStoreAccounts({
      base,
      accountsStore: store,
      getUser: async () => ({ id: 'u1', defaultCurrency: 'BTC' }) as never,
    });
    const result = await a.getDefault('BTC');
    expect(result.id).toBe('a'); // earliest-created BTC account
  });

  it('getDefault returns the base result when present (no fallback)', async () => {
    const base = { getDefault: mock(async () => acct('def', 'BTC')) } as never;
    const a = createStoreAccounts({
      base,
      accountsStore: accountsStore([]),
      getUser: async () => ({ id: 'u1', defaultCurrency: 'BTC' }) as never,
    });
    expect((await a.getDefault('BTC')).id).toBe('def');
  });

  it('getDefault uses user.defaultCurrency when no currency is given', async () => {
    const base = {
      getDefault: mock(async () => {
        throw new Error('none');
      }),
    } as never;
    const store = accountsStore([acct('u', 'USD')]);
    const a = createStoreAccounts({
      base,
      accountsStore: store,
      getUser: async () => ({ id: 'u1', defaultCurrency: 'USD' }) as never,
    });
    expect((await a.getDefault()).id).toBe('u');
  });

  it('getDefault re-throws the original error when no fallback candidate exists', async () => {
    const original = new Error('No default account found for currency BTC');
    const base = {
      getDefault: mock(async () => {
        throw original;
      }),
    } as never;
    const a = createStoreAccounts({
      base,
      accountsStore: accountsStore([acct('z', 'USD')]),
      getUser: async () => ({ id: 'u1', defaultCurrency: 'BTC' }) as never,
    });
    await expect(a.getDefault('BTC')).rejects.toBe(original);
  });

  it('delegates other AccountsDomain methods to the base', async () => {
    const base = { get: mock(async (id: string) => acct(id)) } as never;
    const a = createStoreAccounts({
      base,
      accountsStore: accountsStore([]),
      getUser: async () => null,
    });
    expect((await a.get('xyz'))?.id).toBe('xyz');
  });
});
