import { generateThirdPartyToken } from '@agicash/opensecret';
import type { AuthProvider } from '@cashu/cashu-ts';
import type { FetchQueryOptions } from '@tanstack/react-query';
import { jwtDecode } from 'jwt-decode';
import { getQueryClient } from '~/features/shared/query-client';
import { isLoggedIn } from '~/lib/auth/is-logged-in';

const queryClient = getQueryClient();

/**
 * React Query options for the mint auth token (CAT).
 * Calls generateThirdPartyToken with audience "agicash-mint".
 * Token is refreshed 5 seconds before expiry, matching the Supabase token pattern.
 */
export const mintAuthTokenQuery = (): FetchQueryOptions<string | null> => ({
  queryKey: ['mint-auth-token'],
  queryFn: async () => {
    if (!isLoggedIn()) {
      return null;
    }
    const response = await generateThirdPartyToken('agicash-mint');
    return response.token;
  },
  staleTime: ({ state: { data } }) => {
    if (!data) {
      return 0;
    }

    const decoded = jwtDecode(data);

    if (!decoded.exp) {
      return 0;
    }

    const fiveSecondsBeforeExpirationInMs = (decoded.exp - 5) * 1000;
    const now = Date.now();
    const msToExpiration = fiveSecondsBeforeExpirationInMs - now;

    return Math.max(msToExpiration, 0);
  },
});

/** Fetch a fresh or cached mint auth token. */
export const getMintAuthToken = (): Promise<string | null> =>
  queryClient.fetchQuery(mintAuthTokenQuery());

/**
 * Returns a cashu-ts AuthProvider for NUT-21 Clear Auth.
 * Token lifecycle is managed by React Query with automatic refresh before expiry.
 */
export function getMintAuthProvider(): AuthProvider {
  let cachedToken: string | undefined;

  return {
    getCAT: () => cachedToken,
    setCAT: (cat: string | undefined) => {
      cachedToken = cat;
    },
    ensureCAT: async () => {
      const token = await getMintAuthToken();
      if (token) {
        cachedToken = token;
      }
      return cachedToken;
    },
    getBlindAuthToken: async (_input: {
      method: 'GET' | 'POST';
      path: string;
    }) => {
      throw new Error('Blind auth is not supported');
    },
  };
}
