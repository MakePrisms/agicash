import { describe, expect, it, mock } from 'bun:test';
import { createStatelessAccounts } from './accounts-surface';

const acct = (id: string, currency = 'BTC', createdAt = '2024-01-01') =>
  ({ id, currency, createdAt, isOnline: true, type: 'cashu' }) as any;

/** Fake ResidentAccounts: a no-op `ensureLoaded` plus a fixed `all()`. */
const residents = (all: () => any[]) =>
  ({ ensureLoaded: mock(async () => {}), all }) as any;

describe('createStatelessAccounts', () => {
  it('list() returns the resident accounts', async () => {
    const accounts = residents(() => [acct('a'), acct('b')]);
    const a = createStatelessAccounts({
      base: {} as any,
      accounts,
      getUser: async () => ({ id: 'u1', defaultCurrency: 'BTC' }) as any,
    });
    expect((await a.list()).map((x: any) => x.id)).toEqual(['a', 'b']);
  });

  it('list() ensureLoads the resident map (with the user id) before reading it', async () => {
    const order: string[] = [];
    const accounts = {
      ensureLoaded: mock(async (id: string) => {
        order.push(`ensureLoaded:${id}`);
      }),
      all: mock(() => {
        order.push('all');
        return [acct('a')];
      }),
    } as any;
    const a = createStatelessAccounts({
      base: {} as any,
      accounts,
      getUser: async () => ({ id: 'u1', defaultCurrency: 'BTC' }) as any,
    });
    const result = await a.list();
    expect(result.map((x: any) => x.id)).toEqual(['a']);
    expect(accounts.ensureLoaded).toHaveBeenCalledWith('u1');
    // ensureLoaded MUST run before all() — otherwise the first wallet render
    // reads an empty resident map and useDefaultAccount throws.
    expect(order).toEqual(['ensureLoaded:u1', 'all']);
  });

  it('getDefault falls back to the first account of the currency when the base throws', async () => {
    const base = {
      getDefault: mock(async () => {
        throw new Error('No default account found for currency BTC');
      }),
    } as any;
    const accounts = residents(() => [
      acct('z', 'USD'),
      acct('a', 'BTC', '2023-01-01'),
      acct('b', 'BTC', '2024-06-01'),
    ]);
    const a = createStatelessAccounts({
      base,
      accounts,
      getUser: async () => ({ id: 'u1', defaultCurrency: 'BTC' }) as any,
    });
    const result = await a.getDefault('BTC');
    expect(result.id).toBe('a'); // earliest-created BTC account
    expect(accounts.ensureLoaded).toHaveBeenCalledWith('u1');
  });

  it('getDefault returns the base result when present (no fallback)', async () => {
    const base = { getDefault: mock(async () => acct('def', 'BTC')) } as any;
    const a = createStatelessAccounts({
      base,
      accounts: residents(() => []),
      getUser: async () => ({ id: 'u1', defaultCurrency: 'BTC' }) as any,
    });
    expect((await a.getDefault('BTC')).id).toBe('def');
  });

  it('getDefault uses user.defaultCurrency when no currency is given', async () => {
    const base = {
      getDefault: mock(async () => {
        throw new Error('none');
      }),
    } as any;
    const accounts = residents(() => [acct('u', 'USD')]);
    const a = createStatelessAccounts({
      base,
      accounts,
      getUser: async () => ({ id: 'u1', defaultCurrency: 'USD' }) as any,
    });
    expect((await a.getDefault()).id).toBe('u');
  });
});
