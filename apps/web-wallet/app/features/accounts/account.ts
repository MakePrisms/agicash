// Most of accounts/account moved to @agicash/wallet-sdk; this shim is removed in the
// import-cleanup PR. getAccountHomePath returns app route strings (web-only — it has no
// meaning for a non-React SDK consumer), so it stays here.
import type { Account } from '@agicash/wallet-sdk/accounts/account';

export * from '@agicash/wallet-sdk/accounts/account';

/**
 * Returns the home path for an account based on its purpose.
 */
export const getAccountHomePath = (account: Account): string => {
  switch (account.purpose) {
    case 'gift-card':
      return `/gift-cards/${account.id}`;
    case 'offer':
      return `/gift-cards/offers/${account.id}`;
    default:
      return '/';
  }
};
