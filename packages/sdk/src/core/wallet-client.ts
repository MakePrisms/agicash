import { hexToBytes } from '@noble/hashes/utils';
import { mnemonicToSeedSync } from '@scure/bip39';
import { QueryClient } from '@tanstack/query-core';
import type { AgicashDb } from '../db/database';
import { getSeedPhraseDerivationPath } from '../features/accounts/account-cryptography';
import {
  AccountsCache,
  listAccountsQuery,
} from '../features/accounts/account-queries';
import { AccountRepository } from '../features/accounts/account-repository';
import { AccountService } from '../features/accounts/account-service';
import {
  CashuReceiveQuoteCache,
  PendingCashuReceiveQuotesCache,
  cashuReceiveQuoteQuery,
  pendingCashuReceiveQuotesQuery,
} from '../features/receive/cashu-receive-queries';
import { CashuReceiveQuoteRepository } from '../features/receive/cashu-receive-quote-repository';
import { CashuReceiveQuoteService } from '../features/receive/cashu-receive-quote-service';
import {
  PendingCashuReceiveSwapsCache,
  pendingCashuReceiveSwapsQuery,
} from '../features/receive/cashu-receive-swap-queries';
import { CashuReceiveSwapRepository } from '../features/receive/cashu-receive-swap-repository';
import { CashuReceiveSwapService } from '../features/receive/cashu-receive-swap-service';
import { CashuReceiveSwapTaskProcessor } from '../features/receive/cashu-receive-swap-task-processor';
import { CashuReceiveQuoteTaskProcessor } from '../features/receive/cashu-receive-task-processor';
import { CashuSendQuoteRepository } from '../features/send/cashu-send-quote-repository';
import { CashuSendQuoteService } from '../features/send/cashu-send-quote-service';
import { CashuSendSwapRepository } from '../features/send/cashu-send-swap-repository';
import { CashuSendSwapService } from '../features/send/cashu-send-swap-service';
import { getCashuCryptography } from '../features/shared/cashu';
import { type Encryption, getEncryption } from '../features/shared/encryption';
import { TransactionsCache } from '../features/transactions/transaction-queries';
import {
  transactionQuery,
  transactionsListQuery,
  unacknowledgedTransactionsCountQuery,
} from '../features/transactions/transaction-queries';
import { TransactionRepository } from '../features/transactions/transaction-repository';
import type { Cache } from '../interfaces/cache';
import type { KeyProvider } from '../interfaces/key-provider';

type CleanupConnectionsCapable = {
  cleanupConnections(): Promise<void>;
};

export type WalletClientConfig = {
  db: AgicashDb;
  keyProvider: KeyProvider;
  queryClient?: QueryClient;
  userId: string;
};

export type WalletClient = {
  caches: {
    accounts: AccountsCache;
    cashuReceiveQuote: CashuReceiveQuoteCache;
    pendingCashuReceiveQuotes: PendingCashuReceiveQuotesCache;
    pendingCashuReceiveSwaps: PendingCashuReceiveSwapsCache;
    transactions: TransactionsCache;
  };
  cleanup(): Promise<void>;
  queryClient: QueryClient;
  queries: {
    cashuReceiveQuoteQuery: (
      quoteId?: string,
    ) => ReturnType<typeof cashuReceiveQuoteQuery>;
    listAccountsQuery: () => ReturnType<typeof listAccountsQuery>;
    pendingCashuReceiveQuotesQuery: () => ReturnType<
      typeof pendingCashuReceiveQuotesQuery
    >;
    pendingCashuReceiveSwapsQuery: () => ReturnType<
      typeof pendingCashuReceiveSwapsQuery
    >;
    transactionQuery: (
      transactionId: string,
    ) => ReturnType<typeof transactionQuery>;
    transactionsListQuery: (
      accountId?: string,
    ) => ReturnType<typeof transactionsListQuery>;
    unacknowledgedTransactionsCountQuery: () => ReturnType<
      typeof unacknowledgedTransactionsCountQuery
    >;
  };
  repos: {
    accountRepo: AccountRepository;
    cashuReceiveQuoteRepo: CashuReceiveQuoteRepository;
    cashuReceiveSwapRepo: CashuReceiveSwapRepository;
    cashuSendQuoteRepo: CashuSendQuoteRepository;
    cashuSendSwapRepo: CashuSendSwapRepository;
    transactionRepo: TransactionRepository;
  };
  services: {
    accountService: AccountService;
    cashuReceiveQuoteService: CashuReceiveQuoteService;
    cashuReceiveSwapService: CashuReceiveSwapService;
    cashuSendQuoteService: CashuSendQuoteService;
    cashuSendSwapService: CashuSendSwapService;
  };
  taskProcessors: {
    cashuReceiveQuote: CashuReceiveQuoteTaskProcessor;
    cashuReceiveSwap: CashuReceiveSwapTaskProcessor;
  };
  userId: string;
};

