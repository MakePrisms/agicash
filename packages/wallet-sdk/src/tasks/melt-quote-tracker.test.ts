import { describe, expect, it, mock } from 'bun:test';
import type { MeltQuoteSubscriptionManager } from '@agicash/cashu';
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
  const subscribeSpy = subscribe ?? mock(async () => () => undefined);
  const unsubscribeAll = mock(() => undefined);
  const subscriptionManager = {
    subscribe: subscribeSpy,
    unsubscribeAll,
    removeQuoteFromSubscription: mock(() => undefined),
  } as unknown as MeltQuoteSubscriptionManager;

  const tracker = new MeltQuoteTracker({
    subscriptionManager,
    getWallet: (() => ({})) as unknown as MeltQuoteTrackerOptions['getWallet'],
    // 0ms backoff so a failed subscribe's retry fires on the next tick.
    retryDelayMs: () => 0,
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

  it('does not re-subscribe after stop() aborts a retrying subscribe (item 2)', async () => {
    let calls = 0;
    const subscribe = mock(() => {
      calls++;
      // First attempt fails so retryWithBackoff schedules a retry (0ms delay);
      // stop() must abort it before that retry fires.
      if (calls === 1) {
        return Promise.reject(new Error('socket flaky'));
      }
      return Promise.resolve(() => undefined);
    });
    const { tracker } = setup(subscribe);

    tracker.setQuotes([workItem()]);
    await flush();
    expect(subscribe).toHaveBeenCalledTimes(1);

    tracker.stop();
    await settle();

    // The retry sees the aborted signal and short-circuits — no new socket.
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('re-subscribes after a stop()/setQuotes cycle (controller resets)', async () => {
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
