import { create } from 'zustand';
import type { Money } from '~/lib/money';
import type { Account } from '../accounts/account';
import type { TransferQuote } from './transfer-service';

type GetTransferQuoteResult =
  | { success: true; quote: TransferQuote }
  | { success: false; error: unknown };

export type TransferState = {
  status: 'idle' | 'quoting' | 'success';
  /** ID of the account to send from. */
  sourceAccountId: string;
  /** ID of the account to receive into. */
  destinationAccountId: string;
  /** The amount to transfer. */
  amount: Money | null;
  /** Quote for the transfer (bundled receive + send quotes). */
  transferQuote: TransferQuote | null;
  /** Create a transfer quote for the given amount. */
  getTransferQuote: (amount: Money) => Promise<GetTransferQuoteResult>;
};

type CreateTransferStoreProps = {
  sourceAccount: Account;
  destinationAccount: Account;
  getAccount: (id: string) => Account;
  createTransferQuote: (params: {
    sourceAccount: Account;
    destinationAccount: Account;
    amount: Money;
  }) => Promise<TransferQuote>;
};

export const createTransferStore = ({
  sourceAccount,
  destinationAccount,
  getAccount,
  createTransferQuote,
}: CreateTransferStoreProps) => {
  return create<TransferState>((set, get) => ({
    status: 'idle',
    sourceAccountId: sourceAccount.id,
    destinationAccountId: destinationAccount.id,
    amount: null,
    transferQuote: null,
    getTransferQuote: async (amount) => {
      const source = getAccount(get().sourceAccountId);
      const dest = getAccount(get().destinationAccountId);
      set({ status: 'quoting', amount });

      try {
        const quote = await createTransferQuote({
          sourceAccount: source,
          destinationAccount: dest,
          amount,
        });

        set({ status: 'success', transferQuote: quote });
        return { success: true, quote };
      } catch (error) {
        set({ status: 'idle' });
        return { success: false, error };
      }
    },
  }));
};

export type TransferStore = ReturnType<typeof createTransferStore>;
