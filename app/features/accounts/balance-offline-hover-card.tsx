import { TriangleAlertIcon } from 'lucide-react';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '~/components/ui/hover-card';
import { cn } from '~/lib/utils';
import type { AccountType } from './account';

export function BalanceOfflineHoverCard({
  accountType,
  className,
}: { accountType: AccountType; className?: string }) {
  const cardContent =
    accountType === 'spark'
      ? 'Spark is offline. Your balance will be shown when you are online again.'
      : 'Account is offline. Your balance will be shown when you are online again.';
  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          className={cn(
            'flex items-center gap-1 text-muted-foreground focus-visible:outline-none',
            className,
          )}
        >
          -- <TriangleAlertIcon className="size-[1em]" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent>
        <p className="text-muted-foreground text-sm">{cardContent}</p>
      </HoverCardContent>
    </HoverCard>
  );
}
