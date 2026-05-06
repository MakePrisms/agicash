import { useAccountOrNull } from '~/features/accounts/account-hooks';
import OfferDetails from '~/features/gift-cards/offer-details';
import { NotFoundError } from '~/features/shared/error';
import type { Route } from './+types/_protected.gift-cards.offers.$accountId';

export default function OfferDetailsRoute({ params }: Route.ComponentProps) {
  const account = useAccountOrNull(params.accountId);

  if (!account || account.type !== 'cashu' || account.purpose !== 'offer') {
    throw new NotFoundError('Offer not found');
  }

  return <OfferDetails offer={account} />;
}
