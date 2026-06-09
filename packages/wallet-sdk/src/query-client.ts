import { QueryClient, isServer } from '@tanstack/query-core';

// query-core is pinned to the exact version @tanstack/react-query depends on
// (5.90.20, incl. the workspace patch) so this QueryClient is the SAME class the
// web app's react-query hooks use — the web can mount this instance directly.

let browserQueryClient: QueryClient | undefined = undefined;

function makeQueryClient() {
  return new QueryClient();
}

/**
 * The SDK-owned QueryClient.
 *
 * On the server a fresh client is returned per call (per-request cache isolation).
 * In the browser a single client is reused across the app, so a React suspend
 * during the initial render does not recreate it.
 *
 * @returns the QueryClient the whole app shares.
 */
export function getQueryClient(): QueryClient {
  if (isServer) {
    return makeQueryClient();
  }

  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }
  return browserQueryClient;
}
