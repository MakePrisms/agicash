import type { Currency } from '@agicash/money';
import type { Account } from '../accounts/account';
import type { User } from '../user/user';

export type UserApi = {
  get(): Promise<User>;
  updateUsername(username: string): Promise<User>;
  acceptTerms(params: AcceptTermsParams): Promise<User>;
  setDefaultAccount(params: SetDefaultAccountParams): Promise<User>;
  setDefaultCurrency(params: SetDefaultCurrencyParams): Promise<User>;
  /**
   * Bootstraps the signed-in user: upserts the user row (creating default
   * accounts and persisting the derived public keys on first sign-in) and
   * returns the user with their accounts for the host to seed its caches.
   * Idempotent — performs the upsert on every call with the given params; the
   * host owns caching and call-frequency (the web gates it behind its own
   * user-cache short-circuit).
   */
  ensure(
    params: EnsureUserParams,
  ): Promise<{ user: User; accounts: Account[] }>;
};

export type EnsureUserParams = {
  /**
   * ISO 8601 timestamp replayed from the host's pending-terms storage — the
   * time the user accepted wallet terms before the user row existed, not
   * "now". `acceptTerms` is the in-session boolean verb that stamps the time
   * itself.
   */
  termsAcceptedAt?: string;
  /**
   * ISO 8601 timestamp replayed from the host's pending-terms storage — the
   * time the user accepted gift-card-mint terms before the user row existed.
   */
  giftCardMintTermsAcceptedAt?: string;
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
