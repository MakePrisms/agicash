import { describe, expect, it, spyOn } from 'bun:test';
import type { AgicashDb } from '@agicash/db-types';
import { QueryClient } from '@tanstack/query-core';
import type { Encryption } from '../encryption';
import { createTransactionsApi } from './transactions-api';
import { TransactionsCache } from './transactions-cache';

const makeApi = (queryClient: QueryClient) =>
  createTransactionsApi({
    queryClient,
    db: {} as AgicashDb,
    encryption: {} as Encryption,
    getCurrentUserId: () => {
      throw new Error('not expected to be called');
    },
  }).api;

describe('transactions-api invalidate', () => {
  it('invalidates the single-transaction query for the given id', () => {
    const queryClient = new QueryClient();
    const invalidate = spyOn(
      queryClient,
      'invalidateQueries',
    ).mockResolvedValue(undefined);

    makeApi(queryClient).invalidate('tx-1');

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [TransactionsCache.Key, 'tx-1'],
    });
  });
});
