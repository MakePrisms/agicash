import {
  MutationObserver,
  type MutationScope,
  type QueryClient,
  QueryObserver,
} from '@tanstack/query-core';
import type { CashuAccount } from '../accounts/account';
import type { AccountsCache } from '../accounts/accounts-cache';
import type { CashuReceiveSwap } from '../receive/cashu-receive-swap';
import type { PendingCashuReceiveSwapsCache } from '../receive/cashu-receive-swap-cache';
import type { CashuReceiveSwapService } from '../receive/cashu-receive-swap-service';
import type { SagaProcessor } from './processor';

export type CashuReceiveSwapProcessorDeps = {
  queryClient: QueryClient;
  /** The receive-swap saga service the completeSwap transition calls. */
  cashuReceiveSwapService: CashuReceiveSwapService;
  /** The pending-swaps state the mutationFn re-reads the live entity from. */
  pendingCashuReceiveSwapsCache: PendingCashuReceiveSwapsCache;
  /** Accounts state: resolves the swap account + the online-account work-set filter. */
  accountsCache: AccountsCache;
  /** The query config for the current user's pending cashu receive swaps. */
  pendingCashuSwapsOptions: () => {
    queryKey: string[];
    queryFn: () => Promise<CashuReceiveSwap[]>;
    staleTime: number;
  };
};

/**
 * The cashu-receive-swap saga processor. The simplest family: work-set
 * membership IS the trigger. While active (leader) it watches the current
 * user's pending receive swaps that belong to an online cashu account and
 * fires `completeSwap` exactly once per swap (a per-tokenHash `QueryObserver`
 * with `staleTime: Infinity`, so it never refetches), dispatched through a
 * `MutationObserver` with retry 3 and NO cache write (the realtime broadcast
 * is the single write path).
 *
 * The transition re-reads the live entity from the pending cache and
 * early-returns if it is gone.
 */
export function createCashuReceiveSwapProcessor(
  deps: CashuReceiveSwapProcessorDeps,
): SagaProcessor {
  const {
    queryClient,
    cashuReceiveSwapService,
    pendingCashuReceiveSwapsCache,
    accountsCache,
    pendingCashuSwapsOptions,
  } = deps;

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

  // Fire-and-forget dispatch: the rejection is swallowed (onError/throwOnError
  // still run); the per-call scope rides in opts.
  function dispatch<TData, TVariables>(
    observer: MutationObserver<TData, Error, TVariables>,
    variables: TVariables,
    options?: { scope?: MutationScope },
  ): void {
    observer.mutate(variables, options).catch(() => undefined);
  }

  const completeSwapObserver = new MutationObserver<void, Error, string>(
    queryClient,
    {
      mutationFn: async (tokenHash) => {
        const swap = pendingCashuReceiveSwapsCache.get(tokenHash);
        if (!swap) {
          // This means that the swap is not pending anymore so it was removed from the cache.
          // This can happen if the swap was completed or failed in the meantime.
          return;
        }

        const account = getCashuAccount(swap.accountId);
        await cashuReceiveSwapService.completeSwap(account, swap);
      },
      retry: 3,
      throwOnError: true,
      onError: (error, tokenHash) => {
        console.error('Error finalizing receive swap', {
          cause: error,
          tokenHash,
        });
      },
    },
  );

  let workSetObserver: QueryObserver<CashuReceiveSwap[]> | null = null;
  let unsubscribeWorkSet: (() => void) | null = null;
  // The fire-once trigger observers, one per swap in the work-set.
  const triggerObservers = new Map<string, QueryObserver<boolean>>();
  const triggerUnsubscribes = new Map<string, () => void>();

  const selectOnline = (swaps: CashuReceiveSwap[]): CashuReceiveSwap[] =>
    swaps.filter((swap) => {
      const account = accountsCache.get(swap.accountId);
      return account?.isOnline;
    });

  const handleWorkSet = (swaps: CashuReceiveSwap[]) => {
    const wanted = new Set(swaps.map((s) => s.tokenHash));

    for (const [tokenHash, unsubscribe] of triggerUnsubscribes) {
      if (!wanted.has(tokenHash)) {
        unsubscribe();
        triggerObservers.get(tokenHash)?.destroy();
        triggerUnsubscribes.delete(tokenHash);
        triggerObservers.delete(tokenHash);
      }
    }

    for (const swap of swaps) {
      if (triggerObservers.has(swap.tokenHash)) {
        continue;
      }

      // Fire once (staleTime Infinity → never refetch); the queryFn dispatches
      // the completeSwap mutation and returns true.
      const observer = new QueryObserver<boolean>(queryClient, {
        queryKey: ['complete-cashu-receive-swap', swap.tokenHash],
        queryFn: () => {
          dispatch(completeSwapObserver, swap.tokenHash, {
            scope: { id: `receive-swap-${swap.tokenHash}` },
          });
          return true;
        },
        gcTime: 0,
        staleTime: Number.POSITIVE_INFINITY,
        retry: 0,
      });

      const unsubscribe = observer.subscribe(() => undefined);
      triggerObservers.set(swap.tokenHash, observer);
      triggerUnsubscribes.set(swap.tokenHash, unsubscribe);
    }
  };

  const clearTriggers = () => {
    for (const unsubscribe of triggerUnsubscribes.values()) {
      unsubscribe();
    }
    for (const observer of triggerObservers.values()) {
      observer.destroy();
    }
    triggerUnsubscribes.clear();
    triggerObservers.clear();
  };

  return {
    activate: () => {
      if (workSetObserver) {
        return;
      }

      workSetObserver = new QueryObserver<CashuReceiveSwap[]>(queryClient, {
        ...pendingCashuSwapsOptions(),
        refetchOnWindowFocus: 'always',
        refetchOnReconnect: 'always',
        throwOnError: true,
        select: selectOnline,
      });

      unsubscribeWorkSet = workSetObserver.subscribe((result) => {
        handleWorkSet(result.data ?? []);
      });

      handleWorkSet(workSetObserver.getCurrentResult().data ?? []);
    },
    deactivate: () => {
      unsubscribeWorkSet?.();
      unsubscribeWorkSet = null;
      workSetObserver?.destroy();
      workSetObserver = null;
      clearTriggers();
    },
  };
}
