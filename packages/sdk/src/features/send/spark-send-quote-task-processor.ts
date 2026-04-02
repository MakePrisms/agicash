import { LightningSendRequestStatus } from '@buildonspark/spark-sdk/types';
import {
  type FetchQueryOptions,
  type QueryClient,
  QueryObserver,
} from '@tanstack/query-core';
import { sparkBalanceQueryKey } from '../../core/query-keys';
import { measureOperation } from '../../performance';
import type { SparkAccount } from '../accounts/account';
import { AccountsCache } from '../accounts/account-queries';
import type { AccountRepository } from '../accounts/account-repository';
import { DomainError } from '../shared/error';
import { TransactionsCache } from '../transactions/transaction-queries';
import type { SparkSendQuote } from './spark-send-quote';
import { UnresolvedSparkSendQuotesCache } from './spark-send-quote-queries';
import type { SparkSendQuoteService } from './spark-send-quote-service';

type UnresolvedQuotesQueryFactory = () => FetchQueryOptions<
  SparkSendQuote[],
  Error
>;

type SparkSendQuoteTaskProcessorEvents = {
  'send:initiated': { quoteId: string };
  'send:completed': { quoteId: string };
  'send:failed': { quoteId: string; reason: string };
  error: {
    action: string;
    error: unknown;
    quoteId?: string;
  };
};

type Listener<TEvent> = (event: TEvent) => void;

const POLL_INTERVAL_MS = 1000;

export class SparkSendQuoteTaskProcessor {
  private readonly accountsCache: AccountsCache;
  private readonly listeners: {
    [K in keyof SparkSendQuoteTaskProcessorEvents]: Set<
      Listener<SparkSendQuoteTaskProcessorEvents[K]>
    >;
  } = {
    'send:initiated': new Set(),
    'send:completed': new Set(),
    'send:failed': new Set(),
    error: new Set(),
  };
  private readonly lastTriggeredState = new Map<
    string,
    SparkSendQuote['state']
  >();
  private pollInterval?: ReturnType<typeof setInterval>;
  private readonly scopeChains = new Map<string, Promise<void>>();
  private started = false;
  private trackingSignature = '';
  private trackingUpdateChain = Promise.resolve();
  private readonly transactionsCache: TransactionsCache;
  private readonly unresolvedQuotesCache: UnresolvedSparkSendQuotesCache;
  private unresolvedQuotesObserver?: QueryObserver<SparkSendQuote[], Error>;
  private unresolvedQuotesObserverUnsubscribe?: () => void;

  constructor(
    private readonly queryClient: QueryClient,
    private readonly accountRepository: AccountRepository,
    private readonly sparkSendQuoteService: SparkSendQuoteService,
    private readonly getUnresolvedQuotesQuery: UnresolvedQuotesQueryFactory,
  ) {
    this.accountsCache = new AccountsCache(queryClient);
    this.transactionsCache = new TransactionsCache(queryClient);
    this.unresolvedQuotesCache = new UnresolvedSparkSendQuotesCache(
      queryClient,
    );
  }

  on<K extends keyof SparkSendQuoteTaskProcessorEvents>(
    event: K,
    listener: Listener<SparkSendQuoteTaskProcessorEvents[K]>,
  ) {
    this.listeners[event].add(listener);

    return () => {
      this.listeners[event].delete(listener);
    };
  }

  async start() {
    if (this.started) {
      return;
    }

    this.started = true;
    this.unresolvedQuotesObserver = new QueryObserver(
      this.queryClient,
      this.getUnresolvedQuotesQuery(),
    );
    this.unresolvedQuotesObserverUnsubscribe =
      this.unresolvedQuotesObserver.subscribe((result) => {
        if (result.error) {
          this.handleError(
            'observe-unresolved-spark-send-quotes',
            result.error,
          );
        }

        if (result.data) {
          this.queueTrackingUpdate(result.data);
        }
      });

    const currentResult = this.unresolvedQuotesObserver.getCurrentResult();
    if (currentResult.data) {
      this.queueTrackingUpdate(currentResult.data);
    }

    try {
      await this.queryClient.ensureQueryData(this.getUnresolvedQuotesQuery());
    } catch (error) {
      this.handleError('load-unresolved-spark-send-quotes', error);
    }
  }

