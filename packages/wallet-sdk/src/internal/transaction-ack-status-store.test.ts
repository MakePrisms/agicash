import { describe, expect, test } from 'bun:test';
import { TransactionAckStatusStore } from './transaction-ack-status-store';
import type { Transaction } from '../types/transaction';

/** Build a minimal transaction with the given id + ack status (only those fields are read). */
function tx(
  id: string,
  acknowledgmentStatus: Transaction['acknowledgmentStatus'],
): Transaction {
  return { id, acknowledgmentStatus } as Transaction;
}

describe('TransactionAckStatusStore (tri-state ack)', () => {
  test('tracks all three states (null / pending / acknowledged)', () => {
    const store = new TransactionAckStatusStore();
    store.setAckStatus(tx('a', null));
    store.setAckStatus(tx('b', 'pending'));
    store.setAckStatus(tx('c', 'acknowledged'));

    expect(store.get('a')).toBe(null);
    expect(store.get('b')).toBe('pending');
    expect(store.get('c')).toBe('acknowledged');
  });

  test('get returns undefined for an unseen id (distinct from a tracked null)', () => {
    const store = new TransactionAckStatusStore();
    expect(store.get('missing')).toBeUndefined();
    expect(store.has('missing')).toBe(false);

    store.setAckStatus(tx('seen', null));
    expect(store.has('seen')).toBe(true);
    // Tracked-null is distinguishable from never-seen (undefined).
    expect(store.get('seen')).toBe(null);
  });

  test('setIfMissing records the FIRST-seen status and does not overwrite on re-delivery', () => {
    const store = new TransactionAckStatusStore();
    store.setIfMissing(tx('x', 'pending'));
    expect(store.get('x')).toBe('pending');

    // A later re-delivery (now acknowledged) must NOT change the first-seen status.
    store.setIfMissing(tx('x', 'acknowledged'));
    expect(store.get('x')).toBe('pending');
  });

  test('setAckStatus DOES overwrite an existing entry', () => {
    const store = new TransactionAckStatusStore();
    store.setIfMissing(tx('x', 'pending'));
    store.setAckStatus(tx('x', 'acknowledged'));
    expect(store.get('x')).toBe('acknowledged');
  });
});
