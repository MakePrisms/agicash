import { Page } from '~/components/page';
import { Redirect } from '~/components/redirect';
import { useAccount } from '~/features/accounts/account-hooks';
import { BuyCheckoutCashu, BuyCheckoutSpark } from '~/features/buy';
import { useBuyStore } from '~/features/buy/buy-provider';

export default function BuyCheckoutPage() {
  const buyAmount = useBuyStore((s) => s.amount);
  const buyAccountId = useBuyStore((s) => s.accountId);
  const quote = useBuyStore((s) => s.quote);
  const account = useAccount(buyAccountId);

  if (!buyAmount || !quote) {
    return <Redirect to="/buy" />;
  }

  return (
    <Page>
      {account.type === 'cashu' ? (
        <BuyCheckoutCashu
          quote={quote}
          amount={buyAmount}
          accountName={account.name}
        />
      ) : (
        <BuyCheckoutSpark
          quote={quote}
          amount={buyAmount}
          accountName={account.name}
        />
      )}
    </Page>
  );
}
