import {
  HttpResponseError,
  MintOperationError,
  type MintQuoteBolt11Response,
  type WebSocketSupport,
} from '@cashu/cashu-ts';
import {
  type FetchQueryOptions,
  type QueryClient,
  QueryObserver,
} from '@tanstack/query-core';
import { mintQuoteQueryKey } from '../../core/query-keys';
import {
  MeltQuoteSubscriptionManager,
  MintQuoteSubscriptionManager,
  getCashuUnit,
  getCashuWallet,
  sumProofs,
} from '../../lib/cashu';
import { clearLongTimeout, setLongTimeout } from '../../lib/timeout';
import type { CashuAccount } from '../accounts/account';
import { AccountsCache } from '../accounts/account-queries';
import type { AccountRepository } from '../accounts/account-repository';
import { TransactionsCache } from '../transactions/transaction-queries';
import { CashuReceiveQuoteCache } from './cashu-receive-queries';
import { PendingCashuReceiveQuotesCache } from './cashu-receive-queries';
import type { CashuReceiveQuote } from './cashu-receive-quote';
import type { CashuReceiveQuoteService } from './cashu-receive-quote-service';

type PendingQuotesQueryFactory = () => FetchQueryOptions<
  CashuReceiveQuote[],
  Error
>;

type CashuReceiveQuoteTaskProcessorEvents = {
  'receive:expired': { quoteId: string };
  'receive:minted': {
    account: CashuAccount;
    addedProofs: string[];
    quote: CashuReceiveQuote;
  };
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

export class CashuReceiveQuoteTaskProcessor {
  private readonly accountsCache: AccountsCache;
  private readonly cashuReceiveQuoteCache: CashuReceiveQuoteCache;
  private readonly listeners: {
    [K in keyof CashuReceiveQuoteTaskProcessorEvents]: Set<
      Listener<CashuReceiveQuoteTaskProcessorEvents[K]>
    >;
  } = {
    'receive:expired': new Set(),
    'receive:minted': new Set(),
    error: new Set(),
  };
  private readonly pendingQuotesCache: PendingCashuReceiveQuotesCache;
  private pendingQuotesObserver?: QueryObserver<CashuReceiveQuote[], Error>;
  private pendingQuotesObserverUnsubscribe?: () => void;
  private readonly scopeChains = new Map<string, Promise<void>>();
  private started = false;
  private trackingCleanup: (() => void) | undefined;
  private trackingSignature = '';
  private trackingUpdateChain = Promise.resolve();
  private readonly transactionsCache: TransactionsCache;

  constructor(
    private readonly queryClient: QueryClient,
    private readonly accountRepository: AccountRepository,
    private readonly cashuReceiveQuoteService: CashuReceiveQuoteService,
    private readonly getPendingQuotesQuery: PendingQuotesQueryFactory,
  ) {
    this.accountsCache = new AccountsCache(queryClient);
    this.cashuReceiveQuoteCache = new CashuReceiveQuoteCache(queryClient);
    this.pendingQuotesCache = new PendingCashuReceiveQuotesCache(queryClient);
    this.transactionsCache = new TransactionsCache(queryClient);
  }

  on<K extends keyof CashuReceiveQuoteTaskProcessorEvents>(
    event: K,
    listener: Listener<CashuReceiveQuoteTaskProcessorEvents[K]>,
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
            'observe-pending-cashu-receive-quotes',
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
      this.handleError('load-pending-cashu-receive-quotes', error);
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

  private emit<K extends keyof CashuReceiveQuoteTaskProcessorEvents>(
    event: K,
    payload: CashuReceiveQuoteTaskProcessorEvents[K],
  ) {
    for (const listener of this.listeners[event]) {
      listener(payload);
    }
  }

  private queueTrackingUpdate(quotes: CashuReceiveQuote[]) {
    this.trackingUpdateChain = this.trackingUpdateChain
      .catch(() => undefined)
      .then(() => this.applyTracking(quotes))
      .catch((error) => {
        this.handleError('sync-cashu-receive-quote-tracking', error);
      });
  }

  private async applyTracking(quotes: CashuReceiveQuote[]) {
    if (!this.started) {
      return;
    }

    const signature = JSON.stringify(
      quotes.map((quote) => ({
        accountId: quote.accountId,
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
        quoteId: quote.quoteId,
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

    const quotesToSubscribeTo: Record<
      string,
      { account: CashuAccount; quote: CashuReceiveQuote }[]
    > = {};
    const quotesToPoll: { account: CashuAccount; quote: CashuReceiveQuote }[] =
      [];

    for (const entry of trackableQuoteAccounts) {
      if (
        this.checkIfMintSupportsWebSocketsForMintQuotes(
          entry.account,
          entry.account.currency,
        )
      ) {
        const quotesForMint = quotesToSubscribeTo[entry.account.mintUrl] ?? [];
        quotesToSubscribeTo[entry.account.mintUrl] =
          quotesForMint.concat(entry);
      } else {
        quotesToPoll.push(entry);
      }
    }

    const mintQuoteSubscriptionManager = new MintQuoteSubscriptionManager();

    for (const [mintUrl, mintQuotes] of Object.entries(quotesToSubscribeTo)) {
      try {
        const unsubscribe = await mintQuoteSubscriptionManager.subscribe({
          mintUrl,
          onUpdate: (mintQuote) => {
            void this.handleMintQuoteUpdate(mintQuote);
          },
          quoteIds: mintQuotes.map(({ quote }) => quote.quoteId),
        });

        cleanupTasks.push(unsubscribe);
      } catch (error) {
        this.handleError('subscribe-mint-quote-updates', error);
      }
    }

    for (const { account, quote } of quotesToPoll) {
      const observer = new QueryObserver(this.queryClient, {
        gcTime: 0,
        queryFn: async () => {
          try {
            const mintQuoteResponse = await account.wallet.checkMintQuoteBolt11(
              quote.quoteId,
            );
            await this.handleMintQuoteUpdate(mintQuoteResponse);
            return mintQuoteResponse;
          } catch (error) {
            console.warn('Error checking mint quote', {
              cause: error,
              quoteId: quote.quoteId,
            });
            return null;
          }
        },
        queryKey: mintQuoteQueryKey(quote.quoteId),
        refetchInterval: (query) => {
          const error = query.state.error;
          const isRateLimitError =
            error instanceof HttpResponseError && error.status === 429;

          if (isRateLimitError) {
            return 60 * 1000;
          }

          return 10 * 1000;
        },
        refetchIntervalInBackground: true,
        retry: false,
        staleTime: 0,
      });

      cleanupTasks.push(observer.subscribe(() => undefined));
    }

    const unpaidReceiveQuotes = Object.values(quotesToSubscribeTo)
      .flat()
      .map(({ quote }) => quote)
      .filter((quote) => quote.state === 'UNPAID');

    for (const receiveQuote of unpaidReceiveQuotes) {
      const msUntilExpiration =
        new Date(receiveQuote.expiresAt).getTime() - Date.now();
      const quoteTimeout = setLongTimeout(async () => {
        try {
          const mintQuote = await this.retry(
            () =>
              this.getCashuAccount(receiveQuote.accountId).then((account) =>
                account.wallet.checkMintQuoteBolt11(receiveQuote.quoteId),
              ),
            5,
          );

          await this.handleMintQuoteUpdate(mintQuote);
        } catch (error) {
          console.error('Error checking mint quote upon expiration', {
            cause: error,
            quoteId: receiveQuote.quoteId,
          });
        }
      }, msUntilExpiration);

      cleanupTasks.push(() => clearLongTimeout(quoteTimeout));
    }

    const pendingMeltQuotes = this.getPendingMeltQuotes(quotes);
    const meltQuoteSubscriptionManager = new MeltQuoteSubscriptionManager();
    const meltQuotesByMint = pendingMeltQuotes.reduce<Record<string, string[]>>(
      (acc, quote) => {
        const existingQuotesForMint = acc[quote.mintUrl] ?? [];
        acc[quote.mintUrl] = existingQuotesForMint.concat(quote.id);
        return acc;
      },
      {},
    );

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

  private async handleMintQuoteUpdate(mintQuote: MintQuoteBolt11Response) {
    const relatedReceiveQuote = this.pendingQuotesCache.getByMintQuoteId(
      mintQuote.quote,
    );

    if (!relatedReceiveQuote) {
      console.warn('No related receive quote found for the mint quote', {
        mintQuoteId: mintQuote.quote,
      });
      return;
    }

    const expiresAt = new Date(relatedReceiveQuote.expiresAt);
    const now = new Date();

    if (mintQuote.state === 'UNPAID' && expiresAt < now) {
      await this.expireReceiveQuote(relatedReceiveQuote.id);
    } else if (mintQuote.state === 'PAID' || mintQuote.state === 'ISSUED') {
      await this.completeReceiveQuote(relatedReceiveQuote.id);
    }
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
    }
  }

  private async completeReceiveQuote(quoteId: string) {
    await this.runInScope(`cashu-receive-quote-${quoteId}`, async () => {
      const quote = this.pendingQuotesCache.get(quoteId);
      if (!quote) {
        return;
      }

      try {
        const account = await this.getCashuAccount(quote.accountId);
        const result = await this.retry(
          () => this.cashuReceiveQuoteService.completeReceive(account, quote),
          3,
        );

        await this.transactionsCache.invalidateTransaction(
          result.quote.transactionId,
        );
        this.cashuReceiveQuoteCache.updateIfExists(result.quote);
        this.pendingQuotesCache.update(result.quote);
        this.emit('receive:minted', result);
      } catch (error) {
        console.error('Complete cashu receive quote error', {
          cause: error,
          receiveQuoteId: quoteId,
        });
        this.emit('error', {
          action: 'complete-cashu-receive-quote',
          error,
          quoteId,
        });
      }
    });
  }

  private async expireReceiveQuote(quoteId: string) {
    await this.runInScope(`cashu-receive-quote-${quoteId}`, async () => {
      const quote = this.pendingQuotesCache.get(quoteId);
      if (!quote) {
        return;
      }

      try {
        await this.retry(() => this.cashuReceiveQuoteService.expire(quote), 3);
        this.emit('receive:expired', { quoteId });
      } catch (error) {
        console.error('Expire cashu receive quote error', {
          cause: error,
          receiveQuoteId: quoteId,
        });
        this.emit('error', {
          action: 'expire-cashu-receive-quote',
          error,
          quoteId,
        });
      }
    });
  }

  private async failReceiveQuote(quoteId: string, reason: string) {
    await this.runInScope(`cashu-receive-quote-${quoteId}`, async () => {
      const quote = this.pendingQuotesCache.get(quoteId);
      if (!quote) {
        return;
      }

      try {
        await this.retry(
          () => this.cashuReceiveQuoteService.fail(quote, reason),
          3,
        );
      } catch (error) {
        console.error('Fail cashu receive quote error', {
          cause: error,
          receiveQuoteId: quoteId,
        });
        this.emit('error', {
          action: 'fail-cashu-receive-quote',
          error,
          quoteId,
        });
      }
    });
  }

  private async initiateMelt(quoteId: string) {
    await this.runInScope(`cashu-receive-quote-${quoteId}`, async () => {
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
          action: 'initiate-cashu-receive-melt',
          error,
          quoteId,
        });
      }
    });
  }

  private async markMeltInitiated(quoteId: string) {
    await this.runInScope(`cashu-receive-quote-${quoteId}`, async () => {
      const quote = this.pendingQuotesCache.get(quoteId);
      if (quote?.type !== 'CASHU_TOKEN') {
        return;
      }

      try {
        await this.retry(
          () => this.cashuReceiveQuoteService.markMeltInitiated(quote),
          3,
        );
      } catch (error) {
        console.error('Mark melt initiated error', {
          cause: error,
          receiveQuoteId: quoteId,
        });
        this.emit('error', {
          action: 'mark-cashu-receive-melt-initiated',
          error,
          quoteId,
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

  private checkIfMintSupportsWebSocketsForMintQuotes(
    account: CashuAccount,
    currency: string,
  ) {
    const nut17Info = account.wallet.getMintInfo().isSupported(17);
    const params = nut17Info.params ?? [];

    return (
      nut17Info.supported &&
      params.some(
        (support: WebSocketSupport) =>
          support.method === 'bolt11' &&
          account.currency === currency &&
          support.commands.includes('bolt11_mint_quote'),
      )
    );
  }

  private getPendingMeltQuotes(
    pendingCashuReceiveQuotes: CashuReceiveQuote[],
  ): PendingMeltQuote[] {
    return pendingCashuReceiveQuotes
      .filter(
        (quote): quote is CashuReceiveQuote & { type: 'CASHU_TOKEN' } =>
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
    console.error(`Cashu receive quote processor error (${action})`, {
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
