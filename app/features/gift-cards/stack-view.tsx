import type { CashuAccount } from '~/features/accounts/account';

import { DiscoverSection } from './discover-section';
import { EmptyState } from './empty-state';
import { StackedCards } from './stacked-cards';
import type { DiscoverMint } from './use-discover-cards';

type StackViewProps = {
  cardRefs: React.RefObject<(HTMLButtonElement | null)[]>;
  accounts: CashuAccount[];
  discoverMints: DiscoverMint[];
  stackedHeight: number;
  onCardClick: (index: number, cardRect: DOMRect) => void;
  hideCards?: boolean;
};

/**
 * Main view for the collapsed card stack state.
 * Composes the discover carousel, empty state, and stacked cards.
 */
export function StackView({
  cardRefs,
  accounts,
  discoverMints,
  stackedHeight,
  onCardClick,
  hideCards = false,
}: StackViewProps) {
  const hasCards = accounts.length > 0;

  return (
    <div className="flex w-full flex-col items-center gap-4">
      {discoverMints.length > 0 && <DiscoverSection mints={discoverMints} />}

      {hasCards ? (
        <StackedCards
          cardRefs={cardRefs}
          accounts={accounts}
          stackedHeight={stackedHeight}
          onCardClick={onCardClick}
          hideCards={hideCards}
        />
      ) : (
        <EmptyState />
      )}
    </div>
  );
}
