import { describe, expect, it, mock } from 'bun:test';
import { Money } from '@agicash/money';
import type { Payment } from '@agicash/breez-sdk-spark';
import { SdkEventEmitter } from '../event-emitter';
import type { SdkEventMap } from '../../events';
import type { SparkAccount } from '../../types/account';
import type { SparkReceiveQuote } from '../../types/spark';
import type { SparkReceiveQuoteService } from '../../domains/spark/spark-receive-quote-service';
import { SparkReceiveOrchestrator } from './spark-receive-orchestrator';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const sats = (n: number) =>
  new Money({ amount: n, currency: 'BTC', unit: 'sat' }) as Money;
const account = {
  id: 'acc-1',
  type: 'spark',
  currency: 'BTC',
} as unknown as SparkAccount;

function unpaidLightning(
  over: Partial<SparkReceiveQuote> = {},
): SparkReceiveQuote {
  return {
    id: 'rq-1',
    type: 'LIGHTNING',
    state: 'UNPAID',
    amount: sats(100),
    transactionId: 'tx-1',
    accountId: 'acc-1',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    paymentHash: 'ph-1',
    paymentRequest: 'lnbc1',
    ...over,
  } as unknown as SparkReceiveQuote;
}
function lightningPayment(
  over: {
    id?: string;
    status?: Payment['status'];
    paymentHash?: string;
    preimage?: string;
  } = {},
): Payment {
  return {
    id: over.id ?? 'pay-1',
    status: over.status ?? 'completed',
    amount: 100n,
    fees: 0n,
    details: {
      type: 'lightning',
      htlcDetails: {
        paymentHash: over.paymentHash ?? 'ph-1',
        preimage: over.preimage,
        status: 'preimageShared',
      },
    },
  } as unknown as Payment;
}

function makeDeps(
  serviceOver: Partial<Record<keyof SparkReceiveQuoteService, unknown>> = {},
) {
  const emitter = new SdkEventEmitter<SdkEventMap>();
  const receiveQuoteService = {
    complete: mock(async (q: SparkReceiveQuote) => ({ ...q, state: 'PAID' })),
    expire: mock(async () => {}),
    fail: mock(async () => {}),
    markMeltInitiated: mock(async (q: SparkReceiveQuote) => q),
    ...serviceOver,
  } as unknown as SparkReceiveQuoteService;
  const orchestrator = new SparkReceiveOrchestrator({
    receiveQuoteService,
    getAccount: mock(async () => account),
    meltSubscriptionManager: {} as never,
    emitter,
  });
  return { orchestrator, receiveQuoteService, emitter };
}

describe('SparkReceiveOrchestrator transitions', () => {
  it('applyPaymentSucceeded: completes with sparkTransferId=payment.id + emits receive:completed', async () => {
    const { orchestrator, receiveQuoteService, emitter } = makeDeps();
    const done: unknown[] = [];
    emitter.on('receive:completed', (e) => done.push(e));
    await orchestrator.applyPaymentSucceeded(
      unpaidLightning(),
      lightningPayment({ id: 'pay-9', preimage: 'pre-1' }),
    );
    expect(receiveQuoteService.complete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'rq-1' }),
      'pre-1',
      'pay-9',
    );
    expect(done).toHaveLength(1);
  });

  it('applyPaymentSucceeded: no preimage → does not complete', async () => {
    const { orchestrator, receiveQuoteService } = makeDeps();
    await orchestrator.applyPaymentSucceeded(
      unpaidLightning(),
      lightningPayment({ preimage: undefined }),
    );
    expect(receiveQuoteService.complete).not.toHaveBeenCalled();
  });

  it('applyPaymentSucceeded: non-lightning details → ignored', async () => {
    const { orchestrator, receiveQuoteService } = makeDeps();
    const spark = {
      id: 'pay-1',
      status: 'completed',
      amount: 1n,
      fees: 0n,
      details: { type: 'spark' },
    } as unknown as Payment;
    await orchestrator.applyPaymentSucceeded(unpaidLightning(), spark);
    expect(receiveQuoteService.complete).not.toHaveBeenCalled();
  });

  it('applyExpiry: UNPAID & past expiry → expire + emit receive:expired', async () => {
    const { orchestrator, receiveQuoteService, emitter } = makeDeps();
    const expired: unknown[] = [];
    emitter.on('receive:expired', (e) => expired.push(e));
    await orchestrator.applyExpiry(
      unpaidLightning({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
    );
    expect(receiveQuoteService.expire).toHaveBeenCalledTimes(1);
    expect(expired).toEqual([{ quoteId: 'rq-1', protocol: 'spark' }] as never);
  });

  it('applyExpiry: not yet expired → no-op', async () => {
    const { orchestrator, receiveQuoteService } = makeDeps();
    await orchestrator.applyExpiry(unpaidLightning());
    expect(receiveQuoteService.expire).not.toHaveBeenCalled();
  });

  it('applyExpiry: non-UNPAID → no-op', async () => {
    const { orchestrator, receiveQuoteService } = makeDeps();
    await orchestrator.applyExpiry(unpaidLightning({ state: 'PAID' } as never));
    expect(receiveQuoteService.expire).not.toHaveBeenCalled();
  });
});
