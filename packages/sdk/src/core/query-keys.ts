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

export const unresolvedCashuSendQuotesQueryKey = () =>
  ['unresolved-cashu-send-quotes'] as const;

export const sparkReceiveQuoteQueryKey = (quoteId?: string) =>
  ['spark-receive-quote', quoteId] as const;

export const pendingSparkReceiveQuotesQueryKey = () =>
  ['pending-spark-receive-quotes'] as const;

export const unresolvedSparkSendQuotesQueryKey = () =>
  ['unresolved-spark-send-quotes'] as const;

export const sparkBalanceQueryKey = (accountId: string) =>
  ['spark-balance', accountId] as const;

export const mintQuoteQueryKey = (mintQuoteId: string) =>
  ['mint-quote', mintQuoteId] as const;
