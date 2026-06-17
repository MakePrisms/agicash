import { describe, expect, it, mock } from 'bun:test';
import { type MintQuoteBolt11Response, MeltQuoteState, MintQuoteState } from '@cashu/cashu-ts';
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

const tokenQuote = {
  id: 'rq-2',
  accountId: 'acc-1',
  type: 'CASHU_TOKEN',
  state: 'UNPAID',
  transactionId: 'tx-2',
  amount: new Money({ amount: 40, currency: 'BTC', unit: 'sat' }),
  tokenReceiveData: {
    sourceMintUrl: 'https://source.mint',
    meltQuoteId: 'src-melt-1',
    meltInitiated: false,
    tokenProofs: [{ amount: 1 }],
    tokenAmount: new Money({ amount: 50, currency: 'BTC', unit: 'sat' }),
    cashuReceiveFee: new Money({ amount: 1, currency: 'BTC', unit: 'sat' }),
    lightningFeeReserve: new Money({ amount: 1, currency: 'BTC', unit: 'sat' }),
  },
} as unknown as CashuReceiveQuote;

describe('CashuReceiveQuoteOrchestrator.applyCrossMintMeltState', () => {
  function makeMeltDeps(over: Partial<{ meltInitiated: boolean }> = {}) {
    const emitter = new SdkEventEmitter<SdkEventMap>();
    const markMeltInitiated = mock(async () => tokenQuote);
    const fail = mock(async () => {});
    const orchestrator = new CashuReceiveQuoteOrchestrator({
      receiveQuoteService: { markMeltInitiated, fail } as never,
      getAccount: mock(async () => account),
      mintSubscriptionManager: {} as never,
      meltSubscriptionManager: { subscribe: mock(async () => () => {}) } as never,
      emitter,
    });
    const tq = tokenQuote as CashuReceiveQuote & { type: 'CASHU_TOKEN' };
    const q = {
      ...tq,
      tokenReceiveData: { ...tq.tokenReceiveData, meltInitiated: over.meltInitiated ?? false },
    } as CashuReceiveQuote;
    return { orchestrator, q, markMeltInitiated, fail, emitter };
  }

  it('UNPAID + not initiated → initiateMelt callback fired', async () => {
    const { orchestrator, q } = makeMeltDeps({ meltInitiated: false });
    const initiateMelt = mock(async () => {});
    await orchestrator.applyCrossMintMeltState(q as never, { quote: 'src-melt-1', state: MeltQuoteState.UNPAID, amount: 40 } as never, { initiateMelt });
    expect(initiateMelt).toHaveBeenCalledWith(q);
  });

  it('PENDING → markMeltInitiated', async () => {
    const { orchestrator, q, markMeltInitiated } = makeMeltDeps();
    await orchestrator.applyCrossMintMeltState(q as never, { quote: 'src-melt-1', state: MeltQuoteState.PENDING, amount: 40 } as never, { initiateMelt: mock(async () => {}) });
    expect(markMeltInitiated).toHaveBeenCalledTimes(1);
  });

  it('UNPAID + already initiated → fail + emits receive:failed', async () => {
    const { orchestrator, q, fail, emitter } = makeMeltDeps({ meltInitiated: true });
    const failed: unknown[] = [];
    emitter.on('receive:failed', (e) => failed.push(e));
    await orchestrator.applyCrossMintMeltState(q as never, { quote: 'src-melt-1', state: MeltQuoteState.UNPAID, amount: 40 } as never, { initiateMelt: mock(async () => {}) });
    expect(fail).toHaveBeenCalledTimes(1);
    expect(failed).toHaveLength(1);
  });
});

describe('CashuReceiveQuoteOrchestrator.reconcileCrossMintMelts', () => {
  it('subscribes the melt manager once with the correct mintUrl and quoteIds', async () => {
    const subscribe = mock(async () => () => {});
    const orchestrator = new CashuReceiveQuoteOrchestrator({
      receiveQuoteService: {} as never,
      getAccount: mock(async () => account),
      mintSubscriptionManager: {} as never,
      meltSubscriptionManager: { subscribe } as never,
      emitter: new SdkEventEmitter<SdkEventMap>(),
    });
    await orchestrator.reconcileCrossMintMelts(
      [tokenQuote as CashuReceiveQuote & { type: 'CASHU_TOKEN' }],
      { initiateMelt: mock(async () => {}) },
    );
    expect(subscribe).toHaveBeenCalledTimes(1);
    const call = (subscribe.mock.calls as unknown as [{ mintUrl: string; quoteIds: string[] }[]])[0][0];
    expect(call.mintUrl).toBe('https://source.mint');
    expect(call.quoteIds).toEqual(['src-melt-1']);
  });
});
