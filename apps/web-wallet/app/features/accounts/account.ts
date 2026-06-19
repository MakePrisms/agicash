import { Money } from '@agicash/money';
import { z } from 'zod/mini';
import { getCashuUnit, sumProofs } from '~/lib/cashu';

// The Account domain type + its derivations are owned by @agicash/wallet-sdk.
// The web re-exports them so existing `./account` import sites are unchanged.
export type {
  Account,
  AccountType,
  AccountState,
  AccountPurpose,
  ExtendedAccount,
  CashuAccount,
  SparkAccount,
  ExtendedCashuAccount,
  ExtendedSparkAccount,
  RedactedAccount,
  RedactedCashuAccount,
} from '@agicash/wallet-sdk';

import type { Account, AccountPurpose } from '@agicash/wallet-sdk';

// Runtime zod schemas the SDK has no equivalent for. Their inferred string
// unions match the SDK's AccountType / AccountPurpose exactly.
export const AccountTypeSchema = z.enum(['cashu', 'spark']);
export const AccountPurposeSchema = z.enum([
  'transactional',
  'gift-card',
  'offer',
]);

/**
 * Returns true if adding this account requires the user to accept gift-card
 * mint terms. Mirrors the DB trigger `enforce_gift_card_mint_terms_on_account_create`.
 */
export const accountRequiresGiftCardTermsAcceptance = (account: {
  purpose: AccountPurpose;
}): boolean => {
  return account.purpose === 'gift-card' || account.purpose === 'offer';
};

/**
 * Returns true if the account can send payments through the Lightning network.
 * Returns false for test mints, non-transactional accounts, and mints with
 * melting disabled (NUT-05).
 */
export const canSendToLightning = (account: Account): boolean => {
  if (account.type === 'spark') {
    return true;
  }
  if (account.isTestMint) return false;
  if (account.purpose !== 'transactional') return false;
  if (!account.isOnline) return false;
  return !account.wallet.getMintInfo().isSupported(5).disabled;
};

/**
 * Returns true if the account can receive payments via the Lightning network.
 * Returns false for test mints and mints with minting disabled (NUT-04).
 */
export const canReceiveFromLightning = (account: Account): boolean => {
  if (account.type === 'spark') return true;
  if (account.isTestMint) return false;
  if (!account.isOnline) return false;
  return !account.wallet.getMintInfo().isSupported(4).disabled;
};

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

export const getAccountBalance = (account: Account) => {
  if (account.type === 'cashu') {
    const value = sumProofs(account.proofs);
    return new Money({
      amount: value,
      currency: account.currency,
      unit: getCashuUnit(account.currency),
    });
  }
  return account.balance;
};
