import { describe, expect, it } from 'bun:test';
import type { AgicashDb, AgicashDbTransaction } from '../../db/database';
import type { Transaction } from './transaction';
import { TransactionRepository } from './transaction-repository';

const makeRow = (id: string) => ({ id }) as unknown as AgicashDbTransaction;

const makeRepository = (
  rows: AgicashDbTransaction[],
  states: Record<string, Transaction['state']> = {},
) => {
  const db = {
    rpc: () =>
      Object.assign(Promise.resolve({ data: rows, error: null }), {
        abortSignal: () => undefined,
      }),
  } as unknown as AgicashDb;

  const repository = new TransactionRepository(db, {
    encrypt: async () => '',
    decrypt: async <T = unknown>() => ({}) as T,
  });
  repository.toTransaction = async (data) =>
    ({
      id: data.id,
      state: states[data.id] ?? 'COMPLETED',
      createdAt: `2026-01-0${data.id.slice(-1)}T00:00:00Z`,
    }) as unknown as Transaction;

  return repository;
};

describe('TransactionRepository.list', () => {
  it('returns a keyset cursor from the last row of a full page', async () => {
    const repository = makeRepository([makeRow('tx-1'), makeRow('tx-2')]);

    const { nextCursor } = await repository.list({
      userId: 'user-x',
      pageSize: 2,
    });

    expect(nextCursor).toEqual({
      stateSortOrder: 1,
      createdAt: '2026-01-02T00:00:00Z',
      id: 'tx-2',
    });
  });

  it('marks the cursor with the pending sort order when the last row is pending', async () => {
    const repository = makeRepository([makeRow('tx-1'), makeRow('tx-2')], {
      'tx-2': 'PENDING',
    });

    const { nextCursor } = await repository.list({
      userId: 'user-x',
      pageSize: 2,
    });

    expect(nextCursor?.stateSortOrder).toBe(2);
  });

  it('returns a null cursor for a short page', async () => {
    const repository = makeRepository([makeRow('tx-1'), makeRow('tx-2')]);

    const { transactions, nextCursor } = await repository.list({
      userId: 'user-x',
      pageSize: 3,
    });

    expect(transactions).toHaveLength(2);
    expect(nextCursor).toBeNull();
  });

  it('returns a null cursor for an empty page', async () => {
    const repository = makeRepository([]);

    const { transactions, nextCursor } = await repository.list({
      userId: 'user-x',
      pageSize: 25,
    });

    expect(transactions).toHaveLength(0);
    expect(nextCursor).toBeNull();
  });
});
