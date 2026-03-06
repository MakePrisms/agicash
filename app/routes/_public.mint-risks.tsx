import logo from '~/assets/full_logo.png';
import mintRisksContent from '~/assets/mint-risks.md?raw';
import { Markdown } from '~/components/markdown';
import { useRedirectTo } from '~/hooks/use-redirect-to';
import { LinkWithViewTransition } from '~/lib/transitions';

export default function MintRisksPage() {
  const { redirectTo } = useRedirectTo('/');

  return (
    <div className="scrollbar-none mx-auto h-dvh max-w-4xl overflow-y-auto px-4 py-8">
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
        <Markdown content={mintRisksContent} />
      </main>
    </div>
  );
}
