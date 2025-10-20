import { useState } from 'react';
import {
  Page,
  PageBackButton,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { useAccounts } from '~/features/accounts/account-hooks';
import { CardStack } from '~/features/stars/card-stack';
import { SelectedCardDetails } from '~/features/stars/selected-card-details';
export default function Cards() {
  const { data: starAccounts } = useAccounts({
    type: 'cashu',
    starAccountsOnly: true,
  });

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    starAccounts.length === 1 ? starAccounts[0].id : null,
  );
  const selectedCardIndex = starAccounts.findIndex(
    (acc) => acc.id === selectedAccountId,
  );
  const selectedAccount =
    selectedCardIndex >= 0 ? starAccounts[selectedCardIndex] : null;

  const handleCardSelect = (accountId: string, event?: React.MouseEvent) => {
    event?.stopPropagation();

    // If only one card, keep it selected
    if (starAccounts.length === 1) {
      return;
    }

    // Toggle selection: if already selected, deselect it
    setSelectedAccountId((prev) => (prev === accountId ? null : accountId));
  };

  const handleBackButtonClick = (event: React.MouseEvent) => {
    // If only one card, don't prevent back navigation
    if (starAccounts.length === 1) {
      return;
    }

    // If a card is selected, deselect it instead of navigating
    if (selectedAccount) {
      event.preventDefault();
      setSelectedAccountId(null);
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
        <div className="relative mx-auto flex min-h-0 w-full max-w-sm flex-1 flex-col overflow-hidden">
          {/* Cards Stack */}
          <div className="flex-shrink-0 md:pt-16">
            <CardStack
              accounts={starAccounts}
              selectedCardIndex={
                selectedCardIndex >= 0 ? selectedCardIndex : null
              }
              onCardSelect={handleCardSelect}
            />
          </div>

          {/* Selected Card Details: Send/Receive buttons and transaction list */}
          {selectedAccount && (
            <SelectedCardDetails
              account={selectedAccount}
              isVisible={!!selectedAccount}
            />
          )}
        </div>
      </PageContent>
    </Page>
  );
}
