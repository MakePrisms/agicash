import { MintOperationError } from '@cashu/cashu-ts';
import {
  type FetchQueryOptions,
  type QueryClient,
  QueryObserver,
} from '@tanstack/query-core';
import { sparkBalanceQueryKey } from '../../core/query-keys';
import {
  MeltQuoteSubscriptionManager,
  getCashuUnit,
  getCashuWallet,
  sumProofs,
} from '../../lib/cashu';
import { clearLongTimeout, setLongTimeout } from '../../lib/timeout';
import type { SparkAccount } from '../accounts/account';
import { AccountsCache } from '../accounts/account-queries';
import type { AccountRepository } from '../accounts/account-repository';
import { TransactionsCache } from '../transactions/transaction-queries';
import {
  PendingSparkReceiveQuotesCache,
  SparkReceiveQuoteCache,
} from './spark-receive-queries';
import type { SparkReceiveQuote } from './spark-receive-quote';
import type { SparkReceiveQuoteService } from './spark-receive-quote-service';

type PendingQuotesQueryFactory = () => FetchQueryOptions<
  SparkReceiveQuote[],
  Error
>;

type SparkReceiveQuoteTaskProcessorEvents = {
  'receive:completed': {
    quote: SparkReceiveQuote;
  };
  'receive:expired': { quoteId: string };
  error: {
    action: string;
    error: unknown;
    quoteId?: string;
  };
};

type Listener<TEvent> = (event: TEvent) => void;

type PendingMeltQuote = {
  expiryInMs: number;
  id: string;
  inputAmount: number;
  mintUrl: string;
};

const ONE_SECOND = 1000;
const FIVE_SECONDS = 5 * ONE_SECOND;
const THIRTY_SECONDS = 30 * ONE_SECOND;
const ONE_MINUTE = 60 * ONE_SECOND;
const FIVE_MINUTES = 5 * ONE_MINUTE;
const TEN_MINUTES = 10 * ONE_MINUTE;
const ONE_HOUR = 60 * ONE_MINUTE;

/**
 * Returns the polling interval in milliseconds based on the quote's age.
 * - 1 second if created within last 5 minutes
 * - 5 seconds if created within last 10 minutes
 * - 30 seconds if created within last hour
 * - 1 minute if created more than 1 hour ago
 */
function getPollingInterval(createdAt: string): number {
  const ageMs = Date.now() - new Date(createdAt).getTime();

  if (ageMs < FIVE_MINUTES) {
    return ONE_SECOND;
  }
  if (ageMs < TEN_MINUTES) {
    return FIVE_SECONDS;
  }
  if (ageMs < ONE_HOUR) {
    return THIRTY_SECONDS;
  }
  return ONE_MINUTE;
}

export class SparkReceiveQuoteTaskProcessor {
  private readonly accountsCache: AccountsCache;
  private readonly listeners: {
    [K in keyof SparkReceiveQuoteTaskProcessorEvents]: Set<
      Listener<SparkReceiveQuoteTaskProcessorEvents[K]>
    >;
  } = {
    'receive:completed': new Set(),
    'receive:expired': new Set(),
    error: new Set(),
  };
  private readonly pendingQuotesCache: PendingSparkReceiveQuotesCache;
  private pendingQuotesObserver?: QueryObserver<SparkReceiveQuote[], Error>;
  private pendingQuotesObserverUnsubscribe?: () => void;
  private readonly scopeChains = new Map<string, Promise<void>>();
  private readonly sparkReceiveQuoteCache: SparkReceiveQuoteCache;
  private started = false;
  private trackingCleanup: (() => void) | undefined;
  private trackingSignature = '';
  private trackingUpdateChain = Promise.resolve();
  private readonly transactionsCache: TransactionsCache;

  constructor(
    private readonly queryClient: QueryClient,
    private readonly accountRepository: AccountRepository,
    private readonly sparkReceiveQuoteService: SparkReceiveQuoteService,
    private readonly getPendingQuotesQuery: PendingQuotesQueryFactory,
  ) {
    this.accountsCache = new AccountsCache(queryClient);
    this.pendingQuotesCache = new PendingSparkReceiveQuotesCache(queryClient);
    this.sparkReceiveQuoteCache = new SparkReceiveQuoteCache(queryClient);
    this.transactionsCache = new TransactionsCache(queryClient);
  }

