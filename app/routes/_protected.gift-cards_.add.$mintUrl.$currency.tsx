import { AddGiftCard } from '~/features/gift-cards/add-gift-card';
import type { Currency } from '~/lib/money/types';
import type { Route } from './+types/_protected.gift-cards_.add.$mintUrl.$currency';

export default function AddGiftCardPage({
  params: { mintUrl, currency },
}: Route.ComponentProps) {
  return <AddGiftCard mintUrl={mintUrl} currency={currency as Currency} />;
}
