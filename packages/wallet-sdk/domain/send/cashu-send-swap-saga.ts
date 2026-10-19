import type { Logger } from '../sdk';
import {
  GIVE_UP_RETRY_MS,
  type SagaStint,
  type TaskSaga,
  runAction,
  runWithRetry,
  startWorkingSet,
} from '../wallet/task-saga';
import type { CashuSendSwap, PendingCashuSendSwap } from './cashu-send-swap';
import type { CashuSendSwapRepository } from './cashu-send-swap-repository';
import type { CashuSendSwapService } from './cashu-send-swap-service';
import { ProofStateSubscriptionManager } from './proof-state-subscription-manager';

export type CashuSendSwapSagaDeps = {
  getRepository: () => Promise<CashuSendSwapRepository>;
  getService: () => Promise<CashuSendSwapService>;
  /** Test seam; defaults to `new ProofStateSubscriptionManager(logger)`. */
  createProofStateManager?: (logger: Logger) => ProofStateSubscriptionManager;
};

/** Task processing for unresolved cashu send swaps. Runs while this instance leads. */
export function createCashuSendSwapSaga(deps: CashuSendSwapSagaDeps): TaskSaga {
  return {
    name: 'cashu-send-swap',
    start(stint) {
      let resetPending = false;
      const triggered = new Set<string>();
      let syncing = false;
      let syncAgain = false;
      const manager = (
        deps.createProofStateManager ??
        ((logger: Logger) => new ProofStateSubscriptionManager(logger))
      )(stint.logger);

      const reset = (): void => {
        triggered.clear();
        manager.unsubscribeAll();
      };

      const resetIfPending = (): void => {
        if (!resetPending) {
          return;
        }
        resetPending = false;
        reset();
        void runSync();
      };

      stint.onActivated(resetIfPending);
      stint.onReconnected(resetIfPending);
      stint.scope.every(GIVE_UP_RETRY_MS, resetIfPending);
      stint.scope.onCleanup(() => {
        manager.unsubscribeAll();
      });

      const set = startWorkingSet<CashuSendSwap>(stint, {
        name: 'cashu-send-swap',
        keyOf: (swap) => swap.id,
        isPending: (swap) => swap.state === 'DRAFT' || swap.state === 'PENDING',
        load: async (signal) => {
          const repository = await deps.getRepository();
          if (!stint.scope.alive) {
            return [];
          }
          return repository.getUnresolved(stint.userId, {
            abortSignal: signal,
          });
        },
        onChange: () => {
          void runSync();
        },
      });

      async function runSync(): Promise<void> {
        if (!stint.scope.alive) {
          return;
        }
        if (syncing) {
          syncAgain = true;
          return;
        }
        syncing = true;
        try {
          const swaps = set.values();
          const draftIds = new Set<string>();
          const pendingByMint = new Map<string, PendingCashuSendSwap[]>();
          for (const swap of swaps) {
            if (!stint.scope.alive) {
              return;
            }
            const account = await stint.accounts.get(swap.accountId);
            if (!stint.scope.alive) {
              return;
            }
            if (!account?.isOnline || account.type !== 'cashu') {
              continue;
            }
            const current = set.get(swap.id);
            if (!current) {
              continue;
            }
            if (current.state === 'DRAFT') {
              draftIds.add(current.id);
              if (!triggered.has(current.id)) {
                triggered.add(current.id);
                startSwap(stint, current.id);
              }
              continue;
            }
            if (current.state !== 'PENDING') {
              continue;
            }
            const cashu = await stint.accounts.getCashu(current.accountId);
            if (!stint.scope.alive) {
              return;
            }
            const group = pendingByMint.get(cashu.mintUrl) ?? [];
            group.push(current as PendingCashuSendSwap);
            pendingByMint.set(cashu.mintUrl, group);
          }
          if (!stint.scope.alive) {
            return;
          }
          for (const key of [...triggered]) {
            if (!draftIds.has(key)) {
              triggered.delete(key);
            }
          }
          for (const [mintUrl, mintSwaps] of pendingByMint) {
            startSubscribe(stint, mintUrl, mintSwaps);
          }
        } catch (error) {
          stint.logger.warn('Failed to load accounts for task processing', {
            saga: 'cashu-send-swap',
            cause: error,
          });
        } finally {
          syncing = false;
          if (syncAgain && stint.scope.alive) {
            syncAgain = false;
            void runSync();
          }
        }
      }

      function startSwap(current: SagaStint, swapId: string): void {
        runAction(current, {
          key: `send-swap-${swapId}`,
          retry: 3,
          attempt: async () => {
            const swap = set.get(swapId);
            if (swap?.state !== 'DRAFT') {
              return undefined;
            }
            const account = await current.accounts.getCashu(swap.accountId);
            if (!current.scope.alive) {
              return undefined;
            }
            const service = await deps.getService();
            if (!current.scope.alive) {
              return undefined;
            }
            await service.swapForProofsToSend({ swap, account });
            return undefined;
          },
          onError: (error) => {
            current.logger.error('Error swapping for proofs to send', {
              cause: error,
              swapId,
            });
          },
          onGiveUp: () => {
            resetPending = true;
          },
        });
      }

      function startComplete(current: SagaStint, swapId: string): void {
        runAction(current, {
          key: `send-swap-${swapId}`,
          retry: 3,
          attempt: async () => {
            const swap = set.get(swapId);
            if (swap?.state !== 'PENDING') {
              return undefined;
            }
            const service = await deps.getService();
            if (!current.scope.alive) {
              return undefined;
            }
            await service.complete(swap);
            return undefined;
          },
          onError: (error) => {
            current.logger.error('Error completing send swap', {
              cause: error,
              swapId,
            });
          },
          onGiveUp: () => {
            resetPending = true;
          },
        });
      }

      function startSubscribe(
        current: SagaStint,
        mintUrl: string,
        swaps: PendingCashuSendSwap[],
      ): void {
        const run = (async () => {
          const outcome = await runWithRetry(
            current,
            async () => {
              if (!current.scope.alive) {
                return;
              }
              await manager.subscribe({
                mintUrl,
                swaps,
                onSpent: (swap) => {
                  if (!current.scope.alive) {
                    return;
                  }
                  startComplete(current, swap.id);
                },
              });
            },
            5,
          );
          if (!current.scope.alive) {
            return;
          }
          if (outcome.status === 'failed') {
            current.logger.error('Failed to subscribe to proof state updates', {
              cause: outcome.error,
              mintUrl,
            });
          }
        })();
        current.scope.track(run);
      }

      stint.on('cashu-send-swap.created', ({ swap }) => {
        set.apply(swap);
      });
      stint.on('cashu-send-swap.updated', ({ swap }) => {
        set.apply(swap);
      });
    },
  };
}
