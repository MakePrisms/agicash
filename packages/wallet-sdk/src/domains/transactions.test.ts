import { describe, expect, mock, test } from 'bun:test';
import { TransactionsDomainImpl } from './transactions';
import type { SessionResolver } from '../internal/session';
import type { TransactionRepository } from '../internal/transaction-repository';
import { QueryClient } from '../query';
import { type Currency, Money } from '../types/money';
import type { Query } from '../types/query';
import type { Transaction, TransactionState } from '../types/transaction';

const sats = (n: number): Money =>
  new Money({ amount: n, currency: 'BTC' as Currency, unit: 'sat' });

/** A fresh QueryClient per domain (the SDK-internal one in production). */
function makeClient(): QueryClient {
  return new QueryClient();
}

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

describe('TransactionsDomain.list (Query<T>, PENDING-first ordering + page cap)', () => {
  test('list() returns a Query<T> (observable fetch), not a bare Promise', () => {
    const repo = {
      list: mock(async () => ({ transactions: [], nextCursor: null })),
    } as unknown as TransactionRepository;
    const domain = new TransactionsDomainImpl(makeClient(), repo, session);

    const query: Query<{ transactions: Transaction[]; nextCursor: unknown }> =
      domain.list();

    expect(typeof query.subscribe).toBe('function');
    expect(typeof query.toPromise).toBe('function');
    expect(typeof query.getSnapshot).toBe('function');
    expect(typeof query.refetch).toBe('function');
  });

  test('memoises one stable Query per (accountId, cursor, pageSize)', () => {
    const repo = {
      list: mock(async () => ({ transactions: [], nextCursor: null })),
    } as unknown as TransactionRepository;
    const domain = new TransactionsDomainImpl(makeClient(), repo, session);

    // Same args -> same stable ref; different args -> different ref.
    expect(domain.list({ pageSize: 25 })).toBe(domain.list({ pageSize: 25 }));
    expect(domain.list({ pageSize: 25 })).not.toBe(
      domain.list({ pageSize: 10 }),
    );
  });

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
    const domain = new TransactionsDomainImpl(makeClient(), repo, session);

    const result = await domain.list({ pageSize: 25 }).toPromise();

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
    const domain = new TransactionsDomainImpl(makeClient(), repo, session);

    const result = await domain.list({ pageSize: 25 }).toPromise();

    expect(result.nextCursor).toEqual(cursor);
  });

  test('caps paging: nextCursor is NULLED when the page came back SHORT', async () => {
    const short = [tx('a', 'COMPLETED'), tx('b', 'COMPLETED')];
    const cursor = { stateSortOrder: 1, createdAt: 'x', id: 'b' };
    const repo = {
      list: mock(async () => ({ transactions: short, nextCursor: cursor })),
    } as unknown as TransactionRepository;
    const domain = new TransactionsDomainImpl(makeClient(), repo, session);

    const result = await domain.list({ pageSize: 25 }).toPromise();

    // A short page means no next page (master's useTransactions caps the same way).
    expect(result.nextCursor).toBeNull();
  });

  test('forwards the user id, cursor, accountId + pageSize to the repository', async () => {
    const repo = {
      list: mock(async () => ({ transactions: [], nextCursor: null })),
    } as unknown as TransactionRepository;
    const domain = new TransactionsDomainImpl(makeClient(), repo, session);
    const cursor = { stateSortOrder: 2, createdAt: 'x', id: 'p' };

    await domain.list({ accountId: 'acc1', cursor, pageSize: 10 }).toPromise();

    expect(repo.list).toHaveBeenCalledWith({
      userId: 'u1',
      cursor,
      pageSize: 10,
      accountId: 'acc1',
    });
  });
});

describe('TransactionsDomain.get (Query<T>)', () => {
  test('get(id) returns a Query that resolves to the transaction', async () => {
    const target = tx('t1', 'COMPLETED');
    const repo = {
      get: mock(async () => target),
    } as unknown as TransactionRepository;
    const domain = new TransactionsDomainImpl(makeClient(), repo, session);

    const query = domain.get('t1');
    expect(typeof query.getSnapshot).toBe('function');
    expect(await query.toPromise()).toBe(target);
    // Memoised per id.
    expect(domain.get('t1')).toBe(query);
  });
});

describe('TransactionsDomain.acknowledge / countPendingAck', () => {
  test('acknowledge (Promise) takes the FULL transaction and acks it by id for the user', async () => {
    const acknowledgeTransaction = mock(async () => undefined);
    const repo = { acknowledgeTransaction } as unknown as TransactionRepository;
    const domain = new TransactionsDomainImpl(makeClient(), repo, session);

    await domain.acknowledge(tx('t1', 'COMPLETED'));

    expect(acknowledgeTransaction).toHaveBeenCalledWith({
      userId: 'u1',
      transactionId: 't1',
    });
  });

  test('countPendingAck() returns a Query resolving to the repository count for the user', async () => {
    const repo = {
      countTransactionsPendingAck: mock(async () => 3),
    } as unknown as TransactionRepository;
    const domain = new TransactionsDomainImpl(makeClient(), repo, session);

    const query = domain.countPendingAck();
    expect(typeof query.getSnapshot).toBe('function');
    expect(await query.toPromise()).toBe(3);
    expect(repo.countTransactionsPendingAck).toHaveBeenCalledWith({
      userId: 'u1',
    });
  });
});
