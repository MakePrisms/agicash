export const accessTokenStorageKey = 'access_token';
export const refreshTokenStorageKey = 'refresh_token';

/**
 * Synchronous best-effort check for whether the user has stored auth tokens.
 *
 * Tokens may be present-but-expired; the full auth verification still runs in
 * `routeGuardMiddleware`. This is intentionally cheap so it can run before
 * hydration to skip the protected-route splash for clearly-logged-out users.
 */
export const hasStoredAuthTokens = (): boolean => {
  try {
    return (
      !!window.localStorage.getItem(accessTokenStorageKey) &&
      !!window.localStorage.getItem(refreshTokenStorageKey)
    );
  } catch {
    return false;
  }
};
