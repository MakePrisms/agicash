import { describe, expect, it } from 'bun:test';
import { QueryClient } from '@tanstack/query-core';
import type { Transaction } from './transaction';
import { TransactionsCache } from './transactions-cache';

const tx = (id: string, version: number, status = 'pending') =>
  ({ id, version, acknowledgmentStatus: status }) as unknown as Transaction;

const read = (queryClient: QueryClient, id: string) =>
  queryClient.getQueryData<Transaction>([TransactionsCache.Key, id]);

describe('TransactionsCache.upsert (version guard)', () => {
  it('inserts when the transaction is not cached', () => {
    const queryClient = new QueryClient();
    const cache = new TransactionsCache(queryClient);
    cache.upsert(tx('a', 1));
    expect(read(queryClient, 'a')?.version).toBe(1);
  });

  it('ignores an older or equal version', () => {
    const queryClient = new QueryClient();
    const cache = new TransactionsCache(queryClient);
    cache.upsert(tx('a', 2));
    cache.upsert(tx('a', 1));
    cache.upsert(tx('a', 2));
    expect(read(queryClient, 'a')?.version).toBe(2);
  });

  it('applies a newer version', () => {
    const queryClient = new QueryClient();
    const cache = new TransactionsCache(queryClient);
    cache.upsert(tx('a', 1));
    cache.upsert(tx('a', 3));
    expect(read(queryClient, 'a')?.version).toBe(3);
  });
});

describe('TransactionsCache.acknowledgeInHistory', () => {
  it('acknowledges the transaction in every history page, only when pending', () => {
    const queryClient = new QueryClient();
    const cache = new TransactionsCache(queryClient);
    queryClient.setQueryData(
      [TransactionsCache.AllTransactionsKey, undefined],
      {
        pages: [
          { transactions: [tx('a', 1), tx('b', 1)], nextCursor: null },
          { transactions: [tx('a', 1, 'acknowledged')], nextCursor: null },
        ],
        pageParams: [null, null],
      },
    );

    cache.acknowledgeInHistory(tx('a', 1));

    const data = queryClient.getQueryData<{
      pages: { transactions: Transaction[] }[];
    }>([TransactionsCache.AllTransactionsKey, undefined]);
    expect(data?.pages[0].transactions[0].acknowledgmentStatus).toBe(
      'acknowledged',
    );
    expect(data?.pages[0].transactions[1].acknowledgmentStatus).toBe('pending');
    expect(data?.pages[1].transactions[0].acknowledgmentStatus).toBe(
      'acknowledged',
    );
  });
});
