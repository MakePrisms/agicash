import { safeJwtDecode } from '@agicash/utils';

/**
 * Check if the user is logged in by verifying localStorage tokens. A corrupt
 * stored token counts as logged out — this feeds the DB client's token
 * getter, so it must never throw into every query.
 */
export const isLoggedIn = (): boolean => {
  const accessToken = window.localStorage.getItem('access_token');
  const refreshToken = window.localStorage.getItem('refresh_token');
  if (!accessToken || !refreshToken) {
    return false;
  }
  const decoded = safeJwtDecode(refreshToken);
  return !!decoded?.exp && decoded.exp * 1000 > Date.now();
};
