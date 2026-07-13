import type { Currency, Money } from '@agicash/money';
import type {
  AccountPurpose,
  AccountType,
  CashuAccount as DomainCashuAccount,
  SparkAccount as DomainSparkAccount,
} from '../domain/accounts/account';

/** Carries `balance` on every rail, never a raw wallet handle or proof material. */
export type CashuAccount = Omit<
  DomainCashuAccount,
  'keysetCounters' | 'proofs' | 'wallet'
> & { balance: Money | null };
export type SparkAccount = Omit<DomainSparkAccount, 'wallet'>;
export type Account = CashuAccount | SparkAccount;

/** An account with `isDefault` computed against the user's per-currency defaults. */
export type ExtendedAccount<T extends AccountType = AccountType> = Extract<
  Account,
  { type: T }
> & { isDefault: boolean };
export type ExtendedCashuAccount = ExtendedAccount<'cashu'>;
export type ExtendedSparkAccount = ExtendedAccount<'spark'>;

export type AccountsApi = {
  get(id: string): Promise<Account | null>;
  /** Active accounts of the current user. */
  list(): Promise<Account[]>;
  cashu: {
    add(params: AddCashuAccountParams): Promise<CashuAccount>;
  };
};

export type AddCashuAccountParams = {
  name: string;
  mintUrl: string;
  currency: Currency;
  purpose: AccountPurpose;
};
