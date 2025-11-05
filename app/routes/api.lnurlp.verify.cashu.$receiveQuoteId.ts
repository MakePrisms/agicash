/**
 * This route implements the LNURL-pay verify endpoint for Cashu receive quotes
 * defined by LUD21:  https://github.com/lnurl/luds/blob/luds/21.md
 */

import { agicashDbServiceRole } from '~/features/agicash-db/database.server';
import { LightningAddressService } from '~/features/receive/lightning-address-service';
import type { Route } from './+types/api.lnurlp.verify.cashu.$receiveQuoteId';

export async function loader({ request, params }: Route.LoaderArgs) {
  const { receiveQuoteId } = params;

  const lightningAddressService = new LightningAddressService(
    request,
    agicashDbServiceRole,
  );

  const response =
    await lightningAddressService.handleCashuLnurlpVerify(receiveQuoteId);

  return new Response(JSON.stringify(response), {
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
