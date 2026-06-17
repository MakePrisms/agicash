import { describe, expect, it, mock } from 'bun:test';
import { Money } from '@agicash/money';
import type { Payment } from '@agicash/breez-sdk-spark';
import { DomainError } from '../../errors';
import { SdkEventEmitter } from '../event-emitter';
import type { SdkEventMap } from '../../events';
import type { SparkAccount } from '../../types/account';
import type { SparkSendQuote } from '../../types/spark';
import type { SparkSendQuoteService } from '../../domains/spark/spark-send-quote-service';
import { SparkSendOrchestrator } from './spark-send-orchestrator';

const sats = (n: number) =>
  new Money({ amount: n, currency: 'BTC', unit: 'sat' }) as Money;
const account = {
  id: 'acc-1',
  type: 'spark',
  currency: 'BTC',
} as unknown as SparkAccount;

function unpaid(over: Partial<SparkSendQuote> = {}): SparkSendQuote {
  return {
    id: 'sq-1',
    state: 'UNPAID',
    amount: sats(100),
    transactionId: 'tx-1',
    accountId: 'acc-1',
    expiresAt: null,
    paymentHash: 'ph-1',
    paymentRequest: 'lnbc1',
    ...over,
  } as unknown as SparkSendQuote;
}
function pending(over: Partial<SparkSendQuote> = {}): SparkSendQuote {
  return {
    ...unpaid(),
    state: 'PENDING',
    sparkTransferId: 'pay-1',
    ...over,
  } as unknown as SparkSendQuote;
}
function lightningPayment(
  over: { id?: string; status?: Payment['status']; preimage?: string } = {},
): Payment {
  return {
    id: over.id ?? 'pay-1',
    status: over.status ?? 'completed',
    amount: 100n,
    fees: 0n,
    details: {
      type: 'lightning',
      htlcDetails: {
        paymentHash: 'ph-1',
        preimage: over.preimage,
        status: 'preimageShared',
      },
    },
  } as unknown as Payment;
}

function makeDeps(
  serviceOver: Partial<Record<keyof SparkSendQuoteService, unknown>> = {},
) {
  const emitter = new SdkEventEmitter<SdkEventMap>();
  const sendQuoteService = {
    initiateSend: mock(
      async ({ sendQuote }: { sendQuote: SparkSendQuote }) => ({
        ...sendQuote,
        state: 'PENDING',
        sparkTransferId: 'pay-1',
      }),
    ),
    complete: mock(async (q: SparkSendQuote) => ({ ...q, state: 'COMPLETED' })),
    fail: mock(async (q: SparkSendQuote) => ({ ...q, state: 'FAILED' })),
    ...serviceOver,
  } as unknown as SparkSendQuoteService;
  const orchestrator = new SparkSendOrchestrator({
    sendQuoteService,
    getAccount: mock(async () => account),
    emitter,
  });
  return { orchestrator, sendQuoteService, emitter };
}

describe('SparkSendOrchestrator transitions', () => {
  it('initiateSend: UNPAID → PENDING emits send:pending', async () => {
    const { orchestrator, sendQuoteService, emitter } = makeDeps();
    const events: { quoteId: string }[] = [];
    emitter.on('send:pending', (e) => events.push(e));
    await orchestrator.initiateSend(account, unpaid());
    expect(sendQuoteService.initiateSend).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      { quoteId: 'sq-1', transactionId: 'tx-1', protocol: 'spark' },
    ] as never);
  });

  it('initiateSend: no-op when quote is not UNPAID', async () => {
    const { orchestrator, sendQuoteService } = makeDeps();
    await orchestrator.initiateSend(account, pending());
    expect(sendQuoteService.initiateSend).not.toHaveBeenCalled();
  });

  it('initiateSend: DomainError → fail + send:failed', async () => {
    const { orchestrator, sendQuoteService, emitter } = makeDeps({
      initiateSend: mock(async () => {
        throw new DomainError(
          'Lightning network fee has changed',
          'fee_changed',
        );
      }),
    });
    const failed: { quoteId: string; error: { code: string } }[] = [];
    emitter.on('send:failed', (e) => failed.push(e as never));
    await orchestrator.initiateSend(account, unpaid());
    expect(sendQuoteService.fail).toHaveBeenCalledTimes(1);
    expect(failed[0]?.error.code).toBe('spark_send_failed');
  });

  it('initiateSend: rethrows non-DomainError', async () => {
    const { orchestrator } = makeDeps({
      initiateSend: mock(async () => {
        throw new Error('network blip');
      }),
    });
    await expect(orchestrator.initiateSend(account, unpaid())).rejects.toThrow(
      'network blip',
    );
  });

  it('applyPaymentEvent paymentSucceeded: completes + emits send:completed (preimage extracted)', async () => {
    const { orchestrator, sendQuoteService, emitter } = makeDeps();
    const done: { quoteId: string }[] = [];
    emitter.on('send:completed', (e) => done.push(e as never));
    await orchestrator.applyPaymentEvent(
      pending(),
      lightningPayment({ preimage: 'pre-1' }),
      'paymentSucceeded',
    );
    expect(sendQuoteService.complete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sq-1' }),
      'pre-1',
    );
    expect(done).toHaveLength(1);
  });

  it('applyPaymentEvent paymentSucceeded with NO preimage: does not complete', async () => {
    const { orchestrator, sendQuoteService } = makeDeps();
    await orchestrator.applyPaymentEvent(
      pending(),
      lightningPayment({ preimage: undefined }),
      'paymentSucceeded',
    );
    expect(sendQuoteService.complete).not.toHaveBeenCalled();
  });

  it('applyPaymentEvent paymentFailed: fails with expiry-aware reason + emits send:failed', async () => {
    const { orchestrator, sendQuoteService, emitter } = makeDeps();
    const failed: { error: { message: string } }[] = [];
    emitter.on('send:failed', (e) => failed.push(e as never));
    const expired = pending({
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await orchestrator.applyPaymentEvent(
      expired,
      lightningPayment({ status: 'failed' }),
      'paymentFailed',
    );
    expect(sendQuoteService.fail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sq-1' }),
      'Lightning invoice expired.',
    );
    expect(failed[0]?.error.message).toBe('Lightning invoice expired.');
  });
});
