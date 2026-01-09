import {
  ClosePageButton,
  Page,
  PageContent,
  PageHeader,
  PageHeaderTitle,
} from '~/components/page';
import { useAccounts } from '~/features/accounts/account-hooks';
import { StackView } from '~/features/gift-cards/stack-view';
import { useDiscoverCards } from '~/features/gift-cards/use-discover-cards';

export default function GiftCardsIndex() {
  const { data: giftCardAccounts } = useAccounts({
    type: 'cashu',
    onlyIncludeClosedLoopAccounts: true,
  });
  const discoverMints = useDiscoverCards();

  return (
    <Page className="px-0 pb-0">
      <PageHeader className="absolute inset-x-0 top-0 z-20 flex w-full items-center justify-between px-4 pt-4 pb-4">
        <ClosePageButton to="/" transition="slideLeft" applyTo="oldView" />
        <PageHeaderTitle>Gift Cards</PageHeaderTitle>
      </PageHeader>

      <PageContent className="scrollbar-none relative min-h-0 overflow-y-auto pt-16 pb-0">
        <StackView accounts={giftCardAccounts} discoverMints={discoverMints} />
      </PageContent>
    </Page>
  );
}
