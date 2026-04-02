import { expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/query-core';
import { listAccountsQuery } from '../accounts/account-queries';
import {
  PendingCashuReceiveQuotesCache,
  pendingCashuReceiveQuotesQuery,
} from './cashu-receive-queries';

test('pendingCashuReceiveQuotesQuery filters out offline accounts', async () => {
  const queryClient = new QueryClient();
  const accountRepository = {
    getAll: async () =>
      [
        { id: 'online-account', isOnline: true },
        { id: 'offline-account', isOnline: false },
      ] as never,
  };
  const cashuReceiveQuoteRepository = {
    getPending: async () =>
      [
        { accountId: 'online-account', id: 'quote-online' },
        { accountId: 'offline-account', id: 'quote-offline' },
      ] as never,
  };

  const result = await queryClient.fetchQuery(
    pendingCashuReceiveQuotesQuery({
      cashuReceiveQuoteRepository: cashuReceiveQuoteRepository as never,
      getListAccountsQuery: () =>
        listAccountsQuery({
          accountRepository: accountRepository as never,
          userId: 'user-1',
        }),
      queryClient,
      userId: 'user-1',
    }),
  );

  expect(result.map((quote) => quote.id)).toEqual(['quote-online']);
});

test('PendingCashuReceiveQuotesCache only updates when the version increases', () => {
  const queryClient = new QueryClient();
  const cache = new PendingCashuReceiveQuotesCache(queryClient);

  cache.add({
    accountId: 'account-1',
    id: 'quote-1',
    version: 1,
  } as never);
  cache.update({
    accountId: 'account-1',
    id: 'quote-1',
    version: 0,
  } as never);
  cache.update({
    accountId: 'account-1',
    id: 'quote-1',
    version: 2,
  } as never);

  expect(cache.get('quote-1')).toMatchObject({
    accountId: 'account-1',
    id: 'quote-1',
    version: 2,
  });
});
