import type { CashuSendSwapService } from '../../domains/cashu/cashu-send-swap-service';
import type { SdkEventMap } from '../../events';
import type { CashuAccount } from '../../types/account';
import type { CashuSendSwap, PendingCashuSendSwap } from '../../types/cashu';
import type { SdkEventEmitter } from '../event-emitter';
import type { ProofStateSubscriptionManager } from '../lib/cashu/proof-state-subscription-manager';

export type CashuSendSwapOrchestratorDeps = {
  sendSwapService: CashuSendSwapService;
  getAccount: (accountId: string) => Promise<CashuAccount | null>;
  proofStateSubscriptionManager: ProofStateSubscriptionManager;
  emitter: SdkEventEmitter<SdkEventMap>;
};

/** Drives cashu token sends: DRAFT → PENDING (swap), then PENDING → COMPLETED when proofs are spent. */
export class CashuSendSwapOrchestrator {
  constructor(private readonly deps: CashuSendSwapOrchestratorDeps) {}

  /** Push each DRAFT swap to PENDING by swapping out the proofs to send. */
  async processDrafts(swaps: CashuSendSwap[]): Promise<void> {
    for (const swap of swaps) {
      if (swap.state !== 'DRAFT') continue;
      const account = await this.deps.getAccount(swap.accountId);
      if (!account) continue;
      await this.deps.sendSwapService.swapForProofsToSend({ account, swap });
    }
  }

  /** All proofs of a pending swap were spent (recipient redeemed) → mark COMPLETED. */
  async applyProofSpent(swap: CashuSendSwap): Promise<void> {
    await this.deps.sendSwapService.complete(swap);
  }

  /** Subscribe the proof-state websocket for the given pending swaps (one per mint). */
  async reconcile(pending: PendingCashuSendSwap[]): Promise<void> {
    if (pending.length === 0) return;
    const byMint = new Map<string, PendingCashuSendSwap[]>();
    for (const swap of pending) {
      const account = await this.deps.getAccount(swap.accountId);
      if (!account) continue;
      const list = byMint.get(account.mintUrl) ?? [];
      list.push(swap);
      byMint.set(account.mintUrl, list);
    }
    for (const [mintUrl, swaps] of byMint) {
      await this.deps.proofStateSubscriptionManager.subscribe({
        mintUrl,
        swaps,
        onSpent: (swap) => {
          void this.applyProofSpent(swap).catch((error) =>
            console.error('cashu send swap complete failed', { cause: error }),
          );
        },
      });
    }
  }
}
