import { describe, expect, it } from 'bun:test';
import type { ExtendedCashuWallet } from '@agicash/cashu';
import type { withRetry } from '@agicash/utils';
import {
  HttpResponseError,
  type MeltQuoteBolt11Response,
  type MintQuoteBolt11Response,
} from '@cashu/cashu-ts';
import type { MeltQuoteSubscriptionManager } from '../../lib/melt-quote-subscription-manager';
import type { MintQuoteSubscriptionManager } from '../../lib/mint-quote-subscription-manager';
import type { CashuAccount } from '../accounts/account';
import type { CashuReceiveQuote } from '../receive/cashu-receive-quote';
import {
  type MeltQuoteInput,
  createMeltQuoteTracker,
  createMintQuoteTracker,
  delayUntil,
} from './quote-trackers';
import {
  type RecordedTimer,
  createTestStint,
  flush,
} from './task-saga-test-kit';

type SubscribeCall = {
  mintUrl: string;
  quoteIds: string[];
  onUpdate: (quote: never) => void;
};

function fakeManager(impl?: (call: SubscribeCall) => Promise<() => void>) {
  const calls: SubscribeCall[] = [];
  let unsubscribeAllCalls = 0;
  const manager = {
    subscribe: (call: SubscribeCall) => {
      calls.push(call);
      return impl ? impl(call) : Promise.resolve(() => undefined);
    },
    unsubscribeAll: () => {
      unsubscribeAllCalls += 1;
    },
  };
  return {
    calls,
    unsubscribeAllCalls: () => unsubscribeAllCalls,
    melt: manager as unknown as MeltQuoteSubscriptionManager,
    mint: manager as unknown as MintQuoteSubscriptionManager,
  };
}

function armed(timers: RecordedTimer[], ms: number): RecordedTimer[] {
  return timers.filter((timer) => timer.ms === ms && !timer.cancelled);
}

function meltInput(
  id: string,
  mintUrl = 'https://mint-a.example',
  overrides?: Partial<MeltQuoteInput>,
): MeltQuoteInput {
  return {
    id,
    mintUrl,
    currency: 'BTC',
    expiryInMs: 100_000,
    inputAmount: 100,
    ...overrides,
  };
}

function meltQuote(
  quote: string,
  state: 'UNPAID' | 'PENDING' | 'PAID',
  overrides?: Partial<MeltQuoteBolt11Response>,
): MeltQuoteBolt11Response {
  return { quote, state, amount: 100, ...overrides } as MeltQuoteBolt11Response;
}

function meltHarness() {
  const kit = createTestStint();
  const manager = fakeManager();
  const checkCalls: string[] = [];
  let checkImpl: (id: string) => Promise<MeltQuoteBolt11Response> = async (
    id,
  ) => meltQuote(id, 'UNPAID');
  const getWalletCalls: Array<{ mintUrl: string; currency: string }> = [];
  const events = {
    unpaid: [] as MeltQuoteBolt11Response[],
    pending: [] as MeltQuoteBolt11Response[],
    paid: [] as MeltQuoteBolt11Response[],
    expired: [] as MeltQuoteBolt11Response[],
  };
  const tracker = createMeltQuoteTracker(kit.stint, manager.melt, {
    getWallet: async (mintUrl, currency) => {
      getWalletCalls.push({ mintUrl, currency });
      return {
        checkMeltQuoteBolt11: (id: string) => {
          checkCalls.push(id);
          return checkImpl(id);
        },
      } as unknown as ExtendedCashuWallet;
    },
    onUnpaid: (quote) => events.unpaid.push(quote),
    onPending: (quote) => events.pending.push(quote),
    onPaid: (quote) => events.paid.push(quote),
    onExpired: (quote) => events.expired.push(quote),
  });
  return {
    ...kit,
    manager,
    tracker,
    events,
    checkCalls,
    getWalletCalls,
    setCheck: (impl: typeof checkImpl) => {
      checkImpl = impl;
    },
  };
}

