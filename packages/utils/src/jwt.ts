import { type JwtPayload, jwtDecode } from 'jwt-decode';

/**
 * Decodes a JWT's payload, returning null for an undecodable token instead of
 * throwing. For tokens read from storage, which may be corrupt. A token just
 * minted by a server should be decoded with `jwtDecode` directly, so a
 * malformed one fails its operation loudly instead of passing as absent.
 */
export const safeJwtDecode = (token: string): JwtPayload | null => {
  try {
    return jwtDecode(token);
  } catch {
    return null;
  }
};
