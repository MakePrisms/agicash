import {
  type FetchQueryOptions,
  type QueryClient,
  QueryObserver,
} from '@tanstack/query-core';
import type { CashuAccount } from '../accounts/account';
import { AccountsCache } from '../accounts/account-queries';
import type { AccountRepository } from '../accounts/account-repository';
import { TransactionsCache } from '../transactions/transaction-queries';
import type { CashuSendSwap, PendingCashuSendSwap } from './cashu-send-swap';
import {
  CashuSendSwapCache,
  UnresolvedCashuSendSwapsCache,
} from './cashu-send-swap-queries';
import type { CashuSendSwapService } from './cashu-send-swap-service';
import { ProofStateSubscriptionManager } from './proof-state-subscription-manager';

type UnresolvedSwapsQueryFactory = () => FetchQueryOptions<
  CashuSendSwap[],
  Error
>;

type CashuSendSwapTaskProcessorEvents = {
  'swap:completed': { swapId: string };
  error: {
    action: string;
    error: unknown;
    swapId?: string;
  };
};

type Listener<TEvent> = (event: TEvent) => void;

export class CashuSendSwapTaskProcessor {
  private readonly accountsCache: AccountsCache;
  private readonly cashuSendSwapCache: CashuSendSwapCache;
  private readonly listeners: {
    [K in keyof CashuSendSwapTaskProcessorEvents]: Set<
      Listener<CashuSendSwapTaskProcessorEvents[K]>
    >;
  } = {
    'swap:completed': new Set(),
    error: new Set(),
  };
  private readonly scopeChains = new Map<string, Promise<void>>();
  private started = false;
  private readonly subscriptionManager: ProofStateSubscriptionManager;
  private trackingSignature = '';
  private trackingUpdateChain = Promise.resolve();
  private readonly transactionsCache: TransactionsCache;
  private readonly unresolvedSwapsCache: UnresolvedCashuSendSwapsCache;
  private unresolvedSwapsObserver?: QueryObserver<CashuSendSwap[], Error>;
  private unresolvedSwapsObserverUnsubscribe?: () => void;

  constructor(
    private readonly queryClient: QueryClient,
    private readonly accountRepository: AccountRepository,
    private readonly cashuSendSwapService: CashuSendSwapService,
    private readonly getUnresolvedSwapsQuery: UnresolvedSwapsQueryFactory,
  ) {
    this.accountsCache = new AccountsCache(queryClient);
    this.cashuSendSwapCache = new CashuSendSwapCache(queryClient);
    this.subscriptionManager = new ProofStateSubscriptionManager();
    this.transactionsCache = new TransactionsCache(queryClient);
    this.unresolvedSwapsCache = new UnresolvedCashuSendSwapsCache(queryClient);
  }

  on<K extends keyof CashuSendSwapTaskProcessorEvents>(
    event: K,
    listener: Listener<CashuSendSwapTaskProcessorEvents[K]>,
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
    this.unresolvedSwapsObserver = new QueryObserver(
      this.queryClient,
      this.getUnresolvedSwapsQuery(),
    );
    this.unresolvedSwapsObserverUnsubscribe =
      this.unresolvedSwapsObserver.subscribe((result) => {
        if (result.error) {
          this.handleError('observe-unresolved-cashu-send-swaps', result.error);
        }

        if (result.data) {
          this.queueTrackingUpdate(result.data);
        }
      });

    const currentResult = this.unresolvedSwapsObserver.getCurrentResult();
    if (currentResult.data) {
      this.queueTrackingUpdate(currentResult.data);
    }

    try {
      await this.queryClient.ensureQueryData(this.getUnresolvedSwapsQuery());
    } catch (error) {
      this.handleError('load-unresolved-cashu-send-swaps', error);
    }
  }

  async stop() {
    this.started = false;
    this.unresolvedSwapsObserverUnsubscribe?.();
    this.unresolvedSwapsObserverUnsubscribe = undefined;
    this.unresolvedSwapsObserver = undefined;
    this.trackingSignature = '';
  }

  private emit<K extends keyof CashuSendSwapTaskProcessorEvents>(
    event: K,
    payload: CashuSendSwapTaskProcessorEvents[K],
  ) {
    for (const listener of this.listeners[event]) {
      listener(payload);
    }
  }

