/**
 * This route implements the `/.well-known/lnurlp/$username` endpoint
 * defined by LUD 16: https://github.com/lnurl/luds/blob/luds/16.md
 */

import { LightningAddressService } from '@agicash/wallet-sdk/lightning-address-service';
import { buildLightningAddressServiceConfig } from '~/features/receive/lightning-address-config.server';
import type { Route } from './+types/[.]well-known.lnurlp.$username';

export async function loader({ request, params }: Route.LoaderArgs) {
  const lightningAddressService = new LightningAddressService(
    buildLightningAddressServiceConfig(request),
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
