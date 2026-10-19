import { describe, expect, it } from 'bun:test';
import type {
  EventListener,
  GetPaymentByInvoiceResponse,
  Payment,
} from '@agicash/breez-sdk-spark';
import type { ExtendedCashuWallet } from '@agicash/cashu';
import { type Currency, Money } from '@agicash/money';
import {
  type MeltQuoteBolt11Response,
  MintOperationError,
} from '@cashu/cashu-ts';
import type { MeltQuoteSubscriptionManager } from '../../lib/melt-quote-subscription-manager';
import type { RunScope } from '../../lib/run-scope';
import type { Account, CashuAccount, SparkAccount } from '../accounts/account';
import {
  GIVE_UP_RETRY_MS,
  type KeyedSerialQueue,
  createKeyedSerialQueue,
} from '../wallet/task-saga';
import {
  type RecordedTimer,
  createTestStint,
  deferred,
  flush,
} from '../wallet/task-saga-test-kit';
import type { SparkReceiveQuote } from './spark-receive-quote';
import type { SparkReceiveQuoteRepository } from './spark-receive-quote-repository';
import { createSparkReceiveQuoteSaga } from './spark-receive-quote-saga';
import type { SparkReceiveQuoteService } from './spark-receive-quote-service';

const SOURCE_MINT_URL = 'https://source.example';

type SubscribeCall = {
  mintUrl: string;
  quoteIds: string[];
  onUpdate: (quote: MeltQuoteBolt11Response) => void;
};

function fakeMeltManager() {
  const calls: SubscribeCall[] = [];
  return {
    calls,
    manager: {
      subscribe: async (call: SubscribeCall) => {
        calls.push(call);
        return () => undefined;
      },
      unsubscribeAll: () => undefined,
    },
  };
}

type FakeBreez = {
  listeners: EventListener[];
  addAttempts: number;
  beforeAdd: () => Promise<void>;
  added: string[];
  removed: string[];
  lookups: string[];
  lookup: (invoice: string) => Promise<GetPaymentByInvoiceResponse>;
  emit: (event: Parameters<EventListener['onEvent']>[0]) => void;
};

function sparkAccount(options: { id: string; isOnline?: boolean }): {
  account: SparkAccount;
  breez: FakeBreez;
} {
  const breez: FakeBreez = {
    listeners: [],
    addAttempts: 0,
    beforeAdd: async () => undefined,
    added: [],
    removed: [],
    lookups: [],
    lookup: async () => ({}),
    emit: (event) => {
      for (const listener of breez.listeners) {
        listener.onEvent(event);
      }
    },
  };
  const account = {
    id: options.id,
    type: 'spark',
    isOnline: options.isOnline ?? true,
    version: 1,
    currency: 'BTC',
    wallet: {
      addEventListener: async (listener: EventListener) => {
        breez.addAttempts += 1;
        await breez.beforeAdd();
        breez.listeners.push(listener);
        const id = `listener-${options.id}-${breez.listeners.length}`;
        breez.added.push(id);
        return id;
      },
      removeEventListener: async (id: string) => {
        breez.removed.push(id);
        return true;
      },
      getPaymentByInvoice: ({ invoice }: { invoice: string }) => {
        breez.lookups.push(invoice);
        return breez.lookup(invoice);
      },
    },
  } as unknown as SparkAccount;
  return { account, breez };
}

type MeltCall = { meltQuote: { quote: string; amount: number } };

function sourceAccount(options: {
  meltCalls: MeltCall[];
  meltImpl?: () => Promise<unknown>;
}): CashuAccount {
  return {
    id: 'account-source',
    type: 'cashu',
    isOnline: true,
    version: 1,
    currency: 'BTC',
    mintUrl: SOURCE_MINT_URL,
    wallet: {
      meltProofsIdempotent: (meltQuote: MeltCall['meltQuote']) => {
        options.meltCalls.push({ meltQuote });
        return options.meltImpl ? options.meltImpl() : Promise.resolve({});
      },
    },
  } as unknown as CashuAccount;
}

