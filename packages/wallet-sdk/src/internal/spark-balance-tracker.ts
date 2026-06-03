/**
 * Spark account balance source — Slice 3 / PR5c (spark send + receive).
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/shared/spark.ts#useTrackAndUpdateSparkAccountBalances`.
 *
 * Per the contract (§6) a spark account's balance is NOT sourced from a Supabase DB trigger
 * (the way cashu balances are): it comes from the Breez SDK's OWN event listener
 * (`paymentSucceeded` / `paymentPending` / `paymentFailed` / `claimedDeposits` / `synced`) +
 * `getInfo().balanceSats`. The spark domain OWNS that source. Master's hook updates the TanStack
 * accounts cache on each relevant event; the framework-free, no-cache SDK instead EMITS an
 * `account:updated` event — with **compare-before-emit** so an event that does not actually move
 * the balance is not forwarded (master writes the cache unconditionally; the SDK's event surface
 * is noisier without the guard, so it dedupes).
 *
 * Re-housing vs master:
 *  - the React `useEffect` listener-registration/cleanup → explicit {@link SparkBalanceTracker.track}
 *    (register) + {@link SparkBalanceTracker.stop} (remove all) lifecycle, driven by the SDK (the
 *    background/realtime slice, S5, calls `track` with the online spark accounts; PR5c ships the
 *    mechanism + the `account:updated` emission);
 *  - `accountCache.updateSparkAccountBalance(...)` → `events.emit('account:updated', …)`;
 *  - the `SdkEvent` type is imported TYPE-ONLY from `@agicash/breez-sdk-spark` (erased, NO WASM);
 *  - `sparkDebugLog` (the feature-flag debug gate) is dropped (no feature-flag subsystem, §3).
 *
 * The set of balance-relevant Breez event types is master-verbatim.
 *
 * @module
 */
import type { SdkEvent } from '@agicash/breez-sdk-spark';
import type { TypedEventEmitter } from './event-emitter';
import { Money } from '../types/money';
import type { SparkAccount } from '../types/account';
import type { SdkEventMap } from '../events';

/**
 * Breez event types that can move a spark account's balance (master verbatim). On any of these
 * the tracker re-reads `getInfo()` and (if the balance changed) emits `account:updated`.
 */
const BALANCE_RELEVANT_EVENTS = new Set([
  'paymentSucceeded',
  'paymentPending',
  'paymentFailed',
  'claimedDeposits',
  'synced',
]);

/** A registered listener: the wallet it is on + the (resolved) Breez listener id, for cleanup. */
type Registration = {
  wallet: SparkAccount['wallet'];
  listenerId: Promise<string>;
};

/**
 * Tracks live spark account balances off the Breez SDK's event stream and forwards balance
 * changes to the SDK event emitter as `account:updated` (compare-before-emit). One instance per
 * SDK; held so `Sdk.destroy()` / `background.stop()` can remove the listeners.
 */
export class SparkBalanceTracker {
  /** accountId -> its Breez listener registration. */
  private readonly registrations = new Map<string, Registration>();
  /** accountId -> the last balance we emitted for (the compare-before-emit baseline). */
  private readonly lastBalances = new Map<string, Money | null>();

  constructor(private readonly events: TypedEventEmitter<SdkEventMap>) {}

  /**
   * Register Breez balance listeners for the given online spark accounts. Idempotent per account
   * (an account already tracked is skipped); accounts no longer in `accounts` are untracked. The
   * passed accounts are the compare-before-emit baseline (their current `balance`).
   *
   * @param accounts - the online spark accounts to track (their live `wallet` is used).
   */
  track(accounts: SparkAccount[]): void {
    const incomingIds = new Set(accounts.map((a) => a.id));

    // Drop listeners for accounts that are no longer tracked.
    for (const id of [...this.registrations.keys()]) {
      if (!incomingIds.has(id)) {
        this.untrack(id);
      }
    }

    for (const account of accounts) {
      if (this.registrations.has(account.id)) {
        // Refresh the baseline (the account object may carry a newer balance) but keep the
        // single existing listener.
        this.lastBalances.set(account.id, account.balance);
        continue;
      }
      this.register(account);
    }
  }

  /** Register one account's Breez listener (and seed its compare baseline). */
  private register(account: SparkAccount): void {
    this.lastBalances.set(account.id, account.balance);

    const listenerId = account.wallet.addEventListener({
      onEvent: (event: SdkEvent) => {
        if (!BALANCE_RELEVANT_EVENTS.has(event.type)) {
          return;
        }
        // Re-read the authoritative balance from the wallet; emit only if it changed.
        account.wallet
          .getInfo({})
          .then((info) => {
            const balance = new Money({
              amount: info.balanceSats,
              currency: 'BTC',
              unit: 'sat',
            }) as Money;
            this.emitIfChanged(account, balance);
          })
          .catch((error) => {
            console.warn('Failed to read spark balance after Breez event', {
              accountId: account.id,
              cause: error,
            });
          });
      },
    });

    this.registrations.set(account.id, { wallet: account.wallet, listenerId });
  }

  /**
   * Emit `account:updated` iff `balance` differs from the last emitted balance for this account
   * (compare-before-emit). The emitted account carries the fresh balance.
   */
  private emitIfChanged(account: SparkAccount, balance: Money): void {
    const previous = this.lastBalances.get(account.id);
    if (previous?.equals(balance)) {
      return;
    }
    this.lastBalances.set(account.id, balance);
    const updated: SparkAccount = { ...account, balance };
    this.events.emit('account:updated', { account: updated, op: 'updated' });
  }

  /** Remove one account's Breez listener. */
  private untrack(accountId: string): void {
    const registration = this.registrations.get(accountId);
    if (!registration) {
      return;
    }
    this.registrations.delete(accountId);
    this.lastBalances.delete(accountId);
    registration.listenerId
      .then((id) => registration.wallet.removeEventListener(id))
      .catch(() => {
        console.warn('Failed to remove Spark event listener', { accountId });
      });
  }

  /** Remove ALL Breez listeners (called on `background.stop()` / `Sdk.destroy()`). */
  stop(): void {
    for (const id of [...this.registrations.keys()]) {
      this.untrack(id);
    }
  }
}
