import type { LoaderFunctionArgs } from 'react-router';
import { redirect } from 'react-router';
import { Page } from '~/components/page';
import { ConnectSquare } from '../features/square/connect-square';
import { squareConnectedCookie } from '../features/square/square-cookies.server';
import type { Route } from './+types/_public.merchant.square';

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const success = url.searchParams.get('success');
  const error = url.searchParams.get('error');

  // If OAuth callback returned success, set the connected cookie and redirect to clean URL
  if (success === 'true') {
    return redirect('/merchant/square', {
      headers: {
        'Set-Cookie': await squareConnectedCookie.serialize('true'),
      },
    });
  }

  // Otherwise, check if already connected
  const cookieHeader = request.headers.get('Cookie');
  const isConnected =
    (await squareConnectedCookie.parse(cookieHeader)) === 'true';

  return { isConnected, error };
}

export default function ConnectSquarePage({
  loaderData,
}: Route.ComponentProps) {
  const { isConnected, error } = loaderData;
  return (
    <Page>
      <ConnectSquare isConnected={isConnected} error={error} />
    </Page>
  );
}
