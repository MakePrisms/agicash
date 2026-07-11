import type { Currency } from '@agicash/money';
import type { AgicashDb } from '../../db/database';
import { NoSessionError } from '../../lib/error';
import type { AuthSession, UserApi } from '../../sdk';
import { ReadUserRepository, WriteUserRepository } from './user-repository';
import { UserService } from './user-service';

type Deps = {
  db: AgicashDb;
  getSession: () => AuthSession;
};

export function createUserApi(deps: Deps): UserApi {
  const readRepository = new ReadUserRepository(deps.db);
  const writeRepository = new WriteUserRepository(deps.db);
  const userService = new UserService(writeRepository);

  const requireUserId = (): string => {
    const session = deps.getSession();
    if (!session.isLoggedIn) {
      throw new NoSessionError();
    }
    return session.user.id;
  };

  const getAccountRef = async (
    userId: string,
    accountId: string,
  ): Promise<{ id: string; currency: Currency }> => {
    const { data, error } = await deps.db
      .from('accounts')
      .select('id, currency')
      .eq('id', accountId)
      // RLS already scopes rows to the user; this is defense-in-depth per the
      // "userId implicit from session" convention.
      .eq('user_id', userId)
      .single();
    if (error) {
      throw new Error('Failed to get account', { cause: error });
    }
    return data;
  };

  // Methods are async so a missing session surfaces as a rejection, matching
  // the Promise-returning contract, not a synchronous throw.
  return {
    get: async () => readRepository.get(requireUserId()),
    updateUsername: async (username) =>
      writeRepository.update(requireUserId(), { username }),
    acceptTerms: async (params) => {
      const now = new Date().toISOString();
      return writeRepository.update(requireUserId(), {
        termsAcceptedAt: params.walletTerms ? now : undefined,
        giftCardMintTermsAcceptedAt: params.giftCardTerms ? now : undefined,
      });
    },
    setDefaultCurrency: async (params) =>
      writeRepository.update(requireUserId(), {
        defaultCurrency: params.currency,
      }),
    setDefaultAccount: async (params) => {
      // The session is read once for the whole verb: the user that validated
      // account ownership must be the user whose row is written, or a session
      // switch during the account fetch writes the previous user's account
      // onto the next user's row.
      const userId = requireUserId();
      // One read, not two: the account row is fetched to derive the
      // per-currency column server-truthfully; the user row isn't needed
      // because the update only writes the changed columns.
      const account = await getAccountRef(userId, params.accountId);
      return userService.setDefaultAccount({ id: userId }, account, {
        setDefaultCurrency: params.setDefaultCurrency,
      });
    },
  };
}
