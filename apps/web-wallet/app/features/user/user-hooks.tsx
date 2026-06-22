import type { Currency } from '@agicash/money';
import type { Sdk } from '@agicash/wallet-sdk';
import {
  type QueryClient,
  useMutation,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { getQueryClient } from '~/features/shared/query-client';
import { useSdk } from '~/features/shared/use-sdk';
import { useAuthActions, useAuthState } from '~/features/user/auth';
import { useLatest } from '~/lib/use-latest';
import type { Account } from '../accounts/account';
import { guestAccountStorage } from './guest-account-storage';
import type { User } from './user';

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
  sdk,
  select,
}: {
  sdk: Promise<Sdk>;
  select?: (data: User) => TData;
}) => ({
  queryKey: [UserCache.Key],
  queryFn: async () => {
    const user = await (await sdk).user.getCurrentUser();
    if (!user) {
      throw new Error('Cannot use useUser hook in anonymous context');
    }
    return user;
  },
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
  if (!authState.user) {
    throw new Error('Cannot use useUser hook in anonymous context');
  }

  const sdk = useSdk();

  const { data } = useSuspenseQuery(userQueryOptions({ sdk, select }));

  return data;
};

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
  const sdkPromise = useSdk();

  const { mutateAsync } = useMutation({
    mutationKey: ['request-new-email-verification-code'],
    mutationFn: async () => {
      if (userRef.current.isGuest) {
        throw new Error('Cannot request email verification for guest account');
      }
      if (userRef.current.emailVerified) {
        throw new Error('Email is already verified');
      }

      return (await sdkPromise).auth.requestEmailVerificationCode();
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

export const useSetDefaultCurrency = () => {
  const sdkPromise = useSdk();

  const { mutateAsync } = useMutation({
    mutationFn: async (currency: Currency) =>
      (await sdkPromise).user.setDefaultCurrency(currency),
  });

  return useCallback(
    (currency: Currency) => mutateAsync(currency),
    [mutateAsync],
  );
};

export const useSetDefaultAccount = () => {
  const sdkPromise = useSdk();

  const { mutateAsync } = useMutation({
    mutationFn: async (account: Account) =>
      (await sdkPromise).accounts.setDefault(account),
  });

  return mutateAsync;
};

export const useUpdateUsername = () => {
  const sdkPromise = useSdk();

  const { mutateAsync } = useMutation({
    mutationFn: async (username: string) =>
      (await sdkPromise).user.updateUsername(username),
  });

  return useCallback(
    (username: string) => mutateAsync(username),
    [mutateAsync],
  );
};

export const useAcceptTerms = () => {
  const sdkPromise = useSdk();

  const { mutateAsync } = useMutation({
    mutationFn: async ({
      walletTerms,
      giftCardTerms,
    }: { walletTerms?: boolean; giftCardTerms?: boolean }) =>
      (await sdkPromise).user.acceptTerms({
        wallet: walletTerms,
        giftCardMint: giftCardTerms,
      }),
  });

  return useCallback(
    (params: { walletTerms?: boolean; giftCardTerms?: boolean }) =>
      mutateAsync(params),
    [mutateAsync],
  );
};
