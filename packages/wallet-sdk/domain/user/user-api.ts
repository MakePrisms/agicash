import type { AgicashDb } from '../../db/database';
import { NoSessionError } from '../../lib/error';
import type { AuthSession, UserApi } from '../sdk';
import { ReadUserRepository, UpdateUserRepository } from './user-repository';
import { UserService } from './user-service';

type Deps = {
  db: AgicashDb;
  getSession: () => AuthSession;
};

export function createUserApi(deps: Deps): UserApi {
  const readRepository = new ReadUserRepository(deps.db);
  const updateRepository = new UpdateUserRepository(deps.db);
  const userService = new UserService(updateRepository);

  const requireUserId = (): string => {
    const session = deps.getSession();
    if (!session.isLoggedIn) {
      throw new NoSessionError();
    }
    return session.user.id;
  };

  // Methods are async so a missing session surfaces as a rejection, matching
  // the Promise-returning contract, not a synchronous throw.
  return {
    get: async () => readRepository.get(requireUserId()),
    updateUsername: async (username) =>
      updateRepository.update(requireUserId(), { username }),
    acceptTerms: async (params) => {
      const now = new Date().toISOString();
      return updateRepository.update(requireUserId(), {
        termsAcceptedAt: params.walletTerms ? now : undefined,
        giftCardMintTermsAcceptedAt: params.giftCardTerms ? now : undefined,
      });
    },
    setDefaultCurrency: async (params) =>
      updateRepository.update(requireUserId(), {
        defaultCurrency: params.currency,
      }),
    setDefaultAccount: async (params) =>
      userService.setDefaultAccount(requireUserId(), params.account, {
        setDefaultCurrency: params.setDefaultCurrency,
      }),
  };
}
