import type { Account } from '@agicash/sdk/features/accounts/account';
import type { Currency, Money } from '@agicash/sdk/lib/money/index';
import { create } from 'zustand';

export type ReceiveState<T extends Currency = Currency> = {
  /** The ID of the account to receive funds in */
  accountId: string;
  /** The amount to receive in the account's currency */
  amount: Money<T> | null;
  /** Set the account to receive funds in */
  setAccount: (account: Account) => void;
  /** Set the amount to receive in the account's currency */
  setAmount: (amount: Money<T>) => void;
};

export const createReceiveStore = ({
  initialAccount,
  initialAmount,
}: {
  initialAccount: Account;
  initialAmount: Money | null;
}) => {
  return create<ReceiveState>((set) => ({
    accountId: initialAccount.id,
    amount: initialAmount,
    setAccount: (account) => set({ accountId: account.id, amount: null }),
    setAmount: (amount) => set({ amount }),
  }));
};

export type ReceiveStore = ReturnType<typeof createReceiveStore>;
