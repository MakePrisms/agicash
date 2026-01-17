import type {
  NetworkType as SparkNetwork,
  SparkWallet,
} from '@buildonspark/spark-sdk';
import { type ExtendedCashuWallet, getCashuUnit, sumProofs } from '~/lib/cashu';
import { type Currency, Money } from '~/lib/money';
import type { CashuProof } from './cashu-account';

export type AccountType = 'cashu' | 'spark';

export type Account = {
  id: string;
  name: string;
  type: AccountType;
  isOnline: boolean;
  currency: Currency;
  createdAt: string;
  /**
   * Row version.
   * Used for optimistic locking.
   */
  version: number;
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
      balance: Money | null;
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
