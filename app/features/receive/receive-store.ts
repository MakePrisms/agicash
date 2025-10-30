import { create } from 'zustand';
import type { Currency, Money } from '~/lib/money';
import type { Account, ExtendedAccount } from '../accounts/account';

export type ReceiveState<T extends Currency = Currency> = {
  /** The ID of the account to receive funds in */
  accountId: string;
  /** The amount to receive in the account's currency */
  amount: Money<T> | null;
  /** Whether to pay from default account (for auto-paying invoices) */
  payFromDefaultAccount: boolean;
  /** Set the account to receive funds in */
  setAccount: (account: Account) => void;
  /** Set the amount to receive in the account's currency */
  setAmount: (amount: Money<T>) => void;
  /** Set whether to pay from default account */
  setPayFromDefaultAccount: (value: boolean) => void;
};

export const createReceiveStore = ({
  initialAccount,
  initialAmount,
}: {
  initialAccount: ExtendedAccount;
  initialAmount: Money | null;
}) => {
  return create<ReceiveState>((set) => ({
    accountId: initialAccount.id,
    amount: initialAmount,
    payFromDefaultAccount: !initialAccount.isDefault,
    setAccount: (account) => set({ accountId: account.id, amount: null }),
    setAmount: (amount) => set({ amount }),
    setPayFromDefaultAccount: (value) => set({ payFromDefaultAccount: value }),
  }));
};

export type ReceiveStore = ReturnType<typeof createReceiveStore>;
