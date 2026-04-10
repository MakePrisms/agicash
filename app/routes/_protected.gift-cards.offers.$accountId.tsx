import OfferDetails from '~/features/gift-cards/offer-details';
import type { Route } from './+types/_protected.gift-cards.offers.$accountId';

export default function OfferDetailsRoute({ params }: Route.ComponentProps) {
  return <OfferDetails accountId={params.accountId} />;
}
