/**
 * Internal transaction realtime → SDK-event forwarder — Slice 4 (transactions).
 *
 * NET-NEW (the event-SHAPE contract for `transaction:created` / `transaction:updated`, §11). It
 * GENERALIZES master's `transaction-hooks.ts#useTransactionChangeHandlers` (which translates the
 * `TRANSACTION_CREATED` / `TRANSACTION_UPDATED` broadcast events into TanStack-cache upserts):
 * here it instead translates them into the SDK's typed events.
 *
 * Master encodes the operation in the event NAME (`TRANSACTION_CREATED` vs `TRANSACTION_UPDATED`);
 * the SDK reads the name and emits the DISTINCT typed event (§11) — `transaction:created` for a
 * CREATE, `transaction:updated` for an UPDATE — each carrying the full domain `Transaction`
 * (which carries its `version`, so the consumer orders by `incoming.version > existing.version`).
 *
 * The REALTIME SUBSCRIPTION that actually delivers these DB-change payloads (the single
 * `wallet:${userId}` broadcast channel) is Slice 5/PR7 — THIS slice only DEFINES + tests the
 * shape + the emit path. Slice 5 wires the channel to call {@link handleChange}.
 *
 * Optional CREATE-dedupe (§11): the SDK promises no-duplicate CREATE events, so a CREATE for an
 * already-seen id is suppressed (a lightweight id set, NOT a cache — it holds no domain data).
 *
 * @module
 */
import type { TypedEventEmitter } from './event-emitter';
import type { AgicashDbTransaction } from './db-transaction';
import type { TransactionRepository } from './transaction-repository';
import type { SdkEventMap } from '../types/events';

/** The two transaction realtime event names master broadcasts. */
export type TransactionChangeEvent =
  | 'TRANSACTION_CREATED'
  | 'TRANSACTION_UPDATED';

/**
 * Translates `wallet.transactions` realtime DB-change payloads into the SDK's typed
 * `transaction:*` events. Holds the transaction repository (to parse a row → domain transaction)
 * + the event emitter; constructed by the SDK and driven by the Slice-5 realtime channel.
 */
export class TransactionEventForwarder {
  /** Ids for which a CREATE has already been emitted (create-dedupe; not a cache). */
  private readonly seenCreates = new Set<string>();

  /**
   * @param repository - parses a DB row → the domain {@link Transaction}.
   * @param events - the SDK event emitter.
   */
  constructor(
    private readonly repository: TransactionRepository,
    private readonly events: TypedEventEmitter<SdkEventMap>,
  ) {}

  /**
   * Translate one transaction DB-change into the matching typed SDK event.
   *
   * - `TRANSACTION_CREATED` → `transaction:created` (suppressed if the id was already created).
   * - `TRANSACTION_UPDATED` → `transaction:updated`.
   *
   * The row is parsed to the domain {@link Transaction} via the repository's internal DB→domain
   * pipeline (so the emitted event carries the public domain shape, never the DB-data shape).
   *
   * @param event - the broadcast event name (encodes the op).
   * @param payload - the changed transaction row.
   */
  async handleChange(
    event: TransactionChangeEvent,
    payload: AgicashDbTransaction,
  ): Promise<void> {
    const transaction = await this.repository.toTransaction(payload);

    if (event === 'TRANSACTION_CREATED') {
      if (this.seenCreates.has(transaction.id)) {
        return;
      }
      this.seenCreates.add(transaction.id);
      this.events.emit('transaction:created', { transaction });
      return;
    }

    this.events.emit('transaction:updated', { transaction });
  }
}
