import type { Currency } from '@agicash/money';
import { useMutation } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useAuthActions } from '~/features/user/auth';
import { getSdk } from '~/lib/sdk';
import { useStoreSelect } from '~/lib/store-hooks';
import { useLatest } from '~/lib/use-latest';
import type { Account } from '../accounts/account';
import type { User } from './user';

/**
 * Reads the current user from the `sdk.user.current` store, throwing when the
 * store value is null. The store is `User | null` (null when signed out), but
 * every consumer of these readers runs under `<Wallet>` where the user is
 * always present — matching the base behavior of throwing in an anonymous
 * context.
 */
const requireUser = (user: User | null): User => {
  if (!user) {
    throw new Error('Cannot use useUser hook in anonymous context');
  }
  return user;
};

export const getUserFromCache = (): User | null =>
  getSdk().user.current.get() ?? null;

export const getUserFromCacheOrThrow = (): User => {
  const user = getUserFromCache();
  if (!user) {
    throw new Error('User not found');
  }
  return user;
};

/**
 * This hook returns the logged in user data.
 * @param select - This option can be used to transform or select a part of the data returned by the store. If not provided, the user data will be returned as is.
 * @returns The selected user data.
 */
export const useUser = <TData = User>(select?: (data: User) => TData): TData =>
  useStoreSelect(getSdk().user.current, (user) =>
    select ? select(requireUser(user)) : (requireUser(user) as TData),
  );

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

export const useSetDefaultCurrency = () =>
  useCallback(
    (currency: Currency) => getSdk().user.setDefaultCurrency(currency),
    [],
  );

export const useSetDefaultAccount = () =>
  useCallback(
    (account: Account) => getSdk().user.setDefaultAccount({ account }),
    [],
  );

export const useUpdateUsername = () =>
  useCallback((username: string) => getSdk().user.updateUsername(username), []);

export const useAcceptTerms = () =>
  useCallback(
    (params: { walletTerms?: boolean; giftCardTerms?: boolean }) =>
      getSdk().user.acceptTerms(params),
    [],
  );
