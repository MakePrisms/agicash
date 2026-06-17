import type { AgicashDb } from '@agicash/db-types';
import type { Money } from '@agicash/utils/money';
import type { QueryClient } from '@tanstack/query-core';
import type Big from 'big.js';
import type { CashuAccount, SparkAccount } from '../accounts/account';
import type { AccountsCache } from '../accounts/accounts-cache';
import type { Encryption } from '../encryption';
import { NotFoundError } from '../error';
import type { DatabaseChangeHandler } from '../realtime/realtime-api';
import type { CashuReceiveSwapService } from '../receive/cashu-receive-swap-service';
import type { Transaction } from '../transactions/transaction';
import { isTransactionReversable } from '../transactions/transaction';
import type {
  CashuLightningQuote,
  CashuSendQuote,
  DestinationDetails,
  SendQuoteRequest,
} from './cashu-send-quote';
import {
  UnresolvedCashuSendQuotesCache,
  createCashuSendQuoteChangeHandlers,
} from './cashu-send-quote-cache';
import { CashuSendQuoteRepository } from './cashu-send-quote-repository';
import { CashuSendQuoteService } from './cashu-send-quote-service';
import type { CashuSendSwap, CashuSwapQuote } from './cashu-send-swap';
import {
  CashuSendSwapCache,
  UnresolvedCashuSendSwapsCache,
  createCashuSendSwapChangeHandlers,
} from './cashu-send-swap-cache';
import { CashuSendSwapRepository } from './cashu-send-swap-repository';
import { CashuSendSwapService } from './cashu-send-swap-service';
import type { SparkLightningQuote, SparkSendQuote } from './spark-send-quote';
import {
  UnresolvedSparkSendQuotesCache,
  createSparkSendQuoteChangeHandlers,
} from './spark-send-quote-cache';
import { SparkSendQuoteRepository } from './spark-send-quote-repository';
import { SparkSendQuoteService } from './spark-send-quote-service';

export type SendApi = {
  /**
   * Gets a cashu lightning send quote (melt quote + fees) for paying the
   * bolt11 payment request from the account.
   * @throws DomainError for user-correctable problems (e.g. insufficient balance).
   */
  getCashuLightningQuote: (params: {
    account: CashuAccount;
    paymentRequest: string;
    amount?: Money;
    exchangeRate?: Big;
  }) => Promise<CashuLightningQuote>;
  /**
   * Creates the cashu send quote for the current user (UNPAID — the
   * background task processor initiates the actual payment).
   */
  createCashuSendQuote: (params: {
    account: CashuAccount;
    sendQuote: SendQuoteRequest;
    destinationDetails?: DestinationDetails;
  }) => Promise<CashuSendQuote>;
  /**
   * Estimates the fee for paying a Lightning invoice from the spark account.
   * @throws DomainError for invalid/expired invoices.
   */
  getSparkLightningSendQuote: (params: {
    account: SparkAccount;
    paymentRequest: string;
    amount?: Money<'BTC'>;
  }) => Promise<SparkLightningQuote>;
  /**
   * Creates the spark send quote for the current user (UNPAID — the
   * background task processor initiates the actual payment).
   * @throws DomainError when the invoice expired or balance is insufficient.
   */
  createSparkSendQuote: (params: {
    account: SparkAccount;
    quote: SparkLightningQuote;
  }) => Promise<SparkSendQuote>;
  /**
   * Estimates the cashu swap fees for sending the amount from the account.
   * @throws DomainError when the account balance is insufficient.
   */
  getCashuSendSwapQuote: (params: {
    account: CashuAccount;
    amount: Money;
    senderPaysFee?: boolean;
  }) => Promise<CashuSwapQuote>;
  /**
   * Creates a cashu send swap for the current user and records it as the
   * active send swap. The unresolved-swaps state is recorded by the
   * CASHU_SEND_SWAP_CREATED realtime broadcast, not here.
   */
  createCashuSendSwap: (params: {
    account: CashuAccount;
    amount: Money;
    senderPaysFee?: boolean;
  }) => Promise<CashuSendSwap>;
  /**
   * Reverses a reversable transaction by swapping the outstanding send-swap
   * proofs back into the account.
   * @throws when the transaction is not reversable or its swap/account is missing.
   */
  reverseTransaction: (transaction: Transaction) => Promise<void>;
  /**
   * Query config for the active cashu send swap. Throws NotFoundError when
   * the swap does not exist (retry semantics included).
   */
  cashuSwapOptions: (id: string) => {
    queryKey: string[];
    queryFn: () => Promise<CashuSendSwap>;
    retry: (failureCount: number, error: Error) => boolean;
    staleTime: number;
  };
  /**
   * Query config for tracking a cashu send swap that may not exist yet.
   * Pass undefined while no swap exists and gate with `enabled`.
   */
  trackCashuSwapOptions: (id: string | undefined) => {
    queryKey: (string | undefined)[];
    queryFn: () => Promise<CashuSendSwap | null>;
    staleTime: number;
  };
  /** Query config for the current user's unresolved cashu send quotes. */
  unresolvedCashuQuotesOptions: () => {
    queryKey: string[];
    queryFn: () => Promise<CashuSendQuote[]>;
    staleTime: number;
  };
  /** Query config for the current user's unresolved spark send quotes. */
  unresolvedSparkQuotesOptions: () => {
    queryKey: string[];
    queryFn: () => Promise<SparkSendQuote[]>;
    staleTime: number;
  };
  /** Query config for the current user's unresolved cashu send swaps. */
  unresolvedCashuSwapsOptions: () => {
    queryKey: string[];
    queryFn: () => Promise<CashuSendSwap[]>;
    staleTime: number;
  };
  /**
   * Query config for the cashu send quote backing a transaction (consume with
   * useSuspenseQuery). The queryFn resolves null when no such quote exists;
   * throw-on-missing is caller policy.
   */
  quoteByTransactionIdOptions: (transactionId: string) => {
    queryKey: string[];
    queryFn: () => Promise<CashuSendQuote | null>;
  };
  /**
   * Query config for the cashu send swap backing a transaction (consume with
   * useSuspenseQuery). The queryFn resolves null when no such swap exists;
   * throw-on-missing is caller policy.
   */
  swapByTransactionIdOptions: (transactionId: string) => {
    queryKey: string[];
    queryFn: () => Promise<CashuSendSwap | null>;
  };
};