  async stop() {
    this.started = false;
    this.unresolvedQuotesObserverUnsubscribe?.();
    this.unresolvedQuotesObserverUnsubscribe = undefined;
    this.unresolvedQuotesObserver = undefined;
    this.cleanupTracking();
    this.trackingSignature = '';
    this.lastTriggeredState.clear();
  }

  private emit<K extends keyof SparkSendQuoteTaskProcessorEvents>(
    event: K,
    payload: SparkSendQuoteTaskProcessorEvents[K],
  ) {
    for (const listener of this.listeners[event]) {
      listener(payload);
    }
  }

  private queueTrackingUpdate(quotes: SparkSendQuote[]) {
    this.trackingUpdateChain = this.trackingUpdateChain
      .catch(() => undefined)
      .then(() => this.applyTracking(quotes))
      .catch((error) => {
        this.handleError('sync-spark-send-quote-tracking', error);
      });
  }

  private applyTracking(quotes: SparkSendQuote[]) {
    if (!this.started) {
      return;
    }

    const signature = JSON.stringify(
      quotes.map((quote) => ({
        id: quote.id,
        accountId: quote.accountId,
        state: quote.state,
        version: quote.version,
      })),
    );

    if (signature === this.trackingSignature) {
      return;
    }

    this.cleanupTracking();
    this.trackingSignature = signature;

    // Clean up tracked states for quotes no longer in the list
    const quoteIdSet = new Set(quotes.map((q) => q.id));
    for (const trackedQuoteId of this.lastTriggeredState.keys()) {
      if (!quoteIdSet.has(trackedQuoteId)) {
        this.lastTriggeredState.delete(trackedQuoteId);
      }
    }

    if (quotes.length === 0) {
      return;
    }

    const quoteIds = quotes.map((q) => q.id);

    // Check all quotes immediately
    this.checkStatuses(quoteIds);

    // Set up polling interval
    this.pollInterval = setInterval(
      () => this.checkStatuses(quoteIds),
      POLL_INTERVAL_MS,
    );
  }