function amount(sats: number): Money<Currency> {
  return new Money<Currency>({ amount: sats, currency: 'BTC', unit: 'sat' });
}

function lightningQuote(
  overrides?: Partial<SparkReceiveQuote>,
): SparkReceiveQuote {
  return {
    id: 'quote-1',
    accountId: 'spark-1',
    userId: 'user-1',
    type: 'LIGHTNING',
    state: 'UNPAID',
    version: 1,
    amount: amount(1000),
    paymentRequest: 'invoice-fixture-1',
    paymentHash: 'hash-1',
    transactionId: 'tx-1',
    expiresAt: new Date(100_000).toISOString(),
    ...overrides,
  } as SparkReceiveQuote;
}

function tokenQuote(options?: { meltInitiated?: boolean }): SparkReceiveQuote {
  return {
    ...lightningQuote(),
    type: 'CASHU_TOKEN',
    tokenReceiveData: {
      sourceMintUrl: SOURCE_MINT_URL,
      tokenAmount: amount(1010),
      tokenProofs: [{ id: 'keyset', amount: 1010, secret: 's', C: 'c' }],
      meltQuoteId: 'melt-quote-1',
      meltInitiated: options?.meltInitiated ?? false,
    },
  } as unknown as SparkReceiveQuote;
}

function lightningPayment(overrides?: {
  paymentHash?: string;
  preimage?: string | null;
  type?: string;
}): Payment {
  return {
    id: 'transfer-1',
    status: 'completed',
    details: {
      type: overrides?.type ?? 'lightning',
      htlcDetails: {
        paymentHash: overrides?.paymentHash ?? 'hash-1',
        preimage:
          overrides?.preimage === null
            ? undefined
            : (overrides?.preimage ?? 'preimage-fixture'),
      },
    },
  } as unknown as Payment;
}

function armed(timers: RecordedTimer[], ms: number): RecordedTimer | undefined {
  const matches = timers.filter((timer) => timer.ms === ms && !timer.cancelled);
  return matches[matches.length - 1];
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await flush();
  }
}

function recordingQueue(): {
  queue: KeyedSerialQueue;
  keys: Array<string | undefined>;
} {
  const inner = createKeyedSerialQueue();
  const keys: Array<string | undefined> = [];
  return {
    keys,
    queue: {
      enqueue: (
        key: string | undefined,
        scope: RunScope,
        job: () => Promise<void>,
      ) => {
        keys.push(key);
        inner.enqueue(key, scope, job);
      },
    },
  };
}

function harness(options: {
  pending: SparkReceiveQuote[];
  accounts: Account[];
}) {
  const recorded = recordingQueue();
  const kit = createTestStint({
    loadAccounts: async () => options.accounts,
    queue: recorded.queue,
  });
  const melt = fakeMeltManager();
  const calls = {
    complete: [] as Array<{
      quote: SparkReceiveQuote;
      preimage: string;
      transferId: string;
    }>,
    expire: [] as SparkReceiveQuote[],
    fail: [] as Array<{ quote: SparkReceiveQuote; reason: string }>,
    markMeltInitiated: [] as SparkReceiveQuote[],
  };
  const impl = {
    complete: async (quote: SparkReceiveQuote): Promise<SparkReceiveQuote> =>
      ({
        ...quote,
        state: 'PAID',
        version: quote.version + 1,
      }) as SparkReceiveQuote,
  };
  const emitted: SparkReceiveQuote[] = [];
  kit.events.on('spark-receive-quote.updated', ({ quote }) => {
    emitted.push(quote);
  });
  const saga = createSparkReceiveQuoteSaga({
    getRepository: async () =>
      ({
        getPending: async () => options.pending,
      }) as unknown as SparkReceiveQuoteRepository,
    getService: async () =>
      ({
        complete: (
          quote: SparkReceiveQuote,
          preimage: string,
          transferId: string,
        ) => {
          calls.complete.push({ quote, preimage, transferId });
          return impl.complete(quote);
        },
        expire: async (quote: SparkReceiveQuote) => {
          calls.expire.push(quote);
        },
        fail: async (quote: SparkReceiveQuote, reason: string) => {
          calls.fail.push({ quote, reason });
        },
        markMeltInitiated: async (quote: SparkReceiveQuote) => {
          calls.markMeltInitiated.push(quote);
          return { ...quote, version: quote.version + 1 };
        },
      }) as unknown as SparkReceiveQuoteService,
    getCashuWallet: () => ({}) as ExtendedCashuWallet,
    createMeltManager: () =>
      melt.manager as unknown as MeltQuoteSubscriptionManager,
  });
  saga.start(kit.stint);
  const meltUpdate = (state: string) =>
    melt.calls.at(-1)?.onUpdate({
      quote: 'melt-quote-1',
      state,
      amount: 1000,
    } as MeltQuoteBolt11Response);
  return {
    ...kit,
    keys: recorded.keys,
    melt,
    calls,
    impl,
    emitted,
    meltUpdate,
  };
}

