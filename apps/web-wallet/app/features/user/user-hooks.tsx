import type { Currency } from '@agicash/money';
import { requestNewVerificationCode } from '@agicash/opensecret';
import type { Account } from '@agicash/wallet-sdk';
import type { User } from '@agicash/wallet-sdk';
import type { AgicashDbUser, UpdateUser } from '@agicash/wallet-sdk/temporary';
import { ReadUserRepository } from '@agicash/wallet-sdk/temporary';
import {
  type QueryClient,
  useMutation,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { getQueryClient } from '~/features/shared/query-client';
import { useAuthActions, useAuthState } from '~/features/user/auth';
import { useLatest } from '~/lib/use-latest';
import { guestAccountStorage } from './guest-account-storage';
import {
  useReadUserRepository,
  useWriteUserRepository,
} from './user-repository-hooks';
import { useUserService } from './user-service-hooks';

export class UserCache {
  public static Key = 'user';

  constructor(private readonly queryClient: QueryClient) {}

  set(user: User) {
    this.queryClient.setQueryData([UserCache.Key], user);
  }

  get() {
    return this.queryClient.getQueryData<User>([UserCache.Key]);
  }

  invalidate() {
    return this.queryClient.invalidateQueries({ queryKey: [UserCache.Key] });
  }
}

export function useUserCache() {
  const queryClient = useQueryClient();
  return useMemo(() => new UserCache(queryClient), [queryClient]);
}

export function useUserChangeHandlers() {
  const userCache = useUserCache();

  return [
    {
      event: 'USER_UPDATED',
      handleEvent: async (payload: AgicashDbUser) => {
        userCache.set(ReadUserRepository.toUser(payload));
      },
    },
  ];
}

export const getUserFromCache = (
  queryClient: QueryClient = getQueryClient(),
) => {
  return queryClient.getQueryData<User>([UserCache.Key]) ?? null;
};

export const getUserFromCacheOrThrow = () => {
  const user = getUserFromCache();
  if (!user) {
    throw new Error('User not found');
  }
  return user;
};

const userQueryOptions = <TData = User>({
  userId,
  userRepository,
  select,
}: {
  userId: string;
  userRepository: ReadUserRepository;
  select?: (data: User) => TData;
}) => ({
  queryKey: [UserCache.Key],
  queryFn: () => userRepository.get(userId),
  select,
});

/**
 * This hook returns the logged in user data.
 * @param select - This option can be used to transform or select a part of the data returned by the query function. If not provided, the user data will be returned as is.
 * @returns The selected user data.
 */
export const useUser = <TData = User>(
  select?: (data: User) => TData,
): TData => {
  const authState = useAuthState();
  const authUser = authState.user;
  if (!authUser) {
    throw new Error('Cannot use useUser hook in anonymous context');
  }

  const userRepository = useReadUserRepository();

  const { data } = useSuspenseQuery(
    userQueryOptions({ userId: authUser.id, userRepository, select }),
  );

  return data;
};

const isDevelopmentMode = import.meta.env.MODE === 'development';

export const defaultAccounts = [
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

export const useUserRef = () => {
  const user = useUser();
  return useLatest(user);
};

export const useUpgradeGuestToFullAccount = (): ((
  email: string,
  password: string,
) => Promise<void>) => {
  const userRef = useUserRef();
  const { convertGuestToFullAccount } = useAuthActions();

  const { mutateAsync } = useMutation({
    mutationKey: ['upgrade-guest-to-full-account'],
    mutationFn: (variables: { email: string; password: string }) => {
      if (!userRef.current.isGuest) {
        throw new Error('User already has a full account');
      }

      return convertGuestToFullAccount(
        variables.email,
        variables.password,
      ).then(() => {
        guestAccountStorage.clear();
      });
    },
    scope: {
      id: 'upgrade-guest-to-full-account',
    },
  });

  return useCallback(
    (email: string, password: string) => mutateAsync({ email, password }),
    [mutateAsync],
  );
};

export const useRequestNewEmailVerificationCode = (): (() => Promise<void>) => {
  const userRef = useUserRef();

  const { mutateAsync } = useMutation({
    mutationKey: ['request-new-email-verification-code'],
    mutationFn: () => {
      if (userRef.current.isGuest) {
        throw new Error('Cannot request email verification for guest account');
      }
      if (userRef.current.emailVerified) {
        throw new Error('Email is already verified');
      }

      return requestNewVerificationCode();
    },
    scope: {
      id: 'request-new-email-verification-code',
    },
  });

  return mutateAsync;
};

export const useVerifyEmail = (): ((code: string) => Promise<void>) => {
  const userRef = useUserRef();
  const { verifyEmail } = useAuthActions();

  const { mutateAsync } = useMutation({
    mutationFn: (code: string) => {
      if (userRef.current.isGuest) {
        throw new Error('Cannot verify email for guest account');
      }
      if (userRef.current.emailVerified) {
        throw new Error('Email is already verified');
      }

      return verifyEmail(code);
    },
    scope: {
      id: 'verify-email',
    },
  });

  return mutateAsync;
};

const useUpdateUser = () => {
  const queryClient = useQueryClient();
  const userId = useUser((user) => user.id);
  const userRepository = useWriteUserRepository();

  return useMutation({
    mutationFn: (updates: UpdateUser) => userRepository.update(userId, updates),
    onSuccess: (data) => {
      queryClient.setQueryData([UserCache.Key], data);
    },
  });
};

export const useSetDefaultCurrency = () => {
  const { mutateAsync: updateUser } = useUpdateUser();

  return useCallback(
    (currency: Currency) => updateUser({ defaultCurrency: currency }),
    [updateUser],
  );
};

export const useSetDefaultAccount = () => {
  const userService = useUserService();
  const user = useUserRef();
  const queryClient = useQueryClient();

  const { mutateAsync } = useMutation({
    mutationFn: (account: Account) =>
      userService.setDefaultAccount(user.current, account),
    onSuccess: (data) => {
      queryClient.setQueryData([UserCache.Key], data);
    },
  });

  return mutateAsync;
};

export const useUpdateUsername = () => {
  const { mutateAsync: updateUser } = useUpdateUser();

  return useCallback(
    (username: string) => updateUser({ username }),
    [updateUser],
  );
};

export const useAcceptTerms = () => {
  const { mutateAsync: updateUser } = useUpdateUser();

  return useCallback(
    ({
      walletTerms,
      giftCardTerms,
    }: { walletTerms?: boolean; giftCardTerms?: boolean }) => {
      const now = new Date().toISOString();
      const updates: UpdateUser = {};
      if (walletTerms) updates.termsAcceptedAt = now;
      if (giftCardTerms) updates.giftCardMintTermsAcceptedAt = now;
      return updateUser(updates);
    },
    [updateUser],
  );
};
