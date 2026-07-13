import type { AgicashDb } from '../../db/database';
import { NoSessionError } from '../../lib/error';
import type { SparkWalletConfig } from '../../lib/spark/wallet';
import type { AccountsApi, AuthSession, CashuAccount } from '../../sdk';
import type { SessionKeys } from '../../session-keys';
import { toAccountProjection } from './account-projection';
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
 * hands `/temporary` the same fat domain repository for unmigrated flows.
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
        const repository = await getRepository();
        const account = await repository.get(id);
        return account ? toAccountProjection(account) : null;
      },
      list: async () => {
        const userId = requireUserId();
        const repository = await getRepository();
        const accounts = await repository.getAllActive(userId);
        return accounts.map((account) => toAccountProjection(account));
      },
      cashu: {
        add: async (params): Promise<CashuAccount> => {
          const userId = requireUserId();
          const repository = await getRepository();
          const service = new AccountService(repository);
          const account = await service.addCashuAccount({
            userId,
            account: { ...params, type: 'cashu' },
          });
          return toAccountProjection(account);
        },
      },
    },
  };
}