  on<K extends keyof SparkReceiveQuoteTaskProcessorEvents>(
    event: K,
    listener: Listener<SparkReceiveQuoteTaskProcessorEvents[K]>,
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
    this.pendingQuotesObserver = new QueryObserver(
      this.queryClient,
      this.getPendingQuotesQuery(),
    );
    this.pendingQuotesObserverUnsubscribe =
      this.pendingQuotesObserver.subscribe((result) => {
        if (result.error) {
          this.handleError(
            'observe-pending-spark-receive-quotes',
            result.error,
          );
        }

        if (result.data) {
          this.queueTrackingUpdate(result.data);
        }
      });

    const currentResult = this.pendingQuotesObserver.getCurrentResult();
    if (currentResult.data) {
      this.queueTrackingUpdate(currentResult.data);
    }

    try {
      await this.queryClient.ensureQueryData(this.getPendingQuotesQuery());
    } catch (error) {
      this.handleError('load-pending-spark-receive-quotes', error);
    }
  }

  async stop() {
    this.started = false;
    this.pendingQuotesObserverUnsubscribe?.();
    this.pendingQuotesObserverUnsubscribe = undefined;
    this.pendingQuotesObserver = undefined;
    await this.cleanupTracking();
    this.trackingSignature = '';
  }

  private emit<K extends keyof SparkReceiveQuoteTaskProcessorEvents>(
    event: K,
    payload: SparkReceiveQuoteTaskProcessorEvents[K],
  ) {
    for (const listener of this.listeners[event]) {
      listener(payload);
    }
  }

  private queueTrackingUpdate(quotes: SparkReceiveQuote[]) {
    this.trackingUpdateChain = this.trackingUpdateChain
      .catch(() => undefined)
      .then(() => this.applyTracking(quotes))
      .catch((error) => {
        this.handleError('sync-spark-receive-quote-tracking', error);
      });
  }

  private async applyTracking(quotes: SparkReceiveQuote[]) {
    if (!this.started) {
      return;
    }

    const signature = JSON.stringify(
      quotes.map((quote) => ({
        accountId: quote.accountId,
        createdAt: quote.createdAt,
        expiresAt: quote.expiresAt,
        id: quote.id,
        meltInitiated:
          quote.type === 'CASHU_TOKEN'
            ? quote.tokenReceiveData.meltInitiated
            : undefined,
        meltQuoteId:
          quote.type === 'CASHU_TOKEN'
            ? quote.tokenReceiveData.meltQuoteId
            : undefined,
        sparkId: quote.sparkId,
        state: quote.state,
        type: quote.type,
        version: quote.version,
      })),
    );

    if (signature === this.trackingSignature) {
      return;
    }

    await this.cleanupTracking();
    this.trackingSignature = signature;

    if (quotes.length === 0) {
      return;
    }

    const cleanupTasks: Array<() => void> = [];

    // --- A) Spark API polling for LIGHTNING quotes ---
    const lightningQuotes = quotes.filter((q) => q.state === 'UNPAID');
    for (const quote of lightningQuotes) {
      const pollCleanup = this.startSparkPolling(quote);
      cleanupTasks.push(pollCleanup);
    }

    // --- B) Melt quote subscriptions for CASHU_TOKEN quotes ---
    const pendingMeltQuotes = this.getPendingMeltQuotes(quotes);
    if (pendingMeltQuotes.length > 0) {
      const meltQuoteSubscriptionManager = new MeltQuoteSubscriptionManager();
      const meltQuotesByMint = pendingMeltQuotes.reduce<
        Record<string, string[]>
      >((acc, quote) => {
        const existingQuotesForMint = acc[quote.mintUrl] ?? [];
        acc[quote.mintUrl] = existingQuotesForMint.concat(quote.id);
        return acc;
      }, {});

      for (const [mintUrl, quoteIds] of Object.entries(meltQuotesByMint)) {
        try {
          const unsubscribe = await meltQuoteSubscriptionManager.subscribe({
            mintUrl,
            onUpdate: (meltQuote) => {
              void this.handleMeltQuoteUpdate(meltQuote);
            },
            quoteIds,
          });

          cleanupTasks.push(unsubscribe);
        } catch (error) {
          this.handleError('subscribe-melt-quote-updates', error);
        }
      }

      for (const quote of pendingMeltQuotes) {
        const quoteTimeout = setLongTimeout(async () => {
          try {
            const wallet = getCashuWallet(quote.mintUrl);
            const meltQuote = await wallet.checkMeltQuoteBolt11(quote.id);
            await this.handleMeltQuoteUpdate(meltQuote, true);
          } catch (error) {
            console.error('Error checking melt quote upon expiration', {
              cause: error,
              meltQuoteId: quote.id,
            });
          }
        }, quote.expiryInMs - Date.now());

        cleanupTasks.push(() => clearLongTimeout(quoteTimeout));
      }
    }

    this.trackingCleanup = () => {
      for (const cleanup of cleanupTasks) {
        cleanup();
      }
    };
  }

