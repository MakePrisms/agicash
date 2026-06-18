import { describe, expect, it, mock } from 'bun:test';
import type { Payment, SdkEvent } from '@agicash/breez-sdk-spark';
import { Money } from '@agicash/money';
import { type MeltQuoteBolt11Response, MeltQuoteState } from '@cashu/cashu-ts';
import type { SparkReceiveQuoteService } from '../../domains/spark/spark-receive-quote-service';
import type { SdkEventMap } from '../../events';
import type { SparkAccount } from '../../types/account';
import type { SparkReceiveQuote } from '../../types/spark';
import { SdkEventEmitter } from '../event-emitter';
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
  acc: SparkAccount = account,
  melt: unknown = {},
) {
  const emitter = new SdkEventEmitter<SdkEventMap>();
  const receiveQuoteService = {
    complete: mock(async (q: SparkReceiveQuote) => ({ ...q, state: 'PAID' })),
    expire: mock(async () => undefined),
    fail: mock(async () => undefined),
    markMeltInitiated: mock(async (q: SparkReceiveQuote) => q),
    ...serviceOver,
  } as unknown as SparkReceiveQuoteService;
  const orchestrator = new SparkReceiveOrchestrator({
    receiveQuoteService,
    getAccount: mock(async () => acc),
    meltSubscriptionManager: melt as never,
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

function makeFakeWallet(opts: { paymentByInvoice?: Payment } = {}) {
  let onEvent: ((e: SdkEvent) => void) | undefined;
  const removeEventListener = mock(async () => true);
  const getPaymentByInvoice = mock(async () => ({
    payment: opts.paymentByInvoice,
  }));
  const wallet = {
    addEventListener: mock(async (l: { onEvent: (e: SdkEvent) => void }) => {
      onEvent = l.onEvent;
      return 'listener-1';
    }),
    removeEventListener,
    getPaymentByInvoice,
  } as unknown as SparkAccount['wallet'];
  return {
    wallet,
    removeEventListener,
    getPaymentByInvoice,
    fire: (e: SdkEvent) => onEvent?.(e),
  };
}

function withWallet(wallet: SparkAccount['wallet'], serviceOver = {}) {
  const acc = { ...account, wallet } as unknown as SparkAccount;
  return makeDeps(serviceOver, acc);
}

describe('SparkReceiveOrchestrator.reconcile', () => {
  it('routes a Breez paymentSucceeded (matched by paymentHash) into receive:completed', async () => {
    const fake = makeFakeWallet();
    const { orchestrator, emitter } = withWallet(fake.wallet);
    const done: unknown[] = [];
    emitter.on('receive:completed', (e) => done.push(e));
    await orchestrator.reconcile([unpaidLightning({ paymentHash: 'ph-7' })]);
    fake.fire({
      type: 'paymentSucceeded',
      payment: lightningPayment({
        id: 'pay-9',
        paymentHash: 'ph-7',
        preimage: 'pre-1',
      }),
    });
    await flush();
    expect(done).toHaveLength(1);
  });

  it('synced fired twice → expires + emits receive:expired exactly once (dedupe)', async () => {
    const fake = makeFakeWallet();
    const { orchestrator, receiveQuoteService, emitter } = withWallet(
      fake.wallet,
    );
    const expired: unknown[] = [];
    emitter.on('receive:expired', (e) => expired.push(e));
    await orchestrator.reconcile([
      unpaidLightning({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
    ]);
    fake.fire({ type: 'synced' });
    fake.fire({ type: 'synced' });
    await flush();
    expect(receiveQuoteService.expire).toHaveBeenCalledTimes(1);
    expect(expired).toHaveLength(1);
  });

  it('initial getPaymentByInvoice recovery completes a quote whose success fired before registration', async () => {
    const fake = makeFakeWallet({
      paymentByInvoice: lightningPayment({
        id: 'pay-9',
        paymentHash: 'ph-1',
        preimage: 'pre-1',
        status: 'completed',
      }),
    });
    const { orchestrator, receiveQuoteService } = withWallet(fake.wallet);
    await orchestrator.reconcile([unpaidLightning()]);
    await flush();
    expect(receiveQuoteService.complete).toHaveBeenCalledTimes(1);
  });

  it('cleanup detaches listeners', async () => {
    const fake = makeFakeWallet();
    const { orchestrator } = withWallet(fake.wallet);
    const cleanup = await orchestrator.reconcile([unpaidLightning()]);
    cleanup();
    await flush();
    expect(fake.removeEventListener).toHaveBeenCalledWith('listener-1');
  });
});

function tokenQuote(
  over: Partial<{ meltInitiated: boolean }> = {},
): SparkReceiveQuote {
  return {
    id: 'rq-2',
    type: 'CASHU_TOKEN',
    state: 'UNPAID',
    amount: sats(100),
    transactionId: 'tx-2',
    accountId: 'acc-1',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    paymentHash: 'ph-2',
    paymentRequest: 'lnbc2',
    tokenReceiveData: {
      sourceMintUrl: 'https://mint.test',
      meltQuoteId: 'mq-1',
      meltInitiated: over.meltInitiated ?? false,
    },
  } as unknown as SparkReceiveQuote;
}
const meltResp = (state: MeltQuoteState): MeltQuoteBolt11Response =>
  ({ quote: 'mq-1', state, amount: 100 }) as unknown as MeltQuoteBolt11Response;

describe('SparkReceiveOrchestrator cross-mint melt', () => {
  it('melt UNPAID + not initiated → handlers.initiateMelt', async () => {
    const { orchestrator } = makeDeps();
    const initiateMelt = mock(async () => undefined);
    await orchestrator.applyCrossMintMeltState(
      tokenQuote() as never,
      meltResp(MeltQuoteState.UNPAID),
      { initiateMelt },
    );
    expect(initiateMelt).toHaveBeenCalledTimes(1);
  });

  it('melt UNPAID + already initiated → fail + receive:failed', async () => {
    const { orchestrator, receiveQuoteService, emitter } = makeDeps();
    const failed: { error: { code: string } }[] = [];
    emitter.on('receive:failed', (e) => failed.push(e as never));
    await orchestrator.applyCrossMintMeltState(
      tokenQuote({ meltInitiated: true }) as never,
      meltResp(MeltQuoteState.UNPAID),
      { initiateMelt: mock(async () => undefined) },
    );
    expect(receiveQuoteService.fail).toHaveBeenCalledTimes(1);
    expect(failed[0]?.error.code).toBe('spark_token_melt_failed');
  });

  it('melt PENDING → markMeltInitiated', async () => {
    const { orchestrator, receiveQuoteService } = makeDeps();
    await orchestrator.applyCrossMintMeltState(
      tokenQuote() as never,
      meltResp(MeltQuoteState.PENDING),
      { initiateMelt: mock(async () => undefined) },
    );
    expect(receiveQuoteService.markMeltInitiated).toHaveBeenCalledTimes(1);
  });

  it('reconcileCrossMintMelts subscribes by sourceMintUrl and routes onUpdate (deduped per state)', async () => {
    let onUpdate: ((q: MeltQuoteBolt11Response) => void) | undefined;
    const subscribe = mock(
      async (p: { onUpdate: (q: MeltQuoteBolt11Response) => void }) => {
        onUpdate = p.onUpdate;
        return () => undefined;
      },
    );
    const { orchestrator, receiveQuoteService } = makeDeps({}, account, {
      subscribe,
    });
    const initiateMelt = mock(async () => undefined);
    await orchestrator.reconcileCrossMintMelts(
      [tokenQuote({ meltInitiated: true })],
      { initiateMelt },
    );
    expect(subscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        mintUrl: 'https://mint.test',
        quoteIds: ['mq-1'],
      }),
    );
    onUpdate?.(meltResp(MeltQuoteState.UNPAID));
    onUpdate?.(meltResp(MeltQuoteState.UNPAID)); // duplicate delivery
    await flush();
    expect(receiveQuoteService.fail).toHaveBeenCalledTimes(1); // deduped (M1 fix)
  });
});
