import { describe, expect, it, mock } from 'bun:test';
import { createStatelessAccounts } from './accounts-surface';

const acct = (id: string, currency = 'BTC', createdAt = '2024-01-01') =>
  ({ id, currency, createdAt, isOnline: true, type: 'cashu' }) as any;

describe('createStatelessAccounts', () => {
  it('list() returns the resident accounts', async () => {
    const accounts = { all: () => [acct('a'), acct('b')] } as any;
    const a = createStatelessAccounts({
      base: {} as any,
      accounts,
      getUser: async () => ({ defaultCurrency: 'BTC' }) as any,
    });
    expect((await a.list()).map((x: any) => x.id)).toEqual(['a', 'b']);
  });

  it('getDefault falls back to the first account of the currency when the base throws', async () => {
    const base = {
      getDefault: mock(async () => {
        throw new Error('No default account found for currency BTC');
      }),
    } as any;
    const accounts = {
      all: () => [
        acct('z', 'USD'),
        acct('a', 'BTC', '2023-01-01'),
        acct('b', 'BTC', '2024-06-01'),
      ],
    } as any;
    const a = createStatelessAccounts({
      base,
      accounts,
      getUser: async () => ({ defaultCurrency: 'BTC' }) as any,
    });
    const result = await a.getDefault('BTC');
    expect(result.id).toBe('a'); // earliest-created BTC account
  });

  it('getDefault returns the base result when present (no fallback)', async () => {
    const base = { getDefault: mock(async () => acct('def', 'BTC')) } as any;
    const a = createStatelessAccounts({
      base,
      accounts: { all: () => [] } as any,
      getUser: async () => ({ defaultCurrency: 'BTC' }) as any,
    });
    expect((await a.getDefault('BTC')).id).toBe('def');
  });

  it('getDefault uses user.defaultCurrency when no currency is given', async () => {
    const base = {
      getDefault: mock(async () => {
        throw new Error('none');
      }),
    } as any;
    const accounts = { all: () => [acct('u', 'USD')] } as any;
    const a = createStatelessAccounts({
      base,
      accounts,
      getUser: async () => ({ defaultCurrency: 'USD' }) as any,
    });
    expect((await a.getDefault()).id).toBe('u');
  });
});
