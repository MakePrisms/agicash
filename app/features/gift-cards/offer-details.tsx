import { X } from 'lucide-react';
import { useNavigate, useViewTransitionState } from 'react-router';

import {
  Page,
  PageContent,
  PageHeader,
  PageHeaderItem,
} from '~/components/page';
import { Button } from '~/components/ui/button';
import {
  type CashuAccount,
  getAccountBalance,
} from '~/features/accounts/account';
import { MoneyWithConvertedAmount } from '~/features/shared/money-with-converted-amount';
import { useBuildLinkWithSearchParams } from '~/hooks/use-search-params-link';
import { LinkWithViewTransition } from '~/lib/transitions';
import { CARD_WIDTH } from './card-stack-constants';
import { getOfferCardImageByUrl } from './offer-card-images';
import { OfferItem } from './offer-item';

function formatExpiryDate(expiresAt: string): string {
  const date = new Date(expiresAt);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

type OfferDetailsProps = {
  offer: CashuAccount;
};

export default function OfferDetails({ offer }: OfferDetailsProps) {
  const navigate = useNavigate();
  const buildLinkWithSearchParams = useBuildLinkWithSearchParams();
  const isTransitioning = useViewTransitionState('/gift-cards');

  const handleBack = () => {
    navigate('/gift-cards', { viewTransition: true });
  };

  const balance = getAccountBalance(offer);

  return (
    <Page className="px-0 pb-0">
      <PageHeader className="absolute inset-x-0 top-0 z-[60] flex w-full items-center justify-between px-4 pt-4 pb-4">
        <PageHeaderItem position="left">
          <button type="button" onClick={handleBack} aria-label="Close">
            <X />
          </button>
        </PageHeaderItem>
      </PageHeader>

      <PageContent className="scrollbar-none relative min-h-0 gap-0 overflow-y-auto pt-16 pb-0">
        <div className="w-full px-4">
          <div
            className="relative mx-auto w-full"
            style={{
              maxWidth: CARD_WIDTH,
              viewTransitionName: isTransitioning
                ? `offer-${offer.id}`
                : undefined,
            }}
          >
            <button
              type="button"
              onClick={handleBack}
              className="w-full"
              aria-label={`Close ${offer.name} offer`}
            >
              <OfferItem
                account={offer}
                image={getOfferCardImageByUrl(offer.mintUrl)}
              />
            </button>
          </div>

          {offer.expiresAt && (
            <p className="mt-2 text-center text-muted-foreground text-sm">
              Expires {formatExpiryDate(offer.expiresAt)}
            </p>
          )}
        </div>

        <div className="mx-auto flex flex-col items-center px-4 pt-3 pb-8">
          {balance && <MoneyWithConvertedAmount money={balance} size="md" />}

          <div className="mt-6">
            <LinkWithViewTransition
              to={buildLinkWithSearchParams('/send', {
                accountId: offer.id,
                redirectTo: `/gift-cards/offers/${offer.id}`,
              })}
              transition="slideUp"
              applyTo="newView"
            >
              <Button className="w-full px-14 py-6 text-lg">Pay</Button>
            </LinkWithViewTransition>
          </div>
        </div>
      </PageContent>
    </Page>
  );
}
