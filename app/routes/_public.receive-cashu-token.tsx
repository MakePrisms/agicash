import { NetworkError } from '@cashu/cashu-ts';
import { redirect } from 'react-router';
import {
  ClosePageButton,
  Page,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { LoadingScreen } from '~/features/loading/LoadingScreen';
import { PublicReceiveCashuToken } from '~/features/receive/receive-cashu-token';
import { TokenErrorDisplay } from '~/features/receive/token-error-display';
import {
  allMintKeysetsQueryKey,
  allMintKeysetsQueryOptions,
  decodeCashuToken,
  mintInfoQueryKey,
  mintInfoQueryOptions,
  mintKeysQueryKey,
  mintKeysQueryOptions,
} from '~/features/shared/cashu';
import { getQueryClient } from '~/features/shared/query-client';
import { authQueryOptions } from '~/features/user/auth';
import { extractCashuToken } from '~/lib/cashu/token';
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

  // Local parse — no network. Lets us pull the mint URL out before probing.
  const extracted = extractCashuToken(hash);
  if (!extracted) {
    throw redirect('/home');
  }

  const mintUrl = extracted.metadata.mint;

  // Probe mint reachability. Primes the cache so the component's wallet init
  // resolves from cache without any further network round-trips. 10s timeout
  // matches getInitializedCashuWallet so the loader can't hang forever.
  try {
    await Promise.race([
      Promise.all([
        queryClient.fetchQuery(mintInfoQueryOptions(mintUrl)),
        queryClient.fetchQuery(allMintKeysetsQueryOptions(mintUrl)),
        queryClient.fetchQuery(mintKeysQueryOptions(mintUrl)),
      ]),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          queryClient.cancelQueries({ queryKey: mintInfoQueryKey(mintUrl) });
          queryClient.cancelQueries({
            queryKey: allMintKeysetsQueryKey(mintUrl),
          });
          queryClient.cancelQueries({ queryKey: mintKeysQueryKey(mintUrl) });
          reject(new NetworkError('Mint probe timed out'));
        }, 10_000);
      }),
    ]);
  } catch (error) {
    if (error instanceof NetworkError) {
      return { kind: 'mint-offline' as const, mintUrl };
    }
    throw error;
  }

  // Keysets are warm in cache from the probe, so this resolves fast.
  const token = await decodeCashuToken(hash);
  if (!token) {
    throw redirect('/home');
  }

  return { kind: 'ready' as const, token };
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingScreen />;
}

export default function ReceiveCashuTokenPage({
  loaderData,
}: Route.ComponentProps) {
  if (loaderData.kind === 'mint-offline') {
    return (
      <Page>
        <PageHeader className="z-10">
          <ClosePageButton
            to="/home"
            transition="slideDown"
            applyTo="oldView"
          />
          <PageHeaderTitle>Receive</PageHeaderTitle>
        </PageHeader>
        <PageContent className="flex flex-col items-center justify-center">
          <TokenErrorDisplay message="The mint that issued this ecash is currently offline" />
        </PageContent>
      </Page>
    );
  }

  const { token } = loaderData;

  return (
    <Page>
      <PublicReceiveCashuToken token={token} />
    </Page>
  );
}
