import { type UserResponse, fetchUser } from '@agicash/opensecret';
import type { QueryClient } from '@tanstack/query-core';
import { jwtDecode } from 'jwt-decode';

export type AuthUser = UserResponse['user'];

export type AuthState =
  | {
      isLoggedIn: true;
      user: AuthUser;
    }
  | {
      isLoggedIn: false;
      user?: undefined;
    };

/**
 * The auth state as observed by the host when the auth state query resolves.
 */
export type ResolvedAuthState =
  | {
      isLoggedIn: true;
      user: AuthUser;
      /** Unix timestamp (seconds) when the refresh token expires. */
      refreshTokenExpiresAt: number;
    }
  | {
      isLoggedIn: false;
      reason: 'no-tokens' | 'fetch-failed';
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

export const authStateQueryKey = 'auth-state';

// The localStorage reads in this module read the token keys the OpenSecret
// client writes; they switch to the OpenSecret StorageAdapter when the
// storage-pluggable bump lands (same tracked exception as the opensecret
// dependency itself).

const getJwt = (key: string): OpenSecretJwt | null => {
  const jwt = localStorage.getItem(key);
  if (!jwt) {
    return null;
  }
  return jwtDecode<OpenSecretJwt>(jwt);
};

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

/**
 * Check if the user is logged in by verifying localStorage tokens.
 */
export const isLoggedIn = (): boolean => {
  const accessToken = window.localStorage.getItem(accessTokenKey);
  const refreshToken = window.localStorage.getItem(refreshTokenKey);
  if (!accessToken || !refreshToken) {
    return false;
  }
  const decoded = jwtDecode(refreshToken);
  return !!decoded.exp && decoded.exp * 1000 > Date.now();
};

export type AuthApi = {
  /**
   * Query config for the auth session state (consume with useSuspenseQuery).
   * Resolving the query fetches the OpenSecret auth user when tokens are
   * present and reports the outcome through the host's auth hooks.
   */
  stateOptions: () => {
    queryKey: string[];
    queryFn: () => Promise<AuthState>;
    staleTime: number;
  };
  /**
   * The authenticated user's id from the resolved auth state. This is the
   * identity source the user domain derives from.
   * @throws if there is no authenticated session in the auth state.
   */
  getUserId: () => string;
  /**
   * Invalidates the auth state query. Call after any auth state change
   * (login, logout, email verification, ...).
   */
  invalidate: () => Promise<void>;
  /** Token-presence/expiry check without fetching the auth user. */
  isLoggedIn: () => boolean;
  /**
   * Milliseconds until the current refresh token expires (treated as expired
   * 5 seconds early), or null when there is no session.
   */
  getSessionExpiresInMs: () => number | null;
  /** Removes the session tokens from storage. */
  clearTokens: () => void;
};

export type AuthApiDeps = {
  queryClient: QueryClient;
  /**
   * Host hook invoked with the token's user id before the auth user fetch
   * (lets the host associate observability with the user as early as
   * possible).
   */
  onAuthUserIdDecoded?: (userId: string | undefined) => void;
  /** Host hook invoked when the auth state query resolves. */
  onAuthStateResolved?: (state: ResolvedAuthState) => void;
};

export function createAuthApi(deps: AuthApiDeps): AuthApi {
  const { queryClient, onAuthUserIdDecoded, onAuthStateResolved } = deps;

  return {
    stateOptions: () => ({
      queryKey: [authStateQueryKey],
      queryFn: async (): Promise<AuthState> => {
        const accessToken = window.localStorage.getItem(accessTokenKey);
        const refreshToken = window.localStorage.getItem(refreshTokenKey);
        if (!accessToken || !refreshToken) {
          onAuthStateResolved?.({ isLoggedIn: false, reason: 'no-tokens' });
          return { isLoggedIn: false } as const;
        }

        try {
          const { sub } = jwtDecode(accessToken);
          onAuthUserIdDecoded?.(sub);

          const response = await fetchUser();

          const { exp } = jwtDecode<OpenSecretJwt>(refreshToken);
          onAuthStateResolved?.({
            isLoggedIn: true,
            user: response.user,
            refreshTokenExpiresAt: exp,
          });

          return { isLoggedIn: true, user: response.user } as const;
        } catch (error) {
          console.error('Failed to fetch user', { cause: error });
          onAuthStateResolved?.({ isLoggedIn: false, reason: 'fetch-failed' });
          return { isLoggedIn: false } as const;
        }
      },
      staleTime: Number.POSITIVE_INFINITY,
    }),
    getUserId: () => {
      const state = queryClient.getQueryData<AuthState>([authStateQueryKey]);
      if (!state?.isLoggedIn) {
        throw new Error('No authenticated session. Log in first.');
      }
      return state.user.id;
    },
    invalidate: () =>
      queryClient.invalidateQueries({
        queryKey: [authStateQueryKey],
        refetchType: 'all',
      }),
    isLoggedIn,
    getSessionExpiresInMs: () =>
      getRemainingSessionTimeInMs(getJwt(refreshTokenKey)),
    clearTokens: () => {
      localStorage.removeItem(accessTokenKey);
      localStorage.removeItem(refreshTokenKey);
    },
  };
}
