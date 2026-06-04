import { describe, expect, mock, test } from 'bun:test';
import { TransactionsDomainImpl } from './transactions';
import type { SessionResolver } from '../internal/session';
import type { TransactionRepository } from '../internal/transaction-repository';
import { type Currency, Money } from '../types/money';
import type { Transaction, TransactionState } from '../types/transaction';

const sats = (n: number): Money =>
  new Money({ amount: n, currency: 'BTC' as Currency, unit: 'sat' });

/** A minimal transaction in the given state (only the read fields matter). */
function tx(id: string, state: TransactionState): Transaction {
  return {
    id,
    state,
    createdAt: `2026-01-0${id.length}T00:00:00.000Z`,
    amount: sats(100),
  } as Transaction;
}

/** A session resolver whose current user is `u1`. */
const session = {
  requireCurrentUser: mock(async () => ({ id: 'u1' })),
} as unknown as SessionResolver;

describe('TransactionsDomain.list (PENDING-first ordering + page cap)', () => {
  test('returns the repository page in order (PENDING first, as the RPC sorts it)', async () => {
    // The list_transactions RPC sorts PENDING first; the domain returns that order untouched.
    const page = {
      transactions: [
        tx('p', 'PENDING'),
        tx('c', 'COMPLETED'),
        tx('f', 'FAILED'),
      ],
      nextCursor: { stateSortOrder: 1, createdAt: 'x', id: 'f' },
    };
    const repo = {
      list: mock(async () => page),
    } as unknown as TransactionRepository;
    const domain = new TransactionsDomainImpl(repo, session);

    const result = await domain.list({ pageSize: 25 });

    expect(result.transactions.map((t) => t.state)).toEqual([
      'PENDING',
      'COMPLETED',
      'FAILED',
    ]);
  });

  test('caps paging: nextCursor is kept when the page is FULL', async () => {
    const full = Array.from({ length: 25 }, (_, i) => tx(`t${i}`, 'COMPLETED'));
    const cursor = { stateSortOrder: 1, createdAt: 'x', id: 't24' };
    const repo = {
      list: mock(async () => ({ transactions: full, nextCursor: cursor })),
    } as unknown as TransactionRepository;
    const domain = new TransactionsDomainImpl(repo, session);

    const result = await domain.list({ pageSize: 25 });

    expect(result.nextCursor).toEqual(cursor);
  });

  test('caps paging: nextCursor is NULLED when the page came back SHORT', async () => {
    const short = [tx('a', 'COMPLETED'), tx('b', 'COMPLETED')];
    const cursor = { stateSortOrder: 1, createdAt: 'x', id: 'b' };
    const repo = {
      list: mock(async () => ({ transactions: short, nextCursor: cursor })),
    } as unknown as TransactionRepository;
    const domain = new TransactionsDomainImpl(repo, session);

    const result = await domain.list({ pageSize: 25 });

    // A short page means no next page (master's useTransactions caps the same way).
    expect(result.nextCursor).toBeNull();
  });

  test('forwards the user id, cursor, accountId + pageSize to the repository', async () => {
    const repo = {
      list: mock(async () => ({ transactions: [], nextCursor: null })),
    } as unknown as TransactionRepository;
    const domain = new TransactionsDomainImpl(repo, session);
    const cursor = { stateSortOrder: 2, createdAt: 'x', id: 'p' };

    await domain.list({ accountId: 'acc1', cursor, pageSize: 10 });

    expect(repo.list).toHaveBeenCalledWith({
      userId: 'u1',
      cursor,
      pageSize: 10,
      accountId: 'acc1',
    });
  });
});

describe('TransactionsDomain.acknowledge / countPendingAck', () => {
  test('acknowledge takes the FULL transaction and acks it by id for the user', async () => {
    const acknowledgeTransaction = mock(async () => undefined);
    const repo = { acknowledgeTransaction } as unknown as TransactionRepository;
    const domain = new TransactionsDomainImpl(repo, session);

    await domain.acknowledge(tx('t1', 'COMPLETED'));

    expect(acknowledgeTransaction).toHaveBeenCalledWith({
      userId: 'u1',
      transactionId: 't1',
    });
  });

  test('countPendingAck returns the repository count for the user', async () => {
    const repo = {
      countTransactionsPendingAck: mock(async () => 3),
    } as unknown as TransactionRepository;
    const domain = new TransactionsDomainImpl(repo, session);

    expect(await domain.countPendingAck()).toBe(3);
    expect(repo.countTransactionsPendingAck).toHaveBeenCalledWith({
      userId: 'u1',
    });
  });
});
