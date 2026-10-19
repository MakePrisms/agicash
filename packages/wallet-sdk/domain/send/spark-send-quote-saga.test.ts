import { describe, expect, it } from 'bun:test';
import type { Payment } from '@agicash/breez-sdk-spark';
import { DomainError } from '../../lib/error';
import type { SparkAccount } from '../accounts/account';
import {
  type KeyedSerialQueue,
  createKeyedSerialQueue,
} from '../wallet/task-saga';
import {
  type RecordedTimer,
  createTestStint,
  deferred,
  flush,
} from '../wallet/task-saga-test-kit';
import type { SparkSendQuote } from './spark-send-quote';
import type { SparkSendQuoteRepository } from './spark-send-quote-repository';
import { createSparkSendQuoteSaga } from './spark-send-quote-saga';
import type { SparkSendQuoteService } from './spark-send-quote-service';

type Listener = {
  onEvent: (event: { type: string; payment: Payment }) => void;
};

function createWallet() {
  const listeners: Listener[] = [];
  const addCalls: string[] = [];
  const removeCalls: string[] = [];
  const getPaymentCalls: string[] = [];
  let nextId = 1;
  let getPaymentImpl = async (
    paymentId: string,
  ): Promise<{ payment: Payment }> => ({
    payment: { id: paymentId, status: 'pending' } as Payment,
  });
  const wallet = {
    addEventListener: async (listener: Listener) => {
      const id = `listener-${nextId}`;
      nextId += 1;
      listeners.push(listener);
      addCalls.push(id);
      return id;
    },
    removeEventListener: async (id: string) => {
      removeCalls.push(id);
    },
    getPayment: async ({ paymentId }: { paymentId: string }) => {
      getPaymentCalls.push(paymentId);
      return getPaymentImpl(paymentId);
    },
  };
  return {
    wallet,
    listeners,
    addCalls,
    removeCalls,
    getPaymentCalls,
    setGetPayment: (
      impl: (paymentId: string) => Promise<{ payment: Payment }>,
    ) => {
      getPaymentImpl = impl;
    },
  };
}

function sparkAccount(
  id: string,
  wallet: ReturnType<typeof createWallet>['wallet'],
  isOnline = true,
  version = 1,
): SparkAccount {
  return {
    id,
    type: 'spark',
    isOnline,
    version,
    currency: 'BTC',
    wallet,
  } as unknown as SparkAccount;
}

function unpaid(
  id: string,
  accountId: string,
  version: number,
): SparkSendQuote {
  return {
    id,
    accountId,
    version,
    state: 'UNPAID',
    userId: 'user-1',
  } as SparkSendQuote;
}

function pendingQuote(
  id: string,
  accountId: string,
  version: number,
  sparkTransferId: string,
  expiresAt?: string,
): SparkSendQuote {
  return {
    id,
    accountId,
    version,
    state: 'PENDING',
    userId: 'user-1',
    sparkTransferId,
    expiresAt: expiresAt ?? null,
  } as SparkSendQuote;
}

function payment(id: string, status: string, preimage?: string): Payment {
  return {
    id,
    status,
    details:
      preimage === undefined
        ? undefined
        : {
            type: 'lightning',
            htlcDetails: { preimage },
          },
  } as Payment;
}

type InitiateCall = {
  account: SparkAccount;
  quote: SparkSendQuote;
  args: unknown[];
};

function recordingQueue(): {
  keys: Array<string | undefined>;
  queue: KeyedSerialQueue;
} {
  const inner = createKeyedSerialQueue();
  const keys: Array<string | undefined> = [];
  return {
    keys,
    queue: {
      enqueue(key, scope, job) {
        keys.push(key);
        inner.enqueue(key, scope, job);
      },
    },
  };
}

function armed(timers: RecordedTimer[], ms: number): RecordedTimer | undefined {
  const matches = timers.filter((timer) => timer.ms === ms && !timer.cancelled);
  return matches[matches.length - 1];
}

