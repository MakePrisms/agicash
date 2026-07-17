import type { Currency } from '@agicash/money';
import type { Account } from '../accounts/account';
import type { User } from '../user/user';

export type UserApi = {
  get(): Promise<User>;
  updateUsername(username: string): Promise<User>;
  acceptTerms(params: AcceptTermsParams): Promise<User>;
  setDefaultAccount(params: SetDefaultAccountParams): Promise<User>;
  setDefaultCurrency(params: SetDefaultCurrencyParams): Promise<User>;
};

export type AcceptTermsParams = {
  walletTerms?: boolean;
  giftCardTerms?: boolean;
};

export type SetDefaultAccountParams = {
  account: Account;
  /** Also switch the user's default currency to the account's currency. */
  setDefaultCurrency?: boolean;
};

export type SetDefaultCurrencyParams = {
  currency: Currency;
};
