import {
  MutationObserver,
  type MutationScope,
  type QueryClient,
  QueryObserver,
} from '@tanstack/query-core';
import type { CashuAccount } from '../accounts/account';
import type { AccountsCache } from '../accounts/accounts-cache';
import type {
  CashuSendSwap,
  PendingCashuSendSwap,
} from '../send/cashu-send-swap';
import type { CashuSendSwapCache } from '../send/cashu-send-swap-cache';
import type { CashuSendSwapService } from '../send/cashu-send-swap-service';
import type { SagaProcessor } from './processor';
import { ProofStateTracker } from './proof-state-tracker';

export type CashuSendSwapProcessorDeps = {
  queryClient: QueryClient;
  /** The send-swap saga service the transitions call. */
  cashuSendSwapService: CashuSendSwapService;
  /** The active-swap state the complete transition invalidates (full refetch). */
  cashuSendSwapCache: CashuSendSwapCache;
  /** Accounts state: resolves the swap account (mint url) + the online filter. */
  accountsCache: AccountsCache;
  /** The query config for the current user's unresolved cashu send swaps. */
  unresolvedCashuSwapsOptions: () => {
    queryKey: string[];
    queryFn: () => Promise<CashuSendSwap[]>;
    staleTime: number;
  };
};

/**
 * The cashu-send-swap saga processor. While active (leader) it watches the
 * current user's unresolved cashu send swaps that belong to an online cashu
 * account (offline-account swaps are not processed), partitioned into DRAFT and
 * PENDING, and runs two drivers:
 *  - DRAFT swaps fire `swapForProofsToSend` exactly once per swap (a per-id
 *    `QueryObserver` with `staleTime: Infinity`, so it never refetches),
 *    dispatched through a `MutationObserver` with retry 3 and NO cache write;
 *  - PENDING swaps are watched by a {@link ProofStateTracker}; when all of a
 *    swap's proofs are spent it dispatches `complete`, retry 3, whose onSuccess
 *    `cashuSendSwapCache.invalidate()`s (a full refetch, not a granular write).
 *
 * The DRAFT mutationFn re-reads the live entity from the DRAFT-partitioned
 * work-set and the PENDING mutationFn from the PENDING-partitioned work-set,
 * each early-returning if the swap is gone.
 */
export function createCashuSendSwapProcessor(
  deps: CashuSendSwapProcessorDeps,
): SagaProcessor {
  const {
    queryClient,
    cashuSendSwapService,
    cashuSendSwapCache,
    accountsCache,
    unresolvedCashuSwapsOptions,
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

  // The current partitions, re-read by the mutationFns when they run.
  let draftSwaps: (CashuSendSwap & { state: 'DRAFT' })[] = [];
  let pendingSwaps: PendingCashuSendSwap[] = [];

  const swapForProofsToSendObserver = new MutationObserver<void, Error, string>(
    queryClient,
    {
      mutationFn: async (swapId) => {
        const swap = draftSwaps.find((s) => s.id === swapId);
        if (!swap) {
          // This means that the swap is not in draft anymore so it was removed from the draft cache.
          // This can happen if the swap is now pending or it was completed, reversed or failed in the meantime.
          return;
        }

        const account = getCashuAccount(swap.accountId);
        await cashuSendSwapService.swapForProofsToSend({
          swap,
          account,
        });
      },
      retry: 3,
      throwOnError: true,
      onError: (error, swapId) => {
        console.error('Error swapping for proofs to send', {
          cause: error,
          swapId,
        });
      },
    },
  );

  const completeSwapObserver = new MutationObserver<void, Error, string>(
    queryClient,
    {
      mutationFn: async (swapId) => {
        const swap = pendingSwaps.find((s) => s.id === swapId);
        if (!swap) {
          // This means that the swap is not pending anymore so it was removed from the pending cache.
          // This can happen if the swap was completed, reversed or failed in the meantime.
          return;
        }

        await cashuSendSwapService.complete(swap);
      },
      retry: 3,
      throwOnError: true,
      onSuccess: () => {
        cashuSendSwapCache.invalidate();
      },
      onError: (error, swapId) => {
        console.error('Error completing send swap', {
          cause: error,
          swapId,
        });
      },
    },
  );

  const tracker = new ProofStateTracker({
    queryClient,
    getCashuAccount,
    onSpent: (swap) =>
      dispatch(completeSwapObserver, swap.id, {
        scope: { id: `send-swap-${swap.id}` },
      }),
  });

  let workSetObserver: QueryObserver<CashuSendSwap[]> | null = null;
  let unsubscribeWorkSet: (() => void) | null = null;
  // The fire-once DRAFT trigger observers, one per swap.
  const triggerObservers = new Map<string, QueryObserver<boolean>>();
  const triggerUnsubscribes = new Map<string, () => void>();

  const selectOnline = (swaps: CashuSendSwap[]): CashuSendSwap[] =>
    swaps.filter((swap) => {
      const account = accountsCache.get(swap.accountId);
      return account?.isOnline;
    });

  const handleWorkSet = (swaps: CashuSendSwap[]) => {
    // Partition the work set into draft/pending.
    const draft: (CashuSendSwap & { state: 'DRAFT' })[] = [];
    const pending: PendingCashuSendSwap[] = [];
    for (const swap of swaps) {
      if (swap.state === 'DRAFT') {
        draft.push(swap as CashuSendSwap & { state: 'DRAFT' });
      } else if (swap.state === 'PENDING') {
        pending.push(swap as PendingCashuSendSwap);
      }
    }
    draftSwaps = draft;
    pendingSwaps = pending;

    // PENDING driver: (re)subscribe the proof-state tracker.
    tracker.setSwaps(pending);

    // DRAFT driver: fire-once per swap id. Add a trigger for new drafts, drop
    // triggers whose swap is no longer DRAFT.
    const wanted = new Set(draft.map((s) => s.id));
    for (const [swapId, unsubscribe] of triggerUnsubscribes) {
      if (!wanted.has(swapId)) {
        unsubscribe();
        triggerObservers.get(swapId)?.destroy();
        triggerUnsubscribes.delete(swapId);
        triggerObservers.delete(swapId);
      }
    }

    for (const swap of draft) {
      if (triggerObservers.has(swap.id)) {
        continue;
      }

      // Fire once (staleTime Infinity → never refetch); the queryFn dispatches
      // the swapForProofsToSend mutation and returns true.
      const observer = new QueryObserver<boolean>(queryClient, {
        queryKey: ['trigger-send-swap', swap.id],
        queryFn: () => {
          dispatch(swapForProofsToSendObserver, swap.id, {
            scope: { id: `send-swap-${swap.id}` },
          });
          return true;
        },
        gcTime: 0,
        staleTime: Number.POSITIVE_INFINITY,
        retry: 0,
      });

      const unsubscribe = observer.subscribe(() => undefined);
      triggerObservers.set(swap.id, observer);
      triggerUnsubscribes.set(swap.id, unsubscribe);
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

      // The unresolved-send-swaps work set, filtered to online cashu
      // accounts, refetched on focus/reconnect.
      workSetObserver = new QueryObserver<CashuSendSwap[]>(queryClient, {
        ...unresolvedCashuSwapsOptions(),
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
      draftSwaps = [];
      pendingSwaps = [];
      clearTriggers();
      tracker.stop();
    },
  };
}
