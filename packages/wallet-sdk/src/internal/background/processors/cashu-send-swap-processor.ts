import type { CashuSendSwap, PendingCashuSendSwap } from '../../../domains/cashu-send-swap';
import type { WalletAccess } from '../../../engine';
import { ProofStateTracker } from '../../cashu/proof-state-tracker';
import { defaultRetryPolicy } from '../../tasks/retry-policy';
import type { TaskRunner } from '../../tasks/task-runner';
import type { CashuSendSwapService } from '../../services/cashu-send-swap-service';
import { OncePerKey } from '../once-per-key';
import type { Processor } from './processor';

export type CashuSendSwapProcessorDeps = {
  service: CashuSendSwapService;
  runner: TaskRunner;
  wallets: WalletAccess;
  fetchWorkSet: (userId: string) => Promise<CashuSendSwap[]>;
};

/**
 * Drives unresolved cashu send swaps. DRAFT swaps run a one-shot
 * `swapForProofsToSend` (the app's `useQueries` trigger → OncePerKey); PENDING
 * swaps complete when their proofs are observed SPENT over NUT-17 (ProofStateTracker
 * → `complete`). Both on lane `send-swap-${id}`. Port of `useProcessCashuSendSwapTasks`.
 */
export class CashuSendSwapProcessor implements Processor {
  private readonly proofTracker = new ProofStateTracker();
  private readonly draftDispatcher = new OncePerKey();
  private draft: CashuSendSwap[] = [];
  private pending: PendingCashuSendSwap[] = [];

  constructor(private readonly deps: CashuSendSwapProcessorDeps) {}

  async reload(userId: string): Promise<void> {
    const workSet = await this.deps.fetchWorkSet(userId);
    this.draft = workSet.filter((swap) => swap.state === 'DRAFT');
    this.pending = workSet.filter(
      (swap): swap is PendingCashuSendSwap => swap.state === 'PENDING',
    );

    this.proofTracker.update(this.pending, {
      getMintUrl: (accountId) => this.deps.wallets.getCashuAccount(accountId).mintUrl,
      onSpent: (swap) => this.complete(swap.id),
    });

    this.draftDispatcher.run(
      this.draft.map((swap) => swap.id),
      (id) => this.swap(id),
    );
  }

  dispose(): void {
    this.proofTracker.dispose();
    this.draftDispatcher.reset();
    this.draft = [];
    this.pending = [];
  }

  private swap(swapId: string): void {
    const swap = this.draft.find((s) => s.id === swapId);
    if (!swap) return;
    void this.deps.runner
      .runTask(
        `send-swap-${swap.id}`,
        () =>
          this.deps.service.swapForProofsToSend({
            account: this.deps.wallets.getCashuAccount(swap.accountId),
            swap,
          }),
        defaultRetryPolicy,
      )
      .catch((error) =>
        console.error('Error swapping for proofs to send', { cause: error, swapId }),
      );
  }

  private complete(swapId: string): void {
    const swap = this.pending.find((s) => s.id === swapId);
    if (!swap) return;
    void this.deps.runner
      .runTask(`send-swap-${swap.id}`, () => this.deps.service.complete(swap), defaultRetryPolicy)
      .catch((error) =>
        console.error('Error completing send swap', { cause: error, swapId }),
      );
  }
}
