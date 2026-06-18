import { describe, expect, it, mock } from 'bun:test';
import type { Payment, SdkEvent } from '@agicash/breez-sdk-spark';
import { Money } from '@agicash/money';
import type { SparkSendQuoteService } from '../../domains/spark/spark-send-quote-service';
import { DomainError } from '../../errors';
import type { SdkEventMap } from '../../events';
import type { SparkAccount } from '../../types/account';
import type { SparkSendQuote } from '../../types/spark';
import { SdkEventEmitter } from '../event-emitter';
import { SparkSendOrchestrator } from './spark-send-orchestrator';

const sats = (n: number) =>
  new Money({ amount: n, currency: 'BTC', unit: 'sat' }) as Money;
const account = {
  id: 'acc-1',
  type: 'spark',
  currency: 'BTC',
} as unknown as SparkAccount;

function flush() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

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
  acc: SparkAccount = account,
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
    getAccount: mock(async () => acc),
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

function makeFakeWallet(opts: { payment?: Payment } = {}) {
  let onEvent: ((e: SdkEvent) => void) | undefined;
  const removeEventListener = mock(async () => true);
  const getPayment = mock(async () => ({ payment: opts.payment }));
  const wallet = {
    addEventListener: mock(async (l: { onEvent: (e: SdkEvent) => void }) => {
      onEvent = l.onEvent;
      return 'listener-1';
    }),
    removeEventListener,
    getPayment,
  } as unknown as SparkAccount['wallet'];
  return {
    wallet,
    removeEventListener,
    getPayment,
    fire: (e: SdkEvent) => onEvent?.(e),
  };
}

describe('SparkSendOrchestrator.reconcile', () => {
  it('kicks UNPAID quotes via initiateSend', async () => {
    const { orchestrator, sendQuoteService } = makeDeps();
    await orchestrator.reconcile([unpaid()]);
    await flush();
    expect(sendQuoteService.initiateSend).toHaveBeenCalledTimes(1);
  });

  it('routes a Breez paymentSucceeded for a PENDING quote into send:completed', async () => {
    const fake = makeFakeWallet();
    const acc = { ...account, wallet: fake.wallet } as unknown as SparkAccount;
    const { orchestrator, emitter } = makeDeps({}, acc);
    const done: unknown[] = [];
    emitter.on('send:completed', (e) => done.push(e));
    await orchestrator.reconcile([pending()]);
    fake.fire({
      type: 'paymentSucceeded',
      payment: lightningPayment({ id: 'pay-1', preimage: 'pre-1' }),
    });
    await flush();
    expect(done).toHaveLength(1);
  });

  it('initial getPayment recovery completes a quote whose success fired before registration; duplicate listener delivery is deduped', async () => {
    const fake = makeFakeWallet({
      payment: lightningPayment({
        id: 'pay-1',
        preimage: 'pre-1',
        status: 'completed',
      }),
    });
    const acc = { ...account, wallet: fake.wallet } as unknown as SparkAccount;
    const { orchestrator, sendQuoteService, emitter } = makeDeps({}, acc);
    const done: unknown[] = [];
    emitter.on('send:completed', (e) => done.push(e));
    await orchestrator.reconcile([pending()]);
    fake.fire({
      type: 'paymentSucceeded',
      payment: lightningPayment({ id: 'pay-1', preimage: 'pre-1' }),
    }); // also delivered live
    await flush();
    expect(sendQuoteService.complete).toHaveBeenCalledTimes(1); // deduped
    expect(done).toHaveLength(1);
  });

  it('cleanup detaches listeners', async () => {
    const fake = makeFakeWallet();
    const acc = { ...account, wallet: fake.wallet } as unknown as SparkAccount;
    const { orchestrator } = makeDeps({}, acc);
    const cleanup = await orchestrator.reconcile([pending()]);
    cleanup();
    await flush();
    expect(fake.removeEventListener).toHaveBeenCalledWith('listener-1');
  });
});
