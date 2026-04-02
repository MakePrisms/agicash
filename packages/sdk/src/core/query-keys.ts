export const userQueryKey = () => ['user'] as const;

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

export const cashuSendSwapQueryKey = (swapId?: string) =>
  ['cashu-send-swap', swapId] as const;

export const unresolvedCashuSendSwapsQueryKey = () =>
  ['unresolved-cashu-send-swaps'] as const;

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

// Derivation query keys — used by web app's React layer for
// accessing derived key material as query data.
export const cashuSeedQueryKey = () => ['cashu-seed'] as const;

export const cashuXpubQueryKey = (derivationPath?: string) =>
  ['cashu-xpub', derivationPath] as const;

export const sparkMnemonicQueryKey = () => ['spark-mnemonic'] as const;

export const sparkWalletQueryKey = (mnemonicHash: string, network: string) =>
  ['spark-wallet', mnemonicHash, network] as const;

export const sparkIdentityPublicKeyQueryKey = () =>
  ['spark-identity-public-key'] as const;

export const encryptionPrivateKeyQueryKey = () =>
  ['encryption-private-key'] as const;

export const encryptionPublicKeyQueryKey = () =>
  ['encryption-public-key'] as const;