function harness(options?: {
  accounts?: SparkAccount[];
  loadAccounts?: (
    userId: string,
    signal: AbortSignal,
  ) => Promise<SparkAccount[]>;
  unresolved?: SparkSendQuote[];
}) {
  const wallet = createWallet();
  const online = sparkAccount('account-1', wallet.wallet);
  const recorded = recordingQueue();
  const kit = createTestStint({
    userId: 'user-1',
    queue: recorded.queue,
    loadAccounts:
      options?.loadAccounts ?? (async () => options?.accounts ?? [online]),
  });
  let unresolved = options?.unresolved ?? [];
  const getUnresolvedCalls: Array<{
    userId: string;
    signal: AbortSignal | undefined;
  }> = [];
  const initiateCalls: InitiateCall[] = [];
  const completeCalls: Array<{
    quote: SparkSendQuote;
    preimage: string;
    args: unknown[];
  }> = [];
  const failCalls: Array<{
    quote: SparkSendQuote;
    reason: string;
    args: unknown[];
  }> = [];
  const emitted: SparkSendQuote[] = [];
  kit.events.on('spark-send-quote.updated', ({ quote }) => {
    emitted.push(quote);
  });
  let initiateImpl: (
    account: SparkAccount,
    quote: SparkSendQuote,
  ) => Promise<SparkSendQuote> = async () => {
    throw new Error('initiateSend was not stubbed');
  };
  let completeImpl: (
    quote: SparkSendQuote,
    preimage: string,
  ) => Promise<SparkSendQuote> = async (quote) => quote;
  let failImpl: (
    quote: SparkSendQuote,
    reason: string,
  ) => Promise<SparkSendQuote> = async (quote) => quote;
  const saga = createSparkSendQuoteSaga({
    getRepository: async () =>
      ({
        getUnresolved: async (
          userId: string,
          callOptions?: { abortSignal?: AbortSignal },
        ) => {
          getUnresolvedCalls.push({
            userId,
            signal: callOptions?.abortSignal,
          });
          return unresolved;
        },
      }) as SparkSendQuoteRepository,
    getService: async () =>
      ({
        initiateSend: async (...args: unknown[]) => {
          const [{ account, sendQuote }] = args as [
            { account: SparkAccount; sendQuote: SparkSendQuote },
          ];
          initiateCalls.push({ account, quote: sendQuote, args });
          return initiateImpl(account, sendQuote);
        },
        complete: async (...args: unknown[]) => {
          const [quote, preimage] = args as [SparkSendQuote, string];
          completeCalls.push({ quote, preimage, args });
          return completeImpl(quote, preimage);
        },
        fail: async (...args: unknown[]) => {
          const [quote, reason] = args as [SparkSendQuote, string];
          failCalls.push({ quote, reason, args });
          return failImpl(quote, reason);
        },
      }) as SparkSendQuoteService,
  });
  saga.start(kit.stint);
  return {
    kit,
    online,
    wallet,
    keys: recorded.keys,
    getUnresolvedCalls,
    initiateCalls,
    completeCalls,
    failCalls,
    emitted,
    setUnresolved: (rows: SparkSendQuote[]) => {
      unresolved = rows;
    },
    setInitiate: (
      impl: (
        account: SparkAccount,
        quote: SparkSendQuote,
      ) => Promise<SparkSendQuote>,
    ) => {
      initiateImpl = impl;
    },
    setComplete: (
      impl: (
        quote: SparkSendQuote,
        preimage: string,
      ) => Promise<SparkSendQuote>,
    ) => {
      completeImpl = impl;
    },
    setFail: (
      impl: (quote: SparkSendQuote, reason: string) => Promise<SparkSendQuote>,
    ) => {
      failImpl = impl;
    },
  };
}

