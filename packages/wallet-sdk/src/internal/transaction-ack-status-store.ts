/**
 * Internal transaction acknowledgment-status store — Slice 4 (transactions).
 *
 * EXTRACTED (re-housed framework-free) from
 * `apps/web-wallet/app/features/transactions/transaction-ack-status-store.ts`. Master expresses
 * this as a Zustand store consumed through the React-Router outlet context; here it is a plain
 * class holding the same `Map<transactionId, acknowledgmentStatus>` with the same tri-state
 * semantics (`null` "nothing to ack" / `'pending'` / `'acknowledged'`).
 *
 * Purpose (master): track the ack status a transaction had **when first seen** so the UI can
 * show a one-shot "new" affordance without it flickering back as realtime updates re-deliver
 * the row. `setIfMissing` records the status only the first time a transaction id is seen;
 * `setAckStatus` always overwrites. The SDK keeps this as a tiny helper the consumer (or a
 * future surface) can use; it holds NO domain data beyond the per-id ack status (not a cache).
 *
 * @module
 */
import type { Transaction } from '../types/transaction';

/** The acknowledgment status carried per transaction (`null` = nothing to acknowledge). */
type AckStatus = Transaction['acknowledgmentStatus'];

/**
 * A tri-state per-transaction acknowledgment-status tracker.
 *
 * Holds, for each transaction id seen, the ack status it had when first observed (unless
 * overwritten via {@link setAckStatus}). Framework-free analogue of master's Zustand store.
 */
export class TransactionAckStatusStore {
  /** transactionId → the tracked ack status. */
  private readonly statuses = new Map<string, AckStatus>();

  /**
   * Record `transaction`'s current ack status ONLY if this id has not been seen before. A no-op
   * for an already-tracked id (so the first-seen status is preserved across re-deliveries).
   *
   * @param transaction - the transaction to record.
   */
  setIfMissing(transaction: Transaction): void {
    if (this.statuses.has(transaction.id)) {
      return;
    }
    this.setAckStatus(transaction);
  }

  /**
   * Record (or overwrite) `transaction`'s current ack status.
   *
   * @param transaction - the transaction whose status to store.
   */
  setAckStatus(transaction: Transaction): void {
    this.statuses.set(transaction.id, transaction.acknowledgmentStatus);
  }

  /**
   * The tracked ack status for a transaction id, or `undefined` if it has not been seen.
   *
   * @param transactionId - the transaction id.
   * @returns the tracked ack status, or `undefined`.
   */
  get(transactionId: string): AckStatus | undefined {
    return this.statuses.get(transactionId);
  }

  /**
   * Whether a transaction id has been recorded.
   *
   * @param transactionId - the transaction id.
   * @returns true if seen.
   */
  has(transactionId: string): boolean {
    return this.statuses.has(transactionId);
  }
}
