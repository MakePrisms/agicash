import { Page } from '~/components/page';
import { Redirect } from '~/components/redirect';
import { useAccount } from '~/features/accounts/account-hooks';
import { BuyCheckoutCashu, BuyCheckoutSpark } from '~/features/buy';
import { useReceiveStore } from '~/features/receive/receive-provider';

export default function BuyCheckoutPage() {
  const buyAmount = useReceiveStore((s) => s.amount);
  const buyAccountId = useReceiveStore((s) => s.accountId);
  const quote = useReceiveStore((s) => s.quote);
  const account = useAccount(buyAccountId);

  if (!buyAmount || !quote) {
    return <Redirect to="/buy" />;
  }

  return (
    <Page>
      {account.type === 'cashu' ? (
        <BuyCheckoutCashu quote={quote} amount={buyAmount} />
      ) : (
        <BuyCheckoutSpark quote={quote} amount={buyAmount} />
      )}
    </Page>
  );
}
