import GiftCardDetails from '~/features/gift-cards/gift-card-details';
import type { Route } from './+types/_protected.gift-cards.$cardId._index';

export default function GiftCardDetailsRoute({ params }: Route.ComponentProps) {
  return <GiftCardDetails cardId={params.cardId} />;
}
