import { validateCashuToken } from '@agicash/cashu';
import { normalizeMintUrl } from '@agicash/cashu/utils';
import { decodeCashuToken } from '@agicash/wallet-sdk/cashu';
import { getQueryClient } from '@agicash/wallet-sdk/query-client';
import { type MetaDescriptor, redirect } from 'react-router';
import { Page } from '~/components/page';
import { getGiftCardByUrl } from '~/features/gift-cards/use-discover-cards';
import { LoadingScreen } from '~/features/loading/LoadingScreen';
import { PublicReceiveCashuToken } from '~/features/receive/receive-cashu-token';
import { UnsupportedCashuTokenPage } from '~/features/receive/unsupported-cashu-token-page';
import { authQueryOptions } from '~/features/user/auth';
import type { Route } from './+types/_public.receive-cashu-token';

type SharePreview = {
  ogImage: string;
  title: string;
  description: string;
};

function resolveSharePreview(mintUrl: string): SharePreview | undefined {
  const card = getGiftCardByUrl(mintUrl);
  if (!card?.ogImage) return undefined;

  if (card.purpose === 'offer') {
    return {
      ogImage: card.ogImage,
      title: 'Your Bitcoin offer!',
      description: 'Claim on Agicash.',
    };
  }

  return {
    ogImage: card.ogImage,
    title: `${card.name} Bitcoin gift card`,
    description: 'Claim on Agicash.',
  };
}

export function meta({ location, matches }: Route.MetaArgs): MetaDescriptor[] {
  const rawMintParam = new URLSearchParams(location.search).get('mint');
  const mintUrl = rawMintParam
    ? normalizeMintUrl(`https://${rawMintParam}`)
    : undefined;
  const rootMatch = matches.find((m) => m?.id === 'root');

  const preview = mintUrl ? resolveSharePreview(mintUrl) : undefined;
  if (!preview) return rootMatch?.meta ?? [];

  const origin =
    (rootMatch?.data as { origin?: string } | undefined)?.origin ??
    'https://agi.cash';
  const imageUrl = `${origin}${preview.ogImage}`;
  const { title, description } = preview;

  return [
    { title },
    { name: 'description', content: description },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:image', content: imageUrl },
    { property: 'og:image:alt', content: title },
    { property: 'og:image:width', content: '900' },
    { property: 'og:image:height', content: '473' },
    { property: 'og:image:type', content: 'image/webp' },
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: 'Agicash' },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: description },
    { name: 'twitter:image', content: imageUrl },
    { name: 'twitter:image:alt', content: title },
  ];
}

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

  const validation = validateCashuToken(token);

  if (!validation.isTokenSupported) {
    return {
      isTokenSupported: false as const,
      message: validation.message,
    };
  }

  return { isTokenSupported: true as const, token };
}

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingScreen />;
}

export default function ReceiveCashuTokenPage({
  loaderData,
}: Route.ComponentProps) {
  if (!loaderData.isTokenSupported) {
    return <UnsupportedCashuTokenPage message={loaderData.message} />;
  }

  return (
    <Page>
      <PublicReceiveCashuToken token={loaderData.token} />
    </Page>
  );
}
