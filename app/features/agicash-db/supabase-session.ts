import { generateThirdPartyToken, getApiUrl } from '@opensecret/react';
import type { FetchQueryOptions } from '@tanstack/react-query';
import { jwtDecode } from 'jwt-decode';
import { getQueryClient } from '~/query-client';

const queryClient = getQueryClient();

export const supabaseSessionTokenQuery = (): FetchQueryOptions<
  string | null
> => ({
  queryKey: ['supabase-session-token'],
  queryFn: async () => {
    const apiUrl = getApiUrl();
    const isLoggedIn =
      !!window.localStorage.getItem('access_token') &&
      !!window.localStorage.getItem('refresh_token');
    if (!apiUrl || !isLoggedIn) {
      // !apiUrl: Open Secret config is not initialized yet. We need this because we are passing getSupabaseSessionToken
      // when creating Supabase client and Supabase code immediately calls it. Since we are creating the client
      // when the module is resolved, the OpenSecret config which is set once the React app is started is not
      // set yet.
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
