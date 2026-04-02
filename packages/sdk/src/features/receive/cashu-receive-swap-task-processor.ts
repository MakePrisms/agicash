import {
  type FetchQueryOptions,
  type QueryClient,
  QueryObserver,
} from '@tanstack/query-core';
import type { CashuAccount } from '../accounts/account';
import { AccountsCache } from '../accounts/account-queries';
import type { AccountRepository } from '../accounts/account-repository';
import { TransactionsCache } from '../transactions/transaction-queries';
import type { CashuReceiveSwap } from './cashu-receive-swap';
import { PendingCashuReceiveSwapsCache } from './cashu-receive-swap-queries';
import type { CashuReceiveSwapService } from './cashu-receive-swap-service';

type PendingSwapsQueryFactory = () => FetchQueryOptions<
  CashuReceiveSwap[],
  Error
>;

type CashuReceiveSwapTaskProcessorEvents = {
  'swap:completed': {
    account: CashuAccount;
    addedProofs: string[];
    swap: CashuReceiveSwap;
  };
  error: {
    action: string;
    error: unknown;
    tokenHash?: string;
  };
};

type Listener<TEvent> = (event: TEvent) => void;

export class CashuReceiveSwapTaskProcessor {
  private readonly accountsCache: AccountsCache;
  private readonly listeners: {
    [K in keyof CashuReceiveSwapTaskProcessorEvents]: Set<
      Listener<CashuReceiveSwapTaskProcessorEvents[K]>
    >;
  } = {
    'swap:completed': new Set(),
    error: new Set(),
  };
  private readonly pendingSwapsCache: PendingCashuReceiveSwapsCache;
  private pendingSwapsObserver?: QueryObserver<CashuReceiveSwap[], Error>;
  private pendingSwapsObserverUnsubscribe?: () => void;
  private readonly scopeChains = new Map<string, Promise<void>>();
  private started = false;
  private trackingSignature = '';
  private trackingUpdateChain = Promise.resolve();
  private readonly transactionsCache: TransactionsCache;

  constructor(
    private readonly queryClient: QueryClient,
    private readonly accountRepository: AccountRepository,
    private readonly cashuReceiveSwapService: CashuReceiveSwapService,
    private readonly getPendingSwapsQuery: PendingSwapsQueryFactory,
  ) {
    this.accountsCache = new AccountsCache(queryClient);
    this.pendingSwapsCache = new PendingCashuReceiveSwapsCache(queryClient);
    this.transactionsCache = new TransactionsCache(queryClient);
  }

  on<K extends keyof CashuReceiveSwapTaskProcessorEvents>(
    event: K,
    listener: Listener<CashuReceiveSwapTaskProcessorEvents[K]>,
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
    this.pendingSwapsObserver = new QueryObserver(
      this.queryClient,
      this.getPendingSwapsQuery(),
    );
    this.pendingSwapsObserverUnsubscribe = this.pendingSwapsObserver.subscribe(
      (result) => {
        if (result.error) {
          this.handleError('observe-pending-cashu-receive-swaps', result.error);
        }

        if (result.data) {
          this.queueTrackingUpdate(result.data);
        }
      },
    );

    const currentResult = this.pendingSwapsObserver.getCurrentResult();
    if (currentResult.data) {
      this.queueTrackingUpdate(currentResult.data);
    }

    try {
      await this.queryClient.ensureQueryData(this.getPendingSwapsQuery());
    } catch (error) {
      this.handleError('load-pending-cashu-receive-swaps', error);
    }
  }

  async stop() {
    this.started = false;
    this.pendingSwapsObserverUnsubscribe?.();
    this.pendingSwapsObserverUnsubscribe = undefined;
    this.pendingSwapsObserver = undefined;
    this.trackingSignature = '';
  }

  private emit<K extends keyof CashuReceiveSwapTaskProcessorEvents>(
    event: K,
    payload: CashuReceiveSwapTaskProcessorEvents[K],
  ) {
    for (const listener of this.listeners[event]) {
      listener(payload);
    }
  }

  private queueTrackingUpdate(swaps: CashuReceiveSwap[]) {
    this.trackingUpdateChain = this.trackingUpdateChain
      .catch(() => undefined)
      .then(() => this.applyTracking(swaps))
      .catch((error) => {
        this.handleError('sync-cashu-receive-swap-tracking', error);
      });
  }

  private applyTracking(swaps: CashuReceiveSwap[]) {
    if (!this.started) {
      return;
    }

    const signature = JSON.stringify(
      swaps.map((swap) => ({
        tokenHash: swap.tokenHash,
        state: swap.state,
        version: swap.version,
      })),
    );

    if (signature === this.trackingSignature) {
      return;
    }

    this.trackingSignature = signature;

    for (const swap of swaps) {
      void this.completeSwap(swap.tokenHash);
    }
  }

  private async completeSwap(tokenHash: string) {
    await this.runInScope(`cashu-receive-swap-${tokenHash}`, async () => {
      const swap = this.pendingSwapsCache.get(tokenHash);
      if (!swap) {
        return;
      }

      try {
        const account = await this.getCashuAccount(swap.accountId);
        const result = await this.retry(
          () => this.cashuReceiveSwapService.completeSwap(account, swap),
          3,
        );

        await this.transactionsCache.invalidateTransaction(
          result.swap.transactionId,
        );
        this.pendingSwapsCache.remove(result.swap);
        this.emit('swap:completed', result);
      } catch (error) {
        console.error('Complete cashu receive swap error', {
          cause: error,
          tokenHash,
        });
        this.emit('error', {
          action: 'complete-cashu-receive-swap',
          error,
          tokenHash,
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

  private handleError(action: string, error: unknown, tokenHash?: string) {
    console.error(`Cashu receive swap processor error (${action})`, {
      cause: error,
      tokenHash,
    });
    this.emit('error', {
      action,
      error,
      tokenHash,
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
