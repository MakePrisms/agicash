import type { CashuAccount } from '~/features/accounts/account';

import { DiscoverSection } from './discover-section';
import { EmptyState } from './empty-state';
import { StackedCards } from './stacked-cards';
import type { DiscoverMint } from './use-discover-cards';

type StackViewProps = {
  accounts: CashuAccount[];
  discoverMints: DiscoverMint[];
};

/**
 * Main view for the card stack.
 * Composes the discover carousel, empty state, and stacked cards.
 */
export function StackView({ accounts, discoverMints }: StackViewProps) {
  const hasCards = accounts.length > 0;

  return (
    <div className="flex w-full flex-col items-center gap-4">
      {discoverMints.length > 0 && <DiscoverSection mints={discoverMints} />}

      {hasCards ? <StackedCards accounts={accounts} /> : <EmptyState />}
    </div>
  );
}
