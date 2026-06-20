import type { WorkSetSource } from '../engine';
import type { Store } from '../internal/engine';
import type { StoreRegistry } from './stores';

/**
 * Variant-B work sets: read each quote/swap STORE (kept fresh by the fanout), then
 * drop items whose account is not online. Each read awaits the accounts store AND
 * the quote store via toPromise() FIRST — load-before-serve — so the synchronous
 * WalletAccess read that fires next inside `processor.reload` (the only await
 * before `wallets.getCashuAccount`) hits a populated accounts snapshot. Mirrors
 * Variant A's `work-sets.ts` ensureLoaded + tolerant online filter.
 */
export function createWorkSets(stores: StoreRegistry): WorkSetSource {
  const isOnline = (accountId: string): boolean =>
    (stores.accounts.get() ?? []).some(
      (a) => a.id === accountId && a.isOnline === true,
    );

  const read = async <T extends { accountId: string }>(
    store: Store<T[]>,
  ): Promise<T[]> => {
    await stores.accounts.toPromise(); // online-filter source must be warm
    const items = await store.toPromise(); // the work set itself
    return items.filter((item) => isOnline(item.accountId));
  };

  return {
    getUnresolvedCashuSendQuotes: () => read(stores.cashuSendQuotes),
    getUnresolvedCashuSendSwaps: () => read(stores.cashuSendSwaps),
    getUnresolvedSparkSendQuotes: () => read(stores.sparkSendQuotes),
    getPendingCashuReceiveQuotes: () => read(stores.cashuReceiveQuotes),
    getPendingCashuReceiveSwaps: () => read(stores.cashuReceiveSwaps),
    getPendingSparkReceiveQuotes: () => read(stores.sparkReceiveQuotes),
  };
}
