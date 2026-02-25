import { AddGiftCard } from '~/features/gift-cards/add-gift-card';
import { getGiftCardByUrl } from '~/features/gift-cards/use-discover-cards';
import { NotFoundError } from '~/features/shared/error';
import type { Route } from './+types/_protected.gift-cards_.add.$mintUrl.$currency';

export default function AddGiftCardRoute({ params }: Route.ComponentProps) {
  const giftCard = getGiftCardByUrl(params.mintUrl);

  if (!giftCard) {
    throw new NotFoundError('Gift card not found');
  }

  return <AddGiftCard giftCard={giftCard} />;
}
