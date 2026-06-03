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

/**
 * Input to {@link AccountsDomain.add}. A cashu account is pinned to a mint URL;
 * a spark account needs no URL (its keys are seed-derived internally). `name`
 * defaults to a generated label when omitted.
 */
export type AddAccountConfig =
  | { type: 'cashu'; mintUrl: string; currency: Currency; name?: string }
  | { type: 'spark'; currency: Currency; name?: string }; // seed-derived internally

/**
 * The result of {@link AccountsDomain.suggestFor} — which of the passed-in
 * accounts to use for a payment intent. Net-new logic (generalizes master's
 * `findMatchingOfferOrGiftCardAccount` + online-filter + default fallback);
 * computed purely over the accounts the caller hands in.
 */
export type AccountSuggestion = {
  /** The best account to use for the intent. */
  recommended: Account;
  /** Other accounts with sufficient balance, ranked lower than `recommended`. */
  alternatives: Account[];
  /** Accounts that match but lack sufficient balance for the intent. */
  insufficient: Account[];
  /** Human-readable basis for the recommendation, e.g. "gift-card-mint match" | "default cashu". */
  reason: string;
};
