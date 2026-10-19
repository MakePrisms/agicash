import { describe, expect, it } from 'bun:test';
import type { ExtendedCashuWallet } from '@agicash/cashu';
import { type Currency, Money } from '@agicash/money';
import {
  type MeltQuoteBolt11Response,
  MintOperationError,
} from '@cashu/cashu-ts';
import type { MeltQuoteSubscriptionManager } from '../../lib/melt-quote-subscription-manager';
import type { RunScope } from '../../lib/run-scope';
import type { Account, CashuAccount } from '../accounts/account';
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
import type { CashuSendQuote } from './cashu-send-quote';
import type { CashuSendQuoteRepository } from './cashu-send-quote-repository';
import { createCashuSendQuoteSaga } from './cashu-send-quote-saga';
import type { CashuSendQuoteService } from './cashu-send-quote-service';

const MINT_URL = 'https://mint.example';

type SubscribeCall = {
  mintUrl: string;
  quoteIds: string[];
  onUpdate: (quote: MeltQuoteBolt11Response) => void;
};

function fakeManager() {
  const calls: SubscribeCall[] = [];
  const removed: Array<{ mintUrl: string; quoteId: string }> = [];
  let unsubscribeAllCalls = 0;
  return {
    calls,
    removed,
    unsubscribeAllCalls: () => unsubscribeAllCalls,
    manager: {
      subscribe: async (call: SubscribeCall) => {
        calls.push(call);
        return () => undefined;
      },
      removeQuoteFromSubscription: (args: {
        mintUrl: string;
        quoteId: string;
      }) => {
        removed.push(args);
      },
      unsubscribeAll: () => {
        unsubscribeAllCalls += 1;
      },
    },
  };
}

function cashuAccount(options: {
  id: string;
  checkMeltQuote?: (id: string) => Promise<MeltQuoteBolt11Response>;
}): CashuAccount {
  return {
    id: options.id,
    type: 'cashu',
    isOnline: true,
    version: 1,
    currency: 'BTC',
    mintUrl: MINT_URL,
    wallet: {
      checkMeltQuoteBolt11: (id: string) =>
        options.checkMeltQuote
          ? options.checkMeltQuote(id)
          : Promise.resolve({ quote: id, state: 'UNPAID', amount: 1000 }),
    },
  } as unknown as CashuAccount;
}

function sendQuote(overrides?: Partial<CashuSendQuote>): CashuSendQuote {
  return {
    id: 'quote-1',
    quoteId: 'melt-quote-1',
    accountId: 'account-1',
    userId: 'user-1',
    state: 'UNPAID',
    version: 1,
    amountToReceive: new Money<Currency>({
      amount: 1000,
      currency: 'BTC',
      unit: 'sat',
    }),
    proofs: [
      { id: 'keyset', amount: 1000, secret: 's', unblindedSignature: 'c' },
    ],
    keysetId: 'keyset',
    keysetCounter: 0,
    transactionId: 'tx-1',
    expiresAt: new Date(100_000).toISOString(),
    ...overrides,
  } as unknown as CashuSendQuote;
}

