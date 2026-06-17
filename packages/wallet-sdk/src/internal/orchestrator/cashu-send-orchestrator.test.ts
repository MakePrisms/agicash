import { describe, expect, it, mock } from 'bun:test';
import { type MeltQuoteBolt11Response, MeltQuoteState } from '@cashu/cashu-ts';
import { Money } from '@agicash/money';
import type { SdkEventMap } from '../../events';
import { SdkEventEmitter } from '../event-emitter';
import type { CashuAccount } from '../../types/account';
import type { CashuSendQuote } from '../../types/cashu';
import type { CashuSendQuoteService } from '../../domains/cashu/cashu-send-quote-service';
import { CashuSendOrchestrator } from './cashu-send-orchestrator';

const account = {
  id: 'acc-1',
  mintUrl: 'https://mint.test',
  currency: 'BTC',
  wallet: {} as unknown,
} as unknown as CashuAccount;

function unpaidQuote(over: Partial<CashuSendQuote> = {}): CashuSendQuote {
  return {
    id: 'sq-1',
    quoteId: 'mq-1',
    accountId: 'acc-1',
    state: 'UNPAID',
    transactionId: 'tx-1',
    proofs: [],
    amountRequested: new Money({ amount: 100, currency: 'BTC', unit: 'sat' }),
    ...over,
  } as unknown as CashuSendQuote;
}

function makeDeps(over: Partial<CashuSendQuote> = {}) {
  const emitter = new SdkEventEmitter<SdkEventMap>();
  const sendQuoteService = {
    initiateSend: mock(async () => ({})),
    markSendQuoteAsPending: mock(async (q: CashuSendQuote) => ({ ...q, state: 'PENDING' })),
    completeSendQuote: mock(async (_a, q: CashuSendQuote) => ({
      ...q,
      state: 'PAID',
      amountRequested: q.amountRequested,
    })),
    failSendQuote: mock(async (_a, q: CashuSendQuote) => ({ ...q, state: 'FAILED' })),
  } as unknown as CashuSendQuoteService;
  const orchestrator = new CashuSendOrchestrator({
    sendQuoteService,
    sendQuoteRepository: {} as never,
    getAccount: mock(async () => account),
    meltSubscriptionManager: {} as never,
    emitter,
  });
  return { orchestrator, sendQuoteService, emitter, quote: unpaidQuote(over) };
}

describe('CashuSendOrchestrator.applyMeltQuoteState', () => {
  it('UNPAID + quote UNPAID → initiateSend', async () => {
    const { orchestrator, sendQuoteService, quote } = makeDeps();
    await orchestrator.applyMeltQuoteState(account, quote, {
      quote: 'mq-1',
      state: MeltQuoteState.UNPAID,
      amount: 100,
    } as MeltQuoteBolt11Response);
    expect(sendQuoteService.initiateSend).toHaveBeenCalledTimes(1);
  });

  it('UNPAID + quote already PENDING → no initiate', async () => {
    const { orchestrator, sendQuoteService, quote } = makeDeps({ state: 'PENDING' });
    await orchestrator.applyMeltQuoteState(account, quote, {
      quote: 'mq-1',
      state: MeltQuoteState.UNPAID,
      amount: 100,
    } as MeltQuoteBolt11Response);
    expect(sendQuoteService.initiateSend).not.toHaveBeenCalled();
  });

  it('PENDING → markSendQuoteAsPending + emits send:pending', async () => {
    const { orchestrator, sendQuoteService, emitter, quote } = makeDeps();
    const events: SdkEventMap['send:pending'][] = [];
    emitter.on('send:pending', (e) => events.push(e));
    await orchestrator.applyMeltQuoteState(account, quote, {
      quote: 'mq-1',
      state: MeltQuoteState.PENDING,
      amount: 100,
    } as MeltQuoteBolt11Response);
    expect(sendQuoteService.markSendQuoteAsPending).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ quoteId: 'sq-1', transactionId: 'tx-1', protocol: 'cashu' }]);
  });

  it('PAID (change present) → completeSendQuote + emits send:completed', async () => {
    const { orchestrator, sendQuoteService, emitter, quote } = makeDeps({ state: 'PENDING' });
    const events: unknown[] = [];
    emitter.on('send:completed', (e) => events.push(e));
    await orchestrator.applyMeltQuoteState(account, quote, {
      quote: 'mq-1',
      state: MeltQuoteState.PAID,
      amount: 100,
      change: [],
    } as unknown as MeltQuoteBolt11Response);
    expect(sendQuoteService.completeSendQuote).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
  });

  it('UNPAID initiate throws MintOperationError → failSendQuote + emits send:failed', async () => {
    const { orchestrator, sendQuoteService, emitter, quote } = makeDeps();
    const { MintOperationError } = await import('@cashu/cashu-ts');
    (sendQuoteService.initiateSend as ReturnType<typeof mock>).mockRejectedValueOnce(
      new MintOperationError(11000, 'token already spent'),
    );
    const failed: unknown[] = [];
    emitter.on('send:failed', (e) => failed.push(e));
    await orchestrator.applyMeltQuoteState(account, quote, {
      quote: 'mq-1',
      state: MeltQuoteState.UNPAID,
      amount: 100,
    } as MeltQuoteBolt11Response);
    expect(sendQuoteService.failSendQuote).toHaveBeenCalledTimes(1);
    expect(failed).toHaveLength(1);
  });
});

