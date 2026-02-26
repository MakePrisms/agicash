import logo from '~/assets/full_logo.png';
import termsContent from '~/assets/terms-of-use.md?raw';
import { Markdown } from '~/components/markdown';
import { useRedirectTo } from '~/hooks/use-redirect-to';
import { LinkWithViewTransition } from '~/lib/transitions';

export default function TermsPage() {
  const { redirectTo } = useRedirectTo('/');

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
        <Markdown content={termsContent} />
      </main>
    </div>
  );
}
