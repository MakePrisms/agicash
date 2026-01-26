/**
 * This route implements the LNURL-pay verify endpoint
 * defined by LUD21: https://github.com/lnurl/luds/blob/luds/21.md
 */

import { agicashDbServer } from '~/features/agicash-db/database.server';
import { LightningAddressService } from '~/features/receive/lightning-address-service';
import { getQueryClient } from '~/query-client';
import type { Route } from './+types/api.lnurlp.verify.$encryptedQuoteData';

export async function loader({ request, params }: Route.LoaderArgs) {
  const { encryptedQuoteData } = params;

  const queryClient = getQueryClient();
  const lightningAddressService = new LightningAddressService(
    request,
    agicashDbServer,
    queryClient,
  );

  const response =
    await lightningAddressService.handleLnurlpVerify(encryptedQuoteData);

  return new Response(JSON.stringify(response), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