describe('CashuSendOrchestrator nutshell-#788 change refetch', () => {
  function paidDeps(inputSats: number, meltAmount: number, change: unknown[] | undefined) {
    const emitter = new SdkEventEmitter<SdkEventMap>();
    const checkMeltQuoteBolt11 = mock(async () => ({
      quote: 'mq-1',
      state: MeltQuoteState.PAID,
      amount: meltAmount,
      change: [{ id: 'x' }],
    }));
    const acct = {
      ...account,
      wallet: { checkMeltQuoteBolt11 },
    } as unknown as CashuAccount;
    const sendQuoteService = {
      completeSendQuote: mock(async (_a, q: CashuSendQuote) => ({ ...q, state: 'PAID' })),
    } as unknown as CashuSendQuoteService;
    const orchestrator = new CashuSendOrchestrator({
      sendQuoteService,
      sendQuoteRepository: {} as never,
      getAccount: mock(async () => acct),
      meltSubscriptionManager: {} as never,
      emitter,
    });
    const quote = unpaidQuote({
      state: 'PENDING',
      proofs: Array.from({ length: inputSats }, () => ({ amount: 1 })) as never,
    });
    const meltQuote = {
      quote: 'mq-1',
      state: MeltQuoteState.PAID,
      amount: meltAmount,
      change,
    } as unknown as MeltQuoteBolt11Response;
    return { orchestrator, sendQuoteService, checkMeltQuoteBolt11, acct, quote, meltQuote };
  }

  it('change expected but absent → refetches and completes with the refetched quote', async () => {
    const { orchestrator, sendQuoteService, checkMeltQuoteBolt11, acct, quote, meltQuote } =
      paidDeps(110, 100, undefined);
    await orchestrator.applyMeltQuoteState(acct, quote, meltQuote);
    expect(checkMeltQuoteBolt11).toHaveBeenCalledWith('mq-1');
    const passedMeltQuote = (sendQuoteService.completeSendQuote as ReturnType<typeof mock>).mock
      .calls[0][2] as MeltQuoteBolt11Response;
    expect(passedMeltQuote.change).toHaveLength(1); // refetched change reached completeSendQuote
  });

  it('change already present → no refetch', async () => {
    const { orchestrator, checkMeltQuoteBolt11, acct, quote, meltQuote } = paidDeps(110, 100, [
      { id: 'present' },
    ]);
    await orchestrator.applyMeltQuoteState(acct, quote, meltQuote);
    expect(checkMeltQuoteBolt11).not.toHaveBeenCalled();
  });

  it('no change expected (inputAmount <= amount) → no refetch', async () => {
    const { orchestrator, checkMeltQuoteBolt11, acct, quote, meltQuote } = paidDeps(100, 100, undefined);
    await orchestrator.applyMeltQuoteState(acct, quote, meltQuote);
    expect(checkMeltQuoteBolt11).not.toHaveBeenCalled();
  });
});