describe('createMeltQuoteTracker', () => {
  it('(a) subscribes once per mint, retries 5 times, then logs', async () => {
    const h = meltHarness();
    h.tracker.sync([
      meltInput('melt-1'),
      meltInput('melt-2'),
      meltInput('melt-3', 'https://mint-b.example'),
    ]);
    await flush();
    expect(h.manager.calls.map((c) => [c.mintUrl, c.quoteIds])).toEqual([
      ['https://mint-a.example', ['melt-1', 'melt-2']],
      ['https://mint-b.example', ['melt-3']],
    ]);

    const failing = createTestStint();
    const cause = new Error('socket down');
    const manager = fakeManager(() => Promise.reject(cause));
    const tracker = createMeltQuoteTracker(failing.stint, manager.melt, {
      getWallet: async () => ({}) as ExtendedCashuWallet,
    });
    tracker.sync([meltInput('melt-1')]);
    for (const ms of [1000, 2000, 4000, 8000, 16000]) {
      await flush();
      const [timer] = armed(failing.clock.timeouts, ms);
      expect(timer).toBeDefined();
      timer?.callback();
    }
    await flush();
    expect(manager.calls).toHaveLength(6);
    expect(failing.logger.errorLog).toEqual([
      {
        message: 'Error subscribing to melt quote updates',
        meta: { mintUrl: 'https://mint-a.example', cause },
      },
    ]);
  });

  it('(b) UNPAID before expiry → onUnpaid; after expiry only the timer expires it', async () => {
    const h = meltHarness();
    h.tracker.sync([meltInput('melt-1')]);
    await flush();
    const onUpdate = h.manager.calls[0]?.onUpdate as (
      quote: MeltQuoteBolt11Response,
    ) => void;

    onUpdate(meltQuote('melt-1', 'UNPAID'));
    await flush();
    expect(h.events.unpaid.map((q) => q.quote)).toEqual(['melt-1']);

    h.setNow(100_000);
    onUpdate(meltQuote('melt-1', 'UNPAID'));
    await flush();
    expect(h.events.unpaid).toHaveLength(1);
    expect(h.events.expired).toHaveLength(0);

    const [timer] = armed(h.clock.timeouts, 100_000);
    timer?.callback();
    await flush();
    expect(h.checkCalls).toEqual(['melt-1']);
    expect(h.getWalletCalls).toEqual([
      { mintUrl: 'https://mint-a.example', currency: 'BTC' },
    ]);
    expect(h.events.expired.map((q) => q.quote)).toEqual(['melt-1']);
  });

  it('(c) PAID with expected change and empty change re-checks once; change present does not', async () => {
    const h = meltHarness();
    h.tracker.sync([meltInput('melt-1', undefined, { inputAmount: 110 })]);
    await flush();
    const onUpdate = h.manager.calls[0]?.onUpdate as (
      quote: MeltQuoteBolt11Response,
    ) => void;
    const rechecked = meltQuote('melt-1', 'PAID', {
      change: [{ id: 'keyset', amount: 8, C_: 'c' }],
    });
    h.setCheck(async () => rechecked);

    onUpdate(meltQuote('melt-1', 'PAID', { change: [] }));
    await flush();
    expect(h.checkCalls).toEqual(['melt-1']);
    expect(h.events.paid).toEqual([rechecked]);

    const withChange = meltQuote('melt-1', 'PAID', {
      change: [{ id: 'keyset', amount: 8, C_: 'c' }],
    });
    onUpdate(withChange);
    await flush();
    expect(h.checkCalls).toHaveLength(1);
    expect(h.events.paid).toEqual([rechecked, withChange]);
  });

  it('(c2) logs a failed PAID re-check instead of leaving an unhandled rejection', async () => {
    const h = meltHarness();
    h.tracker.sync([meltInput('melt-1', undefined, { inputAmount: 110 })]);
    await flush();
    const onUpdate = h.manager.calls[0]?.onUpdate as (
      quote: MeltQuoteBolt11Response,
    ) => void;
    const failure = new Error('mint unreachable');
    h.setCheck(async () => {
      throw failure;
    });

    onUpdate(meltQuote('melt-1', 'PAID', { change: [] }));
    await flush();
    expect(h.checkCalls).toEqual(['melt-1']);
    expect(h.events.paid).toEqual([]);
    expect(h.logger.errorLog).toEqual([
      { message: 'Error handling melt quote update', meta: { cause: failure } },
    ]);
  });

  it('(d) arms one timer per quote across syncs; a removed quote is not checked', async () => {
    const h = meltHarness();
    h.tracker.sync([meltInput('melt-1')]);
    h.tracker.sync([meltInput('melt-1')]);
    await flush();
    expect(armed(h.clock.timeouts, 100_000)).toHaveLength(1);

    h.tracker.sync([]);
    h.setNow(100_000);
    const [timer] = armed(h.clock.timeouts, 100_000);
    timer?.callback();
    await flush();
    expect(h.checkCalls).toHaveLength(0);
    expect(h.events.expired).toHaveLength(0);
  });
});

