import { type Account, getAccountBalance } from '~/features/accounts/account';
import type { Money } from '~/lib/money';

/**
 * Returns true when the amount exceeds the account's available balance.
 * Does not consider potential fees — those are checked in the quote services.
 */
export const exceedsAccountBalance = (
  amount: Money,
  amountInOtherCurrency: Money | undefined,
  account: Account,
): boolean => {
  const amountInAccountCurrency =
    amount.currency === account.currency ? amount : amountInOtherCurrency;
  if (!amountInAccountCurrency || amountInAccountCurrency.isZero()) {
    return false;
  }
  const balance = getAccountBalance(account);
  if (!balance) {
    return false;
  }
  return amountInAccountCurrency.amount().gt(balance.amount());
};
