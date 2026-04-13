import { useAccount } from '~/features/accounts/account-hooks';
import OfferDetails from '~/features/gift-cards/offer-details';
import type { Route } from './+types/_protected.gift-cards.offers.$accountId';

export default function OfferDetailsRoute({ params }: Route.ComponentProps) {
  const account = useAccount(params.accountId);
  if (account.type !== 'cashu' || account.purpose !== 'offer') {
    throw new Response('Offer not found', { status: 404 });
  }
  return <OfferDetails offer={account} />;
}
