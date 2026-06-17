import type { SdkEvent } from '@agicash/breez-sdk-spark';
import { Money } from '@agicash/money';
import type { SdkEventMap } from '../../events';
import type { Account, SparkAccount } from '../../types/account';
import type { SdkEventEmitter } from '../event-emitter';

export type SparkBalanceListenerDeps = {
  emitter: SdkEventEmitter<SdkEventMap>;
};

/**
 * Re-reads the Spark wallet balance on balance-affecting Breez events and emits
 * `account:updated` only when `balanceSats` actually changed (compare-before-emit).
 *
 * The `synced` re-read is the §8 stale-balance fix: `paymentSucceeded` can fire
 * before Breez has synced the post-payment balance, so `getInfo()` would return a
 * stale (pre-payment) value; the later `synced` event re-reads the settled balance.
 */
export class SparkBalanceListener {
  private readonly lastEmittedSats = new Map<string, number>();
  private readonly refreshChains = new Map<string, Promise<void>>();

  constructor(private readonly deps: SparkBalanceListenerDeps) {}

  async register(account: SparkAccount): Promise<() => void> {
    this.lastEmittedSats.set(
      account.id,
      (account.balance ?? Money.zero(account.currency)).toNumber('sat'),
    );

    const listenerPromise = account.wallet.addEventListener({
      onEvent: (event: SdkEvent) => {
        if (
          event.type === 'synced' ||
          event.type === 'paymentSucceeded' ||
          event.type === 'paymentPending' ||
          event.type === 'paymentFailed' ||
          event.type === 'claimedDeposits'
        ) {
          this.scheduleRefresh(account);
        }
      },
    });

    return () => {
      void listenerPromise
        .then((id) => account.wallet.removeEventListener(id))
        .catch(() =>
          console.warn('Failed to remove Spark balance listener', {
            accountId: account.id,
          }),
        );
    };
  }

  /**
   * Serialize balance re-reads per account so the most-recently-delivered event
   * (e.g. the post-settlement `synced`) is the last `getInfo()` and therefore the
   * final emitted balance. Concurrent reads could otherwise let a stale (pre-
   * settlement) read resolve last and stick — exactly the §8 stale-balance hazard.
   */
  private scheduleRefresh(account: SparkAccount): void {
    const prev = this.refreshChains.get(account.id) ?? Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(() => this.refreshBalance(account))
      .catch((error) =>
        console.error('spark balance refresh failed', {
          accountId: account.id,
          cause: error,
        }),
      );
    this.refreshChains.set(account.id, next);
  }

  private async refreshBalance(account: SparkAccount): Promise<void> {
    const info = await account.wallet.getInfo({});
    if (this.lastEmittedSats.get(account.id) === info.balanceSats) return;
    this.lastEmittedSats.set(account.id, info.balanceSats);
    const balance = new Money({
      amount: info.balanceSats,
      currency: 'BTC',
      unit: 'sat',
    }) as Money;
    const updated: Account = { ...account, balance };
    this.deps.emitter.emit('account:updated', {
      account: updated,
      op: 'updated',
    });
  }
}
