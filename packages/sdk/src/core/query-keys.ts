export const accountsQueryKey = () => ['accounts'] as const;

export const cashuReceiveQuoteQueryKey = (quoteId?: string) =>
  ['cashu-receive-quote', quoteId] as const;

export const pendingCashuReceiveQuotesQueryKey = () =>
  ['pending-cashu-receive-quotes'] as const;

export const transactionQueryKey = (transactionId: string) =>
  ['transactions', transactionId] as const;

export const allTransactionsQueryKey = (accountId?: string) =>
  ['all-transactions', accountId] as const;

export const unacknowledgedTransactionsCountQueryKey = () =>
  ['unacknowledged-transactions-count'] as const;

export const pendingCashuReceiveSwapsQueryKey = () =>
  ['pending-cashu-receive-swaps'] as const;

export const mintQuoteQueryKey = (mintQuoteId: string) =>
  ['mint-quote', mintQuoteId] as const;