  private queueTrackingUpdate(swaps: CashuSendSwap[]) {
    this.trackingUpdateChain = this.trackingUpdateChain
      .catch(() => undefined)
      .then(() => this.applyTracking(swaps))
      .catch((error) => {
        this.handleError('sync-cashu-send-swap-tracking', error);
      });
  }

  private async applyTracking(swaps: CashuSendSwap[]) {
    if (!this.started) {
      return;
    }

    const signature = JSON.stringify(
      swaps.map((swap) => ({
        id: swap.id,
        state: swap.state,
        version: swap.version,
      })),
    );

    if (signature === this.trackingSignature) {
      return;
    }

    this.trackingSignature = signature;

    const draftSwaps: (CashuSendSwap & { state: 'DRAFT' })[] = [];
    const pendingSwaps: PendingCashuSendSwap[] = [];

    for (const swap of swaps) {
      if (swap.state === 'DRAFT') {
        draftSwaps.push(swap);
      } else if (swap.state === 'PENDING') {
        pendingSwaps.push(swap as PendingCashuSendSwap);
      }
    }

    // Process DRAFT swaps: swap for proofs to send (DRAFT -> PENDING)
    for (const swap of draftSwaps) {
      void this.swapForProofsToSend(swap.id);
    }

    // Process PENDING swaps: subscribe to proof state changes
    if (pendingSwaps.length > 0) {
      this.subscribeToPendingSwaps(pendingSwaps);
    }
  }

  private async swapForProofsToSend(swapId: string) {
    await this.runInScope(`send-swap-${swapId}`, async () => {
      try {
        const swaps = this.queryClient.getQueryData<CashuSendSwap[]>(
          this.getUnresolvedSwapsQuery().queryKey,
        );
        const swap = swaps?.find((s) => s.id === swapId && s.state === 'DRAFT');
        if (!swap) {
          return;
        }

        const account = await this.getCashuAccount(swap.accountId);
        await this.retry(
          () =>
            this.cashuSendSwapService.swapForProofsToSend({ swap, account }),
          3,
        );
      } catch (error) {
        console.error('Error swapping for proofs to send', {
          cause: error,
          swapId,
        });
        this.emit('error', {
          action: 'swap-for-proofs-to-send',
          error,
          swapId,
        });
      }
    });
  }

  private subscribeToPendingSwaps(swaps: PendingCashuSendSwap[]) {
    const swapsByMint = swaps.reduce<Record<string, PendingCashuSendSwap[]>>(
      (acc, swap) => {
        const account = this.accountsCache.get(swap.accountId);
        if (!account || account.type !== 'cashu') {
          return acc;
        }
        const existing = acc[account.mintUrl] ?? [];
        acc[account.mintUrl] = existing.concat(swap);
        return acc;
      },
      {},
    );

    for (const [mintUrl, mintSwaps] of Object.entries(swapsByMint)) {
      void this.subscriptionManager
        .subscribe({
          mintUrl,
          swaps: mintSwaps,
          onSpent: (swap) => void this.completeSwap(swap.id),
        })
        .catch((error) => {
          console.error('Failed to subscribe to proof state updates', {
            cause: error,
            mintUrl,
          });
          this.emit('error', {
            action: 'subscribe-proof-state-updates',
            error,
          });
        });
    }
  }

  private async completeSwap(swapId: string) {
    await this.runInScope(`send-swap-${swapId}`, async () => {
      try {
        const swaps = this.queryClient.getQueryData<CashuSendSwap[]>(
          this.getUnresolvedSwapsQuery().queryKey,
        );
        const swap = swaps?.find(
          (s) => s.id === swapId && s.state === 'PENDING',
        );
        if (!swap) {
          return;
        }

        await this.retry(() => this.cashuSendSwapService.complete(swap), 3);

        await this.transactionsCache.invalidateTransaction(swap.transactionId);
        this.unresolvedSwapsCache.remove(swap);
        await this.cashuSendSwapCache.invalidate();
        this.emit('swap:completed', { swapId });
      } catch (error) {
        console.error('Error completing send swap', {
          cause: error,
          swapId,
        });
        this.emit('error', {
          action: 'complete-cashu-send-swap',
          error,
          swapId,
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

  private handleError(action: string, error: unknown, swapId?: string) {
    console.error(`Cashu send swap processor error (${action})`, {
      cause: error,
      swapId,
    });
    this.emit('error', {
      action,
      error,
      swapId,
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
