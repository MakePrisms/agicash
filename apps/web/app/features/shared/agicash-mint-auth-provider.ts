import { generateThirdPartyToken } from '@agicash/opensecret';
import type { AuthProvider } from '@cashu/cashu-ts';
import type { FetchQueryOptions } from '@tanstack/react-query';
import { jwtDecode } from 'jwt-decode';
import { isLoggedIn } from '~/features/shared/auth';
import { getQueryClient } from '~/features/shared/query-client';

const queryClient = getQueryClient();

/**
 * React Query options for the agicash mint auth token (CAT).
 * Calls generateThirdPartyToken with audience "agicash-mint".
 * Token is refreshed 5 seconds before expiry, matching the Supabase token pattern.
 */
const agicashMintAuthTokenQuery = (): FetchQueryOptions<string | null> => ({
  queryKey: ['agicash-mint-auth-token'],
  queryFn: async () => {
    if (!isLoggedIn()) {
      return null;
    }
    const response = await generateThirdPartyToken('agicash-mint');
    return response.token;
  },
  staleTime: ({ state: { data } }) => {
    if (!data) return 0;
    const decoded = jwtDecode(data);
    if (!decoded.exp) return 0;
    const fiveSecondsBeforeExpirationInMs = (decoded.exp - 5) * 1000;
    return Math.max(fiveSecondsBeforeExpirationInMs - Date.now(), 0);
  },
});

/**
 * Returns a cashu-ts AuthProvider for NUT-21 Clear Auth on agicash gift card mints.
 * Token lifecycle is managed by React Query with automatic refresh before expiry.
 */
export function getAgicashMintAuthProvider(): AuthProvider {
  return {
    getCAT: () => {
      throw new Error('Not implemented: use ensureCAT');
    },
    setCAT: () => {
      throw new Error('Not implemented: use ensureCAT');
    },
    ensureCAT: async () => {
      const token = await queryClient.fetchQuery(agicashMintAuthTokenQuery());
      return token ?? undefined;
    },
    getBlindAuthToken: async () => {
      throw new Error('Blind auth is not supported');
    },
  };
}