  private cleanupTracking() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }
  }

  private checkStatuses(quoteIds: string[]) {
    for (const quoteId of quoteIds) {
      void this.checkQuoteStatus(quoteId);
    }
  }

  private async checkQuoteStatus(quoteId: string) {
    await this.runInScope(`spark-send-quote-${quoteId}`, async () => {
      try {
        const quote = this.unresolvedQuotesCache.get(quoteId);
        if (!quote) {
          return;
        }

        if (
          quote.state === 'UNPAID' &&
          this.lastTriggeredState.get(quoteId) !== 'UNPAID'
        ) {
          this.lastTriggeredState.set(quoteId, 'UNPAID');
          await this.initiateSend(quote);
          return;
        }

        if (quote.state !== 'PENDING') {
          return;
        }

        const account = await this.getSparkAccount(quote.accountId);

        const sendRequest = await measureOperation(
          'SparkWallet.getLightningSendRequest',
          () => account.wallet.getLightningSendRequest(quote.sparkId),
          { sendRequestId: quote.sparkId },
        );

        if (!sendRequest) {
          return;
        }

        if (
          sendRequest.status ===
            LightningSendRequestStatus.TRANSFER_COMPLETED &&
          this.lastTriggeredState.get(quoteId) !== 'COMPLETED'
        ) {
          if (!sendRequest.paymentPreimage) {
            throw new Error(
              'Payment preimage is required when send request has TRANSFER_COMPLETED status.',
            );
          }

          this.lastTriggeredState.set(quoteId, 'COMPLETED');
          await this.completeSendQuote(quote, sendRequest.paymentPreimage);
          return;
        }

        if (
          sendRequest.status ===
            LightningSendRequestStatus.USER_SWAP_RETURNED &&
          this.lastTriggeredState.get(quoteId) !== 'FAILED'
        ) {
          this.lastTriggeredState.set(quoteId, 'FAILED');

          const now = new Date();
          const reason =
            quote.expiresAt && new Date(quote.expiresAt) < now
              ? 'Lightning invoice expired.'
              : 'Lightning payment failed.';

          await this.failSendQuote(quote, reason);
        }
      } catch (error) {
        console.error('Error checking spark send quote status', {
          cause: error,
          quoteId,
        });
      }
    });
  }

  private async initiateSend(quote: SparkSendQuote) {
    try {
      const cachedQuote = this.unresolvedQuotesCache.get(quote.id);
      if (cachedQuote?.state !== 'UNPAID') {
        return;
      }

      const account = await this.getSparkAccount(quote.accountId);
      const updatedQuote = await this.retry(
        () =>
          this.sparkSendQuoteService.initiateSend({
            account,
            sendQuote: quote,
          }),
        3,
      );

      this.unresolvedQuotesCache.update(updatedQuote);
      this.emit('send:initiated', { quoteId: quote.id });
    } catch (error) {
      if (error instanceof DomainError) {
        await this.failSendQuote(quote, error.message);
        return;
      }

      console.error('Initiate spark send quote error', {
        cause: error,
        sendQuoteId: quote.id,
      });
      this.emit('error', {
        action: 'initiate-spark-send-quote',
        error,
        quoteId: quote.id,
      });
    }
  }

  private async completeSendQuote(
    quote: SparkSendQuote,
    paymentPreimage: string,
  ) {
    try {
      const cachedQuote = this.unresolvedQuotesCache.get(quote.id);
      if (!cachedQuote) {
        return;
      }

      const updatedQuote = await this.retry(
        () => this.sparkSendQuoteService.complete(quote, paymentPreimage),
        3,
      );

      this.unresolvedQuotesCache.remove(updatedQuote);
      await this.transactionsCache.invalidateTransaction(
        updatedQuote.transactionId,
      );
      await this.queryClient.invalidateQueries({
        queryKey: sparkBalanceQueryKey(updatedQuote.accountId),
      });
      this.emit('send:completed', { quoteId: quote.id });
    } catch (error) {
      console.error('Complete spark send quote error', {
        cause: error,
        sendQuoteId: quote.id,
      });
      this.emit('error', {
        action: 'complete-spark-send-quote',
        error,
        quoteId: quote.id,
      });
    }
  }

  private async failSendQuote(quote: SparkSendQuote, reason: string) {
    try {
      const cachedQuote = this.unresolvedQuotesCache.get(quote.id);
      if (!cachedQuote) {
        return;
      }

      const updatedQuote = await this.retry(
        () => this.sparkSendQuoteService.fail(quote, reason),
        3,
      );

      this.unresolvedQuotesCache.remove(updatedQuote);
      this.emit('send:failed', { quoteId: quote.id, reason });
    } catch (error) {
      console.error('Failed to mark spark send quote as failed', {
        cause: error,
        sendQuoteId: quote.id,
      });
      this.emit('error', {
        action: 'fail-spark-send-quote',
        error,
        quoteId: quote.id,
      });
    }
  }

  private async getSparkAccount(accountId: string): Promise<SparkAccount> {
    const cachedAccount = this.accountsCache.get(accountId);
    if (cachedAccount) {
      if (cachedAccount.type !== 'spark') {
        throw new Error(`Account with id ${accountId} is not a spark account`);
      }

      return cachedAccount;
    }

    const account = await this.accountRepository.get(accountId);
    this.accountsCache.upsert(account);

    if (account.type !== 'spark') {
      throw new Error(`Account with id ${accountId} is not a spark account`);
    }

    return account;
  }

  private handleError(action: string, error: unknown, quoteId?: string) {
    console.error(`Spark send quote processor error (${action})`, {
      cause: error,
      quoteId,
    });
    this.emit('error', {
      action,
      error,
      quoteId,
    });
  }

  private async retry<T>(fn: () => Promise<T>, maxRetries: number): Promise<T> {
    let failureCount = 0;

    while (true) {
      try {
        return await fn();
      } catch (error) {
        failureCount += 1;
        if (failureCount > maxRetries) {
          throw error;
        }
      }
    }
  }

  private async runInScope(scopeId: string, task: () => Promise<void>) {
    const previous = this.scopeChains.get(scopeId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);

    this.scopeChains.set(
      scopeId,
      next.finally(() => {
        if (this.scopeChains.get(scopeId) === next) {
          this.scopeChains.delete(scopeId);
        }
      }),
    );

    await next;
  }
}
