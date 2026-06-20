import type { ChangeFeedChange } from '../engine';
import type { Store } from '../internal/engine';
import type { EntityFanout } from '../internal/realtime/change-feed-ports';
import { type StoreRegistry, allStores } from './stores';

/**
 * Keep-set predicates — the EXACT `state` filters of each work-set store's repo
 * read (`getUnresolved`/`getPending`). An item that leaves its keep-set is
 * evicted from the store. Verified against the repos:
 * cashu-send-quote `.in('state',['UNPAID','PENDING'])`,
 * cashu-send-swap `.in('state',['DRAFT','PENDING'])`,
 * spark-send-quote `.in('state',['UNPAID','PENDING'])`,
 * cashu-receive-quote `.in('state',['UNPAID','PAID'])`,
 * cashu-receive-swap `.match({ state: 'PENDING' })`,
 * spark-receive-quote `.eq('state','UNPAID')`.
 */
const KEEP = {
  'cashu-send-quote': (s: string) => s === 'UNPAID' || s === 'PENDING',
  'cashu-send-swap': (s: string) => s === 'DRAFT' || s === 'PENDING',
  'spark-send-quote': (s: string) => s === 'UNPAID' || s === 'PENDING',
  'cashu-receive-quote': (s: string) => s === 'UNPAID' || s === 'PAID',
  'cashu-receive-swap': (s: string) => s === 'PENDING',
  'spark-receive-quote': (s: string) => s === 'UNPAID',
} as const;

/**
 * Synchronous version-gated upsert into a list store: replace the item with the
 * same key, skipping it if the incoming `version` is not newer (stale), and
 * evict it if it has left its keep-set. `keyOf` defaults to `.id`; the
 * cashu-receive-swap store has no `id` and keys on `tokenHash`.
 */
function upsertVersioned<T extends { version: number }>(
  store: Store<T[]>,
  entity: T,
  keep: boolean,
  keyOf: (x: T) => string = (x) => (x as unknown as { id: string }).id,
): void {
  const key = keyOf(entity);
  store.set((prev = []) => {
    const existing = prev.find((x) => keyOf(x) === key);
    const without = prev.filter((x) => keyOf(x) !== key);
    if (!keep) return without; // left the keep-set -> evict
    if (existing && existing.version >= entity.version) return prev; // stale -> skip
    return [...without, entity];
  });
}

/**
 * Variant-B fanout: each {@link ChangeFeedChange} kind → a SYNCHRONOUS
 * version-gated store write. The change-feed calls `emit()` before the processor
 * trigger (and `setQueryData` is sync), so the trigger reads the stores this just
 * wrote. Accounts upsert keeps `state === 'active'` (evict on flip to expired).
 * User overwrites (no version field); contacts add (deduped)/remove. The
 * `transaction` kind is a no-op (Variant B has no transaction store).
 * `onCatchUp` refetches all stores fire-and-forget.
 */
export function createFanout(stores: StoreRegistry): EntityFanout {
  return {
    emit(change: ChangeFeedChange): void {
      switch (change.kind) {
        case 'user':
          stores.user.set(() => change.entity);
          return;
        case 'account':
          upsertVersioned(
            stores.accounts,
            change.entity,
            change.entity.state === 'active',
          );
          return;
        case 'transaction':
          return; // no transaction store in Variant B
        case 'contact':
          stores.contacts.set((prev = []) =>
            prev.some((c) => c.id === change.entity.id)
              ? prev
              : [...prev, change.entity],
          );
          return;
        case 'contact-deleted':
          stores.contacts.set((prev = []) =>
            prev.filter((c) => c.id !== change.id),
          );
          return;
        case 'cashu-send-quote':
          upsertVersioned(
            stores.cashuSendQuotes,
            change.entity,
            KEEP[change.kind](change.entity.state),
          );
          return;
        case 'cashu-send-swap':
          upsertVersioned(
            stores.cashuSendSwaps,
            change.entity,
            KEEP[change.kind](change.entity.state),
          );
          return;
        case 'spark-send-quote':
          upsertVersioned(
            stores.sparkSendQuotes,
            change.entity,
            KEEP[change.kind](change.entity.state),
          );
          return;
        case 'cashu-receive-quote':
          upsertVersioned(
            stores.cashuReceiveQuotes,
            change.entity,
            KEEP[change.kind](change.entity.state),
          );
          return;
        case 'cashu-receive-swap':
          upsertVersioned(
            stores.cashuReceiveSwaps,
            change.entity,
            KEEP[change.kind](change.entity.state),
            (x) => x.tokenHash,
          );
          return;
        case 'spark-receive-quote':
          upsertVersioned(
            stores.sparkReceiveQuotes,
            change.entity,
            KEEP[change.kind](change.entity.state),
          );
          return;
      }
    },
    onCatchUp(): void {
      void Promise.all(allStores(stores).map((s) => s.toPromise())).catch(
        (error) =>
          console.error('store catch-up refetch failed', { cause: error }),
      );
    },
  };
}
