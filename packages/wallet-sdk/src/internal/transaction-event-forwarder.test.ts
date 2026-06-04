import { describe, expect, mock, test } from 'bun:test';
import { TransactionEventForwarder } from './transaction-event-forwarder';
import { TypedEventEmitter } from './event-emitter';
import type { AgicashDbTransaction } from './db-transaction';
import type { TransactionRepository } from './transaction-repository';
import type { SdkEventMap } from '../events';
import { type Currency, Money } from '../types/money';
import type { Transaction } from '../types/transaction';

const sats = (n: number): Money =>
  new Money({ amount: n, currency: 'BTC' as Currency, unit: 'sat' });

/** A repository whose `toTransaction` yields a transaction with the given id + version. */
function repoYielding(tx: Transaction): TransactionRepository {
  return {
    toTransaction: mock(async () => tx),
  } as unknown as TransactionRepository;
}

const tx = (id: string, version: number): Transaction =>
  ({ id, version, amount: sats(1) }) as Transaction;

/** The DB-change payload is just a row; the forwarder parses it via the repo. */
const payload = { id: 'tx1' } as AgicashDbTransaction;

describe('TransactionEventForwarder (net-new transaction:* events, §11)', () => {
  test('TRANSACTION_CREATED → transaction:created carrying the domain transaction (+version)', async () => {
    const events = new TypedEventEmitter<SdkEventMap>();
    const seen: SdkEventMap['transaction:created'][] = [];
    events.on('transaction:created', (e) => seen.push(e));

    await new TransactionEventForwarder(
      repoYielding(tx('tx1', 4)),
      events,
    ).handleChange('TRANSACTION_CREATED', payload);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.transaction.id).toBe('tx1');
    // version is forwarded on the transaction (consumer orders by it).
    expect(seen[0]?.transaction.version).toBe(4);
  });

  test('TRANSACTION_UPDATED → transaction:updated (the op comes from the event NAME)', async () => {
    const events = new TypedEventEmitter<SdkEventMap>();
    let created = 0;
    const updated: SdkEventMap['transaction:updated'][] = [];
    events.on('transaction:created', () => created++);
    events.on('transaction:updated', (e) => updated.push(e));

    await new TransactionEventForwarder(
      repoYielding(tx('tx1', 5)),
      events,
    ).handleChange('TRANSACTION_UPDATED', payload);

    expect(created).toBe(0);
    expect(updated).toHaveLength(1);
    expect(updated[0]?.transaction.version).toBe(5);
  });

  test('create-dedupe: a second CREATE for the same id is suppressed', async () => {
    const events = new TypedEventEmitter<SdkEventMap>();
    let created = 0;
    events.on('transaction:created', () => created++);

    const forwarder = new TransactionEventForwarder(
      repoYielding(tx('tx1', 1)),
      events,
    );
    await forwarder.handleChange('TRANSACTION_CREATED', payload);
    await forwarder.handleChange('TRANSACTION_CREATED', payload);

    // The SDK promises no-duplicate CREATE events.
    expect(created).toBe(1);
  });

  test('an UPDATE is NOT deduped (always re-emitted)', async () => {
    const events = new TypedEventEmitter<SdkEventMap>();
    let updated = 0;
    events.on('transaction:updated', () => updated++);

    const forwarder = new TransactionEventForwarder(
      repoYielding(tx('tx1', 2)),
      events,
    );
    await forwarder.handleChange('TRANSACTION_UPDATED', payload);
    await forwarder.handleChange('TRANSACTION_UPDATED', payload);

    expect(updated).toBe(2);
  });
});
