import { describe, expect, it } from 'bun:test';
import { Money } from '@agicash/utils/money';
import { QueryClient } from '@tanstack/query-core';
import type { Account, CashuAccount, SparkAccount } from './account';
import type { AccountRepository } from './account-repository';
import { AccountsCache, accountsQueryOptions } from './accounts-cache';

// Minimal fixtures — these tests exercise only the fields the cache guards
// touch (id / version / type / currency / balance).
const sats = (n: number) =>
  new Money({ amount: n, currency: 'BTC', unit: 'sat' }) as Money;
const cashu = (id: string, version: number): Account =>
  ({ id, version, type: 'cashu', currency: 'BTC' }) as unknown as CashuAccount;
const spark = (id: string, version: number, balance?: Money): Account =>
  ({
    id,
    version,
    type: 'spark',
    currency: 'BTC',
    balance,
  }) as unknown as SparkAccount;

function seeded(accounts: Account[]) {
  const queryClient = new QueryClient();
  queryClient.setQueryData([AccountsCache.Key], accounts);
  return { queryClient, cache: new AccountsCache(queryClient) };
}
const read = (qc: QueryClient) =>
  qc.getQueryData<Account[]>([AccountsCache.Key]) ?? [];

describe('AccountsCache.upsert (version-guard)', () => {
  it('ignores an upsert with an older version', () => {
    const { queryClient, cache } = seeded([cashu('a', 2)]);
    cache.upsert(cashu('a', 1));
    expect(read(queryClient).find((x) => x.id === 'a')?.version).toBe(2);
  });

  it('applies an upsert with a newer version', () => {
    const { queryClient, cache } = seeded([cashu('a', 2)]);
    cache.upsert(cashu('a', 3));
    expect(read(queryClient).find((x) => x.id === 'a')?.version).toBe(3);
  });

  it('does not replace on an equal version', () => {
    const { queryClient, cache } = seeded([cashu('a', 2)]);
    const before = read(queryClient)[0];
    cache.upsert(cashu('a', 2));
    expect(read(queryClient)[0]).toBe(before);
  });

  it('appends a new account id', () => {
    const { queryClient, cache } = seeded([cashu('a', 1)]);
    cache.upsert(cashu('b', 1));
    expect(read(queryClient).map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('AccountsCache.updateSparkAccountBalance (write-guard)', () => {
  it('keeps the same account reference when the balance is unchanged', () => {
    const { queryClient, cache } = seeded([spark('s', 1, sats(100))]);
    const before = read(queryClient)[0];
    cache.updateSparkAccountBalance({ accountId: 's', balance: sats(100) });
    expect(read(queryClient)[0]).toBe(before);
  });

  it('writes a new account object when the balance changes', () => {
    const { queryClient, cache } = seeded([spark('s', 1, sats(100))]);
    cache.updateSparkAccountBalance({ accountId: 's', balance: sats(200) });
    expect(
      (read(queryClient)[0] as SparkAccount).balance?.toNumber('sat'),
    ).toBe(200);
  });
});

describe('accountsQueryOptions (structuralSharing)', () => {
  const { structuralSharing } = accountsQueryOptions({
    userId: 'u',
    accountRepository: {} as AccountRepository,
  });

  it('returns newData when there is no oldData', () => {
    const next = [cashu('a', 1)];
    expect(structuralSharing(undefined, next)).toBe(next);
  });

  it('preserves old accounts the new fetch did not return, new wins on collision', () => {
    const result = structuralSharing(
      [cashu('a', 1), cashu('expired', 1)],
      [cashu('a', 2)],
    );
    expect(result.map((x) => x.id)).toEqual(['a', 'expired']);
    expect(result.find((x) => x.id === 'a')?.version).toBe(2);
  });
});
