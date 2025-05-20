/**
 * This route implements the `/.well-known/lnurlp/$username` endpoint
 * defined by LUD 16: https://github.com/lnurl/luds/blob/luds/16.md
 */

import { agicashDbServiceRole } from '~/features/agicash-db/database.server';
import { LightningAddressService } from '~/features/receive/lightning-address-service';
import type { Route } from './+types/[.]well-known.lnurlp.$username';

export async function loader({ request, params }: Route.LoaderArgs) {
  const lightningAddressService = new LightningAddressService(
    request,
    agicashDbServiceRole,
  );

  const response = await lightningAddressService.handleLud16Request(
    params.username,
  );

  return new Response(JSON.stringify(response), {
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
