import type { Currency } from '@agicash/lib';
import { requestNewVerificationCode } from '@agicash/opensecret';
import { useSdk } from '@agicash/react-wallet-sdk';
import { useQ } from '@agicash/react-wallet-sdk';
import { useMutation } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useAuthActions } from '~/features/user/auth';
import { useLatest } from '~/lib/use-latest';
import type { Account } from '../accounts/account';
import { guestAccountStorage } from './guest-account-storage';
import type { User } from './user';
import { type UpdateUser, useWriteUserRepository } from './user-repository';

// ---- useUser ----

/**
 * Returns the logged-in user data. Suspends while loading.
 * Optionally applies a selector to transform or select a part of the user.
 * @throws Error if there is no authenticated user.
 */
export function useUser(): User;
export function useUser<TData>(select: (data: User) => TData): TData;
export function useUser<TData = User>(select?: (data: User) => TData): TData {
  const sdk = useSdk();
  const sdkUser = useQ(sdk.user.getCurrentUser());

  if (!sdkUser) {
    throw new Error('Cannot use useUser hook in anonymous context');
  }

  // Cast from SDK's User to the web's User — structurally identical types.
  const user = sdkUser as unknown as User;

  if (select) {
    return select(user);
  }
  return user as unknown as TData;
}

export const useUserRef = () => {
  const user = useUser();
  return useLatest(user);
};

// ---- useUpdateUser (internal) ----

const useUpdateUser = () => {
  const sdk = useSdk();
  const userId = useUser((user) => user.id);
  const userRepository = useWriteUserRepository();

  return useMutation({
    mutationFn: (updates: UpdateUser) => userRepository.update(userId, updates),
    onSuccess: () => {
      // Refresh the SDK's reactive user read so subscribers see the updated user.
      void sdk.user.getCurrentUser().refetch();
    },
  });
};

// ---- useSetDefaultCurrency ----

export const useSetDefaultCurrency = () => {
  const { mutateAsync: updateUser } = useUpdateUser();

  return useCallback(
    (currency: Currency) => updateUser({ defaultCurrency: currency }),
    [updateUser],
  );
};

// ---- useSetDefaultAccount ----

export const useSetDefaultAccount = () => {
  const sdk = useSdk();

  return useCallback(
    // biome-ignore lint/suspicious/noExplicitAny: web Account and SDK Account are structurally equivalent at runtime
    (account: Account) => sdk.accounts.setDefault(account as any),
    [sdk],
  );
};

// ---- useUpdateUsername ----

export const useUpdateUsername = () => {
  const sdk = useSdk();

  return useCallback(
    (username: string) => sdk.user.updateUsername(username),
    [sdk],
  );
};

// ---- useAcceptTerms ----

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

// ---- useUpgradeGuestToFullAccount ----

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

// ---- useRequestNewEmailVerificationCode ----

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

// ---- useVerifyEmail ----

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

// ---- defaultAccounts (kept for _protected.tsx upsert flow) ----

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
