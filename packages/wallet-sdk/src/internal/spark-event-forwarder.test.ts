/**
 * Spark Breez-event substrate tests — Slice 5 / PR7.
 *
 * Fakes the orchestrator (capturing its spark terminal `step*` calls) + a spark account whose live
 * Breez wallet records the registered `onEvent` callback (so a test can fire Breez events) and
 * tracks listener add/remove. Asserts: a `paymentSucceeded` matched to a pending SEND quote
 * (by sparkTransferId) → `stepSparkSendCompleted` with the preimage; matched to a pending RECEIVE
 * quote (by paymentHash) → `stepSparkReceiveCompleted`; `paymentFailed` → `stepSparkSendFailed`;
 * `synced` past-expiry → `stepSparkReceiveExpired`; an unmatched payment is a no-op; and `stop()`
 * removes the listeners.
 */
import { describe, expect, mock, test } from 'bun:test';
import { SparkEventForwarder } from './spark-event-forwarder';
import type { Orchestrator } from './orchestrator';
import type { SparkAccount } from '../types/account';
import { type Currency, Money } from '../types/money';
import type { SparkSendQuote, SparkReceiveQuote } from '../types/spark';

const sats = (n: number): Money =>
  new Money({ amount: n, currency: 'BTC' as Currency, unit: 'sat' });

/** A fake orchestrator capturing the spark terminal step calls the forwarder makes. */
function fakeOrchestrator() {
  const calls = {
    sendCompleted: [] as { quoteId: string; paymentPreimage: string }[],
    sendFailed: [] as { quoteId: string; reason: string }[],
    receiveCompleted: [] as {
      quoteId: string;
      paymentPreimage: string;
      sparkTransferId: string;
    }[],
    receiveExpired: [] as string[],
  };
  const orchestrator = {
    stepSparkSendCompleted: mock(async (p: (typeof calls.sendCompleted)[0]) => {
      calls.sendCompleted.push(p);
    }),
    stepSparkSendFailed: mock(async (p: (typeof calls.sendFailed)[0]) => {
      calls.sendFailed.push(p);
    }),
    stepSparkReceiveCompleted: mock(
      async (p: (typeof calls.receiveCompleted)[0]) => {
        calls.receiveCompleted.push(p);
      },
    ),
    stepSparkReceiveExpired: mock(async (quoteId: string) => {
      calls.receiveExpired.push(quoteId);
    }),
  } as unknown as Orchestrator;
  return { orchestrator, calls };
}

/** A fake spark account whose Breez wallet records `onEvent` + listener add/remove + getPayment. */
function fakeSparkAccount(id: string): {
  account: SparkAccount;
  fire: (event: unknown) => void;
  removed: () => string[];
} {
  let onEvent: ((event: unknown) => void) | undefined;
  const removedIds: string[] = [];
  const account = {
    id,
    type: 'spark',
    isOnline: true,
    currency: 'BTC',
    wallet: {
      addEventListener: mock(
        async (listener: { onEvent: (e: unknown) => void }) => {
          onEvent = listener.onEvent;
          return `listener-${id}`;
        },
      ),
      removeEventListener: mock(async (listenerId: string) => {
        removedIds.push(listenerId);
      }),
      // No pending payment for the initial status check (returns a non-terminal payment).
      getPayment: mock(async () => ({ payment: { status: 'pending' } })),
      getPaymentByInvoice: mock(async () => ({ payment: null })),
    },
  } as unknown as SparkAccount;
  return {
    account,
    fire: (event) => onEvent?.(event),
    removed: () => removedIds,
  };
}

const lightningPayment = (
  id: string,
  paymentHash: string,
  preimage: string | undefined,
) => ({
  id,
  status: 'completed',
  details: { type: 'lightning', htlcDetails: { paymentHash, preimage } },
});

const pendingSend = (id: string, sparkTransferId: string): SparkSendQuote =>
  ({
    id,
    accountId: 'acc1',
    state: 'PENDING',
    sparkTransferId,
    amount: sats(100),
  }) as unknown as SparkSendQuote;

const unpaidReceive = (
  id: string,
  paymentHash: string,
  expiresAt: string,
): SparkReceiveQuote =>
  ({
    id,
    accountId: 'acc1',
    type: 'LIGHTNING',
    state: 'UNPAID',
    paymentHash,
    paymentRequest: 'lnbc1...',
    expiresAt,
    amount: sats(100),
  }) as unknown as SparkReceiveQuote;

