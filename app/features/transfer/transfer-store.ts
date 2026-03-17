import { create } from 'zustand';
import type { Currency, Money } from '~/lib/money';
import type { Account } from '../accounts/account';
import type { TransferQuote } from './transfer-service';

type TransferQuoteResult =
  | { success: true; quote: TransferQuote }
  | { success: false; error: unknown };

export type TransferState<T extends Currency = Currency> = {
  status: 'idle' | 'quoting';
  sourceAccountId: string;
  destinationAccountId: string;
  amount: Money<T> | null;
  quote: TransferQuote | null;
  setAmount: (amount: Money<T>) => void;
  getTransferQuote: (amount: Money) => Promise<TransferQuoteResult>;
};

type CreateTransferStoreProps = {
  sourceAccount: Account;
  destinationAccount: Account;
  getAccount: (id: string) => Account;
  getTransferQuote: (params: {
    sourceAccount: Account;
    destinationAccount: Account;
    amount: Money;
  }) => Promise<TransferQuote>;
};

export const createTransferStore = ({
  sourceAccount,
  destinationAccount,
  getAccount,
  getTransferQuote,
}: CreateTransferStoreProps) => {
  return create<TransferState>((set, get) => ({
    status: 'idle',
    sourceAccountId: sourceAccount.id,
    destinationAccountId: destinationAccount.id,
    amount: null,
    quote: null,
    setAmount: (amount) => set({ amount }),
    getTransferQuote: async (amount) => {
      const source = getAccount(get().sourceAccountId);
      const destination = getAccount(get().destinationAccountId);
      set({ status: 'quoting', amount });

      try {
        const result = await getTransferQuote({
          sourceAccount: source,
          destinationAccount: destination,
          amount,
        });

        set({ status: 'idle', quote: result });
        return { success: true, quote: result };
      } catch (error) {
        set({ status: 'idle', quote: null });
        return { success: false, error };
      }
    },
  }));
};

export type TransferStore = ReturnType<typeof createTransferStore>;
