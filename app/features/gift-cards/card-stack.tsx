import { useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router';

import {
  ClosePageButton,
  Page,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import type { CashuAccount } from '~/features/accounts/account';

import { ExpandedView } from './expanded-view';
import { StackView } from './stack-view';
import { useCardStackState } from './use-card-stack';
import { useDiscoverCards } from './use-discover-cards';

/**
 * Card stack component with expand/collapse animations.
 * Displays cards in a stacked view that can be tapped to expand
 * and show transaction details.
 */
export function GiftCardsView({ accounts }: { accounts: CashuAccount[] }) {
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const discoverMints = useDiscoverCards();
  const [searchParams] = useSearchParams();

  // Get initial selection index from URL query param
  const initialSelectedIndex = useMemo(() => {
    const accountId = searchParams.get('accountId');
    if (!accountId) return null;
    const index = accounts.findIndex((a) => a.id === accountId);
    return index >= 0 ? index : null;
  }, [searchParams, accounts]);

  const {
    selectedIndex,
    phase,
    capturedPosition,
    stackedHeight,
    selectCard,
    collapseStack,
    wasInitializedFromUrl,
  } = useCardStackState({
    cardCount: accounts.length,
    initialSelectedIndex,
    cardRefs,
  });

  // Sync selected account ID to URL query params without triggering navigation
  useEffect(() => {
    const url = new URL(window.location.href);

    if (selectedIndex !== null && accounts[selectedIndex]) {
      url.searchParams.set('accountId', accounts[selectedIndex].id);
    } else {
      url.searchParams.delete('accountId');
    }

    window.history.replaceState(null, '', url.toString());
  }, [selectedIndex, accounts]);

  const showExpanded =
    phase !== 'idle' && selectedIndex !== null && capturedPosition !== null;

  const showTitle = phase === 'idle' || phase === 'exiting';
  const isExiting = phase === 'exiting';

  const handleCloseClick = (e: React.MouseEvent) => {
    if (showExpanded) {
      e.preventDefault();
      collapseStack();
    }
  };

  return (
    <Page className="px-0 pb-0">
      <PageHeader
        className={`absolute inset-x-0 top-0 flex w-full items-center justify-between px-4 pt-4 pb-4 ${showExpanded ? 'z-[60]' : 'z-20'}`}
      >
        <ClosePageButton
          to="/"
          transition="slideLeft"
          applyTo="oldView"
          onClick={handleCloseClick}
        />
        {showTitle && (
          <PageHeaderTitle
            className={isExiting ? 'fade-in animate-in duration-300' : ''}
          >
            Gift Cards
          </PageHeaderTitle>
        )}
      </PageHeader>

      <PageContent className="scrollbar-none relative min-h-0 overflow-y-auto pt-16 pb-0">
        <StackView
          cardRefs={cardRefs}
          accounts={accounts}
          discoverMints={discoverMints}
          stackedHeight={stackedHeight}
          onCardClick={selectCard}
          hideCards={showExpanded}
        />

        {showExpanded && (
          <ExpandedView
            selectedIndex={selectedIndex}
            selectedAccount={accounts[selectedIndex]}
            phase={phase}
            capturedPosition={capturedPosition}
            accounts={accounts}
            onCollapse={collapseStack}
            stackViewCardRefs={cardRefs}
            skipAnimations={wasInitializedFromUrl}
          />
        )}
      </PageContent>
    </Page>
  );
}
