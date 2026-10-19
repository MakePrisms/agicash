import { describe, expect, it } from 'bun:test';
import type { ExtendedCashuWallet } from '@agicash/cashu';
import { type Currency, Money } from '@agicash/money';
import type { withRetry } from '@agicash/utils';
import {
  type MeltQuoteBolt11Response,
  MintOperationError,
  type MintQuoteBolt11Response,
  NetworkError,
} from '@cashu/cashu-ts';
import type { getInitializedCashuWallet } from '../../lib/cashu';
import type { MeltQuoteSubscriptionManager } from '../../lib/melt-quote-subscription-manager';
import type { MintQuoteSubscriptionManager } from '../../lib/mint-quote-subscription-manager';
import type { Account, CashuAccount } from '../accounts/account';
import type { MintQuoteTrackerOptions } from '../wallet/quote-trackers';
import { GIVE_UP_RETRY_MS } from '../wallet/task-saga';
import {
  type RecordedTimer,
  createTestStint,
  deferred,
  flush,
} from '../wallet/task-saga-test-kit';
import type { CashuReceiveQuote } from './cashu-receive-quote';
import type { CashuReceiveQuoteRepository } from './cashu-receive-quote-repository';
import { createCashuReceiveQuoteSaga } from './cashu-receive-quote-saga';
import type { CashuReceiveQuoteService } from './cashu-receive-quote-service';

const MINT_URL = 'https://mint.example';
const SOURCE_MINT_URL = 'https://source.example';

type SubscribeCall = {
  mintUrl: string;
  quoteIds: string[];
  onUpdate: (quote: never) => void;
};

function fakeManager() {
  const calls: SubscribeCall[] = [];
  let unsubscribeAllCalls = 0;
  return {
    calls,
    unsubscribeAllCalls: () => unsubscribeAllCalls,
    manager: {
      subscribe: async (call: SubscribeCall) => {
        calls.push(call);
        return () => undefined;
      },
      unsubscribeAll: () => {
        unsubscribeAllCalls += 1;
      },
    },
  };
}

type MeltCall = {
  meltQuote: { quote: string; amount: number };
  proofs: unknown;
  outputs: unknown;
  outputType: unknown;
};

function cashuAccount(options: {
  id: string;
  mintUrl: string;
  nut17: boolean;
  meltCalls?: MeltCall[];
  meltImpl?: () => Promise<unknown>;
  checkMintCalls?: string[];
  checkMintImpl?: (id: string) => Promise<unknown>;
}): CashuAccount {
  return {
    id: options.id,
    type: 'cashu',
    isOnline: true,
    version: 1,
    currency: 'BTC',
    mintUrl: options.mintUrl,
    wallet: {
      getMintInfo: () => ({
        isSupported: () =>
          options.nut17
            ? {
                supported: true,
                params: [
                  {
                    method: 'bolt11',
                    unit: 'sat',
                    commands: ['bolt11_mint_quote'],
                  },
                ],
              }
            : { supported: false },
      }),
      checkMintQuoteBolt11: async (id: string) => {
        options.checkMintCalls?.push(id);
        if (options.checkMintImpl) {
          return options.checkMintImpl(id);
        }
        return { quote: id, state: 'UNPAID' };
      },
      meltProofsIdempotent: (
        meltQuote: MeltCall['meltQuote'],
        proofs: unknown,
        outputs: unknown,
        outputType: unknown,
      ) => {
        options.meltCalls?.push({ meltQuote, proofs, outputs, outputType });
        return options.meltImpl ? options.meltImpl() : Promise.resolve({});
      },
    },
  } as unknown as CashuAccount;
}

function amount(sats: number): Money<Currency> {
  return new Money<Currency>({ amount: sats, currency: 'BTC', unit: 'sat' });
}

function lightningQuote(
  overrides?: Partial<CashuReceiveQuote>,
): CashuReceiveQuote {
  return {
    id: 'quote-1',
    quoteId: 'mint-quote-1',
    accountId: 'account-1',
    userId: 'user-1',
    type: 'LIGHTNING',
    state: 'UNPAID',
    version: 1,
    amount: amount(1000),
    transactionId: 'tx-1',
    expiresAt: new Date(100_000).toISOString(),
    ...overrides,
  } as CashuReceiveQuote;
}

