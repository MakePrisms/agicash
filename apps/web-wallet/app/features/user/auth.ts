import * as Sentry from '@sentry/react-router';
import { decodeURLSafe, encodeURLSafe } from '@stablelib/base64';
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { jwtDecode } from 'jwt-decode';
import { useCallback, useState } from 'react';
import { useNavigate, useRevalidator } from 'react-router';
import { getQueryClient } from '~/features/shared/query-client';
import { getSdk } from '~/features/shared/sdk';
import { useLongTimeout } from '~/hooks/use-long-timeout';
import { oauthLoginSessionStorage } from './oauth-login-session-storage';
import {
  pendingGiftCardMintTermsStorage,
  pendingWalletTermsStorage,
} from './pending-terms-storage';
import { sessionHintCookie } from './session-hint-cookie';
import type { User } from './user';

const getClientSdk = () => getSdk(new URL(window.location.origin).host);

export type AuthUser = User;

type AuthState =
  | {
      isLoggedIn: true;
      user: User;
    }
  | {
      isLoggedIn: false;
      user?: undefined;
    };

export const authStateQueryKey = 'auth-state';

export const authQueryOptions = () =>
  queryOptions({
    queryKey: [authStateQueryKey],
    queryFn: async () => {
      const sdk = await getSdk(new URL(window.location.origin).host);
      const user = await sdk.user.getCurrentUser();
      if (!user) {
        sessionHintCookie.clear();
        Sentry.setUser(null);
        return { isLoggedIn: false } as const;
      }
      Sentry.setUser({ id: user.id, isGuest: user.isGuest });
      const refreshToken = window.localStorage.getItem('refresh_token');
      if (refreshToken) {
        const { exp } = jwtDecode<OpenSecretJwt>(refreshToken);
        sessionHintCookie.set(exp - Math.floor(Date.now() / 1000));
      }
      return { isLoggedIn: true, user } as const;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });

/**
 * Invalidates all queries that depend on the current auth session.
 * Call after any auth state change (login, logout, email verification, etc.)
 */
export const invalidateAuthQueries = async () => {
  const queryClient = getQueryClient();
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: [authStateQueryKey],
      refetchType: 'all',
    }),
    queryClient.invalidateQueries({
      queryKey: ['feature-flags'],
      refetchType: 'all',
    }),
  ]);
};

export const useAuthState = (): AuthState => {
  const { data } = useSuspenseQuery(authQueryOptions());
  return data;
};

type SignOutOptions = {
  /**
   * The URL to redirect to after signing out. If not provided, the user will be redirected to the singup page by the protected layout.
   */
  redirectTo?: string;
};

type AuthActions = {
  /**
   * Creates a new full user account. Automatically signs in the user after sign up.
   * @param email
   * @param password
   */
  signUp: (email: string, password: string) => Promise<void>;

  /**
   * Creates a new guest user account.  If the user has already signed up as a guest on the same device before, the sign
   * in to that account will be performed instead. Automatically signs in the user after sign up.
   */
  signUpGuest: () => Promise<void>;

  /**
   * Signs in the existing user
   * @param email
   * @param password
   */
  signIn: (email: string, password: string) => Promise<void>;

  /**
   * Signs out the current user
   * @param options Options for the sign out
   */
  signOut: (options?: SignOutOptions) => Promise<void>;

  /**
   * Requests a password reset for the account
   * @param email
   */
  requestPasswordReset: (
    email: string,
  ) => Promise<{ email: string; secret: string }>;

  /**
   * Confirms a password reset
   * @param email Email address for which the reset is performed Code that was sent to the email provided to `requestPasswordReset`
   * @param alphanumericCode Password reset code that was sent to the email address sent to `requestPasswordReset`
   * @param plaintextSecret Secret that was returned by `requestPasswordReset`
   * @param newPassword New password to set for the account
   */
  confirmPasswordReset: (
    email: string,
    alphanumericCode: string,
    plaintextSecret: string,
    newPassword: string,
  ) => Promise<void>;

  /**
   * Initiates a Google authentication flow
   * Returns the auth URL to redirect the user to
   */
  initiateGoogleAuth: () => Promise<{
    /**
     * The auth URL to redirect the user to to perform the Google authentication flow
     */
    authUrl: string;
  }>;

  /**
   * Verifies the email address
   * @param code The code from the email verification
   */
  verifyEmail: (code: string) => Promise<void>;

  /**
   * Converts a guest account to a full account
   * @param email The email address of the user
   * @param password The password of the user
   */
  convertGuestToFullAccount: (email: string, password: string) => Promise<void>;
};

