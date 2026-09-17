import { useQuery } from '@tanstack/react-query';
import { Link, type Location, type To, useLocation } from 'react-router';
import { useFeatureFlagOrDefault } from '~/features/shared/feature-flags';
import { authQueryOptions } from '~/features/user/auth';
import { cn } from '~/lib/utils';

type JoinBetaButtonProps = {
  size?: 'default' | 'lg';
  className?: string;
};

function getCallToAction(
  isLoggedIn: boolean,
  signupEnabled: boolean,
  location: Location,
): { to: To; label: string } {
  if (isLoggedIn) {
    return { to: '/', label: 'Go to Wallet' };
  }
  if (signupEnabled) {
    return { to: { ...location, pathname: '/signup' }, label: 'Get Started' };
  }
  return { to: { ...location, pathname: '/login' }, label: 'Log in' };
}

export function JoinBetaButton({
  size = 'default',
  className,
}: JoinBetaButtonProps) {
  const location = useLocation();
  const { data: authState } = useQuery(authQueryOptions());
  const isLoggedIn = authState?.isLoggedIn ?? false;
  const signupEnabled = useFeatureFlagOrDefault('WALLET_OPERATIONS');
  const { to, label } = getCallToAction(isLoggedIn, signupEnabled, location);

  const sizeClasses =
    size === 'lg' ? 'h-12 px-7 text-base' : 'h-10 px-5 text-sm';

  return (
    <Link
      to={to}
      className={cn(
        'inline-flex items-center justify-center rounded-md border border-[color:var(--mk-brand)] bg-[color:var(--mk-brand)] font-medium font-mono text-[#04080f] tracking-wide transition-[background-color,color] duration-200 hover:bg-transparent hover:text-[color:var(--mk-brand)] focus-visible:outline-2 focus-visible:outline-[color:var(--mk-brand)] focus-visible:outline-offset-2',
        sizeClasses,
        className,
      )}
    >
      {label}
    </Link>
  );
}
