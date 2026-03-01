import {
  type UserResponse,
  fetchUser,
  confirmPasswordReset as osConfirmPasswordReset,
  convertGuestToUserAccount as osConvertGuestToFullAccount,
  initiateGoogleAuth as osInitiateGoogleAuth,
  requestPasswordReset as osRequestPasswordReset,
  signIn as osSignIn,
  signInGuest as osSignInGuest,
  signOut as osSignOut,
  signUp as osSignUp,
  signUpGuest as osSignUpGuest,
  verifyEmail as osVerifyEmail,
} from '@agicash/opensecret';
import { decodeURLSafe, encodeURLSafe } from '@stablelib/base64';
import {
  queryOptions,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { jwtDecode } from 'jwt-decode';
import { useCallback, useState } from 'react';
import { useNavigate, useRevalidator } from 'react-router';
import { getQueryClient } from '~/features/shared/query-client';
import { useLongTimeout } from '~/hooks/use-long-timeout';
import { generateRandomPassword } from '~/lib/password-generator';
import { computeSHA256 } from '~/lib/sha256';
import { guestAccountStorage } from './guest-account-storage';
import { oauthLoginSessionStorage } from './oauth-login-session-storage';

export type AuthUser = UserResponse['user'];

type AuthState =
  | {
      isLoggedIn: true;
      user: AuthUser;
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
      const access_token = window.localStorage.getItem('access_token');
      const refresh_token = window.localStorage.getItem('refresh_token');
      if (!access_token || !refresh_token) {
        return { isLoggedIn: false } as const;
      }

      try {
        const response = await fetchUser();
        return { isLoggedIn: true, user: response.user } as const;
      } catch (error) {
        console.error('Failed to fetch user', { cause: error });
        return { isLoggedIn: false } as const;
      }
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
  const queryClient = useQueryClient();
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
      await osSignUp(email, password, '');
      await refreshSession();
    },
    [refreshSession],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      await osSignIn(email, password);
      await refreshSession();
    },
    [refreshSession],
  );

  const signInGuest = useCallback(
    async (id: string, password: string) => {
      await osSignInGuest(id, password);
      await refreshSession();
    },
    [refreshSession],
  );

  const signOut = useCallback(
    async (options: SignOutOptions = {}) => {
      await osSignOut();
      await refreshSession(options.redirectTo);
      queryClient.clear();
    },
    [refreshSession, queryClient],
  );

  const initiateGoogleAuth = useCallback(async () => {
    const response = await osInitiateGoogleAuth('');

    const authLocation = new URL(response.auth_url);
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
    const existingGuestAccount = guestAccountStorage.get();
    if (existingGuestAccount) {
      return signInGuest(
        existingGuestAccount.id,
        existingGuestAccount.password,
      );
    }

    const createGuestAccount = async () => {
      const password = await generateRandomPassword(32);
      const guestAccount = await osSignUpGuest(password, '');
      guestAccountStorage.store({ id: guestAccount.id, password });
      await refreshSession();
    };

    await createGuestAccount();
  }, [signInGuest, refreshSession]);

  const requestPasswordReset = useCallback(async (email: string) => {
    const secret = await generateRandomPassword(20);
    const hash = await computeSHA256(secret);
    await osRequestPasswordReset(email, hash);
    return { email, secret };
  }, []);

  const verifyEmail = useCallback(
    async (code: string) => {
      await osVerifyEmail(code);
      await refreshSession();
    },
    [refreshSession],
  );

  const convertGuestToFullAccount = useCallback(
    async (email: string, password: string) => {
      await osConvertGuestToFullAccount(email, password);
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
    confirmPasswordReset: osConfirmPasswordReset,
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
