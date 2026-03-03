import { create } from 'zustand';
import type { Currency, Money } from '~/lib/money';
import type { Account, CashuAccount, SparkAccount } from '../accounts/account';
import type { CashuReceiveQuote } from './cashu-receive-quote';
import type { SparkReceiveQuote } from './spark-receive-quote';

export type ReceiveQuote = {
  id: string;
  paymentRequest: string;
  transactionId: string;
  mintingFee?: Money;
};

type GetReceiveQuoteResult =
  | { success: true; quote: ReceiveQuote }
  | { success: false; error: unknown };

export type ReceiveState<T extends Currency = Currency> = {
  status: 'idle' | 'quoting';
  /** The ID of the account to receive funds in */
  accountId: string;
  /** The amount to receive in the account's currency */
  amount: Money<T> | null;
  /** The receive quote created for the buy flow */
  quote: ReceiveQuote | null;
  /** Set the account to receive funds in */
  setAccount: (account: Account) => void;
  /** Set the amount to receive in the account's currency */
  setAmount: (amount: Money<T>) => void;
  /** Create a receive quote for the given amount */
  getReceiveQuote: (amount: Money) => Promise<GetReceiveQuoteResult>;
};

type CreateReceiveStoreProps = {
  initialAccount: Account;
  initialAmount: Money | null;
  getAccount: (id: string) => Account;
  createCashuReceiveQuote: (params: {
    account: CashuAccount;
    amount: Money;
  }) => Promise<CashuReceiveQuote>;
  createSparkReceiveQuote: (params: {
    account: SparkAccount;
    amount: Money;
  }) => Promise<SparkReceiveQuote>;
};

export const createReceiveStore = ({
  initialAccount,
  initialAmount,
  getAccount,
  createCashuReceiveQuote,
  createSparkReceiveQuote,
}: CreateReceiveStoreProps) => {
  return create<ReceiveState>((set, get) => ({
    status: 'idle',
    accountId: initialAccount.id,
    amount: initialAmount,
    quote: null,
    setAccount: (account) =>
      set({ accountId: account.id, amount: null, quote: null }),
    setAmount: (amount) => set({ amount }),
    getReceiveQuote: async (amount) => {
      const account = getAccount(get().accountId);
      set({ status: 'quoting', amount });

      try {
        let quote: ReceiveQuote;

        if (account.type === 'cashu') {
          const cashuQuote = await createCashuReceiveQuote({
            account,
            amount,
          });
          quote = {
            id: cashuQuote.id,
            paymentRequest: cashuQuote.paymentRequest,
            transactionId: cashuQuote.transactionId,
            mintingFee: cashuQuote.mintingFee,
          };
        } else {
          const sparkQuote = await createSparkReceiveQuote({
            account,
            amount,
          });
          quote = {
            id: sparkQuote.id,
            paymentRequest: sparkQuote.paymentRequest,
            transactionId: sparkQuote.transactionId,
          };
        }

        set({ status: 'idle', quote });
        return { success: true, quote };
      } catch (error) {
        set({ status: 'idle' });
        return { success: false, error };
      }
    },
  }));
};

export type ReceiveStore = ReturnType<typeof createReceiveStore>;
