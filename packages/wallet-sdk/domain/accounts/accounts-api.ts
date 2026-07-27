import type { AgicashDb } from '../../db/database';
import { NoSessionError, SessionEndedError } from '../../lib/error';
import type { SparkWalletConfig } from '../../lib/spark/wallet';
import type { AccountsApi, AuthSession, CashuAccount } from '../sdk';
import type { SessionKeys } from '../sdk/session-keys';
import { AccountRepository } from './account-repository';
import { AccountService } from './account-service';

type Deps = {
  db: AgicashDb;
  getSession: () => AuthSession;
  keys: SessionKeys;
  sparkConfig: SparkWalletConfig;
  /** Test seam; defaults to building the repository from db + session keys. */
  createRepository?: () => Promise<AccountRepository>;
};

/**
 * The `accounts` namespace and its bridge share one data path: every method
 * builds the repository from the same db + session keys, and `getRepository`
 * hands `/temporary` the same repository for unmigrated flows.
 */
export function createAccountsApi(deps: Deps): {
  api: AccountsApi;
  getRepository: () => Promise<AccountRepository>;
} {
  const requireUserId = (): string => {
    const session = deps.getSession();
    if (!session.isLoggedIn) {
      throw new NoSessionError();
    }
    return session.user.id;
  };

  const getRepository =
    deps.createRepository ??
    (async (): Promise<AccountRepository> => {
      const encryption = await deps.keys.getEncryption();
      return new AccountRepository(
        deps.db,
        encryption,
        deps.keys.getCashuSeed,
        deps.keys.getSparkMnemonic,
        deps.sparkConfig,
      );
    });

  return {
    getRepository,
    api: {
      get: async (id) => {
        const signal = deps.keys.sessionSignal();
        const repository = await getRepository();
        if (signal.aborted) {
          throw new SessionEndedError();
        }
        const account = await repository.get(id, { abortSignal: signal });
        if (signal.aborted) {
          throw new SessionEndedError();
        }
        return account;
      },
      list: async () => {
        const userId = requireUserId();
        const signal = deps.keys.sessionSignal();
        const repository = await getRepository();
        if (signal.aborted) {
          throw new SessionEndedError();
        }
        const accounts = await repository.getAllActive(userId, {
          abortSignal: signal,
        });
        if (signal.aborted) {
          throw new SessionEndedError();
        }
        return accounts;
      },
      cashu: {
        add: async (params): Promise<CashuAccount> => {
          const userId = requireUserId();
          const signal = deps.keys.sessionSignal();
          const repository = await getRepository();
          if (signal.aborted) {
            throw new SessionEndedError();
          }
          const service = new AccountService(repository);
          const account = await service.addCashuAccount(
            {
              userId,
              account: { ...params, type: 'cashu' },
            },
            { abortSignal: signal },
          );
          if (signal.aborted) {
            throw new SessionEndedError();
          }
          return account;
        },
      },
    },
  };
}
