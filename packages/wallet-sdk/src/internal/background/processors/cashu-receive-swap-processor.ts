import type { CashuReceiveSwap } from '../../../domains/cashu-receive-swap';
import type { WalletAccess } from '../../../engine';
import { defaultRetryPolicy } from '../../tasks/retry-policy';
import type { TaskRunner } from '../../tasks/task-runner';
import type { CashuReceiveSwapService } from '../../services/cashu-receive-swap-service';
import { OncePerKey } from '../once-per-key';
import type { Processor } from './processor';

export type CashuReceiveSwapProcessorDeps = {
  service: CashuReceiveSwapService;
  runner: TaskRunner;
  wallets: WalletAccess;
  fetchWorkSet: (userId: string) => Promise<CashuReceiveSwap[]>;
};

/**
 * Completes pending cashu receive swaps. Each pending swap runs a one-shot
 * `completeSwap` keyed by `tokenHash` (the app's `useQueries` trigger → OncePerKey),
 * on lane `receive-swap-${tokenHash}`. Port of `useProcessCashuReceiveSwapTasks`.
 */
export class CashuReceiveSwapProcessor implements Processor {
  private readonly dispatcher = new OncePerKey();
  private pending: CashuReceiveSwap[] = [];

  constructor(private readonly deps: CashuReceiveSwapProcessorDeps) {}

  async reload(userId: string): Promise<void> {
    this.pending = await this.deps.fetchWorkSet(userId);
    this.dispatcher.run(
      this.pending.map((swap) => swap.tokenHash),
      (tokenHash) => this.complete(tokenHash),
    );
  }

  dispose(): void {
    this.dispatcher.reset();
    this.pending = [];
  }

  private complete(tokenHash: string): void {
    const swap = this.pending.find((s) => s.tokenHash === tokenHash);
    if (!swap) return;
    void this.deps.runner
      .runTask(
        `receive-swap-${tokenHash}`,
        () =>
          this.deps.service.completeSwap(
            this.deps.wallets.getCashuAccount(swap.accountId),
            swap,
          ),
        defaultRetryPolicy,
      )
      .catch((error) =>
        console.error('Error finalizing receive swap', { cause: error, tokenHash }),
      );
  }
}
