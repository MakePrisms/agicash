import { Page } from '~/components/page';
import { Redirect } from '~/components/redirect';
import { useAccount } from '~/features/accounts/account-hooks';
import {
  BuyCheckoutCashu,
  BuyCheckoutRedirect,
  BuyCheckoutSpark,
} from '~/features/buy';
import { getPendingCashAppBuy } from '~/features/buy/pending-cashapp-buy';
import { useReceiveStore } from '~/features/receive/receive-provider';

export default function BuyCheckoutPage() {
  const buyAmount = useReceiveStore((s) => s.amount);
  const buyAccountId = useReceiveStore((s) => s.accountId);
  const quote = useReceiveStore((s) => s.quote);
  const account = useAccount(buyAccountId);

  // Desktop flow: Zustand store has quote data
  if (buyAmount && quote) {
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

  // Mobile redirect flow: cookie has pending buy data
  const pendingBuy = getPendingCashAppBuy();
  if (pendingBuy) {
    return (
      <Page>
        <BuyCheckoutRedirect data={pendingBuy} />
      </Page>
    );
  }

  return <Redirect to="/buy" />;
}
