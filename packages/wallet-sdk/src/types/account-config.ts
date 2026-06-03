/**
 * Account create-config + suggestion types — §2 of the contract.
 *
 * `AddAccountConfig` is the input to `accounts.add`. `AccountSuggestion` is the
 * output of `accounts.suggestFor` — NET-NEW logic (generalizes master's
 * `findMatchingOfferOrGiftCardAccount` + online-filter + default fallback);
 * the SHAPES are defined by the contract, not lifted from a single master type.
 */
import type { Account } from './account';
import type { Currency } from './money';

export type AddAccountConfig =
  | { type: 'cashu'; mintUrl: string; currency: Currency; name?: string }
  | { type: 'spark'; currency: Currency; name?: string }; // seed-derived internally

export type AccountSuggestion = {
  recommended: Account;
  /** sufficient balance, lower priority */
  alternatives: Account[];
  insufficient: Account[];
  /** e.g. "gift-card-mint match" | "default cashu" | ... */
  reason: string;
};
