import { create } from 'zustand';
import type { Currency, Money } from '~/lib/money';
import type { Account, CashuAccount, SparkAccount } from '../accounts/account';
import type { CashuReceiveQuote } from '../receive/cashu-receive-quote';
import type { SparkReceiveQuote } from '../receive/spark-receive-quote';

export type BuyQuote = {
  id: string;
  paymentRequest: string;
  transactionId: string;
  mintingFee?: Money;
};

type GetBuyQuoteResult =
  | { success: true; quote: BuyQuote }
  | { success: false; error: unknown };

export type BuyState<T extends Currency = Currency> = {
  status: 'idle' | 'quoting' | 'success';
  /** The ID of the account to buy into */
  accountId: string;
  /** The amount to buy */
  amount: Money<T> | null;
  /** The buy quote (Lightning invoice) */
  quote: BuyQuote | null;
  /** Set the account to buy into */
  setAccount: (account: Account) => void;
  /** Set the amount to buy */
  setAmount: (amount: Money<T>) => void;
  /** Create a receive quote for the given amount */
  getBuyQuote: (amount: Money) => Promise<GetBuyQuoteResult>;
};

type CreateBuyStoreProps = {
  initialAccount: Account;
  getAccount: (id: string) => Account;
  createCashuReceiveQuote: (params: {
    account: CashuAccount;
    amount: Money;
    description?: string;
  }) => Promise<CashuReceiveQuote>;
  createSparkReceiveQuote: (params: {
    account: SparkAccount;
    amount: Money;
    description?: string;
  }) => Promise<SparkReceiveQuote>;
};

export const createBuyStore = ({
  initialAccount,
  getAccount,
  createCashuReceiveQuote,
  createSparkReceiveQuote,
}: CreateBuyStoreProps) => {
  return create<BuyState>((set, get) => ({
    status: 'idle',
    accountId: initialAccount.id,
    amount: null,
    quote: null,
    setAccount: (account) =>
      set({ accountId: account.id, amount: null, quote: null }),
    setAmount: (amount) => set({ amount }),
    getBuyQuote: async (amount) => {
      const account = getAccount(get().accountId);
      set({ status: 'quoting', amount });

      try {
        let quote: BuyQuote;

        if (account.type === 'cashu') {
          const cashuQuote = await createCashuReceiveQuote({
            account,
            amount,
            description: 'Pay to Agicash',
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
            description: 'Pay to Agicash',
          });
          quote = {
            id: sparkQuote.id,
            paymentRequest: sparkQuote.paymentRequest,
            transactionId: sparkQuote.transactionId,
          };
        }

        set({ status: 'success', quote });
        return { success: true, quote };
      } catch (error) {
        set({ status: 'idle' });
        return { success: false, error };
      }
    },
  }));
};

export type BuyStore = ReturnType<typeof createBuyStore>;
