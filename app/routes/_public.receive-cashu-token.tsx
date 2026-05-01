import { redirect } from 'react-router';
import { Page } from '~/components/page';
import { LoadingScreen } from '~/features/loading/LoadingScreen';
import { InvalidCashuTokenPage } from '~/features/receive/invalid-cashu-token-page';
import { PublicReceiveCashuToken } from '~/features/receive/receive-cashu-token';
import { decodeCashuToken } from '~/features/shared/cashu';
import { getQueryClient } from '~/features/shared/query-client';
import { authQueryOptions } from '~/features/user/auth';
import { cashuProtocolUnitToCurrency } from '~/lib/cashu';
import { CASHU_PROTOCOL_UNITS } from '~/lib/cashu/types';
import type { Route } from './+types/_public.receive-cashu-token';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const location = new URL(request.url);
  // We have to use window.location.hash because location that comes from the request does not have the hash
  const hash = window.location.hash;
  const queryClient = getQueryClient();
  const { isLoggedIn } = await queryClient.ensureQueryData(authQueryOptions());

  if (isLoggedIn) {
    // We have to use window.location.search because when this loader is revalidated after signin as guest,
    // request.url will be the same as before the signin.
    throw redirect(`/receive/cashu/token${location.search}${hash}`);
  }

  const token = await decodeCashuToken(hash);

  if (!token) {
    throw redirect('/home');
  }

  if (
    token.unit === undefined ||
    !(token.unit in cashuProtocolUnitToCurrency)
  ) {
    return {
      valid: false as const,
      message: `This token's unit isn't supported. Supported units: ${CASHU_PROTOCOL_UNITS.join(', ')}.`,
    };
  }

  return { valid: true as const, token };
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingScreen />;
}

export default function ReceiveCashuTokenPage({
  loaderData,
}: Route.ComponentProps) {
  if (!loaderData.valid) {
    return <InvalidCashuTokenPage message={loaderData.message} />;
  }

  return (
    <Page>
      <PublicReceiveCashuToken token={loaderData.token} />
    </Page>
  );
}
