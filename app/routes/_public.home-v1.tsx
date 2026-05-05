import { MarketingPage } from '~/features/homepage-v1/marketing-page';
import type { Route } from './+types/_public.home-v1';

export const meta = (_: Route.MetaArgs) => {
  const title = 'Agicash · v1';
  const description =
    'Self-custodial Bitcoin wallet, closed-loop merchant ecash, and MCP-native machine payments.';

  return [
    { title },
    { name: 'description', content: description },
    { name: 'robots', content: 'noindex' },
  ];
};

export default function HomeV1Page() {
  return <MarketingPage />;
}