/**
 * A hook that provides authentication actions by wrapping functionalities from the OpenSecret SDK.
 * The actions include user signing up, signing in, signing out, and handling password reset requests.
 * References for these actions are memoized to ensure consistent references across renders,
 * improving performance and preventing unnecessary re-renders or function evaluations.
 *
 * @returns {AuthActions}
 */
export const useAuthActions = (): AuthActions => {
  const { revalidate } = useRevalidator();
  const navigate = useNavigate();

  const refreshSession = useCallback(
    async (redirectTo?: string) => {
      await invalidateAuthQueries();
      if (redirectTo) {
        await navigate(redirectTo);
      } else {
        await revalidate();
      }
    },
    [navigate, revalidate],
  );

  const signUp = useCallback(
    async (email: string, password: string) => {
      const sdk = await getClientSdk();
      await sdk.auth.signUp({
        email,
        password,
        termsAcceptedAt: pendingWalletTermsStorage.get(),
        giftCardMintTermsAcceptedAt: pendingGiftCardMintTermsStorage.get(),
      });
      pendingWalletTermsStorage.remove();
      pendingGiftCardMintTermsStorage.remove();
      await refreshSession();
    },
    [refreshSession],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const sdk = await getClientSdk();
      await sdk.auth.signIn({ email, password });
      await refreshSession();
    },
    [refreshSession],
  );

  const signOut = useCallback(
    async (options: SignOutOptions = {}) => {
      const sdk = await getClientSdk();
      await sdk.auth.signOut();
      await refreshSession(options.redirectTo);
    },
    [refreshSession],
  );

  const initiateGoogleAuth = useCallback(async () => {
    const sdk = await getClientSdk();
    const { authUrl } = await sdk.auth.beginGoogleSignIn();

    const authLocation = new URL(authUrl);
    const stateParam = authLocation.searchParams.get('state');
    const state = stateParam
      ? JSON.parse(new TextDecoder().decode(decodeURLSafe(stateParam)))
      : {};

    const oauthLoginSession = oauthLoginSessionStorage.create({
      search: location.search,
      hash: location.hash,
    });
    state.sessionId = oauthLoginSession.sessionId;

    const stateEncoded = encodeURLSafe(
      new TextEncoder().encode(JSON.stringify(state)),
    );
    authLocation.searchParams.set('state', stateEncoded);

    return { authUrl: authLocation.href };
  }, []);

  const signUpGuest = useCallback(async () => {
    const sdk = await getClientSdk();
    await sdk.auth.signInGuest({
      termsAcceptedAt: pendingWalletTermsStorage.get(),
      giftCardMintTermsAcceptedAt: pendingGiftCardMintTermsStorage.get(),
    });
    pendingWalletTermsStorage.remove();
    pendingGiftCardMintTermsStorage.remove();
    await refreshSession();
  }, [refreshSession]);

  const requestPasswordReset = useCallback(async (email: string) => {
    const sdk = await getClientSdk();
    const { secret } = await sdk.auth.resetPassword(email);
    return { email, secret };
  }, []);

  const confirmPasswordReset = useCallback(
    async (
      email: string,
      alphanumericCode: string,
      plaintextSecret: string,
      newPassword: string,
    ) => {
      const sdk = await getClientSdk();
      await sdk.auth.confirmPasswordReset({
        email,
        code: alphanumericCode,
        secret: plaintextSecret,
        newPassword,
      });
    },
    [],
  );

  const verifyEmail = useCallback(
    async (code: string) => {
      const sdk = await getClientSdk();
      await sdk.auth.verifyEmail(code);
      await refreshSession();
    },
    [refreshSession],
  );

  const convertGuestToFullAccount = useCallback(
    async (email: string, password: string) => {
      const sdk = await getClientSdk();
      await sdk.auth.upgradeGuest({ email, password });
      await refreshSession();
    },
    [refreshSession],
  );

  return {
    signUp,
    signUpGuest,
    signIn,
    signOut,
    requestPasswordReset,
    confirmPasswordReset,
    initiateGoogleAuth,
    verifyEmail,
    convertGuestToFullAccount,
  };
};