function meltQuote(
  state: string,
  overrides?: Partial<MeltQuoteBolt11Response>,
): MeltQuoteBolt11Response {
  return {
    quote: 'melt-quote-1',
    state,
    amount: 1000,
    ...overrides,
  } as MeltQuoteBolt11Response;
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

type ServiceImpl = {
  initiateSend: () => Promise<unknown>;
  markSendQuoteAsPending: (quote: CashuSendQuote) => Promise<CashuSendQuote>;
  completeSendQuote: (quote: CashuSendQuote) => Promise<CashuSendQuote>;
  failSendQuote: (quote: CashuSendQuote) => Promise<CashuSendQuote>;
};

function harness(options: { pending: CashuSendQuote[]; accounts?: Account[] }) {
  const accounts = options.accounts ?? [cashuAccount({ id: 'account-1' })];
  const recorded = recordingQueue();
  const kit = createTestStint({
    loadAccounts: async () => accounts,
    queue: recorded.queue,
  });
  const melt = fakeManager();
  const calls = {
    initiateSend: [] as Array<{
      account: CashuAccount;
      quote: CashuSendQuote;
      meltQuote: MeltQuoteBolt11Response;
    }>,
    markSendQuoteAsPending: [] as CashuSendQuote[],
    completeSendQuote: [] as Array<{
      account: CashuAccount;
      quote: CashuSendQuote;
      meltQuote: MeltQuoteBolt11Response;
    }>,
    failSendQuote: [] as Array<{
      account: CashuAccount;
      quote: CashuSendQuote;
      reason: string;
    }>,
    expireSendQuote: [] as CashuSendQuote[],
  };
  const impl: ServiceImpl = {
    initiateSend: async () => ({}),
    markSendQuoteAsPending: async (quote) =>
      ({
        ...quote,
        state: 'PENDING',
        version: quote.version + 1,
      }) as CashuSendQuote,
    completeSendQuote: async (quote) =>
      ({
        ...quote,
        state: 'PAID',
        version: quote.version + 1,
      }) as CashuSendQuote,
    failSendQuote: async (quote) =>
      ({
        ...quote,
        state: 'FAILED',
        version: quote.version + 1,
      }) as CashuSendQuote,
  };
  const emitted: CashuSendQuote[] = [];
  kit.events.on('cashu-send-quote.updated', ({ quote }) => {
    emitted.push(quote);
  });
  const saga = createCashuSendQuoteSaga({
    getRepository: async () =>
      ({
        getUnresolved: async () => options.pending,
      }) as unknown as CashuSendQuoteRepository,
    getService: async () =>
      ({
        initiateSend: (
          account: CashuAccount,
          quote: CashuSendQuote,
          meltQuote: MeltQuoteBolt11Response,
        ) => {
          calls.initiateSend.push({ account, quote, meltQuote });
          return impl.initiateSend();
        },
        markSendQuoteAsPending: (quote: CashuSendQuote) => {
          calls.markSendQuoteAsPending.push(quote);
          return impl.markSendQuoteAsPending(quote);
        },
        completeSendQuote: (
          account: CashuAccount,
          quote: CashuSendQuote,
          meltQuote: MeltQuoteBolt11Response,
        ) => {
          calls.completeSendQuote.push({ account, quote, meltQuote });
          return impl.completeSendQuote(quote);
        },
        failSendQuote: (
          account: CashuAccount,
          quote: CashuSendQuote,
          reason: string,
        ) => {
          calls.failSendQuote.push({ account, quote, reason });
          return impl.failSendQuote(quote);
        },
        expireSendQuote: async (quote: CashuSendQuote) => {
          calls.expireSendQuote.push(quote);
        },
      }) as unknown as CashuSendQuoteService,
    getCashuWallet: () => ({}) as ExtendedCashuWallet,
    createMeltManager: () =>
      melt.manager as unknown as MeltQuoteSubscriptionManager,
  });
  saga.start(kit.stint);
  const meltUpdate = (quote: MeltQuoteBolt11Response) =>
    melt.calls.at(-1)?.onUpdate(quote);
  return {
    ...kit,
    keys: recorded.keys,
    accounts,
    melt,
    calls,
    impl,
    emitted,
    meltUpdate,
  };
}

describe('createCashuSendQuoteSaga', () => {
  it('(a) an UNPAID melt update initiates the send on the initiate key', async () => {
    const h = harness({ pending: [sendQuote()] });
    await settle();
    expect(h.melt.calls.map((c) => [c.mintUrl, c.quoteIds])).toEqual([
      [MINT_URL, ['melt-quote-1']],
    ]);
    const update = meltQuote('UNPAID');
    h.meltUpdate(update);
    await settle();
    expect(h.calls.initiateSend).toHaveLength(1);
    expect(h.calls.initiateSend[0]?.quote.id).toBe('quote-1');
    expect(h.calls.initiateSend[0]?.account).toBe(
      h.accounts[0] as CashuAccount,
    );
    expect(h.calls.initiateSend[0]?.meltQuote).toBe(update);
    expect(h.keys).toEqual(['initiate-cashu-send-quote-quote-1']);
  });

  it('(b) PENDING runs while initiate is in flight; PAID queues behind PENDING', async () => {
    const h = harness({ pending: [sendQuote()] });
    await settle();
    const initiate = deferred<unknown>();
    h.impl.initiateSend = () => initiate.promise;
    h.meltUpdate(meltQuote('UNPAID'));
    await settle();
    expect(h.calls.initiateSend).toHaveLength(1);

    const pending = deferred<CashuSendQuote>();
    h.impl.markSendQuoteAsPending = () => pending.promise;
    h.meltUpdate(meltQuote('PENDING'));
    await settle();
    expect(h.calls.markSendQuoteAsPending.map((q) => q.id)).toEqual([
      'quote-1',
    ]);

    h.meltUpdate(meltQuote('PAID'));
    await settle();
    expect(h.calls.completeSendQuote).toHaveLength(0);

    pending.resolve(sendQuote({ state: 'PENDING', version: 2 }));
    await settle();
    expect(h.calls.completeSendQuote).toHaveLength(1);
    expect(h.calls.completeSendQuote[0]?.quote.state).toBe('PENDING');
    expect(h.keys).toEqual([
      'initiate-cashu-send-quote-quote-1',
      'cashu-send-quote-quote-1',
      'cashu-send-quote-quote-1',
    ]);
    initiate.resolve({});
    await settle();
  });

  it('(c) a MintOperationError warns, fails unkeyed and drops the melt subscription', async () => {
    const h = harness({ pending: [sendQuote()] });
    await settle();
    const mintError = new MintOperationError(20000, 'Lightning payment failed');
    h.impl.initiateSend = () => Promise.reject(mintError);
    h.meltUpdate(meltQuote('UNPAID'));
    await settle();
    expect(h.calls.initiateSend).toHaveLength(1);
    expect(h.logger.warnLog).toEqual([
      {
        message: 'Failed to initiate send.',
        meta: { cause: mintError, sendQuoteId: 'quote-1' },
      },
    ]);
    expect(h.calls.failSendQuote.map((c) => [c.quote.id, c.reason])).toEqual([
      ['quote-1', mintError.message],
    ]);
    expect(h.keys).toEqual(['initiate-cashu-send-quote-quote-1', undefined]);
    expect(h.melt.removed).toEqual([
      { mintUrl: MINT_URL, quoteId: 'melt-quote-1' },
    ]);
    expect(h.logger.errorLog).toHaveLength(0);
  });

  it('(d) a plain initiate error runs 4 attempts, then logs', async () => {
    const h = harness({ pending: [sendQuote()] });
    await settle();
    const plain = new Error('boom');
    h.impl.initiateSend = () => Promise.reject(plain);
    h.meltUpdate(meltQuote('UNPAID'));
    for (const ms of [1000, 2000, 4000]) {
      await settle();
      armed(h.clock.timeouts, ms)?.callback();
    }
    await settle();
    expect(h.calls.initiateSend).toHaveLength(4);
    expect(h.calls.failSendQuote).toHaveLength(0);
    expect(h.logger.errorLog).toEqual([
      {
        message: 'Initiate send error',
        meta: { cause: plain, sendQuoteId: 'quote-1' },
      },
    ]);
  });

  it('(e) the expiry timer re-checks the melt quote and expires the send quote', async () => {
    const checked: string[] = [];
    const h = harness({
      pending: [sendQuote()],
      accounts: [
        cashuAccount({
          id: 'account-1',
          checkMeltQuote: async (id) => {
            checked.push(id);
            return meltQuote('UNPAID', { quote: id });
          },
        }),
      ],
    });
    await settle();
    const timer = armed(h.clock.timeouts, 100_000);
    expect(timer).toBeDefined();
    h.setNow(100_001);
    timer?.callback();
    await settle();
    expect(checked).toEqual(['melt-quote-1']);
    expect(h.calls.expireSendQuote.map((q) => q.id)).toEqual(['quote-1']);
    expect(h.calls.initiateSend).toHaveLength(0);
    expect(h.keys).toEqual(['cashu-send-quote-quote-1']);
  });

  it('(f) a quote whose account is missing or offline is skipped silently; others proceed', async () => {
    const offline = {
      ...cashuAccount({ id: 'account-offline' }),
      isOnline: false,
    } as CashuAccount;
    const h = harness({
      pending: [
        sendQuote({
          id: 'quote-2',
          quoteId: 'melt-quote-2',
          accountId: 'account-missing',
        }),
        sendQuote({
          id: 'quote-3',
          quoteId: 'melt-quote-3',
          accountId: 'account-offline',
        }),
        sendQuote(),
      ],
      accounts: [cashuAccount({ id: 'account-1' }), offline],
    });
    await settle();
    expect(h.logger.errorLog).toHaveLength(0);
    expect(h.melt.calls.map((c) => [c.mintUrl, c.quoteIds])).toEqual([
      [MINT_URL, ['melt-quote-1']],
    ]);
    h.meltUpdate(meltQuote('UNPAID'));
    await settle();
    expect(h.calls.initiateSend.map((c) => c.quote.id)).toEqual(['quote-1']);
  });

  it('(g) PAID without the expected change completes with the re-checked melt quote', async () => {
    const withChange = meltQuote('PAID', {
      change: [{ id: 'keyset', amount: 8, C_: 'c' }],
    } as Partial<MeltQuoteBolt11Response>);
    const checked: string[] = [];
    const h = harness({
      pending: [
        sendQuote({
          state: 'PENDING',
          proofs: [
            {
              id: 'keyset',
              amount: 1010,
              secret: 's',
              unblindedSignature: 'c',
            },
          ],
        } as unknown as Partial<CashuSendQuote>),
      ],
      accounts: [
        cashuAccount({
          id: 'account-1',
          checkMeltQuote: async (id) => {
            checked.push(id);
            return withChange;
          },
        }),
      ],
    });
    await settle();
    h.meltUpdate(meltQuote('PAID'));
    await settle();
    expect(checked).toEqual(['melt-quote-1']);
    expect(h.calls.completeSendQuote).toHaveLength(1);
    expect(h.calls.completeSendQuote[0]?.meltQuote).toBe(withChange);
    expect(h.calls.completeSendQuote[0]?.quote.id).toBe('quote-1');
  });

  it('(h) emits .updated on pending, complete and fail; none on expire', async () => {
    const h = harness({ pending: [sendQuote()] });
    await settle();
    h.meltUpdate(meltQuote('PENDING'));
    await settle();
    h.meltUpdate(meltQuote('PAID'));
    await settle();
    expect(h.emitted.map((q) => [q.id, q.state, q.version])).toEqual([
      ['quote-1', 'PENDING', 2],
      ['quote-1', 'PAID', 3],
    ]);

    const f = harness({ pending: [sendQuote()] });
    await settle();
    f.impl.initiateSend = () =>
      Promise.reject(new MintOperationError(20000, 'failed'));
    f.meltUpdate(meltQuote('UNPAID'));
    await settle();
    expect(f.emitted.map((q) => [q.id, q.state])).toEqual([
      ['quote-1', 'FAILED'],
    ]);

    const e = harness({ pending: [sendQuote()] });
    await settle();
    e.setNow(100_001);
    armed(e.clock.timeouts, 100_000)?.callback();
    await settle();
    expect(e.calls.expireSendQuote).toHaveLength(1);
    expect(e.emitted).toHaveLength(0);
  });

  it('(i) a queued initiate does nothing once the quote is no longer UNPAID, and does not give up', async () => {
    const h = harness({ pending: [sendQuote()] });
    await settle();
    const first = deferred<unknown>();
    h.impl.initiateSend = () => first.promise;
    h.meltUpdate(meltQuote('UNPAID'));
    await settle();
    h.meltUpdate(meltQuote('UNPAID'));
    await settle();
    expect(h.calls.initiateSend).toHaveLength(1);
    expect(h.keys).toEqual([
      'initiate-cashu-send-quote-quote-1',
      'initiate-cashu-send-quote-quote-1',
    ]);

    h.events.emit('cashu-send-quote.updated', {
      quote: sendQuote({ state: 'PENDING', version: 2 }),
    });
    first.resolve({});
    await settle();
    expect(h.calls.initiateSend).toHaveLength(1);
    expect(h.logger.errorLog).toHaveLength(0);

    h.activity.setActive(false);
    h.activity.notify();
    h.activity.setActive(true);
    h.activity.notify();
    await settle();
    expect(h.melt.unsubscribeAllCalls()).toBe(0);
  });

  it('(j) after a give-up, the give-up retry interval resubscribes the melt quotes', async () => {
    const h = harness({ pending: [sendQuote()] });
    await settle();
    const interval = armed(h.clock.intervals, GIVE_UP_RETRY_MS);
    expect(interval).toBeDefined();
    interval?.callback();
    await settle();
    expect(h.melt.unsubscribeAllCalls()).toBe(0);

    h.impl.initiateSend = () => Promise.reject(new Error('boom'));
    h.meltUpdate(meltQuote('UNPAID'));
    for (const ms of [1000, 2000, 4000]) {
      await settle();
      armed(h.clock.timeouts, ms)?.callback();
    }
    await settle();
    expect(h.calls.initiateSend).toHaveLength(4);
    const subscribesBefore = h.melt.calls.length;

    interval?.callback();
    await settle();
    expect(h.melt.unsubscribeAllCalls()).toBe(1);
    expect(h.melt.calls.length).toBe(subscribesBefore + 1);
    expect(h.melt.calls.at(-1)?.quoteIds).toEqual(['melt-quote-1']);

    interval?.callback();
    await settle();
    expect(h.melt.unsubscribeAllCalls()).toBe(1);
  });

  it('(k) a failed melt expiry check gives up, so the next activation resets the subscriptions', async () => {
    const cause = new Error('mint down');
    const h = harness({
      pending: [sendQuote()],
      accounts: [
        cashuAccount({
          id: 'account-1',
          checkMeltQuote: () => Promise.reject(cause),
        }),
      ],
    });
    await settle();
    h.setNow(100_001);
    armed(h.clock.timeouts, 100_000)?.callback();
    await settle();
    expect(h.logger.errorLog).toEqual([
      { message: 'Error checking melt quote upon expiration', meta: { cause } },
    ]);
    expect(h.melt.unsubscribeAllCalls()).toBe(0);

    h.activity.setActive(false);
    h.activity.notify();
    h.activity.setActive(true);
    h.activity.notify();
    await settle();
    expect(h.melt.unsubscribeAllCalls()).toBe(1);
  });
});
