import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import logoUrl from '~/assets/full_logo.png';
import { authQueryOptions } from '~/features/user/auth';

const navBtnBase =
  'inline-flex h-9 items-center justify-center whitespace-nowrap rounded-full border px-4 [font-family:var(--mk-font-mono)] text-xs tracking-[0.04em] transition-[background-color,color,border-color] duration-200 md:h-[38px] md:px-5 md:text-[13px]';

const loginBtn =
  'border-[color:var(--mk-brand)] bg-transparent text-[color:var(--mk-brand)] hover:bg-[rgba(0,212,255,0.08)]';

const signupBtn =
  'border-[color:var(--mk-brand)] bg-[color:var(--mk-brand)] text-[#04080f] hover:bg-transparent hover:text-[color:var(--mk-brand)]';

export function MarketingNav() {
  const { data: authState } = useQuery(authQueryOptions());
  const isLoggedIn = authState?.isLoggedIn ?? false;

  return (
    <header className="sticky top-0 z-50 w-full border-[color:var(--mk-border)] border-b bg-[rgba(4,8,15,0.78)] backdrop-blur-[14px] backdrop-saturate-[140%]">
      <div className="flex w-full items-center justify-between gap-3 px-5 py-[14px] md:px-8 md:py-4">
        <Link
          to="/home"
          className="inline-flex items-center"
          aria-label="Agicash"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <img
            src={logoUrl}
            alt="Agicash"
            className="block h-[22px] w-auto opacity-90 md:h-[26px]"
          />
        </Link>

        <nav className="flex items-center gap-2">
          {isLoggedIn ? (
            <Link to="/" className={`${navBtnBase} ${signupBtn}`}>
              Go to Wallet
            </Link>
          ) : (
            <>
              <Link to="/login" className={`${navBtnBase} ${loginBtn}`}>
                Log in
              </Link>
              <Link to="/signup" className={`${navBtnBase} ${signupBtn}`}>
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
