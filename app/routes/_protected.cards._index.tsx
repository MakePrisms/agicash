import { useEffect, useMemo, useState } from 'react';
import { MoneyDisplay } from '~/components/money-display';
import {
  Page,
  PageBackButton,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { useAccounts } from '~/features/accounts/account-hooks';
import { getDefaultUnit } from '~/features/shared/currencies';
import {
  type CardData,
  getAllCardAssets,
  getCardAsset,
} from '~/features/stars/card-types';
import { WalletCard } from '~/features/stars/wallet-card';
import { TransactionList } from '~/features/transactions/transaction-list';
import { sumProofs } from '~/lib/cashu';
import { Money } from '~/lib/money';
import { LinkWithViewTransition } from '~/lib/transitions';
import { cn } from '~/lib/utils';

const useGetCardData = (): CardData[] => {
  const { data: accounts } = useAccounts({
    type: 'cashu',
    starAccountsOnly: true,
  });
  return useMemo(
    () =>
      accounts.map((account) => ({
        id: account.id,
        name: account.name,
        type: account.type,
        logo: account.wallet.cachedMintInfo.iconUrl ?? '',
        mintUrl: account.mintUrl,
        balance: {
          amount: sumProofs(account.proofs),
          currency: account.currency,
        },
        isSelected: false,
      })),
    [accounts],
  );
};

/**
 * Prefetches loyalty card assets for cards that have available assets
 */
function usePrefetchCardAssets(cards: CardData[]) {
  useEffect(() => {
    // Get all available card assets from registry
    const availableAssets = new Set(getAllCardAssets());

    // Prefetch assets for cards that have them
    cards.forEach((card) => {
      const assetPath = getCardAsset(card.mintUrl);
      if (assetPath && availableAssets.has(assetPath)) {
        const img = new Image();
        img.src = assetPath;
      }
    });
  }, [cards]);
}

export default function Cards() {
  const initialCardData = useGetCardData();
  const [cards, setCards] = useState<CardData[]>(initialCardData);

  // Prefetch card assets
  usePrefetchCardAssets(initialCardData);

  const handleCardSelect = (cardId: string, event?: React.MouseEvent) => {
    event?.stopPropagation();

    setCards((prevCards) => {
      const currentCard = prevCards.find((card) => card.id === cardId);

      // If the clicked card is already selected, deselect it
      if (currentCard?.isSelected) {
        return prevCards.map((card) => ({
          ...card,
          isSelected: false,
        }));
      }

      // Otherwise, select the clicked card and deselect others
      return prevCards.map((card) => ({
        ...card,
        isSelected: card.id === cardId,
      }));
    });
  };

  // Find the index of the selected card
  const selectedCardIndex = cards.findIndex((card) => card.isSelected);
  const selectedIndex = selectedCardIndex >= 0 ? selectedCardIndex : null;
  const selectedCard = cards.find((card) => card.isSelected);

  const handleBackButtonClick = (event: React.MouseEvent) => {
    // If a card is selected, deselect it instead of navigating
    const hasSelectedCard = cards.some((card) => card.isSelected);
    if (hasSelectedCard) {
      event.preventDefault();
      setCards((prevCards) =>
        prevCards.map((card) => ({
          ...card,
          isSelected: false,
        })),
      );
    }
  };

  return (
    <Page>
      <PageHeader>
        <PageBackButton
          to="/"
          transition="slideLeft"
          applyTo="newView"
          onClick={handleBackButtonClick}
        />
        <PageHeaderTitle>Loyalty</PageHeaderTitle>
      </PageHeader>

      <PageContent className="flex flex-col overflow-hidden">
        <div className="relative mx-auto w-full max-w-sm flex-shrink-0 pt-8">
          {/* Cards Stack */}
          <div
            className="relative"
            style={{
              minHeight: selectedCard
                ? '222px' // Approximate card height (384px / 1.586 aspect ratio)
                : `${cards.length * 88 + 200}px`, // Stack height when collapsed
            }}
          >
            {cards.map((card, index) => (
              <WalletCard
                key={card.id}
                card={card}
                index={index}
                onSelect={handleCardSelect}
                selectedCardIndex={selectedIndex}
              />
            ))}
          </div>

          {/* Balance and Transaction Sections - appear below selected card */}
          {selectedCard && (
            <div className="px-6">
              {/* Balance Section */}
              <div
                className={cn(
                  'flex flex-col items-center gap-4 transition-all ease-in-out',
                  selectedCard
                    ? 'translate-y-0 opacity-100'
                    : 'translate-y-[-16px] opacity-0',
                )}
                style={{ transitionDuration: '500ms' }}
              >
                <MoneyDisplay
                  variant="secondary"
                  money={
                    new Money({
                      amount: selectedCard.balance.amount,
                      currency: selectedCard.balance.currency,
                      unit: getDefaultUnit(selectedCard.balance.currency),
                    })
                  }
                  unit={getDefaultUnit(selectedCard.balance.currency)}
                  className="font-semibold text-3xl"
                />

                {/* Send and Receive Buttons */}
                <div className="grid w-full grid-cols-2 gap-3">
                  <LinkWithViewTransition
                    to={`/receive?accountId=${selectedCard.id}`}
                    transition="slideUp"
                    className="flex items-center justify-center rounded-lg border border-input bg-background px-6 py-2.5 font-medium text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    Add
                  </LinkWithViewTransition>
                  <LinkWithViewTransition
                    to={`/send?accountId=${selectedCard.id}`}
                    transition="slideUp"
                    className="flex items-center justify-center rounded-lg border border-input bg-background px-6 py-2.5 font-medium text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    Send
                  </LinkWithViewTransition>
                </div>
              </div>

              {/* Transaction History Section Header */}
              {/* <div
                className={cn(
                  'transition-all ease-in-out',
                  selectedCard
                    ? 'mt-6 translate-y-0 opacity-100'
                    : 'mt-0 translate-y-[-16px] opacity-0',
                )}
                style={{
                  transitionDuration: '500ms',
                  transitionDelay: selectedCard ? '100ms' : '0ms',
                }}
              >
                <h4 className="mb-3 font-medium text-muted-foreground text-sm">
                  Recent Transactions
                </h4>
              </div> */}
            </div>
          )}
        </div>

        {/* Scrollable Transaction List */}
        {selectedCard && (
          <div
            className={cn(
              'mx-auto w-full max-w-sm flex-1 overflow-hidden px-6 pt-2 pb-6 transition-all ease-in-out',
              selectedCard
                ? 'translate-y-0 opacity-100'
                : 'translate-y-[-16px] opacity-0',
            )}
            style={{
              transitionDuration: '500ms',
              transitionDelay: selectedCard ? '100ms' : '0ms',
            }}
          >
            <TransactionList accountId={selectedCard.id} />
          </div>
        )}
      </PageContent>
    </Page>
  );
}
