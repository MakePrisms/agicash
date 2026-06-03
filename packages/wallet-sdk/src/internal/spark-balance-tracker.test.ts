import { describe, expect, mock, test } from 'bun:test';
import { SparkBalanceTracker } from './spark-balance-tracker';
import { TypedEventEmitter } from './event-emitter';
import type { SparkAccount } from '../types/account';
import { type Currency, Money } from '../types/money';
import type { SdkEventMap } from '../events';

const sats = (n: number): Money =>
  new Money({ amount: n, currency: 'BTC' as Currency, unit: 'sat' });

/**
 * A mock spark account whose live Breez `wallet` records the registered `onEvent` callback (so a
 * test can fire Breez events at it), serves a queued `getInfo` balance, and tracks listener
 * add/remove. `fire(type)` invokes the registered callback synchronously.
 */
function fakeSparkAccount(
  id: string,
  initialBalance: Money | null,
): {
  account: SparkAccount;
  fire: (type: string) => void;
  setBalanceSats: (n: number) => void;
  removed: () => string[];
} {
  let onEvent: ((event: { type: string }) => void) | undefined;
  let balanceSats = initialBalance ? initialBalance.toNumber('sat') : 0;
  const removedIds: string[] = [];

  const account = {
    id,
    type: 'spark',
    currency: 'BTC',
    balance: initialBalance,
    wallet: {
      addEventListener: mock(
        async (listener: { onEvent: (event: { type: string }) => void }) => {
          onEvent = listener.onEvent;
          return `listener-${id}`;
        },
      ),
      removeEventListener: mock(async (listenerId: string) => {
        removedIds.push(listenerId);
      }),
      getInfo: mock(async (_args: unknown) => ({ balanceSats })),
    },
  } as unknown as SparkAccount;

  return {
    account,
    fire: (type: string) => onEvent?.({ type }),
    setBalanceSats: (n: number) => {
      balanceSats = n;
    },
    removed: () => removedIds,
  };
}

/** Wait for the tracker's `getInfo().then(...)` microtask chain to settle. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// -- Tests ----------------------------------------------------------------------------------

describe('SparkBalanceTracker', () => {
  test('emits account:updated on a balance-relevant Breez event with the fresh balance', async () => {
    const events = new TypedEventEmitter<SdkEventMap>();
    const tracker = new SparkBalanceTracker(events);
    const updates: SdkEventMap['account:updated'][] = [];
    events.on('account:updated', (e) => updates.push(e));

    const { account, fire, setBalanceSats } = fakeSparkAccount('acc1', sats(0));
    tracker.track([account]);

    setBalanceSats(5000);
    fire('paymentSucceeded');
    await flush();

    expect(updates).toHaveLength(1);
    expect(updates[0].op).toBe('updated');
    expect(updates[0].account.id).toBe('acc1');
    expect((updates[0].account as SparkAccount).balance?.toNumber('sat')).toBe(
      5000,
    );
  });

  test('ignores Breez events that cannot move the balance (no getInfo, no emit)', async () => {
    const events = new TypedEventEmitter<SdkEventMap>();
    const tracker = new SparkBalanceTracker(events);
    const updates: unknown[] = [];
    events.on('account:updated', (e) => updates.push(e));

    const { account, fire } = fakeSparkAccount('acc1', sats(0));
    tracker.track([account]);

    // not in the balance-relevant set
    fire('logEntry');
    fire('someUnrelatedEvent');
    await flush();

    expect(updates).toHaveLength(0);
    expect(
      (account.wallet.getInfo as ReturnType<typeof mock>).mock.calls,
    ).toHaveLength(0);
  });

  test('compare-before-emit: an event that does not change the balance is not forwarded', async () => {
    const events = new TypedEventEmitter<SdkEventMap>();
    const tracker = new SparkBalanceTracker(events);
    const updates: unknown[] = [];
    events.on('account:updated', (e) => updates.push(e));

    // baseline balance is 5000; the wallet still reports 5000 after the event.
    const { account, fire } = fakeSparkAccount('acc1', sats(5000));
    tracker.track([account]);

    fire('synced');
    await flush();

    expect(updates).toHaveLength(0);
  });

  test('emits once, then suppresses a repeat at the same (new) balance', async () => {
    const events = new TypedEventEmitter<SdkEventMap>();
    const tracker = new SparkBalanceTracker(events);
    const updates: unknown[] = [];
    events.on('account:updated', (e) => updates.push(e));

    const { account, fire, setBalanceSats } = fakeSparkAccount('acc1', sats(0));
    tracker.track([account]);

    setBalanceSats(7000);
    fire('claimedDeposits');
    await flush();
    // second event, same 7000 balance -> no second emit
    fire('synced');
    await flush();

    expect(updates).toHaveLength(1);
  });

  test('registers exactly one Breez listener per account even if track is called again', async () => {
    const events = new TypedEventEmitter<SdkEventMap>();
    const tracker = new SparkBalanceTracker(events);
    const { account } = fakeSparkAccount('acc1', sats(0));

    tracker.track([account]);
    tracker.track([account]);

    expect(
      (account.wallet.addEventListener as ReturnType<typeof mock>).mock.calls,
    ).toHaveLength(1);
  });

  test('stop() removes the Breez listeners', async () => {
    const events = new TypedEventEmitter<SdkEventMap>();
    const tracker = new SparkBalanceTracker(events);
    const { account, removed } = fakeSparkAccount('acc1', sats(0));

    tracker.track([account]);
    await flush(); // let addEventListener resolve
    tracker.stop();
    await flush(); // let removeEventListener resolve

    expect(removed()).toEqual(['listener-acc1']);
  });

  test('untracks an account no longer in the tracked set', async () => {
    const events = new TypedEventEmitter<SdkEventMap>();
    const tracker = new SparkBalanceTracker(events);
    const a = fakeSparkAccount('acc1', sats(0));
    const b = fakeSparkAccount('acc2', sats(0));

    tracker.track([a.account, b.account]);
    await flush();
    // acc1 drops out
    tracker.track([b.account]);
    await flush();

    expect(a.removed()).toEqual(['listener-acc1']);
    expect(b.removed()).toEqual([]);
  });
});
