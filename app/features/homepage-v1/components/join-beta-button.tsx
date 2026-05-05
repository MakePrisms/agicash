import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router';
import { authQueryOptions } from '~/features/user/auth';
import { cn } from '~/lib/utils';

type JoinBetaButtonProps = {
  size?: 'default' | 'lg';
  className?: string;
};

export function JoinBetaButton({
  size = 'default',
  className,
}: JoinBetaButtonProps) {
  const location = useLocation();
  const { data: authState } = useQuery(authQueryOptions());
  const isLoggedIn = authState?.isLoggedIn ?? false;

  const sizeClasses =
    size === 'lg' ? 'h-12 px-7 text-base' : 'h-10 px-5 text-sm';

  return (
    <Link
      to={isLoggedIn ? '/' : { ...location, pathname: '/signup' }}
      className={cn(
        'mk-cta inline-flex items-center justify-center rounded-md font-medium font-mono tracking-wide focus-visible:outline-2 focus-visible:outline-[color:var(--mk-brand)] focus-visible:outline-offset-2',
        sizeClasses,
        className,
      )}
    >
      {isLoggedIn ? 'Go to Wallet' : 'Join Beta'}
    </Link>
  );
}
