import type { Currency } from '@agicash/money';
import {
  type QueryClient,
  useMutation,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { getQueryClient } from '~/features/shared/query-client';
import { useAuthActions, useAuthState } from '~/features/user/auth';
import { getSdk } from '~/lib/sdk';
import { useLatest } from '~/lib/use-latest';
import type { Account } from '../accounts/account';
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

export function useWireUserEvents() {
  const userCache = useUserCache();

  useEffect(() => {
    const sdk = getSdk();
    return sdk.on('user:updated', ({ entity }) => {
      userCache.set(entity);
    });
  }, [userCache]);
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
} = {}) => ({
  queryKey: [UserCache.Key],
  queryFn: async (): Promise<User> => {
    const user = await getSdk().user.get();
    if (!user) {
      throw new Error('Cannot read user in anonymous context');
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

  const { data } = useSuspenseQuery(userQueryOptions({ select }));

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

      return getSdk().auth.requestEmailVerification();
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
  const queryClient = useQueryClient();

  const { mutateAsync } = useMutation({
    mutationFn: (currency: Currency) =>
      getSdk().user.setDefaultCurrency(currency),
    onSuccess: (data) => {
      queryClient.setQueryData([UserCache.Key], data);
    },
  });

  return useCallback(
    (currency: Currency) => mutateAsync(currency),
    [mutateAsync],
  );
};

export const useSetDefaultAccount = () => {
  const queryClient = useQueryClient();

  const { mutateAsync } = useMutation({
    mutationFn: (account: Account) =>
      getSdk().user.setDefaultAccount({ account }),
    onSuccess: (data) => {
      queryClient.setQueryData([UserCache.Key], data);
    },
  });

  return mutateAsync;
};

export const useUpdateUsername = () => {
  const queryClient = useQueryClient();

  const { mutateAsync } = useMutation({
    mutationFn: (username: string) => getSdk().user.updateUsername(username),
    onSuccess: (data) => {
      queryClient.setQueryData([UserCache.Key], data);
    },
  });

  return useCallback(
    (username: string) => mutateAsync(username),
    [mutateAsync],
  );
};

export const useAcceptTerms = () => {
  const queryClient = useQueryClient();

  const { mutateAsync } = useMutation({
    mutationFn: ({
      walletTerms,
      giftCardTerms,
    }: { walletTerms?: boolean; giftCardTerms?: boolean }) =>
      getSdk().user.acceptTerms({ walletTerms, giftCardTerms }),
    onSuccess: (data) => {
      queryClient.setQueryData([UserCache.Key], data);
    },
  });

  return mutateAsync;
};
