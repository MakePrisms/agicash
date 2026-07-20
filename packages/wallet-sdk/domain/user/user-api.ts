import { withRetry } from '@agicash/utils';
import { core } from 'zod/mini';
import type { AgicashDb } from '../../db/database';
import { NoSessionError } from '../../lib/error';
import type { SessionKeys } from '../../session-keys';
import type { AccountRepository } from '../accounts/account-repository';
import type { AuthSession, UserApi } from '../sdk';
import {
  ReadUserRepository,
  UpdateUserRepository,
  UpsertUserRepository,
} from './user-repository';
import { UserService } from './user-service';

type Deps = {
  db: AgicashDb;
  getSession: () => AuthSession;
  keys: SessionKeys;
  /** The accounts namespace's repository — one construction path for the whole instance. */
  getAccountRepository: () => Promise<AccountRepository>;
};

const isDevelopmentMode = import.meta.env.MODE === 'development';

const defaultAccounts = [
  {
    type: 'spark',
    currency: 'BTC',
    name: 'Bitcoin',
    network: 'MAINNET',
    isDefault: true,
    purpose: 'transactional',
    expiresAt: null,
  },
  ...(isDevelopmentMode
    ? ([
        {
          type: 'cashu',
          currency: 'BTC',
          name: 'Testnut BTC',
          mintUrl: 'https://testnut.cashu.space',
          isTestMint: true,
          isDefault: false,
          purpose: 'transactional',
          expiresAt: null,
        },
        {
          type: 'cashu',
          currency: 'USD',
          name: 'Testnut USD',
          mintUrl: 'https://testnut.cashu.space',
          isTestMint: true,
          isDefault: true,
          purpose: 'transactional',
          expiresAt: null,
        },
      ] as const)
    : []),
] as const;

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
    provision: async (params) => {
      const session = deps.getSession();
      if (!session.isLoggedIn) {
        throw new NoSessionError();
      }
      const authUser = session.user;

      // The memoized getters re-fetch only on failure, so retrying the batch
      // re-derives only the keys that failed, not the ones already resolved.
      const [
        encryptionPublicKey,
        cashuLockingXpub,
        sparkIdentityPublicKey,
        accountRepository,
      ] = await withRetry({
        fn: () =>
          Promise.all([
            deps.keys.getEncryptionPublicKey(),
            deps.keys.getCashuLockingXpub(),
            deps.keys.getSparkIdentityPublicKey(),
            deps.getAccountRepository(),
          ]),
      });

      const upsertRepository = new UpsertUserRepository(
        deps.db,
        accountRepository,
      );

      return withRetry({
        fn: () =>
          upsertRepository.upsert({
            id: authUser.id,
            email: authUser.email,
            emailVerified: authUser.email_verified,
            accounts: [...defaultAccounts],
            cashuLockingXpub,
            encryptionPublicKey,
            sparkIdentityPublicKey,
            termsAcceptedAt: params.termsAcceptedAt,
            giftCardMintTermsAcceptedAt: params.giftCardMintTermsAcceptedAt,
          }),
        retry: (attemptIndex, error) => {
          if (error instanceof core.$ZodError) {
            return false;
          }
          return attemptIndex < 2;
        },
      });
    },
  };
}
