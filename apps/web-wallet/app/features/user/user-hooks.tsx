import { requestNewVerificationCode } from '@agicash/opensecret';
import { UserCache } from '@agicash/wallet-sdk';
import { useMutation, useSuspenseQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { getSdk } from '~/features/shared/sdk';
import { useAuthActions, useAuthState } from '~/features/user/auth';
import type { Currency } from '~/lib/money';
import { useLatest } from '~/lib/use-latest';
import type { Account } from '../accounts/account';
import { guestAccountStorage } from './guest-account-storage';
import type { UpdateUser, User } from './user';

export { UserCache };

/**
 * Hook that provides the user cache.
 *
 * Transitional (sdk.user.internal): only for the not-yet-migrated
 * receive/wallet domain code and the web-owned realtime infrastructure.
 * App/UI code must use the curated sdk.user methods.
 * @returns The user cache.
 */
export function useUserCache() {
  return getSdk().user.internal.cache;
}

/**
 * Hook that returns the user change handlers.
 *
 * Transitional (sdk.user.internal): consumed by the web-owned realtime
 * wiring until the realtime hub moves into the SDK.
 */
export function useUserChangeHandlers() {
  return getSdk().user.internal.changeHandlers;
}

/**
 * The cached user for contexts where a missing user is a bug (routes under
 * the protected layout, whose middleware guarantees the user is loaded).
 * The throw is web policy — the SDK only exposes `user.getCached(): User | null`.
 * @throws if the user is not loaded yet.
 */
export const getUserFromCacheOrThrow = (): User => {
  const user = getSdk().user.getCached();
  if (!user) {
    throw new Error('User not found');
  }
  return user;
};

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

  const { data } = useSuspenseQuery({
    ...getSdk().user.queryOptions(),
    select,
  });

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
  return useMutation({
    mutationFn: (updates: UpdateUser) => getSdk().user.update(updates),
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
  const { mutateAsync } = useMutation({
    mutationFn: (account: Account) => getSdk().user.setDefaultAccount(account),
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