export const useSignOut = () => {
  const { signOut } = useAuthActions();
  const [loading, setLoading] = useState(false);

  const handleSignOut = async () => {
    setLoading(true);
    await signOut({ redirectTo: '/home' });
    setLoading(false);
  };
  return { isSigningOut: loading, signOut: handleSignOut };
};

type OpenSecretJwt = {
  /**
   * Token expiration time. It's a unix timestamp in seconds
   */
  exp: number;

  /**
   * Time when the token was issues. It's a unix timestamp in seconds
   */
  iat: number;

  /**
   * ID of the logged-in user
   */
  sub: string;

  /**
   * Audience
   */
  aud: 'access' | 'refresh';
};

const accessTokenKey = 'access_token';
const refreshTokenKey = 'refresh_token';

const getJwt = (key: string): OpenSecretJwt | null => {
  const jwt = localStorage.getItem(key);
  if (!jwt) {
    return null;
  }
  return jwtDecode<OpenSecretJwt>(jwt);
};

const removeKeys = () => {
  localStorage.removeItem(accessTokenKey);
  localStorage.removeItem(refreshTokenKey);
  sessionHintCookie.clear();
};

const getRefreshToken = () => getJwt(refreshTokenKey);

const getRemainingSessionTimeInMs = (
  token: OpenSecretJwt | null,
): number | null => {
  if (!token) {
    return null;
  }
  // We are treating the session as expired 5 seconds before the actual expiry just in case
  const fiveSecondsBeforeExpiry = token.exp - 5;
  const fiveSecondsBeforeExpiryInMs = fiveSecondsBeforeExpiry * 1000;
  const remainingTime = fiveSecondsBeforeExpiryInMs - Date.now();
  return Math.max(remainingTime, 0);
};

type HandleSessionExpiryProps = {
  isGuestAccount: boolean;
  onLogout: () => void;
};

export const useHandleSessionExpiry = ({
  isGuestAccount,
  onLogout,
}: HandleSessionExpiryProps) => {
  const { signUpGuest: extendGuestSession, signOut } = useAuthActions();
  const refreshToken = getRefreshToken();
  const remainingSessionTime = getRemainingSessionTimeInMs(refreshToken);

  const handleSessionExpiry = async () => {
    try {
      if (isGuestAccount) {
        // Extend guest session will get new extended access and refresh token from Open Secret. The OS code can be seen
        // here https://github.com/OpenSecretCloud/OpenSecret-SDK/blob/master/src/lib/main.tsx#L441. Because setState is
        // called after this method is executed the new render will be triggered and useHandleSessionExpiry will be
        // executed again which will result in new session expiry timeout being set.
        await extendGuestSession();
      } else {
        onLogout();
        // Open secret is already handling potential errors in signOut method and removes the keys from the storage so
        // in that case our catch should never be triggered, which is fine. We are leaving it there for the guest use
        // case and just in case.
        await signOut();
      }
    } catch (e) {
      console.error('Failed to handle session expiry', { cause: e });
      removeKeys();
      window.location.reload();
    }
  };

  useLongTimeout(handleSessionExpiry, remainingSessionTime);
};
