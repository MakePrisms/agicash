/**
 * This route implements the lnurlp callback endpoint
 * defined by LUD 06: https://github.com/lnurl/luds/blob/luds/06.md
 */

import { agicashDbServer } from '~/features/agicash-db/database.server';
import { LightningAddressService } from '~/features/receive/lightning-address-service';
import { Money } from '~/lib/money';
import { getQueryClient } from '~/query-client';
import type { Route } from './+types/api.lnurlp.callback.$userId';

export async function loader({ request, params }: Route.LoaderArgs) {
  const userId = params.userId;

  const url = new URL(request.url);
  const amountMsat = url.searchParams.get('amount');

  if (!amountMsat || Number.isNaN(Number(amountMsat))) {
    return new Response(
      JSON.stringify({ status: 'ERROR', reason: 'Invalid amount' }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  }

  const amount = new Money({
    amount: amountMsat,
    currency: 'BTC',
    unit: 'msat',
  });

  const bypassAmountValidation =
    url.searchParams.get('bypassAmountValidation') === 'true';

  const queryClient = getQueryClient();
  const lightningAddressService = new LightningAddressService(
    request,
    agicashDbServer,
    queryClient,
    { bypassAmountValidation },
  );

  const response = await lightningAddressService.handleLnurlpCallback(
    userId,
    amount,
  );

  return new Response(JSON.stringify(response), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
