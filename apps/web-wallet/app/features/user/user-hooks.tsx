import type { Currency } from '@agicash/money';
import type { Account, User } from '@agicash/wallet-sdk';
import type { AgicashDbUser } from '@agicash/wallet-sdk/temporary';
import { ReadUserRepository } from '@agicash/wallet-sdk/temporary';
import {
  type QueryClient,
  useMutation,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { getQueryClient } from '~/features/shared/query-client';
import { sdk } from '~/features/shared/sdk.client';
import { useAuthActions, useAuthState } from '~/features/user/auth';
import { useLatest } from '~/lib/use-latest';

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
  select,
}: {
  select?: (data: User) => TData;
}) => ({
  queryKey: [UserCache.Key],
  queryFn: () => sdk.user.get(),
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

  const { data } = useSuspenseQuery(userQueryOptions({ select }));

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

      return convertGuestToFullAccount(variables.email, variables.password);
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

      return sdk.auth.requestNewVerificationCode();
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

const useUserUpdatingMutation = <TVariables,>(
  mutationFn: (variables: TVariables) => Promise<User>,
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: (data) => {
      queryClient.setQueryData([UserCache.Key], data);
    },
  });
};

export const useSetDefaultCurrency = () => {
  const { mutateAsync } = useUserUpdatingMutation((currency: Currency) =>
    sdk.user.setDefaultCurrency({ currency }),
  );

  return mutateAsync;
};

export const useSetDefaultAccount = () => {
  const { mutateAsync } = useUserUpdatingMutation((account: Account) =>
    sdk.user.setDefaultAccount({ accountId: account.id }),
  );

  return mutateAsync;
};

export const useUpdateUsername = () => {
  const { mutateAsync } = useUserUpdatingMutation((username: string) =>
    sdk.user.updateUsername(username),
  );

  return mutateAsync;
};

export const useAcceptTerms = () => {
  const { mutateAsync } = useUserUpdatingMutation(
    (params: { walletTerms?: boolean; giftCardTerms?: boolean }) =>
      sdk.user.acceptTerms(params),
  );

  return mutateAsync;
};
