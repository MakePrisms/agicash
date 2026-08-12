import { describe, expect, it } from 'bun:test';
import type { AgicashDb } from '../../db/database';
import { NoSessionError, SessionEndedError } from '../../lib/error';
import type { AuthSession, AuthUser } from '../sdk';
import { createSessionKeys } from '../sdk/session-keys';
import type { Transaction } from './transaction';
import type { TransactionRepository } from './transaction-repository';
import { createTransactionsApi } from './transactions-api';

const authUser = (id: string): AuthUser =>
  ({
    id,
    name: null,
    email: 'a@b.c',
    email_verified: true,
    login_method: 'email',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  }) as AuthUser;

const loggedIn = (id: string): AuthSession => ({
  isLoggedIn: true,
  user: authUser(id),
});

const makeTransaction = (overrides: Partial<Record<string, unknown>> = {}) =>
  ({
    id: 'tx-1',
    state: 'PENDING',
    direction: 'RECEIVE',
    type: 'CASHU_LIGHTNING',
    createdAt: '2026-01-01T00:00:00Z',
    version: 1,
    ...overrides,
  }) as unknown as Transaction;

const makeApi = (deps: {
  session: AuthSession;
  repository?: Partial<TransactionRepository>;
}) =>
  createTransactionsApi({
    db: {} as unknown as AgicashDb,
    keys: createSessionKeys(),
    getSession: () => deps.session,
    createRepository: async () =>
      (deps.repository ?? {}) as unknown as TransactionRepository,
  });

describe('createTransactionsApi', () => {
  describe('list', () => {
    it('passes the session userId and params through and returns the page verbatim', async () => {
      let captured:
        | {
            userId: string;
            cursor?: {
              stateSortOrder: number;
              createdAt: string;
              id: string;
            } | null;
            pageSize?: number;
            accountId?: string;
            abortSignal?: AbortSignal;
          }
        | undefined;
      const nextCursor = {
        stateSortOrder: 2,
        createdAt: '2026-01-03',
        id: 'tx-10',
      };
      const page = {
        transactions: [makeTransaction()],
        nextCursor,
      };
      const api = makeApi({
        session: loggedIn('user-x'),
        repository: {
          list: (async (options) => {
            captured = options;
            return page;
          }) as TransactionRepository['list'],
        },
      });

      const cursor = {
        stateSortOrder: 1,
        createdAt: '2026-01-02',
        id: 'tx-9',
      };
      const result = await api.list({
        cursor,
        pageSize: 10,
        accountId: 'acct-1',
      });

      expect(captured?.userId).toBe('user-x');
      expect(captured?.cursor).toEqual(cursor);
      expect(captured?.pageSize).toBe(10);
      expect(captured?.accountId).toBe('acct-1');
      expect(captured?.abortSignal).toBeDefined();
      expect(result).toEqual(page);
    });

    it('throws NoSessionError without a session', async () => {
      const api = makeApi({ session: { isLoggedIn: false } });
      await expect(api.list({})).rejects.toBeInstanceOf(NoSessionError);
    });

    it('rejects with SessionEndedError and issues no read after dispose', async () => {
      const keys = createSessionKeys();
      let listCalls = 0;
      const api = createTransactionsApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        createRepository: async () =>
          ({
            list: (async () => {
              listCalls += 1;
              return { transactions: [], nextCursor: null };
            }) as TransactionRepository['list'],
          }) as unknown as TransactionRepository,
      });

      keys.dispose();

      await expect(api.list({})).rejects.toBeInstanceOf(SessionEndedError);
      expect(listCalls).toBe(0);
    });

    it('rejects with SessionEndedError and issues no read when the session ends before the read', async () => {
      const keys = createSessionKeys();
      let listCalls = 0;
      const api = createTransactionsApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        createRepository: async () => {
          // The session ends between the signal capture and the read.
          keys.reset();
          return {
            list: (async () => {
              listCalls += 1;
              return { transactions: [], nextCursor: null };
            }) as TransactionRepository['list'],
          } as unknown as TransactionRepository;
        },
      });

      await expect(api.list({})).rejects.toBeInstanceOf(SessionEndedError);
      expect(listCalls).toBe(0);
    });

    it('rejects with SessionEndedError when the session ends during the read', async () => {
      const keys = createSessionKeys();
      const api = createTransactionsApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        createRepository: async () =>
          ({
            list: (async () => {
              keys.reset();
              return {
                transactions: [makeTransaction()],
                nextCursor: null,
              };
            }) as TransactionRepository['list'],
          }) as unknown as TransactionRepository,
      });

      await expect(api.list({})).rejects.toBeInstanceOf(SessionEndedError);
    });
  });

  describe('get', () => {
    it('returns the transaction', async () => {
      const api = makeApi({
        session: loggedIn('user-x'),
        repository: {
          get: (async () => makeTransaction()) as TransactionRepository['get'],
        },
      });

      const transaction = await api.get('tx-1');

      expect(transaction).toEqual(makeTransaction());
    });

    it('returns null when the transaction does not exist', async () => {
      const api = makeApi({
        session: loggedIn('user-x'),
        repository: {
          get: (async () => null) as TransactionRepository['get'],
        },
      });

      await expect(api.get('missing')).resolves.toBeNull();
    });

    it('rejects with SessionEndedError when the session ends during the read', async () => {
      const keys = createSessionKeys();
      const api = createTransactionsApi({
        db: {} as unknown as AgicashDb,
        keys,
        getSession: () => loggedIn('user-x'),
        createRepository: async () =>
          ({
            get: (async () => {
              keys.reset();
              return makeTransaction();
            }) as TransactionRepository['get'],
          }) as unknown as TransactionRepository,
      });

      await expect(api.get('tx-1')).rejects.toBeInstanceOf(SessionEndedError);
    });
  });

  describe('countPendingAck', () => {
    it('passes the session userId and returns the count', async () => {
      let capturedUserId: string | undefined;
      const api = makeApi({
        session: loggedIn('user-x'),
        repository: {
          countTransactionsPendingAck: (async (params) => {
            capturedUserId = params.userId;
            return 3;
          }) as TransactionRepository['countTransactionsPendingAck'],
        },
      });

      const count = await api.countPendingAck();

      expect(capturedUserId).toBe('user-x');
      expect(count).toBe(3);
    });

    it('throws NoSessionError without a session', async () => {
      const api = makeApi({ session: { isLoggedIn: false } });
      await expect(api.countPendingAck()).rejects.toBeInstanceOf(
        NoSessionError,
      );
    });
  });

  describe('acknowledge', () => {
    it('passes the session userId and the transactionId', async () => {
      let captured: { userId: string; transactionId: string } | undefined;
      const api = makeApi({
        session: loggedIn('user-x'),
        repository: {
          acknowledgeTransaction: (async (params) => {
            captured = params;
          }) as TransactionRepository['acknowledgeTransaction'],
        },
      });

      await api.acknowledge('tx-1');

      expect(captured).toEqual({
        userId: 'user-x',
        transactionId: 'tx-1',
      });
    });

    it('throws NoSessionError without a session', async () => {
      const api = makeApi({ session: { isLoggedIn: false } });
      await expect(api.acknowledge('tx-1')).rejects.toBeInstanceOf(
        NoSessionError,
      );
    });
  });
});
