import logo from '~/assets/full_logo.png';
import termsContent from '~/assets/terms-of-use.md?raw';
import { Markdown } from '~/components/markdown';
import { ScrollArea } from '~/components/ui/scroll-area';
import { useRedirectTo } from '~/hooks/use-redirect-to';
import { LinkWithViewTransition } from '~/lib/transitions';

export default function TermsPage() {
  const { redirectTo } = useRedirectTo('/');

  return (
    <ScrollArea className="mx-auto h-dvh max-w-4xl px-4 py-8" hideScrollbar>
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
        <Markdown content={termsContent} />
      </main>
    </ScrollArea>
  );
}
