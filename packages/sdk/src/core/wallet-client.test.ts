import { expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/query-core';
import { createWalletClient } from './wallet-client';

const keyProvider = {
  getPrivateKeyBytes: async () => ({
    private_key: '11'.repeat(32),
  }),
  getPublicKey: async () => ({
    public_key: '02'.repeat(33),
  }),
  getMnemonic: async () => ({
    mnemonic:
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  }),
};

test('createWalletClient reuses the provided query client', () => {
  const queryClient = new QueryClient();
  const wallet = createWalletClient({
    db: {} as never,
    keyProvider,
    queryClient,
    userId: 'user-1',
  });

  expect(wallet.queryClient).toBe(queryClient);
  expect(wallet.queries.listAccountsQuery().queryKey).toEqual(['accounts']);
  expect(wallet.queries.pendingCashuReceiveQuotesQuery().queryKey).toEqual([
    'pending-cashu-receive-quotes',
  ]);
  expect(wallet.queries.cashuReceiveQuoteQuery('quote-1').queryKey).toEqual([
    'cashu-receive-quote',
    'quote-1',
  ]);
  expect(wallet.queries.transactionQuery('tx-1').queryKey).toEqual([
    'transactions',
    'tx-1',
  ]);
  expect(wallet.queries.transactionsListQuery().queryKey).toEqual([
    'all-transactions',
    undefined,
  ]);
  expect(
    wallet.queries.unacknowledgedTransactionsCountQuery().queryKey,
  ).toEqual(['unacknowledged-transactions-count']);
  expect(wallet.taskProcessors.cashuReceiveQuote).toBeDefined();
});
