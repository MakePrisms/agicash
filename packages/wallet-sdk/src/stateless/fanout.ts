import type { ChangeFeedChange, EntityFanout } from '../engine';
import type { EventBus } from '../internal/event-bus';
import type { SdkEventMapA } from './event-map';
import type { ResidentAccounts } from './resident-accounts';

/**
 * Variant A's fanout: ChangeFeedChange -> A-only row events on the widened bus.
 * Keeps the resident account map fresh (account upsert) before emitting, and
 * rebuilds it on catch-up before signalling `connection:resync`. The base
 * ChangeFeed emits the lifecycle events (`send:*`/`receive:*`) on the same bus;
 * this fanout must not duplicate them.
 */
export function createFanout(
  bus: EventBus<SdkEventMapA>,
  accounts: ResidentAccounts,
): EntityFanout {
  return {
    emit(change: ChangeFeedChange): void {
      if (change.kind === 'contact-deleted') {
        bus.emit('contact:deleted', { id: change.id });
        return;
      }
      if (change.kind === 'account') {
        // Refresh the resident map BEFORE emitting: the base ChangeFeed calls
        // fanout.emit before trigger.onEntityChange, so a processor's reload
        // (which reads WalletAccess synchronously) sees the new/updated account.
        accounts.upsert(change.entity);
      }
      const event = `${change.kind}:${change.operation}` as keyof SdkEventMapA;
      bus.emit(event, { entity: change.entity } as never);
    },
    onCatchUp(): void {
      void accounts
        .reloadLast()
        .catch((error) =>
          console.error('resident reload on catch-up failed', { cause: error }),
        )
        .finally(() => bus.emit('connection:resync', {}));
    },
  };
}
