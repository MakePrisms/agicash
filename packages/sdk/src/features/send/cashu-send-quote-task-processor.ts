import {
  type MeltQuoteBolt11Response,
  MintOperationError,
} from '@cashu/cashu-ts';
import {
  type FetchQueryOptions,
  type QueryClient,
  QueryObserver,
} from '@tanstack/query-core';
import {
  MeltQuoteSubscriptionManager,
  getCashuWallet,
  sumProofs,
} from '../../lib/cashu';
import { clearLongTimeout, setLongTimeout } from '../../lib/timeout';
import type { CashuAccount } from '../accounts/account';
import { AccountsCache } from '../accounts/account-queries';
import type { AccountRepository } from '../accounts/account-repository';
import { TransactionsCache } from '../transactions/transaction-queries';
import type { CashuSendQuote } from './cashu-send-quote';
import { UnresolvedCashuSendQuotesCache } from './cashu-send-quote-queries';
import type { CashuSendQuoteService } from './cashu-send-quote-service';

type UnresolvedQuotesQueryFactory = () => FetchQueryOptions<
  CashuSendQuote[],
  Error
>;

type CashuSendQuoteTaskProcessorEvents = {
  'send:completed': { quoteId: string };
  'send:failed': { quoteId: string; reason: string };
  'send:expired': { quoteId: string };
  error: {
    action: string;
    error: unknown;
    quoteId?: string;
  };
};

type Listener<TEvent> = (event: TEvent) => void;

export class CashuSendQuoteTaskProcessor {
  private readonly accountsCache: AccountsCache;
  private readonly listeners: {
    [K in keyof CashuSendQuoteTaskProcessorEvents]: Set<
      Listener<CashuSendQuoteTaskProcessorEvents[K]>
    >;
  } = {
    'send:completed': new Set(),
    'send:failed': new Set(),
    'send:expired': new Set(),
    error: new Set(),
  };
  private readonly scopeChains = new Map<string, Promise<void>>();
  private started = false;
  private readonly subscriptionManager: MeltQuoteSubscriptionManager;
  private trackingCleanup: (() => void) | undefined;
  private trackingSignature = '';
  private trackingUpdateChain = Promise.resolve();
  private readonly transactionsCache: TransactionsCache;
  private unresolvedQuotesCache: UnresolvedCashuSendQuotesCache;
  private unresolvedQuotesObserver?: QueryObserver<CashuSendQuote[], Error>;
  private unresolvedQuotesObserverUnsubscribe?: () => void;

  constructor(
    private readonly queryClient: QueryClient,
    private readonly accountRepository: AccountRepository,
    private readonly cashuSendQuoteService: CashuSendQuoteService,
    private readonly getUnresolvedQuotesQuery: UnresolvedQuotesQueryFactory,
  ) {
    this.accountsCache = new AccountsCache(queryClient);
    this.subscriptionManager = new MeltQuoteSubscriptionManager();
    this.transactionsCache = new TransactionsCache(queryClient);
    this.unresolvedQuotesCache = new UnresolvedCashuSendQuotesCache(
      queryClient,
    );
  }

