import { useNavigate, useViewTransitionState } from 'react-router';

import {
  ClosePageButton,
  Page,
  PageContent,
  PageHeader,
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
import { getGiftCardImageByUrl } from './gift-card-images';
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

  const isExpired = offer.state === 'expired';
  const balance = isExpired ? null : getAccountBalance(offer);

  return (
    <Page>
      <PageHeader>
        <ClosePageButton to="/gift-cards" />
      </PageHeader>

      <PageContent className="scrollbar-none relative min-h-0 gap-0 overflow-y-auto pb-0">
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
                image={getGiftCardImageByUrl(offer.mintUrl)}
              />
            </button>
          </div>

          {offer.expiresAt && (
            <p className="mt-2 text-center text-muted-foreground text-sm">
              {isExpired ? 'Expired on ' : 'Expires '}
              {formatExpiryDate(offer.expiresAt)}
            </p>
          )}
        </div>

        <div className="mx-auto flex flex-col items-center px-4 pt-3 pb-8">
          {balance && <MoneyWithConvertedAmount money={balance} size="md" />}

          {!isExpired && (
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
          )}
        </div>
      </PageContent>
    </Page>
  );
}
