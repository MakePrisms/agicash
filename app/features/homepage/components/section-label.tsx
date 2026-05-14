import { cn } from '~/lib/utils';

type SectionLabelProps = {
  children: string;
  className?: string;
  href?: string;
};

export function SectionLabel({ children, className, href }: SectionLabelProps) {
  const labelClasses = cn(
    'translate-y-2 text-left font-mono text-[color:var(--mk-text-muted)] text-xs uppercase tracking-[0.12em]',
    className,
  );
  const content = (
    <>
      <span aria-hidden="true">{'> '}</span>
      {children}
    </>
  );

  if (href) {
    const id = href.startsWith('#') ? href.slice(1) : href;
    return (
      <a id={id} href={href} className={cn('block w-fit', labelClasses)}>
        {content}
      </a>
    );
  }

  return <div className={labelClasses}>{content}</div>;
}
