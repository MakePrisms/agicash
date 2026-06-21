import type { Money } from '@agicash/money';
import { useSyncExternalStore } from 'react';

/**
 * App-side overlay for live Spark account balances.
 *
 * In Variant B the accounts hot read is the SDK `accounts.all` store, which the
 * app cannot write into. The Spark balance, however, has no DB row event — it is
 * read directly from the Breez SDK in-process and refreshed by Breez payment
 * events (see `useTrackAndUpdateSparkAccountBalances`). This module is the
 * app-side sink for those refreshes: a `useSyncExternalStore`-backed map keyed by
 * accountId. `useAccounts` overlays it onto the store's spark accounts so balance
 * displays stay live.
 */

const balances = new Map<string, Money>();
const listeners = new Set<() => void>();

/**
 * Snapshot of the live-balance map. Stable until {@link setLiveSparkBalance}
 * mutates it, so `useSyncExternalStore` can rely on identity for change
 * detection.
 */
let snapshot: ReadonlyMap<string, Money> = balances;

function emit() {
  snapshot = new Map(balances);
  for (const listener of listeners) listener();
}

/**
 * Records the latest live balance for a Spark account. No-op (no re-render) when
 * the balance is unchanged.
 */
export function setLiveSparkBalance(accountId: string, balance: Money): void {
  const current = balances.get(accountId);
  if (current?.equals(balance)) return;
  balances.set(accountId, balance);
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ReadonlyMap<string, Money> {
  return snapshot;
}

/**
 * The live Spark balances map. Re-renders the caller when any tracked balance
 * changes. Returns an empty map on the server.
 */
export function useLiveSparkBalances(): ReadonlyMap<string, Money> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
