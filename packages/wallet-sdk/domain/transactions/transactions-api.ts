import type { AgicashDb } from '../../db/database';
import { NoSessionError, SessionEndedError } from '../../lib/error';
import type { AuthSession, TransactionsApi } from '../sdk';
import type { SessionKeys } from '../sdk/session-keys';
import { TransactionRepository } from './transaction-repository';

type Deps = {
  db: AgicashDb;
  getSession: () => AuthSession;
  keys: SessionKeys;
  /** Test seam; defaults to building the repository from db + session keys. */
  createRepository?: () => Promise<TransactionRepository>;
};

export function createTransactionsApi(deps: Deps): TransactionsApi {
  const requireUserId = (): string => {
    const session = deps.getSession();
    if (!session.isLoggedIn) {
      throw new NoSessionError();
    }
    return session.user.id;
  };

  const getRepository =
    deps.createRepository ??
    (async (): Promise<TransactionRepository> => {
      const encryption = await deps.keys.getEncryption();
      return new TransactionRepository(deps.db, encryption);
    });

  return {
    get: async (id) => {
      const signal = deps.keys.sessionSignal();
      const repository = await getRepository();
      if (signal.aborted) {
        throw new SessionEndedError();
      }
      const transaction = await repository.get(id, { abortSignal: signal });
      if (signal.aborted) {
        throw new SessionEndedError();
      }
      return transaction;
    },
    list: async (params) => {
      const userId = requireUserId();
      const signal = deps.keys.sessionSignal();
      const repository = await getRepository();
      if (signal.aborted) {
        throw new SessionEndedError();
      }
      const result = await repository.list({
        userId,
        cursor: params.cursor,
        pageSize: params.pageSize,
        accountId: params.accountId,
        abortSignal: signal,
      });
      if (signal.aborted) {
        throw new SessionEndedError();
      }
      return result;
    },
    countPendingAck: async () => {
      const userId = requireUserId();
      const signal = deps.keys.sessionSignal();
      const repository = await getRepository();
      if (signal.aborted) {
        throw new SessionEndedError();
      }
      const count = await repository.countTransactionsPendingAck(
        { userId },
        { abortSignal: signal },
      );
      if (signal.aborted) {
        throw new SessionEndedError();
      }
      return count;
    },
    acknowledge: async (transactionId) => {
      const userId = requireUserId();
      const signal = deps.keys.sessionSignal();
      const repository = await getRepository();
      if (signal.aborted) {
        throw new SessionEndedError();
      }
      await repository.acknowledgeTransaction(
        { userId, transactionId },
        { abortSignal: signal },
      );
      if (signal.aborted) {
        throw new SessionEndedError();
      }
    },
  };
}
