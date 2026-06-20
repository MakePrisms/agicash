import { describe, expect, it, mock } from 'bun:test';
import type { MeltQuoteSubscriptionManager } from '@agicash/cashu';
import { QueryClient } from '@tanstack/query-core';
import {
  MeltQuoteTracker,
  type MeltQuoteTrackerOptions,
  type MeltQuoteWorkItem,
} from './melt-quote-tracker';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async () => {
  for (let i = 0; i < 10; i++) {
    await flush();
  }
};

const MINT_URL = 'https://mint.example';

const workItem = (): MeltQuoteWorkItem => ({
  id: 'melt-quote-1',
  mintUrl: MINT_URL,
  currency: 'BTC',
  // Far future so the expiry timer never fires during the test.
  expiryInMs: Date.now() + 1_000_000,
  inputAmount: 100,
});

const setup = (subscribe?: ReturnType<typeof mock>) => {
  // retryDelay 0 so a failed subscribe's retry fires on the next tick.
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retryDelay: 0 } },
  });
  const subscribeSpy = subscribe ?? mock(async () => () => undefined);
  const unsubscribeAll = mock(() => undefined);
  const subscriptionManager = {
    subscribe: subscribeSpy,
    unsubscribeAll,
    removeQuoteFromSubscription: mock(() => undefined),
  } as unknown as MeltQuoteSubscriptionManager;

  const tracker = new MeltQuoteTracker({
    queryClient,
    subscriptionManager,
    getWallet: (() => ({})) as unknown as MeltQuoteTrackerOptions['getWallet'],
  });

  return { tracker, subscribe: subscribeSpy, unsubscribeAll };
};

describe('MeltQuoteTracker', () => {
  it('unsubscribes the sockets on stop (item 1)', async () => {
    const { tracker, unsubscribeAll } = setup();
    tracker.setQuotes([workItem()]);
    await flush();

    tracker.stop();

    expect(unsubscribeAll).toHaveBeenCalledTimes(1);
  });

  it('does not re-subscribe after stop() even if a subscribe was retrying (item 2)', async () => {
    let rejectFirst: ((error: Error) => void) | undefined;
    let calls = 0;
    const subscribe = mock(() => {
      calls++;
      if (calls === 1) {
        // Keep the first attempt pending until we reject it post-stop.
        return new Promise<() => void>((_, reject) => {
          rejectFirst = reject;
        });
      }
      return Promise.resolve(() => undefined);
    });
    const { tracker } = setup(subscribe);

    tracker.setQuotes([workItem()]);
    await flush();
    expect(subscribe).toHaveBeenCalledTimes(1);

    tracker.stop();
    // Now fail the in-flight attempt: query-core schedules a retry (delay 0).
    rejectFirst?.(new Error('socket flaky'));
    await settle();

    // The retry's mutationFn sees `stopped` and short-circuits — no new socket.
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('re-subscribes after a stop()/setQuotes cycle (stopped resets)', async () => {
    const { tracker, subscribe } = setup();
    tracker.setQuotes([workItem()]);
    await flush();
    expect(subscribe).toHaveBeenCalledTimes(1);

    tracker.stop();
    tracker.setQuotes([workItem()]);
    await flush();

    expect(subscribe).toHaveBeenCalledTimes(2);
  });
});
