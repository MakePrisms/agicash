import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '~/lib/utils';

type MarketingCardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function MarketingCard({
  children,
  className,
  ...props
}: MarketingCardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-[color:var(--mk-border)] bg-[color:var(--mk-bg-card)] p-7 transition-colors duration-200 hover:border-[color:var(--mk-border-bright)] md:p-9',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
