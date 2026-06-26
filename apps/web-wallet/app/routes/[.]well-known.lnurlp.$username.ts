/**
 * This route implements the `/.well-known/lnurlp/$username` endpoint
 * defined by LUD 16: https://github.com/lnurl/luds/blob/luds/16.md
 */

import { LightningAddressService } from '@agicash/wallet-sdk/temporary.server';
import { agicashDbServer } from '~/features/agicash-db/database.server';
import { isLoggedIn } from '~/features/shared/auth';
import { getFeatureFlag } from '~/features/shared/feature-flags';
import { getQueryClient } from '~/features/shared/query-client';
import type { Route } from './+types/[.]well-known.lnurlp.$username';

export async function loader({ request, params }: Route.LoaderArgs) {
  const queryClient = getQueryClient();
  const lightningAddressService = new LightningAddressService(
    request,
    agicashDbServer,
    queryClient,
    isLoggedIn,
    () => getFeatureFlag('DEBUG_LOGGING_SPARK'),
  );

  const response = await lightningAddressService.handleLud16Request(
    params.username,
  );

  return new Response(JSON.stringify(response), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
