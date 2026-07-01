/**
 * This route implements the LNURL-pay verify endpoint
 * defined by LUD21: https://github.com/lnurl/luds/blob/luds/21.md
 */

import { LightningAddressService } from '@agicash/wallet-sdk/temporary.server';
import { agicashDbServer } from '~/features/agicash-db/database.server';
import { breezApiKey } from '~/lib/breez';
import type { Route } from './+types/api.lnurlp.verify.$encryptedQuoteData';

export async function loader({ request, params }: Route.LoaderArgs) {
  const { encryptedQuoteData } = params;

  const lightningAddressService = new LightningAddressService(
    request,
    agicashDbServer,
    { storageDir: '/tmp/.spark-data', apiKey: breezApiKey },
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
