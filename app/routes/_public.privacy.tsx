import { useSearchParams } from 'react-router';
import logo from '~/assets/full_logo.png';
import privacyContent from '~/assets/privacy-policy.md?raw';
import { Markdown } from '~/components/markdown';
import { LinkWithViewTransition } from '~/lib/transitions';

export default function PrivacyPage() {
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirectTo');

  return (
    <div className="mx-auto h-dvh max-w-4xl overflow-y-auto overflow-x-hidden px-4 py-8 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <header className="mb-8 flex items-center justify-start">
        <LinkWithViewTransition
          to={{
            pathname: redirectTo ?? '/',
          }}
          transition="slideDown"
          applyTo="oldView"
        >
          <img src={logo} alt="Agicash Logo" className="mr-4 h-8" />
        </LinkWithViewTransition>
      </header>
      <main>
        <Markdown content={privacyContent} />
      </main>
    </div>
  );
}
