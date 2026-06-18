import { describe, expect, it, mock } from 'bun:test';
import { Money } from '@agicash/money';
import type { CashuReceiveSwapService } from '../../domains/cashu/cashu-receive-swap-service';
import type { SdkEventMap } from '../../events';
import type { CashuAccount } from '../../types/account';
import type { CashuReceiveSwap } from '../../types/cashu';
import { SdkEventEmitter } from '../event-emitter';
import { CashuReceiveSwapOrchestrator } from './cashu-receive-swap-orchestrator';

const account = { id: 'acc-1' } as unknown as CashuAccount;
const swap = {
  tokenHash: 'h1',
  accountId: 'acc-1',
  state: 'PENDING',
  transactionId: 'tx-1',
  amountReceived: new Money({ amount: 10, currency: 'BTC', unit: 'sat' }),
} as unknown as CashuReceiveSwap;

describe('CashuReceiveSwapOrchestrator.processPending', () => {
  it('completes each pending swap and emits receive:completed', async () => {
    const emitter = new SdkEventEmitter<SdkEventMap>();
    const completeSwap = mock(async () => ({
      swap: { ...swap, state: 'COMPLETED' },
      account,
      addedProofs: ['p'],
    }));
    const orchestrator = new CashuReceiveSwapOrchestrator({
      receiveSwapService: {
        completeSwap,
      } as unknown as CashuReceiveSwapService,
      getAccount: mock(async () => account),
      emitter,
    });
    const events: unknown[] = [];
    emitter.on('receive:completed', (e) => events.push(e));
    await orchestrator.processPending([swap]);
    expect(completeSwap).toHaveBeenCalledWith(account, swap);
    expect(events).toHaveLength(1);
  });

  it('skips a swap whose account is missing', async () => {
    const completeSwap = mock(async () => ({ swap, account, addedProofs: [] }));
    const orchestrator = new CashuReceiveSwapOrchestrator({
      receiveSwapService: { completeSwap } as never,
      getAccount: mock(async () => null),
      emitter: new SdkEventEmitter<SdkEventMap>(),
    });
    await orchestrator.processPending([swap]);
    expect(completeSwap).not.toHaveBeenCalled();
  });
});
