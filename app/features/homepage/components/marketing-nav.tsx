import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import logoUrl from '~/assets/full_logo.png';
import { authQueryOptions } from '~/features/user/auth';

export function MarketingNav() {
  const { data: authState } = useQuery(authQueryOptions());
  const isLoggedIn = authState?.isLoggedIn ?? false;

  return (
    <header className="marketing-nav">
      <div className="marketing-nav-inner">
        <Link
          to="/home"
          className="marketing-nav-logo-link"
          aria-label="Agicash"
        >
          <img src={logoUrl} alt="Agicash" className="marketing-nav-logo" />
        </Link>

        <nav className="marketing-nav-actions">
          {isLoggedIn ? (
            <Link to="/" className="marketing-nav-btn signup">
              Go to Wallet
            </Link>
          ) : (
            <>
              <Link to="/login" className="marketing-nav-btn login">
                Log in
              </Link>
              <Link to="/signup" className="marketing-nav-btn signup">
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
