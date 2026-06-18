// The web auth feature: React hooks and OAuth/guest login flows over the SDK
// auth domain (sdk.auth).
import {
  type AuthState,
  type AuthUser,
  authStateQueryKey,
} from '@agicash/wallet-sdk/auth';
import * as Sentry from '@sentry/react-router';
import { decodeURLSafe, encodeURLSafe } from '@stablelib/base64';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useRevalidator } from 'react-router';
import { getSdk } from '~/features/shared/sdk';
import { useLongTimeout } from '~/hooks/use-long-timeout';
import { generateRandomPassword } from '~/lib/password-generator';
import { guestAccountStorage } from './guest-account-storage';
import { oauthLoginSessionStorage } from './oauth-login-session-storage';
import { sessionHintCookie } from './session-hint-cookie';

export type { AuthState, AuthUser };

export const authQueryOptions = () => ({
  queryKey: [authStateQueryKey],
  queryFn: () => getSdk().auth.stateOptions().queryFn(),
  staleTime: Number.POSITIVE_INFINITY,
});

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
      await getSdk().auth.signUp(email, password);
      await refreshSession();
    },
    [refreshSession],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      await getSdk().auth.signIn(email, password);
      await refreshSession();
    },
    [refreshSession],
  );

  const signInGuest = useCallback(
    async (id: string, password: string) => {
      await getSdk().auth.signInGuest(id, password);
      await refreshSession();
    },
    [refreshSession],
  );

  const signOut = useCallback(
    async (options: SignOutOptions = {}) => {
      await getSdk().auth.signOut();
      await refreshSession(options.redirectTo);
      Sentry.setUser(null);
      queryClient.clear();
    },
    [refreshSession, queryClient],
  );

  const initiateGoogleAuth = useCallback(async () => {
    const { authUrl } = await getSdk().auth.initiateGoogleAuth();

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
    const existingGuestAccount = guestAccountStorage.get();
    if (existingGuestAccount) {
      return signInGuest(
        existingGuestAccount.id,
        existingGuestAccount.password,
      );
    }

    const password = await generateRandomPassword(32);
    const { id } = await getSdk().auth.signUpGuest(password);
    guestAccountStorage.store({ id, password });
    await refreshSession();
  }, [signInGuest, refreshSession]);

  const requestPasswordReset = useCallback(async (email: string) => {
    const secret = await generateRandomPassword(20);
    await getSdk().auth.requestPasswordReset(email, secret);
    return { email, secret };
  }, []);

  const verifyEmail = useCallback(
    async (code: string) => {
      await getSdk().auth.verifyEmail(code);
      await refreshSession();
    },
    [refreshSession],
  );

  const convertGuestToFullAccount = useCallback(
    async (email: string, password: string) => {
      await getSdk().auth.convertGuestToFullAccount(email, password);
      await refreshSession();
    },
    [refreshSession],
  );

  const confirmPasswordReset = useCallback(
    (
      email: string,
      alphanumericCode: string,
      plaintextSecret: string,
      newPassword: string,
    ) =>
      getSdk().auth.confirmPasswordReset(
        email,
        alphanumericCode,
        plaintextSecret,
        newPassword,
      ),
    [],
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

type HandleSessionExpiryProps = {
  isGuestAccount: boolean;
  onLogout: () => void;
};

export const useHandleSessionExpiry = ({
  isGuestAccount,
  onLogout,
}: HandleSessionExpiryProps) => {
  const { signUpGuest: extendGuestSession, signOut } = useAuthActions();
  const [remainingSessionTime, setRemainingSessionTime] = useState<
    number | null
  >(null);

  // getSessionExpiresInMs is async (the SDK reads the refresh token through the
  // host's storage provider), so resolve it into state. Read on mount and again
  // right after a guest extension so the timeout re-arms with the new expiry —
  // the expiry isn't in the reactive auth state, so we re-read explicitly.
  const refreshRemainingSessionTime = useCallback(async () => {
    setRemainingSessionTime(await getSdk().auth.getSessionExpiresInMs());
  }, []);

  useEffect(() => {
    refreshRemainingSessionTime();
  }, [refreshRemainingSessionTime]);

  const handleSessionExpiry = async () => {
    try {
      if (isGuestAccount) {
        await extendGuestSession();
        await refreshRemainingSessionTime();
      } else {
        onLogout();
        // Open secret is already handling potential errors in signOut method and removes the keys from the storage so
        // in that case our catch should never be triggered, which is fine. We are leaving it there for the guest use
        // case and just in case.
        await signOut();
      }
    } catch (e) {
      console.error('Failed to handle session expiry', { cause: e });
      await getSdk().auth.clearTokens();
      sessionHintCookie.clear();
      window.location.reload();
    }
  };

  useLongTimeout(handleSessionExpiry, remainingSessionTime);
};
