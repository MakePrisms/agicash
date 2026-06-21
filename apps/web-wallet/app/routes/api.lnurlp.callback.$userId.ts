/**
 * This route implements the lnurlp callback endpoint
 * defined by LUD 06: https://github.com/lnurl/luds/blob/luds/06.md
 */

import { Money } from '@agicash/money';
import { DomainError, NotFoundError } from '@agicash/wallet-sdk';
import { getLnurlVerifyTokenCodec } from '~/features/receive/lnurl-verify-token.server';
import { getServerSdk } from '~/features/shared/sdk.server';
import { getCanonicalOrigin } from '~/lib/canonical-origin.server';
import type { LNURLError, LNURLPayResult } from '~/lib/lnurl/types';
import type { Route } from './+types/api.lnurlp.callback.$userId';

export async function loader({ request, params }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const amountMsat = url.searchParams.get('amount');
  const origin = getCanonicalOrigin(url.origin);

  let body: LNURLPayResult | LNURLError;

  if (!amountMsat || Number.isNaN(Number(amountMsat))) {
    body = { status: 'ERROR', reason: 'Invalid amount' };
  } else {
    try {
      const result = await getServerSdk(
        new URL(origin).host,
      ).createLightningReceiveQuote({
        userId: params.userId,
        amount: new Money({
          amount: amountMsat,
          currency: 'BTC',
          unit: 'msat',
        }),
        bypassAmountValidation:
          url.searchParams.get('bypassAmountValidation') === 'true',
      });

      const token = getLnurlVerifyTokenCodec().encode(result.verify);
      body = {
        pr: result.paymentRequest,
        verify: `${origin}/api/lnurlp/verify/${token}`,
        routes: [],
      };
    } catch (error) {
      if (
        error instanceof DomainError &&
        error.code === 'amount_out_of_range'
      ) {
        body = { status: 'ERROR', reason: error.message };
      } else if (error instanceof NotFoundError) {
        body = { status: 'ERROR', reason: 'not found' };
      } else {
        console.error('Error processing LNURL-pay callback', { cause: error });
        body = { status: 'ERROR', reason: 'Internal server error' };
      }
    }
  }

  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
