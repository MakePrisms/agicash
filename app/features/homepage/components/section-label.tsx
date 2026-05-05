import { cn } from '~/lib/utils';

type SectionLabelProps = {
  children: string;
  className?: string;
};

export function SectionLabel({ children, className }: SectionLabelProps) {
  return (
    <div
      className={cn(
        'translate-y-2 text-left font-mono text-[color:var(--mk-text-muted)] text-xs uppercase tracking-[0.12em]',
        className,
      )}
    >
      <span aria-hidden="true">{'> '}</span>
      {children}
    </div>
  );
}
