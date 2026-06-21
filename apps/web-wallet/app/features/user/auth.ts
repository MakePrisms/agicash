import { type UserResponse, fetchUser } from '@agicash/opensecret';
import * as Sentry from '@sentry/react-router';
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
import { disposeSdk, initSdk } from '~/lib/sdk';
import { oauthLoginSessionStorage } from './oauth-login-session-storage';
import { sessionHintCookie } from './session-hint-cookie';

export type AuthUser = UserResponse['user'];

/**
 * Resolve the SDK for an auth action. Auth actions run on both `_auth`
 * (login/signup) and `_protected` routes; only `_protected` kicks off `initSdk`,
 * and `signOut` disposes the singleton. `initSdk` is idempotent and re-creatable
 * after disposal, so awaiting it here guarantees a live instance regardless of
 * route or prior sign-out. The host matches the source `_protected` uses for
 * `domain` (read at call time, never at module top level, so SSR never touches
 * `window`).
 */
const getAuthSdk = () => initSdk(location.host);

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
        sessionHintCookie.clear();
        return { isLoggedIn: false } as const;
      }

      try {
        // We want to set Sentry user id here to make sure that Sentry events are associated with the user as soon as possible.
        const { sub } = jwtDecode(access_token);
        Sentry.setUser({ id: sub });

        const response = await fetchUser();

        // Set Sentry user again to include the isGuest flag
        Sentry.setUser({ id: response.user.id, isGuest: !response.user.email });

        // Mirror auth state into a hint cookie so the server can short-circuit
        // SSR for unauthenticated visits. Lifetime matches the refresh token
        // so we don't leave a stale "logged in" hint after the session
        // genuinely expires.
        const { exp } = jwtDecode<OpenSecretJwt>(refresh_token);
        sessionHintCookie.set(exp - Math.floor(Date.now() / 1000));

        return { isLoggedIn: true, user: response.user } as const;
      } catch (error) {
        console.error('Failed to fetch user', { cause: error });
        Sentry.setUser(null);
        sessionHintCookie.clear();
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
      const sdk = await getAuthSdk();
      await sdk.auth.signUp({ email, password });
      await refreshSession();
    },
    [refreshSession],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const sdk = await getAuthSdk();
      await sdk.auth.signIn({ email, password });
      await refreshSession();
    },
    [refreshSession],
  );

  const signOut = useCallback(
    async (options: SignOutOptions = {}) => {
      const sdk = await getAuthSdk();
      await sdk.auth.signOut();
      // Dispose AFTER signOut so the auth domain (which owns the session-expiry
      // timer + enclave teardown) runs its sign-out path on a live instance.
      await disposeSdk();
      await refreshSession(options.redirectTo);
      Sentry.setUser(null);
      queryClient.clear();
    },
    [refreshSession, queryClient],
  );

  const initiateGoogleAuth = useCallback(async () => {
    const sdk = await getAuthSdk();
    const { authUrl } = await sdk.auth.beginGoogle();

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
    const sdk = await getAuthSdk();
    await sdk.auth.signInGuest();
    await refreshSession();
  }, [refreshSession]);

  const requestPasswordReset = useCallback(async (email: string) => {
    const sdk = await getAuthSdk();
    return sdk.auth.requestPasswordReset({ email });
  }, []);

  const confirmPasswordReset = useCallback(
    async (
      email: string,
      alphanumericCode: string,
      plaintextSecret: string,
      newPassword: string,
    ) => {
      const sdk = await getAuthSdk();
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
      const sdk = await getAuthSdk();
      await sdk.auth.verifyEmail({ code });
      await refreshSession();
    },
    [refreshSession],
  );

  const convertGuestToFullAccount = useCallback(
    async (email: string, password: string) => {
      const sdk = await getAuthSdk();
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
