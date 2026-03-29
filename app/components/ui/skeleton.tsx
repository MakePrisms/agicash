import { cn } from '@agicash/sdk/lib/utils';

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-primary/70', className)}
      {...props}
    />
  );
}

export { Skeleton };
