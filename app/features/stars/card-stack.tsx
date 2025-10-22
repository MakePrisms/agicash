import type { CashuAccount } from '~/features/accounts/account';
import {
  ANIMATION_DURATION,
  CARD_ASPECT_RATIO,
  CARD_STACK_OFFSET,
  EASE_IN_OUT,
} from './animation-constants';
import { SelectableWalletCard } from './wallet-card';

interface CardStackProps {
  accounts: CashuAccount[];
  selectedCardIndex: number | null;
  onCardSelect: (accountId: string, event?: React.MouseEvent) => void;
}

/**
 * Displays a stack of wallet cards
 */
export function CardStack({
  accounts,
  selectedCardIndex,
  onCardSelect,
}: CardStackProps) {
  const hasSelection = selectedCardIndex !== null;

  return (
    <div className="relative w-full">
      {/* Spacer element that determines container height based on card stack */}
      <div
        className="pointer-events-none w-full"
        style={{
          aspectRatio: CARD_ASPECT_RATIO.toString(),
          marginBottom: hasSelection
            ? 0
            : `${(accounts.length - 1) * CARD_STACK_OFFSET}px`,
          transition: `margin-bottom ${ANIMATION_DURATION}ms ${EASE_IN_OUT}`,
        }}
      />

      {accounts.map((account, index) => (
        <SelectableWalletCard
          key={account.id}
          account={account}
          isSelected={index === selectedCardIndex}
          index={index}
          onSelect={onCardSelect}
          selectedCardIndex={selectedCardIndex}
          showBalanceOnly={index === accounts.length - 1}
          className="bg-background"
        />
      ))}
    </div>
  );
}
