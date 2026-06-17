import { describe, expect, it, mock } from 'bun:test';
import { Money } from '@agicash/money';
import type { SdkEvent } from '@agicash/breez-sdk-spark';
import { SdkEventEmitter } from '../event-emitter';
import type { SdkEventMap } from '../../events';
import type { Account, SparkAccount } from '../../types/account';
import { SparkBalanceListener } from './spark-balance-listener';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const sats = (n: number) =>
  new Money({ amount: n, currency: 'BTC', unit: 'sat' }) as Money;

function makeFakeWallet(initialSats: number) {
  let onEvent: ((e: SdkEvent) => void) | undefined;
  const state = { balanceSats: initialSats };
  const removeEventListener = mock(async () => true);
  const wallet = {
    addEventListener: mock(async (l: { onEvent: (e: SdkEvent) => void }) => {
      onEvent = l.onEvent;
      return 'listener-1';
    }),
    removeEventListener,
    getInfo: mock(async () => ({ balanceSats: state.balanceSats })),
  } as unknown as SparkAccount['wallet'];
  return {
    wallet,
    removeEventListener,
    fire: (e: SdkEvent) => onEvent?.(e),
    setBalance: (n: number) => {
      state.balanceSats = n;
    },
  };
}

function sparkAccount(
  wallet: SparkAccount['wallet'],
  balanceSats: number,
): SparkAccount {
  return {
    id: 'acc-1',
    type: 'spark',
    currency: 'BTC',
    balance: sats(balanceSats),
    wallet,
  } as unknown as SparkAccount;
}

function setup(initialSats = 1000) {
  const emitter = new SdkEventEmitter<SdkEventMap>();
  const events: { account: Account; op: string }[] = [];
  emitter.on('account:updated', (e) => events.push(e));
  const fake = makeFakeWallet(initialSats);
  const account = sparkAccount(fake.wallet, initialSats);
  const listener = new SparkBalanceListener({ emitter });
  return { emitter, events, fake, account, listener };
}

describe('SparkBalanceListener', () => {
  it('§8 REGRESSION: re-reads getInfo() on `synced` and emits the settled balance after a stale paymentSucceeded', async () => {
    const { events, fake, account, listener } = setup(1000);
    await listener.register(account);

    // paymentSucceeded fires but Breez still returns the stale pre-payment balance (the race)
    fake.setBalance(1000);
    fake.fire({ type: 'paymentSucceeded' } as unknown as SdkEvent);
    await flush();
    expect(events).toHaveLength(0); // unchanged → compare-before-emit suppresses

    // synced fires after the wallet settles; getInfo() now returns the post-payment balance
    fake.setBalance(1500);
    fake.fire({ type: 'synced' });
    await flush();
    expect(events).toHaveLength(1);
    expect(events[0]?.op).toBe('updated');
    expect((events[0]?.account as SparkAccount).balance?.toNumber('sat')).toBe(
      1500,
    );
  });

  it('compare-before-emit suppresses a no-op `synced` re-read (balance unchanged)', async () => {
    const { events, fake, account, listener } = setup(1000);
    await listener.register(account);
    fake.setBalance(1000); // unchanged
    fake.fire({ type: 'synced' });
    await flush();
    expect(events).toHaveLength(0);
  });

  it('emits on a paymentSucceeded that does change the balance', async () => {
    const { events, fake, account, listener } = setup(1000);
    await listener.register(account);
    fake.setBalance(900);
    fake.fire({ type: 'paymentSucceeded' } as unknown as SdkEvent);
    await flush();
    expect(events).toHaveLength(1);
    expect((events[0]?.account as SparkAccount).balance?.toNumber('sat')).toBe(
      900,
    );
  });

  it('ignores non-balance events (e.g. lightningAddressChanged)', async () => {
    const { events, fake, account, listener } = setup(1000);
    await listener.register(account);
    fake.setBalance(2000);
    fake.fire({ type: 'lightningAddressChanged' } as unknown as SdkEvent);
    await flush();
    expect(events).toHaveLength(0);
  });

  it('cleanup detaches the Breez listener', async () => {
    const { fake, account, listener } = setup(1000);
    const cleanup = await listener.register(account);
    cleanup();
    await flush();
    expect(fake.removeEventListener).toHaveBeenCalledWith('listener-1');
  });
});
