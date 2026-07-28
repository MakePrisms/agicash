import { AccountsCache } from '~/features/accounts/account-hooks';
import { getQueryClient } from '~/features/shared/query-client';
import { sdk } from '~/features/shared/sdk.client';
import { UserCache } from '~/features/user/user-hooks';

/**
 * Seeds the user and accounts caches from the SDK's `auth.session-started` event
 * so the provisioned identity and its accounts are in cache before the
 * protected tree reads them — the host no longer provisions or fetches them
 * itself. Registered at boot, before the router, so the first protected
 * middleware sees the seeded caches; replay-latest delivers the most recent
 * payload even when `init()` established the session before this subscribed.
 * @returns The unsubscribe function.
 */
export const registerSessionStarted = (): (() => void) =>
  sdk.events.on('auth.session-started', ({ user, accounts }) => {
    const queryClient = getQueryClient();
    queryClient.setQueryData([UserCache.Key], user);
    queryClient.setQueryData([AccountsCache.Key], accounts);
  });