describe('spark send quote saga', () => {
  it('(a) initiates an UNPAID quote once and skips an offline account', async () => {
    const wallet = createWallet();
    const offlineWallet = createWallet();
    const online = sparkAccount('account-1', wallet.wallet);
    const offline = sparkAccount(
      'account-offline',
      offlineWallet.wallet,
      false,
    );
    const quote = unpaid('quote-1', 'account-1', 1);
    const { kit, initiateCalls, setInitiate } = harness({
      accounts: [online, offline],
      unresolved: [unpaid('quote-offline', 'account-offline', 1), quote],
    });
    setInitiate(async (_account, current) => current);
    await flush();
    expect(initiateCalls).toHaveLength(1);
    expect(initiateCalls[0]?.quote).toBe(quote);
    expect(initiateCalls[0]?.account).toBe(online);
    expect(initiateCalls[0]?.args).toEqual([
      { account: online, sendQuote: quote },
    ]);
    kit.events.emit('spark-send-quote.updated', {
      quote: unpaid('quote-1', 'account-1', 2),
    });
    await flush();
    expect(initiateCalls).toHaveLength(1);
    expect(offlineWallet.addCalls).toHaveLength(0);
    expect(wallet.addCalls).toHaveLength(0);
  });

  it('(b) initiates two UNPAID quotes concurrently', async () => {
    const first = deferred<SparkSendQuote>();
    const second = deferred<SparkSendQuote>();
    const quote1 = unpaid('quote-1', 'account-1', 1);
    const quote2 = unpaid('quote-2', 'account-1', 1);
    const { online, initiateCalls, setInitiate } = harness({
      unresolved: [quote1, quote2],
    });
    setInitiate((_account, quote) =>
      quote.id === 'quote-1' ? first.promise : second.promise,
    );
    await flush();
    expect(initiateCalls.map((call) => call.quote.id).sort()).toEqual([
      'quote-1',
      'quote-2',
    ]);
    expect(initiateCalls[0]?.account).toBe(online);
    expect(initiateCalls[1]?.account).toBe(online);
    expect(initiateCalls[0]?.args).toHaveLength(1);
    expect(initiateCalls[1]?.args).toHaveLength(1);
    first.resolve(quote1);
    second.resolve(quote2);
    await flush();
  });

  it('(c) fails a DomainError on the same key after one attempt', async () => {
    const error = new DomainError('Lightning fee changed.');
    const quote = unpaid('quote-1', 'account-1', 1);
    const { kit, keys, initiateCalls, failCalls, setInitiate } = harness({
      unresolved: [quote],
    });
    setInitiate(async () => {
      throw error;
    });
    await flush();
    expect(initiateCalls).toHaveLength(1);
    expect(initiateCalls[0]?.quote).toBe(quote);
    expect(failCalls).toHaveLength(1);
    expect(failCalls[0]?.quote).toBe(quote);
    expect(failCalls[0]?.reason).toBe('Lightning fee changed.');
    expect(failCalls[0]?.args).toEqual([quote, 'Lightning fee changed.']);
    expect(keys).toEqual([
      'spark-send-quote-quote-1',
      'spark-send-quote-quote-1',
    ]);
    expect(kit.clock.timeouts).toHaveLength(0);
  });

  it('(d) completes a succeeded payment once, including after a missing preimage', async () => {
    const quote = pendingQuote(
      'quote-1',
      'account-1',
      1,
      'transfer-1',
      '2099-01-01T00:00:00.000Z',
    );
    const completed = {
      ...quote,
      state: 'COMPLETED',
      version: 2,
      paymentPreimage: 'preimage-fixture',
    } as SparkSendQuote;
    const { kit, wallet, completeCalls, setComplete } = harness({
      unresolved: [quote],
    });
    setComplete(async () => completed);
    await flush();
    expect(wallet.addCalls).toHaveLength(1);
    expect(wallet.listeners).toHaveLength(1);
    expect(wallet.getPaymentCalls).toEqual(['transfer-1']);
    expect(completeCalls).toHaveLength(0);
    wallet.listeners[0]?.onEvent({
      type: 'paymentSucceeded',
      payment: payment('transfer-1', 'completed'),
    });
    await flush();
    expect(completeCalls).toHaveLength(0);
    expect(kit.logger.errorLog).toEqual([
      {
        message: 'Payment succeeded but no preimage',
        meta: { paymentId: 'transfer-1' },
      },
    ]);
    wallet.listeners[0]?.onEvent({
      type: 'paymentSucceeded',
      payment: payment('transfer-1', 'completed', 'preimage-fixture'),
    });
    await flush();
    expect(completeCalls).toHaveLength(1);
    expect(completeCalls[0]?.quote).toBe(quote);
    expect(completeCalls[0]?.preimage).toBe('preimage-fixture');
    expect(completeCalls[0]?.args).toEqual([quote, 'preimage-fixture']);
    wallet.listeners[0]?.onEvent({
      type: 'paymentSucceeded',
      payment: payment('transfer-1', 'completed', 'preimage-fixture'),
    });
    await flush();
    expect(completeCalls).toHaveLength(1);
  });

  it('(e) fails an expired invoice and a payment that is not expired', async () => {
    const expired = pendingQuote(
      'quote-expired',
      'account-1',
      1,
      'transfer-expired',
      '1970-01-01T00:00:00.000Z',
    );
    const open = pendingQuote(
      'quote-open',
      'account-1',
      1,
      'transfer-open',
      '2099-01-01T00:00:00.000Z',
    );
    const { wallet, failCalls } = harness({
      unresolved: [expired, open],
    });
    await flush();
    expect(wallet.addCalls).toHaveLength(1);
    wallet.listeners[0]?.onEvent({
      type: 'paymentFailed',
      payment: payment('transfer-expired', 'failed'),
    });
    wallet.listeners[0]?.onEvent({
      type: 'paymentFailed',
      payment: payment('transfer-open', 'failed'),
    });
    await flush();
    expect(failCalls.map((call) => [call.quote.id, call.reason])).toEqual([
      ['quote-expired', 'Lightning invoice expired.'],
      ['quote-open', 'Lightning payment failed.'],
    ]);
    expect(failCalls[0]?.args).toEqual([expired, 'Lightning invoice expired.']);
    expect(failCalls[1]?.args).toEqual([open, 'Lightning payment failed.']);
  });

  it('(f) fails a quote whose initial getPayment is failed, once per stint', async () => {
    const quote = pendingQuote(
      'quote-1',
      'account-1',
      1,
      'transfer-1',
      '2099-01-01T00:00:00.000Z',
    );
    const { kit, wallet, failCalls } = harness({
      unresolved: [quote],
    });
    wallet.setGetPayment(async (paymentId) => ({
      payment: payment(paymentId, 'failed'),
    }));
    await flush();
    expect(wallet.getPaymentCalls).toEqual(['transfer-1']);
    expect(failCalls).toHaveLength(1);
    expect(failCalls[0]?.quote).toBe(quote);
    expect(failCalls[0]?.reason).toBe('Lightning payment failed.');
    expect(failCalls[0]?.args).toEqual([quote, 'Lightning payment failed.']);
    kit.events.emit('spark-send-quote.updated', {
      quote: pendingQuote(
        'quote-1',
        'account-1',
        2,
        'transfer-1',
        '2099-01-01T00:00:00.000Z',
      ),
    });
    await flush();
    expect(wallet.getPaymentCalls).toEqual(['transfer-1']);
    expect(failCalls).toHaveLength(1);
  });

  it('(g) emits the quote from initiate, complete, and fail', async () => {
    const unpaidQuote = unpaid('quote-1', 'account-1', 1);
    const pendingResult = pendingQuote(
      'quote-1',
      'account-1',
      2,
      'transfer-1',
      '2099-01-01T00:00:00.000Z',
    );
    const open = pendingQuote(
      'quote-2',
      'account-1',
      1,
      'transfer-2',
      '2099-01-01T00:00:00.000Z',
    );
    const failedQuote = pendingQuote(
      'quote-3',
      'account-1',
      1,
      'transfer-3',
      '1970-01-01T00:00:00.000Z',
    );
    const completed = {
      id: 'quote-2',
      accountId: 'account-1',
      version: 2,
      state: 'COMPLETED',
      userId: 'user-1',
    } as SparkSendQuote;
    const failed = {
      id: 'quote-3',
      accountId: 'account-1',
      version: 2,
      state: 'FAILED',
      userId: 'user-1',
    } as SparkSendQuote;
    const { kit, wallet, emitted, setInitiate, setComplete, setFail } = harness(
      {
        unresolved: [unpaidQuote, open, failedQuote],
      },
    );
    setInitiate(async () => pendingResult);
    setComplete(async () => completed);
    setFail(async () => failed);
    await flush();
    expect(emitted).toEqual([pendingResult]);
    wallet.listeners[0]?.onEvent({
      type: 'paymentSucceeded',
      payment: payment('transfer-2', 'completed', 'preimage-fixture'),
    });
    wallet.listeners[0]?.onEvent({
      type: 'paymentFailed',
      payment: payment('transfer-3', 'failed'),
    });
    await flush();
    expect(emitted).toEqual([pendingResult, completed, failed]);
    expect(kit.logger.debugLog).toEqual([
      {
        message: 'Send quote completed',
        meta: { quoteId: 'quote-2', accountId: 'account-1' },
      },
    ]);
  });

  it('(h) registers one listener per spark account and removes each at stint end', async () => {
    const first = createWallet();
    const second = createWallet();
    const { kit } = harness({
      accounts: [
        sparkAccount('account-1', first.wallet),
        sparkAccount('account-2', second.wallet),
      ],
      unresolved: [
        pendingQuote('quote-1', 'account-1', 1, 'transfer-1'),
        pendingQuote('quote-2', 'account-1', 1, 'transfer-2'),
        pendingQuote('quote-3', 'account-2', 1, 'transfer-3'),
      ],
    });
    await flush();
    expect(first.addCalls).toHaveLength(1);
    expect(second.addCalls).toHaveLength(1);
    expect(first.listeners).toHaveLength(1);
    expect(first.getPaymentCalls).toEqual(['transfer-1', 'transfer-2']);
    expect(second.getPaymentCalls).toEqual(['transfer-3']);
    expect(first.removeCalls).toHaveLength(0);
    expect(second.removeCalls).toHaveLength(0);
    kit.cancel();
    expect(first.removeCalls).toEqual(first.addCalls);
    expect(second.removeCalls).toEqual(second.addCalls);
  });

  it('(i) fails an already-paid invoice after one initiate attempt', async () => {
    const error = new DomainError('Lightning invoice has already been paid.');
    const quote = unpaid('quote-1', 'account-1', 1);
    const { kit, keys, initiateCalls, failCalls, setInitiate } = harness({
      unresolved: [quote],
    });
    setInitiate(async () => {
      throw error;
    });
    await flush();
    expect(initiateCalls).toHaveLength(1);
    expect(initiateCalls[0]?.args).toEqual([
      { account: initiateCalls[0]?.account, sendQuote: quote },
    ]);
    expect(failCalls).toHaveLength(1);
    expect(failCalls[0]?.reason).toBe(
      'Lightning invoice has already been paid.',
    );
    expect(failCalls[0]?.args).toEqual([
      quote,
      'Lightning invoice has already been paid.',
    ]);
    expect(keys).toEqual([
      'spark-send-quote-quote-1',
      'spark-send-quote-quote-1',
    ]);
    expect(kit.clock.timeouts).toHaveLength(0);
    expect(kit.logger.errorLog).toHaveLength(0);
  });

  it('(j) checks getPayment again after a rejected check', async () => {
    const error = new Error('breez down');
    const quote = pendingQuote('quote-1', 'account-1', 1, 'transfer-1');
    const { kit, wallet } = harness({
      unresolved: [quote],
    });
    wallet.setGetPayment(async () => {
      throw error;
    });
    await flush();
    expect(wallet.getPaymentCalls).toEqual(['transfer-1']);
    expect(kit.logger.errorLog).toEqual([
      {
        message: 'Error checking initial send payment status',
        meta: { cause: error, sparkTransferId: 'transfer-1' },
      },
    ]);
    kit.events.emit('spark-send-quote.updated', {
      quote: pendingQuote('quote-1', 'account-1', 2, 'transfer-1'),
    });
    await flush();
    expect(wallet.getPaymentCalls).toEqual(['transfer-1', 'transfer-1']);
    expect(kit.logger.errorLog).toHaveLength(2);
    expect(kit.logger.errorLog[1]).toEqual({
      message: 'Error checking initial send payment status',
      meta: { cause: error, sparkTransferId: 'transfer-1' },
    });
  });

  it('(k) initiates again after a failed initiate and the next reload', async () => {
    const error = new Error('network down');
    const quote = unpaid('quote-1', 'account-1', 1);
    const { kit, keys, initiateCalls, setInitiate } = harness({
      unresolved: [quote],
    });
    setInitiate(async () => {
      throw error;
    });
    await flush();
    expect(initiateCalls).toHaveLength(1);
    expect(keys).toEqual(['spark-send-quote-quote-1']);
    armed(kit.clock.timeouts, 1000)?.callback();
    await flush();
    expect(initiateCalls).toHaveLength(2);
    armed(kit.clock.timeouts, 2000)?.callback();
    await flush();
    expect(initiateCalls).toHaveLength(3);
    armed(kit.clock.timeouts, 4000)?.callback();
    await flush();
    expect(initiateCalls).toHaveLength(4);
    expect(initiateCalls.every((call) => call.quote.id === 'quote-1')).toBe(
      true,
    );
    expect(kit.logger.errorLog).toEqual([
      {
        message: 'Initiate spark send quote error',
        meta: { cause: error, sendQuoteId: 'quote-1' },
      },
    ]);
    expect(keys).toEqual(['spark-send-quote-quote-1']);
    kit.events.emit('connection.changed', { state: 'connected' });
    await flush();
    expect(initiateCalls).toHaveLength(5);
    expect(initiateCalls[4]?.quote.id).toBe('quote-1');
    expect(initiateCalls[4]?.quote.state).toBe('UNPAID');
    expect(initiateCalls[4]?.args).toEqual([
      {
        account: initiateCalls[4]?.account,
        sendQuote: initiateCalls[4]?.quote,
      },
    ]);
    expect(keys).toEqual([
      'spark-send-quote-quote-1',
      'spark-send-quote-quote-1',
    ]);
  });

  it('(l) logs an account read failure and does not initiate', async () => {
    const error = new Error('accounts down');
    const { kit, initiateCalls } = harness({
      loadAccounts: async () => {
        throw error;
      },
      unresolved: [unpaid('quote-1', 'account-1', 1)],
    });
    await flush();
    expect(initiateCalls).toHaveLength(0);
    expect(kit.logger.warnLog).toEqual([
      {
        message: 'Failed to load accounts for task processing',
        meta: { saga: 'spark-send-quote', cause: error },
      },
    ]);
    expect(
      (kit.logger.warnLog[0]?.meta as { cause: unknown } | undefined)?.cause,
    ).toBe(error);
  });
});
