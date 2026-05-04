import { ChevronRight } from 'lucide-react';
import logo from '~/assets/full_logo.png';
import { useRedirectTo } from '~/hooks/use-redirect-to';
import { useBuildLinkWithSearchParams } from '~/hooks/use-search-params-link';
import { LinkWithViewTransition } from '~/lib/transitions';

export default function PrivacyHubPage() {
  const { redirectTo } = useRedirectTo('/');
  const buildLinkWithSearchParams = useBuildLinkWithSearchParams();

  return (
    <div className="mx-auto h-dvh max-w-4xl overflow-y-auto overflow-x-hidden px-4 py-8 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <header className="mb-8 flex items-center justify-start">
        <LinkWithViewTransition
          to={redirectTo}
          transition="slideDown"
          applyTo="oldView"
        >
          <img src={logo} alt="Agicash Logo" className="mr-4 h-8" />
        </LinkWithViewTransition>
      </header>
      <main>
        <h1 className="mb-6 font-bold text-2xl">Privacy Notice</h1>
        <div className="flex flex-col">
          <LinkWithViewTransition
            to={buildLinkWithSearchParams('/privacy/wallet')}
            transition="slideLeft"
            applyTo="newView"
            className="flex h-10 w-full items-center justify-between py-2"
          >
            <span>Wallet</span>
            <ChevronRight className="size-4 shrink-0" />
          </LinkWithViewTransition>
          <LinkWithViewTransition
            to={buildLinkWithSearchParams('/privacy/mint')}
            transition="slideLeft"
            applyTo="newView"
            className="flex h-10 w-full items-center justify-between py-2"
          >
            <span>Mint</span>
            <ChevronRight className="size-4 shrink-0" />
          </LinkWithViewTransition>
        </div>
      </main>
    </div>
  );
}