export type SendApiDeps = {
  queryClient: QueryClient;
  db: AgicashDb;
  encryption: Encryption;
  /**
   * Resolves the current user's id from the SDK's user state.
   * @throws if no user is loaded yet.
   */
  getCurrentUserId: () => string;
  /** Accounts state for resolving the account of a send swap being reversed. */
  accountsCache: AccountsCache;
  /** The receive-side swap service the send swap reversal claims back through. */
  cashuReceiveSwapService: CashuReceiveSwapService;
};

export function createSendApi(deps: SendApiDeps): {
  api: SendApi;
  /** Shared with the transfer api: it persists the transfer's send quote.
   * Also the cashu-send-quote saga service the tasks engine calls. */
  cashuSendQuoteService: CashuSendQuoteService;
  /** Shared with the transfer api: it persists the transfer's send quote.
   * Also the spark-send-quote saga service the tasks engine calls. */
  sparkSendQuoteService: SparkSendQuoteService;
  /** Shared with the tasks engine: the cashu-send-swap saga's swap/complete
   * transitions call this service. */
  cashuSendSwapService: CashuSendSwapService;
  /** Shared with the tasks engine: the cashu-send-swap saga invalidates this
   * active-swap cache (full refetch) on complete. */
  cashuSendSwapCache: CashuSendSwapCache;
  /** Shared with the tasks engine: the cashu-send-quote saga re-reads the live
   * entity from this cache and writes back the markPending transition. */
  unresolvedCashuSendQuotesCache: UnresolvedCashuSendQuotesCache;
  /** Shared with the tasks engine: the spark-send-quote saga re-reads the live
   * entity from this cache and writes back the initiate/complete/fail transitions. */
  unresolvedSparkSendQuotesCache: UnresolvedSparkSendQuotesCache;
  caches: { invalidate: () => unknown }[];
  changeHandlers: DatabaseChangeHandler[];
} {
  const {
    queryClient,
    db,
    encryption,
    getCurrentUserId,
    accountsCache,
    cashuReceiveSwapService,
  } = deps;

  const cashuSendQuoteRepository = new CashuSendQuoteRepository(db, encryption);
  const cashuSendSwapRepository = new CashuSendSwapRepository(db, encryption);
  const sparkSendQuoteRepository = new SparkSendQuoteRepository(db, encryption);

  const cashuSendQuoteService = new CashuSendQuoteService(
    cashuSendQuoteRepository,
  );
  const cashuSendSwapService = new CashuSendSwapService(
    cashuSendSwapRepository,
    cashuReceiveSwapService,
  );
  const sparkSendQuoteService = new SparkSendQuoteService(
    sparkSendQuoteRepository,
  );

  const cashuSendSwapCache = new CashuSendSwapCache(queryClient);
  const unresolvedCashuSendQuotesCache = new UnresolvedCashuSendQuotesCache(
    queryClient,
  );
  const unresolvedCashuSendSwapsCache = new UnresolvedCashuSendSwapsCache(
    queryClient,
  );
  const unresolvedSparkSendQuotesCache = new UnresolvedSparkSendQuotesCache(
    queryClient,
  );

  const getCashuAccount = (id: string): CashuAccount => {
    const account = accountsCache.get(id);
    if (!account) {
      throw new Error(`Account not found for id: ${id}`);
    }
    if (account.type !== 'cashu') {
      throw new Error(`Account with id: ${id} is not of type: cashu`);
    }
    return account;
  };

  const api: SendApi = {
    getCashuLightningQuote: ({
      account,
      paymentRequest,
      amount,
      exchangeRate,
    }) =>
      cashuSendQuoteService.getLightningQuote({
        account,
        amount,
        paymentRequest,
        exchangeRate,
      }),
    createCashuSendQuote: ({ account, sendQuote, destinationDetails }) =>
      cashuSendQuoteService.createSendQuote({
        userId: getCurrentUserId(),
        account,
        sendQuote,
        destinationDetails,
      }),
    getSparkLightningSendQuote: ({ account, paymentRequest, amount }) =>
      sparkSendQuoteService.getLightningSendQuote({
        account,
        paymentRequest,
        amount,
      }),
    createSparkSendQuote: ({ account, quote }) =>
      sparkSendQuoteService.createSendQuote({
        userId: getCurrentUserId(),
        account,
        quote,
      }),
    getCashuSendSwapQuote: ({ account, amount, senderPaysFee = true }) =>
      cashuSendSwapService.getQuote({
        account,
        amount,
        senderPaysFee,
      }),
    createCashuSendSwap: async ({ account, amount, senderPaysFee = true }) => {
      const swap = await cashuSendSwapService.create({
        userId: getCurrentUserId(),
        amount,
        account,
        senderPaysFee,
      });
      cashuSendSwapCache.add(swap);
      return swap;
    },
    reverseTransaction: async (transaction) => {
      if (!isTransactionReversable(transaction)) {
        throw new Error('Transaction cannot be reversed');
      }

      if (transaction.type === 'CASHU_TOKEN') {
        const swap = await cashuSendSwapRepository.getByTransactionId(
          transaction.id,
        );
        if (!swap) {
          throw new Error(`Swap not found for transaction ${transaction.id}`);
        }
        const account = getCashuAccount(swap.accountId);
        await cashuSendSwapService.reverse(swap, account);
      } else {
        throw new Error('Only CASHU_TOKEN transactions can be reversed');
      }
    },
    cashuSwapOptions: (id) => ({
      queryKey: [CashuSendSwapCache.Key, id],
      queryFn: async () => {
        const swap = await cashuSendSwapRepository.get(id);
        if (!swap) {
          throw new NotFoundError(`Cashu send swap not found for id: ${id}`);
        }
        return swap;
      },
      retry: (failureCount: number, error: Error) => {
        if (error instanceof NotFoundError) {
          return false;
        }
        return failureCount <= 3;
      },
      staleTime: Number.POSITIVE_INFINITY,
    }),
    trackCashuSwapOptions: (id) => ({
      queryKey: [CashuSendSwapCache.Key, id],
      queryFn: () => {
        if (!id) {
          throw new Error('id is required');
        }
        return cashuSendSwapRepository.get(id);
      },
      staleTime: Number.POSITIVE_INFINITY,
    }),
    unresolvedCashuQuotesOptions: () => ({
      queryKey: [UnresolvedCashuSendQuotesCache.Key],
      queryFn: () => cashuSendQuoteRepository.getUnresolved(getCurrentUserId()),
      staleTime: Number.POSITIVE_INFINITY,
    }),
    unresolvedSparkQuotesOptions: () => ({
      queryKey: [UnresolvedSparkSendQuotesCache.Key],
      queryFn: () => sparkSendQuoteRepository.getUnresolved(getCurrentUserId()),
      staleTime: Number.POSITIVE_INFINITY,
    }),
    unresolvedCashuSwapsOptions: () => ({
      queryKey: [UnresolvedCashuSendSwapsCache.Key],
      queryFn: () => cashuSendSwapRepository.getUnresolved(getCurrentUserId()),
      staleTime: Number.POSITIVE_INFINITY,
    }),
    quoteByTransactionIdOptions: (transactionId) => ({
      queryKey: ['transaction-details', transactionId],
      queryFn: () => cashuSendQuoteRepository.getByTransactionId(transactionId),
    }),
    swapByTransactionIdOptions: (transactionId) => ({
      queryKey: ['transaction-details', transactionId],
      queryFn: () => cashuSendSwapRepository.getByTransactionId(transactionId),
    }),
  };

  return {
    api,
    cashuSendQuoteService,
    sparkSendQuoteService,
    cashuSendSwapService,
    cashuSendSwapCache,
    unresolvedCashuSendQuotesCache,
    unresolvedSparkSendQuotesCache,
    caches: [
      unresolvedCashuSendQuotesCache,
      cashuSendSwapCache,
      unresolvedCashuSendSwapsCache,
      unresolvedSparkSendQuotesCache,
    ],
    changeHandlers: [
      ...createCashuSendQuoteChangeHandlers(
        cashuSendQuoteRepository,
        unresolvedCashuSendQuotesCache,
      ),
      ...createCashuSendSwapChangeHandlers(
        cashuSendSwapRepository,
        cashuSendSwapCache,
        unresolvedCashuSendSwapsCache,
      ),
      ...createSparkSendQuoteChangeHandlers(
        sparkSendQuoteRepository,
        unresolvedSparkSendQuotesCache,
      ),
    ],
  };
}
