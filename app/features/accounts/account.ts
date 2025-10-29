import type {
  NetworkType as SparkNetwork,
  SparkWallet,
} from '@buildonspark/spark-sdk';
import type { Proof } from '@cashu/cashu-ts';
import { type ExtendedCashuWallet, getCashuUnit, sumProofs } from '~/lib/cashu';
import { type Currency, Money } from '~/lib/money';

export type AccountType = 'cashu' | 'nwc' | 'spark';

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
      proofs: Proof[];
      wallet: ExtendedCashuWallet;
    }
  | {
      type: 'nwc';
      nwcUrl: string;
    }
  | {
      type: 'spark';
      balance: Money;
      wallet: SparkWallet;
      network: SparkNetwork;
    }
);

export type ExtendedAccount<T extends AccountType = AccountType> = Extract<
  Account,
  { type: T }
> & { isDefault: boolean };

export type CashuAccount = Extract<Account, { type: 'cashu' }>;
export type ExtendedCashuAccount = ExtendedAccount<'cashu'>;
export type SparkAccount = Extract<Account, { type: 'spark' }>;

export const getAccountBalance = (account: Account) => {
  if (account.type === 'cashu') {
    const value = sumProofs(account.proofs);
    return new Money({
      amount: value,
      currency: account.currency,
      unit: getCashuUnit(account.currency),
    });
  }
  if (account.type === 'spark') {
    return account.balance;
  }
  // TODO: implement balance logic for other account types
  return new Money({ amount: 0, currency: account.currency });
};