function hasCleanupConnections(
  value: unknown,
): value is CleanupConnectionsCapable {
  return (
    typeof value === 'object' &&
    value !== null &&
    'cleanupConnections' in value &&
    typeof value.cleanupConnections === 'function'
  );
}

function queryClientAsCache(queryClient: QueryClient): Cache {
  return {
    fetchQuery: (options) => queryClient.fetchQuery(options),
    cancelQueries: (params) => queryClient.cancelQueries(params),
    invalidateQueries: (params) => queryClient.invalidateQueries(params),
    setQueryData: (queryKey, data) => {
      queryClient.setQueryData(queryKey, data);
    },
  };
}

const encryptionKeyDerivationPath = "m/10111099'/0'";

function createLazyEncryption(keyProvider: KeyProvider): Encryption {
  const encryptionPromise = Promise.all([
    keyProvider.getPrivateKeyBytes({
      private_key_derivation_path: encryptionKeyDerivationPath,
    }),
    keyProvider.getPublicKey('schnorr', {
      private_key_derivation_path: encryptionKeyDerivationPath,
    }),
  ]).then(([privateKey, publicKey]) =>
    getEncryption(hexToBytes(privateKey.private_key), publicKey.public_key),
  );

  return {
    async encrypt<T = unknown>(data: T) {
      const encryption = await encryptionPromise;
      return encryption.encrypt(data);
    },
    async decrypt<T = unknown>(data: string) {
      const encryption = await encryptionPromise;
      return encryption.decrypt<T>(data);
    },
    async encryptBatch<T extends readonly unknown[]>(data: T) {
      const encryption = await encryptionPromise;
      return encryption.encryptBatch(data);
    },
    async decryptBatch<T extends readonly unknown[]>(
      data: readonly [...{ [K in keyof T]: string }],
    ) {
      const encryption = await encryptionPromise;
      return encryption.decryptBatch<T>(data);
    },
  };
}

async function cleanupQueryClientResources(
  queryClient: QueryClient,
  ownsQueryClient: boolean,
) {
  const cleanupTasks = queryClient
    .getQueryCache()
    .getAll()
    .flatMap((query) => {
      if (!hasCleanupConnections(query.state.data)) {
        return [];
      }

      return [
        query.state.data.cleanupConnections().catch(() => {
          // Best-effort cleanup to let long-lived consumers exit promptly.
        }),
      ];
    });

  await Promise.all(cleanupTasks);

  if (ownsQueryClient) {
    queryClient.clear();
  }
}

