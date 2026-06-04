/**
 * Internal account realtime → SDK-event forwarder — Slice 5 / PR7 (background + realtime).
 *
 * NET-NEW (the realtime half of the `account:updated` event, §11). GENERALIZES master's
 * `account-hooks.ts#useAccountChangeHandlers` (which maps the `ACCOUNT_CREATED` /
 * `ACCOUNT_UPDATED` broadcast events into TanStack-cache upserts): here it translates them into
 * the SDK's typed `account:updated` event.
 *
 * The contract collapses account create + update into ONE event keyed by `op` (there is no
 * separate `account:created` event — §11 has only `account:updated: { account, op }`). Master
 * encodes the operation in the event NAME (`ACCOUNT_CREATED` vs `ACCOUNT_UPDATED`); the forwarder
 * reads the name and emits `account:updated` with `op: 'created'` / `op: 'updated'`. The emitted
 * account carries its `version`, so the consumer orders by `incoming.version > existing.version`.
 *
 * Create-dedupe (§11): the SDK promises no-duplicate CREATE emissions, so an `ACCOUNT_CREATED`
 * for an already-seen id is suppressed (a lightweight id set — NOT a cache; it holds no domain
 * data). Master itself only dedupes accounts (via cache upsert); the SDK keeps that guarantee.
 *
 * The spark-balance path emits its OWN `account:updated` (op `'updated'`) off the Breez event
 * stream (see {@link SparkBalanceTracker}); this DB-trigger forwarder covers the cashu-balance /
 * account-metadata updates that arrive over the `wallet:${userId}` channel.
 *
 * The REALTIME SUBSCRIPTION that delivers these payloads (the single `wallet:${userId}` broadcast
 * channel) is the Slice-5 {@link RealtimeHub} — it dispatches each account change to
 * {@link handleChange}.
 *
 * @module
 */
import type { SdkEventMap } from '../types/events';
import type { AccountRepository } from './account-repository';
import type { AgicashDbAccountWithProofs } from './db-account';
import type { TypedEventEmitter } from './event-emitter';

/** The two account realtime event names master broadcasts. */
export type AccountChangeEvent = 'ACCOUNT_CREATED' | 'ACCOUNT_UPDATED';

/**
 * Translates `wallet.accounts` realtime DB-change payloads into the SDK's typed `account:updated`
 * event. Holds the account repository (to map a DB row → the live domain account) + the event
 * emitter; constructed by the SDK and driven by the Slice-5 realtime channel.
 */
export class AccountEventForwarder {
  /** Ids for which a CREATE has already been emitted (create-dedupe; not a cache). */
  private readonly seenCreates = new Set<string>();

  /**
   * @param repository - maps a DB row → the domain {@link Account} (with its live handle).
   * @param events - the SDK event emitter.
   */
  constructor(
    private readonly repository: AccountRepository,
    private readonly events: TypedEventEmitter<SdkEventMap>,
  ) {}

  /**
   * Translate one account DB-change into the typed `account:updated` event.
   *
   * - `ACCOUNT_CREATED` → `account:updated` with `op: 'created'` (suppressed if the id was
   *   already created).
   * - `ACCOUNT_UPDATED` → `account:updated` with `op: 'updated'`.
   *
   * The row is mapped to the domain {@link Account} via the repository (so the emitted event
   * carries the public domain shape with its live wallet handle, never the DB-data shape).
   *
   * @param event - the broadcast event name (encodes the op).
   * @param payload - the changed account row (with its proofs).
   */
  async handleChange(
    event: AccountChangeEvent,
    payload: AgicashDbAccountWithProofs,
  ): Promise<void> {
    const account = await this.repository.toAccount(payload);

    if (event === 'ACCOUNT_CREATED') {
      if (this.seenCreates.has(account.id)) {
        return;
      }
      this.seenCreates.add(account.id);
      this.events.emit('account:updated', { account, op: 'created' });
      return;
    }

    this.events.emit('account:updated', { account, op: 'updated' });
  }
}
