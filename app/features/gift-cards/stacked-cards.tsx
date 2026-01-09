import type { CashuAccount } from '~/features/accounts/account';

import { CARD_WIDTH, COLLAPSED_OFFSET } from './card-stack.constants';
import { GiftCardItem } from './gift-card-item';
import { getCardImageByMintUrl } from './use-discover-cards';

type StackedCardsProps = {
  cardRefs: React.RefObject<(HTMLButtonElement | null)[]>;
  accounts: CashuAccount[];
  stackedHeight: number;
  onCardClick: (index: number, cardRect: DOMRect) => void;
  hideCards: boolean;
};

/**
 * Renders the collapsed card stack with overlapping cards.
 * Each card is positioned absolutely with a vertical offset.
 */
export function StackedCards({
  cardRefs,
  accounts,
  stackedHeight,
  onCardClick,
  hideCards,
}: StackedCardsProps) {
  return (
    <div className="flex w-full shrink-0 flex-col items-center pb-8">
      <h2 className="mb-3 w-full px-4 text-white">Your Cards</h2>
      <div className="w-full px-4">
        <div
          className="relative mx-auto w-full"
          style={{ height: stackedHeight, maxWidth: CARD_WIDTH }}
        >
          {!hideCards &&
            accounts.map((account, index) => (
              <button
                key={account.id}
                ref={(el) => {
                  cardRefs.current[index] = el;
                }}
                type="button"
                onClick={(e) =>
                  onCardClick(index, e.currentTarget.getBoundingClientRect())
                }
                aria-label={`Select ${account.name} card, ${index + 1} of ${accounts.length}`}
                className="absolute left-0 w-full"
                style={{
                  transform: `translateY(${index * COLLAPSED_OFFSET}px)`,
                  zIndex: 1 + index,
                }}
              >
                <GiftCardItem
                  account={account}
                  image={getCardImageByMintUrl(account.mintUrl)}
                  className="w-full max-w-none"
                />
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