export function createWalletClient(config: WalletClientConfig): WalletClient {
  const { db, keyProvider, userId } = config;
  const queryClient = config.queryClient ?? new QueryClient();
  const ownsQueryClient = !config.queryClient;
  const cache = queryClientAsCache(queryClient);
  const encryption = createLazyEncryption(keyProvider);
  const cashuCryptography = getCashuCryptography(keyProvider, cache);

  const cashuSeedPath = getSeedPhraseDerivationPath('cashu', 12);
  const getCashuWalletSeed = async () => {
    const { mnemonic } = await keyProvider.getMnemonic({
      seed_phrase_derivation_path: cashuSeedPath,
    });
    return mnemonicToSeedSync(mnemonic);
  };

  const sparkSeedPath = getSeedPhraseDerivationPath('spark', 12);
  const getSparkWalletMnemonic = async () => {
    const { mnemonic } = await keyProvider.getMnemonic({
      seed_phrase_derivation_path: sparkSeedPath,
    });
    return mnemonic;
  };

  const accountRepo = new AccountRepository(
    db,
    encryption,
    cache,
    getCashuWalletSeed,
    getSparkWalletMnemonic,
  );
  const repos = {
    accountRepo,
    cashuReceiveQuoteRepo: new CashuReceiveQuoteRepository(
      db,
      encryption,
      accountRepo,
    ),
    cashuReceiveSwapRepo: new CashuReceiveSwapRepository(
      db,
      encryption,
      accountRepo,
    ),
    cashuSendQuoteRepo: new CashuSendQuoteRepository(db, encryption),
    cashuSendSwapRepo: new CashuSendSwapRepository(db, encryption),
    transactionRepo: new TransactionRepository(db, encryption),
  };

  const cashuReceiveSwapService = new CashuReceiveSwapService(
    repos.cashuReceiveSwapRepo,
  );
  const services = {
    accountService: new AccountService(repos.accountRepo),
    cashuReceiveQuoteService: new CashuReceiveQuoteService(
      cashuCryptography,
      repos.cashuReceiveQuoteRepo,
    ),
    cashuReceiveSwapService,
    cashuSendQuoteService: new CashuSendQuoteService(repos.cashuSendQuoteRepo),
    cashuSendSwapService: new CashuSendSwapService(
      repos.cashuSendSwapRepo,
      cashuReceiveSwapService,
    ),
  };

  const caches = {
    accounts: new AccountsCache(queryClient),
    cashuReceiveQuote: new CashuReceiveQuoteCache(queryClient),
    pendingCashuReceiveQuotes: new PendingCashuReceiveQuotesCache(queryClient),
    pendingCashuReceiveSwaps: new PendingCashuReceiveSwapsCache(queryClient),
    transactions: new TransactionsCache(queryClient),
  };

  const listAccountsQueryFactory = () =>
    listAccountsQuery({
      accountRepository: repos.accountRepo,
      userId,
    });

  const cashuReceiveQuoteQueryFactory = (quoteId?: string) =>
    cashuReceiveQuoteQuery({
      cashuReceiveQuoteRepository: repos.cashuReceiveQuoteRepo,
      quoteId,
    });

  const pendingCashuReceiveQuotesQueryFactory = () =>
    pendingCashuReceiveQuotesQuery({
      cashuReceiveQuoteRepository: repos.cashuReceiveQuoteRepo,
      getListAccountsQuery: listAccountsQueryFactory,
      queryClient,
      userId,
    });
  const pendingCashuReceiveSwapsQueryFactory = () =>
    pendingCashuReceiveSwapsQuery({
      cashuReceiveSwapRepository: repos.cashuReceiveSwapRepo,
      getListAccountsQuery: listAccountsQueryFactory,
      queryClient,
      userId,
    });
  const transactionQueryFactory = (transactionId: string) =>
    transactionQuery({
      transactionId,
      transactionRepository: repos.transactionRepo,
    });
  const transactionsListQueryFactory = (accountId?: string) =>
    transactionsListQuery({
      accountId,
      transactionRepository: repos.transactionRepo,
      transactionsCache: caches.transactions,
      userId,
    });
  const unacknowledgedTransactionsCountQueryFactory = () =>
    unacknowledgedTransactionsCountQuery({
      transactionRepository: repos.transactionRepo,
      userId,
    });

  const taskProcessors = {
    cashuReceiveQuote: new CashuReceiveQuoteTaskProcessor(
      queryClient,
      repos.accountRepo,
      services.cashuReceiveQuoteService,
      pendingCashuReceiveQuotesQueryFactory,
    ),
    cashuReceiveSwap: new CashuReceiveSwapTaskProcessor(
      queryClient,
      repos.accountRepo,
      services.cashuReceiveSwapService,
      pendingCashuReceiveSwapsQueryFactory,
    ),
  };

  return {
    caches,
    cleanup: () => cleanupQueryClientResources(queryClient, ownsQueryClient),
    queryClient,
    queries: {
      cashuReceiveQuoteQuery: cashuReceiveQuoteQueryFactory,
      listAccountsQuery: listAccountsQueryFactory,
      pendingCashuReceiveQuotesQuery: pendingCashuReceiveQuotesQueryFactory,
      pendingCashuReceiveSwapsQuery: pendingCashuReceiveSwapsQueryFactory,
      transactionQuery: transactionQueryFactory,
      transactionsListQuery: transactionsListQueryFactory,
      unacknowledgedTransactionsCountQuery:
        unacknowledgedTransactionsCountQueryFactory,
    },
    repos,
    services,
    taskProcessors,
    userId,
  };
}
