import type { AuthUser } from '@agicash/wallet-sdk';
import * as Sentry from '@sentry/react-router';
import { decodeURLSafe, encodeURLSafe } from '@stablelib/base64';
import {
  queryOptions,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { jwtDecode } from 'jwt-decode';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useRevalidator } from 'react-router';
import {
  loadFeatureFlags,
  resetFeatureFlags,
} from '~/features/shared/feature-flags';
import { getQueryClient } from '~/features/shared/query-client';
import { sdk } from '~/features/shared/sdk.client';
import { useLatest } from '~/lib/use-latest';
import { oauthLoginSessionStorage } from './oauth-login-session-storage';
import { sessionHintCookie } from './session-hint-cookie';

export type { AuthUser };

type AuthState =
  | {
      isLoggedIn: true;
      user: AuthUser;
      /** Unix seconds, captured at fetch time; drives the hint-cookie lifetime and query staleness. */
      refreshTokenExpiresAt: number | null;
    }
  | {
      isLoggedIn: false;
      user?: undefined;
    };

export const authStateQueryKey = 'auth-state';

// A corrupt stored token must degrade to "no value", never throw from a query
// fn or staleTime callback (that would error-page every route, /login included).
const safeJwtDecode = (
  token: string,
): { exp?: number; sub?: string } | null => {
  try {
    return jwtDecode(token);
  } catch {
    return null;
  }
};

const getRefreshTokenExpiry = (): number | null => {
  const refreshToken = window.localStorage.getItem('refresh_token');
  if (!refreshToken) {
    return null;
  }
  return safeJwtDecode(refreshToken)?.exp ?? null;
};