describe('createSparkReceiveQuoteSaga', () => {
  it('(a) one listener per spark account across several quotes and syncs', async () => {
    const one = sparkAccount({ id: 'spark-1' });
    const two = sparkAccount({ id: 'spark-2' });
    const h = harness({
      pending: [
        lightningQuote(),
        lightningQuote({
          id: 'quote-2',
          paymentRequest: 'invoice-fixture-2',
          paymentHash: 'hash-2',
        }),
        lightningQuote({
          id: 'quote-3',
          accountId: 'spark-2',
          paymentRequest: 'invoice-fixture-3',
          paymentHash: 'hash-3',
        }),
      ],
      accounts: [one.account, two.account],
    });
    await settle();
    h.events.emit('spark-receive-quote.created', {
      quote: lightningQuote({
        id: 'quote-4',
        paymentRequest: 'invoice-fixture-4',
        paymentHash: 'hash-4',
      }),
    });
    await settle();
    expect(one.breez.added).toEqual(['listener-spark-1-1']);
    expect(two.breez.added).toEqual(['listener-spark-2-1']);

    one.breez.emit({
      type: 'paymentSucceeded',
      payment: { ...lightningPayment({ paymentHash: 'hash-4' }) },
    });
    await settle();
    expect(h.calls.complete.map((c) => c.quote.id)).toEqual(['quote-4']);
  });

  it('(b) paymentSucceeded completes the matching quote; others do nothing', async () => {
    const spark = sparkAccount({ id: 'spark-1' });
    const h = harness({
      pending: [lightningQuote()],
      accounts: [spark.account],
    });
    await settle();

    spark.breez.emit({
      type: 'paymentSucceeded',
      payment: lightningPayment({ type: 'spark' }),
    });
    spark.breez.emit({
      type: 'paymentSucceeded',
      payment: lightningPayment({ paymentHash: 'hash-other' }),
    });
    await settle();
    expect(h.calls.complete).toHaveLength(0);

    spark.breez.emit({
      type: 'paymentSucceeded',
      payment: lightningPayment({ preimage: null }),
    });
    await settle();
    expect(h.calls.complete).toHaveLength(0);
    expect(h.logger.errorLog).toEqual([
      {
        message: 'Receive payment succeeded but no preimage',
        meta: { paymentId: 'transfer-1', quoteId: 'quote-1' },
      },
    ]);

    spark.breez.emit({ type: 'paymentSucceeded', payment: lightningPayment() });
    await settle();
    expect(h.calls.complete).toHaveLength(1);
    expect(h.calls.complete[0]?.quote.id).toBe('quote-1');
    expect(h.calls.complete[0]?.preimage).toBe('preimage-fixture');
    expect(h.calls.complete[0]?.transferId).toBe('transfer-1');
  });

  it('(c) synced expires only the quotes past expiry', async () => {
    const spark = sparkAccount({ id: 'spark-1' });
    const h = harness({
      pending: [
        lightningQuote(),
        lightningQuote({
          id: 'quote-2',
          paymentRequest: 'invoice-fixture-2',
          paymentHash: 'hash-2',
          expiresAt: new Date(500_000).toISOString(),
        }),
      ],
      accounts: [spark.account],
    });
    await settle();
    h.setNow(100_001);
    spark.breez.emit({ type: 'synced' });
    await settle();
    expect(h.calls.expire.map((q) => q.id)).toEqual(['quote-1']);
    expect(h.calls.complete).toHaveLength(0);
  });

  it('(d) the initial check runs once per quote', async () => {
    const spark = sparkAccount({ id: 'spark-1' });
    const h = harness({
      pending: [lightningQuote()],
      accounts: [spark.account],
    });
    await settle();
    expect(spark.breez.lookups).toEqual(['invoice-fixture-1']);
    h.events.emit('spark-receive-quote.updated', {
      quote: lightningQuote({ version: 2 }),
    });
    await settle();
    expect(spark.breez.lookups).toEqual(['invoice-fixture-1']);
  });

  it('(e) complete and a melt-path fail on one quote run FIFO on one key', async () => {
    const spark = sparkAccount({ id: 'spark-1' });
    const h = harness({
      pending: [tokenQuote({ meltInitiated: true })],
      accounts: [spark.account],
    });
    await settle();
    const first = deferred<SparkReceiveQuote>();
    h.impl.complete = () => first.promise;
    spark.breez.emit({ type: 'paymentSucceeded', payment: lightningPayment() });
    await settle();
    expect(h.calls.complete).toHaveLength(1);

    h.meltUpdate('UNPAID');
    await settle();
    expect(h.calls.fail).toHaveLength(0);

    first.resolve(tokenQuote({ meltInitiated: true }));
    await settle();
    expect(h.calls.fail.map((c) => [c.quote.id, c.reason])).toEqual([
      ['quote-1', 'Cashu token melt failed.'],
    ]);
    expect(h.keys).toEqual([
      'spark-receive-quote-quote-1',
      'spark-receive-quote-quote-1',
    ]);
  });

  it('(f) a completed quote is logged and emitted', async () => {
    const spark = sparkAccount({ id: 'spark-1' });
    const h = harness({
      pending: [lightningQuote()],
      accounts: [spark.account],
    });
    await settle();
    spark.breez.emit({ type: 'paymentSucceeded', payment: lightningPayment() });
    await settle();
    expect(h.emitted.map((q) => [q.id, q.state, q.version])).toEqual([
      ['quote-1', 'PAID', 2],
    ]);
    expect(h.logger.debugLog).toContainEqual({
      message: 'Receive quote completed',
      meta: { quoteId: 'quote-1', accountId: 'spark-1', transactionId: 'tx-1' },
    });
  });

  it('(g) stint end removes every listener once', async () => {
    const one = sparkAccount({ id: 'spark-1' });
    const two = sparkAccount({ id: 'spark-2' });
    const h = harness({
      pending: [
        lightningQuote(),
        lightningQuote({
          id: 'quote-2',
          accountId: 'spark-2',
          paymentRequest: 'invoice-fixture-2',
          paymentHash: 'hash-2',
        }),
      ],
      accounts: [one.account, two.account],
    });
    await settle();
    expect(one.breez.removed).toEqual([]);
    h.cancel();
    await settle();
    expect(one.breez.removed).toEqual(['listener-spark-1-1']);
    expect(two.breez.removed).toEqual(['listener-spark-2-1']);
  });

  it('(h) an initiateMelt MintOperationError fails the quote on its key', async () => {
    const spark = sparkAccount({ id: 'spark-1' });
    const meltCalls: MeltCall[] = [];
    const mintError = new MintOperationError(20000, 'Token already spent');
    const h = harness({
      pending: [tokenQuote()],
      accounts: [
        spark.account,
        sourceAccount({ meltCalls, meltImpl: () => Promise.reject(mintError) }),
      ],
    });
    await settle();
    expect(h.melt.calls.map((c) => [c.mintUrl, c.quoteIds])).toEqual([
      [SOURCE_MINT_URL, ['melt-quote-1']],
    ]);
    h.meltUpdate('UNPAID');
    await settle();
    expect(meltCalls).toHaveLength(1);
    expect(h.logger.warnLog).toEqual([
      {
        message: 'Failed to initiate melt.',
        meta: { cause: mintError, receiveQuoteId: 'quote-1' },
      },
    ]);
    expect(h.calls.fail.map((c) => [c.quote.id, c.reason])).toEqual([
      ['quote-1', mintError.message],
    ]);
    expect(h.keys).toEqual([
      'spark-receive-quote-quote-1',
      'spark-receive-quote-quote-1',
    ]);
  });

  it('(h2) the melt amount is in the cashu unit', async () => {
    const spark = sparkAccount({ id: 'spark-1' });
    const meltCalls: MeltCall[] = [];
    const h = harness({
      pending: [tokenQuote()],
      accounts: [spark.account, sourceAccount({ meltCalls })],
    });
    await settle();
    h.meltUpdate('UNPAID');
    await settle();
    expect(meltCalls).toHaveLength(1);
    expect(meltCalls[0]?.meltQuote).toEqual({
      quote: 'melt-quote-1',
      amount: 1000,
    });
  });

  it('(i) an offline spark account gets no listener and no check', async () => {
    const spark = sparkAccount({ id: 'spark-1', isOnline: false });
    harness({ pending: [lightningQuote()], accounts: [spark.account] });
    await settle();
    expect(spark.breez.added).toEqual([]);
    expect(spark.breez.lookups).toEqual([]);
  });

  it('(j) a failed initial check runs again on the next sync', async () => {
    const spark = sparkAccount({ id: 'spark-1' });
    const cause = new Error('lookup failed');
    spark.breez.lookup = () => Promise.reject(cause);
    const h = harness({
      pending: [lightningQuote()],
      accounts: [spark.account],
    });
    await settle();
    expect(spark.breez.lookups).toEqual(['invoice-fixture-1']);
    expect(h.logger.errorLog).toEqual([
      {
        message: 'Error checking initial receive payment',
        meta: { cause, accountId: 'spark-1', quoteId: 'quote-1' },
      },
    ]);
    spark.breez.lookup = async () => ({});
    h.events.emit('spark-receive-quote.updated', {
      quote: lightningQuote({ version: 2 }),
    });
    await settle();
    expect(spark.breez.lookups).toEqual([
      'invoice-fixture-1',
      'invoice-fixture-1',
    ]);
  });

  it('(k) synced completes a past-due quote whose lookup is completed', async () => {
    const spark = sparkAccount({ id: 'spark-1' });
    const h = harness({
      pending: [lightningQuote()],
      accounts: [spark.account],
    });
    await settle();
    spark.breez.lookup = async () => ({ payment: lightningPayment() });
    h.setNow(100_001);
    spark.breez.emit({ type: 'synced' });
    await settle();
    expect(h.calls.complete.map((c) => [c.quote.id, c.preimage])).toEqual([
      ['quote-1', 'preimage-fixture'],
    ]);
    expect(h.calls.expire).toHaveLength(0);
  });

  it('(l) synced expires a past-due quote whose lookup throws', async () => {
    const spark = sparkAccount({ id: 'spark-1' });
    const h = harness({
      pending: [lightningQuote()],
      accounts: [spark.account],
    });
    await settle();
    spark.breez.lookup = () => Promise.reject(new Error('lookup failed'));
    h.setNow(100_001);
    spark.breez.emit({ type: 'synced' });
    await settle();
    expect(h.calls.expire.map((q) => q.id)).toEqual(['quote-1']);
    expect(h.calls.complete).toHaveLength(0);
    expect(armed(h.clock.timeouts, 1000)).toBeUndefined();
  });

  it('(m) a reconnect reload runs the initial check again', async () => {
    const spark = sparkAccount({ id: 'spark-1' });
    const h = harness({
      pending: [lightningQuote()],
      accounts: [spark.account],
    });
    await settle();
    expect(spark.breez.lookups).toEqual(['invoice-fixture-1']);
    h.events.emit('connection.changed', { state: 'connected' });
    await settle();
    expect(spark.breez.lookups).toEqual([
      'invoice-fixture-1',
      'invoice-fixture-1',
    ]);
  });

  it('(n) the initial check runs when adding the listener fails; the next sync adds it again', async () => {
    const spark = sparkAccount({ id: 'spark-1' });
    const cause = new Error('listener down');
    spark.breez.beforeAdd = () => Promise.reject(cause);
    const h = harness({
      pending: [lightningQuote()],
      accounts: [spark.account],
    });
    await settle();
    expect(spark.breez.addAttempts).toBe(1);
    expect(spark.breez.added).toEqual([]);
    expect(spark.breez.lookups).toEqual(['invoice-fixture-1']);
    expect(h.logger.errorLog).toEqual([
      {
        message: 'Failed to add Spark event listener',
        meta: { cause, accountId: 'spark-1' },
      },
    ]);
    spark.breez.beforeAdd = async () => undefined;
    h.events.emit('spark-receive-quote.updated', {
      quote: lightningQuote({ version: 2 }),
    });
    await settle();
    expect(spark.breez.addAttempts).toBe(2);
    expect(spark.breez.added).toEqual(['listener-spark-1-1']);
  });

  it('(o) the initial check does not wait for the listener registration', async () => {
    const spark = sparkAccount({ id: 'spark-1' });
    const gate = deferred<void>();
    spark.breez.beforeAdd = () => gate.promise;
    harness({ pending: [lightningQuote()], accounts: [spark.account] });
    await settle();
    expect(spark.breez.addAttempts).toBe(1);
    expect(spark.breez.added).toEqual([]);
    expect(spark.breez.lookups).toEqual(['invoice-fixture-1']);
    gate.resolve();
    await settle();
    expect(spark.breez.added).toEqual(['listener-spark-1-1']);
  });

  it('(p) a stale initial check does not clear a newer check', async () => {
    const spark = sparkAccount({ id: 'spark-1' });
    const stale = deferred<GetPaymentByInvoiceResponse>();
    const fresh = deferred<GetPaymentByInvoiceResponse>();
    const results = [stale.promise, fresh.promise];
    spark.breez.lookup = () => results.shift() ?? Promise.resolve({});
    const h = harness({
      pending: [lightningQuote()],
      accounts: [spark.account],
    });
    await settle();
    expect(spark.breez.lookups).toHaveLength(1);
    h.events.emit('connection.changed', { state: 'connected' });
    await settle();
    expect(spark.breez.lookups).toHaveLength(2);
    stale.reject(new Error('stale lookup failed'));
    await settle();
    h.events.emit('spark-receive-quote.updated', {
      quote: lightningQuote({ version: 2 }),
    });
    await settle();
    expect(spark.breez.lookups).toHaveLength(2);
    expect(h.logger.errorLog).toEqual([]);
    fresh.resolve({});
    await settle();
  });

  it('(q) a complete that gave up runs again when the give-up retry interval fires', async () => {
    const spark = sparkAccount({ id: 'spark-1' });
    spark.breez.lookup = async () => ({ payment: lightningPayment() });
    const h = harness({
      pending: [lightningQuote()],
      accounts: [spark.account],
    });
    const succeed = h.impl.complete;
    const cause = new Error('complete down');
    h.impl.complete = () => Promise.reject(cause);
    await settle();
    expect(h.calls.complete).toHaveLength(1);
    for (const ms of [1000, 2000, 4000]) {
      armed(h.clock.timeouts, ms)?.callback();
      await settle();
    }
    expect(h.calls.complete).toHaveLength(4);
    expect(h.logger.errorLog).toEqual([
      {
        message: 'Complete spark receive quote error',
        meta: { cause, receiveQuoteId: 'quote-1' },
      },
    ]);
    h.impl.complete = succeed;
    const interval = armed(h.clock.intervals, GIVE_UP_RETRY_MS);
    expect(interval).toBeDefined();
    interval?.callback();
    await settle();
    expect(h.calls.complete).toHaveLength(5);
    expect(spark.breez.removed).toEqual(['listener-spark-1-1']);
    expect(spark.breez.added).toEqual([
      'listener-spark-1-1',
      'listener-spark-1-2',
    ]);
    expect(h.emitted.map((q) => [q.id, q.state])).toEqual([
      ['quote-1', 'PAID'],
    ]);
  });
});