function mintAccount(nut17: boolean): CashuAccount & {
  checkCalls: string[];
  setCheck: (impl: (id: string) => Promise<MintQuoteBolt11Response>) => void;
} {
  const checkCalls: string[] = [];
  let impl = async (id: string) =>
    ({ quote: id, state: 'UNPAID' }) as MintQuoteBolt11Response;
  return {
    id: nut17 ? 'account-ws' : 'account-poll',
    type: 'cashu',
    isOnline: true,
    version: 1,
    currency: 'BTC',
    mintUrl: nut17 ? 'https://ws-mint.example' : 'https://poll-mint.example',
    wallet: {
      getMintInfo: () => ({
        isSupported: () =>
          nut17
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
      checkMintQuoteBolt11: (id: string) => {
        checkCalls.push(id);
        return impl(id);
      },
    },
    checkCalls,
    setCheck: (next: typeof impl) => {
      impl = next;
    },
  } as unknown as CashuAccount & {
    checkCalls: string[];
    setCheck: (impl: (id: string) => Promise<MintQuoteBolt11Response>) => void;
  };
}

function receiveQuote(
  id: string,
  accountId: string,
  state: 'UNPAID' | 'PAID' = 'UNPAID',
): CashuReceiveQuote {
  return {
    id,
    quoteId: `mint-${id}`,
    accountId,
    state,
    version: 1,
    expiresAt: new Date(50_000).toISOString(),
  } as CashuReceiveQuote;
}

function mintHarness(
  accounts: CashuAccount[],
  quotes: CashuReceiveQuote[],
  options?: { withRetry?: typeof withRetry },
) {
  const kit = createTestStint();
  const manager = fakeManager();
  const updates: MintQuoteBolt11Response[] = [];
  const tracker = createMintQuoteTracker(
    kit.stint,
    manager.mint,
    {
      getAccount: async (quoteId) => {
        const quote = quotes.find((q) => q.id === quoteId);
        return accounts.find((a) => a.id === quote?.accountId);
      },
      onUpdate: (mintQuote) => updates.push(mintQuote),
    },
    options,
  );
  return { ...kit, manager, tracker, updates };
}

describe('createMintQuoteTracker', () => {
  it('(e) subscribes on a NUT-17 mint and polls a non-NUT-17 mint', async () => {
    const ws = mintAccount(true);
    const poll = mintAccount(false);
    const quotes = [
      receiveQuote('quote-1', ws.id),
      receiveQuote('quote-2', poll.id),
    ];
    const h = mintHarness([ws, poll], quotes);
    await h.tracker.sync(quotes);
    await flush();
    expect(h.manager.calls.map((c) => [c.mintUrl, c.quoteIds])).toEqual([
      ['https://ws-mint.example', ['mint-quote-1']],
    ]);
    expect(poll.checkCalls).toEqual(['mint-quote-2']);
    expect(ws.checkCalls).toEqual([]);
  });

  it('(f) polls every 10 s, 60 s after a 429, and stops when the quote leaves', async () => {
    const poll = mintAccount(false);
    const quotes = [receiveQuote('quote-1', poll.id)];
    const h = mintHarness([poll], quotes);
    await h.tracker.sync(quotes);
    await flush();
    expect(poll.checkCalls).toHaveLength(1);
    expect(h.updates).toHaveLength(1);
    const first = armed(h.clock.timeouts, 10_000);
    expect(first).toHaveLength(1);

    const rateLimited = new HttpResponseError('Too many requests', 429);
    poll.setCheck(() => Promise.reject(rateLimited));
    first[0]?.callback();
    await flush();
    expect(poll.checkCalls).toHaveLength(2);
    expect(h.logger.warnLog).toEqual([
      {
        message: 'Error checking mint quote',
        meta: { cause: rateLimited, quoteId: 'mint-quote-1' },
      },
    ]);
    const slow = armed(h.clock.timeouts, 60_000);
    expect(slow).toHaveLength(1);
    expect(h.clock.timeouts.at(-1)?.ms).toBe(60_000);

    poll.setCheck(
      async (id) => ({ quote: id, state: 'UNPAID' }) as MintQuoteBolt11Response,
    );
    slow[0]?.callback();
    await flush();
    expect(poll.checkCalls).toHaveLength(3);
    const back = h.clock.timeouts.at(-1);
    expect(back?.ms).toBe(10_000);

    await h.tracker.sync([]);
    const timersBefore = h.clock.timeouts.length;
    back?.callback();
    await flush();
    expect(poll.checkCalls).toHaveLength(3);
    expect(h.clock.timeouts).toHaveLength(timersBefore);
  });

  it('(g) the expiry recheck uses withRetry with retry 5 and the stint signal', async () => {
    const ws = mintAccount(true);
    const quotes = [receiveQuote('quote-1', ws.id)];
    const retryCalls: Array<Parameters<typeof withRetry>[0]> = [];
    const fakeWithRetry = (async (options: Parameters<typeof withRetry>[0]) => {
      retryCalls.push(options);
      return options.fn();
    }) as typeof withRetry;
    const h = mintHarness([ws], quotes, { withRetry: fakeWithRetry });
    await h.tracker.sync(quotes);
    await flush();
    const [timer] = armed(h.clock.timeouts, 50_000);
    h.setNow(50_000);
    timer?.callback();
    await flush();
    expect(retryCalls).toHaveLength(1);
    expect(retryCalls[0]?.retry).toBe(5);
    expect(retryCalls[0]?.signal).toBe(h.stint.scope.signal);
    expect(ws.checkCalls).toEqual(['mint-quote-1']);
    expect(h.updates.map((u) => u.quote)).toEqual(['mint-quote-1']);
  });

  it('(h2) a stint cancelled during the recheck backoff stops it silently', async () => {
    const ws = mintAccount(true);
    ws.setCheck(() => Promise.reject(new Error('mint down')));
    const quotes = [receiveQuote('quote-1', ws.id)];
    const h = mintHarness([ws], quotes);
    await h.tracker.sync(quotes);
    await flush();
    const [timer] = armed(h.clock.timeouts, 50_000);
    h.setNow(50_000);
    timer?.callback();
    await flush();
    expect(ws.checkCalls).toHaveLength(1);

    h.cancel();
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(ws.checkCalls).toHaveLength(1);
    expect(h.logger.errorLog).toEqual([]);
    expect(h.updates).toEqual([]);
  });
});

describe('delayUntil', () => {
  it('(s) sleeps in chunks below the setTimeout cap', async () => {
    const h = createTestStint();
    h.setNow(0);
    let resolved = false;
    void delayUntil(h.stint, 2 ** 31 + 10).then(() => {
      resolved = true;
    });
    expect(h.clock.timeouts.map((t) => t.ms)).toEqual([2 ** 31 - 1]);

    h.setNow(2 ** 31 - 1);
    h.clock.timeouts[0]?.callback();
    await flush();
    expect(h.clock.timeouts.map((t) => t.ms)).toEqual([2 ** 31 - 1, 11]);
    expect(resolved).toBe(false);

    h.setNow(2 ** 31 + 10);
    h.clock.timeouts[1]?.callback();
    await flush();
    expect(resolved).toBe(true);
    expect(h.clock.timeouts).toHaveLength(2);

    const past = createTestStint();
    past.setNow(1000);
    await delayUntil(past.stint, 500);
    expect(past.clock.timeouts).toHaveLength(0);

    const cancelled = createTestStint();
    let early = false;
    void delayUntil(cancelled.stint, 2 ** 31 + 10).then(() => {
      early = true;
    });
    cancelled.cancel();
    await flush();
    expect(early).toBe(true);
    expect(cancelled.clock.timeouts).toHaveLength(1);
  });
});
