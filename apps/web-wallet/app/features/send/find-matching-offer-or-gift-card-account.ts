import type { DecodedBolt11 } from '@agicash/bolt11';
import { type Currency, Money } from '@agicash/money';
import type { Account, CashuAccount } from '@agicash/wallet-sdk';
import type { GiftCardInfo } from '@agicash/wallet-sdk';
import { getAccountBalance } from '@agicash/wallet-sdk/temporary';

type FindMatchingOfferOrGiftCardAccountInput = {
  decodedBolt11: DecodedBolt11;
  accounts: Account[];
  giftCards: GiftCardInfo[];
};

/**
 * Finds an offer or a gift card account with sufficient balance matching a
 * BOLT11 invoice. Priority: `offer` > `gift-card`. Returns null if nothing
 * matches.
 */
export const findMatchingOfferOrGiftCardAccount = ({
  decodedBolt11,
  accounts,
  giftCards,
}: FindMatchingOfferOrGiftCardAccountInput): CashuAccount | null => {
  const { description, payeeNodeKey, amountSat } = decodedBolt11;

  const invoiceAmount = amountSat
    ? new Money<Currency>({ amount: amountSat, currency: 'BTC', unit: 'sat' })
    : null;

  const isAllowedDestination = (
    config: NonNullable<GiftCardInfo['validPaymentDestinations']>,
  ): boolean => {
    const { descriptions, nodePubkeys } = config;

    // Each populated list is a required check; empty = no constraint.
    // Both empty = unconfigured mint, never matches.
    if (descriptions.length === 0 && nodePubkeys.length === 0) return false;
    if (
      descriptions.length > 0 &&
      (!description || !descriptions.includes(description))
    ) {
      return false;
    }
    if (nodePubkeys.length > 0 && !nodePubkeys.includes(payeeNodeKey)) {
      return false;
    }
    return true;
  };

  const giftCardByUrl = new Map(giftCards.map((g) => [g.url, g]));

  const offers: CashuAccount[] = [];
  const cards: CashuAccount[] = [];

  for (const account of accounts) {
    if (account.type !== 'cashu' || account.currency !== 'BTC') continue;

    const config = giftCardByUrl.get(account.mintUrl)?.validPaymentDestinations;
    if (!config || !isAllowedDestination(config)) continue;

    if (account.purpose === 'offer') {
      offers.push(account);
    } else if (account.purpose === 'gift-card') {
      cards.push(account);
    }
  }

  const hasSufficientBalance = (account: CashuAccount) => {
    const balance = getAccountBalance(account);
    if (!balance) return false;
    return invoiceAmount
      ? balance.greaterThanOrEqual(invoiceAmount)
      : balance.isPositive();
  };

  return (
    offers.find(hasSufficientBalance) ??
    cards.find(hasSufficientBalance) ??
    null
  );
};