  on<K extends keyof CashuSendQuoteTaskProcessorEvents>(
    event: K,
    listener: Listener<CashuSendQuoteTaskProcessorEvents[K]>,
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
            'observe-unresolved-cashu-send-quotes',
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
      this.handleError('load-unresolved-cashu-send-quotes', error);
    }
  }

  async stop() {
    this.started = false;
    this.unresolvedQuotesObserverUnsubscribe?.();
    this.unresolvedQuotesObserverUnsubscribe = undefined;
    this.unresolvedQuotesObserver = undefined;
    await this.cleanupTracking();
    this.trackingSignature = '';
  }

  private emit<K extends keyof CashuSendQuoteTaskProcessorEvents>(
    event: K,
    payload: CashuSendQuoteTaskProcessorEvents[K],
  ) {
    for (const listener of this.listeners[event]) {
      listener(payload);
    }
  }

  private queueTrackingUpdate(quotes: CashuSendQuote[]) {
    this.trackingUpdateChain = this.trackingUpdateChain
      .catch(() => undefined)
      .then(() => this.applyTracking(quotes))
      .catch((error) => {
        this.handleError('sync-cashu-send-quote-tracking', error);
      });
  }

  private async applyTracking(quotes: CashuSendQuote[]) {
    if (!this.started) {
      return;
    }

    const signature = JSON.stringify(
      quotes.map((quote) => ({
        accountId: quote.accountId,
        expiresAt: quote.expiresAt,
        id: quote.id,
        quoteId: quote.quoteId,
        state: quote.state,
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

    const quoteAccounts = await Promise.all(
      quotes.map(async (quote) => {
        try {
          const account = await this.getCashuAccount(quote.accountId);
          return { account, quote };
        } catch (error) {
          this.handleError('load-cashu-account', error, quote.id);
          return null;
        }
      }),
    );

    const trackableQuoteAccounts = quoteAccounts.filter(
      (entry): entry is NonNullable<typeof entry> => entry !== null,
    );

    // Build melt quote subscriptions grouped by mint URL
    const meltQuotesByMint = trackableQuoteAccounts.reduce<
      Record<string, string[]>
    >((acc, { account, quote }) => {
      const existingQuotesForMint = acc[account.mintUrl] ?? [];
      acc[account.mintUrl] = existingQuotesForMint.concat(quote.quoteId);
      return acc;
    }, {});

    for (const [mintUrl, quoteIds] of Object.entries(meltQuotesByMint)) {
      try {
        const unsubscribe = await this.subscriptionManager.subscribe({
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

    // Set up expiry timeouts for each quote
    for (const { account, quote } of trackableQuoteAccounts) {
      const msUntilExpiration =
        new Date(quote.expiresAt).getTime() - Date.now();
      const quoteTimeout = setLongTimeout(async () => {
        try {
          const wallet = getCashuWallet(account.mintUrl);
          const meltQuote = await wallet.checkMeltQuoteBolt11(quote.quoteId);
          await this.handleMeltQuoteUpdate(meltQuote, true);
        } catch (error) {
          console.error('Error checking melt quote upon expiration', {
            cause: error,
            meltQuoteId: quote.quoteId,
          });
        }
      }, msUntilExpiration);

      cleanupTasks.push(() => clearLongTimeout(quoteTimeout));
    }

    this.trackingCleanup = () => {
      for (const cleanup of cleanupTasks) {
        cleanup();
      }
    };
  }

  private async cleanupTracking() {
    this.trackingCleanup?.();
    this.trackingCleanup = undefined;
  }

  private async handleMeltQuoteUpdate(
    meltQuote: MeltQuoteBolt11Response,
    handleExpiry = false,
  ) {
    const sendQuote = this.unresolvedQuotesCache.getByMeltQuoteId(
      meltQuote.quote,
    );
    if (!sendQuote) {
      return;
    }

    if (meltQuote.state === 'UNPAID') {
      const expiresAt = new Date(sendQuote.expiresAt);
      const now = new Date();

      if (expiresAt > now) {
        // In case of failed payment the mint will flip the state of the melt quote back to UNPAID.
        // Only initiate the send if our quote state is also UNPAID to avoid re-initiating after failure.
        if (sendQuote.state === 'UNPAID') {
          await this.initiateSend(sendQuote.id, meltQuote);
        }
      } else if (handleExpiry) {
        await this.expireSendQuote(sendQuote.id);
      }
    } else if (meltQuote.state === 'PENDING') {
      await this.markSendQuoteAsPending(sendQuote.id);
    } else if (meltQuote.state === 'PAID') {
      // There is a bug in nutshell where the change is not included in the melt quote state updates,
      // so we need to refetch the quote to get the change proofs.
      // see https://github.com/cashubtc/nutshell/pull/788
      const quoteData = this.getMeltQuoteData(sendQuote);
      const expectChange =
        quoteData && quoteData.inputAmount > meltQuote.amount;

      if (expectChange && !(meltQuote.change && meltQuote.change.length > 0)) {
        try {
          const wallet = getCashuWallet(quoteData.mintUrl);
          const meltQuoteWithChange = await wallet.checkMeltQuoteBolt11(
            meltQuote.quote,
          );
          await this.completeSendQuote(sendQuote.id, meltQuoteWithChange);
        } catch {
          // Fall back to completing without change
          await this.completeSendQuote(sendQuote.id, meltQuote);
        }
      } else {
        await this.completeSendQuote(sendQuote.id, meltQuote);
      }
    }
  }

  private getMeltQuoteData(sendQuote: CashuSendQuote) {
    const account = this.accountsCache.get(sendQuote.accountId);
    if (!account || account.type !== 'cashu') {
      return null;
    }
    return {
      id: sendQuote.quoteId,
      mintUrl: account.mintUrl,
      expiryInMs: new Date(sendQuote.expiresAt).getTime(),
      inputAmount: sumProofs(sendQuote.proofs),
    };
  }

  private async initiateSend(
    sendQuoteId: string,
    meltQuote: MeltQuoteBolt11Response,
  ) {
    await this.runInScope(
      `initiate-cashu-send-quote-${sendQuoteId}`,
      async () => {
        const sendQuote = this.unresolvedQuotesCache.get(sendQuoteId);
        if (!sendQuote) {
          return;
        }

        try {
          const account = await this.getCashuAccount(sendQuote.accountId);
          await this.retry(
            () =>
              this.cashuSendQuoteService.initiateSend(
                account,
                sendQuote,
                meltQuote,
              ),
            (failureCount, error) => {
              if (error instanceof MintOperationError) {
                return false;
              }
              return failureCount < 3;
            },
          );
        } catch (error) {
          if (error instanceof MintOperationError) {
            console.warn('Failed to initiate send.', {
              cause: error,
              sendQuoteId,
            });
            await this.failSendQuote(sendQuoteId, error.message);
            return;
          }

          console.error('Initiate send error', {
            cause: error,
            sendQuoteId,
          });
          this.emit('error', {
            action: 'initiate-cashu-send-quote',
            error,
            quoteId: sendQuoteId,
          });
        }
      },
    );
  }

  private async failSendQuote(sendQuoteId: string, reason: string) {
    await this.runInScope(`cashu-send-quote-${sendQuoteId}`, async () => {
      const sendQuote = this.unresolvedQuotesCache.get(sendQuoteId);
      if (!sendQuote) {
        return;
      }

      try {
        const account = await this.getCashuAccount(sendQuote.accountId);
        const failedQuote = await this.retry(
          () =>
            this.cashuSendQuoteService.failSendQuote(
              account,
              sendQuote,
              reason,
            ),
          3,
        );

        // Remove quote from subscription so that if the user creates a new send quote
        // with the same melt quote, the subscription handler will be called again.
        this.subscriptionManager.removeQuoteFromSubscription({
          mintUrl: account.mintUrl,
          quoteId: failedQuote.quoteId,
        });

        this.emit('send:failed', { quoteId: sendQuoteId, reason });
      } catch (error) {
        console.error('Failed to mark payment as failed', {
          cause: error,
          sendQuoteId,
        });
        this.emit('error', {
          action: 'fail-cashu-send-quote',
          error,
          quoteId: sendQuoteId,
        });
      }
    });
  }

  private async markSendQuoteAsPending(sendQuoteId: string) {
    await this.runInScope(`cashu-send-quote-${sendQuoteId}`, async () => {
      const sendQuote = this.unresolvedQuotesCache.get(sendQuoteId);
      if (!sendQuote) {
        return;
      }

      try {
        const updatedQuote = await this.retry(
          () => this.cashuSendQuoteService.markSendQuoteAsPending(sendQuote),
          3,
        );
        if (updatedQuote) {
          this.unresolvedQuotesCache.update(updatedQuote);
        }
      } catch (error) {
        console.error('Mark send quote as pending error', {
          cause: error,
          sendQuoteId,
        });
        this.emit('error', {
          action: 'mark-cashu-send-quote-pending',
          error,
          quoteId: sendQuoteId,
        });
      }
    });
  }

  private async expireSendQuote(sendQuoteId: string) {
    await this.runInScope(`cashu-send-quote-${sendQuoteId}`, async () => {
      const sendQuote = this.unresolvedQuotesCache.get(sendQuoteId);
      if (!sendQuote) {
        return;
      }

      try {
        await this.retry(
          () => this.cashuSendQuoteService.expireSendQuote(sendQuote),
          3,
        );
        this.emit('send:expired', { quoteId: sendQuoteId });
      } catch (error) {
        console.error('Expire send quote error', {
          cause: error,
          sendQuoteId,
        });
        this.emit('error', {
          action: 'expire-cashu-send-quote',
          error,
          quoteId: sendQuoteId,
        });
      }
    });
  }

  private async completeSendQuote(
    sendQuoteId: string,
    meltQuote: MeltQuoteBolt11Response,
  ) {
    await this.runInScope(`cashu-send-quote-${sendQuoteId}`, async () => {
      const sendQuote = this.unresolvedQuotesCache.get(sendQuoteId);
      if (!sendQuote) {
        return;
      }

      try {
        const account = await this.getCashuAccount(sendQuote.accountId);
        const completedQuote = await this.retry(
          () =>
            this.cashuSendQuoteService.completeSendQuote(
              account,
              sendQuote,
              meltQuote,
            ),
          3,
        );

        await this.transactionsCache.invalidateTransaction(
          completedQuote.transactionId,
        );
        this.emit('send:completed', { quoteId: sendQuoteId });
      } catch (error) {
        console.error('Complete send quote error', {
          cause: error,
          sendQuoteId,
        });
        this.emit('error', {
          action: 'complete-cashu-send-quote',
          error,
          quoteId: sendQuoteId,
        });
      }
    });
  }

  private async getCashuAccount(accountId: string): Promise<CashuAccount> {
    const cachedAccount = this.accountsCache.get(accountId);
    if (cachedAccount) {
      if (cachedAccount.type !== 'cashu') {
        throw new Error(`Account with id ${accountId} is not a cashu account`);
      }

      return cachedAccount;
    }

    const account = await this.accountRepository.get(accountId);
    this.accountsCache.upsert(account);

    if (account.type !== 'cashu') {
      throw new Error(`Account with id ${accountId} is not a cashu account`);
    }

    return account;
  }

  private handleError(action: string, error: unknown, quoteId?: string) {
    console.error(`Cashu send quote processor error (${action})`, {
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
