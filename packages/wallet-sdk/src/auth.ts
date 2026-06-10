import { jwtDecode } from 'jwt-decode';

/**
 * Check if the user is logged in by verifying localStorage tokens.
 *
 * Reads the token keys the OpenSecret client writes; switches to the
 * OpenSecret StorageAdapter when the storage-pluggable bump lands (same
 * tracked exception as the opensecret dependency itself).
 */
export const isLoggedIn = (): boolean => {
  const accessToken = window.localStorage.getItem('access_token');
  const refreshToken = window.localStorage.getItem('refresh_token');
  if (!accessToken || !refreshToken) {
    return false;
  }
  const decoded = jwtDecode(refreshToken);
  return !!decoded.exp && decoded.exp * 1000 > Date.now();
};
