import { describe, expect, it, mock } from 'bun:test';
import type { CashuSendSwapService } from '../../domains/cashu/cashu-send-swap-service';
import type { SdkEventMap } from '../../events';
import type { CashuAccount } from '../../types/account';
import type { CashuSendSwap, PendingCashuSendSwap } from '../../types/cashu';
import { SdkEventEmitter } from '../event-emitter';
import { CashuSendSwapOrchestrator } from './cashu-send-swap-orchestrator';

const account = {
  id: 'acc-1',
  mintUrl: 'm',
  currency: 'BTC',
  wallet: {},
} as unknown as CashuAccount;
const draft = {
  id: 'sw-1',
  accountId: 'acc-1',
  state: 'DRAFT',
} as unknown as CashuSendSwap;
const pending = {
  id: 'sw-2',
  accountId: 'acc-1',
  state: 'PENDING',
  proofsToSend: [{ unblindedSignature: 'C1' }],
} as unknown as PendingCashuSendSwap;

function makeDeps() {
  const swapForProofsToSend = mock(async () => undefined);
  const complete = mock(async () => undefined);
  const orchestrator = new CashuSendSwapOrchestrator({
    sendSwapService: {
      swapForProofsToSend,
      complete,
    } as unknown as CashuSendSwapService,
    getAccount: mock(async () => account),
    proofStateSubscriptionManager: {
      subscribe: mock(async () => () => undefined),
    } as never,
    emitter: new SdkEventEmitter<SdkEventMap>(),
  });
  return { orchestrator, swapForProofsToSend, complete };
}

describe('CashuSendSwapOrchestrator', () => {
  it('processDrafts → swapForProofsToSend per DRAFT swap', async () => {
    const { orchestrator, swapForProofsToSend } = makeDeps();
    await orchestrator.processDrafts([draft]);
    expect(swapForProofsToSend).toHaveBeenCalledWith({ account, swap: draft });
  });

  it('applyProofSpent → complete', async () => {
    const { orchestrator, complete } = makeDeps();
    await orchestrator.applyProofSpent(pending);
    expect(complete).toHaveBeenCalledWith(pending);
  });

  it('reconcile subscribes the proof-state manager for pending swaps', async () => {
    const subscribe = mock(async () => () => undefined);
    const orchestrator = new CashuSendSwapOrchestrator({
      sendSwapService: { complete: mock(async () => undefined) } as never,
      getAccount: mock(async () => account),
      proofStateSubscriptionManager: { subscribe } as never,
      emitter: new SdkEventEmitter<SdkEventMap>(),
    });
    await orchestrator.reconcile([pending]);
    expect(
      (
        (subscribe.mock.calls as unknown as unknown[][])[0][0] as {
          mintUrl: string;
        }
      ).mintUrl,
    ).toBe('m');
  });
});
