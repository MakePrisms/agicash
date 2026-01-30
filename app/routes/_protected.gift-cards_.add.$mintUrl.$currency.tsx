import { AddGiftCard } from '~/features/gift-cards/add-gift-card';
import { GIFT_CARDS } from '~/features/gift-cards/use-discover-cards';
import { LoadingScreen } from '~/features/loading/LoadingScreen';
import { NotFoundError } from '~/features/shared/error';
import type { Route } from './+types/_protected.gift-cards_.add.$mintUrl.$currency';

export const clientLoader = ({ params }: Route.ComponentProps) => {
  const { mintUrl, currency } = params;
  const giftCard = GIFT_CARDS.find(
    (card) => card.url === mintUrl && card.currency === currency,
  );
  if (!giftCard) {
    throw new NotFoundError('Gift card not found');
  }

  return { giftCard };
};

clientLoader.hydrate = true as const;

export function HydrateFallback() {
  return <LoadingScreen />;
}

export default function AddGiftCardRoute({ loaderData }: Route.ComponentProps) {
  const { giftCard } = loaderData;

  return <AddGiftCard giftCard={giftCard} />;
}
