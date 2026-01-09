import { Button } from '~/components/ui/button';
import {
  type CashuAccount,
  getAccountBalance,
} from '~/features/accounts/account';
import { MoneyWithConvertedAmount } from '~/features/shared/money-with-converted-amount';
import { TransactionList } from '~/features/transactions/transaction-list';
import { LinkWithViewTransition } from '~/lib/transitions';

import type { CapturedCardPosition } from './card-stack-animation';
import { CONTENT_TOP } from './card-stack.constants';
import { GiftCardItem } from './gift-card-item';
import { type CardStackPhase, useCardAnimationStyles } from './use-card-stack';
import { getCardImageByMintUrl } from './use-discover-cards';

type ExpandedViewProps = {
  selectedIndex: number;
  selectedAccount: CashuAccount;
  phase: CardStackPhase;
  capturedPosition: CapturedCardPosition;
  accounts: CashuAccount[];
  onCollapse: () => void;
  stackViewCardRefs: React.RefObject<(HTMLButtonElement | null)[]>;
  /** Skip entrance animations (e.g., when restoring from URL) */
  skipAnimations?: boolean;
};

/**
 * Expanded view displayed when a card is selected.
 * Shows the selected card centered with animated transitions
 * and a transaction list below.
 */
export function ExpandedView({
  selectedIndex,
  selectedAccount,
  phase,
  capturedPosition,
  accounts,
  onCollapse,
  stackViewCardRefs,
  skipAnimations = false,
}: ExpandedViewProps) {
  const { cardStyles, cardWidth } = useCardAnimationStyles(
    phase,
    selectedIndex,
    accounts.length,
    capturedPosition,
    stackViewCardRefs,
  );

  const isTransitioning = phase === 'entering' || phase === 'exiting';
  const balance = getAccountBalance(selectedAccount);

  return (
    <div
      className={`scrollbar-none fixed inset-0 z-50 overflow-y-auto ${phase !== 'exiting' ? 'bg-background' : ''}`}
    >
      {/* Animated cards during transitions */}
      {isTransitioning &&
        accounts.map((account, index) => {
          const style = cardStyles.get(index);
          if (!style) return null;
          const isSelected = index === selectedIndex;

          return (
            <button
              key={account.id}
              type="button"
              onClick={isSelected ? onCollapse : undefined}
              aria-label={
                isSelected
                  ? `Collapse ${account.name} card`
                  : `${account.name} card`
              }
              className="absolute"
              style={{
                ...style,
                zIndex: 1 + index,
                pointerEvents: isSelected ? 'auto' : 'none',
              }}
            >
              <GiftCardItem
                account={account}
                image={getCardImageByMintUrl(account.mintUrl)}
                className="w-full max-w-none"
                overlayHidden={phase !== 'exiting'}
              />
            </button>
          );
        })}

      {/* Scrollable content when settled */}
      {phase === 'settled' && (
        <div
          className="flex flex-col items-center pb-8"
          style={{ paddingTop: CONTENT_TOP }}
        >
          {/* Selected card */}
          <button
            type="button"
            onClick={onCollapse}
            aria-label={`Collapse ${selectedAccount.name} card`}
            style={{ width: cardWidth }}
          >
            <GiftCardItem
              account={selectedAccount}
              image={getCardImageByMintUrl(selectedAccount.mintUrl)}
              className="w-full max-w-none"
              overlayHidden
            />
          </button>

          {/* Balance and actions */}
          <div
            className={`mt-4 flex flex-col items-center gap-4 ${skipAnimations ? '' : 'fade-in slide-in-from-bottom-4 animate-in fill-mode-both duration-300'}`}
            style={
              skipAnimations
                ? { width: cardWidth }
                : { animationDelay: '50ms', width: cardWidth }
            }
          >
            {balance && <MoneyWithConvertedAmount money={balance} size="md" />}

            <div className="grid w-72 grid-cols-2 gap-10">
              <LinkWithViewTransition
                to={`/receive?accountId=${selectedAccount.id}`}
                transition="slideUp"
                applyTo="newView"
              >
                <Button className="w-full px-7 py-6 text-lg">Add</Button>
              </LinkWithViewTransition>
              <LinkWithViewTransition
                to={`/send?accountId=${selectedAccount.id}`}
                transition="slideUp"
                applyTo="newView"
              >
                <Button className="w-full px-7 py-6 text-lg">Send</Button>
              </LinkWithViewTransition>
            </div>

            {/* Transaction list */}
            <div className="w-full pb-14">
              <TransactionList
                accountId={selectedAccount.id}
                className="h-auto overflow-visible"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
