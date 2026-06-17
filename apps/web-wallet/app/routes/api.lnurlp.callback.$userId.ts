import { Money } from '@agicash/money';
import { getServerSdk } from '~/features/receive/server-sdk.server';
import type { Route } from './+types/api.lnurlp.callback.$userId';

export async function loader({ request, params }: Route.LoaderArgs) {
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

  const sdk = await getServerSdk();
  const response = await sdk.lightningAddress.handleLnurlpCallback({
    userId: params.userId,
    amount,
    baseUrl: url.origin,
    bypassAmountValidation,
  });

  return new Response(JSON.stringify(response), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