function tokenQuote(options?: {
  meltInitiated?: boolean;
  version?: number;
}): CashuReceiveQuote {
  return {
    ...lightningQuote({ version: options?.version ?? 1 }),
    type: 'CASHU_TOKEN',
    tokenReceiveData: {
      sourceMintUrl: SOURCE_MINT_URL,
      tokenAmount: amount(1010),
      tokenProofs: [{ id: 'keyset', amount: 1010, secret: 's', C: 'c' }],
      meltQuoteId: 'melt-quote-1',
      meltInitiated: options?.meltInitiated ?? false,
    },
  } as unknown as CashuReceiveQuote;
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

function harness(options: {
  pending: CashuReceiveQuote[];
  accounts?: Account[];
  initCashuWallet?: typeof getInitializedCashuWallet;
  mintTrackerOptions?: MintQuoteTrackerOptions;
}) {
  const accounts = options.accounts ?? [
    cashuAccount({ id: 'account-1', mintUrl: MINT_URL, nut17: true }),
  ];
  const kit = createTestStint({ loadAccounts: async () => accounts });
  const mint = fakeManager();
  const melt = fakeManager();
  const calls = {
    complete: [] as Array<{ account: CashuAccount; quote: CashuReceiveQuote }>,
    expire: [] as CashuReceiveQuote[],
    fail: [] as Array<{ quote: CashuReceiveQuote; reason: string }>,
    markMeltInitiated: [] as CashuReceiveQuote[],
  };
  const impl = {
    complete: async (
      _account: CashuAccount,
      quote: CashuReceiveQuote,
    ): Promise<{ quote: CashuReceiveQuote }> => ({
      quote: {
        ...quote,
        state: 'COMPLETED',
        version: quote.version + 1,
      } as CashuReceiveQuote,
    }),
    markMeltInitiated: async (quote: CashuReceiveQuote) =>
      ({ ...quote, version: quote.version + 1 }) as CashuReceiveQuote,
  };
  const emitted: CashuReceiveQuote[] = [];
  kit.events.on('cashu-receive-quote.updated', ({ quote }) => {
    emitted.push(quote);
  });
  const saga = createCashuReceiveQuoteSaga({
    getRepository: async () =>
      ({
        getPending: async () => options.pending,
      }) as unknown as CashuReceiveQuoteRepository,
    getService: async () =>
      ({
        completeReceive: (account: CashuAccount, quote: CashuReceiveQuote) => {
          calls.complete.push({ account, quote });
          return impl.complete(account, quote);
        },
        expire: async (quote: CashuReceiveQuote) => {
          calls.expire.push(quote);
        },
        fail: async (quote: CashuReceiveQuote, reason: string) => {
          calls.fail.push({ quote, reason });
        },
        markMeltInitiated: (quote: CashuReceiveQuote) => {
          calls.markMeltInitiated.push(quote);
          return impl.markMeltInitiated(quote);
        },
      }) as unknown as CashuReceiveQuoteService,
    initCashuWallet: options.initCashuWallet,
    getCashuWallet: () => ({}) as ExtendedCashuWallet,
    createMintManager: () =>
      mint.manager as unknown as MintQuoteSubscriptionManager,
    createMeltManager: () =>
      melt.manager as unknown as MeltQuoteSubscriptionManager,
    mintTrackerOptions: options.mintTrackerOptions,
  });
  saga.start(kit.stint);
  const mintUpdate = (state: string, quote = 'mint-quote-1') =>
    (mint.calls.at(-1)?.onUpdate as (q: MintQuoteBolt11Response) => void)({
      quote,
      state,
      unit: 'sat',
    } as MintQuoteBolt11Response);
  const meltUpdate = (state: string) =>
    (melt.calls.at(-1)?.onUpdate as (q: MeltQuoteBolt11Response) => void)({
      quote: 'melt-quote-1',
      state,
      amount: 1000,
    } as MeltQuoteBolt11Response);
  return {
    ...kit,
    accounts,
    mint,
    melt,
    calls,
    impl,
    emitted,
    mintUpdate,
    meltUpdate,
  };
}

describe('createCashuReceiveQuoteSaga', () => {
  it('(h) a PAID or ISSUED mint quote completes with the account from getCashu', async () => {
    const quote = lightningQuote();
    const h = harness({ pending: [quote] });
    await settle();
    expect(h.mint.calls.map((c) => [c.mintUrl, c.quoteIds])).toEqual([
      [MINT_URL, ['mint-quote-1']],
    ]);
    h.impl.complete = async (_account, q) => ({ quote: q });
    h.mintUpdate('PAID');
    await settle();
    expect(h.calls.complete).toHaveLength(1);
    expect(h.calls.complete[0]?.quote.id).toBe('quote-1');
    expect(h.calls.complete[0]?.account).toBe(h.accounts[0] as CashuAccount);

    h.mintUpdate('ISSUED');
    await settle();
    expect(h.calls.complete).toHaveLength(2);
    expect(h.calls.complete[1]?.quote.id).toBe('quote-1');
  });

  it('(i) an UNPAID mint quote past expiry expires the receive quote', async () => {
    const h = harness({ pending: [lightningQuote()] });
    await settle();
    h.mintUpdate('UNPAID');
    await settle();
    expect(h.calls.expire).toHaveLength(0);
    h.setNow(100_001);
    h.mintUpdate('UNPAID');
    await settle();
    expect(h.calls.expire.map((q) => q.id)).toEqual(['quote-1']);
  });

  it('(j) two triggers on one quote run FIFO under cashu-receive-quote-<id>', async () => {
    const quote = lightningQuote({ state: 'PAID' });
    const h = harness({ pending: [quote] });
    await settle();
    const first = deferred<{ quote: CashuReceiveQuote }>();
    h.impl.complete = () => first.promise;
    h.mintUpdate('PAID');
    h.mintUpdate('PAID');
    await settle();
    expect(h.calls.complete).toHaveLength(1);
    h.impl.complete = async (_account, q) => ({ quote: q });
    first.resolve({ quote });
    await settle();
    expect(h.calls.complete).toHaveLength(2);
  });

  it('(k) complete emits .updated, drops the quote, and ignores an older echo', async () => {
    const h = harness({ pending: [lightningQuote({ state: 'PAID' })] });
    await settle();
    h.mintUpdate('PAID');
    await settle();
    expect(h.emitted.map((q) => [q.id, q.state, q.version])).toEqual([
      ['quote-1', 'COMPLETED', 2],
    ]);

    h.events.emit('cashu-receive-quote.updated', {
      quote: lightningQuote({ state: 'PAID', version: 1 }),
    });
    await settle();
    h.mintUpdate('PAID');
    await settle();
    expect(h.calls.complete).toHaveLength(1);
    expect(h.logger.warnLog.map((l) => l.message)).toContain(
      'No related receive quote found for the mint quote',
    );
  });

  it('(l) initiateMelt: MintOperationError fails once; a plain error retries 3 times', async () => {
    const meltCalls: MeltCall[] = [];
    const mintError = new MintOperationError(20000, 'Token already spent');
    const source = cashuAccount({
      id: 'account-source',
      mintUrl: SOURCE_MINT_URL,
      nut17: true,
      meltCalls,
      meltImpl: () => Promise.reject(mintError),
    });
    const h = harness({
      pending: [tokenQuote()],
      accounts: [
        cashuAccount({ id: 'account-1', mintUrl: MINT_URL, nut17: true }),
        source,
      ],
    });
    await settle();
    expect(h.melt.calls.map((c) => [c.mintUrl, c.quoteIds])).toEqual([
      [SOURCE_MINT_URL, ['melt-quote-1']],
    ]);
    h.meltUpdate('UNPAID');
    await settle();
    expect(meltCalls).toHaveLength(1);
    expect(h.logger.warnLog).toContainEqual({
      message: 'Failed to initiate melt.',
      meta: { cause: mintError, receiveQuoteId: 'quote-1' },
    });
    expect(h.calls.fail.map((c) => [c.quote.id, c.reason])).toEqual([
      ['quote-1', mintError.message],
    ]);

    const plainCalls: MeltCall[] = [];
    const plain = new Error('boom');
    const p = harness({
      pending: [tokenQuote()],
      accounts: [
        cashuAccount({
          id: 'account-source',
          mintUrl: SOURCE_MINT_URL,
          nut17: true,
          meltCalls: plainCalls,
          meltImpl: () => Promise.reject(plain),
        }),
        cashuAccount({ id: 'account-1', mintUrl: MINT_URL, nut17: true }),
      ],
    });
    await settle();
    p.meltUpdate('UNPAID');
    for (const ms of [1000, 2000, 4000]) {
      await settle();
      armed(p.clock.timeouts, ms)?.callback();
    }
    await settle();
    expect(plainCalls).toHaveLength(4);
    expect(p.calls.fail).toHaveLength(0);
    expect(p.logger.errorLog).toEqual([
      {
        message: 'Initiate melt error',
        meta: { cause: plain, receiveQuoteId: 'quote-1' },
      },
    ]);
  });

  it('(l2) the melt amount is in the cashu unit', async () => {
    const meltCalls: MeltCall[] = [];
    const h = harness({
      pending: [tokenQuote()],
      accounts: [
        cashuAccount({ id: 'account-1', mintUrl: MINT_URL, nut17: true }),
        cashuAccount({
          id: 'account-source',
          mintUrl: SOURCE_MINT_URL,
          nut17: true,
          meltCalls,
        }),
      ],
    });
    await settle();
    h.meltUpdate('UNPAID');
    await settle();
    expect(meltCalls).toHaveLength(1);
    expect(meltCalls[0]?.meltQuote).toEqual({
      quote: 'melt-quote-1',
      amount: 1000,
    });
    expect(meltCalls[0]?.outputs).toBeUndefined();
    expect(meltCalls[0]?.outputType).toEqual({ type: 'random' });
  });

  it('(m) an offline source mint throws NetworkError, retried like a plain error', async () => {
    const initCalls: Array<{ mintUrl: string; currency: Currency }> = [];
    const h = harness({
      pending: [tokenQuote()],
      initCashuWallet: (async (args: {
        mintUrl: string;
        currency: Currency;
      }) => {
        initCalls.push({ mintUrl: args.mintUrl, currency: args.currency });
        return { wallet: {} as ExtendedCashuWallet, isOnline: false };
      }) as typeof getInitializedCashuWallet,
    });
    await settle();
    h.meltUpdate('UNPAID');
    for (const ms of [1000, 2000, 4000]) {
      await settle();
      armed(h.clock.timeouts, ms)?.callback();
    }
    await settle();
    expect(initCalls).toHaveLength(4);
    expect(initCalls[0]).toEqual({ mintUrl: SOURCE_MINT_URL, currency: 'BTC' });
    expect(h.logger.errorLog).toHaveLength(1);
    expect(h.logger.errorLog[0]?.message).toBe('Initiate melt error');
    const meta = h.logger.errorLog[0]?.meta as { cause: unknown };
    expect(meta.cause).toBeInstanceOf(NetworkError);
    expect(h.calls.fail).toHaveLength(0);
  });

  it('(n) a PENDING melt marks the melt initiated and emits', async () => {
    const h = harness({ pending: [tokenQuote()] });
    await settle();
    h.meltUpdate('PENDING');
    await settle();
    expect(h.calls.markMeltInitiated.map((q) => q.id)).toEqual(['quote-1']);
    expect(h.emitted.map((q) => [q.id, q.version])).toEqual([['quote-1', 2]]);
  });

  it('(o) an initiated melt that is UNPAID again fails the quote', async () => {
    const h = harness({ pending: [tokenQuote({ meltInitiated: true })] });
    await settle();
    h.meltUpdate('UNPAID');
    await settle();
    expect(h.calls.fail.map((c) => [c.quote.id, c.reason])).toEqual([
      ['quote-1', 'Cashu token melt failed.'],
    ]);
  });

  it('(p) stint end unsubscribes both managers and stops polling', async () => {
    const checkMintCalls: string[] = [];
    const h = harness({
      pending: [lightningQuote()],
      accounts: [
        cashuAccount({
          id: 'account-1',
          mintUrl: MINT_URL,
          nut17: false,
          checkMintCalls,
        }),
      ],
    });
    await settle();
    expect(checkMintCalls).toEqual(['mint-quote-1']);
    const poll = armed(h.clock.timeouts, 10_000);
    expect(poll).toBeDefined();
    h.cancel();
    expect(h.mint.unsubscribeAllCalls()).toBe(1);
    expect(h.melt.unsubscribeAllCalls()).toBe(1);
    poll?.callback();
    await settle();
    expect(checkMintCalls).toHaveLength(1);
  });

  it('(q) a mint update for an unknown quote id warns', async () => {
    const h = harness({ pending: [lightningQuote()] });
    await settle();
    h.mintUpdate('PAID', 'mint-quote-unknown');
    await settle();
    expect(h.logger.warnLog).toEqual([
      {
        message: 'No related receive quote found for the mint quote',
        meta: undefined,
      },
    ]);
    expect(h.calls.complete).toHaveLength(0);
  });

  it('(r) a failed complete resets the subscriptions on the next activation', async () => {
    const h = harness({ pending: [lightningQuote({ state: 'PAID' })] });
    await settle();
    const cause = new Error('mint down');
    h.impl.complete = () => Promise.reject(cause);

    h.activity.setActive(false);
    h.activity.notify();
    h.activity.setActive(true);
    h.activity.notify();
    await settle();
    h.events.emit('connection.changed', { state: 'connected' });
    await settle();
    expect(h.mint.unsubscribeAllCalls()).toBe(0);
    expect(h.melt.unsubscribeAllCalls()).toBe(0);

    h.mintUpdate('PAID');
    for (const ms of [1000, 2000, 4000]) {
      await settle();
      armed(h.clock.timeouts, ms)?.callback();
    }
    await settle();
    expect(h.calls.complete).toHaveLength(4);
    expect(h.logger.errorLog).toEqual([
      {
        message: 'Complete cashu receive quote error',
        meta: { cause, receiveQuoteId: 'quote-1' },
      },
    ]);
    const subscribesBefore = h.mint.calls.length;

    h.activity.setActive(false);
    h.activity.notify();
    h.activity.setActive(true);
    h.activity.notify();
    await settle();
    expect(h.mint.unsubscribeAllCalls()).toBe(1);
    expect(h.melt.unsubscribeAllCalls()).toBe(1);
    expect(h.mint.calls.length).toBeGreaterThan(subscribesBefore);
    expect(h.mint.calls.at(-1)?.quoteIds).toEqual(['mint-quote-1']);

    h.activity.setActive(false);
    h.activity.notify();
    h.activity.setActive(true);
    h.activity.notify();
    await settle();
    expect(h.mint.unsubscribeAllCalls()).toBe(1);
    expect(h.melt.unsubscribeAllCalls()).toBe(1);
  });

  it('(s) after a give-up, the give-up retry interval resubscribes without a reload', async () => {
    const h = harness({ pending: [lightningQuote({ state: 'PAID' })] });
    await settle();
    const interval = armed(h.clock.intervals, GIVE_UP_RETRY_MS);
    expect(interval).toBeDefined();
    interval?.callback();
    await settle();
    expect(h.mint.unsubscribeAllCalls()).toBe(0);

    h.impl.complete = () => Promise.reject(new Error('mint down'));
    h.mintUpdate('PAID');
    for (const ms of [1000, 2000, 4000]) {
      await settle();
      armed(h.clock.timeouts, ms)?.callback();
    }
    await settle();
    expect(h.calls.complete).toHaveLength(4);
    const subscribesBefore = h.mint.calls.length;

    interval?.callback();
    await settle();
    expect(h.mint.unsubscribeAllCalls()).toBe(1);
    expect(h.melt.unsubscribeAllCalls()).toBe(1);
    expect(h.mint.calls.length).toBe(subscribesBefore + 1);
    expect(h.mint.calls.at(-1)?.quoteIds).toEqual(['mint-quote-1']);
  });

  it('(t) a failed mint expiry check gives up, so the next activation resets the subscriptions', async () => {
    const cause = new Error('mint down');
    const h = harness({
      pending: [lightningQuote()],
      accounts: [
        cashuAccount({
          id: 'account-1',
          mintUrl: MINT_URL,
          nut17: true,
          checkMintImpl: () => Promise.reject(cause),
        }),
      ],
      mintTrackerOptions: {
        withRetry: (async (options: Parameters<typeof withRetry>[0]) =>
          options.fn()) as typeof withRetry,
      },
    });
    await settle();
    h.setNow(100_001);
    armed(h.clock.timeouts, 100_000)?.callback();
    await settle();
    expect(h.logger.errorLog).toEqual([
      { message: 'Error checking mint quote upon expiration', meta: { cause } },
    ]);
    expect(h.mint.unsubscribeAllCalls()).toBe(0);

    h.activity.setActive(false);
    h.activity.notify();
    h.activity.setActive(true);
    h.activity.notify();
    await settle();
    expect(h.mint.unsubscribeAllCalls()).toBe(1);
  });

  it('(u) a failed melt update gives up, so the next activation resets the subscriptions', async () => {
    const h = harness({ pending: [tokenQuote()] });
    await settle();
    h.meltUpdate('PAID');
    await settle();
    expect(h.logger.errorLog.map((l) => l.message)).toEqual([
      'Error handling melt quote update',
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
