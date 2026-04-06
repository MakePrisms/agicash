import type {
  NetworkType as SparkNetwork,
  SparkWallet,
} from '@buildonspark/spark-sdk';
import type { DistributedOmit } from 'type-fest';
import { type ExtendedCashuWallet, getCashuUnit, sumProofs } from '~/lib/cashu';
import type { MintPurpose } from '~/lib/cashu/protocol-extensions';
import { type Currency, Money } from '~/lib/money';
import type { CashuProof } from './cashu-account';

export type AccountType = 'cashu' | 'spark';

/**
 * Account purpose. Maps to MintPurpose for cashu accounts.
 */
export type AccountPurpose = MintPurpose;

export type Account = {
  id: string;
  name: string;
  type: AccountType;
  purpose: AccountPurpose;
  isOnline: boolean;
  currency: Currency;
  createdAt: string;
  /**
   * Row version.
   * Used for optimistic locking.
   */
  version: number;
  /**
   * The account expiry time, as an ISO 8601 timestamp.
   * For offer accounts, this is when the ecash expires (derived from keyset expiry).
   * Null for accounts that don't expire.
   */
  expiresAt: string | null;
} & (
  | {
      type: 'cashu';
      mintUrl: string;
      isTestMint: boolean;
      /**
       * Holds counter value for each mint keyset. Key is the keyset id, value is counter value.
       */
      keysetCounters: Record<string, number>;
      /**
       * Holds all cashu proofs for the account.
       * Amounts are denominated in the cashu units (e.g. sats for BTC accounts, cents for USD accounts).
       */
      proofs: CashuProof[];
      wallet: ExtendedCashuWallet;
    }
  | {
      type: 'spark';
      ownedBalance: Money | null;
      availableBalance: Money | null;
      network: SparkNetwork;
      /**
       * The Spark wallet instance for the account.
       * If the wallet is not online, this will be a stub that throws on any method call.
       */
      wallet: SparkWallet;
    }
);

export type ExtendedAccount<T extends AccountType = AccountType> = Extract<
  Account,
  { type: T }
> & { isDefault: boolean };

export type CashuAccount = Extract<Account, { type: 'cashu' }>;
export type SparkAccount = Extract<Account, { type: 'spark' }>;
export type ExtendedCashuAccount = ExtendedAccount<'cashu'>;
export type ExtendedSparkAccount = ExtendedAccount<'spark'>;

/**
 * Account type without sensitive data (e.g. proofs for cashu accounts).
 * Useful for cases where you need to use non sensitive account data in contexts
 * where sensitive data cannot be decrypted (on server).
 */
export type RedactedAccount = DistributedOmit<Account, 'proofs'>;
export type RedactedCashuAccount = Extract<RedactedAccount, { type: 'cashu' }>;

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
  return !account.wallet.getMintInfo().isSupported(5).disabled;
};

/**
 * Returns true if the account can receive payments via the Lightning network.
 * Returns false for test mints and mints with minting disabled (NUT-04).
 */
export const canReceiveFromLightning = (account: Account): boolean => {
  if (account.type === 'spark') return true;
  if (account.isTestMint) return false;
  return !account.wallet.getMintInfo().isSupported(4).disabled;
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
  return account.ownedBalance;
};
