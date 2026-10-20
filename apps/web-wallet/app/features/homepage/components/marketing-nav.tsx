import { Link } from 'react-router';
import logoUrl from '~/assets/full_logo.png';

export function MarketingNav() {
  return (
    <header className="sticky top-0 z-50 w-full border-[color:var(--mk-border)] border-b bg-[rgba(4,8,15,0.78)] backdrop-blur-[14px] backdrop-saturate-[140%]">
      <div className="flex h-16 w-full items-center px-5 md:h-[70px] md:px-8">
        <Link
          to="/home"
          className="inline-flex items-center"
          aria-label="Agicash"
          onClick={() =>
            document
              .querySelector('.marketing')
              ?.scrollTo({ top: 0, behavior: 'smooth' })
          }
        >
          <img
            src={logoUrl}
            alt="Agicash"
            className="block h-[22px] w-auto opacity-90 md:h-[26px]"
          />
        </Link>
      </div>
    </header>
  );
}