  /**
   * Starts polling the Spark API for a single pending quote.
   * Polling interval is age-based (1s/5s/30s/60s).
   * Returns a cleanup function to stop polling.
   */
  private startSparkPolling(quote: SparkReceiveQuote): () => void {
    let stopped = false;
    let currentTimeout: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      if (stopped) {
        return;
      }

      await this.checkSparkReceiveStatus(quote);

      if (!stopped) {
        const interval = getPollingInterval(quote.createdAt);
        currentTimeout = setTimeout(() => {
          void poll();
        }, interval);
      }
    };

    void poll();

    return () => {
      stopped = true;
      if (currentTimeout !== undefined) {
        clearTimeout(currentTimeout);
      }
    };
  }

  private async checkSparkReceiveStatus(quote: SparkReceiveQuote) {
    try {
      const account = await this.getSparkAccount(quote.accountId);
      const receiveRequest = await account.wallet.getLightningReceiveRequest(
        quote.sparkId,
      );

      if (!receiveRequest) {
        return;
      }

      if (receiveRequest.status === 'TRANSFER_COMPLETED') {
        if (!receiveRequest.paymentPreimage) {
          throw new Error(
            'Payment preimage is required when receive request has TRANSFER_COMPLETED status.',
          );
        }
        if (!receiveRequest.transfer?.sparkId) {
          throw new Error(
            'Spark transfer ID is required when receive request has TRANSFER_COMPLETED status.',
          );
        }
        await this.completeReceiveQuote(quote.id, {
          paymentPreimage: receiveRequest.paymentPreimage,
          sparkTransferId: receiveRequest.transfer.sparkId,
        });
        return;
      }

      const expiresAt = new Date(receiveRequest.invoice.expiresAt);
      const now = new Date();

      if (now > expiresAt) {
        await this.expireReceiveQuote(quote.id);
      }
    } catch (error) {
      console.error('Error checking spark receive quote status', {
        cause: error,
        quoteId: quote.id,
      });
    }
  }

  private async cleanupTracking() {
    this.trackingCleanup?.();
    this.trackingCleanup = undefined;
  }

  private async handleMeltQuoteUpdate(
    meltQuote: {
      quote: string;
      state: string;
    },
    handleExpiry = false,
  ) {
    const relatedReceiveQuote = this.pendingQuotesCache.getByMeltQuoteId(
      meltQuote.quote,
    );

    if (!relatedReceiveQuote) {
      return;
    }

    if (meltQuote.state === 'UNPAID') {
      const expiresAt = new Date(relatedReceiveQuote.expiresAt);
      const now = new Date();

      if (expiresAt > now) {
        if (relatedReceiveQuote.tokenReceiveData.meltInitiated) {
          await this.failReceiveQuote(
            relatedReceiveQuote.id,
            'Cashu token melt failed.',
          );
        } else {
          await this.initiateMelt(relatedReceiveQuote.id);
        }
      } else if (handleExpiry) {
        await this.expireReceiveQuote(relatedReceiveQuote.id);
      }
    } else if (meltQuote.state === 'PENDING') {
      await this.markMeltInitiated(relatedReceiveQuote.id);
    } else if (meltQuote.state === 'EXPIRED') {
      await this.expireReceiveQuote(relatedReceiveQuote.id);
    }
  }

  private async completeReceiveQuote(
    quoteId: string,
    paymentData: {
      paymentPreimage: string;
      sparkTransferId: string;
    },
  ) {
    await this.runInScope(`spark-receive-quote-${quoteId}`, async () => {
      const quote = this.pendingQuotesCache.get(quoteId);
      if (!quote) {
        return;
      }

      try {
        const updatedQuote = await this.retry(
          () =>
            this.sparkReceiveQuoteService.complete(
              quote,
              paymentData.paymentPreimage,
              paymentData.sparkTransferId,
            ),
          3,
        );

        await this.transactionsCache.invalidateTransaction(
          updatedQuote.transactionId,
        );
        this.sparkReceiveQuoteCache.updateIfExists(updatedQuote);
        this.pendingQuotesCache.remove(updatedQuote);
        // Invalidate spark balance since we received funds
        this.queryClient.invalidateQueries({
          queryKey: sparkBalanceQueryKey(updatedQuote.accountId),
        });
        this.emit('receive:completed', { quote: updatedQuote });
      } catch (error) {
        console.error('Complete spark receive quote error', {
          cause: error,
          receiveQuoteId: quoteId,
        });
        this.emit('error', {
          action: 'complete-spark-receive-quote',
          error,
          quoteId,
        });
      }
    });
  }

  private async expireReceiveQuote(quoteId: string) {
    await this.runInScope(`spark-receive-quote-${quoteId}`, async () => {
      const quote = this.pendingQuotesCache.get(quoteId);
      if (!quote) {
        return;
      }

      try {
        await this.retry(() => this.sparkReceiveQuoteService.expire(quote), 3);
        this.emit('receive:expired', { quoteId });
      } catch (error) {
        console.error('Expire spark receive quote error', {
          cause: error,
          receiveQuoteId: quoteId,
        });
        this.emit('error', {
          action: 'expire-spark-receive-quote',
          error,
          quoteId,
        });
      }
    });
  }

  private async failReceiveQuote(quoteId: string, reason: string) {
    await this.runInScope(`spark-receive-quote-${quoteId}`, async () => {
      const quote = this.pendingQuotesCache.get(quoteId);
      if (!quote) {
        return;
      }

      try {
        await this.retry(
          () => this.sparkReceiveQuoteService.fail(quote, reason),
          3,
        );
      } catch (error) {
        console.error('Fail spark receive quote error', {
          cause: error,
          receiveQuoteId: quoteId,
        });
        this.emit('error', {
          action: 'fail-spark-receive-quote',
          error,
          quoteId,
        });
      }
    });
  }

  private async initiateMelt(quoteId: string) {
    await this.runInScope(`spark-receive-quote-${quoteId}`, async () => {
      const quote = this.pendingQuotesCache.get(quoteId);
      if (quote?.type !== 'CASHU_TOKEN') {
        return;
      }

      try {
        await this.retry(
          async () => {
            const cashuUnit = getCashuUnit(quote.amount.currency);
            const sourceWallet = getCashuWallet(
              quote.tokenReceiveData.sourceMintUrl,
              {
                unit: cashuUnit,
              },
            );

            await sourceWallet.meltProofsIdempotent(
              {
                amount: quote.amount.toNumber(cashuUnit),
                quote: quote.tokenReceiveData.meltQuoteId,
              },
              quote.tokenReceiveData.tokenProofs,
            );
          },
          (failureCount, error) => {
            if (error instanceof MintOperationError) {
              return false;
            }

            return failureCount <= 3;
          },
        );
      } catch (error) {
        if (error instanceof MintOperationError) {
          console.warn('Failed to initiate melt.', {
            cause: error,
            receiveQuoteId: quoteId,
          });
          await this.failReceiveQuote(quoteId, error.message);
          return;
        }

        console.error('Initiate melt error', {
          cause: error,
          receiveQuoteId: quoteId,
        });
        this.emit('error', {
          action: 'initiate-spark-receive-melt',
          error,
          quoteId,
        });
      }
    });
  }

  private async markMeltInitiated(quoteId: string) {
    await this.runInScope(`spark-receive-quote-${quoteId}`, async () => {
      const quote = this.pendingQuotesCache.get(quoteId);
      if (quote?.type !== 'CASHU_TOKEN') {
        return;
      }

      try {
        await this.retry(
          () => this.sparkReceiveQuoteService.markMeltInitiated(quote),
          3,
        );
      } catch (error) {
        console.error('Mark melt initiated error', {
          cause: error,
          receiveQuoteId: quoteId,
        });
        this.emit('error', {
          action: 'mark-spark-receive-melt-initiated',
          error,
          quoteId,
        });
      }
    });
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

  private getPendingMeltQuotes(
    pendingSparkReceiveQuotes: SparkReceiveQuote[],
  ): PendingMeltQuote[] {
    return pendingSparkReceiveQuotes
      .filter(
        (quote): quote is SparkReceiveQuote & { type: 'CASHU_TOKEN' } =>
          quote.type === 'CASHU_TOKEN',
      )
      .map((quote) => ({
        expiryInMs: new Date(quote.expiresAt).getTime(),
        id: quote.tokenReceiveData.meltQuoteId,
        inputAmount: sumProofs(quote.tokenReceiveData.tokenProofs),
        mintUrl: quote.tokenReceiveData.sourceMintUrl,
      }));
  }

  private handleError(action: string, error: unknown, quoteId?: string) {
    console.error(`Spark receive quote processor error (${action})`, {
      cause: error,
      quoteId,
    });
    this.emit('error', {
      action,
      error,
      quoteId,
    });
  }

  private async retry<T>(
    fn: () => Promise<T>,
    retry: number | ((failureCount: number, error: unknown) => boolean),
  ): Promise<T> {
    let failureCount = 0;

    while (true) {
      try {
        return await fn();
      } catch (error) {
        failureCount += 1;
        const shouldRetry =
          typeof retry === 'number'
            ? failureCount <= retry
            : retry(failureCount, error);

        if (!shouldRetry) {
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
