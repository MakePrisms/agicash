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
   * Provisions the signed-in user. Fired internally on the auth lifecycle
   * (post-establish), not host-called. Idempotent — creates the user row and
   * default accounts on the first establish of an identity, updates the auth
   * data (email / email-verified) when it changed, and no-ops otherwise.
   * Returns the user with their accounts (carried to the host via the
   * `auth.session-started` event). Terms are recorded separately via
   * `acceptTerms`.
   */
  provision(): Promise<{ user: User; accounts: Account[] }>;
};

export type AcceptTermsParams = {
  /**
   * ISO 8601 timestamp when the user accepted wallet terms — the real click
   * time the host captured (pre-auth pending acceptance replayed post-provision,
   * or an in-session accept), not "now" stamped at the SDK. Omit to leave wallet
   * terms unchanged.
   */
  walletTermsAcceptedAt?: string;
  /**
   * ISO 8601 timestamp when the user accepted gift-card-mint terms. Omit to
   * leave gift-card-mint terms unchanged.
   */
  giftCardMintTermsAcceptedAt?: string;
};

export type SetDefaultAccountParams = {
  account: Account;
  /** Also switch the user's default currency to the account's currency. */
  setDefaultCurrency?: boolean;
};

export type SetDefaultCurrencyParams = {
  currency: Currency;
};
