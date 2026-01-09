import {
  ClosePageButton,
  Page,
  PageContent,
  PageHeader,
} from '~/components/page';
import { useAccount } from '~/features/accounts/account-hooks';
import { GiftCardDetail } from '~/features/gift-cards/gift-card-detail';
import { useNavigateWithViewTransition } from '~/lib/transitions';
import type { Route } from './+types/_protected.gift-cards.$accountId';

export default function GiftCardDetailPage({
  params: { accountId },
}: Route.ComponentProps) {
  const account = useAccount<'cashu'>(accountId);
  const navigate = useNavigateWithViewTransition();

  const handleCardClick = () => {
    navigate('/gift-cards', {
      transition: 'fade',
      applyTo: 'oldView',
      state: { transitioningCardId: accountId },
    });
  };

  return (
    <Page className="px-0 pb-0">
      <PageHeader className="absolute inset-x-0 top-0 z-20 flex w-full items-center justify-between px-4 pt-4 pb-4">
        <ClosePageButton
          to="/gift-cards"
          transition="fade"
          applyTo="oldView"
          state={{ transitioningCardId: accountId }}
        />
      </PageHeader>

      <PageContent className="scrollbar-none relative min-h-0 overflow-y-auto pt-0 pb-0">
        <GiftCardDetail account={account} onCardClick={handleCardClick} />
      </PageContent>
    </Page>
  );
}
