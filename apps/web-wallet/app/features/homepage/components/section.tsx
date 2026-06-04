import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '~/lib/utils';

type SectionProps = HTMLAttributes<HTMLElement> & {
  id?: string;
  children: ReactNode;
  hairline?: boolean;
};

export function Section({
  id,
  children,
  hairline = true,
  className,
  ...props
}: SectionProps) {
  return (
    <section
      id={id}
      className={cn(
        'relative w-full px-5 py-20 md:px-8 md:py-32',
        hairline && 'border-[color:var(--mk-border)] border-t',
        className,
      )}
      {...props}
    >
      <div className="mx-auto w-full max-w-6xl">{children}</div>
    </section>
  );
}
