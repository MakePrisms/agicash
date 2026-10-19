import {
  type SagaStint,
  type TaskSaga,
  runAction,
  startWorkingSet,
} from '../wallet/task-saga';
import type { CashuReceiveSwap } from './cashu-receive-swap';
import type { CashuReceiveSwapRepository } from './cashu-receive-swap-repository';
import type { CashuReceiveSwapService } from './cashu-receive-swap-service';

export type CashuReceiveSwapSagaDeps = {
  getRepository: () => Promise<CashuReceiveSwapRepository>;
  getService: () => Promise<CashuReceiveSwapService>;
};

/** Task processing for pending cashu receive swaps. Runs while this instance leads. */
export function createCashuReceiveSwapSaga(
  deps: CashuReceiveSwapSagaDeps,
): TaskSaga {
  return {
    name: 'cashu-receive-swap',
    start(stint) {
      let resetPending = false;
      const triggered = new Set<string>();
      let syncing = false;
      let syncAgain = false;

      const reset = (): void => {
        triggered.clear();
      };

      const resetIfPending = (): void => {
        if (!resetPending) {
          return;
        }
        resetPending = false;
        reset();
      };

      stint.onActivated(resetIfPending);
      stint.onReconnected(resetIfPending);

      const set = startWorkingSet<CashuReceiveSwap>(stint, {
        name: 'cashu-receive-swap',
        keyOf: (swap) => swap.tokenHash,
        isPending: (swap) => swap.state === 'PENDING',
        load: async (signal) => {
          const repository = await deps.getRepository();
          if (!stint.scope.alive) {
            return [];
          }
          return repository.getPending(stint.userId, { abortSignal: signal });
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
          const present = new Set(swaps.map((swap) => swap.tokenHash));
          for (const key of [...triggered]) {
            if (!present.has(key)) {
              triggered.delete(key);
            }
          }
          for (const swap of swaps) {
            if (!stint.scope.alive) {
              return;
            }
            const account = await stint.accounts.get(swap.accountId);
            if (!stint.scope.alive) {
              return;
            }
            if (!account?.isOnline) {
              continue;
            }
            if (triggered.has(swap.tokenHash)) {
              continue;
            }
            triggered.add(swap.tokenHash);
            startComplete(stint, swap.tokenHash);
          }
        } catch (error) {
          stint.logger.warn('Failed to load accounts for task processing', {
            saga: 'cashu-receive-swap',
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

      function startComplete(current: SagaStint, tokenHash: string): void {
        runAction(current, {
          key: `receive-swap-${tokenHash}`,
          retry: 3,
          attempt: async () => {
            const swap = set.get(tokenHash);
            if (!swap) {
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
            return service.completeSwap(account, swap);
          },
          onSuccess: (result) => {
            current.emit({
              event: 'cashu-receive-swap.updated',
              payload: { swap: result.swap },
            });
          },
          onError: (error) => {
            current.logger.error('Error finalizing receive swap', {
              cause: error,
              tokenHash,
            });
          },
          onGiveUp: () => {
            resetPending = true;
          },
        });
      }

      stint.on('cashu-receive-swap.created', ({ swap }) => {
        set.apply(swap);
      });
      stint.on('cashu-receive-swap.updated', ({ swap }) => {
        set.apply(swap);
      });
    },
  };
}
