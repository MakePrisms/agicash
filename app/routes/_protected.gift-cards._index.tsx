import { useAccounts } from '~/features/accounts/account-hooks';
import { GiftCardsView } from '~/features/gift-cards/card-stack';

export default function GiftCardsIndex() {
  const { data: giftCardAccounts } = useAccounts({
    type: 'cashu',
    onlyIncludeClosedLoopAccounts: true,
  });

  return <GiftCardsView accounts={giftCardAccounts} />;
}
