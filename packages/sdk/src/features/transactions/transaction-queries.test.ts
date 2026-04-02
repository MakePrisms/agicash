import { expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/query-core';
import { NotFoundError } from '../shared/error';
import {
  TransactionsCache,
  transactionQuery,
  transactionsListQuery,
  unacknowledgedTransactionsCountQuery,
} from './transaction-queries';

test('transactionQuery throws NotFoundError when the transaction is missing', async () => {
  const queryClient = new QueryClient();

  try {
    await queryClient.fetchQuery(
      transactionQuery({
        transactionId: 'tx-1',
        transactionRepository: {
          get: async () => null,
        } as never,
      }),
    );
    throw new Error('Expected query to throw');
  } catch (error) {
    expect(error).toBeInstanceOf(NotFoundError);
  }
});

test('transactionsListQuery writes fetched transactions into the cache', async () => {
  const queryClient = new QueryClient();
  const transactionsCache = new TransactionsCache(queryClient);

  const result = await queryClient.fetchInfiniteQuery(
    transactionsListQuery({
      transactionRepository: {
        list: async () => ({
          nextCursor: {
            createdAt: '2026-04-01T00:00:00.000Z',
            id: 'tx-1',
            stateSortOrder: 1,
          },
          transactions: [
            {
              acknowledgmentStatus: null,
              id: 'tx-1',
              version: 1,
            },
          ],
        }),
      } as never,
      transactionsCache,
      userId: 'user-1',
    }),
  );

  expect(
    result.pages[0]?.transactions.map((transaction) => transaction.id),
  ).toEqual(['tx-1']);
  expect(queryClient.getQueryData(['transactions', 'tx-1'])).toMatchObject({
    id: 'tx-1',
    version: 1,
  });
});

test('unacknowledgedTransactionsCountQuery returns the pending acknowledgment count', async () => {
  const queryClient = new QueryClient();

  const count = await queryClient.fetchQuery(
    unacknowledgedTransactionsCountQuery({
      transactionRepository: {
        countTransactionsPendingAck: async () => 3,
      } as never,
      userId: 'user-1',
    }),
  );

  expect(count).toBe(3);
});
