import { cn } from '~/lib/utils';

type SectionLabelProps = {
  children: string;
  className?: string;
};

export function SectionLabel({ children, className }: SectionLabelProps) {
  return (
    <div
      className={cn(
        'font-mono text-[color:var(--mk-text-muted)] text-xs lowercase',
        className,
      )}
    >
      <span aria-hidden="true">{'> '}</span>
      {children}
    </div>
  );
}
