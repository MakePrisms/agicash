import {
  type UserResponse,
  fetchUser,
  getConfig,
  confirmPasswordReset as osConfirmPasswordReset,
  convertGuestToUserAccount as osConvertGuestToUserAccount,
  handleGoogleCallback as osHandleGoogleCallback,
  initiateGoogleAuth as osInitiateGoogleAuth,
  requestNewVerificationCode as osRequestNewVerificationCode,
  requestPasswordReset as osRequestPasswordReset,
  signIn as osSignIn,
  signInGuest as osSignInGuest,
  signOut as osSignOut,
  signUp as osSignUp,
  signUpGuest as osSignUpGuest,
  verifyEmail as osVerifyEmail,
} from '@agicash/opensecret';
import { safeJsonParse } from '@agicash/utils/json';
import { generateRandomPassword } from '@agicash/utils/password';
import { computeSHA256 } from '@agicash/utils/sha256';
import {
  type LongTimeout,
  clearLongTimeout,
  setLongTimeout,
} from '@agicash/utils/timeout';
import type { QueryClient } from '@tanstack/query-core';
import { jwtDecode } from 'jwt-decode';
import { z } from 'zod/mini';

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

/**
 * Host side-effects for the session-expiry watcher. The SDK owns the mechanics
 * (timer, guest-session resume, token clearing); the host supplies the UI and
 * navigation reactions.
 */
