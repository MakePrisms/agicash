import { requestNewVerificationCode } from '@opensecret/react';
import {
  type QueryClient,
  useMutation,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useAuthActions, useAuthState } from '~/features/user/auth';
import type { Currency } from '~/lib/money';
import { useLatest } from '~/lib/use-latest';
import { getQueryClient } from '~/query-client';
import type { Account } from '../accounts/account';
import { guestAccountStorage } from './guest-account-storage';
import type { User } from './user';
import {
  type UpdateUser,
  type UserRepository,
  useUserRepository,
} from './user-repository';
import { useUserService } from './user-service';

export const userQueryKey = 'user';

export const getUserFromCache = (
  queryClient: QueryClient = getQueryClient(),
) => {
  return queryClient.getQueryData<User>([userQueryKey]) ?? null;
};

export const getUserFromCacheOrThrow = () => {
  const user = getUserFromCache();
  if (!user) {
    throw new Error('User not found');
  }
  return user;
};

export const userQueryOptions = <TData = User>({
  userId,
  userRepository,
  select,
}: {
  userId: string;
  userRepository: UserRepository;
  select?: (data: User) => TData;
}) => ({
  queryKey: [userQueryKey],
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

  const userRepository = useUserRepository();

  const { data } = useSuspenseQuery(
    userQueryOptions({ userId: authUser.id, userRepository, select }),
  );

  return data;
};

const isDevelopmentMode = import.meta.env.MODE === 'development';

export const defaultAccounts = [
  {
    type: 'cashu',
    currency: 'USD',
    name: 'Voltz',
    mintUrl: 'https://mint.lnvoltz.com',
    isTestMint: false,
  },
  {
    type: 'cashu',
    currency: 'BTC',
    name: 'Minibits',
    mintUrl: 'https://mint.minibits.cash/Bitcoin',
    isTestMint: false,
  },
  {
    type: 'spark',
    currency: 'BTC',
    name: 'Bitcoin',
    network: 'MAINNET',
  },
  ...(isDevelopmentMode
    ? ([
        {
          type: 'cashu',
          currency: 'BTC',
          name: 'Testnut BTC (nofees)',
          mintUrl: 'https://nofees.testnut.cashu.space',
          isTestMint: true,
        },
        {
          type: 'cashu',
          currency: 'USD',
          name: 'Testnut USD (nofees)',
          mintUrl: 'https://nofees.testnut.cashu.space',
          isTestMint: true,
        },
        {
          type: 'cashu',
          currency: 'BTC',
          name: 'Testnut BTC',
          mintUrl: 'https://testnut.cashu.space',
          isTestMint: true,
        },
        {
          type: 'cashu',
          currency: 'USD',
          name: 'Testnut USD',
          mintUrl: 'https://testnut.cashu.space',
          isTestMint: true,
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
  const userRepository = useUserRepository();

  return useMutation({
    mutationFn: (updates: UpdateUser) => userRepository.update(userId, updates),
    onSuccess: (data) => {
      queryClient.setQueryData([userQueryKey], data);
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
      queryClient.setQueryData([userQueryKey], data);
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
