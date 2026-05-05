import { MarketingPage } from '~/features/homepage/marketing-page';
import type { Route } from './+types/_public.home';

export const meta = (_: Route.MetaArgs) => {
  const title = 'Agicash';
  const description =
    'Closed-loop ecash for the merchants you actually visit. Buy a card. Send it. Spend it at the counter. In public beta.';

  return [
    { title },
    { name: 'description', content: description },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: description },
  ];
};

export default function HomePage() {
  return <MarketingPage />;
}