export type SessionExpiryHandlers = {
  /**
   * A full account's session expired and cannot be silently extended — the
   * host signs the user out and navigates. (Guest sessions are resumed
   * automatically and never reach this.)
   */
  onExpire?: () => void | Promise<void>;
  /**
   * Recovery side-effects after the SDK clears the tokens on an unrecoverable
   * error (the web clears its SSR session-hint cookie and reloads).
   */
  onRecover?: () => void | Promise<void>;
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

const readPersistentToken = async (key: string): Promise<string | null> => {
  return getConfig().storage.persistent.getItem(key);
};

const getJwt = async (key: string): Promise<OpenSecretJwt | null> => {
  const jwt = await readPersistentToken(key);
  if (!jwt) {
    return null;
  }
  return jwtDecode<OpenSecretJwt>(jwt);
};

// Guest accounts persist their recovery credentials (id + password) in the
// host's persistent storage so the session can be resumed/extended later. Same
// 'guestAccount' key and shape the web used before this moved into the SDK, so
// existing guest sessions carry over.
const guestAccountKey = 'guestAccount';

const GuestAccountDetailsSchema = z.object({
  id: z.string(),
  password: z.string(),
});

type GuestAccountDetails = z.infer<typeof GuestAccountDetailsSchema>;

const getStoredGuestAccount = async (): Promise<GuestAccountDetails | null> => {
  const dataString =
    await getConfig().storage.persistent.getItem(guestAccountKey);
  if (!dataString) {
    return null;
  }
  const parseResult = safeJsonParse(dataString);
  if (!parseResult.success) {
    return null;
  }
  const validationResult = GuestAccountDetailsSchema.safeParse(
    parseResult.data,
  );
  if (!validationResult.success) {
    console.warn('Invalid guest account data found in the storage');
    return null;
  }
  return validationResult.data;
};

const storeGuestAccount = async (data: GuestAccountDetails): Promise<void> => {
  await getConfig().storage.persistent.setItem(
    guestAccountKey,
    JSON.stringify(data),
  );
};

const clearStoredGuestAccount = async (): Promise<void> => {
  await getConfig().storage.persistent.removeItem(guestAccountKey);
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
 * Check if the user is logged in by verifying the stored session tokens.
 */
export const isLoggedIn = async (): Promise<boolean> => {
  const accessToken = await readPersistentToken(accessTokenKey);
  const refreshToken = await readPersistentToken(refreshTokenKey);
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
   * Forces a re-fetch of the auth state (and the session-scoped caches the
   * root wires to it). The state-changing mutations
   * (signIn/signOut/verifyEmail/...) already do this themselves; call this only
   * to refresh outside a mutation (e.g. after an out-of-band token change).
   */
  invalidate: () => Promise<void>;
  /** Token-presence/expiry check without fetching the auth user. */
  isLoggedIn: () => Promise<boolean>;
  /**
   * Milliseconds until the current refresh token expires (treated as expired
   * 5 seconds early), or null when there is no session.
   */
  getSessionExpiresInMs: () => Promise<number | null>;
  /** Removes the session tokens from storage. */
  clearTokens: () => Promise<void>;
  /** Creates a full account and signs in. */
  signUp: (email: string, password: string) => Promise<void>;
  /** Signs in an existing user. */
  signIn: (email: string, password: string) => Promise<void>;
  /** Signs in a previously created guest account by its id + password. */
  signInGuest: (id: string, password: string) => Promise<void>;
  /**
   * Resumes the persisted guest session if one exists; otherwise creates a new
   * guest account and persists its recovery credentials. The credentials live
   * in the host's persistent storage and are cleared on guest -> full upgrade.
   */
  signUpGuest: () => Promise<void>;
  /** Signs out the current user (clears the session tokens). */
  signOut: () => Promise<void>;
  /**
   * Watches the current session's refresh-token expiry and acts on it: a guest
   * session is silently resumed (extended) and re-armed; a full account fires
   * `onExpire` so the host can sign out and navigate. On an unrecoverable error
   * the SDK clears the tokens and fires `onRecover`. Returns a stop function.
   * Client-only (arms a timer); call once the session is bootstrapped.
   */
  watchSessionExpiry: (handlers?: SessionExpiryHandlers) => () => void;
  /**
   * Starts an email password reset. The plaintext `secret` is hashed here
   * before it leaves the device; the caller keeps the plaintext to complete
   * the reset with {@link AuthApi.confirmPasswordReset}.
   */
  requestPasswordReset: (email: string, secret: string) => Promise<void>;
  /** Completes a password reset with the emailed code + the kept secret. */
  confirmPasswordReset: (
    email: string,
    alphanumericCode: string,
    plaintextSecret: string,
    newPassword: string,
  ) => Promise<void>;
  /** Verifies the account email with the emailed code. */
  verifyEmail: (code: string) => Promise<void>;
  /** Requests a fresh email verification code for the current account. */
  requestNewVerificationCode: () => Promise<void>;
  /** Upgrades the current guest account to a full email/password account. */
  convertGuestToFullAccount: (email: string, password: string) => Promise<void>;
  /**
   * Returns the provider URL to redirect to for Google sign-in. The host owns
   * the redirect and any browser-side OAuth session bookkeeping.
   */
  initiateGoogleAuth: () => Promise<{ authUrl: string }>;
  /** Completes a Google OAuth redirect callback (code + state from the URL). */
  handleGoogleCallback: (code: string, state: string) => Promise<void>;
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
  /**
   * Invoked by the SDK root after a mutation changes the auth state (and the
   * auth-state query is invalidated), so other domains' session-scoped caches
   * (e.g. feature flags) refresh on the same edge. Auth stays unaware of those
   * domains — it just fires the callback.
   */
  onSessionChange?: () => Promise<void> | void;
};

export function createAuthApi(deps: AuthApiDeps): AuthApi {
  const {
    queryClient,
    onAuthUserIdDecoded,
    onAuthStateResolved,
    onSessionChange,
  } = deps;

  // The auth-state query is the SDK's own cache. The state-changing mutations
  // below refresh it themselves so no caller has to remember to — `refetchType:
  // 'all'` means the awaited mutation also waits for the refetch to settle.
  // onSessionChange lets the root refresh other session-scoped caches (feature
  // flags) on the same edge, without auth knowing about those domains.
  const invalidateAuthState = async () => {
    await queryClient.invalidateQueries({
      queryKey: [authStateQueryKey],
      refetchType: 'all',
    });
    await onSessionChange?.();
  };

  const restoreOrCreateGuest = async (): Promise<void> => {
    // Resume the persisted guest session if there is one; otherwise create a
    // fresh guest and persist its recovery credentials so it can be resumed.
    const stored = await getStoredGuestAccount();
    if (stored) {
      await osSignInGuest(stored.id, stored.password);
    } else {
      const password = await generateRandomPassword(32);
      const { id } = await osSignUpGuest(password, '');
      await storeGuestAccount({ id, password });
    }
    await invalidateAuthState();
  };

  const clearStoredTokens = async (): Promise<void> => {
    const { persistent } = getConfig().storage;
    await persistent.removeItem(accessTokenKey);
    await persistent.removeItem(refreshTokenKey);
  };

  // Guest accounts have no email; a full account does.
  const isCurrentUserGuest = (): boolean => {
    const state = queryClient.getQueryData<AuthState>([authStateQueryKey]);
    return !!state?.isLoggedIn && !state.user.email;
  };

  return {
    stateOptions: () => ({
      queryKey: [authStateQueryKey],
      queryFn: async (): Promise<AuthState> => {
        const accessToken = await readPersistentToken(accessTokenKey);
        const refreshToken = await readPersistentToken(refreshTokenKey);
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
    invalidate: invalidateAuthState,
    isLoggedIn,
    getSessionExpiresInMs: async () =>
      getRemainingSessionTimeInMs(await getJwt(refreshTokenKey)),
    clearTokens: clearStoredTokens,
    signUp: async (email, password) => {
      await osSignUp(email, password, '');
      await invalidateAuthState();
    },
    signIn: async (email, password) => {
      await osSignIn(email, password);
      await invalidateAuthState();
    },
    signInGuest: async (id, password) => {
      await osSignInGuest(id, password);
      await invalidateAuthState();
    },
    signUpGuest: restoreOrCreateGuest,
    signOut: async () => {
      await osSignOut();
      await invalidateAuthState();
    },
    watchSessionExpiry: (handlers = {}) => {
      let timer: LongTimeout | null = null;
      let stopped = false;

      const stop = () => {
        stopped = true;
        if (timer) {
          clearLongTimeout(timer);
          timer = null;
        }
      };

      const arm = async (): Promise<void> => {
        if (stopped) {
          return;
        }
        const remainingMs = getRemainingSessionTimeInMs(
          await getJwt(refreshTokenKey),
        );
        // stop() may have run during the await (e.g. a StrictMode unmount) while
        // `timer` was still null, so it cleared nothing — bail before arming so
        // we never leave a stranded timer behind a stopped watcher.
        if (stopped || remainingMs === null) {
          return;
        }
        timer = setLongTimeout(async () => {
          if (stopped) {
            return;
          }
          try {
            if (isCurrentUserGuest()) {
              // Silently resume the guest session and re-arm with the new
              // expiry.
              await restoreOrCreateGuest();
              await arm();
            } else {
              await handlers.onExpire?.();
            }
          } catch (error) {
            console.error('Failed to handle session expiry', { cause: error });
            await clearStoredTokens();
            await handlers.onRecover?.();
          }
        }, remainingMs);
      };

      void arm();
      return stop;
    },
    requestPasswordReset: async (email, secret) => {
      const hashedSecret = await computeSHA256(secret);
      await osRequestPasswordReset(email, hashedSecret);
    },
    confirmPasswordReset: (
      email,
      alphanumericCode,
      plaintextSecret,
      newPassword,
    ) =>
      osConfirmPasswordReset(
        email,
        alphanumericCode,
        plaintextSecret,
        newPassword,
      ),
    verifyEmail: async (code) => {
      await osVerifyEmail(code);
      await invalidateAuthState();
    },
    requestNewVerificationCode: () => osRequestNewVerificationCode(),
    convertGuestToFullAccount: async (email, password) => {
      await osConvertGuestToUserAccount(email, password);
      // The guest recovery credentials are useless once this is a full
      // email/password account; drop them.
      await clearStoredGuestAccount();
      await invalidateAuthState();
    },
    initiateGoogleAuth: async () => {
      const { auth_url } = await osInitiateGoogleAuth('');
      return { authUrl: auth_url };
    },
    handleGoogleCallback: async (code, state) => {
      await osHandleGoogleCallback(code, state, '');
      await invalidateAuthState();
    },
  };
}
