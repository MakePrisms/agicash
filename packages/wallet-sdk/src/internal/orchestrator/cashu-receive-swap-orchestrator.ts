import type { CashuReceiveSwapService } from '../../domains/cashu/cashu-receive-swap-service';
import type { SdkEventMap } from '../../events';
import type { CashuAccount } from '../../types/account';
import type { CashuReceiveSwap } from '../../types/cashu';
import type { SdkEventEmitter } from '../event-emitter';

export type CashuReceiveSwapOrchestratorDeps = {
  receiveSwapService: CashuReceiveSwapService;
  getAccount: (accountId: string) => Promise<CashuAccount | null>;
  emitter: SdkEventEmitter<SdkEventMap>;
};

/** Completes pending same-mint cashu token claims (receive-swaps); poll-driven, no WS. */
export class CashuReceiveSwapOrchestrator {
  constructor(private readonly deps: CashuReceiveSwapOrchestratorDeps) {}

  async processPending(swaps: CashuReceiveSwap[]): Promise<void> {
    for (const swap of swaps) {
      if (swap.state !== 'PENDING') continue;
      const account = await this.deps.getAccount(swap.accountId);
      if (!account) continue;
      const result = await this.deps.receiveSwapService.completeSwap(
        account,
        swap,
      );
      if (result.swap.state === 'COMPLETED') {
        this.deps.emitter.emit('receive:completed', {
          quoteId: result.swap.tokenHash,
          transactionId: result.swap.transactionId,
          amount: result.swap.amountReceived,
          protocol: 'cashu',
        });
      }
    }
  }
}
