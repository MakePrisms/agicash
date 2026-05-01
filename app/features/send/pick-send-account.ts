import {
  type Account,
  type AccountPurpose,
  type CashuAccount,
  getAccountBalance,
} from '~/features/accounts/account';
import type { GiftCardInfo } from '~/features/gift-cards/use-discover-cards';
import type { DecodedBolt11 } from '~/lib/bolt11';
import { type Currency, Money } from '~/lib/money';

type PickSendAccountInput = {
  decodedBolt11: DecodedBolt11;
  accounts: Account[];
  giftCards: GiftCardInfo[];
};

/**
 * Finds a cashu account matching a BOLT11 invoice's description.
 * Priority: `offer` > `gift-card`. BTC only. Returns null if nothing matches.
 */
export const pickSendAccount = ({
  decodedBolt11,
  accounts,
  giftCards,
}: PickSendAccountInput): Account | null => {
  const { description, amountSat } = decodedBolt11;
  if (!description) return null;

  const invoiceAmount = amountSat
    ? new Money({ amount: amountSat, currency: 'BTC' as Currency, unit: 'sat' })
    : null;

  const giftCardByUrl = new Map(giftCards.map((g) => [g.url, g]));

  const candidates = accounts.reduce<CashuAccount[]>((acc, account) => {
    if (account.type !== 'cashu' || account.currency !== 'BTC') return acc;
    const config = giftCardByUrl.get(account.mintUrl);
    if (config?.validPaymentDestinations?.descriptions.includes(description)) {
      acc.push(account);
    }
    return acc;
  }, []);

  const pickByPurpose = (purpose: AccountPurpose) =>
    candidates
      .filter((account) => account.purpose === purpose)
      .find((account) => {
        const balance = getAccountBalance(account) as Money<'BTC'> | undefined;
        if (!balance) return false;
        return invoiceAmount
          ? balance.greaterThanOrEqual(invoiceAmount as Money<'BTC'>)
          : balance.isPositive();
      });

  return pickByPurpose('offer') ?? pickByPurpose('gift-card') ?? null;
};
