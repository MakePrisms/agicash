import { generateThirdPartyToken } from '@agicash/opensecret';
import type { FetchQueryOptions } from '@tanstack/react-query';
import { jwtDecode } from 'jwt-decode';
import { isLoggedIn } from '~/features/shared/auth';
import { getQueryClient } from '~/features/shared/query-client';

const queryClient = getQueryClient();

export const supabaseSessionTokenQuery = (): FetchQueryOptions<
  string | null
> => ({
  queryKey: ['supabase-session-token'],
  queryFn: async () => {
    if (!isLoggedIn()) {
      return null;
    }
    const response = await generateThirdPartyToken();
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

export const getSupabaseSessionToken = () =>
  queryClient.fetchQuery(supabaseSessionTokenQuery());