export const authQueryOptions = () =>
  queryOptions({
    queryKey: [authStateQueryKey],
    queryFn: async (): Promise<AuthState> => {
      // Associate Sentry events with the user as early as possible, before
      // session restore completes.
      const accessToken = window.localStorage.getItem('access_token');
      const sub = accessToken ? safeJwtDecode(accessToken)?.sub : undefined;
      if (sub) {
        Sentry.setUser({ id: sub });
      }

      try {
        await sdk.init();
      } catch (error) {
        // Restore failed with tokens present (e.g. a network blip at boot).
        // Boot anonymous; init()'s rejection is not memoized, so a later
        // invalidateAuthQueries() retries the restore.
        console.error('Failed to restore session', { cause: error });
        Sentry.setUser(null);
        sessionHintCookie.clear();
        return { isLoggedIn: false };
      }
      const session = sdk.auth.getSession();

      if (!session.isLoggedIn) {
        Sentry.setUser(null);
        sessionHintCookie.clear();
        return { isLoggedIn: false };
      }

      Sentry.setUser({ id: session.user.id, isGuest: !session.user.email });

      // Mirror auth state into a hint cookie so the server can short-circuit
      // SSR for unauthenticated visits. Lifetime matches the refresh token
      // so we don't leave a stale "logged in" hint after the session
      // genuinely expires.
      const exp = getRefreshTokenExpiry();
      if (exp) {
        sessionHintCookie.set(exp - Math.floor(Date.now() / 1000));
      }

      return { ...session, refreshTokenExpiresAt: exp };
    },
    // Logged-in state is fresh until the refresh token expires; a refetch
    // after that point re-reads the (SDK-extended or ended) session and
    // re-syncs the hint cookie. Anonymous state only changes through explicit
    // invalidation. Staleness is pinned to the expiry captured AT FETCH TIME
    // (not re-read from storage), so an SDK-internal guest extension can't
    // slide freshness forward and postpone the cookie re-sync forever.
    staleTime: ({ state: { data, dataUpdatedAt } }) => {
      if (!data?.isLoggedIn) {
        return Number.POSITIVE_INFINITY;
      }
      if (!data.refreshTokenExpiresAt) {
        return 0;
      }
      return Math.max(
        (data.refreshTokenExpiresAt - 5) * 1000 - dataUpdatedAt,
        0,
      );
    },
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
    loadFeatureFlags(),
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
  signUp: (email: string, password: string) => Promise<void>;
  signUpGuest: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: (options?: SignOutOptions) => Promise<void>;
  initiateGoogleAuth: () => Promise<{ authUrl: string }>;
  verifyEmail: (code: string) => Promise<void>;
  convertGuestToFullAccount: (email: string, password: string) => Promise<void>;
};

/**
 * Authentication actions backed by the wallet SDK, wrapped with the web
 * concerns the SDK doesn't own: query invalidation, navigation, Sentry user
 * tracking, and the OAuth deep-link session.
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
      await sdk.auth.signUp(email, password);
      await refreshSession();
    },
    [refreshSession],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      await sdk.auth.signIn(email, password);
      await refreshSession();
    },
    [refreshSession],
  );

  const signUpGuest = useCallback(async () => {
    await sdk.auth.signUpGuest();
    await refreshSession();
  }, [refreshSession]);

  const signOut = useCallback(
    async (options: SignOutOptions = {}) => {
      await sdk.auth.signOut();
      // Before the refresh below so the previous user's flags are gone even if
      // the anon re-fetch fails, and so its result isn't clobbered afterwards.
      resetFeatureFlags();
      await refreshSession(options.redirectTo);
      Sentry.setUser(null);
      queryClient.clear();
    },
    [refreshSession, queryClient],
  );

  const initiateGoogleAuth = useCallback(async () => {
    const { authUrl } = await sdk.auth.initiateGoogleAuth();

    // Stash the current location under a session id and thread it through the
    // OAuth state param, so the callback route can restore the deep link.
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

  const verifyEmail = useCallback(
    async (code: string) => {
      await sdk.auth.verifyEmail(code);
      await refreshSession();
    },
    [refreshSession],
  );

  const convertGuestToFullAccount = useCallback(
    async (email: string, password: string) => {
      await sdk.auth.convertGuestToFullAccount(email, password);
      await refreshSession();
    },
    [refreshSession],
  );

  return {
    signUp,
    signUpGuest,
    signIn,
    signOut,
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

/**
 * Reacts to SDK-initiated session transitions the host didn't trigger.
 * Expiry (refresh-token death with failed/impossible extension): notifies the
 * user and resets the web session state. Refresh (guest auto-extension):
 * re-runs the auth query so the session-hint cookie picks up the new expiry,
 * matching master's extend-through-invalidation behavior.
 */
export const useHandleSessionEvents = (onSessionExpired: () => void) => {
  const queryClient = useQueryClient();
  const { revalidate } = useRevalidator();
  const onSessionExpiredRef = useLatest(onSessionExpired);

  useEffect(() => {
    const handleSessionExpired = () => {
      void (async () => {
        onSessionExpiredRef.current();
        resetFeatureFlags();
        await invalidateAuthQueries();
        await revalidate();
        Sentry.setUser(null);
        queryClient.clear();
      })().catch((error) => {
        // Hard fallback: the SDK already ended the session, so a reload
        // boots anonymous even when the soft reset above fails mid-flight.
        console.error('Failed to handle session expiry', { cause: error });
        window.location.reload();
      });
    };

    const unsubscribeExpired = sdk.events.on(
      'auth.session-expired',
      handleSessionExpired,
    );
    const unsubscribeRefreshed = sdk.events.on('auth.session-refreshed', () => {
      void invalidateAuthQueries();
    });

    // The SDK arms its expiry timer during init(), before this subscription
    // exists; an expiry firing in that window emitted to no subscribers.
    // This hook mounts only under an authenticated layout, so an already-dead
    // SDK session here means exactly that missed event — handle it now.
    if (!sdk.auth.getSession().isLoggedIn) {
      handleSessionExpired();
    }

    return () => {
      unsubscribeExpired();
      unsubscribeRefreshed();
    };
  }, [queryClient, revalidate]);
};
