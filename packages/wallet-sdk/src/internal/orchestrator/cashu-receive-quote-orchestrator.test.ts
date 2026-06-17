import { describe, expect, it, mock } from 'bun:test';
import { type MintQuoteBolt11Response, MintQuoteState } from '@cashu/cashu-ts';
import { Money } from '@agicash/money';
import type { SdkEventMap } from '../../events';
import { SdkEventEmitter } from '../event-emitter';
import type { CashuAccount } from '../../types/account';
import type { CashuReceiveQuote } from '../../types/cashu';
import type { CashuReceiveQuoteService } from '../../domains/cashu/cashu-receive-quote-service';
import { CashuReceiveQuoteOrchestrator } from './cashu-receive-quote-orchestrator';

const account = { id: 'acc-1', mintUrl: 'm', currency: 'BTC', wallet: {} } as unknown as CashuAccount;
const quote = {
  id: 'rq-1',
  quoteId: 'mintq-1',
  accountId: 'acc-1',
  type: 'LIGHTNING',
  state: 'UNPAID',
  transactionId: 'tx-1',
  amount: new Money({ amount: 50, currency: 'BTC', unit: 'sat' }),
} as unknown as CashuReceiveQuote;

function makeDeps() {
  const emitter = new SdkEventEmitter<SdkEventMap>();
  const completeReceive = mock(async () => ({
    quote: { ...quote, state: 'COMPLETED' },
    account,
    addedProofs: ['p1'],
  }));
  const receiveQuoteService = { completeReceive } as unknown as CashuReceiveQuoteService;
  const orchestrator = new CashuReceiveQuoteOrchestrator({
    receiveQuoteService,
    getAccount: mock(async () => account),
    mintSubscriptionManager: { subscribe: mock(async () => () => {}) } as never,
    meltSubscriptionManager: {} as never,
    emitter,
  });
  return { orchestrator, completeReceive, emitter };
}

describe('CashuReceiveQuoteOrchestrator.applyMintQuoteState', () => {
  it('PAID → completeReceive + emits receive:completed', async () => {
    const { orchestrator, completeReceive, emitter } = makeDeps();
    const events: unknown[] = [];
    emitter.on('receive:completed', (e) => events.push(e));
    await orchestrator.applyMintQuoteState(account, quote, {
      quote: 'mintq-1',
      state: MintQuoteState.PAID,
    } as MintQuoteBolt11Response);
    expect(completeReceive).toHaveBeenCalledWith(account, quote);
    expect(events).toHaveLength(1);
  });

  it('ISSUED → completeReceive (idempotent recovery)', async () => {
    const { orchestrator, completeReceive } = makeDeps();
    await orchestrator.applyMintQuoteState(account, quote, {
      quote: 'mintq-1',
      state: MintQuoteState.ISSUED,
    } as MintQuoteBolt11Response);
    expect(completeReceive).toHaveBeenCalledTimes(1);
  });

  it('UNPAID → no-op', async () => {
    const { orchestrator, completeReceive } = makeDeps();
    await orchestrator.applyMintQuoteState(account, quote, {
      quote: 'mintq-1',
      state: MintQuoteState.UNPAID,
    } as MintQuoteBolt11Response);
    expect(completeReceive).not.toHaveBeenCalled();
  });
});