const future = () => new Date(Date.now() + 3_600_000).toISOString();
const past = () => new Date(Date.now() - 1_000).toISOString();

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('SparkEventForwarder (spark Breez terminal-event substrate)', () => {
  test('paymentSucceeded matched to a pending SEND → stepSparkSendCompleted with preimage', async () => {
    const { orchestrator, calls } = fakeOrchestrator();
    const forwarder = new SparkEventForwarder(orchestrator);
    const { account, fire } = fakeSparkAccount('acc1');

    forwarder.track({
      accounts: [account],
      sendQuotes: [pendingSend('q1', 'transfer-1')],
      receiveQuotes: [],
    });
    await flush();

    fire({
      type: 'paymentSucceeded',
      payment: lightningPayment('transfer-1', 'hash-1', 'preimage-1'),
    });
    await flush();

    expect(calls.sendCompleted).toEqual([
      { quoteId: 'q1', paymentPreimage: 'preimage-1' },
    ]);
  });

  test('paymentSucceeded matched to a pending RECEIVE (by paymentHash) → stepSparkReceiveCompleted', async () => {
    const { orchestrator, calls } = fakeOrchestrator();
    const forwarder = new SparkEventForwarder(orchestrator);
    const { account, fire } = fakeSparkAccount('acc1');

    forwarder.track({
      accounts: [account],
      sendQuotes: [],
      receiveQuotes: [unpaidReceive('r1', 'hash-r', future())],
    });
    await flush();

    fire({
      type: 'paymentSucceeded',
      payment: lightningPayment('transfer-x', 'hash-r', 'preimage-r'),
    });
    await flush();

    expect(calls.receiveCompleted).toEqual([
      {
        quoteId: 'r1',
        paymentPreimage: 'preimage-r',
        sparkTransferId: 'transfer-x',
      },
    ]);
  });

  test('paymentFailed matched to a pending SEND → stepSparkSendFailed', async () => {
    const { orchestrator, calls } = fakeOrchestrator();
    const forwarder = new SparkEventForwarder(orchestrator);
    const { account, fire } = fakeSparkAccount('acc1');

    forwarder.track({
      accounts: [account],
      sendQuotes: [pendingSend('q1', 'transfer-1')],
      receiveQuotes: [],
    });
    await flush();

    fire({
      type: 'paymentFailed',
      payment: { id: 'transfer-1', status: 'failed', details: undefined },
    });
    await flush();

    expect(calls.sendFailed).toHaveLength(1);
    expect(calls.sendFailed[0]?.quoteId).toBe('q1');
  });

  test('synced past-expiry → stepSparkReceiveExpired (and not before expiry)', async () => {
    const { orchestrator, calls } = fakeOrchestrator();
    const forwarder = new SparkEventForwarder(orchestrator);
    const a = fakeSparkAccount('acc1');

    // Not yet expired → synced is a no-op.
    forwarder.track({
      accounts: [a.account],
      sendQuotes: [],
      receiveQuotes: [unpaidReceive('r1', 'hash-r', future())],
    });
    await flush();
    a.fire({ type: 'synced' });
    await flush();
    expect(calls.receiveExpired).toEqual([]);

    // Past expiry → synced expires it.
    forwarder.track({
      accounts: [a.account],
      sendQuotes: [],
      receiveQuotes: [unpaidReceive('r1', 'hash-r', past())],
    });
    await flush();
    a.fire({ type: 'synced' });
    await flush();
    expect(calls.receiveExpired).toEqual(['r1']);
  });

  test('an unmatched payment is a no-op', async () => {
    const { orchestrator, calls } = fakeOrchestrator();
    const forwarder = new SparkEventForwarder(orchestrator);
    const { account, fire } = fakeSparkAccount('acc1');

    forwarder.track({
      accounts: [account],
      sendQuotes: [pendingSend('q1', 'transfer-1')],
      receiveQuotes: [],
    });
    await flush();

    fire({
      type: 'paymentSucceeded',
      payment: lightningPayment('OTHER-transfer', 'OTHER-hash', 'p'),
    });
    await flush();

    expect(calls.sendCompleted).toHaveLength(0);
    expect(calls.receiveCompleted).toHaveLength(0);
  });

  test('a succeeded SEND with no preimage does not complete (logs, no step)', async () => {
    const warn = mock(() => undefined);
    const original = console.error;
    console.error = warn;
    try {
      const { orchestrator, calls } = fakeOrchestrator();
      const forwarder = new SparkEventForwarder(orchestrator);
      const { account, fire } = fakeSparkAccount('acc1');

      forwarder.track({
        accounts: [account],
        sendQuotes: [pendingSend('q1', 'transfer-1')],
        receiveQuotes: [],
      });
      await flush();

      fire({
        type: 'paymentSucceeded',
        payment: lightningPayment('transfer-1', 'hash-1', undefined),
      });
      await flush();

      expect(calls.sendCompleted).toHaveLength(0);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      console.error = original;
    }
  });

  test('stop() removes the Breez listeners and clears the match maps', async () => {
    const { orchestrator, calls } = fakeOrchestrator();
    const forwarder = new SparkEventForwarder(orchestrator);
    const { account, fire, removed } = fakeSparkAccount('acc1');

    forwarder.track({
      accounts: [account],
      sendQuotes: [pendingSend('q1', 'transfer-1')],
      receiveQuotes: [],
    });
    await flush();
    forwarder.stop();
    await flush();

    expect(removed()).toEqual(['listener-acc1']);
    // A late event after stop matches nothing.
    fire({
      type: 'paymentSucceeded',
      payment: lightningPayment('transfer-1', 'hash-1', 'p'),
    });
    await flush();
    expect(calls.sendCompleted).toHaveLength(0);
  });
});
